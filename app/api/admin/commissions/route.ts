import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { prisma as db } from '@/lib/db';

async function requireAdmin() {
  const { userId } = await auth();
  return userId && userId === process.env.ADMIN_CLERK_ID;
}

// GET: summary of pending commissions per affiliate
export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const commissions = await db.commission.findMany({
    orderBy: { createdAt: 'desc' },
    include: { affiliate: { select: { name: true, paypalEmail: true } } },
  });

  return NextResponse.json(commissions);
}

// POST: mark commission(s) as paid
export async function POST(req: Request) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { affiliateCode } = await req.json();

  // Mark all pending commissions for this affiliate as paid
  await db.commission.updateMany({
    where: { affiliateCode, status: 'pending' },
    data: { status: 'paid', paidAt: new Date() },
  });

  return NextResponse.json({ paid: true });
}
