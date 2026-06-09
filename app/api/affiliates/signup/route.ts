import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma as db } from '@/lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-05-27.dahlia' });

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function POST(req: Request) {
  const { name, email, address, phone, website } = await req.json();

  if (!name || !email) {
    return NextResponse.json({ error: 'Name and email are required.' }, { status: 400 });
  }

  // Auto-generate a unique referral code from their name
  let baseCode = slugify(name);
  if (!baseCode) baseCode = 'affiliate';
  let code = baseCode;
  let attempt = 0;
  while (true) {
    const existing = await db.affiliate.findUnique({ where: { code } });
    if (!existing) break;
    attempt++;
    code = `${baseCode}-${attempt}`;
  }

  // Create Stripe Connect Express account
  const stripeAccount = await stripe.accounts.create({
    type: 'express',
    email,
    capabilities: { transfers: { requested: true } },
    business_profile: { url: website || undefined },
    metadata: { affiliateCode: code },
  });

  // Save affiliate record
  await db.affiliate.create({
    data: {
      code,
      name,
      email,
      address: address || null,
      phone: phone || null,
      website: website || null,
      stripeAccountId: stripeAccount.id,
      status: 'pending_stripe',
    },
  });

  // Create Stripe onboarding link
  const accountLink = await stripe.accountLinks.create({
    account: stripeAccount.id,
    refresh_url: `${process.env.NEXT_PUBLIC_BASE_URL}/affiliates/reauth?code=${code}`,
    return_url: `${process.env.NEXT_PUBLIC_BASE_URL}/affiliates/connected?code=${code}`,
    type: 'account_onboarding',
  });

  return NextResponse.json({ onboardingUrl: accountLink.url, code });
}
