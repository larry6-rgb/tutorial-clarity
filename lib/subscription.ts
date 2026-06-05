import { prisma as db } from './db';

export type AccessResult =
  | { allowed: true }
  | { allowed: false; reason: 'no_account' | 'trial_expired' | 'subscription_inactive' };

export async function checkPremiumAccess(clerkUserId: string): Promise<AccessResult> {
  const user = await db.user.findUnique({
    where: { clerkId: clerkUserId },
    include: { subscription: true },
  });

  // No user record yet (webhook may not have fired)
  if (!user) {
    return { allowed: false, reason: 'no_account' };
  }

  const sub = user.subscription;

  // No subscription record — check if still within 14-day trial from account creation
  if (!sub) {
    const trialEnd = new Date(user.createdAt);
    trialEnd.setDate(trialEnd.getDate() + 14);
    if (new Date() < trialEnd) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'trial_expired' };
  }

  // Has a subscription record — check plan and status
  if (sub.plan === 'trial') {
    const trialEnd = sub.trialEndsAt ?? new Date(user.createdAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    if (new Date() < trialEnd) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'trial_expired' };
  }

  if (sub.status === 'active' && (sub.plan === 'monthly' || sub.plan === 'annual')) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'subscription_inactive' };
}
