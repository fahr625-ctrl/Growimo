/**
 * Owner-Entscheid 2026-10-01 (Teil 2) — FAKTEN-SCHUTZ im Package-Flow.
 *
 * Befund der Demo (docs/auto-save-paket-evidence.md, demo-decision-flow/BERICHT.md):
 * Die 5 Paket-Kanäle (Pinterest, Etsy, SEO, Social, E-Mail) erfanden Fakten, die
 * der Nutzer nie geliefert hat — alles sichtbar im SEO-Artikel und im Pin-Titel:
 *   1. Ich-Erzählung des Verkäufers: „Letztes Jahr habe ich für den Geburtstag
 *      meines Sohnes eine Kerze … gestaltet. Die Freude …" (als „Beispiel aus der
 *      Praxis" ausgegeben).
 *   2. Erfundene Geschäftszusagen: Lieferzeit („in 3–5 Werktagen", „in wenigen
 *      Tagen hältst du sie in den Händen") und Rückgaberegel („… können wir leider
 *      keine Rückgabe akzeptieren").
 *   3. Unbelegte Trend-/Alle-Aussage im Pin-Titel: „Diesen Geburtstagstrend lieben
 *      alle Eltern …".
 *   4. Fremd-Beispiel-Slug im Verbesserungshinweis: „(z. B.
 *      /trauerkarten-gestalten-persoenlich)".
 *
 * Dieser Baustein ist das Package-Pendant zum TikTok-Fakten-Schutz (Commit
 * 9331e6a, `PERSONAL_STORY_PATTERNS` + `personalStoryViolations` in ai/tiktok.ts):
 *   - `FACT_PROTECTION_CONSTRAINT`  = globale Prompt-Regel (de+en), angehängt an
 *     JEDEN Kanal-System-Prompt (providers/openai.ts#buildSystemPrompt).
 *   - `factViolations()`            = deterministischer, satzweise Post-Check
 *     (de+en, 5 Muster-Kategorien, Grounding gegen die Nutzerangaben).
 *   - `factGuardCorrection()`       = Korrektur-Hinweis für EINEN Retry (Muster
 *     Stabilisierung 4.2: 1 Korrektur, danach hart bzw. Satz-Eliminierung).
 *   - `sanitizeFactText()`          = letzte Instanz: entfernt jeden Satz mit einer
 *     erfundenen Behauptung (TikTok-Muster `dropStorySentences`), damit erfundene
 *     Fakten die Engine NIE verlassen.
 *
 * Grounding: Alles, was der Nutzer selbst geliefert hat (Produktidee, Brief,
 * Markenprofil, Projekt), ist belegt und wird NIE geflaggt. Die Muster tragen dazu
 * je Kategorie ein `grounding`-Muster (TikTok-Konvention) bzw. `literal` für
 * Slugs/URLs (der Fund muss wörtlich im Nutzerkontext stehen).
 *
 * Alle Funktionen sind rein (keine Netzwerk-/DB-Zugriffe) — ohne API-Aufruf testbar.
 */

/** Ein Muster mit optionalem Grounding gegen die Nutzerangaben. */
export interface FactPattern {
  name: string;
  re: RegExp;
  /** Treffer im Nutzerkontext ⇒ nie flaggen (Nutzerangabe ist belegt). */
  grounding?: RegExp;
  /** true = der gefundene Slug/die Domain muss wörtlich im Nutzerkontext stehen. */
  literal?: boolean;
}

/** Kategorie-Präfix der Verstoß-Meldungen. */
export const FACT_VIOLATION_PREFIX = 'FACT:';

/**
 * Globale Prompt-Constraint (de+en) für JEDEN Kanal — Fakten dürfen nur aus den
 * Nutzerangaben stammen. Wird in providers/openai.ts an jeden System-Prompt
 * gehängt (5 Paket-Kanäle + Einzel-Kanäle + Strategie-Stream).
 */
export const FACT_PROTECTION_CONSTRAINT = `⚠️ FAKTEN-SCHUTZ (harte Regel): JEDES Faktum deiner Ausgabe muss aus den NUTZERANGABEN stammen (Produktidee, Strategie-Brief, Markenprofil, Projektdaten). Erlaubt ist ausschließlich, was dort steht oder sich zwingend daraus ergibt. VERBOTEN ist alles, was du selbst hinzuerfindest — insbesondere:
(1) persönliche Erlebnisse/Anekdoten des Verkäufers in der Ich-Form („Letztes Jahr habe ich …", „Als ich …", „Mein Sohn …", „Ein Beispiel aus der Praxis") — schreibe in der Du-Ansprache oder neutral, ohne eigene Erlebnisse;
(2) Lieferzeiten, Versand- und Rückgabe-/Umtauschregeln („in 3–5 Werktagen", „in wenigen Tagen hältst du sie in den Händen", „14 Tage Rückgaberecht", „versandkostenfrei", „Bearbeitungszeit");
(3) Preise, Zertifikate/Sicherheitsversprechen und Material-/Wirkversprechen („wasserfest", „lebensmittelecht", „100 % Bienenwachs", „garantiert"), die der Nutzer nicht genannt hat;
(4) Trend-/Beliebtheits-Behauptungen („Trend", „im Trend", „alle lieben …", „beliebteste", „Bestseller", „2026");
(5) erfundene Fremd-URLs, Beispiel-Slugs oder Links zu anderen Shops/Artikeln.
Bei Unsicherheit gilt: den Punkt WEGLASSEN oder allgemein formulieren (ohne Zahl, ohne Zusage, ohne Namen) — NIEMALS erfinden. Beispiel-Slugs/URLs nur verwenden, wenn der Nutzer sie selbst genannt hat; sonst den Slug ausschließlich aus dem Fokus-Keyword des Nutzerthemas ableiten. Keine Vorher-/Nachher-Beispiele mit erfundenen Personen, Zahlen oder Ergebnissen.
 EN: Every fact in your output must come from the USER INPUT (product idea, brief, brand profile, project data) — nothing else. Never invent: first-person seller anecdotes or experiences; delivery/shipping/return/processing times or promises; prices, certifications, material or effect claims; trend/popularity claims ("trending", "everyone loves it", "bestseller", "2026"); or foreign example URLs/slugs. If you are unsure, omit the point or phrase it generally (no number, no promise, no name) — never make it up. Reuse an example slug/URL only if the user supplied it; otherwise derive the slug solely from the user's own focus keyword.`;

/** Muster-Kategorien (de+en) des Package-Fakten-Checks. */
export const FACT_PATTERNS: FactPattern[] = [
  // ── (a) Ich-Erzählungen / persönliche Anekdoten des Verkäufers ──────────────
  {
    name: 'anekdote-letztes-jahr',
    re: /\b(?:letztes|voriges)\s+jahr\s+(?:habe|hatte|war|wollte|musste|durfte)\s+ich\b/i,
    grounding: /letztes\s+jahr|voriges\s+jahr|last\s+year/,
  },
  { name: 'anecdote-last-year', re: /\blast\s+year\s+(?:i|we)\b/i, grounding: /last\s+year/ },
  {
    name: 'als-ich-erzaehlung',
    re: /\bals\s+ich\s+[^.!?\n]{0,60}?\b(?:sah|merkte|bemerkte|dachte|fühlte|fuehlte|erfuhr|hörte|hoerte|gestaltete|schenkte|packte|machte)\b/i,
    grounding: /als\s+ich/,
  },
  {
    name: 'when-i-narrative',
    re: /\bwhen\s+i\s+[^.!?\n]{0,60}?\b(?:saw|noticed|realized|realised|felt|heard|made|gave|wrapped|created)\b/i,
    grounding: /when\s+i\s/,
  },
  {
    name: 'ich-habe-erlebt',
    re: /\bich\s+(?:habe|hatte)\s+[^.!?\n]{0,40}?\b(?:erlebt|gesehen|gebastelt|gestaltet|verschenkt|geschenkt\s+bekommen|erhalten|gemerkt|bemerkt|gefühlt|gefuehlt)\b/i,
    grounding: /ich\s+habe|habe\s+ich/,
  },
  {
    name: 'enge-angehoerige-verkaeufer',
    re: /\b(?:für|fuer|zu|mit|von)\s+mein(?:em|er|en)?\s+(?:sohn|tochter|kind|kindern|mann|frau|mutter|vater|oma|opa|bruder|schwester|neffen|nichte|nachbarn|nachbarin|kollegen|kollegin|freund|freundin)\b/i,
    grounding: /sohn|tochter|kind|mann|frau|mutter|vater|oma|opa|bruder|schwester|neffe|nichte|nachbar|kolleg|freund|son|daughter|child|husband|wife|mother|father/,
  },
  {
    name: 'my-relative-seller',
    re: /\b(?:for|to|with|from)\s+my\s+(?:son|daughter|child|kids|husband|wife|mother|father|grandma|grandpa|brother|sister|friend|neighbour|neighbor|colleague)\b/i,
    grounding: /son|daughter|child|kids|husband|wife|mother|father|grandma|grandpa|brother|sister|friend|neighbour|neighbor|colleague/,
  },
  {
    name: 'meine-erfahrung-meine-praxis',
    re: /\b(?:meiner|unserer|aus\s+der)\s+(?:eigenen\s+)?(?:erfahrung|praxis)\b|\baus\s+meinem\s+alltag\b|\bfrom\s+my\s+(?:own\s+)?(?:experience|practice)\b/i,
    grounding: /erfahrung|praxis|alltag|experience|practice/,
  },
  {
    name: 'geburtstag-meines-sohnes',
    re: /\b(?:geburtstag|hochzeit|weihnachten)\s+mein(?:es|er)\s+(?:sohn|tochter|kindes|mannes|frau|mutter|vaters)\b/i,
    grounding: /geburtstag|hochzeit|weihnachten|sohn|tochter|kind|mann|frau|mutter|vater/,
  },
  // ── (b) Lieferzeit / Versand / Rückgabe ────────────────────────────────────
  {
    name: 'lieferzeit',
    re: /\bliefer(?:zeit|ung|termin)\b[^.!?\n]{0,40}?\b(?:in|innerhalb|dauert|beträgt|betraegt|von)\b/i,
    grounding: /liefer|versand|shipping|delivery/,
  },
  {
    name: 'in-x-tagen-wochen',
    re: /\bin\s+(?:wenigen|einigen|\d{1,2}(?:\s*[-–]\s*\d{1,2})?)\s+(?:werktagen|arbeitstagen|tagen|wochen|business\s+days|working\s+days|days|weeks)\b/i,
    grounding: /werktag|arbeitstag|liefer|versand|shipping|delivery|in\s+\d+\s+tagen/,
  },
  {
    name: 'lieferzeit-mit-dauer',
    re: /\bliefer(?:zeit|dauer|termin)\b[^.!?\n]{0,40}?\d|\bdelivery\s+time\b[^.!?\n]{0,30}?\d|\bdelivers?\s+in\s+\d/i,
    grounding: /lieferzeit|lieferdauer|liefertermin|delivery\s+time/,
  },
  {
    name: 'versandkostenfrei',
    re: /\bversandkostenfrei\w*|\bkostenlos(?:er|en)?\s+versand\b|\bfree\s+shipping\b|\bversand\s+kostenlos\b/i,
    grounding: /versand|shipping/,
  },
  {
    name: 'rueckgaberecht',
    re: /\brückgabe(?:recht|n|bedingungen|frist|zeitraum)?\b|\bretoure\w*\b|\bumtausch\b|\b\d{1,2}[- ]?(?:tage|tagen|days?)[- ]?(?:rückgaberecht|return)\b|\breturns?\s+within\b|\bno\s+returns?\b/i,
    grounding: /rückgabe|retoure|umtausch|return/,
  },
  {
    name: 'bearbeitungszeit',
    re: /\bbearbeitungszeit\b|\bprocessing\s+time\b|\bherstellungszeit\b/i,
    grounding: /bearbeitungszeit|processing\s+time|herstellungszeit/,
  },
  {
    name: 'versand-zusage',
    re: /\b(?:wir|ich)\s+(?:versenden|verschicken|liefern|senden)\b|\bships?\s+(?:within|in\s+\d)|\bdelivered\s+within\b/i,
    grounding: /versand|versenden|verschicken|liefer|ship|deliver/,
  },
  // ── (c) Preis- / Produkteigenschafts-Behauptungen ohne Grundlage ───────────
  {
    name: 'preis-ohne-grundlage',
    re: /(?:\d{1,4}(?:[.,]\d{2})?\s*(?:€|eur\b|euro\b)|\$\s?\d{1,4}(?:[.,]\d{2})?|\d{1,4}(?:[.,]\d{2})?\s*(?:usd|dollar)\b)/i,
    grounding: /(?:€|eur\b|euro\b|\$\s?\d|\d{1,4}(?:[.,]\d{2})?\s*(?:usd|dollar)|preis|price|kostet)/i,
  },
  {
    name: 'zertifikat-wirkung',
    re: /\b(?:wasserfest|spülmaschinenfest|spuelmaschinenfest|lebensmittelecht|hypoallergen|schadstofffrei|bpa-frei|dermatologisch\s+getestet|zertifiziert\w*|geprüfte?\s+qualität|gepruefte?\s+qualitaet|waterproof|dishwasher\s+safe|food\s+safe|hypoallergenic|certified)\b/i,
    grounding: /wasserfest|spülmaschinenfest|lebensmittelecht|hypoallergen|schadstofffrei|bpa|zertifiz|geprüft|geprueft|waterproof|dishwasher|food\s+safe|hypoallergenic|certified/i,
  },
  {
    name: 'garantie-versprechen',
    re: /\b(?:garantiert|garantie(?:rt)?\b|lebenslange?\s+garantie|lifetime\s+guarantee|\bmoney[- ]back\b)/i,
    grounding: /garantie|garantiert|guarantee|money[- ]back/i,
  },
  {
    name: 'absolutes-materialversprechen',
    re: /\b100\s*%\s*(?:bienenwachs|baumwolle|natur|rein|handmade|handgemacht|vegan|bio|organic|natural|cotton|beeswax)\b|\baus\s+100\s*%\b|\bmade\s+of\s+100\s*%\b/i,
    grounding: /100\s*%|bienenwachs|baumwolle|vegan|bio|organic|cotton|beeswax|natural/i,
  },
  // ── (d) Trend-/Beliebtheits-Behauptungen ───────────────────────────────────
  { name: 'trend-behauptung', re: /trend/i, grounding: /trend/i },
  {
    name: 'trending-en',
    re: /\b(?:is|are)\s+trending\b|\btrending\s+(?:now|this\s+year)\b|\bmust[- ]have\b/i,
    grounding: /trending|must[- ]have/i,
  },
  {
    name: 'alle-lieben',
    re: /\b(?:alle|jeder|jede)\s+(?:lieben|liebt|wollen|will|mögen|moegen|brauchen|braucht|suchen|sucht|kaufen|kauft)\b|\b(?:lieben|mögen|moegen)\s+alle\b|\beveryone\s+(?:loves|wants|needs|buys|is\s+buying)\b/i,
    grounding: /alle\s+lieben|jeder\s+liebt|everyone\s+loves|alle\s+wollen|beliebt/i,
  },
  {
    name: 'beliebteste-bestseller',
    re: /\b(?:beliebteste|beliebtester|beliebtesten|meistverkauft\w*|meistgekauft\w*|bestseller|best-?seller|verkaufsschlager|kultprodukt|most\s+popular)\b/i,
    grounding: /beliebt|bestseller|meistverkauft|verkaufsschlager|popular/i,
  },
  {
    name: 'jahr-trend-claim',
    re: /\b(?:der|die|das)\s+(?:neue|große|grosse)\s+(?:trend|hit)\b|\b20\d{2}\s*(?:trend|hit)\b|\btrend\s+20\d{2}\b/i,
    grounding: /trend|hit|20\d{2}/i,
  },
  // ── (e) Erfundene Fremd-URLs / Beispiel-Slugs ──────────────────────────────
  {
    name: 'fremd-url',
    re: /\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})(\/[^\s)"'<>]*)?/i,
    literal: true,
  },
  {
    name: 'fremd-slug',
    re: /(?:^|[\s(„"'’])\/[a-z0-9][a-z0-9-]{3,}(?:\/[a-z0-9-]+)*\/?/i,
    literal: true,
  },
];

/** Satz-Zerlegung (Satzenden + Zeilenumbrüche), wie im TikTok-Story-Check. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Satz mit einer erfundenen Behauptung? (Grounding + literal-Prüfung). */
function matchViolationsInSentence(sentence: string, groundingBlob: string): string[] {
  const hits: string[] = [];
  // Grounding-Muster sind kleingeschrieben (TikTok-Konvention) — der Vergleich
  // läuft deshalb gegen den kleingeschriebenen Nutzerkontext.
  const blob = (groundingBlob || '').toLowerCase();
  for (const pattern of FACT_PATTERNS) {
    const re = new RegExp(
      pattern.re.source,
      pattern.re.flags.includes('g') ? pattern.re.flags : pattern.re.flags + 'g',
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(sentence)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++;
      if (pattern.literal) {
        // Slug/Domain: nur erlaubt, wenn der Fund im Nutzerkontext steht.
        // Slugs werden wortweise geprüft (Bindestriche/Leerzeichen egal), damit
        // ein aus dem Nutzerthema gebildeter Slug nie geflaggt wird.
        const token = (m[1] ?? m[0]).trim().replace(/^[/\s(„"'’]+/, '').replace(/\/$/, '');
        if (token) {
          const lower = token.toLowerCase();
          const words = lower.split(/[-/.]/).filter((w) => w.length > 2);
          if (blob.includes(lower) || (words.length > 0 && words.every((w) => blob.includes(w)))) continue;
        }
      } else if (pattern.grounding && pattern.grounding.test(blob)) {
        continue; // vom Nutzer genannt ⇒ belegt, nie flaggen
      }
      hits.push(FACT_VIOLATION_PREFIX + pattern.name);
    }
  }
  return hits;
}

/**
 * Deterministischer Fakten-Check (satzweise, de+en): liefert die Namen aller
 * Verstöße (leer = konform). `groundingBlob` = alle Nutzerangaben
 * (Produktidee + Brief + Markenprofil + Projekt) — daraus belegte Begriffe
 * werden nie geflaggt.
 */
export function factViolations(text: string, groundingBlob: string): string[] {
  if (typeof text !== 'string' || text.trim() === '') return [];
  const hits: string[] = [];
  for (const sentence of splitSentences(text)) {
    hits.push(...matchViolationsInSentence(sentence, groundingBlob));
  }
  return [...new Set(hits)];
}

/** Prüft Titel + Body zusammen (Paket-Assets haben beide Teile). */
export function resultFactViolations(
  result: { title?: string; body?: string },
  groundingBlob: string,
): string[] {
  const blob = `${result.title ?? ''}\n${result.body ?? ''}`;
  return factViolations(blob, groundingBlob);
}

/** Letzte Instanz: entfernt jeden Satz mit einer erfundenen Behauptung. */
export function sanitizeFactText(text: string, groundingBlob: string): string {
  if (typeof text !== 'string' || text.trim() === '') return text;
  const parts = text.split(/(?<=[.!?])\s+|\n+/);
  const kept = parts.filter((part) => part.trim() === '' || matchViolationsInSentence(part, groundingBlob).length === 0);
  if (kept.length === parts.length) return text;
  return kept.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/** Satz-Eliminierung für ein ganzes Asset (Titel zuerst); leer = verwerfen. */
export function sanitizeFactResult<T extends { title: string; body: string }>(
  result: T,
  groundingBlob: string,
): T {
  const title = sanitizeFactText(result.title, groundingBlob).trim();
  const body = sanitizeFactText(result.body, groundingBlob).trim();
  if (title === result.title && body === result.body) return result;
  return { ...result, title, body };
}

/** Lesbare Beschreibung eines Verstoßes für den Korrektur-Hinweis. */
const VIOLATION_LABELS: Record<string, { de: string; en: string }> = {
  anekdote: {
    de: 'erfundene persönliche Ich-Erzählung/Anekdote des Verkäufers',
    en: 'invented first-person seller anecdote',
  },
  lieferzeit: { de: 'erfundene Liefer-/Versandzeit', en: 'invented delivery/shipping time' },
  delivery: { de: 'erfundene Liefer-/Versandzeit', en: 'invented delivery/shipping time' },
  'in-x-tagen-wochen': {
    de: 'erfundene Liefer-/Bearbeitungszeit („in X Tagen/Wochen")',
    en: 'invented delivery/processing time',
  },
  versandkostenfrei: { de: 'erfundene Versandkosten-Zusage', en: 'invented free-shipping promise' },
  rueckgaberecht: { de: 'erfundene Rückgabe-/Umtauschregel', en: 'invented return policy' },
  bearbeitungszeit: { de: 'erfundene Bearbeitungszeit', en: 'invented processing time' },
  'versand-zusage': { de: 'erfundene Versandzusage', en: 'invented shipping promise' },
  preis: { de: 'erfundener Preis', en: 'invented price' },
  'preis-ohne-grundlage': { de: 'erfundener Preis', en: 'invented price' },
  zertifikat: { de: 'erfundenes Zertifikat/Material- oder Wirkversprechen', en: 'invented certification or material/effect claim' },
  garantie: { de: 'erfundenes Garantieversprechen', en: 'invented guarantee' },
  'absolutes-materialversprechen': {
    de: 'erfundenes absolutes Materialversprechen',
    en: 'invented absolute material claim',
  },
  trend: { de: 'unbelegte Trend-Behauptung', en: 'unsubstantiated trend claim' },
  'alle-lieben': {
    de: 'unbelegte „alle lieben das"-Behauptung',
    en: 'unsubstantiated "everyone loves it" claim',
  },
  beliebteste: { de: 'unbelegte Beliebtheits-/Bestseller-Behauptung', en: 'unsubstantiated popularity claim' },
  'fremd-url': { de: 'erfundene Fremd-URL', en: 'invented foreign URL' },
  'fremd-slug': { de: 'erfundener Fremd-Beispiel-Slug', en: 'invented foreign example slug' },
};

/** Kurzlabel eines Verstoßes (de+en) für den Retry-Hinweis. */
export function factViolationLabels(violations: string[]): string[] {
  const labels = new Set<string>();
  for (const v of violations) {
    const name = v.startsWith(FACT_VIOLATION_PREFIX) ? v.slice(FACT_VIOLATION_PREFIX.length) : v;
    const key = Object.keys(VIOLATION_LABELS).find((k) => name.includes(k));
    if (key) labels.add(`${VIOLATION_LABELS[key].de} / ${VIOLATION_LABELS[key].en}`);
  }
  return [...labels];
}

/**
 * Korrektur-Hinweis für den EINEN wiederholten Versuch nach einem Fakten-Verstoß
 * (Muster Stabilisierung 4.2). Zweisprachig, weil der Server die UI-Sprache nicht
 * kennt; nennt die konkreten Verstoß-Kategorien.
 */
export function factGuardCorrection(violations: string[]): string {
  const labels = factViolationLabels(violations);
  const list = labels.length > 0 ? labels.join('; ') : 'erfundene Fakten / invented facts';
  return `⚠️ FAKTEN-KORREKTUR (der vorherige Versuch wurde verworfen): Die vorherige Ausgabe enthielt erfundene Fakten, die NICHT in den Nutzerangaben stehen: ${list}. Schreibe die Ausgabe neu und entferne diese Angaben vollständig (kein Ich-Erzähler, keine Lieferzeit, keine Rückgaberegel, keinen Preis, keine Trend-Behauptung, keinen fremden Slug/Link). Nutze ausschließlich Fakten aus den Nutzerangaben; wenn du keine belegte Angabe hast, lasse den Punkt weg oder formuliere allgemein ohne Zahl, Zusage und Namen. — EN: The previous output contained invented facts not present in the user input (${list}). Rewrite it without them: no first-person seller anecdotes, no delivery/return promises, no prices, no trend claims, no foreign slugs/links — use only facts from the user input, otherwise omit or phrase generally.`;
}

/**
 * Ehrliche Fehlermeldung, wenn ein Paket-Kanal auch nach der Satz-Eliminierung
 * keine faktenfreie Ausgabe hergibt: es wird NICHTS erfunden ausgeliefert.
 */
export const FACT_GUARD_ERROR =
  'Die Ausgabe enthielt erfundene Angaben (z. B. Lieferzeit, Rückgaberegel, Preis, Trend-Behauptung oder einen fremden Slug), die nicht aus deinen Angaben stammen, und konnte nicht bereinigt werden. Bitte ergänze die fehlenden Fakten (z. B. Lieferzeit, Versand, Preis) in deiner Produktidee oder im Markenprofil und starte die Generierung erneut. — EN: The output contained invented facts (e.g. delivery time, return policy, price, trend claim or a foreign slug) that were not part of your input and could not be cleaned. Please add the missing facts (e.g. delivery time, shipping, price) to your product idea or brand profile and generate again.';

/**
 * Grounding-Blob aus dem Paket-Kontext bauen: Nutzerangaben sind belegt.
 * Der „Gemeinsame Strategie-Kern" ist LLM-generiert und wird bewusst entfernt
 * (sonst könnte ein vom Modell formulierter Hook wie „Trend" den Check
 * versehentlich entwaffnen).
 */
export function buildFactGrounding(request: {
  productIdea?: string;
  additionalContext?: string;
  factGrounding?: string;
}): string {
  const explicit = typeof request.factGrounding === 'string' ? request.factGrounding.trim() : '';
  const context = typeof request.additionalContext === 'string' ? request.additionalContext : '';
  const withoutKernel = context.replace(/^Gemeinsamer Strategie-Kern[\s\S]*?(?=\n\n|$)/, '');
  return [request.productIdea ?? '', explicit, withoutKernel].filter(Boolean).join('\n');
}
