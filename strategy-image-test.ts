// ── Problem 1 test: extractStrategyImage liefert Payload bei KI-Bild-Prompt
// und null ohne Prompt → der "Im Image Studio erstellen"-Button erscheint nur
// bei vorhandenem Prompt. Zusätzlich: Code-Struktur-Check, dass strategyImage
// im Komponenten-Scope (nicht mehr in handleCopy) berechnet wird.
import { extractStrategyImage } from './src/lib/strategy-image';

let failures = 0;
function check(name: string, cond: boolean, detail: string) {
  if (!cond) { failures++; console.log('FAIL:', name, '—', detail); }
  else console.log('PASS:', name);
}

// Eine typische Pinterest-Body mit KI-Bild-Prompt (de)
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

const payload = extractStrategyImage(pinterestBody, 'pinterest_pin');
check('Pinterest body yields a payload', payload !== null, String(payload));
if (payload) {
  check('payload.prompt extracted', payload.prompt.length > 20, payload.prompt);
  check('payload.platform = Pinterest', payload.platform === 'Pinterest', payload.platform);
  check('payload.ratio = 2:3', payload.ratio === '2:3', payload.ratio);
}

// Body OHNE KI-Bild-Prompt → null → Button erscheint NICHT
const noPromptBody = `1. SEO Pin-Titel\nEin Titel\n2. Pin-Beschreibung\nEin Text ohne Bild-Prompt-Sektion.`;
const nil = extractStrategyImage(noPromptBody, 'pinterest_pin');
check('body without KI-Bild-Prompt yields null (no button)', nil === null, String(nil));

// Code-Struktur: strategyImage/openImageStudio müssen IM Komponenten-Scope liegen,
// NICHT in handleCopy (das war der Scope-Bug, der den Button nie anzeigte).
const fs = require('fs');
const src = fs.readFileSync('src/routes/app/projects/$projectId.tsx', 'utf8');
const inHandleCopy = src.indexOf('const strategyImage = extractStrategyImage') >
  src.indexOf('const handleCopy = async') &&
  src.indexOf('const strategyImage = extractStrategyImage') < src.indexOf('return (');
check('strategyImage is NOT inside handleCopy', !inHandleCopy, 'strategyImage must be hoisted');
check('strategyImage declared before render (component scope)',
  src.indexOf('const strategyImage = extractStrategyImage') > 0 &&
  src.indexOf('const strategyImage = extractStrategyImage') < src.indexOf('const handleCopy'),
  'search order');

if (failures > 0) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nALL STRATEGY-IMAGE TESTS PASSED');
