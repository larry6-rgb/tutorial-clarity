import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { prisma as db } from '@/lib/db';

export async function GET() {
  const { userId } = await auth();

  if (!userId || userId !== process.env.ADMIN_CLERK_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users = await db.user.findMany({
    include: { subscription: true },
    orderBy: { createdAt: 'desc' },
  });

  const now = new Date();

  const rows = users.map((u) => {
    const sub = u.subscription;
    const trialEnd = sub?.trialEndsAt ?? new Date(u.createdAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    const trialActive = sub?.plan === 'trial' && now < trialEnd;
    const trialExpired = (sub?.plan === 'trial' || !sub) && now >= trialEnd;

    return {
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
      vipAccess: u.vipAccess,
      plan: sub?.plan ?? 'none',
      status: sub?.status ?? '—',
      trialEndsAt: trialEnd,
      trialActive,
      trialExpired,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      sessionsUsed: sub?.sessionsUsed ?? 0,
      bonusSessions: sub?.bonusSessions ?? 0,
      sessionsLimit: 20 + (sub?.bonusSessions ?? 0),
      stripeCustomerId: sub?.stripeCustomerId ?? null,
    };
  });

  return NextResponse.json(rows);
}
