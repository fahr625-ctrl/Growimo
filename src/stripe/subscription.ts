import { createServerFn } from '@tanstack/react-start';

/**
 * Phase 8.3 — Abo-Status vom Server (DB) für die Billing-/Pricing-UI.
 *
 * Löst die Nutzer-Identität serverseitig aus dem __session-Cookie auf
 * (identische Semantik wie der Usage-Guard) und liest den neuesten
 * subscriptions-Eintrag. Zusätzlich: isBeta (echte E-Mail gegen beta_signups
 * approved=true, für den 50-%-Badge) und usage (Free 5 / Pro 200, Server-Zähler).
 *
 * Fail-closed ohne DB/Session: tier 'free', stripeConfigured aus
 * STRIPE_SECRET_KEY — die UI zeigt dann Hinweise statt zu crashen.
 */
export interface SubscriptionStatus {
  signedIn: boolean;
  stripeConfigured: boolean;
  tier: 'free' | 'pro';
  status: 'active' | 'cancelled' | 'expired';
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: string | null;
  isBeta: boolean;
  usage: {
    used: number;
    remaining: number;
    limit: number;
    planTier: 'free' | 'pro';
    period: string;
  } | null;
}

export const getSubscriptionStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SubscriptionStatus> => {
    const { resolveUserIdFromServerFn } = await import('../lib/usage-guard');
    const userId = await resolveUserIdFromServerFn(undefined);

    const base = {
      signedIn: Boolean(userId),
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      tier: 'free' as const,
      status: 'active' as const,
      isBeta: false,
      usage: null as SubscriptionStatus['usage'],
      currentPeriodEnd: null as string | null,
    };

    if (!userId) return base;

    try {
      const [
        { qGetSubscriptionForUser, qGetUserEmailByClerkId },
        { getUsageInfo },
        { isBetaUserEmail },
      ] = await Promise.all([
        import('../db/queries'),
        import('../lib/usage-guard'),
        import('../api/beta'),
      ]);
      const [row, email, usage] = await Promise.all([
        qGetSubscriptionForUser(userId),
        qGetUserEmailByClerkId(userId),
        getUsageInfo(userId),
      ]);
      const isBeta = email ? await isBetaUserEmail(email) : false;
      return {
        ...base,
        signedIn: true,
        tier: row && row.planTier === 'pro' && row.status === 'active' ? 'pro' : 'free',
        status: row?.status ?? 'active',
        stripeCustomerId: row?.stripeCustomerId ?? undefined,
        stripeSubscriptionId: row?.stripeSubscriptionId ?? undefined,
        currentPeriodEnd: row?.currentPeriodEnd
          ? row.currentPeriodEnd.toISOString()
          : null,
        isBeta,
        usage: usage ?? null,
      };
    } catch (err) {
      console.error('[subscription] status refresh failed (fail-closed → free):', err);
      return base;
    }
  },
);