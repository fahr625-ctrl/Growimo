// ── F6 Strategie-Brief: Validierung/Normalisierung ────────────────────────────
// Der Brief ist optional und kommt aus Chips + optionalem Freitext. Normalisierung:
// unbekannte Schlüssel → ignorieren, nicht-leere String-Werte → behalten.
// never-throw: jede Eingabe (auch null/unsinnig) liefert null oder ein sauberes
// Record<string, string>.

import {
  BRIEF_QUESTIONS,
  buildBriefContext,
  isBriefQuestionKey,
  type BriefLang,
  type BriefQuestionKey,
} from './questions';

export type { BriefLang, BriefOption, BriefQuestion, BriefQuestionKey } from './questions';
export { BRIEF_QUESTIONS, BRIEF_QUESTION_KEYS, buildBriefContext, findOption, isBriefQuestionKey, noteKeyOf } from './questions';

/** Ist der Schlüssel eine bekannte Frage ODER deren Freitext-Ergänzung? */
export function isKnownBriefKey(key: string): boolean {
  if (isBriefQuestionKey(key)) return true;
  if (key.endsWith('_note')) {
    return isBriefQuestionKey(key.slice(0, -'_note'.length) as BriefQuestionKey);
  }
  return false;
}

/**
 * Normalisiert eine unbekannte Eingabe zu einem validen Brief.
 * - keine/leere Eingabe → null (Default: Brief ist optional, alles wie vorher)
 * - unbekannte Schlüssel werden ignoriert
 * - nicht-leere String-Werte werden getrimmt übernommen
 */
export function normalizeBrief(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isKnownBriefKey(key)) continue;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    out[key] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Ist im Brief irgendetwas ausgefüllt? (für UI-Badge / Speichern) */
export function hasBriefAnswers(brief: Record<string, string> | null | undefined): boolean {
  if (!brief) return false;
  return BRIEF_QUESTIONS.some((q) => Boolean(brief[q.key]));
}

/**
 * Kompakte, menschenlesbare Zusammenfassung (z. B. für UI/Persistenz-Anzeige).
 * Delegiert an buildBriefContext — gleiche Quelle, kein Doppel-Pflegen.
 */
export function summarizeBrief(brief: Record<string, string> | null | undefined, lang: BriefLang = 'de'): string {
  return buildBriefContext(brief, lang);
}
