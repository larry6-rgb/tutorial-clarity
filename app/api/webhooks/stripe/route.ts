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

    case 'invoice.payment_succeeded': {
      // Record 30% affiliate commission for every successful payment from a referred user
      const invoice = event.data.object as Stripe.Invoice;
      if (!invoice.customer || invoice.amount_paid <= 0) break;

      // Find user by Stripe customer ID
      const affSub = await db.subscription.findFirst({
        where: { stripeCustomerId: String(invoice.customer) },
        include: { user: true },
      });
      if (!affSub?.user?.referredByCode) break;

      const affiliate = await db.affiliate.findUnique({
        where: { code: affSub.user.referredByCode },
      });
      if (!affiliate || affiliate.status !== 'active') break;

      // Avoid double-recording the same invoice
      const existing = await db.commission.findUnique({
        where: { stripeInvoiceId: invoice.id },
      });
      if (existing) break;

      const commissionCents = Math.round(invoice.amount_paid * 0.30);
      await db.commission.create({
        data: {
          affiliateCode: affiliate.code,
          userId: affSub.user.id,
          stripeInvoiceId: invoice.id,
          amountCents: commissionCents,
          status: 'pending',
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
