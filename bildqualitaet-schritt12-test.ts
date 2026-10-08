/**
 * Bildqualität Schritt 1+2 (Owner-Freigabe 2026-10-07) — Verifikations-Suite.
 * Rein quelltext-/funktionsbasiert (keine DB, kein Netz) — `bun bildqualitaet-schritt12-test.ts`.
 *
 * SCHRITT 1 (P1-Separatoren-Fix, src/ai/fact-guard.ts#sanitizeFactText):
 *   a) der verstoßende Satz fliegt weiterhin (Fakten-Entscheidung unverändert),
 *   b) die Abschnittsstruktur (Zeilenumbrüche vor nummerierten Überschriften)
 *      bleibt erhalten — kein Ein-Zeiler, Bildprompt-Abschnitt 9 bleibt
 *      extrahierbar und wird in ENGLISCHER Sprache gelesen,
 *   c) fakt-freie Bodies kommen byte-identisch zurück (Referenz-Identität),
 *   d) Vorher/Nachher: der alte Re-Join kollabiert denselben Body auf EINE Zeile,
 *      der neue nicht; die Auswahl der Sätze ist in beiden Varianten identisch.
 *
 * SCHRITT 2 (Env-Schalter für quality, src/ai/image-providers/generate.ts):
 *   Default 'high' (fail-closed), nur low|medium|high werden durchgelassen,
 *   beide Pfade (generate + edit/Variation) nutzen denselben Wert,
 *   input_fidelity/Referenz-Mechanik unverändert.
 */
import { readFileSync } from 'node:fs';
import {
  sanitizeFactResult,
  sanitizeFactText,
  factViolations,
  resultFactViolations,
} from './src/ai/fact-guard';
import { extractStrategyImage } from './src/lib/strategy-image';
import { resolveImageQuality } from './src/ai/image-providers/generate';

let failures = 0;
let passes = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) {
    failures++;
    console.log('FAIL:', name, '—', detail);
  } else {
    passes++;
    console.log('PASS:', name);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture A: Pinterest-Body mit EINER erfundenen Behauptung („300 ml" +
// „in 3-5 Werktagen" sind nirgends vom Nutzer belegt) — Abschnitt 8/9/10 bleiben
// inhaltlich sauber und müssen die Bereinigung überleben.
// ─────────────────────────────────────────────────────────────────────────────
const GROUNDING = 'Produktidee: handgemachte Keramikvase für Wohnzimmer-Deko.';
const PINTEREST_BODY = `1. SEO Pin-Titel
Handgemachte Keramikvase — warm und schlicht
2. Pin-Beschreibung
Diese Vase bringt Ruhe in dein Wohnzimmer. Sie fasst 300 ml und ist in 3-5 Werktagen bei dir.
3. Fokus-Keywords
keramik vase, wohnzimmer deko
4. Hashtags
#Wohnen #Keramik
5. Call to Action
Hol dir die Vase.
6. Designempfehlung
Boho-Warm — ein warmer Look.
7. Pin-Kategorie
DIY & Handwerk — passt perfekt.
8. Bildkonzept
Farbpalette: warmes Beige. Komposition: 2:3 vertikal, Vase in der Mitte.
9. KI-Bild-Prompt (ENGLISCH)
Hyperrealistic product photography of a handmade ceramic vase on a linen table,
warm afternoon light, shallow depth of field, 2:3 vertical, Pinterest editorial, 8k.
10. Pinterest Alt-Text
Handgemachte Keramikvase auf Leinentisch`;

// Alte (fehlerhafte) Re-Join-Mechanik — Referenz für den Vorher/Nachher-Vergleich.
function oldSanitizeFactText(text: string, grounding: string): string {
  const parts = text.split(/(?<=[.!?])\s+|\n+/);
  const kept = parts.filter((part) => part.trim() === '' || factViolations(part, grounding).length === 0);
  if (kept.length === parts.length) return text;
  return kept.join(' ').replace(/\s{2,}/g, ' ').trim();
}

// ── SCHRITT 1 — Vorbedingung: die Fixture löst den Fakten-Schutz wirklich aus ─
const fixtureViolations = resultFactViolations(
  { title: '', body: PINTEREST_BODY },
  GROUNDING,
);
check(
  'Vorbedingung: Fixture enthält einen erkannten Fakten-Verstoß (Guard greift)',
  fixtureViolations.length > 0,
  JSON.stringify(fixtureViolations),
);

const sanitized = sanitizeFactResult(
  { title: 'Handgemachte Keramikvase', body: PINTEREST_BODY },
  GROUNDING,
);
const body = sanitized.body;
const headingCountBefore = (PINTEREST_BODY.match(/^\d{1,2}\. /gm) ?? []).length;
const headingCountAfter = (body.match(/^\d{1,2}\. /gm) ?? []).length;

// (a) Fakten-Entscheidung unverändert: der verstoßende Satz ist weg, der
//     unschuldige Satz desselben Absatzes steht weiterhin da.
check('(a) verstoßender Satz entfernt (300 ml / 3-5 Werktage weg)', !body.includes('300 ml') && !body.includes('3-5 Werktagen'), body.slice(0, 200));
check('(a) unschuldiger Satz im selben Absatz bleibt', body.includes('Diese Vase bringt Ruhe in dein Wohnzimmer.'));

// (b) Struktur bleibt erhalten.
check(
  '(b) Abschnitts-Überschriften bleiben als EIGENE Zeilen erhalten',
  headingCountAfter === headingCountBefore && headingCountBefore >= 10,
  `vorher=${headingCountBefore} nachher=${headingCountAfter}`,
);
check(
  '(b) Abschnitt 9 steht mit Zeilenumbruch davor (kein Ein-Zeiler)',
  body.includes('\n9. KI-Bild-Prompt (ENGLISCH)\n'),
  JSON.stringify(body.slice(body.indexOf('8. Bildkonzept'))),
);
check('(b) Body ist kein Ein-Zeiler', body.split('\n').length >= 10, `Zeilen=${body.split('\n').length}`);
check(
  '(b) englischer Bildprompt-Text steht unter Abschnitt 9',
  /9\. KI-Bild-Prompt \(ENGLISCH\)\nHyperrealistic product photography/.test(body),
);
check('(b) kein Rest-Doppelleerzeichen im Ergebnis', !/[^\S\n]{2,}/.test(body));

// (b) Der Bildprompt ist über den echten Parser extrahierbar — und auf ENGLISCH.
const payload = extractStrategyImage(body, 'pinterest_pin');
check('(b) extractStrategyImage liefert einen Payload (Button/Studio erreichbar)', payload !== null, String(payload));
check(
  '(b) extrahierter Prompt ist der ENGLISCHE Abschnitt 9',
  !!payload && payload.prompt.startsWith('Hyperrealistic product photography'),
  payload?.prompt?.slice(0, 120) ?? 'null',
);
check(
  '(b) extrahierter Prompt enthält KEINEN deutschen Abschnitt (8/10)',
  !!payload && !/Farbpalette|Leinentisch/.test(payload.prompt),
  payload?.prompt ?? 'null',
);
check('(b) Seitenverhältnis 2:3 kommt mit', payload?.ratio === '2:3', String(payload?.ratio));

// (d) Vorher/Nachher: der alte Re-Join zerstört genau diese Struktur.
const oldBody = oldSanitizeFactText(PINTEREST_BODY, GROUNDING);
check('(d) ALTER Re-Join kollabiert den Body auf EINE Zeile (Bug belegt)', oldBody.split('\n').length === 1 && oldBody.length > 300, `Zeilen=${oldBody.split('\n').length}`);
check('(d) alte Fassung: Überschrift „9.\u2026" nicht mehr am Zeilenanfang', !/^9\. /m.test(oldBody) && !oldBody.includes('\n9. '));
// Semantik-Neutralität: beide Fassungen wählen DIESELBEN Sätze, nur die
// Separatoren unterscheiden sich (Whitespace-normalisiert identisch).
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
check(
  '(d) Satz-Auswahl identisch alt/neu (nur Separatoren unterscheiden sich)',
  normalize(oldBody) === normalize(body),
  `alt=${normalize(oldBody).length} neu=${normalize(body).length}`,
);

// (c) Fakt-freie Bodies bleiben byte-identisch (Identität des Objekts).
const CLEAN_BODY = PINTEREST_BODY.replace(
  'Diese Vase bringt Ruhe in dein Wohnzimmer. Sie fasst 300 ml und ist in 3-5 Werktagen bei dir.',
  'Diese Vase bringt Ruhe in dein Wohnzimmer.',
);
const cleanResult = { title: 'Handgemachte Keramikvase', body: CLEAN_BODY };
const cleanOut = sanitizeFactResult(cleanResult, GROUNDING);
check('(c) Vorbedingung: fakt-freier Body hat 0 Verstöße', factViolations(CLEAN_BODY, GROUNDING).length === 0);
check('(c) fakt-freier Body kommt OBJEKT-identisch zurück', cleanOut === cleanResult);
check('(c) fakt-freier Body byte-identisch (Strings)', cleanOut.body === CLEAN_BODY && cleanOut.title === cleanResult.title);
check(
  '(c) sanitizeFactText gibt text ohne Verstoß unverändert zurück',
  sanitizeFactText(CLEAN_BODY, GROUNDING) === CLEAN_BODY,
);

// (c) Regression auf ECHTEN Produktions-Daten: der 2026-10-05 gesicherte
//     kollabierte Etsy-Body (0 Umbrüche) darf durch den Fix NICHT verändert
//     werden — dort gibt es keine Struktur zu retten, die Satz-Auswahl ist gleich.
const collapsedReal = readFileSync('testdata/etsy-collapsed-2026-10-05.txt', 'utf8');
const collapsedNew = sanitizeFactText(collapsedReal, '');
const collapsedOld = oldSanitizeFactText(collapsedReal, '');
check('(c) echter kollabierter Prod-Body: alt == neu (identisches Ergebnis)', collapsedNew === collapsedOld, `alt=${collapsedOld.length} neu=${collapsedNew.length}`);
check('(c) echter kollabierter Prod-Body bleibt einzeilig', collapsedNew.split('\n').length === 1);

// (b2) Zwei-Sprachen-Fingerabdruck (live: DEUTSCH-Überschrift vor ENGLISCH):
//      alt liefert Deutsch, neu liefert Englisch.
const MIXED_BODY = `1. SEO Pin-Titel
Keramikvase
2. Pin-Beschreibung
Diese Vase ist in 3-5 Werktagen bei dir.
8. Bildkonzept
Farbpalette: warmes Beige.
9. Pinterest-Bildprompt (DEUTSCH)
Eine hyperrealistische Produktfotografie einer Keramikvase auf einem Leinentisch.
10. KI-Bild-Prompt (ENGLISCH)
Hyperrealistic product photography of a handmade ceramic vase, warm afternoon light, 2:3 vertical.
11. Pinterest Alt-Text
Vase auf Leinentisch`;
check(
  '(b2) Vorbedingung: MIXED_BODY löst die Satz-Eliminierung aus',
  factViolations(MIXED_BODY, GROUNDING).length > 0,
  JSON.stringify(factViolations(MIXED_BODY, GROUNDING)),
);
const mixedNew = sanitizeFactResult({ title: '', body: MIXED_BODY }, GROUNDING);
const mixedOldBody = oldSanitizeFactText(MIXED_BODY, GROUNDING);
const mixedOldPayload = extractStrategyImage(mixedOldBody, 'pinterest_pin');
const mixedNewPayload = extractStrategyImage(mixedNew.body, 'pinterest_pin');
check(
  '(b2) NEU: englischer Prompt gewinnt (Struktur erhalten)',
  !!mixedNewPayload && mixedNewPayload.prompt.startsWith('Hyperrealistic product photography'),
  mixedNewPayload?.prompt?.slice(0, 90) ?? 'null',
);
check(
  // Schritt 4 (2026-10-07) hat den Befund behoben, den diese Zeile dokumentierte:
  // der kollabierte DE/EN-gemischte Body liefert jetzt ENGLISCH statt Deutsch.
  '(b2) kollabierte DE/EN-Fassung liefert ENGLISCH (Schritt 4: Sprachregel)',
  (mixedNewPayload?.prompt ?? '').startsWith('Hyperrealistic'),
  mixedNewPayload?.prompt?.slice(0, 90) ?? 'null',
);

// ── SCHRITT 2 ────────────────────────────────────────────────────────────────
const ENV_KEY = 'IMAGE_QUALITY';
const prevEnv = process.env[ENV_KEY];
function withEnv(value: string | undefined, fn: () => void) {
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
  try {
    fn();
  } finally {
    if (prevEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prevEnv;
  }
}
withEnv(undefined, () => check("(2) Default ohne Env-Variable = 'high'", resolveImageQuality() === 'high', resolveImageQuality()));
withEnv('high', () => check("(2) IMAGE_QUALITY=high = 'high'", resolveImageQuality() === 'high'));
withEnv('medium', () => check("(2) IMAGE_QUALITY=medium = 'medium' (Rückweg zur alten Stufe)", resolveImageQuality() === 'medium'));
withEnv('low', () => check("(2) IMAGE_QUALITY=low = 'low'", resolveImageQuality() === 'low'));
for (const bad of ['auto', 'xhigh', 'max', 'x-high', 'HIGH', 'Medium', '', ' ', 'true', '2']) {
  withEnv(bad, () =>
    check(
      `(2) ungültiger Wert ${JSON.stringify(bad)} fällt fail-closed auf 'high'`,
      resolveImageQuality() === 'high',
      resolveImageQuality(),
    ),
  );
}

// Quelltext-Checks: beide Pfade nutzen denselben Wert, keine harte 'medium'-Angabe mehr.
const genSrc = readFileSync('src/ai/image-providers/generate.ts', 'utf8');
check('(2) keine hart verdrahtete quality-Angabe mehr', !/quality:\s*['"]/.test(genSrc), (genSrc.match(/quality:[^\n]*/) ?? []).join(' | '));
const modelCallSites12 = (genSrc.match(/client\.images\.(generate|edit)\(/g) ?? []).length;
check('(2) alle Modell-Pfade übergeben `quality,` (generate + edit, inkl. Streaming)',
  modelCallSites12 >= 2 && (genSrc.match(/\n\s*quality,\n/g) ?? []).length === modelCallSites12,
  `sites=${modelCallSites12} quality=${(genSrc.match(/\n\s*quality,\n/g) ?? []).length}`);
check('(2) images.edit-Pfad: input_fidelity modellabhängig (gpt-image-2: weglassen, sonst 400)',
  /export function editFidelityOptions/.test(genSrc) && /modelSupportsInputFidelity/.test(genSrc) &&
  (genSrc.match(/\n\s*\.\.\.editFidelityOptions\(\),/g) ?? []).length === 2);
// Schritt 3 (2026-10-07) hat das Modell auf gpt-image-2 gehoben — hier wird die
// AKTUELLE Wahrheit geprueft (Modell, n:1, unveraenderte 2:3-Auflösung).
check('(2) model/size/n unverändert (Schritt 3: gpt-image-2, n: 1 je Modell-Call, SIZES-Map)', /const MODEL = 'gpt-image-2';/.test(genSrc) && (genSrc.match(/n: 1,/g) ?? []).length === modelCallSites12 && /'2:3': '1024x1536'/.test(genSrc), `n:1=${(genSrc.match(/n: 1,/g) ?? []).length} sites=${modelCallSites12}`);
check('(2) Edit-Pfad weiterhin über images.edit mit Referenzdatei', /client\.images\.edit\(/.test(genSrc) && /toFile\(parsed\.bytes/.test(genSrc));
check('(2) kein quality-Wert außerhalb des Schalters in generate.ts', !/'xhigh'|'max'|'auto'/.test(genSrc));

// ── Ergebnis ─────────────────────────────────────────────────────────────────
console.log(`\n=== bildqualitaet-schritt12-test: ${passes} PASS, ${failures} FAIL ===`);
if (failures > 0) {
  console.log('FEHLGESCHLAGEN');
  process.exit(1);
}
console.log('ALLE TESTS BESTANDEN');
