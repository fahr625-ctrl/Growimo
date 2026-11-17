// ── „Kein KI-Anbieter eingerichtet" — eigener, ehrlicher Fehlerpfad ──────────
// Belegter Fall (2026-11-17, Vorschau): In der Umgebung fehlt `OPENAI_API_KEY`
// (Vercel-Target Preview), der Lauf bricht mit `[generate] Configured providers:
// 0` ab — der Nutzer sah aber nur die allgemeine Meldung „Kein brauchbares
// Ergebnis" (`results_quality_failed_title`) und musste annehmen, sein Prompt
// sei schuld. Das ist eine falsche Entlastung: Es war keine Qualitätsfrage,
// sondern eine fehlende Einrichtung.
//
// Dieses Modul ist die EINE Wahrheit darüber, wann ein Fehler „hier ist gar
// kein KI-Anbieter eingerichtet" bedeutet — und wann NICHT (echte
// Qualitätsfehler wie Absage/unvollständiges Ergebnis behalten ihre Meldung).
//
// Client-sicher: reine Konstanten/String-Funktionen, keine Node-/DB-Importe.
// Damit läuft dieselbe Erkennung im Serverless-Runtime UND im Browser-Bundle
// (der Code passiert die ServerFn-/Stream-Grenze als `code` UND als Marker in
// der Meldung — der Marker ist die Rückfallebene, falls eine Grenze den
// eigenen Feldern den Transport abschneidet).

/** Fehlerklasse für Stream-Events und Client (GROSS = Fehlerklasse). */
export const PROVIDER_NOT_CONFIGURED_CODE = 'NO_AI_PROVIDER_CONFIGURED';

/** Technischer Marker in der Fehlermeldung — bleibt in der Konsole. */
export const PROVIDER_NOT_CONFIGURED_MARKER = '[no-ai-provider]';

/**
 * Technische Meldung (Server-Protokoll/Konsole). Sie nennt die Ursache und den
 * Betreiber-Hinweis; der Nutzer sieht stattdessen den i18n-Text
 * `results_provider_missing_*`.
 */
export function providerNotConfiguredMessage(): string {
  return (
    `${PROVIDER_NOT_CONFIGURED_MARKER} Kein KI-Anbieter konfiguriert ` +
    '(Configured providers: 0). OPENAI_API_KEY fehlt in dieser Umgebung — ' +
    'Betreiber informieren.'
  );
}

export class ProviderNotConfiguredError extends Error {
  readonly code = PROVIDER_NOT_CONFIGURED_CODE;

  constructor(message: string = providerNotConfiguredMessage()) {
    super(message);
    this.name = 'ProviderNotConfiguredError';
  }
}

/** Trägt diese (auch fremde/serialisierte) Meldung den Marker? */
export function isProviderNotConfiguredMessage(message: unknown): boolean {
  if (typeof message !== 'string' || message.length === 0) return false;
  return (
    message.includes(PROVIDER_NOT_CONFIGURED_MARKER) ||
    // Alttexte/Provider-Meldungen ohne Marker (gleiche Ursache):
    /OPENAI_API_KEY is not configured/i.test(message) ||
    /Kein KI-Anbieter konfiguriert/i.test(message)
  );
}

/**
 * Ist das der „kein Anbieter eingerichtet"-Fall? Erkennt das typisierte Objekt,
 * den `code` über eine Transportgrenze und — als Rückfallebene — den Marker in
 * der Meldung. Echte Qualitätsfehler (REFUSAL/INCOMPLETE) sind bewusst NICHT
 * enthalten.
 */
export function isProviderNotConfigured(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof ProviderNotConfiguredError) return true;
  if (typeof err !== 'object') return isProviderNotConfiguredMessage(err);
  const candidate = err as { code?: unknown; name?: unknown; message?: unknown };
  if (candidate.code === PROVIDER_NOT_CONFIGURED_CODE) return true;
  if (candidate.name === 'ProviderNotConfiguredError') return true;
  return isProviderNotConfiguredMessage(candidate.message);
}
