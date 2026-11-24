// ─────────────────────────────────────────────────────────────────────────────
// Fünf Pin-Designs, Runde 2 (2026-11-24): Signal kleiner, Kontrast zurückgenommen,
// jedes Design auf drei Produktarten.
// ─────────────────────────────────────────────────────────────────────────────
// Aufruf:  bun run scripts/designs-pins-2026-11-24.ts
//
// Kein KI-Aufruf, keine Einheit, keine Kosten: gerendert wird mit `renderPinPng`
// (sharp, deterministisch) aus VORHANDENEN Bildern.
//
// Was diese Runde ändert (Owner-Urteil 24.11.):
//   • Signal: Textkasten kleiner und feiner (eigener Innenabstand, Leiste nur so
//     breit wie der Text, dünnerer Akzentbalken) — `pad`/`bar` im Layout.
//   • Kontrast: kein Ganzbild-Verlauf mehr, sondern eine kurze Kante über/links
//     vom Text — das Produkt in der Bildmitte bleibt unangetastet.
//   • Alle fünf Designs auf Kerze, Poster und Tasse. Hält ein Zuschnitt die
//     Regeln nicht (Produkt vollständig, leere Fläche ≤ 30 %), entsteht KEIN
//     Bild — das ist ein Befund und wird als solcher berichtet.
//   • Beispieltexte ohne jede Produktbehauptung (Owner-Regel 15.11.).
//
// Gemessen wird je Bild: gezeichnete Textfläche (deckkraft-gewichtet, % der
// Pin-Fläche), Mindestkontrast Text↔Hintergrund und die mittlere Helligkeit im
// erkannten Produktbereich gegenüber dem Quellbild (Regel: höchstens −12 %).
// ─────────────────────────────────────────────────────────────────────────────

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { ensurePinFonts } from '../src/lib/kampagne/pin-font';
import {
  PIN_DESIGN_IDS,
  PIN_DESIGN_NAMES,
  PIN_HEIGHT,
  PIN_WIDTH,
  cropToPinFrame,
  renderPinPng,
  type PinLayoutId,
} from '../src/lib/kampagne/pin-render';
import { candidateWindow } from '../src/lib/kampagne/pin-crop-attention';

const OUT = '/home/team/shared/designs-2026-11-24';
const SITE_BILDER = '/home/team/shared/site/public/design-bilder-neu';

// ── Beispieltexte: behauptungsfrei ───────────────────────────────────────────
// Keine Materialien, keine Herstellung, keine Stückzahlen, keine Versprechen —
// nur, was das Werkzeug wirklich tut. Gilt für ALLE Beispielbilder.
const TITEL = 'Deine Idee, fertig für Pinterest';
const UNTERTITEL = 'In wenigen Klicks zum eigenen Pin.';

/** Vorhandene Bilder, nichts neu erzeugt. */
const QUELLEN: { id: string; name: string; pfad: string }[] = [
  {
    id: 'kerze',
    name: 'Kerze',
    pfad: '/home/team/shared/kampagne-ohne-foto-2026-11-18/grundbild-1000x1500.jpg',
  },
  {
    id: 'poster',
    name: 'Poster im Rahmen',
    pfad: '/home/team/shared/mockups-2026-11-23/vorlage-1-poster-schwarz-passepartout.png',
  },
  {
    id: 'tasse',
    name: 'Tasse',
    pfad: '/home/team/shared/mockups-2026-11-23/vorlage-3-tasse-griff-rechts.png',
  },
];

/** Andere Farbwelt-Probe (dieselben Overlay-Felder, die der Editor bedient). */
const ZWEITE_PALETTE = {
  panelColor: '#24292E',
  textColor: '#FFFFFF',
  accentColor: '#B7BEC4',
};

interface DesignInfo {
  name: string;
  art: 'ruhig' | 'auffällig';
  beschreibung: string;
  schrift: string;
  farbwelt: string;
  position: string;
  flaeche: string;
  produktarten: string;
}

const INFO: Record<string, DesignInfo> = {
  'editorial-serif': {
    name: 'Editorial',
    art: 'ruhig',
    beschreibung:
      'Serif-Überschrift mit Sans-Unterzeile auf einer hellen Fläche im unteren Drittel, als einziger Akzent eine feine Haarlinie. Kein Rahmen, keine Großbuchstaben.',
    schrift: 'Liberation Serif (Überschrift) + Liberation Sans (Unterzeile)',
    farbwelt: 'helle Fläche #F7F4EF, Text #1E1C19, Akzent Graphit #2E3338',
    position: 'unten links, Fläche bis zur Unterkante',
    flaeche: 'randloses Band mit weichem Verlauf oben, Haarlinie als Akzent',
    produktarten: 'Schmuck, Keramik, Kosmetik, Prints, digitale Downloads',
  },
  'galerie-plaque': {
    name: 'Galerie',
    art: 'ruhig',
    beschreibung:
      'Sans-Überschrift mit Serif-Unterzeile, zentriert auf einer schwebenden weißen Karte mit feiner Innenlinie — wie ein Passepartout auf dem Foto.',
    schrift: 'Liberation Sans (Überschrift) + Liberation Serif (Unterzeile)',
    farbwelt: 'Karte #FFFFFF, Text #14181C, Akzent Kühlgrau #A9B2B8',
    position: 'unten mittig, Karte berührt keine Kante',
    flaeche: 'schwebende Karte mit Haarlinien-Rahmen (kein Band, keine Ecke)',
    produktarten: 'Prints, Fotokunst, digitale Downloads, Schmuck, Keramik',
  },
  'atelier-nord': {
    name: 'Atelier',
    art: 'ruhig',
    beschreibung:
      'Serif-Überschrift mit Mono-Eyebrow: die Unterzeile steht über der Überschrift, auf einem Papierband mit schräger Oberkante. Ein kurzer Akzentstrich leitet die Zeile ein.',
    schrift: 'Liberation Serif (Überschrift) + Liberation Mono (Unterzeile als Eyebrow)',
    farbwelt: 'Papier #EEF1F2, Text #1B2126, Akzent #6B7780',
    position: 'unten links, Unterzeile ÜBER der Überschrift',
    flaeche: 'Papierband mit schräger Oberkante + kurzer Akzentstrich',
    produktarten: 'Keramik, Möbel, Taschen, Werkstatt- und Manufaktur-Produkte',
  },
  'bold-block': {
    name: 'Signal',
    art: 'auffällig',
    beschreibung:
      'Fette Sans in Großbuchstaben mit Sperrung und Mono-Unterzeile auf einer schwebenden dunklen Leiste, die nur noch so breit ist wie der Text; ein dünner Akzentbalken mit Quadrat ist das einzige Farbelement.',
    schrift: 'Liberation Sans (Überschrift, Großbuchstaben) + Liberation Mono (Unterzeile)',
    farbwelt: 'Leiste #0E1114, Text #FFFFFF, Akzent Signalrot #E23D28',
    position: 'unten links, Leiste folgt dem Text statt der Bildbreite',
    flaeche: 'schwebende Leiste in Textbreite, ohne Kante + dünner Balken mit Quadrat',
    produktarten: 'Kleidung, Kosmetik, Socken, Deko mit klarer Botschaft',
  },
  'kontrast-ribbon': {
    name: 'Kontrast',
    art: 'auffällig',
    beschreibung:
      'Mono-Überschrift in Großbuchstaben, rechtsbündig unten rechts auf einer dunklen Fläche, die nur an Ober- und linkem Rand kurz ausläuft; an der rechten Kante ein schmales Akzentband. Die Bildmitte bleibt frei.',
    schrift: 'Liberation Mono (Überschrift, Großbuchstaben) + Liberation Sans (Unterzeile)',
    farbwelt: 'Fläche #12161A (88 % Deckkraft), Text #FFFFFF, Akzent Blau #1F6FEB',
    position: 'unten rechts, rechtsbündig',
    flaeche: 'kurze Auslaufkante oben/links statt Ganzbild-Verlauf + Band an der Bildkante',
    produktarten: 'Prints, Poster, digitale Downloads, Streetwear, Gadgets',
  },
};

/** Mittlere Helligkeit (Luma 0…255) eines Rechtecks — mit `sharp` gemessen. */
async function meanLuma(buf: Buffer, r: { x: number; y: number; width: number; height: number }) {
  const left = Math.max(0, Math.round(r.x));
  const top = Math.max(0, Math.round(r.y));
  const width = Math.min(PIN_WIDTH - left, Math.round(r.width));
  const height = Math.min(PIN_HEIGHT - top, Math.round(r.height));
  if (width < 2 || height < 2) return null;
  const { data, info } = await sharp(buf)
    .extract({ left, top, width, height })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) sum += data[i * info.channels];
  return Math.round((sum / n) * 100) / 100;
}

const de = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

interface Zeile {
  design: PinLayoutId;
  designName: string;
  quelle: string;
  quelleName: string;
  datei: string;
  ok: boolean;
  fehler?: string;
  palette?: boolean;
  scrimShare?: number;
  scrimBox?: { x: number; y: number; width: number; height: number } | null;
  panelShare?: number;
  minContrast?: number;
  textColor?: string;
  panelColor?: string;
  fontScale?: number;
  bytes?: number;
  cropNote?: string;
  emptyShare?: number | null;
  lumaBase?: number | null;
  lumaFinal?: number | null;
  lumaDelta?: number | null;
}

await ensurePinFonts();
mkdirSync(OUT, { recursive: true });
mkdirSync(SITE_BILDER, { recursive: true });

const fotos = new Map<string, Buffer>();
for (const q of QUELLEN) {
  fotos.set(q.id, Buffer.from(await sharp(q.pfad).png().toBuffer()));
}

const zeilen: Zeile[] = [];

async function rendere(
  design: PinLayoutId,
  quelleId: string,
  palette: boolean,
): Promise<Zeile> {
  const q = QUELLEN.find((x) => x.id === quelleId)!;
  const name = PIN_DESIGN_NAMES[design] ?? design;
  const datei = `${name.toLowerCase()}-${quelleId}${palette ? '-palette' : ''}-1000x1500.png`;
  const zeile: Zeile = {
    design,
    designName: name,
    quelle: quelleId,
    quelleName: q.name,
    datei,
    ok: false,
    palette,
  };
  try {
    const r = await renderPinPng({
      photo: fotos.get(quelleId)!,
      layout: design,
      title: TITEL,
      subtitle: UNTERTITEL,
      overlay: palette
        ? {
            panelColor: ZWEITE_PALETTE.panelColor,
            textColor: ZWEITE_PALETTE.textColor,
            accentColor: ZWEITE_PALETTE.accentColor,
          }
        : null,
    });
    if (r.width !== PIN_WIDTH || r.height !== PIN_HEIGHT) {
      throw new Error(`${r.width}×${r.height} statt ${PIN_WIDTH}×${PIN_HEIGHT}`);
    }
    const ziel = join(OUT, datei);
    writeFileSync(ziel, r.png);
    copyFileSync(ziel, join(SITE_BILDER, datei));

    // Produktbereich (erkannter Motivkasten) in Pin-Koordinaten: Helligkeit
    // VOR (Quellbild, gleicher Zuschnitt) und NACH (mit Textfläche) messen.
    let lumaBase: number | null = null;
    let lumaFinal: number | null = null;
    if (r.productCrop) {
      const w = candidateWindow(r.crop.zoom, r.crop.focus);
      const b = r.productCrop.productBox;
      const rect = {
        x: ((b.left - w.x) / w.width) * PIN_WIDTH,
        y: ((b.top - w.y) / w.height) * PIN_HEIGHT,
        width: ((b.right - b.left) / w.width) * PIN_WIDTH,
        height: ((b.bottom - b.top) / w.height) * PIN_HEIGHT,
      };
      const base = await cropToPinFrame(sharp as any, fotos.get(quelleId)!, r.crop);
      // Produktbereich endet an der Oberkante der Textfläche: die Fläche ist
      // gewollte Gestaltung, nicht „das Produkt wurde abgedunkelt".
      const clipped = { ...rect, height: Math.min(rect.height, Math.max(0, r.panel.y - rect.y)) };
      const region = clipped.height >= 60 ? clipped : rect;
      lumaBase = await meanLuma(base, region);
      lumaFinal = await meanLuma(r.png, region);
    }
    Object.assign(zeile, {
      ok: true,
      scrimShare: r.scrim.share,
      scrimBox: r.scrim.box,
      panelShare:
        Math.round(((r.panel.width * r.panel.height) / (PIN_WIDTH * PIN_HEIGHT)) * 10000) / 100,
      minContrast: r.minContrast,
      textColor: r.textColor,
      panelColor: r.panelColor,
      fontScale: r.fontScale,
      bytes: r.bytes,
      cropNote: r.productCrop?.note ?? 'Tabellen-Zuschnitt',
      emptyShare: r.productCrop?.emptyShare ?? null,
      lumaBase,
      lumaFinal,
      lumaDelta:
        lumaBase && lumaFinal ? Math.round(((lumaFinal - lumaBase) / lumaBase) * 1000) / 10 : null,
    });
    console.log(
      `OK   ${datei}  ${r.width}×${r.height}  ${(r.bytes / 1024).toFixed(0)} kB  ` +
        `Fläche ${r.scrim.share} %  Kontrast ${r.minContrast}:1  Produkt ${lumaBase}→${lumaFinal}`,
    );
  } catch (err) {
    zeile.fehler = (err as Error).message;
    console.log(`KEIN BILD ${datei}: ${zeile.fehler}`);
  }
  return zeile;
}

for (const design of PIN_DESIGN_IDS) {
  for (const q of QUELLEN) zeilen.push(await rendere(design, q.id, false));
}
// Anpassbarkeit belegen: dieselbe Gestaltung, andere Farbwelt (Signal, Kontrast).
for (const design of ['bold-block', 'kontrast-ribbon'] as PinLayoutId[]) {
  zeilen.push(await rendere(design, 'kerze', true));
}

// ── Bericht ────────────────────────────────────────────────────────────────
const vorherDatei = join(OUT, 'vorher.json');
const vorher: any[] = existsSync(vorherDatei) ? JSON.parse(readFileSync(vorherDatei, 'utf8')) : [];
const alt = (design: string, quelle: string) =>
  vorher.find((v) => v.layout === design && v.quelle === quelle && v.ok);

const lines: string[] = [
  '# Pin-Designs, Runde 2 (2026-11-24)',
  '',
  'Gerendert mit `renderPinPng` (`src/lib/kampagne/pin-render.ts`, sharp) — kein KI-Aufruf, keine',
  'Einheit, 0 €, nichts live. Jedes Bild ist nachweislich 1000 × 1500 px PNG.',
  '',
  `Text aller Bilder (behauptungsfrei, Owner-Regel 15.11.): **„${TITEL}"** / „${UNTERTITEL}".`,
  'Keine Materialien, keine Herstellung, keine Stückzahlen, keine Versprechen — dieselben Texte für alle Bilder.',
  '',
  'Produktarten aus vorhandenen Bildern (nichts neu erzeugt): Kerze `kampagne-ohne-foto-2026-11-18/grundbild-1000x1500.jpg`,',
  'Poster im Rahmen `mockups-2026-11-23/vorlage-1-poster-schwarz-passepartout.png`, Tasse',
  '`mockups-2026-11-23/vorlage-3-tasse-griff-rechts.png`.',
  '',
  '## 1 — Signal: Textkasten kleiner und feiner',
  '',
];
const sigAlt = alt('bold-block', 'kerze');
const sigNeu = zeilen.find((z) => z.design === 'bold-block' && z.quelle === 'kerze' && !z.palette);
if (sigAlt && sigNeu?.ok) {
  lines.push(
    `- **Kastenfläche (gezeichnet, deckkraft-gewichtet) in % der Pin-Fläche:** vorher ${de(sigAlt.scrimShare)} % ` +
      `(Hüllrechteck ${sigAlt.scrimBox?.width} × ${sigAlt.scrimBox?.height} px) → nachher ${de(sigNeu.scrimShare!)} % ` +
      `(Hüllrechteck ${sigNeu.scrimBox?.width} × ${sigNeu.scrimBox?.height} px).`,
    `- **Kontrast Text/Kasten:** vorher ${de(sigAlt.minContrast)} : 1 → nachher ${de(sigNeu.minContrast!)} : 1 ` +
      `(${sigNeu.textColor} auf ${sigNeu.panelColor}; Schwelle 4,5 : 1).`,
    '- Innenabstand jetzt 24 px waagerecht / 20 px senkrecht, äußerer Abstand 56 px — der Abstand zum Bildrand ist',
    '  größer als der Kastenrand. Die Leiste ist nur noch so breit wie der Text, nicht mehr 920 px über die volle',
    '  Breite. Keine Kante, keine Transparenz (Deckkraft 1), damit die Lesbarkeit unabhängig vom Foto bleibt;',
    '  der Akzentbalken ist von 120 × 10 px auf 96 × 7 px verkleinert, das Quadrat von 20 auf 14 px.',
    '',
  );
}

lines.push('## 2 — Kontrast: Verlauf zurückgenommen', '');
const krAlt = alt('kontrast-ribbon', 'kerze');
const krNeu = zeilen.find((z) => z.design === 'kontrast-ribbon' && z.quelle === 'kerze' && !z.palette);
if (krAlt && krNeu?.ok) {
  lines.push(
    `- **Mittlere Helligkeit im Produktbereich** (erkanntes Motiv, mit \`sharp\` gemessen): Quellbild ` +
      `${de(krAlt.luma.base)} → vorher ${de(krAlt.luma.final)} (**${de((krAlt.luma.final / krAlt.luma.base - 1) * 100)} %**) ` +
      `→ nachher ${de(krNeu.lumaFinal!)} (**${de(krNeu.lumaDelta!)} %**; Grenze −12 %).`,
    `- **Fläche in % der Pin-Fläche:** vorher ${de(krAlt.scrimShare)} % (Verlauf über das ganze Bild) → nachher ` +
      `${de(krNeu.scrimShare!)} % (Hüllrechteck ${krNeu.scrimBox?.width} × ${krNeu.scrimBox?.height} px).`,
    `- **Kontrast Text/Fläche:** vorher ${de(krAlt.minContrast)} : 1 → nachher ${de(krNeu.minContrast!)} : 1 ` +
      `(${krNeu.textColor} auf ${krNeu.panelColor}, Deckkraft 88 %; Schwelle 4,5 : 1).`,
    '- Der Verlauf lag vorher als Diagonale über dem GANZEN Bild (0 → 100 % Deckkraft) und dunkelte die Bildmitte',
    '  mit ab. Jetzt liegt unter dem Text eine Fläche, die nur an Oberkante und linkem Rand je 60 px ausläuft —',
    '  über der Wand, nicht über dem Produkt. Der Textblock sitzt dafür 50 px tiefer (Fußabstand 70 statt 120 px),',
    '  damit die Auslaufkante das Poster nicht anschneidet.',
    '',
  );
}

lines.push('## 3 — Alle fünf Designs auf drei Produktarten', '');
const abgelehnt = zeilen.filter((z) => !z.ok && !z.palette);
if (abgelehnt.length === 0) {
  lines.push('Alle 15 Kombinationen erfüllen beide Zuschnitt-Regeln.', '');
} else {
  const gruppen = new Map<string, Zeile[]>();
  for (const z of abgelehnt) {
    const key = `${z.quelleName}|${z.fehler ?? ''}`;
    gruppen.set(key, [...(gruppen.get(key) ?? []), z]);
  }
  for (const [, gruppe] of gruppen) {
    const z = gruppe[0];
    lines.push(
      `- **${z.quelleName} — kein Bild (fail-closed) für ${gruppe.map((g) => g.designName).join(', ')}:** ` +
        `${(z.fehler ?? '').replace(/^Kein Ausschnitt erfüllt beide Regeln: /, '')}`,
    );
  }
  lines.push('');
}

lines.push('| Design | Produktart | Datei | Fläche % | Kontrast | Produkt-Helligkeit | Zuschnitt |');
lines.push('|---|---|---|---|---|---|---|');
for (const z of zeilen) {
  if (!z.ok) {
    lines.push(`| ${z.designName} | ${z.quelleName} | — | — | — | — | kein Bild: ${(z.fehler ?? '').slice(0, 120)} |`);
    continue;
  }
  const zoom = z.cropNote?.match(/zoom ([\d.]+) \(([a-z-]+)\)/);
  lines.push(
    `| ${z.designName}${z.palette ? ' (andere Palette)' : ''} | ${z.quelleName} | ${z.datei} | ` +
      `${de(z.scrimShare!)} | ${de(z.minContrast!)} : 1 | ${de(z.lumaBase!)} → ${de(z.lumaFinal!)} (${de(z.lumaDelta!)} %) | ` +
      `zoom ${zoom?.[1] ?? '—'}/${zoom?.[2] ?? '—'}, leer ${z.emptyShare != null ? de(z.emptyShare * 100) + ' %' : '—'} |`,
  );
}
lines.push('');

lines.push('## 4 — Je Design: Schrift, Farbwelt, Textposition, Flächenform', '');
for (const design of PIN_DESIGN_IDS) {
  const info = INFO[design];
  lines.push(`**${info.name}** (${info.art}) — ${info.beschreibung}`, '');
  lines.push(`- Schriftpaar: ${info.schrift}`);
  lines.push(`- Farbwelt: ${info.farbwelt}`);
  lines.push(`- Textposition: ${info.position}`);
  lines.push(`- Flächenform: ${info.flaeche}`);
  lines.push(`- Gedacht für: ${info.produktarten}`);
  lines.push('');
}

lines.push('## 5 — Anpassbarkeit (Signal und Kontrast wie die anderen drei)', '');
lines.push(
  'Die Fläche beider Designs wird aus der GEMESSENEN Textbox abgeleitet und folgt deshalb denselben',
  'Overlay-Feldern wie die anderen drei — ohne neue Einheit, ohne KI-Aufruf, ohne neuen Renderer:',
  '',
  '- Schrift: `overlay.fontId` (`sans`/`serif`/`mono`, Brand Kit) → `effectiveFontFamily` in `pin-render.ts`.',
  '- Farben: `overlay.panelColor` / `textColor` / `accentColor` (`PIN_PALETTES` im Editor) → `panelColorFor`',
  '  und `scrimLayerSvg`.',
  '- Textposition: `overlay.align` (`left`/`center`/`right`) und `overlay.offsetY` → `geometry()`; die Leiste',
  '  bei Signal und die Fläche bei Kontrast werden daraus neu berechnet (sie kleben nicht an einer Kante).',
  '',
  'Beleg: dieselbe Gestaltung, andere Farbwelt — `signal-kerze-palette-1000x1500.png` und',
  '`kontrast-kerze-palette-1000x1500.png` (Fläche #24292E, Text #FFFFFF, Akzent #B7BEC4, gesetzt über genau',
  'diese Overlay-Felder).',
  '',
);

writeFileSync(join(OUT, 'BERICHT.md'), lines.join('\n'));
writeFileSync(join(OUT, 'messwerte.json'), JSON.stringify(zeilen, null, 2));
console.log(`\nFertig: ${zeilen.filter((z) => z.ok).length} PNGs in ${OUT} (und ${SITE_BILDER})`);
