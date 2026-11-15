// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Kampagne: Pin-Komposition mit `sharp` (kein generatives Modell)
// ─────────────────────────────────────────────────────────────────────────────
// Das Originalfoto des Nutzers wird auf 1000 × 1500 px beschnitten, mit einer
// Textfläche + Text + optionalem Logo überlagert und als PNG exportiert.
// Es wird NICHTS erfunden und NICHTS generiert: nur das hochgeladene Foto,
// Layout, Text und (falls aktiv) das Markenprofil.
//
// FÜNF LAYOUTS (Phase 2, Pin-Entwürfe): jedes Layout setzt Textposition,
// Ausrichtung, Textfläche und Rahmen anders — damit fünf Pins aus EINEM Foto
// sichtbar unterschiedlich aussehen und nicht fünfmal dasselbe Bild mit
// anderem Wort sind.
//
// LESBARKEIT (2026-11-15, Owner-Befund „zweite Kopfzeile läuft ins Foto"):
// Die Textfläche wird NICHT mehr geschätzt, sondern aus den GEMESSENEN
// Textpixeln abgeleitet:
//   1. Text-Ebene rendern und die Tinten-Bounding-Box messen.
//   2. Die Fläche (Band/Karte/Streifen) so legen, dass sie diese Box mit
//      Sicherheitsabstand vollständig und praktisch DECKEND enthält.
//   3. Hintergrund (Foto + Fläche) und Text zusammensetzen, dann den
//      tatsächlichen WCAG-Kontrast an jedem Kern-Textpixel messen.
//      Fällt er unter 4,5 : 1, gibt es KEIN Bild (`contrast_too_low`).
// Damit kann Schrift nicht mehr mit Bildinhalt kollidieren — auch nicht auf
// einem dunklen, unruhigen Foto.
//
// Fail-closed-Regeln (Phase-2-SPEC §6):
//   • Ausgabe muss nachweislich 1000 × 1500 px PNG sein, sonst Fehler.
//   • Text-Overlay muss nachweislich Pixel zeichnen. Fehlt im Laufzeit-Image
//     eine Schrift, liefert librsvg stillschweigend ein leeres Overlay — genau
//     das wird hier gemessen und als `font_missing` abgebrochen.
//   • Text darf den sicheren Rand nicht überschreiten (`text_overflow`).
//   • Text muss den Mindestkontrast erreichen (`contrast_too_low`).
// ─────────────────────────────────────────────────────────────────────────────

import { loadSharp, type SharpFactory } from './sharp-loader';

export const PIN_WIDTH = 1000;
export const PIN_HEIGHT = 1500;

/** Freie, lizenzsichere Schriftkette (OFL-Systemschriften, keine Downloads). */
export const PIN_FONT_STACK =
  '"DejaVu Sans", "Liberation Sans", "Noto Sans", Arial, Helvetica, sans-serif';

/** Mindestkontrast Text ↔ Hintergrund (WCAG AA, normaler Text). */
export const MIN_TEXT_CONTRAST = 4.5;

/** Abstand, den Text zum Pin-Rand halten muss. */
const SAFE_MARGIN = 40;

/** Stufen, in denen die Schrift schrumpft, bis der Text in den Rand passt. */
const FIT_SCALES = [1, 0.94, 0.88, 0.82, 0.76, 0.7];

/** Flächenfarben, wenn die Markenfarbe selbst nicht lesbar wäre. */
const PANEL_DARK = '#111827';
const PANEL_LIGHT = '#f8fafc';

/**
 * Deckkraft der Textfläche: 1 = vollständig deckend. Bei 0,97 zeichnet sich ein
 * harter Bildkontrast (schwarz/weiß im Foto) noch als Geistermuster unter der
 * Schrift ab — deshalb keine Transparenz unter dem Text.
 */
const PANEL_OPACITY = 1;

// ── Layouts ──────────────────────────────────────────────────────────────────

export type PinLayoutId =
  | 'bottom-left'
  | 'top-band'
  | 'center-card'
  | 'side-stripe'
  | 'minimal-frame';

export type PinAlign = 'left' | 'center';

/** Reihenfolge = Reihenfolge der fünf Entwürfe in der Oberfläche. */
export const PIN_LAYOUT_IDS: PinLayoutId[] = [
  'bottom-left',
  'top-band',
  'center-card',
  'side-stripe',
  'minimal-frame',
];

type ScrimKind = 'bottom-band' | 'top-band' | 'center-card' | 'left-stripe' | 'bottom-band-soft';
type FrameKind = 'inset' | 'rule' | 'none';
type Anchor = 'top' | 'center' | 'bottom';

interface LayoutSpec {
  align: PinAlign;
  anchor: Anchor;
  titleSize: number;
  subtitleSize: number;
  titleChars: number;
  titleLines: number;
  subtitleChars: number;
  subtitleLines: number;
  marginX: number;
  scrim: ScrimKind;
  frame: FrameKind;
  frameWidth: number;
}

const LAYOUTS: Record<PinLayoutId, LayoutSpec> = {
  // 1) Klassisch: Text unten links, geschlossenes Fußband, feiner Markenrahmen.
  'bottom-left': {
    align: 'left',
    anchor: 'bottom',
    titleSize: 76,
    subtitleSize: 40,
    titleChars: 22,
    titleLines: 3,
    subtitleChars: 34,
    subtitleLines: 2,
    marginX: 70,
    scrim: 'bottom-band',
    frame: 'inset',
    frameWidth: 6,
  },
  // 2) Kopfbalken: Text oben, geschlossene Fläche, Trennlinie über dem Text.
  'top-band': {
    align: 'left',
    anchor: 'top',
    titleSize: 66,
    subtitleSize: 38,
    titleChars: 24,
    titleLines: 3,
    subtitleChars: 36,
    subtitleLines: 2,
    marginX: 70,
    scrim: 'top-band',
    frame: 'rule',
    frameWidth: 8,
  },
  // 3) Mittlere Karte: zentriert, gerundete Fläche in der Bildmitte.
  'center-card': {
    align: 'center',
    anchor: 'center',
    titleSize: 84,
    subtitleSize: 40,
    titleChars: 18,
    titleLines: 3,
    subtitleChars: 30,
    subtitleLines: 2,
    marginX: 96,
    scrim: 'center-card',
    frame: 'none',
    frameWidth: 0,
  },
  // 4) Seitliche Spalte: große Typo links, Fläche als senkrechter Streifen.
  'side-stripe': {
    align: 'left',
    anchor: 'center',
    // 72 statt 96: der Streifen muss die Schrift deckend tragen UND Platz für
    // das Foto lassen — bei 96 lief die Zeile über den Streifen hinaus.
    titleSize: 72,
    subtitleSize: 34,
    titleChars: 14,
    titleLines: 4,
    subtitleChars: 24,
    subtitleLines: 2,
    marginX: 56,
    scrim: 'left-stripe',
    frame: 'rule',
    frameWidth: 10,
  },
  // 5) Reduziert: wenig Text, zentriert unten, schmales Band statt Rahmenkarte.
  'minimal-frame': {
    align: 'center',
    anchor: 'bottom',
    titleSize: 58,
    subtitleSize: 32,
    titleChars: 30,
    titleLines: 2,
    subtitleChars: 46,
    subtitleLines: 2,
    marginX: 90,
    scrim: 'bottom-band-soft',
    frame: 'inset',
    frameWidth: 3,
  },
};

export function isPinLayoutId(v: unknown): v is PinLayoutId {
  return typeof v === 'string' && v in LAYOUTS;
}

/** Prüft eine Farbe streng (nur #rgb/#rrggbb) — verhindert SVG-Injection. */
export function safeHexColor(value: string | null | undefined, fallback: string): string {
  const v = (value ?? '').trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : fallback;
}

// ── Farb-/Kontrastrechnung (WCAG 2.1) ────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function channelToLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b)
  );
}

function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

function hexLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return relativeLuminance(r, g, b);
}

// ── Öffentliche Eingabe-Typen ────────────────────────────────────────────────

export interface PinBrand {
  /** Primärfarbe (Hex, z. B. #1f2937) — Fläche hinter dem Text. */
  primary: string;
  /** Akzentfarbe (Hex) — Rahmen/Trennlinie. */
  accent: string;
  /** Schriftfamilie (nur OFL-Namen), leer = PIN_FONT_STACK. */
  fontFamily?: string | null;
}

/** Bearbeitbares Overlay je Pin (Text, Position, Farbe). */
export interface PinOverlay {
  /** Textfarbe des Overlays (Hex); default #ffffff. */
  textColor?: string | null;
  /** Ausrichtung; default = Layout-Vorgabe. */
  align?: PinAlign | null;
  /** Verschiebung des Textblocks in Anteilen der Pin-Höhe (−0.35 … 0.35). */
  offsetY?: number | null;
}

export interface PinRenderInput {
  /** Originalfoto des Nutzers (JPEG/PNG/WebP). */
  photo: Uint8Array;
  /** Optionales Logo (PNG mit Transparenz). */
  logo?: Uint8Array | null;
  /** Logo-Position; default 'bottom-right'. */
  logoPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Logo-Breite in px (default 180). */
  logoWidth?: number;
  /** Eines der fünf Layouts; default 'bottom-left'. */
  layout?: PinLayoutId;
  /** Bearbeitbares Overlay (Farbe/Ausrichtung/Position). */
  overlay?: PinOverlay | null;
  /** Kleine Markenzeile (nur wenn das Markenprofil aktiv ist). */
  brandLine?: string | null;
  title: string;
  subtitle?: string | null;
  /** Markenprofil — null/undefined ⇒ neutrale Farben. */
  brand?: PinBrand | null;
}

export class PinRenderError extends Error {
  code:
    | 'no_photo'
    | 'font_missing'
    | 'text_overflow'
    | 'contrast_too_low'
    | 'wrong_dimensions'
    | 'render_failed';
  constructor(code: PinRenderError['code'], message: string) {
    super(message);
    this.name = 'PinRenderError';
    this.code = code;
  }
}

/** Lazy: `sharp` wird erst beim ersten Rendern geladen (Native-Binding). */
async function getSharp(): Promise<SharpFactory> {
  return loadSharp();
}

/** XML-Escaping für Text in SVG (sonst bricht jedes „&" oder „<" das Bild). */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Grober Zeilenumbruch (kein Font-Metrics-Zugriff in librsvg nötig). */
export function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  return lines.slice(0, maxLines);
}

// ── Messung der Text-Ebene ───────────────────────────────────────────────────

interface InkBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface MeasuredLayer {
  png: Buffer;
  box: InkBox;
  pixels: number;
  raw: Buffer;
  width: number;
  height: number;
  channels: number;
}

/** Rendert eine SVG-Ebene und misst, WO sie tatsächlich Pixel setzt. */
async function measureInk(sharp: SharpFactory, svg: Buffer): Promise<MeasuredLayer> {
  const png = await sharp(svg).png().toBuffer();
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let pixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > 24) {
        pixels++;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  const box: InkBox = right < 0 ? { left: 0, top: 0, right: 0, bottom: 0 } : { left, top, right, bottom };
  return { png, box, pixels, raw: data, width, height, channels };
}

function boxFitsSafeArea(box: InkBox): boolean {
  return (
    box.left >= SAFE_MARGIN &&
    box.right <= PIN_WIDTH - SAFE_MARGIN &&
    box.top >= SAFE_MARGIN &&
    box.bottom <= PIN_HEIGHT - SAFE_MARGIN
  );
}

// ── Geometrie ────────────────────────────────────────────────────────────────

interface TextGeometry {
  spec: LayoutSpec;
  align: PinAlign;
  titleLines: string[];
  subtitleLines: string[];
  titleSize: number;
  subtitleSize: number;
  lineGap: number;
  blockTop: number;
  blockHeight: number;
  ruleY: number;
  x: number;
}

/** Position/Größe des Textblocks für Layout + Overlay + Schriftstufe berechnen. */
function geometry(input: PinRenderInput, scale = 1): TextGeometry {
  const spec = LAYOUTS[input.layout && isPinLayoutId(input.layout) ? input.layout : 'bottom-left'];
  const align: PinAlign = input.overlay?.align === 'center' || input.overlay?.align === 'left'
    ? input.overlay.align
    : spec.align;

  const titleSize = Math.round(spec.titleSize * scale);
  const subtitleSize = Math.round(spec.subtitleSize * scale);
  const lineGap = Math.round(18 * scale);
  const ruleGap = Math.round(34 * scale);

  const titleLines = wrapText(input.title || '', spec.titleChars, spec.titleLines);
  const subtitleLines = input.subtitle
    ? wrapText(input.subtitle, spec.subtitleChars, spec.subtitleLines)
    : [];

  const blockHeight =
    titleLines.length * (titleSize + lineGap) +
    (subtitleLines.length ? subtitleLines.length * (subtitleSize + lineGap) + ruleGap : 0);

  let blockTop =
    spec.anchor === 'bottom'
      ? PIN_HEIGHT - 140 - blockHeight
      : spec.anchor === 'top'
        ? 150
        : Math.round((PIN_HEIGHT - blockHeight) / 2);

  const offset = Math.max(-0.35, Math.min(0.35, Number(input.overlay?.offsetY ?? 0) || 0));
  blockTop += Math.round(offset * PIN_HEIGHT);
  blockTop = Math.max(40, Math.min(PIN_HEIGHT - blockHeight - 40, blockTop));

  return {
    spec,
    align,
    titleLines,
    subtitleLines,
    titleSize,
    subtitleSize,
    lineGap,
    blockTop,
    blockHeight,
    ruleY: blockTop + titleLines.length * (titleSize + lineGap) + 8,
    x: align === 'center' ? Math.round(PIN_WIDTH / 2) : spec.marginX,
  };
}

/** Nur die Text-Ebene (transparent) — separat renderbar für die Messung. */
function textLayerSvg(input: PinRenderInput, g: TextGeometry): string {
  const brand = input.brand ?? null;
  const fontFamily = brand?.fontFamily?.trim() || PIN_FONT_STACK;
  const color = safeHexColor(input.overlay?.textColor, '#ffffff');
  const anchor = g.align === 'center' ? 'middle' : 'start';
  const gap = g.titleSize + g.lineGap;

  const titleTspans = g.titleLines
    .map(
      (line, i) =>
        `<tspan x="${g.x}" y="${g.blockTop + g.titleSize + i * gap}">${esc(line)}</tspan>`,
    )
    .join('');

  const subtitleStartY = g.blockTop + g.titleLines.length * gap + Math.round(34 * (g.titleSize / g.spec.titleSize)) + g.subtitleSize;
  const subtitleTspans = g.subtitleLines
    .map(
      (line, i) =>
        `<tspan x="${g.x}" y="${subtitleStartY + i * (g.subtitleSize + g.lineGap)}">${esc(line)}</tspan>`,
    )
    .join('');

  return `<svg width="${PIN_WIDTH}" height="${PIN_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <text font-family='${esc(fontFamily)}' font-size="${g.titleSize}" font-weight="700" fill="${color}" text-anchor="${anchor}">${titleTspans}</text>
  ${subtitleTspans ? `<text font-family='${esc(fontFamily)}' font-size="${g.subtitleSize}" font-weight="400" fill="${color}" fill-opacity="0.94" text-anchor="${anchor}">${subtitleTspans}</text>` : ''}
</svg>`;
}

/** Kleine Markenzeile (Markenprofil aktiv) — separat, damit die Textmessung sauber bleibt. */
function brandLineSvg(input: PinRenderInput, g: TextGeometry): string | null {
  const text = (input.brandLine ?? '').trim();
  if (!text) return null;
  const fontFamily = input.brand?.fontFamily?.trim() || PIN_FONT_STACK;
  const accent = safeHexColor(input.brand?.accent, '#ffffff');
  // Gegenüber dem Textblock, damit sich nichts überlagert.
  const y = g.spec.anchor === 'top' ? PIN_HEIGHT - 60 : 90;
  return `<svg width="${PIN_WIDTH}" height="${PIN_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <text x="${Math.round(PIN_WIDTH / 2)}" y="${y}" text-anchor="middle" font-family='${esc(fontFamily)}' font-size="30" font-weight="600" fill="${accent}" fill-opacity="0.95">${esc(text.slice(0, 40))}</text>
</svg>`;
}

/**
 * Wählt die Flächenfarbe: die Markenfarbe, wenn sie gegen die Textfarbe lesbar
 * ist — sonst die dunkle bzw. helle neutrale Fläche. So bleibt der Text IMMER
 * lesbar, ohne dass eine unlesbare Markenfarbe das Pin blockiert.
 */
function pickPanelColor(brandPrimary: string, textColor: string): string {
  const textLum = hexLuminance(textColor);
  const candidates = [brandPrimary, PANEL_DARK, PANEL_LIGHT];
  let best = candidates[0];
  let bestRatio = 0;
  for (const candidate of candidates) {
    const ratio = contrastRatio(hexLuminance(candidate), textLum);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  return best;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fläche um die gemessene Textbox (Sicherheitsabstand), auf das Pin begrenzt. */
function panelRect(box: InkBox, padX: number, padY: number): Rect {
  const x = Math.max(0, box.left - padX);
  const y = Math.max(0, box.top - padY);
  return {
    x,
    y,
    width: Math.min(PIN_WIDTH, box.right + padX) - x,
    height: Math.min(PIN_HEIGHT, box.bottom + padY) - y,
  };
}

/**
 * Textfläche + Markenrahmen. Die Fläche wird aus der GEMESSENEN Textbox
 * abgeleitet und deckt sie vollständig ab — dadurch kann Schrift nicht mehr
 * über Bildinhalt laufen. Jedes Layout bekommt eine andere Form.
 */
function scrimLayerSvg(
  input: PinRenderInput,
  g: TextGeometry,
  panel: Rect,
  brandBox: InkBox | null,
  panelColor: string,
): string {
  const accent = safeHexColor(input.brand?.accent, '#ffffff');
  const frame = g.spec.frame;
  const fill = `fill="${panelColor}"`;

  const frameSvg =
    frame === 'inset'
      ? `<rect x="12" y="12" width="${PIN_WIDTH - 24}" height="${PIN_HEIGHT - 24}" fill="none" stroke="${accent}" stroke-width="${g.spec.frameWidth}" stroke-opacity="0.9" />`
      : '';

  // Verlauf zum weichen Auslaufen der Kante (0 → volle Deckkraft).
  const fade = (id: string, x1: number, y1: number, x2: number, y2: number, fromY: number) => `
    <defs><linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
      <stop offset="0%" stop-color="${panelColor}" stop-opacity="0" />
      <stop offset="100%" stop-color="${panelColor}" stop-opacity="${PANEL_OPACITY}" />
    </linearGradient></defs>
    <rect x="0" y="${fromY}" width="${PIN_WIDTH}" height="${Math.round(panel.y - fromY)}" fill="url(#${id})" />`;

  let body = '';
  if (g.spec.scrim === 'bottom-band' || g.spec.scrim === 'bottom-band-soft') {
    // Fußband: Verlauf oben (weich) + deckende Fläche unter der Textbox.
    const fadeFrom = Math.max(0, panel.y - (g.spec.scrim === 'bottom-band' ? 160 : 190));
    body =
      (panel.y > fadeFrom ? fade('gFade', 0, 0, 0, 1, fadeFrom) : '') +
      `<rect x="0" y="${Math.round(panel.y)}" width="${PIN_WIDTH}" height="${PIN_HEIGHT - Math.round(panel.y)}" ${fill} fill-opacity="${PANEL_OPACITY}" />`;
  } else if (g.spec.scrim === 'top-band') {
    // Kopfbalken: deckende Fläche oben + Verlauf nach unten.
    const solidTo = Math.round(panel.y + panel.height);
    body =
      `<rect x="0" y="0" width="${PIN_WIDTH}" height="${solidTo}" ${fill} fill-opacity="${PANEL_OPACITY}" />` +
      `<defs><linearGradient id="gFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${panelColor}" stop-opacity="${PANEL_OPACITY}" />
        <stop offset="100%" stop-color="${panelColor}" stop-opacity="0" />
      </linearGradient></defs>` +
      `<rect x="0" y="${solidTo}" width="${PIN_WIDTH}" height="200" fill="url(#gFade)" />`;
  } else if (g.spec.scrim === 'center-card') {
    // Karte: rundum Sicherheitsabstand, deckend.
    const card = panelRect(
      { left: panel.x, top: panel.y, right: panel.x + panel.width, bottom: panel.y + panel.height },
      0,
      0,
    );
    body =
      `<rect x="${Math.round(card.x)}" y="${Math.round(card.y)}" width="${Math.round(card.width)}" height="${Math.round(card.height)}" rx="36" ${fill} fill-opacity="${PANEL_OPACITY}" />`;
  } else {
    // Senkrechter Streifen: deckend bis über die Textbox hinaus, dann weicher Auslauf.
    const solidW = Math.round(panel.x + panel.width);
    const fadeW = 160;
    body =
      `<rect x="0" y="0" width="${solidW}" height="${PIN_HEIGHT}" ${fill} fill-opacity="${PANEL_OPACITY}" />` +
      `<defs><linearGradient id="gFade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${panelColor}" stop-opacity="${PANEL_OPACITY}" />
        <stop offset="100%" stop-color="${panelColor}" stop-opacity="0" />
      </linearGradient></defs>` +
      `<rect x="${solidW}" y="0" width="${fadeW}" height="${PIN_HEIGHT}" fill="url(#gFade)" />`;
  }

  // Markenzeile bekommt eine eigene kleine Fläche (gleiche Deckkraft).
  const brandPlate = brandBox
    ? (() => {
        const plate = panelRect(brandBox, 26, 14);
        return `<rect x="${Math.round(plate.x)}" y="${Math.round(plate.y)}" width="${Math.round(plate.width)}" height="${Math.round(plate.height)}" rx="14" ${fill} fill-opacity="${PANEL_OPACITY}" />`;
      })()
    : '';

  // Trennlinie über dem Untertitel (Layouts mit `rule`) — Akzentfarbe.
  const ruleSvg =
    frame === 'rule' && g.subtitleLines.length
      ? `<rect x="${g.align === 'center' ? Math.round(PIN_WIDTH / 2) - 60 : g.spec.marginX}" y="${Math.round(g.ruleY)}" width="120" height="${g.spec.frameWidth}" fill="${accent}" />`
      : '';

  return `<svg width="${PIN_WIDTH}" height="${PIN_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  ${body}
  ${brandPlate}
  ${ruleSvg}
  ${frameSvg}
</svg>`;
}

// ── Kontrastmessung am fertigen Hintergrund ──────────────────────────────────

interface ContrastReport {
  min: number;
  mean: number;
  samples: number;
}

/**
 * Misst den TATSÄCHLICHEN Kontrast: jeder Kern-Textpixel (Alpha ≥ 200) wird
 * über den fertigen Hintergrund (Foto + Fläche) gelegt und mit genau diesem
 * Hintergrundpixel verglichen. Das ist die Zahl, die der Betrachter sieht.
 */
function measureContrast(
  bg: { raw: Buffer; channels: number },
  layers: MeasuredLayer[],
): ContrastReport {
  let min = Number.POSITIVE_INFINITY;
  let sum = 0;
  let samples = 0;
  for (const layer of layers) {
    const px = layer.width * layer.height;
    for (let p = 0; p < px; p++) {
      const si = p * layer.channels;
      const alpha = layer.raw[si + 3];
      if (alpha < 200) continue;
      const bi = p * bg.channels;
      const br = bg.raw[bi];
      const bgc = bg.raw[bi + 1];
      const bb = bg.raw[bi + 2];
      const a = alpha / 255;
      const tr = a * layer.raw[si] + (1 - a) * br;
      const tg = a * layer.raw[si + 1] + (1 - a) * bgc;
      const tb = a * layer.raw[si + 2] + (1 - a) * bb;
      const ratio = contrastRatio(
        relativeLuminance(tr, tg, tb),
        relativeLuminance(br, bgc, bb),
      );
      if (ratio < min) min = ratio;
      sum += ratio;
      samples++;
    }
  }
  return {
    min: samples > 0 ? Math.round(min * 100) / 100 : 0,
    mean: samples > 0 ? Math.round((sum / samples) * 100) / 100 : 0,
    samples,
  };
}

export interface PinRenderResult {
  png: Buffer;
  width: number;
  height: number;
  bytes: number;
  /** Deckende Pixel der Text-Ebene — Beleg, dass die Schrift gegriffen hat. */
  textPixels: number;
  /** Gemessener Mindestkontrast Text ↔ Hintergrund (WCAG). */
  minContrast: number;
  /** Verwendete Schriftstufe (1 = volle Größe). */
  fontScale: number;
  /** Laufzeit-Angaben für den Artefakt-Beleg. */
  sharpVersion: string;
  libvips: string;
  /** Das tatsächlich verwendete Layout. */
  layout: PinLayoutId;
}

/**
 * Rendert EIN Pin: Foto (cover, 1000×1500) + Textfläche + Text + optional Logo.
 * Wirft `PinRenderError`, wenn das Ergebnis nicht belegbar ein 1000×1500-PNG ist,
 * der Text nicht gezeichnet wurde (fehlende Schrift im Laufzeit-Image), aus dem
 * sicheren Rand läuft oder den Mindestkontrast nicht erreicht.
 */
export async function renderPinPng(input: PinRenderInput): Promise<PinRenderResult> {
  if (!input.photo || input.photo.length === 0) {
    throw new PinRenderError('no_photo', 'Kein Foto übergeben.');
  }
  const sharp = await getSharp();
  const versions = (sharp as unknown as { versions?: Record<string, string> }).versions ?? {};
  const layout: PinLayoutId = input.layout && isPinLayoutId(input.layout) ? input.layout : 'bottom-left';

  // 1) Text-Ebene rendern, messen und — falls nötig — verkleinern, bis sie in
  //    den sicheren Rand passt. Die Messung ist die Grundlage der Textfläche.
  let geometryUsed: TextGeometry | null = null;
  let textLayer: MeasuredLayer | null = null;
  let fontScale = 1;
  for (const scale of FIT_SCALES) {
    const g = geometry({ ...input, layout }, scale);
    const measured = await measureInk(sharp, Buffer.from(textLayerSvg(input, g)));
    if (measured.pixels < 200) {
      throw new PinRenderError(
        'font_missing',
        `Text-Overlay zeichnet nichts (${measured.pixels} Pixel) — im Laufzeit-Image fehlt eine Schrift.`,
      );
    }
    if (boxFitsSafeArea(measured.box)) {
      geometryUsed = g;
      textLayer = measured;
      fontScale = scale;
      break;
    }
  }
  if (!geometryUsed || !textLayer) {
    throw new PinRenderError(
      'text_overflow',
      'Der Text passt auch verkleinert nicht in den sicheren Rand des Pins.',
    );
  }

  // 2) Markenzeile messen (eigene Fläche).
  const brandSvg = brandLineSvg(input, geometryUsed);
  const brandLayer = brandSvg ? await measureInk(sharp, Buffer.from(brandSvg)) : null;

  // 3) Fläche aus der gemessenen Textbox — deckend, mit Sicherheitsabstand.
  const textColor = safeHexColor(input.overlay?.textColor, '#ffffff');
  const panelColor = pickPanelColor(safeHexColor(input.brand?.primary, PANEL_DARK), textColor);
  const padX = Math.round(28 + geometryUsed.titleSize * 0.18);
  const padY = Math.round(26 + geometryUsed.titleSize * 0.12);
  const panel = panelRect(textLayer.box, padX, padY);
  const scrimPng = await sharp(
    Buffer.from(scrimLayerSvg(input, geometryUsed, panel, brandLayer?.box ?? null, panelColor)),
  )
    .png()
    .toBuffer();

  // 4) Foto auf das Pin-Format bringen (EXIF-Rotation beachten, cover-Beschnitt).
  const base = await sharp(Buffer.from(input.photo))
    .rotate()
    .resize(PIN_WIDTH, PIN_HEIGHT, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  // 5) Hintergrund = Foto + Fläche. Darauf wird der Kontrast GEMESSEN.
  const bgPng = await sharp(base)
    .composite([{ input: scrimPng, top: 0, left: 0 }])
    .png()
    .toBuffer();
  const { data: bgRaw, info: bgInfo } = await sharp(bgPng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const contrast = measureContrast(
    { raw: bgRaw, channels: bgInfo.channels },
    brandLayer ? [textLayer, brandLayer] : [textLayer],
  );
  if (contrast.min < MIN_TEXT_CONTRAST) {
    throw new PinRenderError(
      'contrast_too_low',
      `Text ist nicht sicher lesbar (Kontrast ${contrast.min}:1, nötig ${MIN_TEXT_CONTRAST}:1) — bitte eine hellere oder dunklere Textfarbe wählen.`,
    );
  }

  // 6) Endbild zusammensetzen.
  const layers: { input: Buffer; top: number; left: number }[] = [
    { input: scrimPng, top: 0, left: 0 },
    { input: textLayer.png, top: 0, left: 0 },
  ];
  if (brandLayer) layers.push({ input: brandLayer.png, top: 0, left: 0 });

  if (input.logo && input.logo.length > 0) {
    const logoWidth = Math.max(60, Math.min(320, input.logoWidth ?? 180));
    try {
      const logoBuf = await sharp(Buffer.from(input.logo))
        .resize({ width: logoWidth, withoutEnlargement: true })
        .png()
        .toBuffer();
      const meta = await sharp(logoBuf).metadata();
      const margin = 40;
      const pos = input.logoPosition ?? 'bottom-right';
      const left = pos.endsWith('right') && meta.width ? PIN_WIDTH - meta.width - margin : margin;
      const top = pos.startsWith('top') ? margin : PIN_HEIGHT - (meta.height ?? 0) - margin;
      layers.push({ input: logoBuf, top: Math.max(0, top), left: Math.max(0, left) });
    } catch {
      // Kaputtes Logo darf das Pin nicht verhindern — es entfällt dann nur.
    }
  }

  let png: Buffer;
  try {
    png = await sharp(base).composite(layers).png({ compressionLevel: 9 }).toBuffer();
  } catch (err) {
    throw new PinRenderError('render_failed', (err as Error).message);
  }

  // 7) Ausgabe fail-closed prüfen: 1000 × 1500 PNG, sonst kein Ergebnis.
  const outMeta = await sharp(png).metadata();
  if (outMeta.format !== 'png' || outMeta.width !== PIN_WIDTH || outMeta.height !== PIN_HEIGHT) {
    throw new PinRenderError(
      'wrong_dimensions',
      `Ausgabe ist ${outMeta.format} ${outMeta.width}×${outMeta.height}, erwartet png ${PIN_WIDTH}×${PIN_HEIGHT}.`,
    );
  }

  return {
    png,
    width: PIN_WIDTH,
    height: PIN_HEIGHT,
    bytes: png.length,
    textPixels: textLayer.pixels,
    minContrast: contrast.min,
    fontScale,
    sharpVersion: String(versions.sharp ?? 'unbekannt'),
    libvips: String(versions.vips ?? 'unbekannt'),
    layout,
  };
}
