import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma as db } from '@/lib/db';

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cookieStore = cookies();
  const ref = cookieStore.get('tc_ref')?.value;
  if (!ref) return NextResponse.json({ skipped: true });

  // Verify the affiliate code exists and is active
  const affiliate = await db.affiliate.findUnique({ where: { code: ref } });
  if (!affiliate || affiliate.status !== 'active') return NextResponse.json({ skipped: true });

  const user = await db.user.findUnique({
    where: { clerkId: userId },
    include: { subscription: true },
  });
  if (!user) return NextResponse.json({ skipped: true });

  // Only capture once (first touch wins)
  if (user.referredByCode) {
    const res = NextResponse.json({ skipped: true });
    res.cookies.set('tc_ref', '', { maxAge: 0, path: '/' });
    return res;
  }

  // Save referral code on user
  await db.user.update({
    where: { clerkId: userId },
    data: { referredByCode: ref },
  });

  // Extend trial by 30 days as a thank-you for using an affiliate link
  const baseTrialEnd = user.subscription?.trialEndsAt
    ?? new Date(user.createdAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  const extendedTrialEnd = new Date(baseTrialEnd.getTime() + 30 * 24 * 60 * 60 * 1000);

  if (user.subscription) {
    await db.subscription.update({
      where: { userId: user.id },
      data: { trialEndsAt: extendedTrialEnd },
    });
  } else {
    // Create a trial subscription record so we can store the extended end date
    await db.subscription.create({
      data: {
        userId: user.id,
        plan: 'trial',
        status: 'active',
        trialEndsAt: extendedTrialEnd,
      },
    });
  }

  const res = NextResponse.json({ captured: true, trialExtended: true });
  res.cookies.set('tc_ref', '', { maxAge: 0, path: '/' });
  return res;
}
