// Nachweis 2026-11-22 — Textfarbe + Kontrast-Rettung + deutsche Anführungszeichen
// -----------------------------------------------------------------------------
// Prüft den DETERMINISTISCHEN Renderer (kein KI-Aufruf, keine Einheit, kein
// Netzwerk): dieselben Fotobytes werden mehrfach mit unterschiedlichen
// Textfarben gesetzt, dazu ein absichtlich kontrastarmer Fall und eine
// Überschrift, die mit einem Anführungszeichen endet.
//
// Aufruf: bun run scripts/textfarbe-kontrast-2026-11-22.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { normalizeModelText } from '../src/lib/text-normalize';
import { ensurePinFonts } from '../src/lib/kampagne/pin-font';
import {
  MIN_TEXT_CONTRAST,
  PIN_HEIGHT,
  PIN_WIDTH,
  renderPinPng,
  type PinLayoutId,
} from '../src/lib/kampagne/pin-render';

const OUT = '/home/team/shared/textfarbe-kontrast-2026-11-22';
const FOTO = '/home/team/shared/phase2-kampagne-2026-11-15/testfoto-kontrast.png';
mkdirSync(OUT, { recursive: true });

const sharp = (await import('sharp')).default as typeof import('sharp').default;
const photo = new Uint8Array(readFileSync(FOTO));
// Schrift bereitstellen (fontconfig) — im Serverpfad macht das `pin-server.ts`.
await ensurePinFonts();

let failures = 0;
const lines: string[] = [];
function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  const line = `${ok ? 'OK  ' : 'ROT '} ${label}: ${detail}`;
  lines.push(line);
  console.log(line);
}

const TITLE = 'Sojawachs-Kerzen für entspannte Abende';
const LAYOUT: PinLayoutId = 'bottom-left';
const COLORS = [
  { id: 'white', hex: '#ffffff' },
  { id: 'cream', hex: '#f8fafc' },
  { id: 'anthracite', hex: '#111827' },
  { id: 'black', hex: '#000000' },
];

// ── 1) Vier Farben, EIN Bild ────────────────────────────────────────────────
const rendered: Record<string, Buffer> = {};
for (const color of COLORS) {
  const res = await renderPinPng({
    photo,
    layout: LAYOUT,
    overlay: { textColor: color.hex, align: 'left', offsetY: 0 },
    title: TITLE,
  });
  rendered[color.id] = res.png;
  writeFileSync(`${OUT}/pin-${color.id}-1000x1500.png`, res.png);
  check(
    `Farbe ${color.hex}`,
    res.width === PIN_WIDTH &&
      res.height === PIN_HEIGHT &&
      res.textColor === color.hex &&
      res.contrastAdjusted === false &&
      res.wordsComplete === true &&
      res.textPixels > 0,
    `${res.width}×${res.height}, gesetzt ${res.textColor}, Kontrast ${res.minContrast}:1, ` +
      `Zeilen ${res.titleLineCount}, Pixel ${res.textPixels}, gerettet=${res.contrastAdjusted}`,
  );
}

// Die vier Pins müssen sich wirklich unterscheiden (nicht nur anders benannt).
const hashes = await Promise.all(
  COLORS.map(async (c) => {
    const meta = await sharp(rendered[c.id]).stats();
    return `${c.id}:${meta.channels.map((ch) => ch.mean.toFixed(3)).join('/')}`;
  }),
);
check('vier Farben = vier verschiedene Bilder', new Set(hashes).size === 4, hashes.join(' | '));

// ── 2) Absichtlich kontrastarm: retten statt ablehnen ───────────────────────
const LOW = '#8a8a8a';
let low: Awaited<ReturnType<typeof renderPinPng>> | null = null;
let lowError: string | null = null;
try {
  low = await renderPinPng({
    photo,
    layout: LAYOUT,
    overlay: { textColor: LOW, align: 'left', offsetY: 0 },
    title: TITLE,
  });
} catch (err) {
  lowError = (err as Error).message;
}
check('kontrastarme Farbe ⇒ Pin entsteht trotzdem', low !== null, lowError ?? 'kein Fehler');
if (low) {
  writeFileSync(`${OUT}/pin-kontrast-gerettet-1000x1500.png`, low.png);
  check(
    'Rettung greift und ist benannt',
    low.contrastAdjusted === true &&
      low.requestedTextColor === LOW &&
      low.textColor !== LOW &&
      typeof low.contrastNotice === 'string' &&
      low.contrastNotice.includes('Kontrast angepasst, damit der Text lesbar bleibt'),
    `gewählt ${low.requestedTextColor} (${low.requestedContrast}:1) → gesetzt ${low.textColor} ` +
      `(${low.minContrast}:1), Hinweis: ${low.contrastNotice ?? 'FEHLT'}`,
  );
  check(
    'geretteter Pin ist lesbar',
    low.minContrast >= MIN_TEXT_CONTRAST,
    `${low.minContrast}:1 (nötig ${MIN_TEXT_CONTRAST}:1)`,
  );
  check(
    'Überschrift nicht gekürzt',
    low.wordsComplete === true && low.titleLineCount > 0 && low.textPixels > 0,
    `Wörter vollständig=${low.wordsComplete}, Zeilen=${low.titleLineCount}, Textpixel=${low.textPixels}`,
  );
}

// ── 3) Deutsche Anführungszeichen sauber geschlossen ────────────────────────
const modelRaw = '„Sojawachs-Kerzen für entspannte Abende\\"';
const fixed = normalizeModelText(modelRaw);
const last = fixed.at(-1) ?? '';
check(
  'Anführungszeichen: „ … "',
  fixed.startsWith('„') && last === '\u201C' && !fixed.includes('\\') && !fixed.includes('"'),
  `roh ${JSON.stringify(modelRaw)} → ${JSON.stringify(fixed)} (letztes Zeichen U+${last.codePointAt(0)?.toString(16).toUpperCase()})`,
);
const triple = normalizeModelText('„Sojawachs-Kerzen für entspannte Abende\\\\\\"');
check(
  'auch mehrfach escaped ohne Rest',
  triple.endsWith('\u201C') && !triple.includes('\\'),
  JSON.stringify(triple),
);

const quotePin = await renderPinPng({
  photo,
  layout: LAYOUT,
  overlay: { textColor: '#ffffff', align: 'left', offsetY: 0 },
  title: fixed,
});
writeFileSync(`${OUT}/pin-anfuehrungszeichen-1000x1500.png`, quotePin.png);
check(
  'Pin mit Anführungszeichen entsteht',
  quotePin.wordsComplete === true &&
    quotePin.textPixels > 0 &&
    quotePin.width === PIN_WIDTH &&
    quotePin.height === PIN_HEIGHT,
  `${quotePin.width}×${quotePin.height}, Textpixel ${quotePin.textPixels}, Wörter vollständig=${quotePin.wordsComplete}, Kontrast ${quotePin.minContrast}:1`,
);

// ── 4) Vergleichsbild für die Sichtprüfung (zwei Farben, EIN Bild) ──────────
const compare = await sharp({
  create: { width: 2 * PIN_WIDTH + 40, height: PIN_HEIGHT, channels: 3, background: '#ffffff' },
})
  .composite([
    { input: rendered.white, top: 0, left: 0 },
    { input: rendered.anthracite, top: 0, left: PIN_WIDTH + 40 },
  ])
  .png()
  .toBuffer();
writeFileSync(`${OUT}/vergleich-weiss-vs-anthrazit.png`, compare);

writeFileSync(`${OUT}/NACHWEIS.txt`, `${lines.join('\n')}\n\nFehlschläge: ${failures}\n`);
console.log(`\nFehlschläge: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
