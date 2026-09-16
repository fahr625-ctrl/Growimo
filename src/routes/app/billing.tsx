import { createFileRoute, Link, useSearch } from '@tanstack/react-router';
import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@clerk/clerk-react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation } from '~/i18n';
import { formatDate } from '~/lib/date';
import { track } from '~/lib/tracking-client';
import { OWNER_USER_ID } from '~/lib/tracking';
import {
  getUserSubscription,
  setUserSubscription,
  getGenerationLimit,
  getRemainingGenerations,
  isStripeConfigured,
} from '~/store/subscriptions';
import { getSubscriptionStatus } from '~/stripe/subscription';
import { getBillingOverview, type InvoiceSummary } from '~/stripe/invoices';
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

function formatMoney(cents: number, currency: string, locale: string): string {
  const cur = (currency || 'eur').toUpperCase();
  try {
    return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-US', {
      style: 'currency',
      currency: cur,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${cur}`;
  }
}

function BillingContent() {
  const { user } = useUser();
  const { t, locale } = useTranslation();
  const userId = user?.id ?? 'anonymous';
  // Owner-/Admin-Override (8.2): unbegrenzt, KEINE irreführende Nutzungsanzeige,
  // KEIN Druck-Upgrade-CTA — Billing bleibt neutral sichtbar (8.4b-Vorgabe).
  const isOwner = user?.id === OWNER_USER_ID;

  const search = useSearch({ strict: false }) as { session_id?: string };
  const sessionId = typeof search?.session_id === 'string' ? search.session_id : undefined;

  const initialSub = getUserSubscription(userId);
  const [sub, setSub] = useState(initialSub);
  const [usage, setUsage] = useState<{
    used: number;
    remaining: number;
    limit: number;
    planTier: 'free' | 'pro';
  } | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);
  const [livePeriodEnd, setLivePeriodEnd] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeConfigured, setStripeConfigured] = useState<boolean | null>(null);

  // Server-Status laden (Phase 8.3): initial + wenn ein session_id zurückkommt
  // (Checkout abgeschlossen → Webhook ggf. noch unterwegs → manuell refreshen).
  // Zusätzlich (Phase 8.4b): Rechnungen (Stripe, ServerFn, sk_test) + Live-Periodenende.
  const refreshFromServer = useCallback(async () => {
    setRefreshing(true);
    try {
      const [status, overview] = await Promise.all([
        getSubscriptionStatus(),
        getBillingOverview(),
      ]);
      if (status.signedIn && userId !== 'anonymous') {
        const next = {
          userId,
          tier: status.tier,
          status: status.status,
          stripeCustomerId: status.stripeCustomerId,
          stripeSubscriptionId: status.stripeSubscriptionId,
          currentPeriodEnd: status.currentPeriodEnd
            ? new Date(status.currentPeriodEnd)
            : undefined,
        };
        setUserSubscription(userId, next);
        setSub(next);
      }
      setUsage(
        status.usage
          ? {
              used: status.usage.used,
              remaining: status.usage.remaining,
              limit: status.usage.limit,
              planTier: status.usage.planTier,
            }
          : null,
      );
      if (status.stripeConfigured !== undefined) setStripeConfigured(status.stripeConfigured);
      if (overview.signedIn) {
        setInvoices(overview.invoices);
        setInvoicesError(overview.error);
        setLivePeriodEnd(overview.currentPeriodEnd);
      }
    } catch {
      // kein Key/Session → Store-Fallback (bisheriges Verhalten)
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    refreshFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stripeReady = stripeConfigured ?? isStripeConfigured();

  const handleManageBilling = async () => {
    setPortalLoading(true);
    setError(null);
    try {
      const result = await createPortalSession({
        data: { userId },
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
    track('upgrade_clicked', user?.id, { source: 'billing' });
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
  // Server-Zähler bevorzugt (echte Free-5/Pro-200); Fallback Client-Store.
  const used = usage?.used ?? 0;
  const limit = usage?.limit ?? getGenerationLimit(sub.tier);
  const remaining = usage?.remaining ?? getRemainingGenerations(userId);
  const usagePercent =
    limit <= 0 || !isFinite(limit) ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const isProLimit = usage?.planTier === 'pro' || (!usage && sub.tier === 'pro');

  // Periodenende: live aus Stripe (Item-Pfad, dahlia — heilt die bekannte
  // current_period_end-NULL-Einschränkung in der ANZEIGE); Fallback DB-Wert.
  const shownPeriodEnd = livePeriodEnd
    ? new Date(livePeriodEnd)
    : sub.currentPeriodEnd;

  const statusLabel = (s: string): string =>
    s === 'active'
      ? t.billing_status_active
      : s === 'cancelled'
        ? t.billing_status_cancelled
        : s === 'expired'
          ? t.billing_status_expired
          : s;

  const invoiceStatusLabel = (s: string): string =>
    s === 'paid'
      ? t.billing_invoice_paid
      : s === 'open'
        ? t.billing_invoice_open
        : s === 'void'
          ? t.billing_invoice_void
          : s;

  const invoiceStatusClass = (s: string): string => {
    if (s === 'paid') return 'bg-emerald-100 text-emerald-700';
    if (s === 'open') return 'bg-amber-100 text-amber-700';
    if (s === 'void' || s === 'uncollectible') return 'bg-gray-100 text-gray-500';
    return 'bg-gray-100 text-gray-600';
  };

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

      {/* Payment pending after checkout (session_id present, but webhook not there yet) */}
      {sessionId && !isPro && !isOwner && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-sm font-medium text-blue-800">{t.billing_session_pending}</p>
          <p className="mt-1 text-xs text-blue-600">{t.billing_session_pending_desc}</p>
          <button
            type="button"
            onClick={refreshFromServer}
            disabled={refreshing}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition-all hover:bg-blue-100 disabled:opacity-60"
          >
            {refreshing ? t.common_loading : t.billing_refresh_status}
          </button>
        </div>
      )}

      <div className={`grid gap-6 ${isOwner ? '' : 'lg:grid-cols-2'}`}>
        {/* Current Plan */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">{t.billing_current_plan}</h2>
            <button
              type="button"
              onClick={refreshFromServer}
              disabled={refreshing}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 transition-all hover:bg-gray-100 disabled:opacity-60"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4.5 9A8 8 0 0119 7.5M19.5 15A8 8 0 015 16.5" />
              </svg>
              {refreshing ? t.common_loading : t.billing_refresh_status}
            </button>
          </div>

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
              {statusLabel(sub.status)}
            </span>
          </div>

          <p className="mt-3 text-sm text-gray-600">
            {isPro
              ? t.billing_pro_desc
              : t.billing_free_desc}
          </p>

          {isPro && shownPeriodEnd && (
            <p className="mt-2 text-xs text-gray-400">
              {t.billing_period_ends}{' '}
              {formatDate(shownPeriodEnd, locale)}
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
            ) : !isPro && !isOwner ? (
              // Owner-Override (8.4b-Vorgabe): KEIN Druck-Upgrade-CTA für den Owner.
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

        {/* Usage Stats — Owner bewusst KEINE Nutzungsanzeige (8.4a-Vorgabe, unbegrenzt) */}
        {!isOwner ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900">{t.billing_usage_title}</h2>

            <div className="mt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600">
                  {t.billing_generations}
                </span>
                <span className="text-sm font-semibold text-gray-900">
                  {t.billing_usage_of.replace('%s', String(used)).replace('%s', String(limit))}
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
                  style={{ width: `${usagePercent}%` }}
                />
              </div>

              <p className="mt-2 text-xs text-gray-400">
                {remaining === 0
                  ? t.billing_limit_used_up
                  : remaining === 1
                    ? t.billing_remaining_singular.replace('%d', String(remaining))
                    : t.billing_remaining_plural.replace('%d', String(remaining))}
              </p>

              {isProLimit && (
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
        ) : null}
      </div>

      {/* Billing History (Phase 8.4b: echte Stripe-Invoices, Testmodus) */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">{t.billing_history_title}</h2>

        {invoices === null && invoicesError === null ? (
          <p className="mt-4 text-sm text-gray-400">{t.common_loading}</p>
        ) : invoicesError && invoices?.length === 0 ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-800">{t.billing_invoices_error}</p>
          </div>
        ) : invoices && invoices.length === 0 ? (
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
        ) : invoices ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-4 font-semibold">{t.billing_invoice_date}</th>
                  <th className="py-2 pr-4 font-semibold">{t.billing_invoice_number}</th>
                  <th className="py-2 pr-4 font-semibold">{t.billing_invoice_period}</th>
                  <th className="py-2 pr-4 font-semibold">{t.billing_invoice_amount}</th>
                  <th className="py-2 pr-4 font-semibold">{t.billing_invoice_status}</th>
                  <th className="py-2 font-semibold">{t.billing_invoice_pdf}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-gray-100 last:border-0">
                    <td className="whitespace-nowrap py-3 pr-4 text-gray-600">
                      {formatDate(new Date(inv.created * 1000), locale)}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-medium text-gray-900">
                        {inv.number ?? inv.id.slice(0, 12)}
                      </span>
                      {inv.description ? (
                        <span className="block max-w-[26ch] truncate text-xs text-gray-400">
                          {inv.description}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4 text-xs text-gray-500">
                      {inv.periodStart
                        ? `${formatDate(new Date(inv.periodStart * 1000), locale)} – ${formatDate(new Date(inv.periodEnd ? inv.periodEnd * 1000 : inv.periodStart * 1000), locale)}`
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4 font-medium text-gray-900">
                      {formatMoney(inv.amountPaid, inv.currency, locale)}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${invoiceStatusClass(inv.status)}`}
                      >
                        {invoiceStatusLabel(inv.status)}
                      </span>
                    </td>
                    <td className="py-3">
                      {inv.hostedInvoiceUrl ? (
                        <a
                          href={inv.hostedInvoiceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-600 transition-all hover:bg-gray-100"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          {t.billing_invoice_pdf}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
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