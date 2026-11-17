// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Kampagne: Pin rendern (ServerFn)
// ─────────────────────────────────────────────────────────────────────────────
// Die Vorschau im Browser ist DAS gerenderte Pin: der Server komponiert Foto +
// Layout + Overlay + Markenfarbe mit `sharp` und gibt das PNG zurück. Damit
// zeigt die Oberfläche nie ein anderes Bild als den späteren Download.
//
// Kein KI-Aufruf, keine Kosten, keine Einheit — es wird nur gerechnet.
// Markenprofil: Farben kommen aus den HEX-Werten im Profil (Feld `brandColors`).
// Was das Profil nicht hergibt (keine Schrift, kein Logo, keine HEX-Farbe),
// wird NICHT erfunden — dann bleibt das Pin neutral.
// ─────────────────────────────────────────────────────────────────────────────

import { createServerFn } from '@tanstack/react-start';
import {
  PIN_HEIGHT,
  PIN_WIDTH,
  PinRenderError,
  renderPinPng,
  type PinBrand,
  type PinLayoutId,
} from './pin-render';
import { sanitizePinDrafts, type PinDraft } from './pin-drafts';
import { parseImageDataUrl } from './campaign';
import { isPinFontId, PIN_FONT_STACKS } from './pin-fonts';

export interface PinBrandInput {
  /** Markenprofil aktiv? (Schalter im UI) */
  applied: boolean;
  /** Freitext-Farben aus dem Profil (z. B. „#1f2937, #f59e0b"). */
  colors?: string | null;
  /** Markenname — erscheint als kleine Zeile auf dem Pin. */
  name?: string | null;
  /**
   * Brand Kit 2026-11-16: optionales Logo als Data-URL
   * (`data:image/png|jpeg|webp;base64,…`). Leerstring/fehlt = kein Logo =
   * bisheriges Pin. Wirkt nur, wenn `applied` true ist.
   */
  logo?: string | null;
  /**
   * Brand Kit 2026-11-16: Schriftwahl `'' | 'sans' | 'serif' | 'mono'`.
   * `''` und `'sans'` = die bisherige Schrift (Liberation Sans).
   */
  fontId?: string | null;
}

/** Logo-Obergrenze (SPEC §1: Data-URL ≤ 300 KB). */
export const LOGO_MAX_BYTES = 300 * 1024;

export interface RenderedPin {
  id: string;
  layout: PinLayoutId;
  /** PNG als Data-URL (1000 × 1500). */
  dataUrl: string;
  bytes: number;
  textPixels: number;
}

/**
 * HEX-Farben aus dem Profil-Freitext lesen. Nur echte HEX-Werte zählen —
 * Farbnamen werden NICHT geraten (sonst entstünde eine Farbe, die der Nutzer
 * nie gewählt hat).
 */
export function parseBrandColors(colors: string | null | undefined): {
  primary: string | null;
  accent: string | null;
} {
  const found = (colors ?? '').match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g) ?? [];
  const normalized = found.map((c) => c.toLowerCase());
  return { primary: normalized[0] ?? null, accent: normalized[1] ?? normalized[0] ?? null };
}

/**
 * Markenprofil für den Renderer bauen — ohne Profil/Farbe bleibt alles neutral.
 *
 * Brand Kit 2026-11-16: Die Schriftwahl wird hier zur CSS-Kette. Sie wird NUR
 * gesetzt, wenn wirklich eine andere Familie gewählt ist (`serif`/`mono`);
 * ohne Wahl bleibt `fontFamily` leer und der Renderer nimmt exakt die bisherige
 * Kette — der Pin bleibt dann Byte für Byte derselbe.
 */
export function pinBrandFrom(input: PinBrandInput | null | undefined): {
  brand: PinBrand | null;
  brandLine: string | null;
} {
  if (!input || input.applied !== true) return { brand: null, brandLine: null };
  const { primary, accent } = parseBrandColors(input.colors);
  const name = (input.name ?? '').trim().slice(0, 40);
  const fontFamily =
    isPinFontId(input.fontId) && input.fontId !== 'sans' ? PIN_FONT_STACKS[input.fontId] : null;
  // Ohne Farbe UND ohne Schriftwahl bleibt das Pin neutral (wie bisher).
  if (!primary && !fontFamily) return { brand: null, brandLine: name || null };
  return {
    brand: {
      primary: primary ?? null,
      accent: accent ?? primary ?? null,
      fontFamily,
    },
    brandLine: name || null,
  };
}

export class PinServerError extends Error {
  code: 'unauthorized' | 'invalid_input' | 'render_failed';
  constructor(code: PinServerError['code'], message: string) {
    super(message);
    this.name = 'PinServerError';
    this.code = code;
  }
}

export interface RenderPinsInput {
  /** Foto des Nutzers als Data-URL (JPEG/PNG/WebP). */
  photoDataUrl: string;
  brand?: PinBrandInput | null;
  /** 1 … 5 Entwürfe; jeder wird einzeln gerendert. */
  pins: PinDraft[];
}

export interface RenderPinsResult {
  pins: RenderedPin[];
  width: number;
  height: number;
}

/**
 * Rendert die übergebenen Pin-Entwürfe. Fail-closed: ohne lesbares Foto oder
 * ohne Text gibt es kein Bild (kein leeres Pin, kein Platzhalter).
 */
export const renderPinsServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input as RenderPinsInput)
  .handler(async ({ data }): Promise<RenderPinsResult> => {
    // Nur mit gültiger Session — die Strecke ist CPU-Arbeit, kein offener Dienst.
    const { requireUserIdFromServerFn } = await import('~/lib/usage-guard');
    await requireUserIdFromServerFn();

    const photo = parseImageDataUrl(data?.photoDataUrl);
    if (!photo) throw new PinServerError('invalid_input', 'Kein lesbares Foto.');
    if (!Array.isArray(data.pins) || data.pins.length === 0) {
      throw new PinServerError('invalid_input', 'Keine Pin-Entwürfe übergeben.');
    }

    const drafts = sanitizePinDrafts(data.pins.slice(0, 5));
    const photoBytes = new Uint8Array(Buffer.from(photo.base64, 'base64'));
    const { brand, brandLine } = pinBrandFrom(data.brand);

    // Brand Kit 2026-11-16: Logo nur, wenn das Markenprofil aktiv ist. Ein
    // vorhandenes, aber unlesbares Logo ist ein FEHLER — es wird nicht
    // stillschweigend weggelassen (sonst behauptet das Pin eine Marke, die
    // nicht darauf ist).
    let logoBytes: Uint8Array | null = null;
    const logoRaw = (data.brand?.applied === true ? (data.brand.logo ?? '') : '').trim();
    if (logoRaw) {
      const parsedLogo = parseImageDataUrl(logoRaw);
      if (!parsedLogo) {
        throw new PinServerError(
          'invalid_input',
          'Das Logo ist kein lesbares PNG/JPEG/WebP. Bitte erneut hochladen.',
        );
      }
      if (parsedLogo.bytes > LOGO_MAX_BYTES) {
        throw new PinServerError('invalid_input', 'Das Logo ist zu groß (höchstens 300 KB).');
      }
      logoBytes = new Uint8Array(Buffer.from(parsedLogo.base64, 'base64'));
    }

    // Schrift bereitstellen, BEVOR der erste Text gezeichnet wird: im
    // Laufzeit-Image gibt es keine Systemschriften (Befund 2026-11-15).
    const { ensurePinFonts } = await import('./pin-font');
    await ensurePinFonts();

    const rendered: RenderedPin[] = [];
    for (const draft of drafts) {
      if (!draft.headline.trim()) {
        throw new PinServerError('invalid_input', 'Ein Pin-Entwurf hat keinen Overlay-Text.');
      }
      let result;
      try {
        result = await renderPinPng({
          photo: photoBytes,
          layout: draft.layout,
          overlay: { textColor: draft.textColor, align: draft.align, offsetY: draft.offsetY },
          brandLine,
          brand,
          logo: logoBytes,
          title: draft.headline,
          subtitle: draft.subline || null,
        });
      } catch (err) {
        const code = err instanceof PinRenderError ? err.code : 'render_failed';
        throw new PinServerError('render_failed', `${code}: ${(err as Error).message}`);
      }
      rendered.push({
        id: draft.id,
        layout: result.layout,
        dataUrl: `data:image/png;base64,${result.png.toString('base64')}`,
        bytes: result.bytes,
        textPixels: result.textPixels,
      });
    }

    return { pins: rendered, width: PIN_WIDTH, height: PIN_HEIGHT };
  });
