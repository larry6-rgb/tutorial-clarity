import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma as db } from '@/lib/db';
import { Resend } from 'resend';
import { validateSubtamerKey } from '@/lib/subtamerKey';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-05-27.dahlia' });
const resend = new Resend(process.env.RESEND_API_KEY);

// Runs daily on a separate Railway cron service (mirrors AFFILIATE-PAYOUTS —
// never add a Cron Schedule to the main tutorial-clarity web service, it
// makes Railway treat the container as a one-shot job that exits immediately).
//
// Re-verifies every bundle subscriber's stored SubTamer key. If it's lapsed,
// reverts the TC subscription to full price for the NEXT billing cycle only
// (proration_behavior: 'none' — no retroactive charge), revokes the TC
// extension's video-indexing activation, and emails an explanation.
export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const bundleSubs = await db.subscription.findMany({
    where: { plan: 'bundle' },
    include: { user: true },
  });

  const results: { userId: string; action: string }[] = [];

  for (const sub of bundleSubs) {
    if (!sub.subtamerKeyUsed || !sub.stripeSubscriptionId) {
      results.push({ userId: sub.userId, action: 'skipped_missing_data' });
      continue;
    }

    const { active } = await validateSubtamerKey(sub.subtamerKeyUsed);
    if (active) {
      results.push({ userId: sub.userId, action: 'still_active' });
      continue;
    }

    try {
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
      const itemId = stripeSub.items.data[0]?.id;
      if (itemId) {
        await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          items: [{ id: itemId, price: process.env.STRIPE_PRICE_MONTHLY }],
          proration_behavior: 'none',
        });
      }

      await db.subscription.update({
        where: { userId: sub.userId },
        data: { plan: 'monthly' },
      });

      await db.tCExtensionActivation.updateMany({
        where: { userId: sub.userId },
        data: { active: false },
      });

      if (sub.user?.email) {
        await resend.emails.send({
          from: 'Tutorial Clarity <noreply@tutorialclarity.com>',
          to: sub.user.email,
          subject: 'Your Tutorial Clarity price has changed',
          html: `
            <p>Your SubTamer subscription is no longer active, so your Tutorial Clarity subscription has returned to <strong>$12.99/mo</strong> starting your next billing cycle.</p>
            <p>Video indexing inside Tutorial Clarity's extension has also been paused.</p>
            <p>To restore the $8/mo bundle rate and video indexing, resubscribe to SubTamer and re-enter your key on your Tutorial Clarity subscribe page.</p>
          `,
        });
      }

      results.push({ userId: sub.userId, action: 'downgraded' });
    } catch (err: any) {
      results.push({ userId: sub.userId, action: `error: ${err.message}` });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
