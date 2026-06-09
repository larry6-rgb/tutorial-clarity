import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { prisma as db } from '@/lib/db';

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId || userId !== process.env.ADMIN_CLERK_ID) return false;
  return true;
}

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const affiliates = await db.affiliate.findMany({ orderBy: { createdAt: 'desc' } });

  // Count signups per affiliate code
  const counts = await db.user.groupBy({
    by: ['referredByCode'],
    _count: { id: true },
    where: { referredByCode: { not: null } },
  });

  // Count paid conversions per affiliate code
  const paidUsers = await db.user.findMany({
    where: { referredByCode: { not: null } },
    include: { subscription: true },
  });

  const signupMap: Record<string, number> = {};
  counts.forEach(c => { if (c.referredByCode) signupMap[c.referredByCode] = c._count.id; });

  const paidMap: Record<string, number> = {};
  paidUsers.forEach(u => {
    if (u.referredByCode && u.subscription?.plan && ['monthly', 'annual'].includes(u.subscription.plan) && u.subscription.status === 'active') {
      paidMap[u.referredByCode] = (paidMap[u.referredByCode] ?? 0) + 1;
    }
  });

  // Sum pending and total commissions per affiliate
  const commissions = await db.commission.groupBy({
    by: ['affiliateCode', 'status'],
    _sum: { amountCents: true },
  });

  const pendingMap: Record<string, number> = {};
  const totalEarnedMap: Record<string, number> = {};
  commissions.forEach(c => {
    if (c.status === 'pending') pendingMap[c.affiliateCode] = (c._sum.amountCents ?? 0);
    totalEarnedMap[c.affiliateCode] = (totalEarnedMap[c.affiliateCode] ?? 0) + (c._sum.amountCents ?? 0);
  });

  const rows = affiliates.map(a => ({
    ...a,
    signups: signupMap[a.code] ?? 0,
    conversions: paidMap[a.code] ?? 0,
    pendingCents: pendingMap[a.code] ?? 0,
    totalEarnedCents: totalEarnedMap[a.code] ?? 0,
  }));

  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { code, name, email } = await req.json();
  if (!code || !name) return NextResponse.json({ error: 'code and name are required' }, { status: 400 });

  const slug = code.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

  try {
    const affiliate = await db.affiliate.create({ data: { code: slug, name, email: email || null } });
    return NextResponse.json(affiliate);
  } catch {
    return NextResponse.json({ error: 'Code already exists' }, { status: 409 });
  }
}

export async function DELETE(req: Request) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await req.json();
  await db.affiliate.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
