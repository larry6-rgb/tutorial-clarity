import { prisma as db } from './db';

export type AccessResult =
  | { allowed: true }
  | { allowed: false; reason: 'no_account' | 'trial_expired' | 'subscription_inactive' };

export type SubscriptionStatus = {
  plan: 'trial' | 'monthly' | 'annual' | 'free';
  premiumAllowed: boolean;
  trialExpired: boolean;
  trialEndsAt: Date | null;
  sessionsUsed: number;
  sessionsLimit: number;
  sessionsRemaining: number;
  sessionWarning: boolean;  // 3 or fewer remaining
  sessionBlocked: boolean;  // 0 remaining
};

export async function checkPremiumAccess(clerkUserId: string): Promise<AccessResult> {
  const user = await db.user.findUnique({
    where: { clerkId: clerkUserId },
    include: { subscription: true },
  });

  if (!user) return { allowed: false, reason: 'no_account' };

  const sub = user.subscription;

  if (!sub) {
    const trialEnd = new Date(user.createdAt);
    trialEnd.setDate(trialEnd.getDate() + 14);
    if (new Date() < trialEnd) return { allowed: true };
    return { allowed: false, reason: 'trial_expired' };
  }

  if (sub.plan === 'trial') {
    const trialEnd = sub.trialEndsAt ?? new Date(user.createdAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    if (new Date() < trialEnd) return { allowed: true };
    return { allowed: false, reason: 'trial_expired' };
  }

  if (sub.status === 'active' && (sub.plan === 'monthly' || sub.plan === 'annual')) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'subscription_inactive' };
}

export async function getSubscriptionStatus(clerkUserId: string): Promise<SubscriptionStatus> {
  const user = await db.user.findUnique({
    where: { clerkId: clerkUserId },
    include: { subscription: true },
  });

  const SESSION_LIMIT = 20;
  const SESSION_WARNING_THRESHOLD = 3;

  if (!user) {
    return {
      plan: 'free', premiumAllowed: false, trialExpired: false, trialEndsAt: null,
      sessionsUsed: 0, sessionsLimit: SESSION_LIMIT,
      sessionsRemaining: SESSION_LIMIT, sessionWarning: false, sessionBlocked: false,
    };
  }

  const sub = user.subscription;
  const now = new Date();

  // --- Determine trial end date ---
  const trialEnd = sub?.trialEndsAt
    ?? new Date(user.createdAt.getTime() + 14 * 24 * 60 * 60 * 1000);

  // --- Determine plan and premium access ---
  let plan: SubscriptionStatus['plan'] = 'free';
  let premiumAllowed = false;
  let trialExpired = false;

  if (!sub || sub.plan === 'trial') {
    if (now < trialEnd) {
      plan = 'trial';
      premiumAllowed = true;
    } else {
      plan = 'free';
      premiumAllowed = false;
      trialExpired = true;
      // Auto-downgrade in DB if still marked as trial
      if (sub?.plan === 'trial') {
        await db.subscription.update({
          where: { userId: user.id },
          data: { plan: 'free', status: 'active' },
        });
      }
    }
  } else if (sub.plan === 'monthly' || sub.plan === 'annual') {
    plan = sub.plan;
    premiumAllowed = sub.status === 'active';
  }

  // --- Session counts ---
  const sessionsUsed = sub?.sessionsUsed ?? 0;
  const bonusSessions = sub?.bonusSessions ?? 0;
  const sessionsLimit = SESSION_LIMIT + bonusSessions;
  const sessionsRemaining = Math.max(0, sessionsLimit - sessionsUsed);
  const sessionWarning = premiumAllowed && sessionsRemaining <= SESSION_WARNING_THRESHOLD && sessionsRemaining > 0;
  const sessionBlocked = premiumAllowed && sessionsRemaining === 0;

  return {
    plan,
    premiumAllowed,
    trialExpired,
    trialEndsAt: trialEnd,
    sessionsUsed,
    sessionsLimit,
    sessionsRemaining,
    sessionWarning,
    sessionBlocked,
  };
}
