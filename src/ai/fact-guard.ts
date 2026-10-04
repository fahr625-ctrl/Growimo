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

/**
 * Strukturierte Nutzerangaben (Stabilisierung Schritt 2, Punkt 4): Produktdetails,
 * Brief-Antworten, Markenprofil-Angebote, Produktidee. Der Fakten-Check nutzt sie
 * als ERLAUBTE WERTELISTE — jede Zahl/Einheit bzw. jede Eigenschafts-Aussage im
 * Output muss dort (zahl-normalisiert) vorkommen. Rein additiv: fehlt das Feld,
 * gilt weiter die alte Extraktion aus Produktidee + Kontext.
 */
export interface DeclaredFacts {
  size?: string;
  material?: string;
  price?: string;
  shipping?: string;
  special?: string;
  /** Weitere wörtliche Nutzerangaben (Brief-Antworten, Markenprofil-Angebote). */
  extra?: string[];
}

/** Ein Muster mit optionalem Grounding gegen die Nutzerangaben. */
export interface FactPattern {
  name: string;
  re: RegExp;
  /**
   * Treffer im Nutzerkontext ⇒ nie flaggen (Nutzerangabe ist belegt).
   * Nur noch für Muster OHNE Wert-Prüfung (Anekdoten, Trend, Themen-Checks).
   */
  grounding?: RegExp;
  /** true = der gefundene Slug/die Domain muss wörtlich im Nutzerkontext stehen. */
  literal?: boolean;
  /**
   * Grounding-Verengung (Schritt 2, Punkt 2): die gefundene Aussage muss WÖRTLICH
   * im Nutzerkontext stehen (z. B. „spülmaschinenfest" nur, wenn der Nutzer das
   * selbst geschrieben hat). Ein bloßes Themen-Keyword entwaffnet nicht mehr.
   */
  claimLiteral?: boolean;
  /**
   * Grounding-Verengung (Schritt 2, Punkt 1+2): der konkrete Wert der Behauptung
   * (Zahl + Einheit bzw. Preis) wird aus dem Satz extrahiert und muss
   * zahl-normalisiert im Nutzerkontext vorkommen. „300 ml" im Output ist also nur
   * belegt, wenn der Nutzer „300 ml" (o. ä.) genannt hat — nicht bei „500 ml".
   */
  valueRe?: RegExp;
  /** true = ohne belegten Wert gilt die Aussage selbst dann als erfunden. */
  valueRequired?: boolean;
}

/** Kategorie-Präfix der Verstoß-Meldungen. */
export const FACT_VIOLATION_PREFIX = 'FACT:';

/**
 * Globale Prompt-Constraint (de+en) für JEDEN Kanal — Fakten dürfen nur aus den
 * Nutzerangaben stammen. Wird in providers/openai.ts an jeden System-Prompt
 * gehängt (5 Paket-Kanäle + Einzel-Kanäle + Strategie-Stream).
 */
export const FACT_PROTECTION_CONSTRAINT = `⚠️ FAKTEN-SCHUTZ (harte Regel): JEDES Faktum deiner Ausgabe muss aus den NUTZERANGABEN stammen (Produktidee, Strategie-Brief, Markenprofil, Projektdaten). Erlaubt ist ausschließlich, was dort steht oder sich zwingend daraus ergibt. VERBOTEN ist alles, was du selbst hinzuerfindest — insbesondere:
(1) persönliche Erlebnisse/Anekdoten des Verkäufers in der Ich-Form — schreibe in der Du-Ansprache oder neutral, ohne eigene Erlebnisse;
(2) Lieferzeiten, Versand- und Rückgabe-/Umtausch-Angaben ohne Nutzerbeleg — keine Frist, keine Versandkosten- und keine Bearbeitungszeit-Zusage;
(3) Preise, Zertifikate/Sicherheitsversprechen und Material-/Wirkversprechen, die der Nutzer nicht genannt hat;
(4) Produktmaße, Mengen, Füllmengen, Gewichte, Motiv-/Druckseiten und Lieferumfang/Verpackung: jede Zahl mit Einheit (ml, cl, l, g, kg, cm, mm, m, Zoll, Stück, Packung, %) sowie jede Aussage über ein- oder beidseitigen Druck, Geschenk- oder „persönliche" Verpackung NUR, wenn der Nutzer sie genannt hat;
(5) Trend-/Beliebtheits-Behauptungen ohne Nutzerbeleg;
(6) erfundene Fremd-URLs, Beispiel-Slugs oder Links zu anderen Shops/Artikeln.
Bei Unsicherheit gilt: den Punkt WEGLASSEN, „Auf Anfrage"/„Nicht angegeben" schreiben oder allgemein formulieren (ohne Zahl, ohne Zusage, ohne Namen) — NIEMALS erfinden. Beispiel-Slugs/URLs nur verwenden, wenn der Nutzer sie selbst genannt hat; sonst den Slug ausschließlich aus dem Fokus-Keyword des Nutzerthemas ableiten. Keine Vorher-/Nachher-Beispiele mit erfundenen Personen, Zahlen oder Ergebnissen.
 EN: Every fact in your output must come from the USER INPUT (product idea, brief, brand profile, project data) — nothing else. Never invent: first-person seller anecdotes or experiences; delivery/shipping/return/processing times or promises; prices, certifications, material or effect claims; product measurements/quantities, print-side or packaging/scope-of-delivery claims; trend/popularity claims ("trending", "everyone loves it", "bestseller", "2026"); or foreign example URLs/slugs. If you are unsure, omit the point or phrase it generally (no number, no promise, no name) — never make it up. Reuse an example slug/URL only if the user supplied it; otherwise derive the slug solely from the user's own focus keyword.`;

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

// ─────────────────────────────────────────────────────────────────────────────
// Stabilisierung Schritt 2 (Owner-Vorgabe 2026-10-02): KEINE erfundenen
// Produktfakten. Zwei Mechanismen, beide deterministisch (kein Prompt):
//   (1) NEUE KATEGORIE (f) „Produktmaße/-eigenschaften/-lieferumfang" de+en:
//       Zahlen+Einheiten, Motiv-/Druckseiten, Verpackung/Lieferumfang.
//   (2) GROUNDING-VERENGUNG: statt Keyword-Grounding über den Gesamtblob wird
//       pro Behauptung geprüft, ob der Nutzer den KONKRETEN Wert/Wort geliefert
//       hat. „USP=Schnelle Lieferung" oder „Preis=20–60 €" im Brief entwaffnen
//       damit keine Versand-/Preis-Behauptung mehr global.
// ─────────────────────────────────────────────────────────────────────────────

/** Einheiten für Mengen/Maße (Reihenfolge: längste Form zuerst). */
const MEASURE_UNIT_ALT =
  'milliliter|zentiliter|kilogramm|gramm|zentimeter|millimeter|milligramm|liter|litre|meter|metre|ml|cl|kg|cm|mm|mg|stueck|stück|stk|packung(?:en)?|pkg|inch|zoll|g|l|m|%';

/** Alle Einheiten incl. Zeitdauern (für die Wert-Normalisierung). */
const UNIT_ALT = `werktage?n?|arbeitstage?n?|business\\s+days?|working\\s+days?|wochen?|tage?n?|days?|weeks?|stunden?|std\\.?|hours?|${MEASURE_UNIT_ALT}`;

/** Menge/Maß im Text (kategorie f, Basis) — Zahl + Einheit. */
const MEASURE_RE = new RegExp(
  `(?:^|[^a-z0-9äöüß])(\\d{1,5}(?:[.,]\\d+)?(?:\\s*[-–—]\\s*\\d{1,5}(?:[.,]\\d+)?)?\\s*(?:${MEASURE_UNIT_ALT}))(?![\\wäöüß])`,
  'gi',
);

/** Dauer („in 3–5 Werktagen", „7 Tage", „2 business days"). */
const DURATION_VALUE_RE =
  /(\d{1,3}(?:[.,]\d+)?(?:\s*[-–—]\s*\d{1,3}(?:[.,]\d+)?)?)\s*(werktag\w*|arbeitstag\w*|business\s+days?|working\s+days?|wochen?|tage?n?|days?|weeks?|stunden?|std\.?|hours?)/i;

/** Preis („29 EUR", „29,90 €", "$29"). */
const PRICE_VALUE_RE =
  /(\d{1,5}(?:[.,]\d{1,2})?\s*(?:€|eur\b|euro\b|usd\b|dollar\b)|\$\s?\d{1,5}(?:[.,]\d{1,2})?)/i;

/** Kanonische Einheit — damit „500 ml" ⇔ „500ml" und „3-5 Tagen" ⇔ „3–5 Tage". */
function canonUnit(raw: string): string {
  const s = raw.toLowerCase().replace(/\.$/, '').trim();
  if (s.startsWith('werktag')) return 'werktag';
  if (s.startsWith('arbeitstag')) return 'arbeitstag';
  if (s.startsWith('business')) return 'businessday';
  if (s.startsWith('working')) return 'workingday';
  if (s.startsWith('woche')) return 'woche';
  if (s.startsWith('tag')) return 'tag';
  if (s === 'day' || s === 'days') return 'day';
  if (s === 'week' || s === 'weeks') return 'week';
  if (s.startsWith('stunde') || s === 'std' || s.startsWith('hour')) return 'stunde';
  if (s === 'ml' || s.startsWith('milliliter')) return 'ml';
  if (s === 'cl' || s.startsWith('zentiliter')) return 'cl';
  if (s === 'kg' || s.startsWith('kilogramm')) return 'kg';
  if (s === 'g' || s.startsWith('gramm')) return 'g';
  if (s === 'mg' || s.startsWith('milligramm')) return 'mg';
  if (s === 'l' || s.startsWith('liter') || s === 'litre') return 'l';
  if (s === 'cm' || s.startsWith('zentimeter')) return 'cm';
  if (s === 'mm' || s.startsWith('millimeter')) return 'mm';
  if (s === 'm' || s.startsWith('meter') || s.startsWith('metre')) return 'm';
  if (s.startsWith('stueck') || s.startsWith('stück') || s === 'stk') return 'stück';
  if (s.startsWith('packung') || s === 'pkg') return 'packung';
  if (s === 'zoll') return 'zoll';
  if (s === 'inch') return 'inch';
  return s;
}

/** Zahl-normalisierter Schlüssel eines Wertes („300 ml" → `300|ml`). */
export function factValueKey(raw: string): string {
  const nums = (raw.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));
  const text = raw.toLowerCase();
  let unit: string;
  if (/€|eur\b|euro\b/.test(text)) unit = 'eur';
  else if (/\$|usd\b|dollar\b/.test(text)) unit = 'usd';
  else {
    const um = text.match(new RegExp(UNIT_ALT));
    unit = um ? canonUnit(um[0]) : 'x';
  }
  return `${nums.join('~')}|${unit}`;
}

/** Alle belegten Werte des Nutzerkontexts (Zahl-normalisiert, als Set). */
export function declaredFactValues(blob: string): Set<string> {
  const out = new Set<string>();
  const scan = (re: RegExp): void => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(blob)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++;
      out.add(factValueKey(m[1] ?? m[0]));
    }
  };
  scan(new RegExp(DURATION_VALUE_RE.source, 'gi'));
  scan(new RegExp(PRICE_VALUE_RE.source, 'gi'));
  scan(new RegExp(MEASURE_RE.source, 'gi'));
  return out;
}

/** Umlaut-/Schreibvarianten-tolerant (spuelmaschinenfest ⇔ spülmaschinenfest). */
function normalizeClaim(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Leichte deutsche Stammform — damit „persönlicher Verpackung" im Output durch
 * „Persönliche Verpackung" des Nutzers belegt ist (Flexion egal). Es werden nur
 * Wortendungen abgeschnitten, nie Wortanfänge: der Stamm bleibt als Teilstring
 * in jeder flektierten Form des Nutzerworts enthalten.
 */
function claimStem(word: string): string {
  const w = normalizeClaim(word).replace(/[^a-z0-9%]/g, '');
  if (w.length <= 5) return w;
  for (const suffix of ['ungen', 'ung', 'lich', 'isch', 'ig', 'ern', 'ers', 'en', 'er', 'es', 'em', 'e', 's']) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 4) return w.slice(0, w.length - suffix.length);
  }
  return w;
}

/** Stämme eines Ausdrucks (≥4 Zeichen) für den wörtlichen Beleg-Check. */
function claimStems(phrase: string): string[] {
  return normalizeClaim(phrase)
    .replace(/[^a-z0-9% ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(claimStem)
    .filter((s) => s.length >= 4);
}

/**
 * Kategorie (f) — Produktmaße/-eigenschaften/-lieferumfang (de+en).
 * Jede Behauptung braucht einen WERT im Nutzerkontext oder das wörtliche Wort.
 */
FACT_PATTERNS.push(
  {
    // Zahlen + Einheiten: „300 ml", „20 cm", „250 g", „30 %", „2 Stück".
    name: 'produktmass-einheit',
    re: MEASURE_RE,
    valueRe: MEASURE_RE,
    valueRequired: true,
  },
  {
    // Motiv-/Druckseiten: erfindet, wie das Motiv auf dem Produkt sitzt.
    name: 'motivseite',
    re: /\b(?:ein|zwei|beid|doppel)seitig\w*|\bvorder-?\s*und\s*rückseite\w*|\bsingle[- ]sided\b|\bdouble[- ]sided\b|\bone[- ]sided\b|\btwo[- ]sided\b|\bprinted\s+on\s+(?:one|both)\s+sides?\b|\bprint(?:ed)?\s+on\s+one\s+side\b/i,
    claimLiteral: true,
  },
  {
    // Verpackungs-/Personalisierungs-Zusage („persönliche Verpackung").
    name: 'verpackungs-zusage',
    re: /persönlich\w*\s+verpack\w*|personalisiert\w*\s+verpack\w*|(?:hübsch|schön|liebevoll|aufwendig|handverpackt)\w*\s+verpack\w*|geschenkverpackung\w*|gift[- ]?wrap\w*|gift\s+packaging\b|free\s+gift\s+wrap\b/i,
    claimLiteral: true,
  },
  {
    // Lieferumfang/Zubehör-Zusage ohne Nutzerangabe.
    name: 'lieferumfang',
    re: /\bim\s+lieferumfang\b|\blieferumfang\s*:|\bwas\s+du\s+bekommst\b|\bwhat'?s\s+included\b|\binklusive\s+(?:geschenkverpackung|verpackung|anhänger|zubehör|zubehoer)\b|\bincluded\s+in\s+(?:the\s+)?(?:box|package|set)\b/i,
    grounding: /lieferumfang|was\s+du\s+bekommst|what'?s\s+included|inklusive\s+(?:geschenkverpackung|verpackung|anhänger|zubehör|zubehoer)|zubehör|zubehoer/i,
  },
);

/**
 * Grounding-Verengung (Schritt 2, Punkt 2): pro Kategorie festlegen, WELCHER
 * Beleg entwaffnet. `grounding: undefined` entfernt bewusst das alte
 * Keyword-Grounding (Themen-Treffer entwaffnete sonst die ganze Kategorie).
 */
const PATTERN_VERIFICATION: Record<string, Partial<FactPattern>> = {
  // (b) Lieferzeit/Versand: nur ein konkreter, vom Nutzer genannter Wert zählt.
  lieferzeit: { valueRe: DURATION_VALUE_RE, valueRequired: false, grounding: undefined },
  'in-x-tagen-wochen': { valueRe: DURATION_VALUE_RE, valueRequired: true, grounding: undefined },
  'versand-zusage': { valueRe: DURATION_VALUE_RE, valueRequired: false, grounding: undefined },
  versandkostenfrei: { claimLiteral: true, grounding: undefined },
  bearbeitungszeit: { claimLiteral: true, valueRe: DURATION_VALUE_RE, valueRequired: false, grounding: undefined },
  // Rückgabe: Themenwort des Nutzers UND (falls eine Zahl fällt) der belegte Wert.
  rueckgaberecht: { valueRe: DURATION_VALUE_RE, valueRequired: false },
  // (c) Preis: nur der WÖRTLICH genannte Preis entwaffnet (keine Preisspanne).
  'preis-ohne-grundlage': { valueRe: PRICE_VALUE_RE, valueRequired: true, grounding: undefined },
  'zertifikat-wirkung': { claimLiteral: true, grounding: undefined },
  'garantie-versprechen': { claimLiteral: true, grounding: undefined },
  'absolutes-materialversprechen': { claimLiteral: true, grounding: undefined },
};
for (const pattern of FACT_PATTERNS) {
  const override = PATTERN_VERIFICATION[pattern.name];
  if (override) Object.assign(pattern, override);
}

/** Satz-Zerlegung (Satzenden + Zeilenumbrüche), wie im TikTok-Story-Check. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strukturierte Nutzerangaben als Textblob (Teil des erlaubten Kontexts). */
export function declaredFactBlob(declared?: DeclaredFacts): string {
  if (!declared) return '';
  const extra = Array.isArray(declared.extra) ? declared.extra : [];
  return [declared.size, declared.material, declared.price, declared.shipping, declared.special, ...extra]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .join('\n');
}

/** Prüf-Kontext = freier Grounding-Blob + strukturierte Nutzerangaben. */
export function buildCheckContext(groundingBlob: string, declared?: DeclaredFacts): string {
  const blob = typeof groundingBlob === 'string' ? groundingBlob : '';
  return [blob, declaredFactBlob(declared)].filter(Boolean).join('\n');
}

/**
 * MENGEN-PRÜFUNG (Schritt 2, Punkt 3) — analog zum Slug-literal-Mechanismus:
 * jede Zahl+Einheit im Output (ml|cl|l|g|kg|cm|mm|m|Zoll|Stück|%) muss
 * zahl-normalisiert in den Nutzerdaten vorkommen, sonst ist sie eine Erfindung.
 * Liefert die ungedeckten Werte (leer = konform) — die Namen der Verstöße
 * kommen aus `factViolations()` (`FACT:produktmass-einheit`).
 */
export function quantityViolations(
  text: string,
  groundingBlob: string,
  declared?: DeclaredFacts,
): string[] {
  if (typeof text !== 'string' || text.trim() === '') return [];
  const allowed = declaredFactValues(buildCheckContext(groundingBlob, declared));
  const out: string[] = [];
  const re = new RegExp(MEASURE_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++;
    const token = (m[1] ?? m[0]).trim();
    if (!allowed.has(factValueKey(token))) out.push(token);
  }
  return [...new Set(out)];
}

/** Satz mit einer erfundenen Behauptung? (Grounding + literal-Prüfung). */
function matchViolationsInSentence(
  sentence: string,
  groundingBlob: string,
  declaredValues: Set<string>,
): string[] {
  const hits: string[] = [];
  // Grounding-Muster sind kleingeschrieben (TikTok-Konvention) — der Vergleich
  // läuft deshalb gegen den kleingeschriebenen Nutzerkontext.
  const blob = (groundingBlob || '').toLowerCase();
  const claimBlob = normalizeClaim(groundingBlob || '');
  for (const pattern of FACT_PATTERNS) {
    const re = new RegExp(
      pattern.re.source,
      pattern.re.flags.includes('g') ? pattern.re.flags : pattern.re.flags + 'g',
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(sentence)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++;
      if (isGrounded(pattern, m, sentence, blob, claimBlob, declaredValues)) continue;
      hits.push(FACT_VIOLATION_PREFIX + pattern.name);
    }
  }
  return hits;
}

/**
 * Entwaffnet eine Behauptung? ALLE vorhandenen Prüfmechanismen müssen bestehen:
 *   - `literal`      = Slug/Domain steht wörtlich im Nutzerkontext (wortweise).
 *   - `claimLiteral` = der gefundene Ausdruck steht wörtlich im Nutzerkontext.
 *   - `valueRe`      = der konkrete Wert (Zahl+Einheit/Preis) des Satzes kommt
 *                      zahl-normalisiert in den Nutzerdaten vor.
 *   - `grounding`    = Themen-Keyword (nur noch bei Mustern ohne Wert-Prüfung).
 */
function isGrounded(
  pattern: FactPattern,
  m: RegExpExecArray,
  sentence: string,
  blob: string,
  claimBlob: string,
  declaredValues: Set<string>,
): boolean {
  if (pattern.literal) {
    // Slug/Domain: nur erlaubt, wenn der Fund im Nutzerkontext steht.
    // Slugs werden wortweise geprüft (Bindestriche/Leerzeichen egal), damit
    // ein aus dem Nutzerthema gebildeter Slug nie geflaggt wird.
    const token = (m[1] ?? m[0]).trim().replace(/^[/\s(„"'’]+/, '').replace(/\/$/, '');
    if (!token) return false;
    const lower = token.toLowerCase();
    const words = lower.split(/[-/.]/).filter((w) => w.length > 2);
    return blob.includes(lower) || (words.length > 0 && words.every((w) => blob.includes(w)));
  }
  let verified = false;
  if (pattern.claimLiteral) {
    // Wörtlicher Beleg: der Nutzer muss die Aussage selbst formuliert haben.
    // Zahlen im Ausdruck (z. B. „100 %") zählen dabei wörtlich, Wörter stammweise
    // (Flexion egal) — ein bloßes Themen-Keyword entwaffnet NICHT mehr.
    const matched = normalizeClaim(m[0]);
    const digits = matched.match(/\d+(?:[.,]\d+)?/g) ?? [];
    const stems = claimStems(matched);
    if (digits.length === 0 && stems.length === 0) return false;
    if (digits.some((d) => !claimBlob.includes(d))) return false;
    if (stems.some((s) => !claimBlob.includes(s))) return false;
    verified = true;
  }
  if (pattern.valueRe) {
    const valueMatch = sentence.match(pattern.valueRe);
    if (!valueMatch) {
      // Kein konkreter Wert im Satz: Pflicht-Wert-Muster ⇒ Verstoß,
      // sonst (valueRequired false) reicht der Themen-/Wort-Beleg.
      if (pattern.valueRequired) return false;
    } else if (!declaredValues.has(factValueKey(valueMatch[1] ?? valueMatch[0]))) {
      return false; // Wert genannt, aber NICHT vom Nutzer — z. B. 300 vs 500 ml
    }
    verified = true;
  }
  if (pattern.grounding) {
    if (!pattern.grounding.test(blob)) return false;
    verified = true;
  }
  return verified;
}

/**
 * Deterministischer Fakten-Check (satzweise, de+en): liefert die Namen aller
 * Verstöße (leer = konform).
 *
 * `groundingBlob` = alle Nutzerangaben (Produktidee + Brief + Markenprofil +
 * Projekt + declaredFacts). Belegt ist nur, was dort steht — bei Wert-Mustern
 * zusätzlich nur der KONKRETE genannte Wert (zahl-normalisiert).
 */
export function factViolations(
  text: string,
  groundingBlob: string,
  declared?: DeclaredFacts,
): string[] {
  if (typeof text !== 'string' || text.trim() === '') return [];
  const ctx = buildCheckContext(groundingBlob, declared);
  const values = declaredFactValues(ctx);
  const hits: string[] = [];
  for (const sentence of splitSentences(text)) {
    hits.push(...matchViolationsInSentence(sentence, ctx, values));
  }
  return [...new Set(hits)];
}

/** Prüft Titel + Body zusammen (Paket-Assets haben beide Teile). */
export function resultFactViolations(
  result: { title?: string; body?: string },
  groundingBlob: string,
  declared?: DeclaredFacts,
): string[] {
  const blob = `${result.title ?? ''}\n${result.body ?? ''}`;
  return factViolations(blob, groundingBlob, declared);
}

/** Letzte Instanz: entfernt jeden Satz mit einer erfundenen Behauptung. */
export function sanitizeFactText(
  text: string,
  groundingBlob: string,
  declared?: DeclaredFacts,
): string {
  if (typeof text !== 'string' || text.trim() === '') return text;
  const ctx = buildCheckContext(groundingBlob, declared);
  const values = declaredFactValues(ctx);
  const parts = text.split(/(?<=[.!?])\s+|\n+/);
  const kept = parts.filter(
    (part) => part.trim() === '' || matchViolationsInSentence(part, ctx, values).length === 0,
  );
  if (kept.length === parts.length) return text;
  return kept.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/** Satz-Eliminierung für ein ganzes Asset (Titel zuerst); leer = verwerfen. */
export function sanitizeFactResult<T extends { title: string; body: string }>(
  result: T,
  groundingBlob: string,
  declared?: DeclaredFacts,
): T {
  const title = sanitizeFactText(result.title, groundingBlob, declared).trim();
  const body = sanitizeFactText(result.body, groundingBlob, declared).trim();
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
  'produktmass-einheit': {
    de: 'erfundene Produktmaße/-menge (Zahl + Einheit)',
    en: 'invented product measurement/quantity (number + unit)',
  },
  motivseite: {
    de: 'erfundene Motiv-/Druckseiten-Angabe (einseitig/beidseitig)',
    en: 'invented print-side claim (one/two-sided)',
  },
  'verpackungs-zusage': {
    de: 'erfundene Verpackungs-/Personalisierungszusage',
    en: 'invented packaging/personalisation promise',
  },
  lieferumfang: {
    de: 'erfundener Lieferumfang/Verpackungsangabe',
    en: 'invented scope-of-delivery/packaging claim',
  },
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
  return `⚠️ FAKTEN-KORREKTUR (der vorherige Versuch wurde verworfen): Die vorherige Ausgabe enthielt erfundene Fakten, die NICHT in den Nutzerangaben stehen: ${list}. Schreibe die Ausgabe neu und entferne diese Angaben vollständig (kein Ich-Erzähler, keine Lieferzeit, kein Preis, keine Produktmaße/-mengen, keine Motiv-/Druckseiten- oder Verpackungsangabe ohne Nutzerbeleg, keine Trend-Behauptung, keinen fremden Slug/Link). Nutze ausschließlich Fakten aus den Nutzerangaben; wenn du keine belegte Angabe hast, schreibe „Auf Anfrage"/„Nicht zutreffend" oder lass den Punkt weg (ohne Zahl, Zusage und Namen). — EN: The previous output contained invented facts not present in the user input (${list}). Rewrite it without them: no first-person seller anecdotes, no delivery/return promises, no prices, no measurements/quantities, no print-side/packaging claims without user input, no trend claims, no foreign slugs/links — use only facts from the user input, otherwise answer "on request" or omit.`;
}

/**
 * Ehrliche Fehlermeldung, wenn ein Kanal auch nach der Satz-Eliminierung keine
 * faktenfreie Ausgabe hergibt: es wird NICHTS erfunden ausgeliefert.
 */
export const FACT_GUARD_ERROR =
  'Die Ausgabe enthielt Angaben (z. B. Lieferzeit, Preis, Produktmaße/-mengen, Motiv-/Druckseiten, Verpackung, Rückgaberegel, Trend-Behauptung oder einen fremden Slug), die nicht aus deinen Angaben stammen, und konnte nicht bereinigt werden. Bitte ergänze die fehlenden Fakten (z. B. Maße, Material, Lieferzeit, Versand, Preis) in deiner Produktidee, in den Produktdetails oder im Markenprofil und starte die Generierung erneut. — EN: The output contained claims (e.g. delivery time, price, measurements/quantities, print sides, packaging, return policy, trend claim or a foreign slug) that were not part of your input and could not be cleaned. Please add the missing facts (e.g. size, material, delivery time, shipping, price) to your product idea, product details or brand profile and generate again.';

/**
 * Grounding-Blob aus dem Kontext bauen: Nutzerangaben sind belegt.
 *
 * LLM-/Maschinen-generierte Blöcke werden bewusst entfernt, sonst könnte ein vom
 * Modell formulierter Kernel-Hook (z. B. „Trend") den Check entwaffnen. Entfernt
 * werden: „Gemeinsamer Strategie-Kern" (Paket), F9-Performance-Kontext (📈) und
 * F10-Lernprofil (🧠) — die dürfen NIE ins Grounding rutschen.
 *
 * `factGroundingStrict` (Progressive-Paket-Pfad): es zählen AUSSCHLIESSLICH die
 * explizit übergebenen Nutzerangaben (`factGrounding` + `declaredFacts` + Idee),
 * nicht der gemischte Kanal-Kontext.
 */
export function buildFactGrounding(request: {
  productIdea?: string;
  additionalContext?: string;
  factGrounding?: string;
  declaredFacts?: DeclaredFacts;
  factGroundingStrict?: boolean;
}): string {
  const explicit = typeof request.factGrounding === 'string' ? request.factGrounding.trim() : '';
  const context = typeof request.additionalContext === 'string' ? request.additionalContext : '';
  const withoutGenerated = stripGeneratedBlocks(context);
  const declared = declaredFactBlob(request.declaredFacts);
  const parts = request.factGroundingStrict
    ? [request.productIdea ?? '', declared, explicit]
    : [request.productIdea ?? '', declared, explicit, withoutGenerated];
  return parts.filter(Boolean).join('\n');
}

/** Marker der generierten (nicht-belegbaren) Kontextblöcke. */
const GENERATED_BLOCK_MARKERS = [
  'Gemeinsamer Strategie-Kern',
  '📈',
  '🧠',
  'What works for you',
  'Your learned preferences',
];

/**
 * Entfernt LLM-/maschinen-generierte Kontext-Absätze: der Check darf sich nur auf
 * Nutzerangaben stützen (Stabilisierung Schritt 2, Punkt 5).
 */
export function stripGeneratedBlocks(context: string): string {
  if (!context) return '';
  return context
    .split(/\n{2,}/)
    .filter((para) => {
      const head = para.trim();
      if (!head) return false;
      return !GENERATED_BLOCK_MARKERS.some((marker) => head.startsWith(marker));
    })
    .join('\n\n');
}
