import { NextResponse } from 'next/server';
import { prisma as db } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');

  if (!key) {
    return NextResponse.json({ active: false });
  }

  const license = await db.subTamerLicense.findUnique({
    where: { licenseKey: key },
  });

  return NextResponse.json({ active: license?.status === 'active' });
}
