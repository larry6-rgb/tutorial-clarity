import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma as db } from '@/lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-05-27.dahlia',
});

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const session = event.data.object as any;

  switch (event.type) {
    case 'checkout.session.completed': {
      const clerkUserId = session.metadata?.clerkUserId;
      if (!clerkUserId) break;

      const user = await db.user.findUnique({ where: { clerkId: clerkUserId } });
      if (!user) break;

      // One-time overage pack purchase
      if (session.mode === 'payment') {
        await db.subscription.updateMany({
          where: { userId: user.id },
          data: { bonusSessions: { increment: 20 } },
        });
        break;
      }

      // Subscription purchase
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      const priceId = subscription.items.data[0]?.price.id;
      const plan = priceId === process.env.STRIPE_PRICE_ANNUAL ? 'annual' : 'monthly';

      await db.subscription.upsert({
        where: { userId: user.id },
        update: {
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          plan,
          status: 'active',
          trialEndsAt: subscription.trial_end
            ? new Date(subscription.trial_end * 1000)
            : null,
          currentPeriodEnd: new Date((subscription as any).current_period_end * 1000),
        },
        create: {
          userId: user.id,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          plan,
          status: 'active',
          trialEndsAt: subscription.trial_end
            ? new Date(subscription.trial_end * 1000)
            : null,
          currentPeriodEnd: new Date((subscription as any).current_period_end * 1000),
        },
      });
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const clerkUserId = sub.metadata?.clerkUserId;
      if (!clerkUserId) break;

      const user = await db.user.findUnique({ where: { clerkId: clerkUserId } });
      if (!user) break;

      await db.subscription.updateMany({
        where: { userId: user.id },
        data: {
          status: sub.status === 'active' ? 'active' : 'canceled',
          currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
        },
      });
      break;
    }
  }

  return NextResponse.json({ received: true });
}
