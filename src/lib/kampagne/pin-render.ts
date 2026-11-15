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
// Fail-closed-Regeln (Phase-2-SPEC §6):
//   • Ausgabe muss nachweislich 1000 × 1500 px PNG sein, sonst Fehler.
//   • Text-Overlay muss nachweislich Pixel zeichnen. Fehlt im Laufzeit-Image
//     eine Schrift, liefert librsvg stillschweigend ein leeres Overlay — genau
//     das wird hier gemessen und als `font_missing` abgebrochen, statt ein
//     leeres Pin-Bild auszuliefern.
// ─────────────────────────────────────────────────────────────────────────────

import { loadSharp, type SharpFactory } from './sharp-loader';

export const PIN_WIDTH = 1000;
export const PIN_HEIGHT = 1500;

/** Freie, lizenzsichere Schriftkette (OFL-Systemschriften, keine Downloads). */
export const PIN_FONT_STACK =
  '"DejaVu Sans", "Liberation Sans", "Noto Sans", Arial, Helvetica, sans-serif';

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

type ScrimKind = 'bottom-gradient' | 'top-band' | 'center-card' | 'left-stripe' | 'soft';
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
  // 1) Klassisch: Text unten links, Verlauf von unten, feiner Markenrahmen.
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
    scrim: 'bottom-gradient',
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
    titleSize: 96,
    subtitleSize: 36,
    titleChars: 14,
    titleLines: 4,
    subtitleChars: 24,
    subtitleLines: 2,
    marginX: 56,
    scrim: 'left-stripe',
    frame: 'rule',
    frameWidth: 10,
  },
  // 5) Reduziert: wenig Text, zentriert unten, nur leichte Abdunklung.
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
    scrim: 'soft',
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
  code: 'no_photo' | 'font_missing' | 'wrong_dimensions' | 'render_failed';
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

/** Position/Größe des Textblocks für Layout + Overlay berechnen. */
function geometry(input: PinRenderInput): TextGeometry {
  const spec = LAYOUTS[input.layout && isPinLayoutId(input.layout) ? input.layout : 'bottom-left'];
  const align: PinAlign = input.overlay?.align === 'center' || input.overlay?.align === 'left'
    ? input.overlay.align
    : spec.align;

  const titleLines = wrapText(input.title || '', spec.titleChars, spec.titleLines);
  const subtitleLines = input.subtitle
    ? wrapText(input.subtitle, spec.subtitleChars, spec.subtitleLines)
    : [];

  const lineGap = 18;
  const ruleGap = subtitleLines.length ? 34 : 0;
  const blockHeight =
    titleLines.length * (spec.titleSize + lineGap) +
    (subtitleLines.length
      ? subtitleLines.length * (spec.subtitleSize + lineGap) + ruleGap
      : 0);

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
    titleSize: spec.titleSize,
    subtitleSize: spec.subtitleSize,
    lineGap,
    blockTop,
    blockHeight,
    ruleY: blockTop + titleLines.length * (spec.titleSize + lineGap) + 8,
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

  const subtitleStartY = g.blockTop + g.titleLines.length * gap + 34 + g.subtitleSize;
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

/** Textfläche (Kontrast) + Markenrahmen — je Layout eine andere Form. */
function scrimLayerSvg(input: PinRenderInput, g: TextGeometry): string {
  const primary = safeHexColor(input.brand?.primary, '#111827');
  const accent = safeHexColor(input.brand?.accent, '#ffffff');
  const frame = g.spec.frame;
  const pad = 24;

  const frameSvg =
    frame === 'inset'
      ? `<rect x="12" y="12" width="${PIN_WIDTH - 24}" height="${PIN_HEIGHT - 24}" fill="none" stroke="${accent}" stroke-width="${g.spec.frameWidth}" stroke-opacity="0.9" />`
      : '';

  let body = '';
  if (g.spec.scrim === 'bottom-gradient') {
    body = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${primary}" stop-opacity="0" />
      <stop offset="55%" stop-color="${primary}" stop-opacity="0.55" />
      <stop offset="100%" stop-color="${primary}" stop-opacity="0.94" />
    </linearGradient></defs>
    <rect x="0" y="${Math.round(PIN_HEIGHT * 0.42)}" width="${PIN_WIDTH}" height="${Math.round(PIN_HEIGHT * 0.58)}" fill="url(#g)" />`;
  } else if (g.spec.scrim === 'top-band') {
    const bandH = Math.max(240, Math.min(PIN_HEIGHT * 0.5, g.blockTop + g.blockHeight + 120));
    body = `<rect x="0" y="0" width="${PIN_WIDTH}" height="${Math.round(bandH)}" fill="${primary}" fill-opacity="0.9" />`;
  } else if (g.spec.scrim === 'center-card') {
    const cardH = g.blockHeight + 120;
    const cardTop = Math.max(80, g.blockTop - 60);
    body = `<rect x="${pad + 20}" y="${cardTop}" width="${PIN_WIDTH - 2 * (pad + 20)}" height="${Math.round(cardH)}" rx="36" fill="${primary}" fill-opacity="0.86" />`;
  } else if (g.spec.scrim === 'left-stripe') {
    const stripeW = Math.round(PIN_WIDTH * 0.62);
    body = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${primary}" stop-opacity="0.94" />
      <stop offset="78%" stop-color="${primary}" stop-opacity="0.86" />
      <stop offset="100%" stop-color="${primary}" stop-opacity="0" />
    </linearGradient></defs>
    <rect x="0" y="0" width="${stripeW}" height="${PIN_HEIGHT}" fill="url(#g)" />`;
  } else {
    body = `<rect x="0" y="0" width="${PIN_WIDTH}" height="${PIN_HEIGHT}" fill="${primary}" fill-opacity="0.34" />`;
  }

  // Trennlinie über dem Untertitel (Layouts mit `rule`) — Akzentfarbe.
  const ruleSvg =
    frame === 'rule' && g.subtitleLines.length
      ? `<rect x="${g.align === 'center' ? Math.round(PIN_WIDTH / 2) - 60 : g.spec.marginX}" y="${Math.round(g.ruleY)}" width="120" height="${g.spec.frameWidth}" fill="${accent}" />`
      : '';

  return `<svg width="${PIN_WIDTH}" height="${PIN_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  ${body}
  ${ruleSvg}
  ${frameSvg}
</svg>`;
}

export interface PinRenderResult {
  png: Buffer;
  width: number;
  height: number;
  bytes: number;
  /** Deckende Pixel der Text-Ebene — Beleg, dass die Schrift gegriffen hat. */
  textPixels: number;
  /** Laufzeit-Angaben für den Artefakt-Beleg. */
  sharpVersion: string;
  libvips: string;
  /** Das tatsächlich verwendete Layout. */
  layout: PinLayoutId;
}

/**
 * Rendert EIN Pin: Foto (cover, 1000×1500) + Textfläche + Text + optional Logo.
 * Wirft `PinRenderError`, wenn das Ergebnis nicht belegbar ein 1000×1500-PNG ist
 * oder der Text nicht gezeichnet wurde (fehlende Schrift im Laufzeit-Image).
 */
export async function renderPinPng(input: PinRenderInput): Promise<PinRenderResult> {
  if (!input.photo || input.photo.length === 0) {
    throw new PinRenderError('no_photo', 'Kein Foto übergeben.');
  }
  const sharp = await getSharp();
  const versions = (sharp as unknown as { versions?: Record<string, string> }).versions ?? {};
  const layout: PinLayoutId = input.layout && isPinLayoutId(input.layout) ? input.layout : 'bottom-left';
  const g = geometry({ ...input, layout });

  const textSvg = Buffer.from(textLayerSvg(input, g));
  const scrimSvg = Buffer.from(scrimLayerSvg(input, g));
  const brandSvg = brandLineSvg(input, g);

  // 1) Schrift-Beweis VOR dem Komponieren: zeichnet das Overlay überhaupt?
  const textPng = await sharp(textSvg).png().toBuffer();
  const { data: rawText, info: textInfo } = await sharp(textPng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let textPixels = 0;
  for (let i = 3; i < rawText.length; i += textInfo.channels) {
    if (rawText[i] > 8) textPixels++;
  }
  if (textPixels < 200) {
    throw new PinRenderError(
      'font_missing',
      `Text-Overlay zeichnet nichts (${textPixels} Pixel) — im Laufzeit-Image fehlt eine Schrift.`,
    );
  }

  // 2) Foto auf das Pin-Format bringen (EXIF-Rotation beachten, cover-Beschnitt).
  const base = await sharp(Buffer.from(input.photo))
    .rotate()
    .resize(PIN_WIDTH, PIN_HEIGHT, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  const layers: { input: Buffer; top: number; left: number }[] = [
    { input: await sharp(scrimSvg).png().toBuffer(), top: 0, left: 0 },
    { input: textPng, top: 0, left: 0 },
  ];
  if (brandSvg) {
    layers.push({ input: await sharp(Buffer.from(brandSvg)).png().toBuffer(), top: 0, left: 0 });
  }

  // 3) Logo optional — Position und Breite aus dem Markenprofil.
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

  // 4) Ausgabe fail-closed prüfen: 1000 × 1500 PNG, sonst kein Ergebnis.
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
    textPixels,
    sharpVersion: String(versions.sharp ?? 'unbekannt'),
    libvips: String(versions.vips ?? 'unbekannt'),
    layout,
  };
}
