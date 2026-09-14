import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useUser } from '@clerk/clerk-react';
import {
  getUserSubscription,
  setUserSubscription,
  isStripeConfigured,
} from '~/store/subscriptions';
import { createCheckoutSession } from '~/stripe/checkout';
import { getSubscriptionStatus } from '~/stripe/subscription';
import { useTranslation } from '~/i18n';
import { track } from '~/lib/tracking-client';

export const Route = createFileRoute('/app/pricing')({
  component: PricingPage,
});

function PricingPage() {
  const { t } = useTranslation();
  const [isAnnual, setIsAnnual] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let userId = 'anonymous';
  try {
    const { user } = useUser();
    userId = user?.id ?? 'anonymous';
  } catch {
    // useUser may fail if Clerk is not configured
  }

  // Server-verifizierter Abo-/Beta-/Stripe-Status (Phase 8.3). Start vom
  // Client-Store (bisheriges Verhalten), dann Refresh aus der DB.
  const initialSub = (() => {
    try {
      return getUserSubscription(userId);
    } catch {
      return { tier: 'free' as const, status: 'active' as const, userId };
    }
  })();
  const [userTier, setUserTier] = useState<'free' | 'pro'>(initialSub.tier);
  const [isBeta, setIsBeta] = useState(false);
  const [stripeConfigured, setStripeConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSubscriptionStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.signedIn && userId !== 'anonymous') {
          setUserSubscription(userId, {
            userId,
            tier: status.tier,
            status: status.status,
            stripeCustomerId: status.stripeCustomerId,
            stripeSubscriptionId: status.stripeSubscriptionId,
            currentPeriodEnd: status.currentPeriodEnd
              ? new Date(status.currentPeriodEnd)
              : undefined,
          });
          setUserTier(status.tier);
        }
        setIsBeta(status.isBeta);
        if (status.stripeConfigured !== undefined) setStripeConfigured(status.stripeConfigured);
      })
      .catch(() => {
        // kein Key/Session → bisheriges Verhalten (Store-Fallback), Hinweis unten
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const stripeReady = stripeConfigured ?? isStripeConfigured();

  const monthlyPrice = 19;
  const annualPrice = 190;
  const annualMonthlyEquivalent = Math.round(annualPrice / 12);
  // Server-side beta-tracking (additive): pricing page opened.
  useEffect(() => { track('package_or_pricing_opened', userId === 'anonymous' ? undefined : userId, { page: 'pricing' }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const handleUpgrade = async () => {
    track('upgrade_clicked', userId === 'anonymous' ? undefined : userId, { source: 'pricing' });
    if (!stripeReady) return;
    setIsLoading(true);
    setError(null);

    try {
      const result = await createCheckoutSession({
        data: {
          userId,
          priceLookupKey: isAnnual ? 'pro_yearly' : 'pro_monthly',
        },
      });
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t.pricing_error_generic,
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-extrabold text-gray-900">{t.pricing_title}</h1>
        <p className="mt-3 text-base text-gray-500 max-w-md mx-auto">
          {t.pricing_subtitle}
        </p>
      </div>

      {/* Annual toggle */}
      <div className="mb-10 flex items-center justify-center gap-3">
        <span
          className={`text-sm font-medium ${
            !isAnnual ? 'text-gray-900' : 'text-gray-400'
          }`}
        >
          {t.pricing_monthly}
        </span>
        <button
          type="button"
          onClick={() => setIsAnnual(!isAnnual)}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
            isAnnual
              ? 'bg-gradient-to-r from-blue-500 to-purple-600'
              : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
              isAnnual ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
        <span
          className={`text-sm font-medium ${
            isAnnual ? 'text-gray-900' : 'text-gray-400'
          }`}
        >
          {t.pricing_yearly}{' '}
          <span className="ml-1 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            {t.pricing_save}
          </span>
        </span>
      </div>

      {/* Plan cards */}
      <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-2">
        {/* Free Plan */}
        <PlanCard
          name={t.pricing_free_name}
          price={0}
          period={isAnnual ? t.pricing_per_year : t.pricing_per_month}
          description={t.pricing_free_desc}
          features={t.pricing_free_features}
          cta={
            userTier === 'free' ? (
              <span className="inline-flex w-full items-center justify-center rounded-xl border-2 border-blue-200 bg-blue-50 px-6 py-3 text-sm font-semibold text-blue-700">
                {t.pricing_free_current}
              </span>
            ) : null
          }
          highlighted={false}
        />

        {/* Pro Plan */}
        <PlanCard
          name={t.pricing_pro_name}
          price={isAnnual ? annualPrice : monthlyPrice}
          period={isAnnual ? t.pricing_per_year : t.pricing_per_month}
          description={t.pricing_pro_desc}
          features={t.pricing_pro_features}
          monthlyNote={
            isAnnual
              ? t.pricing_pro_monthly_note.replace('%d', String(annualMonthlyEquivalent))
              : undefined
          }
          betaBadge={isBeta ? t.pricing_beta_badge : undefined}
          cta={
            userTier === 'pro' ? (
              <Link
                to="/app/billing"
                className="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-xl"
              >
                {t.pricing_pro_manage}
              </Link>
            ) : (
              <button
                type="button"
                onClick={handleUpgrade}
                disabled={isLoading}
                className={`inline-flex w-full items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all ${
                  isLoading
                    ? 'cursor-wait bg-blue-400'
                    : 'bg-gradient-to-r from-blue-600 to-purple-600 shadow-blue-200 hover:from-blue-700 hover:to-purple-700 hover:shadow-xl'
                }`}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="h-4 w-4 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    {t.auth_redirecting}
                  </span>
                ) : (
                  t.pricing_pro_upgrade
                )}
              </button>
            )
          }
          highlighted={true}
          badge={t.pricing_popular}
        />
      </div>

      {/* Stripe not configured warning */}
      {!stripeReady && (
        <div className="mx-auto mt-8 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center">
          <span className="inline-flex items-center gap-2 text-sm text-amber-800">
            <span>⚡</span>
            <span>{t.pricing_stripe_pending}</span>
          </span>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="mx-auto mt-4 max-w-2xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}

// ── Plan Card ──────────────────────────────────────────────────────────────────

function PlanCard({
  name,
  price,
  period,
  description,
  features,
  cta,
  highlighted,
  badge,
  monthlyNote,
  betaBadge,
}: {
  name: string;
  price: number;
  period: string;
  description: string;
  features: readonly string[];
  cta: React.ReactNode;
  highlighted: boolean;
  badge?: string;
  monthlyNote?: string;
  betaBadge?: string;
}) {
  return (
    <div
      className={`relative flex flex-col rounded-2xl border-2 bg-white p-8 shadow-sm transition-all ${
        highlighted
          ? 'border-blue-400 ring-2 ring-blue-100 shadow-xl shadow-blue-100'
          : 'border-gray-200'
      }`}
    >
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center rounded-full bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-1 text-xs font-bold text-white shadow-md">
            {badge}
          </span>
        </div>
      )}

      <h3 className="text-xl font-bold text-gray-900">{name}</h3>
      <p className="mt-1 text-sm text-gray-500">{description}</p>

      <div className="mt-6 flex items-baseline gap-1">
        <span className="text-4xl font-extrabold text-gray-900">
          {price} €
        </span>
        <span className="text-sm text-gray-500">{period}</span>
      </div>
      {betaBadge && (
        <p className="mt-2 inline-flex w-fit items-center rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700 ring-1 ring-purple-200">
          {betaBadge}
        </p>
      )}
      {monthlyNote && (
        <p className="mt-1 text-xs text-gray-400">{monthlyNote}</p>
      )}

      <ul className="mt-6 flex-1 space-y-3">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-3">
            <svg
              className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                highlighted ? 'text-blue-500' : 'text-emerald-500'
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="text-sm text-gray-600">{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8">{cta}</div>
    </div>
  );
}