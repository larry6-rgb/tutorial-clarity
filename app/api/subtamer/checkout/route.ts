import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-05-27.dahlia',
});

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: process.env.STRIPE_SUBTAMER_PRICE_ID!, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/subtamer-success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/subtamer-cancel`,
      metadata: { subtamer: 'true', email },
      subscription_data: { metadata: { subtamer: 'true', email } },
      // automatic_tax disabled until TX Sales and Use Tax permit is active
      billing_address_collection: 'required',
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('[subtamer/checkout]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
