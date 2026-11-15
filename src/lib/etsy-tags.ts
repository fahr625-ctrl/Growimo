// ─────────────────────────────────────────────────────────────────────────────
// Etsy-Tags: Etsys harte Grenze durchsetzen (Owner-Befund 2026-11-14)
// ─────────────────────────────────────────────────────────────────────────────
// Etsy erlaubt **genau 13 Tags mit maximal 20 Zeichen** je Tag (belegt
// 2026-11-11, 27 Zitate). Der Prompt fordert das bereits — im Lauf vom
// 14.11. überschritten trotzdem 4 Tags die Grenze (u. a. „einzigartiges
// geschenk" 22, „besonderes dankeschön" 21). Der Parser verwarf diese Tags
// stillschweigend (`filter(t => t.length <= 20)`) — deshalb meldete das
// Score-Panel „Nur 9 von 13 Etsy-Tags", während im Text 13 standen. Zwei
// Befunde, eine Ursache: es fehlte die DURCHSETZUNG, nicht die Prüfung.
//
// Diese Datei ist bewusst PUR (keine Imports): sie läuft im Parser
// (src/ai/providers/openai.ts), in der serverseitigen Speicher-Prüfung
// (src/lib/etsy-library.ts) und ist ohne Netz/DB testbar.

/** Etsys Grenze je Tag (belegt 2026-11-11). */
export const ETSY_TAG_MAX_CHARS = 20;
/** Etsy akzeptiert genau 13 Tags je Listing. */
export const ETSY_TAG_COUNT = 13;

/**
 * Ein Tag auf Etsy-Form bringen:
 *  · Anführungszeichen, Aufzählungszeichen, Nummerierung und „#" entfernen
 *  · Mehrfach-Leerzeichen zusammenfassen, Rand-Leerzeichen weg
 *  · auf maximal 20 Zeichen kürzen — bevorzugt an einer Wortgrenze, damit der
 *    Tag lesbar bleibt („einzigartiges geschenk" → „einzigartiges"), sonst hart
 *    bei 20 Zeichen (Etsy zählt Zeichen, nicht Wörter)
 *  · abschließende Trenn-/Satzzeichen entfernen, die durch das Kürzen entstehen
 */
export function normalizeEtsyTag(raw: string): string {
  let tag = String(raw ?? '')
    .replace(/^\s*(?:[-*•·]|\d{1,2}[.)])\s*/, '')
    .replace(/^#+/, '')
    .replace(/^["'„“‚‘»«]+|["'“”‚‘»«]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (tag.length > ETSY_TAG_MAX_CHARS) {
    const cut = tag.slice(0, ETSY_TAG_MAX_CHARS);
    const lastSpace = cut.lastIndexOf(' ');
    // Nur an der Wortgrenze kürzen, wenn dort ein brauchbarer Rest bleibt.
    tag = (lastSpace >= 8 ? cut.slice(0, lastSpace) : cut)
      .replace(/[\s,;:.\-/|&+]+$/, '')
      .trim();
  }
  return tag;
}

/**
 * Aus einer Rohliste (Modellantwort) genau die Tags machen, die Etsy akzeptiert:
 * gültig (≤ 20 Zeichen), ohne Duplikate (case-insensitiv), höchstens 13, in der
 * Reihenfolge der Nennung. Fehlende Positionen werden aus `fallbacks` aufgefüllt
 * (Fokus-Keywords, Kategorie, Stil, Titelwörter) — es wird nichts erfunden,
 * sondern nur aus schon vorhandenen Begriffen des Listings gewählt.
 *
 * Rückgabe kürzer als 13 = es gibt nicht genug gültige Begriffe. Der Aufrufer
 * entscheidet dann ehrlich (Score-Panel: Warnung; Server: Listing nicht nutzbar,
 * keine Einheit).
 */
export function sanitizeEtsyTags(raw: readonly string[], fallbacks: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const take = (candidate: string): void => {
    const tag = normalizeEtsyTag(candidate);
    if (!tag || tag.length > ETSY_TAG_MAX_CHARS) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tag);
  };
  for (const item of raw) take(item);
  if (out.length < ETSY_TAG_COUNT) {
    for (const item of fallbacks) {
      if (out.length >= ETSY_TAG_COUNT) break;
      take(item);
    }
  }
  return out.slice(0, ETSY_TAG_COUNT);
}

/** Ist diese Tag-Liste so bei Etsy verwendbar? (genau 13, ≤ 20 Zeichen, unique) */
export function areEtsyTagsUsable(tags: unknown): tags is string[] {
  if (!Array.isArray(tags) || tags.length !== ETSY_TAG_COUNT) return false;
  const seen = new Set<string>();
  for (const t of tags) {
    if (typeof t !== 'string') return false;
    const tag = t.trim();
    if (!tag || tag.length > ETSY_TAG_MAX_CHARS) return false;
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/**
 * Füll-Begriffe aus dem Listing selbst: Fokus-Keywords, Kategorie, Stil und die
 * Segmente des SEO-Titels (Etsy-Titel trennen Keyword-Cluster mit „|" oder „-").
 * Bewusst nur vorhandene Begriffe — keine erfundenen Suchbegriffe.
 */
export function etsyTagFallbacks(input: {
  focusKeywords?: unknown;
  category?: unknown;
  style?: unknown;
  title?: unknown;
}): string[] {
  const out: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value.trim()) out.push(value.trim());
  };
  if (Array.isArray(input.focusKeywords)) {
    for (const k of input.focusKeywords) push(k);
  }
  push(input.category);
  push(input.style);
  if (typeof input.title === 'string') {
    for (const part of input.title.split(/[|·•]/)) push(part);
    for (const part of input.title.split(/\s[-–]\s/)) push(part);
  }
  return out;
}
