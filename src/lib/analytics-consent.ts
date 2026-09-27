// ── Phase Analytics-Erweiterung (Owner-Auftrag 2026-09-27): Consent-Gate ─────
// Einwilligung für die EINDEUTIGE Besucherkennung (Cookie `growimo_vid`).
//
// Rechtslage (TTDSG § 25 Abs. 1 / ePrivacy Art. 5(3)): das Speichern einer
// eindeutigen Kennung im Endgerät ist NICHT „unbedingt erforderlich" (§ 25
// Abs. 2 Nr. 2 greift für Analytics nicht) → Einwilligung ist Pflicht. Deshalb
// wird die Kennung ausschließlich bei ausdrücklicher Zustimmung gesetzt.
// Das Speichern der Entscheidung selbst ('yes'/'no') ist die von der
// Einwilligung getragene Pflicht zur Einhaltung der Entscheidung — kein
// weiteres Consent nötig (Standard-Praxis, siehe Evidenz-Dokument Phase 0).
//
// Datenminimierung: die Kennung ist eine zufällige UUID (keine IP, kein
// Fingerprinting, keine personenbezogenen Daten). BESTEHENDES Tracking
// (pageview/error-Events, HMAC-Pseudonym für Eingeloggte, Rate-Limit) läuft
// unverändert weiter — unabhängig von dieser Entscheidung. Nur die NEUE
// eindeutige Anonym-Kennung ist consent-pflichtig.
export const ANALYTICS_CONSENT_KEY = 'growimo_consent_analytics';

/** 'yes' | 'no' = getroffene Entscheidung, 'undecided' = noch nichts entschieden. */
export type AnalyticsConsent = 'yes' | 'no' | 'undecided';

/** Aktuelle Entscheidung (SSR-sicher; ohne localStorage → 'undecided'). */
export function getAnalyticsConsent(): AnalyticsConsent {
  try {
    if (typeof localStorage === 'undefined') return 'undecided';
    const v = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return v === 'yes' || v === 'no' ? v : 'undecided';
  } catch {
    return 'undecided';
  }
}

/** Entscheidung speichern (das Speichern selbst ist consent-frei, s. o.). */
export function setAnalyticsConsent(value: 'yes' | 'no'): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
  } catch {
    // localStorage kann blockiert sein (Privatmodus) — dann bleibt es bei
    // 'undecided' → keine Kennung, kein Cookie. Fail-closed.
  }
}

/**
 * Header-Wert für den Schreib-Endpunkt: nur 'granted' erlaubt serverseitig das
 * Setzen des Besucher-Cookies. Bei 'undecided'/'no' wird KEIN Header gesendet
 * (fail-closed: kein Header = keine Kennung).
 */
export function analyticsConsentHeader(): Record<string, string> {
  return getAnalyticsConsent() === 'yes' ? { 'x-analytics-consent': 'granted' } : {};
}
