import { NextResponse } from 'next/server';
import { validateSubtamerKey, isRateLimited } from '@/lib/subtamerKey';

// Lightweight, unauthenticated check used for inline UI feedback on the
// subscribe page before the user commits to checkout. The real gate that
// actually controls pricing is app/api/stripe-checkout-bundle/route.ts,
// which re-validates server-side — this route is convenience only.
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many attempts, try again in a minute.' }, { status: 429 });
  }

  const { subtamerKey } = await req.json();
  if (!subtamerKey) {
    return NextResponse.json({ error: 'SubTamer key required.' }, { status: 400 });
  }

  const { active } = await validateSubtamerKey(subtamerKey);
  return NextResponse.json({ active });
}
