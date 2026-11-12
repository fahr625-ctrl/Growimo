// ── Phase 1 (Owner-Freigabe 2026-11-11): Verweigerungs- und Strukturprüfung ───
// Der Fehler, der alles andere überholt hat (Owner-Befund 2026-11-11):
// Im Pinterest-Modul stand „Es tut mir leid, aber ich kann diese Anfrage nicht
// weiter bearbeiten." — und Growimo zeigte trotzdem grün „Generiert". Ursache:
// „Erfolg" hieß im Code nur „Antwort ist nicht leer". Eine Absage ist nicht
// leer, also Erfolg. Credit weg, Status grün.
//
// Dieses Modul ist die EINE Wahrheit darüber, ob eine Modellantwort ein
// brauchbares Ergebnis ist. Es wird an drei Stellen benutzt:
//   1. `ai/providers/openai.ts` — direkt nach der Rohantwort (Absage erkennen,
//      bevor ein Parser aus der Absage einen „Titel" bastelt),
//   2. `ai/generate.ts` — als Gate mit EINEM Wiederholungsversuch,
//   3. `routes/app/new-project.tsx` — als Anzeige-Gate (kein grüner Status
//      ohne bestandene Prüfung).
//
// Client-sicher: reine String-Funktionen, keine Node-/DB-Importe. Damit läuft
// dieselbe Prüfung im Serverless-Runtime UND im Browser-Bundle.
import type { ContentType } from '~/ai/types';

/** Kurzform der Fehlerart (nur technische Schlüssel, NIE Inhalte). */
export type QualityCode = 'refusal' | 'incomplete';

/** Strukturelle Fehler-Codes für Stream-Events/Client (GROSS = Fehlerklasse). */
export const QUALITY_ERROR_REFUSAL = 'REFUSAL';
export const QUALITY_ERROR_INCOMPLETE = 'INCOMPLETE';

/** Deutsche Klartext-Meldung je Fehlerart (der Client übersetzt selbst). */
const QUALITY_MESSAGES: Record<QualityCode, string> = {
  refusal: 'Die KI hat diese Anfrage abgelehnt. Es wurde nichts berechnet.',
  incomplete: 'Die KI hat ein unvollständiges Ergebnis geliefert. Es wurde nichts berechnet.',
};

/**
 * Typisierter Fehler „Ergebnis nicht brauchbar". `code` ist der strukturelle
 * Marker ('REFUSAL' | 'INCOMPLETE'), `violations` enthält ausschließlich
 * technische Schlüssel (z. B. 'empty_body', 'fallback_title') — niemals
 * Nutzer- oder Modellinhalte.
 */
export class GenerationQualityError extends Error {
  readonly code: string;
  readonly qualityCode: QualityCode;
  readonly violations: string[];

  constructor(qualityCode: QualityCode, violations: string[] = []) {
    super(QUALITY_MESSAGES[qualityCode]);
    this.name = 'GenerationQualityError';
    this.qualityCode = qualityCode;
    this.code = qualityCode === 'refusal' ? QUALITY_ERROR_REFUSAL : QUALITY_ERROR_INCOMPLETE;
    this.violations = violations;
  }
}

/** Ist der Fehler eine fehlgeschlagene Qualitätsprüfung (Absage/unvollständig)? */
export function isQualityError(err: unknown): err is GenerationQualityError {
  return (
    err instanceof GenerationQualityError ||
    (!!err &&
      typeof err === 'object' &&
      (err as { name?: unknown }).name === 'GenerationQualityError')
  );
}

// ── Verweigerungserkennung ────────────────────────────────────────────────────
// Muster aus dem belegten Echfall vom 2026-11-11 plus die üblichen Formen.
// Absichtlich eng gefasst: gesucht wird die ABSAGE, nicht jedes Vorkommen von
// „leider". Eine Absage ist kurz; ein langes Ergebnis, das zufällig einen der
// Sätze enthält, wird nur geprüft, wenn der Satz am ANFANG steht.
const REFUSAL_PATTERNS: readonly RegExp[] = [
  // Deutsch
  /es tut mir leid,?\s*aber ich kann/i,
  /es tut mir leid,?\s*aber ich (darf|werde|möchte)/i,
  /ich kann (diese|deine|ihre|die) anfrage nicht (weiter)?\s*bearbeiten/i,
  /ich kann (diese|die) (aufgabe|anfrage|bitte|anweisung) (leider )?nicht/i,
  /ich kann (dir|ihnen|euch) (dabei|hierbei|damit) (leider )?nicht helfen/i,
  /ich kann (diese|solche) inhalte nicht (erstellen|erzeugen|liefern)/i,
  /als (ki|ki-?sprachmodell|sprachmodell) kann ich/i,
  /dafür bin ich nicht (ausgelegt|geeignet)/i,
  // Englisch
  /i'?m sorry,? but i (can'?t|cannot|am unable)/i,
  /i apologi[sz]e,? but i (can'?t|cannot|am unable)/i,
  /i (can'?t|cannot|am unable to) (help|assist) with (that|this|your)/i,
  /unable to (comply|assist) with (this|that) request/i,
  /as an ai( language model)?,? i (can'?t|cannot)/i,
];

/** Ab dieser Länge gilt ein Text nicht mehr als bloße Absage. */
const REFUSAL_MAX_LEN = 600;
/** Der Anfang eines Textes wird immer geprüft (auch bei langen Antworten). */
const REFUSAL_HEAD_LEN = 240;

/**
 * Ist dieser Text eine Absage des Modells?
 * Zwei Wege: (a) der Text BEGINNT mit einer Absage-Formel, oder (b) er ist kurz
 * genug, um eine reine Absage zu sein, und enthält eine solche Formel.
 */
export function isRefusalText(text: string | null | undefined): boolean {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  const head = trimmed.slice(0, REFUSAL_HEAD_LEN);
  if (REFUSAL_PATTERNS.some((re) => re.test(head))) return true;
  if (trimmed.length <= REFUSAL_MAX_LEN && REFUSAL_PATTERNS.some((re) => re.test(trimmed))) {
    return true;
  }
  return false;
}

// ── Strukturprüfung ──────────────────────────────────────────────────────────
/** Platzhalter-Titel, die `parseResponse` als Fallback setzt (= nichts erkannt). */
const FALLBACK_TITLES = ['pin-titel', 'etsy-listing', 'blog-artikel', 'untitled'];

/** Mindestlänge des Fließtexts je Kanal (bewusst niedrig: nur „leer" abfangen). */
const MIN_BODY_LEN: Partial<Record<ContentType, number>> = {
  pinterest_pin: 200,
  etsy_listing: 200,
  seo_blog: 400,
  marketing_plan: 300,
  product_idea: 150,
  email_newsletter: 150,
  social_post: 120,
};
const DEFAULT_MIN_BODY_LEN = 120;

/** Ab so vielen eckigen Klammern gilt der Prompt als abgeschrieben (Template-Echo). */
const TEMPLATE_ECHO_LIMIT = 3;

export interface QualityCheck {
  ok: boolean;
  /** null = bestanden. */
  code: QualityCode | null;
  /** Technische Schlüssel, nie Inhalte. */
  violations: string[];
}

function metaList(metadata: Record<string, unknown> | undefined, key: string): unknown[] {
  const value = metadata?.[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Prüft ein Ergebnis gegen die Pflichtfelder seines Kanals:
 *   · Text nicht leer und nicht zu kurz,
 *   · Titel vorhanden und KEIN Parser-Fallback,
 *   · Absage erkannt (Text oder Titel),
 *   · kein abgeschriebener Prompt (Template-Platzhalter),
 *   · Pinterest: mindestens ein Fokus-Keyword,
 *   · Etsy: mindestens ein Tag.
 * Die 13-Tags-Regel ist NICHT Teil dieser Prüfung (Phase 3, Abschnitt 2 D).
 */
export function checkResultQuality(
  contentType: ContentType | string,
  result: { title?: string | null; body?: string | null; metadata?: Record<string, unknown> } | null | undefined,
): QualityCheck {
  if (!result) return { ok: false, code: 'incomplete', violations: ['no_result'] };

  const title = (result.title ?? '').trim();
  const body = (result.body ?? '').trim();
  const violations: string[] = [];

  // 1) Absage — hat Vorrang vor allem anderen (das ist der 11.11.-Fall).
  if (isRefusalText(body) || isRefusalText(title)) {
    return { ok: false, code: 'refusal', violations: ['refusal_text'] };
  }

  // 2) Text
  const minBody = MIN_BODY_LEN[contentType as ContentType] ?? DEFAULT_MIN_BODY_LEN;
  if (body.length === 0) violations.push('empty_body');
  else if (body.length < minBody) violations.push('body_too_short');

  // 3) Titel (nicht leer, kein Parser-Fallback)
  if (title.length === 0) violations.push('empty_title');
  else if (FALLBACK_TITLES.includes(title.toLowerCase())) violations.push('fallback_title');

  // 4) Abgeschriebener Prompt
  const bracketCount = (body.match(/\[[^\]\n]{1,60}\]/g) ?? []).length;
  if (bracketCount >= TEMPLATE_ECHO_LIMIT) violations.push('template_echo');

  // 5) Kanal-Pflichtfelder
  if (contentType === 'pinterest_pin' && metaList(result.metadata, 'keywords').length === 0) {
    violations.push('missing_keywords');
  }
  if (contentType === 'etsy_listing' && metaList(result.metadata, 'tags').length === 0) {
    violations.push('missing_tags');
  }

  return violations.length === 0
    ? { ok: true, code: null, violations: [] }
    : { ok: false, code: 'incomplete', violations };
}

/**
 * Zusatzregel für den EINEN Wiederholungsversuch: der Korrektur-Hinweis nennt
 * die konkrete Fehlerart, damit das Modell gezielt nachbessert. Zweisprachig,
 * weil der Server die UI-Sprache nicht kennt (Muster `context-loyalty`).
 */
export function qualityCorrection(check: QualityCheck): string {
  const reason =
    check.code === 'refusal'
      ? 'Deine letzte Antwort war eine Absage an die Aufgabe.'
      : `Deine letzte Antwort war unvollständig (${check.violations.join(', ')}).`;
  return [
    'WICHTIG — die vorige Antwort war nicht verwendbar:',
    reason,
    'Liefere jetzt die VOLLSTÄNDIGE Antwort exakt im geforderten Format, mit allen Pflichtabschnitten und ohne Platzhalter wie [1 Satz] oder [Beispiel].',
    '---',
    'IMPORTANT — the previous answer was unusable.',
    'Return the COMPLETE answer in exactly the requested format, with every required section and no placeholders such as [1 sentence] or [example].',
  ].join('\n');
}
