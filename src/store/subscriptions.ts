// ── Types ──────────────────────────────────────────────────────────────────────

export type SubscriptionTier = 'free' | 'pro';

export interface UserSubscription {
  userId: string;
  tier: SubscriptionTier;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  status: 'active' | 'cancelled' | 'expired';
  currentPeriodEnd?: Date;
  /** P2 (2026-10-07): zum Periodenende gekündigt (Zugriff bis currentPeriodEnd). */
  cancelAtPeriodEnd?: boolean;
  /** P2: terminierter Kündigungszeitpunkt (aus Stripe) oder undefined. */
  cancelAt?: Date;
}

// ── In-memory store ────────────────────────────────────────────────────────────

const subscriptionsMap = new Map<string, UserSubscription>();
// FIX-BLOCK 1 (Owner-Auftrag 2026-10-08): KEIN eigenständiger lokaler Zähler
// mehr. `usageMap` ist ausschließlich ein SPIEGEL des serverseitigen Werts
// (ServerFn getSubscriptionStatus → usage-guard → usage_monthly.count). Er wird
// von `hydrateUsageFromServer` gesetzt; `recordGeneration` zählt nur optimistisch
// mit (Sofort-Feedback der laufenden Sitzung) und stößt sofort einen
// Server-Refresh an, der den Spiegel überschreibt. Anzeigen lesen den
// Server-Wert (siehe src/lib/usage-client.ts) — dadurch kann kein Banner mehr
// von der DB abweichen.
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
  // Owner-Entscheidung 2026-09-12: Pro = 200 Generierungen/Monat — es gibt
  // KEINEN „unbegrenzt"-Tarif. Der Server (usage-guard) ist die Autorität;
  // dieser Store ist nur der Client-Anzeige-Fallback bis zum Server-Refresh.
  if (tier === 'pro') return 200;
  return 5; // free tier: 5 generations per month
}

// ── Usage tracking ─────────────────────────────────────────────────────────────

export function getUsageThisMonth(userId: string): number {
  return usageMap.get(userId) ?? 0;
}

/**
 * FIX-BLOCK 1: Spiegel des DB-Zählers setzen (Quelle: getSubscriptionStatus →
 * usage-guard). Überschreibt IMMER die lokale Sicht mit dem Server-Wert — der
 * Server ist die Autorität für Limit und Anzeige.
 */
export function hydrateUsageFromServer(
  userId: string,
  used: number,
  planTier?: SubscriptionTier,
): void {
  if (!userId) return;
  usageMap.set(userId, Math.max(0, Math.floor(used)));
  // FIX-BLOCK 1: auch der Tarif kommt aus der Server-Antwort — sonst würde eine
  // Pro-Sitzung client-seitig weiter mit dem Free-Limit (5) rechnen.
  if (planTier === 'free' || planTier === 'pro') {
    const existing = subscriptionsMap.get(userId);
    subscriptionsMap.set(userId, {
      ...(existing ?? { userId, status: 'active' as const }),
      userId,
      tier: planTier,
    });
  }
}

/**
 * Optimistisches Sofort-Feedback (+1) NACH einer erfolgreichen Generierung.
 * Kein eigener Zähler: direkt danach wird der Server-Wert neu geladen
 * (usage-refresh-Event) und der Spiegel damit auf die DB-Wahrheit gesetzt.
 */
export function recordGeneration(userId: string): void {
  const current = usageMap.get(userId) ?? 0;
  usageMap.set(userId, current + 1);
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new Event('growimo:usage-refresh'));
    } catch {
      // Anzeige-Refresh darf niemals eine Generierung stören.
    }
  }
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
