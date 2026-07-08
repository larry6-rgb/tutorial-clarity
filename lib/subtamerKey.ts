// Validates a SubTamer license key against SubTamer's own live backend —
// the real source of truth (see C:\Dev\SubTamer\backend\server.js). TC's
// own dormant SubTamerLicense Prisma model/routes are a separate, unrelated
// abandoned migration and must not be used here.
const SUBTAMER_BACKEND = 'https://subtamer-production.up.railway.app';

// In-memory per-IP attempt counter to slow down brute-force key probing.
// Resets on server restart and isn't shared across multiple Railway
// instances — a soft speed bump, not a hard guarantee. Revisit with a
// DB/Redis-backed limiter if abuse is actually observed.
const attempts = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 10;

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS_PER_WINDOW;
}

export async function validateSubtamerKey(key: string): Promise<{ active: boolean }> {
  if (!key || typeof key !== 'string') return { active: false };

  try {
    const res = await fetch(`${SUBTAMER_BACKEND}/api/status?key=${encodeURIComponent(key)}`);
    if (!res.ok) return { active: false };
    const data = await res.json();
    return { active: Boolean(data.active) };
  } catch (err) {
    console.error('[validateSubtamerKey] SubTamer backend unreachable:', err);
    return { active: false };
  }
}
