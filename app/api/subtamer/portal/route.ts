import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma as db } from '@/lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-05-27.dahlia',
});

export async function POST(req: Request) {
  try {
    const { key } = await req.json();
    if (!key) return NextResponse.json({ error: 'Key required' }, { status: 400 });

    const license = await db.subTamerLicense.findUnique({ where: { licenseKey: key } });
    if (!license?.stripeCustomerId) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: license.stripeCustomerId,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/subtamer-success`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('[subtamer/portal]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
