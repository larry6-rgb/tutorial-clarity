import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma as db } from '@/lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-05-27.dahlia' });

export async function POST(req: Request) {
  // Secure with a cron secret so only Railway can trigger this
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get all active affiliates with pending commissions
  const pending = await db.commission.findMany({
    where: { status: 'pending' },
    include: { affiliate: true },
  });

  if (pending.length === 0) {
    return NextResponse.json({ message: 'No pending commissions.' });
  }

  // Group by affiliate
  const byAffiliate = new Map<string, { affiliate: typeof pending[0]['affiliate']; totalCents: number; ids: string[] }>();
  for (const c of pending) {
    if (!byAffiliate.has(c.affiliateCode)) {
      byAffiliate.set(c.affiliateCode, { affiliate: c.affiliate, totalCents: 0, ids: [] });
    }
    const entry = byAffiliate.get(c.affiliateCode)!;
    entry.totalCents += c.amountCents;
    entry.ids.push(c.id);
  }

  const results: { code: string; amountCents: number; status: string; error?: string }[] = [];

  for (const [code, { affiliate, totalCents, ids }] of byAffiliate) {
    if (!affiliate.stripeAccountId || affiliate.status !== 'active') {
      results.push({ code, amountCents: totalCents, status: 'skipped_no_stripe_account' });
      continue;
    }

    if (totalCents < 100) {
      // Skip payouts under $1.00 — accumulate until next month
      results.push({ code, amountCents: totalCents, status: 'skipped_below_minimum' });
      continue;
    }

    try {
      await stripe.transfers.create({
        amount: totalCents,
        currency: 'usd',
        destination: affiliate.stripeAccountId,
        description: `Tutorial Clarity affiliate commission — ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
      });

      // Mark all those commissions as paid
      await db.commission.updateMany({
        where: { id: { in: ids } },
        data: { status: 'paid', paidAt: new Date() },
      });

      results.push({ code, amountCents: totalCents, status: 'paid' });
    } catch (err: any) {
      results.push({ code, amountCents: totalCents, status: 'error', error: err.message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
