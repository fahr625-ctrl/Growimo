// ─────────────────────────────────────────────────────────────────────────────
// Zwei Designmuster für die Pinterest-Pins — echte PNGs aus dem echten Renderer
// (2026-11-23)
// ─────────────────────────────────────────────────────────────────────────────
// Aufruf:  bun run scripts/muster-pins-2026-11-23.ts
//
// Es wird NICHTS generiert und NICHTS gekostet: kein KI-Aufruf, kein Kontingent.
// Gerendert wird mit `renderPinPng` (sharp, deterministisch) aus zwei echten
// Kampagnen-Bildern:
//   Quelle 1 — Foto-Bereich von /home/team/shared/ablauf2-kampagne-pin-3-1000x1500.png
//              (die Textkarte unten wird vorher abgeschnitten, damit kein Text
//               der alten Gestaltung unter dem neuen liegt)
//   Quelle 2 — /home/team/shared/kampagne-ohne-foto-2026-11-18/grundbild-1000x1500.jpg
//              (das Grundbild der Kampagne vom 18.11., unverändert)
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensurePinFonts } from '../src/lib/kampagne/pin-font';
import {
  PIN_HEIGHT,
  PIN_WIDTH,
  PIN_MUSTER_LAYOUT_IDS,
  renderPinPng,
  type PinLayoutId,
} from '../src/lib/kampagne/pin-render';
import {
  chooseProductCrop,
  PRODUCT_MAX_EMPTY_SHARE,
  type ProductCropReport,
} from '../src/lib/kampagne/pin-crop-attention';

const OUT = '/home/team/shared/muster-2026-11-23';
const SITE_BILDER = '/home/team/shared/site/public/muster-bilder';

const QUELLE_1 = '/home/team/shared/ablauf2-kampagne-pin-3-1000x1500.png';
const QUELLE_2 = '/home/team/shared/kampagne-ohne-foto-2026-11-18/grundbild-1000x1500.jpg';

const TITEL = 'Handgegossene Sojawachs-Kerzen im Glas';
const UNTERTITEL = 'Ein Licht für den Feierabend.';

const NAMES: Record<string, string> = {
  'editorial-serif': 'A-editorial-ruhig',
  'bold-block': 'B-plakativ-werblich',
};

await ensurePinFonts();
const sharp = (await import('sharp')).default as any;

mkdirSync(OUT, { recursive: true });
mkdirSync(SITE_BILDER, { recursive: true });

/**
 * Oberkante der alten Textkarte im Pin finden: erste Zeile von unten, in der
 * fast alles dunkel ist (die Karte hat die Farbe #111827). So wird nur der
 * FOTO-Bereich weiterverwendet — kein Text der alten Gestaltung im neuen Pin.
 */
async function fotoBereich(pfad: string): Promise<{ buffer: Buffer; height: number; note: string }> {
  const { data, info } = await sharp(pfad).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  // Dunkle Zeilen finden und den LÄNGSTEN zusammenhängenden Lauf nehmen — das
  // ist die Textkarte der alten Gestaltung (dunkle Fläche mit weißer Schrift).
  let bestStart = h;
  let bestLen = 0;
  let runStart = -1;
  for (let y = 0; y < h; y++) {
    let dunkel = 0;
    for (let x = 0; x < w; x++) if (data[y * w + x] < 40) dunkel++;
    const istDunkel = dunkel / w > 0.5;
    if (istDunkel && runStart < 0) runStart = y;
    if (!istDunkel && runStart >= 0) {
      if (y - runStart > bestLen) {
        bestLen = y - runStart;
        bestStart = runStart;
      }
      runStart = -1;
    }
  }
  if (runStart >= 0 && h - runStart > bestLen) {
    bestLen = h - runStart;
    bestStart = runStart;
  }
  const height = bestLen > 80 ? Math.max(200, bestStart - 10) : h;
  const buffer = await sharp(pfad)
    .extract({ left: 0, top: 0, width: w, height })
    .png()
    .toBuffer();
  return {
    buffer,
    height,
    note:
      bestLen > 80
        ? `Foto-Bereich y 0…${height} px von ${h} px (Textkarte der alten Gestaltung ab y ${bestStart} px abgeschnitten)`
        : `vollständig verwendet (${w} × ${h} px)`,
  };
}

const quellen: { id: string; label: string; pfad: string; buffer: Buffer; note: string }[] = [];
{
  const q1 = await fotoBereich(QUELLE_1);
  quellen.push({
    id: 'quelle-1',
    label: 'Kampagne-Pin 3 (Foto-Bereich)',
    pfad: QUELLE_1,
    buffer: q1.buffer,
    note: q1.note,
  });
  const meta2 = await sharp(QUELLE_2).metadata();
  quellen.push({
    id: 'quelle-2',
    label: 'Kampagne-Grundbild 18.11.',
    pfad: QUELLE_2,
    buffer: Buffer.from(await sharp(QUELLE_2).png().toBuffer()),
    note: `vollständig verwendet, ${meta2.width} × ${meta2.height} px`,
  });
}

interface Zeile {
  datei: string;
  layout: PinLayoutId;
  quelle: string;
  quelleNote: string;
  crop: ProductCropReport | null;
  textColor: string;
  panelColor: string;
  contrast: number;
  fontScale: number;
  bytes: number;
}

const zeilen: Zeile[] = [];

for (const layout of PIN_MUSTER_LAYOUT_IDS) {
  for (const quelle of quellen) {
    const datei = `${NAMES[layout]}-${quelle.id}.png`;
    const result = await renderPinPng({
      photo: quelle.buffer,
      layout,
      title: TITEL,
      subtitle: UNTERTITEL,
    });
    if (result.width !== PIN_WIDTH || result.height !== PIN_HEIGHT) {
      throw new Error(`${datei}: ${result.width}×${result.height} statt ${PIN_WIDTH}×${PIN_HEIGHT}`);
    }
    const ziel = join(OUT, datei);
    writeFileSync(ziel, result.png);
    copyFileSync(ziel, join(SITE_BILDER, datei));
    zeilen.push({
      datei,
      layout,
      quelle: quelle.label,
      quelleNote: quelle.note,
      crop: result.productCrop,
      textColor: result.textColor,
      panelColor: result.panelColor,
      contrast: result.minContrast,
      fontScale: result.fontScale,
      bytes: result.bytes,
    });
    console.log(
      `OK   ${datei}  ${result.width}×${result.height}  ${(result.bytes / 1024).toFixed(0)} kB  ` +
        `Text ${result.textColor} auf ${result.panelColor}, Kontrast ${result.minContrast}:1, Schriftstufe ${result.fontScale}`,
    );
    if (result.contrastAdjusted) {
      console.log(`     Hinweis: ${result.contrastNotice} (gewünscht ${result.requestedTextColor}, ${result.requestedContrast}:1)`);
    }
    console.log(`     Zuschnitt: ${result.productCrop?.note ?? 'Tabelle'}`);
  }
}

// ── Regel-Probe: beide Regeln gelten für JEDES Design ───────────────────────
// Derselbe Aufruf, den später alle fünf Designs machen; hier ohne Textfläche,
// damit sichtbar wird, was die Regeln allein entscheiden.
console.log('\nRegel-Probe (ohne Textfläche, gleiche Funktion für alle Designs):');
for (const quelle of quellen) {
  const report = await chooseProductCrop(sharp, quelle.buffer, { panel: null });
  const verworfenR1 = report.attempts.filter((a) => !a.productInside).length;
  const verworfenR2 = report.attempts.filter((a) => a.productInside && !a.emptyOk).length;
  console.log(
    `  ${quelle.label}: ok=${report.ok}, Zuschnitt ${report.crop.zoom}×/${report.crop.focus}, ` +
      `Motiv ${report.productBox.left}–${report.productBox.right} × ${report.productBox.top}–${report.productBox.bottom}, ` +
      `leer ${(report.emptyShare * 100).toFixed(1)} % (Grenze ${(PRODUCT_MAX_EMPTY_SHARE * 100).toFixed(0)} %), ` +
      `verworfen: ${verworfenR1}× Regel 1, ${verworfenR2}× Regel 2`,
  );
}

// ── Bericht je PNG ──────────────────────────────────────────────────────────
const lines: string[] = [
  '# Zwei Pin-Muster — echter Renderer, 0 € (2026-11-23)',
  '',
  'Gerendert mit `renderPinPng` (`src/lib/kampagne/pin-render.ts`), kein KI-Aufruf, keine Einheit,',
  'nichts live. Jedes Bild ist nachweislich 1000 × 1500 px PNG.',
  '',
  `Text beider Muster: „${TITEL}" / „${UNTERTITEL}" — derselbe Text, damit der Unterschied`,
  'zwischen den Mustern an der Gestaltung liegt und nicht am Inhalt.',
  '',
];
for (const z of zeilen) {
  lines.push(`## ${z.datei}`, '');
  lines.push(`- **Muster:** ${z.layout === 'editorial-serif' ? 'A — editorial-ruhig (Serif, Creme/Anthrazit, Haarlinie)' : 'B — plakativ-werblich (fette Sans, Großbuchstaben mit Sperrung, kräftiger Farbblock mit schräger Kante, Badge)'}`);
  lines.push(`- **Quellbild:** ${z.quelle} — ${z.quelleNote}`);
  lines.push(`- **Zuschnitt:** ${z.crop?.note ?? 'Tabellen-Zuschnitt'}`);
  if (z.crop) {
    const r1 = z.crop.attempts.filter((a) => !a.productInside).length;
    const r2 = z.crop.attempts.filter((a) => a.productInside && !a.emptyOk).length;
    lines.push(
      `- **Geprüfte Regeln:** Regel 1 (Produkt vollständig im Bild) und Regel 2 (leere sichtbare Fläche ≤ ${(z.crop.maxEmptyShare * 100).toFixed(0)} %). ` +
        `Verworfen: ${r1} Kandidaten an Regel 1, ${r2} an Regel 2, angenommen: zoom ${z.crop.crop.zoom} / ${z.crop.crop.focus}.`,
    );
  }
  lines.push(
    `- **Lesbarkeit:** Textfarbe ${z.textColor} auf Fläche ${z.panelColor}, gemessener Mindestkontrast ${String(z.contrast).replace('.', ',')}:1 (Schwelle 4,5:1), Schriftstufe ${z.fontScale}.`,
  );
  lines.push('');
}
writeFileSync(join(OUT, 'BERICHT.md'), lines.join('\n'));

console.log(`\nFertig: ${zeilen.length} PNGs in ${OUT} (und ${SITE_BILDER})`);
