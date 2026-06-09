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

  // Verify the affiliate code exists
  const affiliate = await db.affiliate.findUnique({ where: { code: ref } });
  if (!affiliate) return NextResponse.json({ skipped: true });

  // Only set referredByCode if not already set (first touch wins)
  const user = await db.user.findUnique({ where: { clerkId: userId } });
  if (!user) return NextResponse.json({ skipped: true });

  if (!user.referredByCode) {
    await db.user.update({
      where: { clerkId: userId },
      data: { referredByCode: ref },
    });
  }

  // Clear the cookie
  const res = NextResponse.json({ captured: true });
  res.cookies.set('tc_ref', '', { maxAge: 0, path: '/' });
  return res;
}
