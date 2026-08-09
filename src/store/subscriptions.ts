// ── Types ──────────────────────────────────────────────────────────────────────

export type SubscriptionTier = 'free' | 'pro';

export interface UserSubscription {
  userId: string;
  tier: SubscriptionTier;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  status: 'active' | 'cancelled' | 'expired';
  currentPeriodEnd?: Date;
}

// ── In-memory store ────────────────────────────────────────────────────────────

const subscriptionsMap = new Map<string, UserSubscription>();
const usageMap = new Map<string, number>(); // userId -> generation count this month

// ── Subscription API ───────────────────────────────────────────────────────────

export function getUserSubscription(userId: string): UserSubscription {
  const existing = subscriptionsMap.get(userId);
  if (existing) return existing;

  const defaultSub: UserSubscription = {
    userId,
    tier: 'free',
    status: 'active',
  };
  subscriptionsMap.set(userId, defaultSub);
  return defaultSub;
}

export function setUserSubscription(userId: string, sub: UserSubscription): void {
  subscriptionsMap.set(userId, { ...sub, userId });
}

export function getGenerationLimit(tier: SubscriptionTier): number {
  if (tier === 'pro') return Infinity;
  return 5; // free tier: 5 generations per month
}

// ── Usage tracking ─────────────────────────────────────────────────────────────

export function getUsageThisMonth(userId: string): number {
  return usageMap.get(userId) ?? 0;
}

export function recordGeneration(userId: string): void {
  const current = usageMap.get(userId) ?? 0;
  usageMap.set(userId, current + 1);
}

export function canGenerate(userId: string): boolean {
  const sub = getUserSubscription(userId);
  const limit = getGenerationLimit(sub.tier);
  if (limit === Infinity) return true;
  return getUsageThisMonth(userId) < limit;
}

export function getRemainingGenerations(userId: string): number {
  const sub = getUserSubscription(userId);
  const limit = getGenerationLimit(sub.tier);
  if (limit === Infinity) return Infinity;
  return Math.max(0, limit - getUsageThisMonth(userId));
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Client-side check: returns true if the Stripe publishable key is set.
 * The secret key is only available server-side, but the publishable key's
 * presence is a reasonable indicator that Stripe is being set up.
 */
export function isStripeConfigured(): boolean {
  return Boolean(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
}
