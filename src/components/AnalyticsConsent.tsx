// ── Phase Analytics-Erweiterung (Owner-Auftrag 2026-09-27): Consent-Gate ─────
// Kleine, NICHT blockierende Einwilligungs-Abfrage für die eindeutige
// Besucherkennung. Sie erscheint nur, solange keine Entscheidung gespeichert ist
// (`growimo_consent_analytics`), legt kein Overlay über die Seite und
// unterbricht nichts: bestehendes Tracking (pageviews/Fehler, HMAC-Pseudonym
// für Eingeloggte) läuft unverändert weiter.
//
// Rechtsgrundlage: siehe src/lib/analytics-consent.ts + Evidenz-Dokument
// (TTDSG §25 Abs. 1 / ePrivacy Art. 5(3) — Kennung ist nicht „unbedingt
// erforderlich" ⇒ Einwilligung Pflicht). Das Speichern der Entscheidung selbst
// ist consent-frei.
import { useEffect, useState } from 'react';
import { useTranslation } from '~/i18n';
import { getAnalyticsConsent, setAnalyticsConsent } from '~/lib/analytics-consent';

export function AnalyticsConsent() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  // Erst nach der Hydration lesen (SSR kennt localStorage nicht) — kein
  // Hydration-Mismatch, keine Flackerei.
  useEffect(() => {
    setVisible(getAnalyticsConsent() === 'undecided');
  }, []);

  if (!visible) return null;

  const decide = (value: 'yes' | 'no') => {
    setAnalyticsConsent(value);
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label={t.consent_analytics_title}
      className="fixed bottom-3 left-3 z-40 max-w-sm rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur"
    >
      <p className="text-sm font-semibold text-gray-900">{t.consent_analytics_title}</p>
      <p className="mt-1 text-xs text-gray-600">{t.consent_analytics_text}</p>
      <p className="mt-1 text-[11px] text-gray-400">{t.consent_analytics_note}</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => decide('yes')}
          className="rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          {t.consent_analytics_accept}
        </button>
        <button
          type="button"
          onClick={() => decide('no')}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
        >
          {t.consent_analytics_decline}
        </button>
      </div>
    </div>
  );
}
