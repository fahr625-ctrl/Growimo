// ── Phase 8.4a — Rest-Anzeige + Limit-Banner im Dashboard ──────────────────────
// Zeigt dem angemeldeten Nutzer sein Monatskontingent (Free 5 / Pro 200):
//   1. Rest-Anzeige („X von Y Generierungen verbleibend") als kompakte Kennzahl
//      über dem Seiteninhalt (Header-Zone aller /app-Seiten).
//   2. Limit-Banner (role=status, a11y) sobald remaining === 0: „Monatslimit
//      erreicht (X/Y)" mit Tarif-Hinweis und Upgrade-CTA als Platzhalter-Link
//      zur Pricing-Seite (KEIN Stripe-Checkout-Link — Checkout ist erst in der
//      8.3-Checkout-Phase produktiv).
// Quelle ist die ServerFunction getSubscriptionStatus (8.3, nutzt den
// 8.2-Usage-Guard getUsageInfo) — keine neue Datenquelle.
// FIX-BLOCK 1 (Owner-Auftrag 2026-10-08): Diese Anzeige liest den Server-Wert
// jetzt über den gemeinsamen Client-Hook `useServerUsage` (src/lib/usage-client.ts)
// — DIESELBE Quelle wie die Kosten-Hinweise und die Vorab-Prüfungen. Ein
// eigenständiger lokaler Zähler existiert nicht mehr, deshalb kann die Anzeige
// nicht mehr von der DB abweichen (live belegter Bug: „2 von 5 verbleibend"
// während die DB 5/5 hatte).
// Owner-/Admin-Override (harte Clerk-ID): bewusst KEINE Anzeige (Vorgabe 8.2).
// Neu geladen wird beim Mount, bei jeder Routenänderung, bei Fenster-Fokus und
// nach jedem Verbrauch (`growimo:usage-refresh`) — der Wert ist damit immer der
// DB-Stand, auch direkt nach einer Generierung.
import { Link } from '@tanstack/react-router';
import { useTranslation } from '~/i18n';
import { useServerUsage } from '~/lib/usage-client';

export function UsageStatus({ userId }: { userId?: string }) {
  const { t } = useTranslation();
  const { usage, isOwner } = useServerUsage(userId);

  // Owner-/Admin-Override: KEINE Zähler-Anzeige, KEIN Banner (Vorgabe aus 8.2 —
  // die Ausnahme ist bewusst unsichtbar).
  if (!userId || isOwner) return null;
  // Noch nicht geladen oder Fehler → nichts anzeigen (kein geratener Wert).
  if (usage === null) return null;

  const limitReached = usage.remaining <= 0 && usage.limit > 0;
  const remainingText =
    usage.remaining === 1
      ? t.usage_remaining_singular
        .replace('%d', String(usage.remaining))
        .replace('%d', String(usage.limit))
      : t.usage_remaining_plural
        .replace('%d', String(usage.remaining))
        .replace('%d', String(usage.limit));

  if (limitReached) {
    const countLabel = t.usage_banner_count
      .replace('%d', String(usage.used))
      .replace('%d', String(usage.limit));
    return (
      <div
        role="status"
        aria-live="polite"
        className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <svg
              className="mt-0.5 h-5 w-5 shrink-0 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p className="text-sm font-bold text-red-800">
                {t.usage_banner_title} <span className="font-semibold">{countLabel}</span>
              </p>
              <p className="mt-0.5 text-sm text-red-700">
                {usage.planTier === 'pro' ? t.usage_banner_pro : t.usage_banner_free}
              </p>
            </div>
          </div>
          {usage.planTier === 'free' ? (
            <Link
              to="/app/pricing"
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-red-700"
            >
              {t.usage_banner_upgrade}
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ) : (
            <Link
              to="/app/pricing"
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-all hover:bg-red-100"
            >
              {t.usage_banner_plans}
            </Link>
          )}
        </div>
      </div>
    );
  }

  // Rest-Anzeige (kompakte Kennzahl in der Header-Zone des Dashboards).
  const low = usage.remaining <= 2;
  return (
    <div className="mb-5 flex items-center justify-end">
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm ${
          low
            ? 'border-amber-200 bg-amber-50 text-amber-700'
            : 'border-gray-200 bg-white text-gray-600'
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${low ? 'bg-amber-500' : 'bg-emerald-500'}`}
          aria-hidden="true"
        />
        {remainingText}
      </span>
    </div>
  );
}