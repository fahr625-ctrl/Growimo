// ─────────────────────────────────────────────────────────────────────────────
// Fünf eigenständige Pin-Designs — echte PNGs aus dem echten Renderer
// (2026-11-23)
// ─────────────────────────────────────────────────────────────────────────────
// Aufruf:  bun run scripts/designs-pins-2026-11-23.ts
//
// Kein KI-Aufruf, keine Einheit, keine Kosten: gerendert wird mit `renderPinPng`
// (sharp, deterministisch) aus dem vorhandenen Kampagnen-Grundbild.
//
// Je Design entstehen ZWEI Bilder:
//   1. das Design in seiner eigenen Farbwelt,
//   2. dieselbe Gestaltung in einer NEUTRALEN Farbwelt (Anthrazit/Weiß) —
//      der Nachweis, dass die Gestaltung nicht an der Kerzen-Farbwelt hängt.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensurePinFonts } from '../src/lib/kampagne/pin-font';
import {
  PIN_DESIGN_IDS,
  PIN_DESIGN_NAMES,
  PIN_HEIGHT,
  PIN_WIDTH,
  renderPinPng,
  type PinLayoutId,
} from '../src/lib/kampagne/pin-render';

const OUT = '/home/team/shared/designs-2026-11-23';
const SITE_BILDER = '/home/team/shared/site/public/design-bilder';

const QUELLE = '/home/team/shared/kampagne-ohne-foto-2026-11-18/grundbild-1000x1500.jpg';

const TITEL = 'Handgefertigte Unikate aus der Werkstatt';
const UNTERTITEL = 'Jedes Stück ein Einzelstück.';

/**
 * Neutrale Farbwelt-Probe: Anthrazit/Weiß, ohne jeden warmen Ton. Sie wird als
 * Nutzer-Wahl ins Overlay gegeben (dieselben Felder, die der Editor bedient).
 */
const NEUTRAL = {
  panelColor: '#24292E',
  textColor: '#FFFFFF',
  accentColor: '#B7BEC4',
};

interface DesignInfo {
  name: string;
  art: 'ruhig' | 'auffällig';
  beschreibung: string;
  produktarten: string;
  schrift: string;
  farbwelt: string;
  position: string;
  flaeche: string;
}

const INFO: Record<string, DesignInfo> = {
  'editorial-serif': {
    name: 'Editorial',
    art: 'ruhig',
    beschreibung:
      'Serif-Überschrift mit Sans-Unterzeile auf einer hellen Fläche im unteren Drittel, als einziger Akzent eine feine Haarlinie. Kein Rahmen, keine Großbuchstaben.',
    produktarten: 'Schmuck, Keramik, Kosmetik, Prints, digitale Downloads',
    schrift: 'Liberation Serif (Überschrift) + Liberation Sans (Unterzeile)',
    farbwelt: 'helle Fläche #F7F4EF, Text #1E1C19, Akzent Graphit #2E3338',
    position: 'unten links, Fläche bis zur Unterkante',
    flaeche: 'randloses Band mit weichem Verlauf oben, Haarlinie als Akzent',
  },
  'galerie-plaque': {
    name: 'Galerie',
    art: 'ruhig',
    beschreibung:
      'Sans-Überschrift mit Serif-Unterzeile, zentriert auf einer schwebenden weißen Karte mit feiner Innenlinie — wie ein Passepartout auf dem Foto.',
    produktarten: 'Prints, Fotokunst, digitale Downloads, Schmuck, Keramik',
    schrift: 'Liberation Sans (Überschrift) + Liberation Serif (Unterzeile)',
    farbwelt: 'Karte #FFFFFF, Text #14181C, Akzent Kühlgrau #A9B2B8',
    position: 'unten mittig, Karte berührt keine Kante',
    flaeche: 'schwebende Karte mit Haarlinien-Rahmen (kein Band, keine Ecke)',
  },
  'atelier-nord': {
    name: 'Atelier',
    art: 'ruhig',
    beschreibung:
      'Serif-Überschrift mit Mono-Eyebrow: die Unterzeile steht über der Überschrift, auf einem Papierband mit schräger Oberkante. Ein kurzer Akzentstrich leitet die Zeile ein.',
    produktarten: 'Keramik, Möbel, Taschen, Werkstatt- und Manufaktur-Produkte',
    schrift: 'Liberation Serif (Überschrift) + Liberation Mono (Unterzeile als Eyebrow)',
    farbwelt: 'Papier #EEF1F2, Text #1B2126, Akzent #6B7780',
    position: 'unten links, Unterzeile ÜBER der Überschrift',
    flaeche: 'Papierband mit schräger Oberkante + kurzer Akzentstrich',
  },
  'bold-block': {
    name: 'Signal',
    art: 'auffällig',
    beschreibung:
      'Fette Sans in Großbuchstaben mit Sperrung und Mono-Unterzeile auf einer schwebenden dunklen Leiste; das einzige Farbelement ist ein schmaler Akzentbalken mit Quadrat. Der frühere große Farbblock ist weg.',
    produktarten: 'Kleidung, Kosmetik, Socken, Deko mit klarer Botschaft',
    schrift: 'Liberation Sans (Überschrift, Großbuchstaben) + Liberation Mono (Unterzeile)',
    farbwelt: 'Leiste #0E1114, Text #FFFFFF, Akzent Signalrot #E23D28',
    position: 'unten links, Leiste randabständig',
    flaeche: 'schwebende Leiste (randabständig) + Balken und Quadrat',
  },
  'kontrast-ribbon': {
    name: 'Kontrast',
    art: 'auffällig',
    beschreibung:
      'Mono-Überschrift in Großbuchstaben, rechtsbündig unten rechts auf einem weichen dunklen Verlauf in der Ecke; an der rechten Kante ein schmales Akzentband. Plakativ, ohne Farbfläche.',
    produktarten: 'Prints, Poster, digitale Downloads, Streetwear, Gadgets',
    schrift: 'Liberation Mono (Überschrift, Großbuchstaben) + Liberation Sans (Unterzeile)',
    farbwelt: 'Verlauf #12161A, Text #FFFFFF, Akzent Blau #1F6FEB',
    position: 'unten rechts, rechtsbündig',
    flaeche: 'weicher Eckverlauf ohne harte Kante + schmales Band an der Bildkante',
  },
};

await ensurePinFonts();
const sharp = (await import('sharp')).default as any;

mkdirSync(OUT, { recursive: true });
mkdirSync(SITE_BILDER, { recursive: true });

const foto = Buffer.from(await sharp(QUELLE).png().toBuffer());

interface Zeile {
  datei: string;
  layout: PinLayoutId;
  neutral: boolean;
  textColor: string;
  panelColor: string;
  contrast: number;
  fontScale: number;
  bytes: number;
  cropNote: string;
  contrastAdjusted: boolean;
  contrastNotice: string | null;
}

const zeilen: Zeile[] = [];

for (const layout of PIN_DESIGN_IDS) {
  const name = PIN_DESIGN_NAMES[layout] ?? layout;
  for (const neutral of [false, true]) {
    const datei = `${name.toLowerCase()}-${neutral ? 'neutral' : 'farbwelt'}-1000x1500.png`;
    const result = await renderPinPng({
      photo: foto,
      layout,
      title: TITEL,
      subtitle: UNTERTITEL,
      overlay: neutral
        ? { panelColor: NEUTRAL.panelColor, textColor: NEUTRAL.textColor, accentColor: NEUTRAL.accentColor }
        : null,
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
      neutral,
      textColor: result.textColor,
      panelColor: result.panelColor,
      contrast: result.minContrast,
      fontScale: result.fontScale,
      bytes: result.bytes,
      cropNote: result.productCrop?.note ?? 'Tabellen-Zuschnitt',
      contrastAdjusted: result.contrastAdjusted,
      contrastNotice: result.contrastNotice,
    });
    console.log(
      `OK   ${datei}  ${result.width}×${result.height}  ${(result.bytes / 1024).toFixed(0)} kB  ` +
        `Text ${result.textColor} auf ${result.panelColor}, Kontrast ${result.minContrast}:1, Schriftstufe ${result.fontScale}`,
    );
    if (result.contrastAdjusted) console.log(`     Hinweis: ${result.contrastNotice}`);
    console.log(`     Zuschnitt: ${zeilen[zeilen.length - 1].cropNote}`);
  }
}

// ── Bericht je Design ───────────────────────────────────────────────────────
const lines: string[] = [
  '# Fünf eigenständige Pin-Designs (2026-11-23)',
  '',
  'Gerendert mit `renderPinPng` (`src/lib/kampagne/pin-render.ts`) — kein KI-Aufruf, keine Einheit,',
  'keine Kosten, nichts live. Jedes Bild ist nachweislich 1000 × 1500 px PNG.',
  '',
  `Text aller Bilder (derselbe, damit der Unterschied an der Gestaltung liegt): „${TITEL}" / „${UNTERTITEL}".`,
  `Quellbild: ${QUELLE} (vorhandenes Kampagnen-Grundbild, unverändert).`,
  '',
  `Neutrale Farbwelt-Probe: Fläche ${NEUTRAL.panelColor}, Text ${NEUTRAL.textColor}, Akzent ${NEUTRAL.accentColor} —`,
  'ohne jeden warmen Ton, gesetzt über dieselben Overlay-Felder, die der Editor bedient.',
  '',
];

for (const layout of PIN_DESIGN_IDS) {
  const info = INFO[layout];
  lines.push(`## ${info.name} (${info.art})`, '');
  lines.push(info.beschreibung, '');
  lines.push(`- **Schriftpaar:** ${info.schrift}`);
  lines.push(`- **Farbwelt:** ${info.farbwelt}`);
  lines.push(`- **Textposition:** ${info.position}`);
  lines.push(`- **Flächenform:** ${info.flaeche}`);
  lines.push(`- **Gedacht für:** ${info.produktarten}`);
  for (const z of zeilen.filter((r) => r.layout === layout)) {
    lines.push(
      `- **${z.neutral ? 'Neutrale Probe' : 'Design'}> ${z.datei}:** ${z.bytes} Bytes, gesetzt ${z.textColor} auf ${z.panelColor}, ` +
        `gemessener Mindestkontrast ${String(z.contrast).replace('.', ',')}:1 (Schwelle 4,5:1), Schriftstufe ${z.fontScale}` +
        `${z.contrastAdjusted ? ` — Kontrast gerettet: ${z.contrastNotice}` : ''}`,
    );
    lines.push(`  - Zuschnitt: ${z.cropNote}`);
  }
  lines.push('');
}

writeFileSync(join(OUT, 'BERICHT.md'), lines.join('\n'));
console.log(`\nFertig: ${zeilen.length} PNGs in ${OUT} (und ${SITE_BILDER})`);
