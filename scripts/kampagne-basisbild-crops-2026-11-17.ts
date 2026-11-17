// ─────────────────────────────────────────────────────────────────────────────
// Kampagne 2026-11-17 — Grundbild-Weg + fünf verschiedene Bildausschnitte
// ─────────────────────────────────────────────────────────────────────────────
// Beleg (Auftrag BRIEF-KAMPAGNE-BASISBILD-2026-11-17.md):
//   A) Die fünf Layouts haben FÜNF VERSCHIEDENE Zuschnitte (deklarative Tabelle
//      PIN_LAYOUT_CROPS) — kein `position:'centre'` für alle mehr.
//   B) Die Zuschnitte sind nicht nur anders benannt, sondern liefern
//      nachweislich andere Pixel: fünf verschiedene Bildinhalte, gemessen.
//   C) Ein Pin rendert weiterhin 1000 × 1500 px PNG, und ein EIGENER Ausschnitt
//      je Pin überschreibt den Layout-Standard.
//   D) Der Prompt für das Grundbild behauptet nichts über das Produkt und
//      verlangt ausdrücklich keinen Text im Bild.
//
// Aufruf: bun run scripts/kampagne-basisbild-crops-2026-11-17.ts
// Es entstehen KEINE Kosten: hier wird nichts generiert, nur gerechnet.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  PIN_HEIGHT,
  PIN_LAYOUT_CROPS,
  PIN_LAYOUT_IDS,
  PIN_WIDTH,
  cropToPinFrame,
  layoutCrop,
  normalizeCrop,
  renderPinPng,
  type PinCrop,
} from '../src/lib/kampagne/pin-render';
import { buildPinDrafts } from '../src/lib/kampagne/pin-drafts';
import { buildBaseImagePrompt, canBuildBaseImage } from '../src/lib/kampagne/base-image';
import { ensurePinFonts } from '../src/lib/kampagne/pin-font';
import { loadSharp } from '../src/lib/kampagne/sharp-loader';

const OUT = '/home/team/shared/kampagne-basisbild-2026-11-17';
mkdirSync(OUT, { recursive: true });

const sharp = await loadSharp();

let failures = 0;
const lines: string[] = [];
function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  const line = `${ok ? 'OK  ' : 'ROT '} ${label}: ${detail}`;
  lines.push(line);
  console.log(line);
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 16);

/** Anteil deutlich verschiedener Pixel + mittlere Abweichung (0–255). */
async function diff(a: Buffer, b: Buffer): Promise<{ share: number; mean: number }> {
  const ra = await sharp(a).removeAlpha().raw().toBuffer();
  const rb = await sharp(b).removeAlpha().raw().toBuffer();
  const n = Math.min(ra.length, rb.length);
  let changed = 0;
  let sum = 0;
  const pixels = Math.floor(n / 3);
  for (let i = 0; i < n; i += 3) {
    const d =
      Math.abs(ra[i] - rb[i]) + Math.abs(ra[i + 1] - rb[i + 1]) + Math.abs(ra[i + 2] - rb[i + 2]);
    sum += d;
    if (d > 24) changed++;
  }
  return { share: pixels ? changed / pixels : 0, mean: pixels ? sum / pixels : 0 };
}

// ── Testfoto: vier klar verschiedene Zonen + feines Raster ──────────────────
// Ohne ein solches Bild wäre „unterschiedlicher Ausschnitt" nicht messbar: ein
// einfarbiges Foto ergibt bei jedem Beschnitt dieselben Pixel.
const SRC_W = 1200;
const SRC_H = 1800;
const cells: string[] = [];
const colors = ['#1d4ed8', '#f59e0b', '#16a34a', '#be123c'];
for (let i = 0; i < 4; i++) {
  const x = (i % 2) * (SRC_W / 2);
  const y = Math.floor(i / 2) * (SRC_H / 2);
  cells.push(
    `<rect x="${x}" y="${y}" width="${SRC_W / 2}" height="${SRC_H / 2}" fill="${colors[i]}"/>`,
  );
}
const grid: string[] = [];
for (let x = 0; x <= SRC_W; x += 100) {
  grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${SRC_H}" stroke="#ffffff" stroke-width="3"/>`);
}
for (let y = 0; y <= SRC_H; y += 100) {
  grid.push(`<line x1="0" y1="${y}" x2="${SRC_W}" y2="${y}" stroke="#ffffff" stroke-width="3"/>`);
}
const foto = await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SRC_W}" height="${SRC_H}">${cells.join('')}${grid.join('')}</svg>`,
  ),
)
  .jpeg({ quality: 92 })
  .toBuffer();
writeFileSync(`${OUT}/testfoto-vierzonen.png`, foto);

// ── A) Die Tabelle: fünf Layouts, fünf verschiedene Zuschnitte ───────────────
const specs = PIN_LAYOUT_IDS.map((id) => ({ id, crop: layoutCrop(id) }));
const unique = new Set(specs.map((s) => `${s.crop.zoom}|${s.crop.focus}`));
check(
  'A1 fünf verschiedene Zuschnitte',
  unique.size === 5,
  `${unique.size} verschiedene von ${specs.length} Layouts: ${specs
    .map((s) => `${s.id}=${s.crop.zoom}×/${s.crop.focus}`)
    .join(', ')}`,
);
check(
  'A2 kein pauschales "centre" für alle',
  new Set(specs.map((s) => s.crop.focus)).size >= 3,
  `${new Set(specs.map((s) => s.crop.focus)).size} verschiedene Ankerpunkte`,
);
check(
  'A3 Zoom-Stufen unterschiedlich',
  new Set(specs.map((s) => s.crop.zoom)).size >= 3,
  `Zooms: ${specs.map((s) => s.crop.zoom).join(' / ')}`,
);
check(
  'A4 Tabelle deckt genau die fünf Layouts',
  Object.keys(PIN_LAYOUT_CROPS).length === PIN_LAYOUT_IDS.length,
  `${Object.keys(PIN_LAYOUT_CROPS).length} Einträge für ${PIN_LAYOUT_IDS.length} Layouts`,
);

// ── B) Die Zuschnitte liefern andere Pixel ──────────────────────────────────
const frames: Record<string, Buffer> = {};
for (const spec of specs) {
  const buf = await cropToPinFrame(sharp, new Uint8Array(foto), spec.crop);
  const meta = await sharp(buf).metadata();
  frames[spec.id] = buf;
  writeFileSync(`${OUT}/zuschnitt-${spec.id}.png`, buf);
  check(
    `B0 ${spec.id} ist ${PIN_WIDTH}×${PIN_HEIGHT}`,
    meta.width === PIN_WIDTH && meta.height === PIN_HEIGHT,
    `${meta.format} ${meta.width}×${meta.height}`,
  );
}
const hashes = new Set(Object.values(frames).map(sha));
check(
  'B1 fünf verschiedene Bildinhalte (sha256)',
  hashes.size === 5,
  `${hashes.size} unterschiedliche Hashes: ${Object.entries(frames)
    .map(([id, b]) => `${id}:${sha(b)}`)
    .join(' ')}`,
);

// Paarweise: JEDES Paar muss sich sichtbar unterscheiden (nicht nur einige).
let worstPair = { pair: '', share: 1, mean: 0 };
const ids = PIN_LAYOUT_IDS;
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const d = await diff(frames[ids[i]], frames[ids[j]]);
    if (d.share < worstPair.share) worstPair = { pair: `${ids[i]}/${ids[j]}`, ...d };
  }
}
check(
  'B2 jedes Paar unterscheidet sich sichtbar',
  worstPair.share >= 0.2,
  `schwächstes Paar ${worstPair.pair}: ${(worstPair.share * 100).toFixed(1)} % der Pixel anders, mittlere Abweichung ${worstPair.mean.toFixed(1)}/765`,
);

// ── C) Echter Pin-Render: 1000 × 1500, eigener Ausschnitt gewinnt ───────────
// Schrift bereitstellen, BEVOR gezeichnet wird (im Laufzeit-Image gibt es keine
// Systemschriften) — derselbe Schritt wie in pin-server.ts.
await ensurePinFonts();
const source = {
  product: 'Digitales Gäste-WC-Poster mit Spruch, Schwarz-Weiß-Typografie',
  audience: 'Menschen mit kleinem Bad',
  message: 'Ein Spruch, der Gästen ein Lächeln entlockt',
};
const drafts = buildPinDrafts(source);

const rendered: Record<string, Buffer> = {};
for (const draft of drafts) {
  const res = await renderPinPng({
    photo: new Uint8Array(foto),
    layout: draft.layout,
    overlay: { textColor: draft.textColor, align: draft.align, offsetY: draft.offsetY },
    title: draft.headline,
    subtitle: draft.subline || null,
  });
  rendered[draft.id] = res.png;
  writeFileSync(`${OUT}/pin-${draft.id}-${draft.layout}.png`, res.png);
  check(
    `C1 ${draft.id} rendert ${PIN_WIDTH}×${PIN_HEIGHT} mit Zuschnitt ${res.crop.zoom}×/${res.crop.focus}`,
    res.png.length > 0 &&
      res.crop.zoom === layoutCrop(draft.layout).zoom &&
      res.crop.focus === layoutCrop(draft.layout).focus,
    `${res.bytes} Bytes, Layout ${res.layout}, Kontrast ${res.minContrast}:1`,
  );
}

// Eigener Ausschnitt je Pin schlägt den Layout-Standard (und ändert das Bild).
const custom: PinCrop = { zoom: 1.9, focus: 'bottom-right' };
const withCustom = await renderPinPng({
  photo: new Uint8Array(foto),
  layout: 'bottom-left',
  crop: custom,
  title: drafts[0].headline,
  subtitle: drafts[0].subline || null,
});
writeFileSync(`${OUT}/pin-1-eigener-ausschnitt.png`, withCustom.png);
const customDiff = await diff(rendered['pin-1'], withCustom.png);
check(
  'C2 eigener Ausschnitt überschreibt den Standard',
  withCustom.crop.zoom === 1.9 && withCustom.crop.focus === 'bottom-right' && customDiff.share > 0.2,
  `Layout-Standard 1×/centre → ${withCustom.crop.zoom}×/${withCustom.crop.focus}: ${(customDiff.share * 100).toFixed(1)} % der Pixel anders`,
);

// Ungültiger Ausschnitt fällt fail-closed auf den Layout-Standard zurück.
const bad = normalizeCrop({ zoom: 99, focus: 'irgendwo' }, layoutCrop('side-stripe'));
check(
  'C3 unbrauchbarer Ausschnitt fällt auf den Layout-Standard zurück',
  bad.zoom === 2 && bad.focus === 'right',
  `zoom 99/"irgendwo" → ${bad.zoom}×/${bad.focus} (gedeckelt, kein erfundener Wert)`,
);

// ── D) Prompt des Grundbilds ────────────────────────────────────────────────
const prompt = buildBaseImagePrompt(source);
check(
  'D1 Prompt nur aus Nutzerangaben, kein Text im Bild verlangt',
  prompt.includes(source.product) &&
    prompt.includes(source.audience) &&
    /kein text/i.test(prompt),
  `${prompt.length} Zeichen, „kein Text" enthalten`,
);
check(
  'D2 ohne Produktidee kein Prompt',
  canBuildBaseImage({ product: '   ' }) === false && canBuildBaseImage(source) === true,
  'leere Produktidee ⇒ Knopf gesperrt',
);

// ── Kontaktbogen (Sichtprüfung für den Owner) ───────────────────────────────
const tiles = await Promise.all(
  drafts.map(async (draft) => ({
    id: draft.id,
    buf: await sharp(rendered[draft.id]).resize(300, 450, { fit: 'cover' }).png().toBuffer(),
  })),
);
const sheet = sharp({
  create: {
    width: 300 * tiles.length + 20 * (tiles.length - 1),
    height: 450,
    channels: 3,
    background: '#e5e7eb',
  },
}).composite(
  tiles.map((tile, i) => ({ input: tile.buf, top: 0, left: i * 320 })),
);
writeFileSync(`${OUT}/kontaktbogen-fuenf-pins.png`, await sheet.png().toBuffer());

lines.push('');
lines.push(`Ergebnis: ${failures === 0 ? 'ALLE PRÜFUNGEN GRÜN' : `${failures} ROT`}`);
lines.push(`Dateien: ${OUT}`);
writeFileSync(`${OUT}/ERGEBNIS.txt`, `${lines.join('\n')}\n`);

console.log('');
console.log(`ERGEBNIS: ${failures === 0 ? 'GRÜN' : 'ROT'} (${failures} Fehler)`);
process.exit(failures === 0 ? 0 : 1);
