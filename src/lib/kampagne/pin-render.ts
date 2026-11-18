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
// KEIN WORT WIRD WEGGELASSEN (2026-11-15, Owner-Befund „Untertitel mitten im
// Satz abgeschnitten"): Der Umbruch kennt keine Zeilen-Obergrenze mehr. Passt
// ein Text nicht, wird er ZUERST umgebrochen (auch an vorhandenen Bindestrichen,
// damit ein langes Kompositum nicht die ganze Fläche breit macht) und danach
// verkleinert — nie gekürzt. Nach dem Setzen wird die Wortfolge gegen die
// Eingabe geprüft: fehlt auch nur ein Wort, gibt es KEIN Bild (`text_truncated`).
//
// Fail-closed-Regeln (Phase-2-SPEC §6):
//   • Ausgabe muss nachweislich 1000 × 1500 px PNG sein, sonst Fehler.
//   • Text-Overlay muss nachweislich Pixel zeichnen. Fehlt im Laufzeit-Image
//     eine Schrift, liefert librsvg stillschweigend ein leeres Overlay — genau
//     das wird hier gemessen und als `font_missing` abgebrochen.
//   • Text darf den sicheren Rand nicht überschreiten (`text_overflow`).
//   • Kein Wort darf verloren gehen (`text_truncated`).
//   • Text muss den Mindestkontrast erreichen (`contrast_too_low`).
// ─────────────────────────────────────────────────────────────────────────────

import { loadSharp, type SharpFactory } from './sharp-loader';
import { PIN_FONT_FAMILY_NAMES, PIN_FONT_STACKS, type PinFontId } from './pin-fonts';
import { PIN_FONT_COVERAGE, missingGlyphs, pinFontIdFromFamily } from './pin-font-coverage';
import { findResidualEscape, resolveEscapes } from '~/lib/text-normalize';

export const PIN_WIDTH = 1000;
export const PIN_HEIGHT = 1500;

/** Freie, lizenzsichere Schriftkette (OFL-Systemschriften, keine Downloads). */
// Reihenfolge: zuerst die EINGEBETTETE Schrift (pin-font.ts richtet fontconfig
// darauf ein) — damit der Pin überall gleich aussieht. Die Systemschriften
// danach sind nur Rückfall für die lokale Entwicklung.
export const PIN_FONT_STACK =
  PIN_FONT_STACKS.sans;

/** Mindestkontrast Text ↔ Hintergrund (WCAG AA, normaler Text). */
export const MIN_TEXT_CONTRAST = 4.5;

/** Abstand, den Text zum Pin-Rand halten muss. */
const SAFE_MARGIN = 40;

/**
 * Stufen, in denen die Schrift schrumpft, bis der Text in Rand und Fläche
 * passt. Die Liste reicht bewusst weit hinunter: lieber kleiner setzen als ein
 * Wort weglassen.
 */
const FIT_SCALES = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46, 0.4];

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

type ScrimKind = 'bottom-band' | 'top-band' | 'center-card' | 'bottom-corner' | 'bottom-band-soft';
type FrameKind = 'inset' | 'rule' | 'none';
type Anchor = 'top' | 'center' | 'bottom';

interface LayoutSpec {
  align: PinAlign;
  anchor: Anchor;
  titleSize: number;
  subtitleSize: number;
  titleChars: number;
  subtitleChars: number;
  marginX: number;
  scrim: ScrimKind;
  frame: FrameKind;
  frameWidth: number;
  /**
   * Motivschutz (2026-11-15): Die Textfläche darf erst UNTERHALB dieser Höhe
   * beginnen (Anteil der Pin-Höhe). Damit bleibt die Bildmitte — dort sitzt in
   * den allermeisten Fotos das Produktmotiv — unverdeckt. Reicht der Platz
   * nicht, verkleinert der Fit-Lauf die Schrift; gekürzt wird nie.
   */
  bandTopFrac?: number;
  /** Abstand des Textblocks zur Unterkante in px (default 140). */
  bottomInset?: number;
  /**
   * Breitengebunden: die Zeichen pro Zeile bleiben beim Verkleinern KONSTANT.
   * Nötig, wenn die Textfläche eine feste Breite hat (Seitenstreifen) — sonst
   * würde kleiner gesetzte Schrift automatisch mehr Zeichen pro Zeile fassen
   * und die Fläche bliebe trotzdem so breit wie das Foto es zulässt.
   */
  widthBound?: boolean;
  /** Feste Breite der Textfläche (px) — nur bei `bottom-corner`. */
  stripe?: { solid: number; fade: number };
}

const LAYOUTS: Record<PinLayoutId, LayoutSpec> = {
  // 1) Klassisch: Text unten links, geschlossenes Fußband, feiner Markenrahmen.
  'bottom-left': {
    align: 'left',
    anchor: 'bottom',
    titleSize: 76,
    subtitleSize: 40,
    titleChars: 22,
    subtitleChars: 34,
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
    subtitleChars: 36,
    marginX: 70,
    scrim: 'top-band',
    frame: 'rule',
    frameWidth: 8,
  },
  // 3) Karte: gerundete Fläche, zentriert, aber im UNTEREN Bilddrittel — vorher
  //    lag sie mitten auf dem Produktmotiv (Owner-Befund 2026-11-15).
  'center-card': {
    align: 'center',
    anchor: 'bottom',
    titleSize: 60,
    subtitleSize: 34,
    titleChars: 21,
    subtitleChars: 44,
    marginX: 84,
    scrim: 'center-card',
    frame: 'none',
    frameWidth: 0,
    bandTopFrac: 0.75,
    bottomInset: 70,
  },
  // 4) Seitenstreifen: schmale Textfläche am linken Rand, jetzt aber nur im
  //    unteren Viertel (vorher über die volle Höhe — sie nahm dem Foto die
  //    linke Hälfte und dem Poster die Sichtbarkeit). Die Fläche hat eine FESTE
  //    Breite (440 px); die Schrift füllt sie aus, statt darüber hinauszuwachsen.
  'side-stripe': {
    align: 'left',
    anchor: 'bottom',
    titleSize: 56,
    subtitleSize: 30,
    titleChars: 13,
    subtitleChars: 23,
    marginX: 44,
    scrim: 'bottom-corner',
    frame: 'rule',
    frameWidth: 10,
    stripe: { solid: 440, fade: 0 },
    bandTopFrac: 0.75,
    bottomInset: 70,
  },
  // 5) Reduziert: wenig Text, zentriert unten, schmales Band statt Rahmenkarte.
  'minimal-frame': {
    align: 'center',
    anchor: 'bottom',
    titleSize: 58,
    subtitleSize: 32,
    titleChars: 30,
    subtitleChars: 46,
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
  primary?: string | null;
  /** Akzentfarbe (Hex) — Rahmen/Trennlinie. */
  accent?: string | null;
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
  /** Optionales Logo (PNG/JPEG/WebP; Transparenz wird übernommen). */
  logo?: Uint8Array | null;
  /**
   * @deprecated Brand Kit 2026-11-16: Position und Größe sind jetzt fest
   * (SPEC §3: unten rechts, ≤ 26 % Breite, ≤ 10 % Höhe, 40 px Rand). Die Felder
   * bleiben nur für ältere Aufrufer stehen und werden nicht mehr ausgewertet.
   */
  logoPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** @deprecated siehe `logoPosition`. */
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
    | 'logo_unreadable'
    | 'text_escaped'
    | 'text_overflow'
    | 'text_truncated'
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

/**
 * Bricht Text in Zeilen — OHNE je ein Wort zu verlieren.
 *
 * Es gibt keine Zeilen-Obergrenze: lieber mehr Zeilen (und danach kleinere
 * Schrift) als ein halber Satz. Ein einzelnes Wort, das breiter als die Zeile
 * ist, wird an einem VORHANDENEN Bindestrich getrennt („Gäste-" / „WC-Poster")
 * — dabei geht kein Zeichen verloren, weil der Bindestrich stehen bleibt.
 */
export function wrapText(text: string, maxCharsPerLine: number): string[] {
  const limit = Math.max(4, Math.round(maxCharsPerLine));
  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    if (word.length > limit) {
      // Zu langes Einzelwort: an vorhandenen Bindestrichen umbrechen.
      let rest = word;
      while (rest.length > limit) {
        const cut = rest.lastIndexOf('-', limit - 1);
        if (cut <= 0) break;
        lines.push(rest.slice(0, cut + 1));
        rest = rest.slice(cut + 1);
      }
      current = rest;
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Vergleichsform: Zeilenumbrüche (auch nach Bindestrich) zählen nicht. */
function normalizeForCompare(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([-/\u2010\u00AD])\s+/g, '$1');
}

/**
 * Prüft, dass die gesetzten Zeilen die Eingabe VOLLSTÄNDIG enthalten: gleiche
 * Wortfolge, gleiche Zeichen. Ein fehlendes Wort ⇒ `false` ⇒ kein Bild.
 */
export function textIsComplete(source: string, lines: string[]): boolean {
  return normalizeForCompare(lines.join(' ')) === normalizeForCompare(source);
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

// ── Schrift-Prüfung: Glyphen-Coverage, KEINE Pixel ──────────────────────────
// BEFUND 2026-11-15: Ohne Schrift zeichnet librsvg für JEDES Zeichen dasselbe
// leere Kästchen — „Text" im Sinne einer Pixelzählung, und doch unlesbar.
//
// BEFUND 2026-11-17 (SPEC §9): Die damalige Folgerung, fehlende Zeichen über
// einen Pixelvergleich mit dem Ersatzzeichen (.notdef) zu erkennen, kann nicht
// greifen: Pango schreibt den Codepoint INS Kästchen. Jedes fehlende Zeichen
// sieht damit anders aus als .notdef und galt als vorhanden — sechs von sechs
// Pins gingen mit sichtbarem Kästchen durch.
//
// Jetzt wird nicht gemessen, sondern GELESEN: pin-font-coverage.ts enthält die
// belegten Codepoints der eingebetteten Schrift, erzeugt aus genau den Bytes,
// die fontconfig bekommt. Jedes Zeichen von Titel, Untertitel und Markenzeile
// wird gegen die Coverage der GEWÄHLTEN Familie geprüft; fehlt eins, gibt es
// kein Bild (`font_missing`, mit Zeichen und U+Nummer).

/**
 * Deterministische Vorprüfung ohne Pixel: ist die eingebettete Schrift in
 * diesem Prozess überhaupt bereitgestellt? `pin-font.ts` legt sie ab und setzt
 * `FONTCONFIG_FILE` — fehlt die Variable, würde Pango Kästchen zeichnen.
 */
function assertFontPrepared(fontId: PinFontId): void {
  if (PIN_FONT_COVERAGE[fontId].size === 0) {
    throw new PinRenderError(
      'font_missing',
      `Für die Schrift „${PIN_FONT_FAMILY_NAMES[fontId]}" ist keine Glyphen-Coverage hinterlegt — es wird nichts geraten.`,
    );
  }
  if (!(process.env.FONTCONFIG_FILE ?? '').trim()) {
    throw new PinRenderError(
      'font_missing',
      `Die eingebettete Schrift „${PIN_FONT_FAMILY_NAMES[fontId]}" ist nicht bereitgestellt (FONTCONFIG_FILE fehlt) — es entstünden leere Kästchen.`,
    );
  }
}

/**
 * Prüft JEDES Zeichen des Pins gegen die Coverage der gewählten Familie.
 * Leerraum und Zeilenumbrüche sind kein Fehler, Ersatzzeichen (U+FFFD) gelten
 * als gewollt. Fehlt ein Zeichen: `font_missing`, kein Bild.
 */
export function assertGlyphsRenderable(
  fontFamily: string | null | undefined,
  texts: (string | null | undefined)[],
): void {
  const fontId = pinFontIdFromFamily(fontFamily);
  assertFontPrepared(fontId);
  const missing = missingGlyphs(fontId, texts);
  if (missing.length > 0) {
    const list = missing.map((m) => `„${m.char}" (${m.label})`).join(', ');
    throw new PinRenderError(
      'font_missing',
      `Die gewählte Schrift „${PIN_FONT_FAMILY_NAMES[fontId]}" hat ${missing.length} Zeichen des Textes nicht (${list}) — es entstünde ein leeres Kästchen. Bitte eine andere Schrift wählen oder das Zeichen ersetzen.`,
    );
  }
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

  // Kleinere Schrift fasst mehr Zeichen pro Zeile — außer bei breitengebundenen
  // Layouts, deren Textfläche eine feste Breite hat.
  const charsFor = (base: number) =>
    spec.widthBound ? base : Math.max(6, Math.round(base / scale));

  const titleLines = wrapText(input.title || '', charsFor(spec.titleChars));
  const subtitleLines = input.subtitle
    ? wrapText(input.subtitle, charsFor(spec.subtitleChars))
    : [];

  const blockHeight =
    titleLines.length * (titleSize + lineGap) +
    (subtitleLines.length ? subtitleLines.length * (subtitleSize + lineGap) + ruleGap : 0);

  let blockTop =
    spec.anchor === 'bottom'
      ? PIN_HEIGHT - (spec.bottomInset ?? 140) - blockHeight
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
function brandLineSvg(input: PinRenderInput, g: TextGeometry, fontSize = 30): string | null {
  const text = (input.brandLine ?? '').trim();
  if (!text) return null;
  const fontFamily = input.brand?.fontFamily?.trim() || PIN_FONT_STACK;
  const accent = safeHexColor(input.brand?.accent, '#ffffff');
  // Gegenüber dem Textblock, damit sich nichts überlagert.
  const y = g.spec.anchor === 'top' ? PIN_HEIGHT - 60 : 90;
  return `<svg width="${PIN_WIDTH}" height="${PIN_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <text x="${Math.round(PIN_WIDTH / 2)}" y="${y}" text-anchor="middle" font-family='${esc(fontFamily)}' font-size="${fontSize}" font-weight="600" fill="${accent}" fill-opacity="0.95">${esc(text)}</text>
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
    // Seitenstreifen im unteren Bildviertel: FESTE Breite, Höhe ab der
    // gemessenen Textbox bis zur Unterkante. Der senkrechte Akzentbalken links
    // hält den Streifen-Charakter, ohne dem Foto die Mitte zu nehmen.
    const stripe = g.spec.stripe ?? { solid: 440, fade: 0 };
    const solidW = Math.min(PIN_WIDTH, stripe.solid);
    const blockTop = Math.max(0, Math.round(panel.y));
    body =
      `<rect x="0" y="${blockTop}" width="${solidW}" height="${PIN_HEIGHT - blockTop}" ${fill} fill-opacity="${PANEL_OPACITY}" />` +
      `<rect x="0" y="${blockTop}" width="${g.spec.frameWidth}" height="${PIN_HEIGHT - blockTop}" fill="${accent}" />`;
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
  /** Gesetzte Zeilen — Beleg, dass der Text vollständig untergebracht ist. */
  titleLineCount: number;
  subtitleLineCount: number;
  /** Wortfolge vollständig? (harte Regel — bei `false` gäbe es kein Bild). */
  wordsComplete: boolean;
  /** Laufzeit-Angaben für den Artefakt-Beleg. */
  sharpVersion: string;
  libvips: string;
  /** Das tatsächlich verwendete Layout. */
  layout: PinLayoutId;
  /** Deckende Textfläche (Foto-Koordinaten) — Beleg für den Motivschutz. */
  panel: Rect;
  /** Logoplatzierung im Pin (null = kein Logo) — Beleg für die SPEC-Grenzen. */
  logo: { top: number; left: number; width: number; height: number } | null;
}

// ── Logo (Brand Kit 2026-11-16) ──────────────────────────────────────────────

/** Grenzen aus SPEC §3: 26 % der Breite, 10 % der Höhe, 40 px Rand. */
const LOGO_MAX_WIDTH = Math.round(PIN_WIDTH * 0.26); // 260 px
const LOGO_MAX_HEIGHT = Math.round(PIN_HEIGHT * 0.1); // 150 px
const LOGO_MARGIN = 40;

function overlapsInk(rect: Rect, box: InkBox): boolean {
  return (
    rect.x < box.right && rect.x + rect.width > box.left && rect.y < box.bottom && rect.y + rect.height > box.top
  );
}

/**
 * Logo auf Pin-Maß bringen und platzieren: unten rechts, 40 px Rand, ÜBER Foto
 * und Textfläche. Das Seitenverhältnis bleibt erhalten (fit: inside), das Logo
 * wird nie vergrößert. Kollidiert es mit dem Text oder der Markenzeile, wandert
 * es nach OBEN aus dem Weg — Lesbarkeit vor Zierde, aber ohne die Ecke zu
 * verlassen. Ist das Logo nicht lesbar, gibt es einen Fehler (kein stilles
 * Weglassen).
 */
async function placeLogo(
  sharp: SharpFactory,
  logo: Uint8Array,
  obstacles: (InkBox | null)[],
): Promise<{ png: Buffer; top: number; left: number; width: number; height: number }> {
  let png: Buffer;
  try {
    png = await sharp(Buffer.from(logo))
      .rotate()
      .resize({
        width: LOGO_MAX_WIDTH,
        height: LOGO_MAX_HEIGHT,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  } catch (err) {
    throw new PinRenderError(
      'logo_unreadable',
      `Das Logo ist nicht lesbar (${(err as Error).message}). Bitte als PNG, JPEG oder WebP erneut hochladen.`,
    );
  }
  const meta = await sharp(png)
    .metadata()
    .catch(() => null);
  const width = meta?.width ?? 0;
  const height = meta?.height ?? 0;
  if (!width || !height) {
    throw new PinRenderError(
      'logo_unreadable',
      'Das Logo hat keine lesbaren Maße. Bitte als PNG, JPEG oder WebP erneut hochladen.',
    );
  }

  const left = PIN_WIDTH - width - LOGO_MARGIN;
  let top = PIN_HEIGHT - height - LOGO_MARGIN;
  const boxes = obstacles.filter((b): b is InkBox => b !== null);
  for (let step = 0; step < 8; step++) {
    const hit = boxes.find((box) => overlapsInk({ x: left, y: top, width, height }, box));
    if (!hit) break;
    top = hit.top - height - 16;
    if (top < LOGO_MARGIN) {
      top = LOGO_MARGIN;
      break;
    }
  }
  return { png, top: Math.max(0, Math.round(top)), left: Math.max(0, Math.round(left)), width, height };
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
  // 0a) Escape-Reste (2026-11-18, Befund „… einzigartig\"" und mehrfach escaped):
  //     Ein Backslash, der UNMITTELBAR vor einem Anführungszeichen steht, ist
  //     ein Escape-Rest ohne Wortinhalt — er wird entfernt, das Bild entsteht
  //     (nichts geht verloren). Was danach noch an Backslashes übrig ist
  //     (mitten im Wort, vor einem Leerzeichen), ist NICHT vertrauenswürdig:
  //     der Renderer setzt die Zeichen wörtlich, der Nutzer bekäme den
  //     Backslash mitgeliefert, ohne es zu merken. Also: kein Bild, klare
  //     Meldung (fail-closed). Die volle Reparatur passiert vorher in
  //     `normalizeModelText`.
  input = {
    ...input,
    title: resolveEscapes(input.title) ?? '',
    subtitle: resolveEscapes(input.subtitle),
    brandLine: resolveEscapes(input.brandLine),
  };
  const escaped = findResidualEscape([input.title, input.subtitle, input.brandLine]);
  if (escaped !== null) {
    throw new PinRenderError(
      'text_escaped',
      `Der Text enthält einen Escape-Rest (Backslash) und wird nicht ins Bild gesetzt: ${escaped.slice(0, 80)}`,
    );
  }
  const sharp = await getSharp();
  const versions = (sharp as unknown as { versions?: Record<string, string> }).versions ?? {};
  // 0) Erst prüfen, dass die Schrift überhaupt Zeichen zeichnet — und zwar
  //    GEGEN DIE GEWÄHLTE FAMILIE (Brand Kit 2026-11-16). Ohne diesen Nachweis
  //    entstünde ein Pin voller leerer Kästchen (Tofu) — ein Bild, das wie ein
  //    Ergebnis aussieht und keines ist. Geprüft wird der ECHTE Text: fehlt
  //    auch nur ein Zeichen in der Familie, gibt es kein Bild.
  assertGlyphsRenderable(input.brand?.fontFamily, [
    input.title,
    input.subtitle,
    input.brandLine,
  ]);
  const layout: PinLayoutId = input.layout && isPinLayoutId(input.layout) ? input.layout : 'bottom-left';

  // 1) Text-Ebene rendern, messen und — falls nötig — verkleinern, bis sie in
  //    den sicheren Rand UND (bei breitengebundenen Layouts) in die Textfläche
  //    passt. Die Messung ist die Grundlage der Textfläche. Gekürzt wird nie:
  //    passt der Text in keiner Stufe, gibt es kein Bild.
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
    const padX = Math.round(28 + g.titleSize * 0.18);
    const padY = Math.round(26 + g.titleSize * 0.12);
    const insideStripe = g.spec.stripe
      ? measured.box.right + padX <= g.spec.stripe.solid - 6
      : true;
    // Motivschutz: die Fläche (Textbox + Sicherheitsabstand) muss vollständig
    // unterhalb der Bandgrenze liegen — sonst nächste, kleinere Schriftstufe.
    const bandTop = g.spec.bandTopFrac ? Math.round(PIN_HEIGHT * g.spec.bandTopFrac) : 0;
    const insideBand = measured.box.top - padY >= bandTop;
    if (boxFitsSafeArea(measured.box) && insideStripe && insideBand) {
      geometryUsed = g;
      textLayer = measured;
      fontScale = scale;
      break;
    }
  }
  if (!geometryUsed || !textLayer) {
    throw new PinRenderError(
      'text_overflow',
      'Der Text passt auch verkleinert nicht in den sicheren Rand oder in die Textfläche des Pins.',
    );
  }

  // 1b) Harte Regel: kein Wort darf fehlen. Geprüft wird die tatsächlich
  //     gesetzte Wortfolge gegen die Eingabe — nicht die Absicht.
  if (
    !textIsComplete(input.title || '', geometryUsed.titleLines) ||
    (input.subtitle ? !textIsComplete(input.subtitle, geometryUsed.subtitleLines) : false)
  ) {
    throw new PinRenderError(
      'text_truncated',
      'Der Text würde unvollständig gesetzt — es fehlen Wörter. Kein Bild.',
    );
  }

  // 2) Markenzeile messen (eigene Fläche) — bei Bedarf verkleinern, nie kürzen.
  let brandSvg = brandLineSvg(input, geometryUsed);
  let brandLayer = brandSvg ? await measureInk(sharp, Buffer.from(brandSvg)) : null;
  if (brandSvg && brandLayer) {
    const maxBrandWidth = PIN_WIDTH - 120;
    const brandWidth = brandLayer.box.right - brandLayer.box.left;
    if (brandWidth > maxBrandWidth) {
      const smaller = Math.max(14, Math.round(30 * (maxBrandWidth / brandWidth)));
      brandSvg = brandLineSvg(input, geometryUsed, smaller);
      brandLayer = brandSvg ? await measureInk(sharp, Buffer.from(brandSvg)) : null;
    }
  }

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

  /** Tatsächliche Logoplatzierung im Pin — Beleg für die SPEC-Grenzen. */
  let logoPlacement: { top: number; left: number; width: number; height: number } | null = null;

  // 6b) Optionales Logo (Brand Kit 2026-11-16). Regeln der SPEC §3:
  //     Seitenverhältnis erhalten, höchstens 26 % der Pin-Breite und 10 % der
  //     Pin-Höhe, Rand 40 px, unten rechts, ÜBER Foto und Textfläche.
  //     Ein unlesbares Logo ist ein Fehler und wird NICHT stillschweigend
  //     weggelassen — sonst behauptet der Pin eine Marke, die nicht drauf ist.
  if (input.logo && input.logo.length > 0) {
    const placed = await placeLogo(sharp, input.logo, [textLayer.box, brandLayer?.box ?? null]);
    logoPlacement = { top: placed.top, left: placed.left, width: placed.width, height: placed.height };
    layers.push({ input: placed.png, top: placed.top, left: placed.left });
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
    titleLineCount: geometryUsed.titleLines.length,
    subtitleLineCount: geometryUsed.subtitleLines.length,
    wordsComplete:
      textIsComplete(input.title || '', geometryUsed.titleLines) &&
      (input.subtitle ? textIsComplete(input.subtitle, geometryUsed.subtitleLines) : true),
    sharpVersion: String(versions.sharp ?? 'unbekannt'),
    libvips: String(versions.vips ?? 'unbekannt'),
    layout,
    panel,
    logo: logoPlacement,
  };
}
