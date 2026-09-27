// ── Phase Analytics-Erweiterung (Owner-Auftrag 2026-09-27): Fehleranalyse ────
// Rein client-sichere, deterministische Klassifizierung eines Generierungs-
// Fehlers in ZWEI kurze technische Felder:
//   error_category — Whitelist (siehe ANALYTICS_ERROR_CATEGORIES)
//   error_code     — kurzer technischer Code, strikt `^[a-z0-9]([a-z0-9_.:-]{0,39})$`
//
// Datenschutz-Vertrag (Owner-Vorgabe): Es werden NIE Fehlermeldungen,
// Stacktraces, Prompts, Produktideen oder sonstige Nutzerinhalte übertragen —
// nur die zwei Kurzfelder. `classifyGenerationError` liest die Meldung lediglich
// im Speicher, um Kategorie/Code ABZULEITEN; die Meldung selbst verlässt den
// Client nicht.
//
// WICHTIG: dieses Modul läuft im Browser-Bundle — es darf NICHTS aus dem
// Server-Graph importieren (kein `node:crypto`, keine DB, nicht
// `lib/usage-guard.ts`, das `api/tracking` + DB-Queries zieht). UsageLimitError/
// RateLimitError werden deshalb strukturell über `name`/`code` erkannt
// (die beiden Klassen setzen diese Werte explizit).

/** Erlaubte Fehlerkategorien (Owner-Whitelist). `unknown` = nicht erfasst. */
export const ANALYTICS_ERROR_CATEGORIES = [
  'timeout',
  'provider',
  'quota',
  'rate_limit',
  'validation',
  'network',
  'aborted',
  'server',
  'unknown',
] as const;

export type AnalyticsErrorCategory = (typeof ANALYTICS_ERROR_CATEGORIES)[number];

/** Strikte Code-Form: beginnt alphanumerisch, danach [a-z0-9_.:-], max. 40 Zeichen. */
export const ANALYTICS_ERROR_CODE_RE = /^[a-z0-9]([a-z0-9_.:-]{0,39})$/;

export function isAnalyticsErrorCategory(v: unknown): v is AnalyticsErrorCategory {
  return typeof v === 'string' && (ANALYTICS_ERROR_CATEGORIES as readonly string[]).includes(v);
}

export function isAnalyticsErrorCode(v: unknown): v is string {
  return typeof v === 'string' && ANALYTICS_ERROR_CODE_RE.test(v);
}

export interface ErrorClassification {
  category: AnalyticsErrorCategory;
  code: string;
}

/** Fallback, wenn nichts sicheres ableitbar ist (nie raten). */
export const UNKNOWN_ERROR_CLASSIFICATION: ErrorClassification = {
  category: 'unknown',
  code: 'unknown',
};

function rawMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || '';
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    if (typeof o.message === 'string') return o.message;
  }
  return '';
}

/**
 * Leitet Kategorie + Code aus den bereits vorhandenen Signalen ab:
 * Guard-Grund (user/timeout), UsageLimitError, RateLimitError, HTTP-Status in
 * der Meldung, Netzwerk-/Abort-Muster, TanStack-ServerFn-Details (.cause/.data).
 * Deterministisch, keine Nutzertexte im Ergebnis.
 *
 * @param err     der gefangene Fehler (Meldung wird NICHT gesendet)
 * @param reason  optionaler Guard-Grund ('user' | 'timeout') — gewinnt, weil er
 *                den Abbruch/-Timeout sicher belegt.
 */
export function classifyGenerationError(
  err: unknown,
  reason?: 'user' | 'timeout' | null,
): ErrorClassification {
  // 1) Guard-Gründe (höchste Sicherheit: Timeout/Abbruch sind belegt).
  if (reason === 'timeout') return { category: 'timeout', code: 'client_timeout' };
  if (reason === 'user') return { category: 'aborted', code: 'user_abort' };

  // 2) Typisierte Usage-Fehler (Kontingent / Drossel) — strukturell erkannt
  //    (UsageLimitError.code = 'USAGE_LIMIT', RateLimitError.code = 'RATE_LIMIT').
  const errName = err && typeof err === 'object' ? (err as { name?: unknown }).name : null;
  const errCode = err && typeof err === 'object' ? (err as { code?: unknown }).code : null;
  if (errCode === 'USAGE_LIMIT' || errName === 'UsageLimitError') {
    return { category: 'quota', code: 'usage_limit' };
  }
  if (errCode === 'RATE_LIMIT' || errName === 'RateLimitError') {
    return { category: 'rate_limit', code: 'rate_limit' };
  }

  const msg = rawMessage(err);
  const lower = msg.toLowerCase();

  // 3) Abbruch/Timeout über den Fehlernamen (AbortController).
  if (errName === 'AbortError' || lower.includes('aborted')) {
    return { category: 'aborted', code: 'abort_error' };
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { category: 'timeout', code: 'client_timeout' };
  }

  // 4) HTTP-Status — NUR als Code extrahiert (nie die Meldung selbst).
  const http5 = msg.match(/\b(5\d\d)\b/);
  if (http5) return { category: 'server', code: `http_${http5[1]}` };
  if (/\b429\b/.test(msg)) return { category: 'rate_limit', code: 'http_429' };
  const http4 = msg.match(/\b(401|403|404|400)\b/);
  if (http4) return { category: 'provider', code: `http_${http4[1]}` };

  // 5) Netzwerk.
  if (
    lower.includes('fetch failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('econn') ||
    lower.includes('enotfound') ||
    lower.includes('network') ||
    lower.includes('socket')
  ) {
    return { category: 'network', code: 'network_error' };
  }

  // 6) Validierung (ServerFn-Ablehnung / ungültige Eingabe).
  const hasDetail =
    err !== null &&
    typeof err === 'object' &&
    ('cause' in (err as object) || 'data' in (err as object));
  if (hasDetail || lower.includes('validation') || lower.includes('invalid')) {
    return { category: 'validation', code: 'invalid_input' };
  }

  // 7) Keine sichere Ableitung → ehrlich „unknown" (nie raten).
  return { ...UNKNOWN_ERROR_CLASSIFICATION };
}
