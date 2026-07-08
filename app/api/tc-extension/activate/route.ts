import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { prisma as db } from '@/lib/db';
import crypto from 'crypto';

// CORS — POST is called cross-origin from the extension's content script
// running on youtube.com, same pattern as /api/save-video.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// GET — called from the signed-in TC website (watch-page menu section) to
// fetch (or lazily generate) the current user's extension activation key.
export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { clerkId: clerkUserId },
    include: { subscription: true, tcExtensionActivation: true },
  });
  if (!user) return NextResponse.json({ error: 'no_account' }, { status: 404 });

  const isPaid = user.subscription?.status === 'active' &&
    ['monthly', 'annual', 'bundle'].includes(user.subscription.plan);
  if (!isPaid) {
    return NextResponse.json({ error: 'not_premium' }, { status: 403 });
  }

  let activation = user.tcExtensionActivation;
  if (!activation) {
    const activationKey = 'TCX-' + crypto.randomBytes(12).toString('hex').toUpperCase();
    activation = await db.tCExtensionActivation.create({
      data: { userId: user.id, activationKey, active: true },
    });
  } else if (!activation.active) {
    activation = await db.tCExtensionActivation.update({
      where: { userId: user.id },
      data: { active: true },
    });
  }

  return NextResponse.json({ activationKey: activation.activationKey });
}

// POST — called by TC's Chrome extension (no Clerk session available there)
// to validate a pasted activation key before enabling the index-overlay UI.
// Only ever succeeds for a key issued to an active paid TC subscription —
// a real SubTamer key is never accepted here.
export async function POST(req: Request) {
  const { activationKey } = await req.json();
  if (!activationKey || typeof activationKey !== 'string') {
    return NextResponse.json({ valid: false }, { status: 400, headers: CORS_HEADERS });
  }

  const activation = await db.tCExtensionActivation.findUnique({
    where: { activationKey },
    include: { user: { include: { subscription: true } } },
  });

  const valid = Boolean(
    activation?.active &&
    activation.user?.subscription?.status === 'active' &&
    ['monthly', 'annual', 'bundle'].includes(activation.user.subscription.plan)
  );

  return NextResponse.json({ valid }, { headers: CORS_HEADERS });
}
