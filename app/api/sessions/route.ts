import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { prisma as db } from '@/lib/db';

const SESSIONS_PER_MONTH = 20;

// GET — return current session usage for the logged-in user
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { clerkId: userId },
      include: { subscription: true },
    });

    if (!user || !user.subscription) {
      return NextResponse.json({
        sessionsUsed: 0,
        sessionsTotal: SESSIONS_PER_MONTH,
        bonusSessions: 0,
        hasReachedLimit: false,
      });
    }

    const sub = user.subscription;

    // Reset monthly count if we're in a new billing period
    const now = new Date();
    const resetAt = sub.sessionsResetAt;
    const needsReset = !resetAt || now > new Date(resetAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    if (needsReset) {
      await db.subscription.update({
        where: { userId: user.id },
        data: { sessionsUsed: 0, sessionsResetAt: now },
      });
      return NextResponse.json({
        sessionsUsed: 0,
        sessionsTotal: SESSIONS_PER_MONTH,
        bonusSessions: sub.bonusSessions,
        hasReachedLimit: false,
      });
    }

    const totalAvailable = SESSIONS_PER_MONTH + sub.bonusSessions;
    const hasReachedLimit = sub.sessionsUsed >= totalAvailable;

    return NextResponse.json({
      sessionsUsed: sub.sessionsUsed,
      sessionsTotal: SESSIONS_PER_MONTH,
      bonusSessions: sub.bonusSessions,
      hasReachedLimit,
    });
  } catch (error) {
    console.error('Sessions GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST — increment session count by 1
export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { clerkId: userId },
      include: { subscription: true },
    });

    if (!user || !user.subscription) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
    }

    const sub = user.subscription;
    const totalAvailable = SESSIONS_PER_MONTH + sub.bonusSessions;

    if (sub.sessionsUsed >= totalAvailable) {
      return NextResponse.json({ error: 'Session limit reached' }, { status: 403 });
    }

    // Use bonus sessions first if over the base limit
    if (sub.sessionsUsed >= SESSIONS_PER_MONTH && sub.bonusSessions > 0) {
      await db.subscription.update({
        where: { userId: user.id },
        data: {
          sessionsUsed: { increment: 1 },
          bonusSessions: { decrement: 1 },
        },
      });
    } else {
      await db.subscription.update({
        where: { userId: user.id },
        data: { sessionsUsed: { increment: 1 } },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Sessions POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
