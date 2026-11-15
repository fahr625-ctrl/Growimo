// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Kampagne: EIN Etsy-Listing-Entwurf aus denselben Produktangaben
// ─────────────────────────────────────────────────────────────────────────────
// Kein KI-Aufruf. Titel, Beschreibung und die 13 Tags entstehen ausschließlich
// aus den Angaben des Nutzers (Produkt, Zielgruppe, Kernbotschaft). Es wird
// NICHTS erfunden: keine Formate, keine Größen, keine Dateianzahl, kein
// Versand, keine Lieferung, keine Rückgabe. Was nicht in der Eingabe steht,
// steht auch nicht im Listing.
//
// Die Tags werden AUS DEN NUTZERANGABEN GEBILDET — als verständliche Begriffe
// („gäste-wc-poster", „poster mit spruch"), nie als Wortfetzen. Verneinte
// Eigenschaften („kein Rahmen enthalten", „ohne Rahmen") ergeben KEINEN Tag.
// Reicht das Material nicht für 13 sinnvolle Begriffe, bleiben es weniger und
// die Oberfläche bittet um weitere Produktmerkmale, statt aufzufüllen.
// Danach laufen die Tags durch die BESTEHENDE Durchsetzung
// (`src/lib/etsy-tags.ts`): ≤ 20 Zeichen, keine Duplikate, höchstens 13. Diese
// Durchsetzung prüft NUR die Form — nicht den Sinn; deshalb behauptet die
// Anzeige auch keine Gültigkeit.
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
  'aus', 'bei', 'zu', 'zum', 'zur', 'von', 'vom', 'sich',
  'auch', 'sehr', 'mehr', 'als', 'wie', 'dass', 'dein', 'deine',
  'deinem', 'deinen', 'ich', 'du', 'es', 'sie', 'er', 'wir', 'ihr', 'man', 'dieser', 'diese',
  'dieses', 'alle', 'etwas', 'jeder', 'jede', 'the', 'a', 'an', 'and', 'or', 'for', 'with',
  'of', 'to', 'in', 'on', 'at', 'this', 'that', 'your', 'you', 'my', 'it',
]);

/**
 * Verben und Kopula. Ein Begriff, der so ein Wort enthält, ist kein Tag:
 * „klo ist größer" entstand im Befund genau daraus, dass die Wortfolge ohne
 * Rücksicht auf Satzbau zusammengeklebt wurde.
 */
const TAG_VERBS = new Set([
  'ist', 'sind', 'war', 'waren', 'wird', 'werden', 'wurde', 'hat', 'haben', 'kann', 'können',
  'muss', 'soll', 'darf', 'bleibt', 'passt', 'macht', 'kommt', 'gibt', 'wirkt', 'zeigt',
  'is', 'are', 'was', 'were', 'has', 'have', 'can', 'will', 'fits', 'shows',
]);

/**
 * Verneinung. Ab so einem Wort ist eine Angabe NICHT positiv — der Tag darf
 * daraus nicht entstehen („kein Rahmen enthalten" ergab „rahmen enthalten").
 */
const NEGATION_WORDS = new Set([
  'kein', 'keine', 'keinen', 'keinem', 'keiner', 'keines',
  'ohne', 'nicht', 'nie', 'niemals', 'nichts', 'ausgeschlossen', 'entfällt', 'entfaellt',
  'exklusive', 'exkl', 'no', 'not', 'without', 'none', 'never', 'excluded',
]);

/**
 * Wörter, nach denen eine Verneinung RÜCKWÄRTS gilt: „Rahmen nicht enthalten"
 * verneint den Rahmen, nicht das Enthalten. Steht hinter der Verneinung nur so
 * ein Wort (oder gar keins), entfällt die ganze Klausel.
 */
const NEGATION_TAIL = new Set([
  'enthalten', 'inklusive', 'inkl', 'inbegriffen', 'dabei', 'mitgeliefert',
  'lieferumfang', 'vorhanden', 'not', 'included', 'available', 'provided',
  'entfällt', 'entfaellt',
]);

/**
 * Einzelwörter, die allein als Tag nichts taugen: reine Eigenschafts- und
 * Vergleichswörter („größer", „bunt"). In einer Wendung bleiben sie erlaubt
 * („bunte baddeko").
 */
const WEAK_WORDS = new Set([
  'größer', 'groesser', 'größer', 'kleiner', 'kleines', 'kleine', 'groß', 'gross', 'große',
  'bunt', 'bunte', 'bunter', 'schön', 'schoen', 'schöne', 'lustig', 'lustige', 'süß', 'suess',
  'perfekt', 'ideal', 'hochwertig', 'modern', 'einfach', 'schnell', 'günstig', 'guenstig',
  'toll', 'super', 'echt', 'ganz', 'richtig', 'echte', 'tolle',
  'bigger', 'smaller', 'cute', 'funny', 'perfect', 'great', 'nice', 'best',
]);

/**
 * Zerlegung in Klauseln: Satzzeichen, Aufzählungen und Gedankenstriche trennen.
 * Innere Bindestriche bleiben stehen („Gäste-WC-Poster" ist EIN Begriff).
 */
function clauses(text: string): string[] {
  return clean(text)
    .split(/[.;:!?,|/\\&•·»«„“”"()[\]\n\r]+|\s+[-–—]+\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Wörter einer Klausel: klein, ohne Satzzeichen, Bindestriche bleiben. */
function clauseWords(clause: string): string[] {
  return clause
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^0-9a-zà-ÿß-]/g, '').replace(/^-+|-+$/g, ''))
    .filter(Boolean);
}

/**
 * Der positive Teil einer Klausel: alles vor einer Verneinung. Steht die
 * Verneinung vorn oder bezieht sie sich rückwärts („Rahmen nicht enthalten"),
 * bleibt nichts übrig — die Klausel ist dann vollständig verneint.
 */
function positivePart(clause: string): string {
  const raw = clause.split(/\s+/).filter(Boolean);
  const norm = raw.map((word) =>
    word.toLowerCase().replace(/[^0-9a-zà-ÿß-]/g, '').replace(/^-+|-+$/g, ''),
  );
  const at = norm.findIndex((word) => NEGATION_WORDS.has(word));
  if (at < 0) return clause;
  const after = norm
    .slice(at + 1)
    .filter(
      (word) =>
        word.length >= 3 &&
        !TAG_STOPWORDS.has(word) &&
        !TAG_VERBS.has(word) &&
        !NEGATION_TAIL.has(word) &&
        !NEGATION_WORDS.has(word),
    );
  if (at === 0 || after.length === 0) return '';
  return raw.slice(0, at).join(' ');
}

/** Taugt dieses Wort allein als Tag? */
function isContentWord(word: string): boolean {
  const bare = word.replace(/-/g, '');
  if (bare.length < 3) return false;
  if (/^[0-9]+$/.test(bare)) return false;
  if (TAG_STOPWORDS.has(word) || TAG_VERBS.has(word) || WEAK_WORDS.has(word)) return false;
  return true;
}

/** Ist diese Wortfolge ein vorzeigbarer Begriff? Anfang und Ende müssen tragen. */
function isPhrase(words: readonly string[]): boolean {
  if (words.length === 0) return false;
  const first = words[0]!;
  const last = words[words.length - 1]!;
  if (!isContentWord(first) || !isContentWord(last)) return false;
  return !words.some((word) => TAG_VERBS.has(word) || NEGATION_WORDS.has(word));
}

/**
 * Tag-Kandidaten ausschließlich aus den Nutzerangaben. Reihenfolge: erst das
 * Produkt, dann Zielgruppe, dann Kernbotschaft — innerhalb jeder Angabe erst
 * die ganze Wendung, dann zusammenhängende Wortfenster, dann Einzelbegriffe.
 *
 * Die Fenster laufen NIE über eine Klauselgrenze: deshalb kann aus
 * „… mit Spruch. Kleines Klo …" kein „spruch kleines" mehr werden. Und was
 * verneint ist, wird vorher abgeschnitten: „kein Rahmen enthalten" liefert
 * keinen Tag.
 */
export function etsyTagCandidates(source: EtsySource): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    const tag = value.trim().toLowerCase();
    if (tag.length < 2 || tag.length > ETSY_TAG_MAX_CHARS) return;
    if (seen.has(tag)) return;
    seen.add(tag);
    out.push(tag);
  };

  const fromText = (text: string): void => {
    for (const clause of clauses(text)) {
      const positive = positivePart(clause);
      if (!positive) continue;
      const words = clauseWords(positive);
      if (words.length === 0) continue;

      // 1. Die ganze Wendung, wenn sie als Tag durchgeht („gäste-wc-poster").
      if (isPhrase(words)) push(words.join(' '));

      // 2. Zusammenhängende Fenster von drei, dann zwei Wörtern.
      for (const size of [3, 2]) {
        for (let i = 0; i + size <= words.length; i++) {
          const window = words.slice(i, i + size);
          if (!isPhrase(window)) continue;
          push(window.join(' '));
        }
      }

      // 3. Einzelbegriffe. Ein Bindestrich-Wort bleibt ganz; zusätzlich seine
      //    Teile ab zwei Zeichen („wc" aus „gäste-wc-poster").
      for (const word of words) {
        if (word.includes('-')) {
          if (word.replace(/-/g, '').length >= 3) push(word);
          for (const part of word.split('-')) {
            if (part.length < 2) continue;
            if (/^[0-9]+$/.test(part)) continue;
            if (TAG_STOPWORDS.has(part) || TAG_VERBS.has(part)) continue;
            push(part);
          }
        } else if (isContentWord(word)) {
          push(word);
        }
      }
    }
  };

  fromText(source.product);
  fromText(source.audience);
  fromText(source.message);
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
 * durch `sanitizeEtsyTags`.
 *
 * Aufgefüllt wird NUR, wenn gar keine Tag-Liste vorliegt (dann entsteht sie aus
 * den Nutzerangaben). Hat der Nutzer eine Liste — auch eine kürzere als 13 —,
 * bleibt es genau dabei: eine gelöschte Zeile kommt nicht zurück, und es wird
 * nichts erfunden.
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
  const given = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === 'string')
    : [];
  const tags = given.length > 0
    ? sanitizeEtsyTags(given)
    : sanitizeEtsyTags(fallback?.tags ?? [], source ? etsyTagCandidates(source) : []);
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
