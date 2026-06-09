import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { prisma as db } from '@/lib/db';

export async function POST(req: Request) {
  const { userId } = await auth();

  if (!userId || userId !== process.env.ADMIN_CLERK_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId: targetUserId, vipAccess } = await req.json();

  if (!targetUserId || typeof vipAccess !== 'boolean') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: targetUserId },
    data: { vipAccess },
  });

  return NextResponse.json({ id: updated.id, email: updated.email, vipAccess: updated.vipAccess });
}
