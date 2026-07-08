import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { validateSubtamerKey, isRateLimited } from '@/lib/subtamerKey';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-05-27.dahlia',
});

// Discounted TC checkout for existing SubTamer subscribers: $4.99 (SubTamer)
// + $8 (this) = $12.99 combined, instead of paying full price for both.
// One-time check at signup, not ongoing — app/api/cron/bundle-recheck
// re-verifies periodically and reverts the price if SubTamer lapses.
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: 'Too many attempts, try again in a minute.' }, { status: 429 });
    }

    const { subtamerKey } = await req.json();
    if (!subtamerKey || typeof subtamerKey !== 'string') {
      return NextResponse.json({ error: 'SubTamer key required.' }, { status: 400 });
    }

    const { active } = await validateSubtamerKey(subtamerKey);
    if (!active) {
      return NextResponse.json({ error: 'That SubTamer key is not active.' }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_BUNDLE_PRICE_ID!, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?canceled=true`,
      metadata: { clerkUserId: userId, bundle: 'true', subtamerKey },
      subscription_data: {
        trial_period_days: 14,
        metadata: { clerkUserId: userId, bundle: 'true', subtamerKey },
      },
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Stripe bundle checkout error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
