// ── Befund Station 5 (2026-10-05): Bildprompt in Kollabierten Bodies ─────────
// Der Etsy-Body eines echten Live-Laufs (Projekt ab9ecc9a…, Keramiktassen,
// www.growimo.app, 2026-10-05 06:39 UTC) enthält den fertigen Prompt wörtlich
// („20. Pinterest-Bildprompt A close-up of a handmade ceramic cup …") — aber als
// EINZEILER: 0 Zeilenumbrüche, 0 Doppel-Leerzeichen. Das ist der Fingerabdruck
// der Satz-Eliminierung im Fakten-Schutz (`sanitizeFactText`, fact-guard.ts:
// `kept.join(' ').replace(/\s{2,}/g,' ')`), die beim Verwerfen eines Satzes den
// gesamten Text neu zusammenfügt.
//
// Vorher lieferte extractStrategyImage für so einen Body null → „Im Image
// Studio erstellen" fehlte. Diese Suite hält den Fall + die Regressionen fest.
import { extractStrategyImage } from './src/lib/strategy-image';
import { readFileSync } from 'fs';

let failures = 0;
function check(name: string, cond: boolean, detail: string) {
  if (!cond) { failures++; console.log('FAIL:', name, '—', detail); }
  else console.log('PASS:', name);
}

// Echter Live-Body (Rohkopie aus der DB, unverändert).
const collapsed = readFileSync('testdata/etsy-collapsed-2026-10-05.txt', 'utf8');

// 1) Fixture selbst belegen: kollabiert, aber Prompt vorhanden.
check('fixture is collapsed (0 newlines)', (collapsed.match(/\n/g) || []).length === 0,
  `newlines=${(collapsed.match(/\n/g) || []).length}`);
check('fixture has no double spaces (sanitizer fingerprint)', !/  /.test(collapsed), 'double space found');
check('fixture contains the literal prompt section', collapsed.includes('20. Pinterest-Bildprompt'), 'heading missing');
check('fixture contains the English prompt sentence',
  collapsed.includes('A close-up of a handmade ceramic cup with speckled glaze'), 'prompt text missing');

// 2) FIX: kollabierter Body liefert jetzt einen extrahierbaren Prompt.
const etsy = extractStrategyImage(collapsed, 'etsy_listing');
check('collapsed Etsy body yields a payload', etsy !== null, String(etsy));
if (etsy) {
  check('prompt length > 0 (Station-5-Kriterium)', etsy.prompt.length > 20, `${etsy.prompt.length}: ${etsy.prompt}`);
  check('prompt is the real English sentence',
    etsy.prompt.startsWith('A close-up of a handmade ceramic cup'), etsy.prompt);
  check('prompt keeps original capitalisation (no lowercasing)',
    etsy.prompt.includes('A close-up') && !etsy.prompt.startsWith('a close-up'), etsy.prompt);
  check('prompt is one line', !etsy.prompt.includes('\n'), 'multi-line prompt');
  check('prompt does not bleed into the next section',
    !etsy.prompt.includes('Instagram-Beitrag') && !etsy.prompt.includes('21.'), etsy.prompt);
  check('platform = Etsy', etsy.platform === 'Etsy', etsy.platform);
  check('ratio = 4:3 (Etsy heuristic)', etsy.ratio === '4:3', etsy.ratio);
}

// 3) Kein Prompt im Text ⇒ weiterhin null (kein falsch-positiver Knopf).
const collapsedNoPrompt =
  '1. SEO-Titel Eine Keramiktasse 2. Kurzbeschreibung Eine Tasse für den Morgen. ' +
  '3. Verbesserungsvorschläge Mehr Fotos zeigen. 4. FAQ Die Pflegehinweise findest du im Shop.';
check('collapsed body without prompt heading yields null',
  extractStrategyImage(collapsedNoPrompt, 'etsy_listing') === null,
  String(extractStrategyImage(collapsedNoPrompt, 'etsy_listing')));

// 4) Regression: der klassische, zeilenbasierte Body funktioniert unverändert.
const pinterestBody = `1. SEO Pin-Titel
Keramikvase für dein Wohnzimmer
2. Pin-Beschreibung
Kennst du das...?
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
Text-Overlay-Vorschlag: "Mehr Ruhe im Raum"
9. KI-Bild-Prompt (ENGLISCH)
Hyperrealistic product photography of a handmade ceramic vase on a linen table,
warm afternoon light, shallow depth of field, 2:3 vertical, Pinterest editorial, 8k.`;
const pin = extractStrategyImage(pinterestBody, 'pinterest_pin');
check('newline body still yields a payload', pin !== null, String(pin));
if (pin) {
  check('newline body prompt unchanged',
    pin.prompt.startsWith('Hyperrealistic product photography of a handmade ceramic vase'), pin.prompt);
  check('newline body ratio unchanged 2:3', pin.ratio === '2:3', pin.ratio);
  check('newline body concept unchanged (section 8)',
    pin.concept.includes('Farbpalette: warmes Beige'), pin.concept.slice(0, 80));
  check('newline body overlay unchanged', pin.overlay === 'Mehr Ruhe im Raum', pin.overlay);
}

// 5) Regression: kollabierter Pinterest-Body (Bildkonzept + Prompt inline).
const collapsedPin =
  '1. SEO Pin-Titel Keramikvase 2. Pin-Beschreibung Kennst du das? 8. Bildkonzept ' +
  'Farbpalette: warmes Beige. Komposition: 2:3 vertikal. Text-Overlay-Vorschlag: "Mehr Ruhe im Raum" ' +
  '9. KI-Bild-Prompt (ENGLISCH) Hyperrealistic photo of a handmade ceramic vase, 2:3 vertical, 8k. ' +
  '10. Pinterest Alt-Text Keramikvase in warmem Beige.';
const cpin = extractStrategyImage(collapsedPin, 'pinterest_pin');
check('collapsed Pinterest body yields a payload', cpin !== null, String(cpin));
if (cpin) {
  check('collapsed Pinterest prompt extracted',
    cpin.prompt.startsWith('Hyperrealistic photo of a handmade ceramic vase'), cpin.prompt);
  check('collapsed Pinterest ratio from concept = 2:3', cpin.ratio === '2:3', cpin.ratio);
  check('collapsed Pinterest concept extracted',
    cpin.concept.includes('Farbpalette: warmes Beige'), cpin.concept.slice(0, 80));
}

if (failures > 0) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nALL COLLAPSED-STRATEGY-IMAGE TESTS PASSED');
