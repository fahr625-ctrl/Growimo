// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Kampagne: Pin-Komposition mit `sharp` (kein generatives Modell)
// ─────────────────────────────────────────────────────────────────────────────
// Das Originalfoto des Nutzers wird auf 1000 × 1500 px beschnitten, mit einer
// Textfläche + Text + optionalem Logo überlagert und als PNG exportiert.
// Es wird NICHTS erfunden und NICHTS generiert: nur das hochgeladene Foto,
// Layout, Text und (falls aktiv) das Markenprofil.
//
// Fail-closed-Regeln (Phase-2-SPEC §6):
//   • Ausgabe muss nachweislich 1000 × 1500 px PNG sein, sonst Fehler.
//   • Text-Overlay muss nachweislich Pixel zeichnen. Fehlt im Laufzeit-Image
//     eine Schrift, liefert librsvg stillschweigend ein leeres Overlay — genau
//     das wird hier gemessen und als `font_missing` abgebrochen, statt ein
//     leeres Pin-Bild auszuliefern.
// ─────────────────────────────────────────────────────────────────────────────

export const PIN_WIDTH = 1000;
export const PIN_HEIGHT = 1500;

/** Freie, lizenzsichere Schriftkette (OFL-Systemschriften, keine Downloads). */
export const PIN_FONT_STACK =
  '"DejaVu Sans", "Liberation Sans", "Noto Sans", Arial, Helvetica, sans-serif';

export interface PinBrand {
  /** Primärfarbe (Hex, z. B. #1f2937) — Fläche hinter dem Text. */
  primary: string;
  /** Akzentfarbe (Hex) — Rahmen/Trennlinie. */
  accent: string;
  /** Schriftfamilie (nur OFL-Namen), leer = PIN_FONT_STACK. */
  fontFamily?: string | null;
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

type SharpFactory = typeof import('sharp').default;

/** Lazy: `sharp` wird erst beim ersten Rendern geladen (Native-Binding). */
async function getSharp(): Promise<SharpFactory> {
  const mod = await import(/* @vite-ignore */ 'sharp');
  return mod.default as unknown as SharpFactory;
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

/** Nur die Text-Ebene (transparent) — separat renderbar für die Messung. */
function textLayerSvg(input: PinRenderInput): string {
  const brand = input.brand ?? null;
  const fontFamily = brand?.fontFamily?.trim() || PIN_FONT_STACK;
  const accent = brand?.accent || '#ffffff';
  const titleLines = wrapText(input.title || '', 22, 3);
  const subtitleLines = input.subtitle ? wrapText(input.subtitle, 34, 2) : [];

  const titleSize = 74;
  const subtitleSize = 40;
  const lineGap = 18;
  const blockHeight =
    titleLines.length * (titleSize + lineGap) +
    (subtitleLines.length ? subtitleLines.length * (subtitleSize + lineGap) + 10 : 0);
  const baseY = PIN_HEIGHT - 150 - blockHeight + titleSize;

  const titleTspans = titleLines
    .map((line, i) => `<tspan x="70" y="${baseY + i * (titleSize + lineGap)}">${esc(line)}</tspan>`)
    .join('');
  const subtitleStartY = baseY + titleLines.length * (titleSize + lineGap) + 10;
  const subtitleTspans = subtitleLines
    .map(
      (line, i) =>
        `<tspan x="70" y="${subtitleStartY + i * (subtitleSize + lineGap)}">${esc(line)}</tspan>`,
    )
    .join('');

  return `<svg width="${PIN_WIDTH}" height="${PIN_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <text font-family='${esc(fontFamily)}' font-size="${titleSize}" font-weight="700" fill="#ffffff">${titleTspans}</text>
  <line x1="70" y1="${subtitleStartY - subtitleSize + 4}" x2="150" y2="${subtitleStartY - subtitleSize + 4}" stroke="${esc(accent)}" stroke-width="4" />
  ${subtitleTspans ? `<text font-family='${esc(fontFamily)}' font-size="${subtitleSize}" font-weight="400" fill="#ffffff">${subtitleTspans}</text>` : ''}
</svg>`;
}

/** Fläche hinter dem Text (Kontrast) + optionaler Markenrahmen. */
function scrimLayerSvg(input: PinRenderInput): string {
  const brand = input.brand ?? null;
  const primary = brand?.primary || '#111827';
  const accent = brand?.accent || null;
  return `<svg width="${PIN_WIDTH}" height="${PIN_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${esc(primary)}" stop-opacity="0" />
      <stop offset="55%" stop-color="${esc(primary)}" stop-opacity="0.55" />
      <stop offset="100%" stop-color="${esc(primary)}" stop-opacity="0.92" />
    </linearGradient>
  </defs>
  <rect x="0" y="${Math.round(PIN_HEIGHT * 0.42)}" width="${PIN_WIDTH}" height="${Math.round(PIN_HEIGHT * 0.58)}" fill="url(#g)" />
  ${accent ? `<rect x="12" y="12" width="${PIN_WIDTH - 24}" height="${PIN_HEIGHT - 24}" fill="none" stroke="${esc(accent)}" stroke-width="6" />` : ''}
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

  const textSvg = Buffer.from(textLayerSvg(input));
  const scrimSvg = Buffer.from(scrimLayerSvg(input));

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
  };
}
