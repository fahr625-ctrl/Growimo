import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation } from '~/i18n';
import { formatDate } from '~/lib/date';
import {
  getUserSubscription,
  getGenerationLimit,
  getUsageThisMonth,
  getRemainingGenerations,
  isStripeConfigured,
} from '~/store/subscriptions';
import { createPortalSession } from '~/stripe/portal';
import { createCheckoutSession } from '~/stripe/checkout';

export const Route = createFileRoute('/app/billing')({
  component: BillingPage,
});

function BillingPage() {
  return (
    <ProtectedRoute>
      <BillingContent />
    </ProtectedRoute>
  );
}

function BillingContent() {
  const { user } = useUser();
  const { t, locale } = useTranslation();
  const userId = user?.id ?? 'anonymous';
  const sub = getUserSubscription(userId);
  const usage = getUsageThisMonth(userId);
  const limit = getGenerationLimit(sub.tier);
  const remaining = getRemainingGenerations(userId);

  const [portalLoading, setPortalLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stripeReady = isStripeConfigured();

  const handleManageBilling = async () => {
    if (!sub.stripeCustomerId) {
      setError(t.billing_no_stripe_customer);
      return;
    }
    setPortalLoading(true);
    setError(null);
    try {
      const result = await createPortalSession({
        data: { customerId: sub.stripeCustomerId },
      });
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t.billing_portal_error,
      );
    } finally {
      setPortalLoading(false);
    }
  };

  const handleUpgrade = async () => {
    setCheckoutLoading(true);
    setError(null);
    try {
      const result = await createCheckoutSession({
        data: {
          userId,
          priceLookupKey: 'pro_monthly',
        },
      });
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t.billing_checkout_error,
      );
    } finally {
      setCheckoutLoading(false);
    }
  };

  const isPro = sub.tier === 'pro';
  const usagePercent =
    limit === Infinity ? 0 : Math.min(100, Math.round((usage / limit) * 100));

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-gray-900">
          {t.billing_title}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {t.billing_subtitle}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Current Plan */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">{t.billing_current_plan}</h2>

          <div className="mt-4 flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
                isPro
                  ? 'bg-gradient-to-r from-blue-100 to-purple-100 text-blue-700'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {isPro ? (
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              ) : null}
              {isPro ? t.pricing_pro_name : t.pricing_free_name}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                sub.status === 'active'
                  ? 'bg-emerald-100 text-emerald-700'
                  : sub.status === 'cancelled'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-red-100 text-red-700'
              }`}
            >
              {sub.status === 'active' ? t.billing_status_active : sub.status === 'cancelled' ? t.billing_status_cancelled : sub.status}
            </span>
          </div>

          <p className="mt-3 text-sm text-gray-600">
            {isPro
              ? t.billing_pro_desc
              : t.billing_free_desc}
          </p>

          {isPro && sub.currentPeriodEnd && (
            <p className="mt-2 text-xs text-gray-400">
              {t.billing_period_ends}{' '}
              {formatDate(sub.currentPeriodEnd, locale)}
            </p>
          )}

          {/* Action buttons */}
          <div className="mt-6 space-y-3">
            {isPro && sub.stripeCustomerId ? (
              <button
                type="button"
                onClick={handleManageBilling}
                disabled={portalLoading}
                className={`inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition-all hover:bg-gray-50 ${
                  portalLoading ? 'cursor-wait opacity-60' : ''
                }`}
              >
                {portalLoading ? (
                  <>
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
                    {t.common_loading}
                  </>
                ) : (
                  <>
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    {t.billing_manage_subscription}
                  </>
                )}
              </button>
            ) : !isPro ? (
              <button
                type="button"
                onClick={handleUpgrade}
                disabled={checkoutLoading}
                className={`inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-xl ${
                  checkoutLoading ? 'cursor-wait opacity-60' : ''
                }`}
              >
                {checkoutLoading ? (
                  <>
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
                    {t.billing_redirecting}
                  </>
                ) : (
                  <>
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                    {t.billing_upgrade_pro}
                  </>
                )}
              </button>
            ) : null}

            <Link
              to="/app/pricing"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-5 py-2.5 text-sm font-semibold text-gray-600 transition-all hover:bg-gray-100"
            >
              {t.billing_view_plans}
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Link>
          </div>
        </div>

        {/* Usage Stats */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">{t.billing_usage_title}</h2>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600">
                {t.billing_generations}
              </span>
              <span className="text-sm font-semibold text-gray-900">
                {limit === Infinity ? `${usage} / ∞` : t.billing_usage_of.replace('%s', String(usage)).replace('%s', String(limit))}
              </span>
            </div>

            {/* Progress bar */}
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  usagePercent >= 100
                    ? 'bg-red-500'
                    : usagePercent >= 80
                      ? 'bg-amber-500'
                      : 'bg-gradient-to-r from-blue-500 to-purple-600'
                }`}
                style={{ width: `${limit === Infinity ? 50 : usagePercent}%` }}
              />
            </div>

            {limit !== Infinity && (
              <p className="mt-2 text-xs text-gray-400">
                {remaining === 0
                  ? t.billing_limit_used_up
                  : remaining === 1
                    ? t.billing_remaining_singular.replace('%d', String(remaining))
                    : t.billing_remaining_plural.replace('%d', String(remaining))}
              </p>
            )}

            {isPro && (
              <p className="mt-2 text-xs text-blue-600 font-medium">
                {t.billing_unlimited}
              </p>
            )}

            {/* Usage warning */}
            {!isPro && remaining <= 2 && remaining > 0 && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs text-amber-700">
                  {t.billing_warning_low}{' '}
                  <Link
                    to="/app/pricing"
                    className="font-semibold underline decoration-amber-400"
                  >
                    {t.billing_upgrade_pro}
                  </Link>{' '}
                  {t.billing_warning_low_suffix}
                </p>
              </div>
            )}

            {!isPro && remaining === 0 && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-xs text-red-700">
                  {t.billing_warning_limit}{' '}
                  <Link
                    to="/app/pricing"
                    className="font-semibold underline decoration-red-400"
                  >
                    {t.billing_upgrade_pro}
                  </Link>{' '}
                  {t.billing_warning_limit_suffix}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Billing History Placeholder */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">{t.billing_history_title}</h2>
        <div className="mt-4 flex flex-col items-center justify-center py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
            <svg
              className="h-5 w-5 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <p className="mt-3 text-sm font-medium text-gray-500">
            {t.billing_history_empty}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {t.billing_history_empty_desc}
          </p>
        </div>
      </div>

      {/* Stripe not configured warning */}
      {!stripeReady && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center">
          <span className="inline-flex items-center gap-2 text-sm text-amber-800">
            <span>⚡</span>
            <span>
              {t.billing_stripe_pending}
            </span>
          </span>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}
