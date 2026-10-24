// ── Owner-Vorgabe 2026-10-23 (Rechtstexte-Review): einfacher Widerruf ─────────
// Sichtbarer Schalter in der Datenschutzerklärung (§ 4.2), mit dem die
// Reichweitenmessung mit EINEM Klick deaktiviert und wieder aktiviert werden
// kann — ohne Browser-Einstellungen, ohne Login.
//
// Wirkung (siehe src/lib/analytics-consent.ts):
//   • localStorage-Flag `growimo_analytics_optout` = 'true'
//   • Einwilligung für die Besucherkennung wird auf 'no' gesetzt → es wird kein
//     `x-analytics-consent`-Header mehr gesendet, also serverseitig kein
//     `growimo_vid`-Cookie mehr gesetzt (fail-closed).
//   • src/lib/analytics-client.ts sendet keine Analyse-Ereignisse mehr.
//   • src/components/VercelAnalytics.tsx lädt @vercel/analytics nicht mehr.
//
// SSR-sicher: der gespeicherte Zustand wird erst nach der Hydration gelesen
// (kein Hydration-Mismatch). Der Schalter selbst wird immer gerendert, damit
// er auch ohne JavaScript-Zustand sichtbar und testbar ist.
import { useEffect, useState } from 'react';
import { useTranslation } from '~/i18n';
import { isAnalyticsOptedOut, setAnalyticsOptOut } from '~/lib/analytics-consent';

export function AnalyticsOptOut() {
  const { t } = useTranslation();
  /** null = noch nicht gelesen (SSR/erster Render). */
  const [optedOut, setOptedOut] = useState<boolean | null>(null);

  useEffect(() => {
    setOptedOut(isAnalyticsOptedOut());
  }, []);

  const active = optedOut === true;

  const toggle = () => {
    const next = !active;
    setAnalyticsOptOut(next);
    setOptedOut(next);
  };

  return (
    <div
      data-testid="analytics-optout"
      className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4"
    >
      <p className="text-sm font-semibold text-gray-900">{t.legal_privacy_optout_heading}</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-600">{t.legal_privacy_optout_text}</p>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={active}
        data-testid="analytics-optout-button"
        className="mt-3 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-100"
      >
        {active ? t.legal_privacy_optout_enable : t.legal_privacy_optout_disable}
      </button>
      <p
        data-testid="analytics-optout-state"
        aria-live="polite"
        className="mt-2 text-xs font-medium text-gray-700"
      >
        {optedOut === null
          ? ''
          : active
            ? t.legal_privacy_optout_state_off
            : t.legal_privacy_optout_state_on}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
        {t.legal_privacy_optout_note}
      </p>
    </div>
  );
}
