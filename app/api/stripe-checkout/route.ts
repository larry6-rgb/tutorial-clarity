import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma as db } from '@/lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-05-27.dahlia',
});

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { priceId, mode: checkoutMode } = await req.json();
    const isOneTime = checkoutMode === 'payment';

    const monthlyPrice = process.env.STRIPE_PRICE_MONTHLY;
    const annualPrice = process.env.STRIPE_PRICE_ANNUAL;
    const overagePrice = process.env.STRIPE_PRICE_OVERAGE;
    if (!priceId || (isOneTime ? priceId !== overagePrice : priceId !== monthlyPrice && priceId !== annualPrice)) {
      return NextResponse.json({ error: 'Invalid checkout selection.' }, { status: 400 });
    }

    if (isOneTime) {
      const user = await db.user.findUnique({
        where: { clerkId: userId },
        include: { subscription: true },
      });
      const sub = user?.subscription;
      if (!sub || sub.status !== 'active' || !['monthly', 'annual', 'bundle'].includes(sub.plan)) {
        return NextResponse.json({ error: 'An active membership is required for session packs.' }, { status: 403 });
      }
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: isOneTime ? 'payment' : 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?canceled=true`,
      metadata: { clerkUserId: userId },
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
    };

    if (!isOneTime) {
      sessionParams.payment_method_collection = 'if_required';
      sessionParams.subscription_data = {
        trial_period_days: 14,
        trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
        metadata: { clerkUserId: userId },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
