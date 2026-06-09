import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma as db } from '@/lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-05-27.dahlia' });

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  if (!code) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/affiliates`);

  const affiliate = await db.affiliate.findUnique({ where: { code } });
  if (!affiliate?.stripeAccountId) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/affiliates`);
  }

  // Generate a fresh onboarding link
  const accountLink = await stripe.accountLinks.create({
    account: affiliate.stripeAccountId,
    refresh_url: `${process.env.NEXT_PUBLIC_BASE_URL}/affiliates/reauth?code=${code}`,
    return_url: `${process.env.NEXT_PUBLIC_BASE_URL}/affiliates/connected?code=${code}`,
    type: 'account_onboarding',
  });

  return NextResponse.redirect(accountLink.url);
}
