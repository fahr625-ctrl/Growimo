import { generateImage } from '../src/ai/image-providers/generate';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const ORIGINAL = 'Arbeitsplatz mit Laptop am Fenster';
const RATIO = '2:3';

// Replica of the component's i18n strings (de) + rotation logic.
const variationIntro =
  'Erstelle eine neue Variation: %s. Behalte dasselbe Hauptmotiv, denselben Stil und dasselbe Format; ändere nur Bildkomposition, Perspektive, Licht und Umgebungsdetails wie beschrieben.';
const directions = [
  'Nahaufnahme aus leicht erhöhter Kameraposition, das Hauptobjekt steht klar im rechten Bilddrittel, warmes Nachmittagslicht mit weichen langen Schatten, geringe Tiefenschärfe und weichgezeichneter Hintergrund.',
  'Weitwinkel-Frontalaufnahme aus Augenhöhe, ausbalancierte zentrierte Komposition, kühles helles Tageslicht, viele zusätzliche Umgebungsdetails, durchgehende Schärfe über das gesamte Bild.',
  'Seitenperspektive, Blick über die Schulter auf das Hauptobjekt, leicht diagonaler Bildaufbau, goldenes Abendlicht mit langen Schatten, mittlere Tiefenschärfe.',
  'Dramatische Untersicht aus tiefer Kameraposition, das Hauptobjekt dominiert den Bildvordergrund, kontrastreiches Licht mit ausgeprägten Schatten, geringe Tiefenschärfe.',
  'Weite Aufnahme mit viel Umgebungsraum, das Hauptobjekt vergleichsweise klein im Bild platziert, großzügige negative Fläche, weiches diffuses Morgenlicht, durchgehende Schärfe.',
  'Starke Detail-Nahaufnahme mit intensiver Perspektive, das Hauptobjekt zentriert, warmes seitliches Licht mit sanftem Schattenverlauf, sehr geringe Tiefenschärfe mit stark weichgezeichnetem Hintergrund.',
];

function buildVariationPrompt(base: string, idx: number): string {
  const dir = directions[idx % directions.length];
  return `${base}. ${variationIntro.replace('%s', dir)}`.trim();
}

async function run() {
  console.log('== ORIGINAL ==', JSON.stringify(ORIGINAL));
  const original = await generateImage(ORIGINAL, RATIO);
  const origHash = createHash('sha256').update(original.url).digest('hex');
  const origB64 = original.url.split(',')[1];
  writeFileSync('/home/team/shared/variation-original.png', Buffer.from(origB64, 'base64'));
  console.log('original url len:', original.url.length, 'sha256:', origHash.slice(0, 24));

  // Many alternates, each one its own prompt (different direction).
  const created = [original];
  for (let i = 0; i < 2; i++) {
    const p = buildVariationPrompt(ORIGINAL, i);
    console.log(`\n== VARIATION #${i + 1} ==`, JSON.stringify(p));
    const r = await generateImage(p, RATIO);
    const h = createHash('sha256').update(r.url).digest('hex');
    const b64 = r.url.split(',')[1];
    writeFileSync(`/home/team/shared/variation-${i + 1}.png`, Buffer.from(b64, 'base64'));
    console.log('variation url len:', r.url.length, 'sha256:', h.slice(0, 24));
    created.push(r);
  }

  // Distinctness check: all base64 payloads (and full data-URLs) must be unique.
  const urls = created.map((c) => c.url);
  const uniqueUrls = new Set(urls);
  const b64s = created.map((c) => c.url.split(',')[1]);
  const uniqueB64 = new Set(b64s);
  console.log('\n== DISTINCTNESS ==');
  console.log('total images:', created.length, 'unique urls:', uniqueUrls.size, 'unique base64:', uniqueB64.size);
  console.log('all different:', uniqueUrls.size === created.length && uniqueB64.size === created.length);
}

run().catch((e) => {
  console.error('TEST FAILED:', e);
  process.exit(1);
});
