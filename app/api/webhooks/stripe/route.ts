import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma as db } from '@/lib/db';
import { Resend } from 'resend';
import crypto from 'crypto';

const resend = new Resend(process.env.RESEND_API_KEY);

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

  // Acknowledge immediately — Stripe times out at 10s and retries if we don't respond fast
  const response = NextResponse.json({ received: true });

  // Process asynchronously after responding
  processEvent(event).catch(err => console.error('[webhook] processing error:', err));

  return response;
}

async function processEvent(event: Stripe.Event) {
  const session = event.data.object as any;

  switch (event.type) {
    case 'checkout.session.completed': {
      // ── SubTamer Premium purchase ──────────────────────────────────────────
      if (session.metadata?.subtamer === 'true') {
        const email = session.metadata?.email;
        if (!email) break;

        const licenseKey = 'ST-' + crypto.randomBytes(12).toString('hex').toUpperCase();

        await db.subTamerLicense.upsert({
          where: { email },
          update: {
            licenseKey,
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            status: 'active',
          },
          create: {
            email,
            licenseKey,
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            status: 'active',
          },
        });

        await resend.emails.send({
          from: 'SubTamer <noreply@tutorialclarity.com>',
          to: email,
          subject: 'Your SubTamer Premium License Key',
          html: `
            <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:2rem;background:#1a1a1a;color:#fff;border-radius:8px">
              <h1 style="color:#ffd700;margin-bottom:0.5rem">Welcome to SubTamer Premium!</h1>
              <p>Here is your license key:</p>
              <div style="background:#2a2a2a;padding:1rem;border-radius:4px;font-family:monospace;font-size:1.2rem;letter-spacing:2px;color:#ffd700;text-align:center;margin:1rem 0">
                ${licenseKey}
              </div>
              <p>To activate:</p>
              <ol style="color:#ccc">
                <li>Open YouTube and click the SubTamer icon</li>
                <li>Click <strong style="color:#ffd700">★ Upgrade</strong></li>
                <li>Paste your key and click <strong>Activate</strong></li>
              </ol>
              <p style="color:#888;font-size:0.85rem">Keep this email — you'll need the key if you reinstall the extension.</p>
            </div>
          `,
        });
        break;
      }

      // ── Tutorial Clarity purchase ──────────────────────────────────────────
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

      // SubTamer cancellation
      if (sub.metadata?.subtamer === 'true') {
        await db.subTamerLicense.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: { status: sub.status === 'active' ? 'active' : 'canceled' },
        });
        break;
      }

      // Tutorial Clarity cancellation
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
}
