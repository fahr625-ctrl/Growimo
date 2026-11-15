// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Kampagne: EIN Etsy-Listing-Entwurf aus denselben Produktangaben
// ─────────────────────────────────────────────────────────────────────────────
// Kein KI-Aufruf. Titel, Beschreibung und die 13 Tags entstehen ausschließlich
// aus den Angaben des Nutzers (Produkt, Zielgruppe, Kernbotschaft). Es wird
// NICHTS erfunden: keine Formate, keine Größen, keine Dateianzahl, kein
// Versand, keine Lieferung, keine Rückgabe. Was nicht in der Eingabe steht,
// steht auch nicht im Listing.
//
// Die Tags laufen durch die BESTEHENDE Durchsetzung (`src/lib/etsy-tags.ts`) —
// also ≤ 20 Zeichen, keine Duplikate, genau 13. Reicht das Material des Nutzers
// nicht für 13 Begriffe, bleiben es weniger und die Oberfläche sagt das
// ehrlich, statt Begriffe zu erfinden.
//
// Dieselben Textregeln wie bei den Pin-Entwürfen (clip/sentence/clean werden
// dort importiert), damit es keine zweite Wahrheit für Kürzen und Satzende gibt.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ETSY_TAG_COUNT,
  ETSY_TAG_MAX_CHARS,
  areEtsyTagsUsable,
  sanitizeEtsyTags,
} from '~/lib/etsy-tags';
import { clean, sentence } from './pin-drafts';

/** Etsy-Titel: 140 Zeichen (belegt 2026-11-11). */
export const ETSY_TITLE_MAX = 140;
/** Beschreibung: Etsy erlaubt deutlich mehr — hier bewusst knapp, weil nur
 *  Nutzerangaben hineingehen und nichts aufgefüllt wird. */
export const ETSY_DESCRIPTION_MAX = 2000;

export interface EtsySource {
  product: string;
  audience: string;
  message: string;
}

export interface EtsyDraft {
  title: string;
  description: string;
  /** Geprüfte Tags (≤ 20 Zeichen, unterschiedlich, höchstens 13). */
  tags: string[];
}

/** Wörter, die als Tag nichts aussagen (keine Suchbegriffe). */
const TAG_STOPWORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einen', 'einem', 'eines',
  'und', 'oder', 'aber', 'sowie', 'für', 'fuer', 'mit', 'ohne', 'in', 'im', 'am', 'an', 'auf',
  'aus', 'bei', 'zu', 'zum', 'zur', 'von', 'vom', 'ist', 'sind', 'wird', 'werden', 'sich',
  'auch', 'sehr', 'mehr', 'als', 'wie', 'dass', 'nicht', 'kein', 'keine', 'dein', 'deine',
  'deinem', 'deinen', 'ich', 'du', 'es', 'sie', 'er', 'wir', 'ihr', 'man', 'dieser', 'diese',
  'dieses', 'alle', 'etwas', 'jeder', 'jede', 'the', 'a', 'an', 'and', 'or', 'for', 'with',
  'of', 'to', 'in', 'on', 'at', 'is', 'are', 'this', 'that', 'your', 'you', 'my', 'it',
]);

/** Wörter eines Textes als Tag-Bausteine (klein, ohne Satzzeichen, ohne Füllwörter). */
function tagTokens(text: string): string[] {
  const out: string[] = [];
  for (const word of clean(text).toLowerCase().split(/\s+/)) {
    const bare = word.replace(/[^0-9a-zà-ÿß-]/g, '').replace(/^-+|-+$/g, '');
    if (!bare) continue;
    for (const part of bare.split('-')) {
      if (part.length < 3) continue;
      // Reine Zahlen sind kein Suchbegriff („200" aus „200 ml").
      if (/^[0-9]+$/.test(part)) continue;
      if (TAG_STOPWORDS.has(part)) continue;
      out.push(part);
    }
  }
  return out;
}

/**
 * Tag-Kandidaten ausschließlich aus den Nutzerangaben — in der Reihenfolge, in
 * der sie im Listing am meisten taugen: Wortpaare aus dem Produkt (das sind die
 * eigentlichen Suchphrasen), dann einzelne Produktwörter, dann Zielgruppe, dann
 * Kernbotschaft. Nichts davon ist ein neuer Begriff: alle Wörter stehen in der
 * Eingabe.
 */
export function etsyTagCandidates(source: EtsySource): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    const tag = value.trim().toLowerCase();
    if (tag.length < 3 || tag.length > ETSY_TAG_MAX_CHARS) return;
    if (seen.has(tag)) return;
    seen.add(tag);
    out.push(tag);
  };

  const phrases = (text: string): void => {
    const tokens = tagTokens(text);
    for (let i = 0; i + 1 < tokens.length; i++) push(`${tokens[i]} ${tokens[i + 1]}`);
    for (const token of tokens) push(token);
    for (let i = 0; i + 2 < tokens.length; i++) push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  };

  phrases(source.product);
  phrases(source.audience);
  phrases(source.message);
  return out;
}

/** Absätze verbinden, ohne die Zeilenumbrüche zu verlieren; hart auf `max`. */
function joinParagraphs(parts: readonly string[], max: number): string {
  const kept: string[] = [];
  let length = 0;
  for (const part of parts) {
    const value = clean(part);
    if (!value) continue;
    const add = value.length + (kept.length > 0 ? 2 : 0);
    if (length + add > max) break;
    kept.push(value);
    length += add;
  }
  return kept.join('\n\n');
}

/** Beschreibung begrenzen, ohne Zeilenumbrüche zu verlieren. */
function capDescription(text: string, max: number): string {
  const value = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (value.length <= max) return value;
  return joinParagraphs(value.split(/\n{2,}/), max);
}

/**
 * Titel auf die Etsy-Grenze bringen. Bewusst NICHT `clip()` aus den Pins: das
 * entfernt hängende Füllwörter (u. a. „wird", „ist") und würde aus einem
 * vollständigen Satz einen halben machen („Ein Abend, der langsamer").
 */
function capTitle(text: string, max: number): string {
  const value = clean(text);
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > 20 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,;:.\-/|&+]+$/, '').trim();
}

/**
 * Der Entwurf aus den Nutzerangaben. Reihenfolge der Beschreibung wie ein
 * Listing: Nutzen (Kernbotschaft) → was es ist (Produkt) → für wen (Zielgruppe).
 * Fehlt eine Angabe, entfällt ihr Satz — es wird nichts ersetzt.
 */
export function buildEtsyDraft(source: EtsySource): EtsyDraft {
  const product = clean(source.product);
  const audience = clean(source.audience);
  const message = clean(source.message);

  // Titel: das Produkt zuerst. Die Kernbotschaft kommt nur dazu, wenn sie
  // VOLLSTÄNDIG hineinpasst — sonst entstünde ein halber Satz im Titel.
  const titleProduct = capTitle(product, ETSY_TITLE_MAX);
  const rest = ETSY_TITLE_MAX - titleProduct.length - 3;
  const title =
    message && rest >= 20 && clean(message).length <= rest
      ? `${titleProduct} – ${clean(message)}`
      : titleProduct;

  const description = joinParagraphs(
    [
      message ? sentence(message) : '',
      product ? sentence(product) : '',
      audience ? `Für ${sentence(audience)}` : '',
    ],
    ETSY_DESCRIPTION_MAX,
  );

  const tags = sanitizeEtsyTags(etsyTagCandidates(source));
  return { title, description, tags };
}

/** Tags aus einem Eingabefeld: ein Tag pro Zeile, Komma geht auch. */
export function parseTagInput(text: string): string[] {
  return String(text ?? '')
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Tags als kopierbarer Text (Etsy nimmt sie einzeln — das hier ist die Liste). */
export function formatTagList(tags: readonly string[]): string {
  return tags.join(', ');
}

/**
 * Entwurf prüfen und begrenzen (fail-closed, auch serverseitig vor dem
 * Speichern). Bearbeitete Titel/Beschreibung bleiben erhalten; die Tags laufen
 * durch `sanitizeEtsyTags` und werden bei Bedarf aus den Nutzerangaben
 * aufgefüllt — nie aus erfundenen Begriffen.
 */
export function sanitizeEtsyDraft(input: unknown, source?: EtsySource): EtsyDraft | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<EtsyDraft>;
  const fallback = source ? buildEtsyDraft(source) : null;

  const title = capTitle(typeof raw.title === 'string' ? raw.title : (fallback?.title ?? ''), ETSY_TITLE_MAX);
  const description = capDescription(
    typeof raw.description === 'string' ? raw.description : (fallback?.description ?? ''),
    ETSY_DESCRIPTION_MAX,
  );
  const rawTags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === 'string')
    : (fallback?.tags ?? []);
  const tags = sanitizeEtsyTags(rawTags, source ? etsyTagCandidates(source) : []);
  if (!title) return null;
  return { title, description, tags };
}

/** `etsy` ist JSONB — je nach Treiber kommt ein Objekt oder ein JSON-Text. */
export function parseEtsyJson(value: unknown, source?: EtsySource): EtsyDraft | null {
  if (value == null) return null;
  let raw: unknown = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return sanitizeEtsyDraft(raw, source);
}

/** Sind es genau 13 verwendbare Tags? (sonst sagt die Oberfläche es ehrlich) */
export function etsyTagsComplete(tags: readonly string[]): boolean {
  return areEtsyTagsUsable(tags);
}

/** Wie viele Tags fehlen noch zu 13? (0 = vollständig) */
export function etsyTagsMissing(tags: readonly string[]): number {
  return Math.max(0, ETSY_TAG_COUNT - tags.length);
}
