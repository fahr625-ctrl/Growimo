/**
 * UI-Neuausrichtung — Owner-Vorgabe 2026-11-12 (SPEC Teil A).
 * ============================================================================
 * Growimo ist keine Marketingstrategie-Plattform mehr: drei Funktionen, drei
 * fertige Ergebnisse (Pinterest-Pin, Etsy-Listing, TikTok-Skript).
 *
 * Alle Schalter hier sind reine ANZEIGE-Schalter. Nichts wird gelöscht:
 * Prompts, ContentTypes, DB-Zeilen, gespeicherte Projekte und die alten
 * Module bleiben vollständig erhalten und lesbar — sie werden nur nicht mehr
 * angeboten. `true` → `false` holt jede Ansicht in einer Zeile zurück.
 */

/** Gesamt-Schalter des Drei-Funktionen-Konzepts. */
export const UI_NEUAUSRICHTUNG_ENABLED = true;

/**
 * Strategie-Score-Texte (Marketing-Score, „Strategie-Erfüllungsgrad",
 * Score-Umfangshinweis im Erstell-Flow). Sie beschreiben eine
 * Strategie-Bewertung, die es im Drei-Funktionen-Konzept nicht mehr gibt.
 */
export const SHOW_STRATEGY_SCORE_TEXTS = !UI_NEUAUSRICHTUNG_ENABLED;

/**
 * Beratungs-Panels (Marketing-Coach, Mission, KI-Empfehlungen,
 * Performance-Scores). Ratschläge statt fertiger Ergebnisse.
 */
export const SHOW_ADVICE_PANELS = !UI_NEUAUSRICHTUNG_ENABLED;

/**
 * Alte Werkzeug-Kachelreihe (Blog, Kalender, Performance, doppelte
 * Pinterest-/Etsy-Einstiege). Doppelte Einstiegspunkte entfallen, die Seiten
 * selbst bleiben erreichbar.
 */
export const SHOW_LEGACY_TOOLS_GRID = !UI_NEUAUSRICHTUNG_ENABLED;

/**
 * A/B-Varianten: nur dort, wo die Funktion tatsächlich ein Ergebnis liefert.
 * Etsy (Listing-Texte mit 13 Tags + Mockup) und das TikTok-Skript haben keine
 * Varianten-Ebene — dort wird der Button per Flag ausgeblendet, nicht gelöscht.
 */
const AB_VARIANT_CONTENT_TYPES: readonly string[] = ['pinterest_pin'];

export function showAbVariantsFor(contentType: string): boolean {
  if (!UI_NEUAUSRICHTUNG_ENABLED) return true;
  return AB_VARIANT_CONTENT_TYPES.includes(contentType);
}
