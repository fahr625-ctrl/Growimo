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
  checkPinTextFit,
  isPinLayoutId,
  renderPinPng,
  type PinBrand,
  type PinLayoutId,
  type PinTextFitCode,
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

// ─────────────────────────────────────────────────────────────────────────────
// Bilder NICHT mehr im Request-Body (2026-11-22)
// ─────────────────────────────────────────────────────────────────────────────
// Befund 2026-11-19: Ein 3,78-MB-PNG als Data-URL sind ≈ 5,04 Mio. Zeichen; das
// Vercel-Body-Limit liegt bei 4,5 MB ⇒ HTTP 413, bevor der Renderer läuft.
// Deshalb trägt der Render-Aufruf nur noch eine REFERENZ (`imageId` des
// gespeicherten Originals) — der Server lädt die Bytes selbst.
// Die Schwelle ist gemessen (4,4 Mio. Zeichen kamen durch, 4,6 Mio. nicht):
// alles darüber wird VOR dem Request abgelehnt, mit Klartext statt 413.
export const PIN_RENDER_BODY_LIMIT_BYTES = 4_400_000;

/** Größe des Render-Requests in Bytes (Bild-Bytes zählen voll, wenn sie drin sind). */
export function estimatePinRenderBodyBytes(input: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(input ?? null)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export interface RenderedPin {
  id: string;
  layout: PinLayoutId;
  /** PNG als Data-URL (1000 × 1500). */
  dataUrl: string;
  bytes: number;
  textPixels: number;
  /** Tatsächlich gesetzte Textfarbe (Hex) — nach der Kontrast-Rettung. */
  textColor: string;
  /** Gewählte Textfarbe (Hex) — was der Nutzer angeklickt hat. */
  requestedTextColor: string;
  /**
   * Klartext, wenn die Textfarbe automatisch lesbarer gesetzt wurde
   * (2026-11-22: „Kontrast angepasst, damit der Text lesbar bleibt"), sonst null.
   */
  contrastNotice: string | null;
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
  code: 'unauthorized' | 'invalid_input' | 'render_failed' | 'image_unavailable' | 'body_too_large';
  constructor(code: PinServerError['code'], message: string) {
    super(message);
    this.name = 'PinServerError';
    this.code = code;
  }
}

export interface RenderPinsInput {
  /**
   * 2026-11-22: Referenz auf das GESPEICHERTE Original (`generated_images.id`).
   * Ist sie da, schickt der Client KEINE Bild-Bytes — der Server lädt selbst.
   */
  imageId?: string | null;
  /**
   * Nur noch Rückfall (Bild nicht dauerhaft gespeichert) bzw. eigenes Foto:
   * Foto als Data-URL (JPEG/PNG/WebP). Fällt unter das Body-Limit.
   */
  photoDataUrl?: string | null;
  brand?: PinBrandInput | null;
  /** 1 … 5 Entwürfe; jeder wird einzeln gerendert. */
  pins: PinDraft[];
}

export interface RenderPinsResult {
  pins: RenderedPin[];
  width: number;
  height: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vorabprüfung des Pin-Textes (2026-11-18)
// ─────────────────────────────────────────────────────────────────────────────
// Der Renderer verwirft einen Text, der nicht aufs Layout passt — bisher erst
// NACH dem bezahlten KI-Bild. Diese Prüfung fährt denselben Mess-Lauf
// (`checkPinTextFit` → `fitTextLayer`) VOR dem Aufruf von `/api/image/stream`.
// Sie erzeugt kein Bild, kostet nichts und bucht KEINE Einheit.

export interface PinTextCheckInput {
  /** Text, der auf dem Pin stehen soll (Überschrift). */
  title: string;
  /** Gewähltes Layout — die Passung hängt am Layout. */
  layout: string;
  brand?: PinBrandInput | null;
}

export interface PinTextCheckResult {
  fits: boolean;
  code: PinTextFitCode;
  message: string | null;
  /** Kürzungsvorschlag (längste Fassung an Wortgrenze, die passt) oder null. */
  suggestion: string | null;
  /** Der geprüfte Text (Escape-Reste aufgelöst). */
  checkedTitle: string;
  scale: number | null;
}

export const checkPinTextServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input as PinTextCheckInput)
  .handler(async ({ data }): Promise<PinTextCheckResult> => {
    // Nur mit gültiger Session — die Messung ist CPU-Arbeit, kein offener Dienst.
    const { requireUserIdFromServerFn } = await import('~/lib/usage-guard');
    await requireUserIdFromServerFn();

    const title = typeof data?.title === 'string' ? data.title : '';
    const layout: PinLayoutId = isPinLayoutId(data?.layout) ? data.layout : 'bottom-left';
    const { brand, brandLine } = pinBrandFrom(data?.brand);

    // Schrift bereitstellen, BEVOR gemessen wird (im Laufzeit-Image gibt es
    // keine Systemschriften) — genau wie beim Rendern.
    const { ensurePinFonts } = await import('./pin-font');
    await ensurePinFonts();

    const fit = await checkPinTextFit({ title, subtitle: null, layout, brand, brandLine });
    return {
      fits: fit.fits,
      code: fit.code,
      message: fit.message,
      suggestion: fit.suggestion,
      checkedTitle: fit.checkedTitle,
      scale: fit.scale,
    };
  });

/**
 * Klartext-Grund, wenn das referenzierte Bild nicht ladbar ist — nie wieder
 * „Aus diesem Bild konnte kein Pin werden", wenn in Wahrheit die Ablage fehlt.
 */
function imageRefMessage(status: number, reason?: string): string {
  if (status === 404) return 'Das gespeicherte Bild ist nicht mehr vorhanden — bitte das Bild erneut erzeugen.';
  if (status === 410) return 'Das gespeicherte Bild ist abgelaufen und wurde entfernt — bitte das Bild erneut erzeugen.';
  if (status === 403) return 'Das gespeicherte Bild gehört zu einem anderen Konto.';
  if (status === 401) return 'Für dieses Bild fehlt die Anmeldung — bitte neu anmelden.';
  return `Das gespeicherte Bild konnte nicht geladen werden (${status}${reason ? `, ${reason}` : ''}).`;
}

/**
 * Foto-Bytes für den Renderer besorgen.
 *
 * 2026-11-22: Vorrang hat die REFERENZ (`imageId`) — dann liegen keine Bild-Bytes
 * im Request-Body und die 4,5-MB-Grenze von Vercel fällt weg. Nur wenn das Bild
 * nicht dauerhaft gespeichert wurde, kommt der Data-URL-Rückfall (Größe vorher
 * geprüft, siehe `PIN_RENDER_BODY_LIMIT_BYTES`).
 */
async function loadPinPhotoBytes(
  data: RenderPinsInput | undefined,
  clerkId: string,
): Promise<Uint8Array> {
  const imageId = typeof data?.imageId === 'string' ? data.imageId.trim() : '';
  if (imageId) {
    const { tryResolveUserId } = await import('~/lib/generated-images-save');
    const ownerUserId = await tryResolveUserId(clerkId);
    if (!ownerUserId) {
      throw new PinServerError(
        'image_unavailable',
        'Zu diesem Konto liegt kein gespeichertes Bild — bitte das Bild erneut erzeugen.',
      );
    }
    const { fetchOwnImage } = await import('~/lib/generated-images-service');
    let outcome: Awaited<ReturnType<typeof fetchOwnImage>>;
    try {
      outcome = await fetchOwnImage({ requesterUserId: ownerUserId, imageId });
    } catch {
      throw new PinServerError(
        'image_unavailable',
        'Das gespeicherte Bild konnte nicht geladen werden — bitte das Bild erneut erzeugen.',
      );
    }
    if (outcome.status !== 200) {
      throw new PinServerError(
        'image_unavailable',
        imageRefMessage(outcome.status, 'reason' in outcome ? outcome.reason : undefined),
      );
    }
    if (!outcome.bytes || outcome.bytes.byteLength === 0) {
      throw new PinServerError(
        'image_unavailable',
        'Das gespeicherte Bild ist leer — bitte das Bild erneut erzeugen.',
      );
    }
    return outcome.bytes;
  }

  const photo = parseImageDataUrl(data?.photoDataUrl);
  if (!photo) throw new PinServerError('invalid_input', 'Kein lesbares Foto.');
  return new Uint8Array(Buffer.from(photo.base64, 'base64'));
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
    const clerkId = await requireUserIdFromServerFn();

    // Kein stiller 413: ein Body über der gemessenen Grenze wird hier mit Grund
    // abgelehnt (der Referenz-Pfad liegt weit darunter und trifft das nie).
    const hasRef = typeof data?.imageId === 'string' && data.imageId.trim().length > 0;
    if (!hasRef && estimatePinRenderBodyBytes(data) > PIN_RENDER_BODY_LIMIT_BYTES) {
      throw new PinServerError(
        'body_too_large',
        'Der Render-Aufruf war zu groß, weil das Bild als Data-URL mitgeschickt wurde — bitte das Bild erneut erzeugen.',
      );
    }

    const photoBytes = await loadPinPhotoBytes(data, clerkId);
    if (!Array.isArray(data.pins) || data.pins.length === 0) {
      throw new PinServerError('invalid_input', 'Keine Pin-Entwürfe übergeben.');
    }

    const drafts = sanitizePinDrafts(data.pins.slice(0, 5));
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
          // 2026-11-17: eigener Ausschnitt je Pin (null ⇒ Zuschnitt des Layouts).
          crop: draft.crop ?? null,
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
        textColor: result.textColor,
        requestedTextColor: result.requestedTextColor,
        contrastNotice: result.contrastNotice,
      });
    }

    return { pins: rendered, width: PIN_WIDTH, height: PIN_HEIGHT };
  });
