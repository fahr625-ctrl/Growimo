// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Kampagne: Grundbild aus der Produktidee (2026-11-17)
// ─────────────────────────────────────────────────────────────────────────────
// ZWEITER WEG neben dem eigenen Foto: aus den Angaben, die der Nutzer schon
// gemacht hat (Produktidee, Zielgruppe, Kernbotschaft), entsteht GENAU EIN
// KI-Grundbild im Format 2:3. Daraus baut die Kampagne ihre fünf Pins —
// zugeschnitten, nicht generiert.
//
// Grenzen (Owner-Vorgabe):
//   • Ein Bild pro Kampagne. Kein zweiter Modell-Call, keine Varianten.
//   • Der Prompt behauptet NICHTS über das Produkt: er beschreibt eine Szene
//     mit den WORTEN des Nutzers. Keine Größen, Formate, Materialien, keine
//     Zahlen — es wird nichts erfunden.
//   • Das Modell zeichnet keinen Text (Architektur-Entscheidung 2026-11-11),
//     deshalb steht ausdrücklich „kein Text" im Prompt.
//   • Der Ausschnitt wird im Browser gesetzt und VOR dem Rendern gezeigt: was
//     in der Vorschau steht, ist der Rahmen, aus dem die Pins entstehen.
// ─────────────────────────────────────────────────────────────────────────────

import { PIN_HEIGHT, PIN_WIDTH, cropAnchor, type PinCrop, type PinCropFocus } from './pin-render';

export interface BaseImageSource {
  product: string;
  audience?: string;
  message?: string;
}

/** Läuft das Grundbild überhaupt? (Ohne Produktidee kein Prompt.) */
export function canBuildBaseImage(source: BaseImageSource): boolean {
  return (source.product ?? '').trim().length > 0;
}

/**
 * Prompt für das EINE Grundbild. Nur Nutzerangaben, keine erfundenen
 * Produkteigenschaften. Die untere Bildhälfte bleibt ruhig, weil dort in vier
 * der fünf Layouts die Textfläche sitzt (Motivschutz, SPEC §6).
 */
export function buildBaseImagePrompt(source: BaseImageSource): string {
  const product = (source.product ?? '').replace(/\s+/g, ' ').trim();
  const audience = (source.audience ?? '').replace(/\s+/g, ' ').trim();
  const message = (source.message ?? '').replace(/\s+/g, ' ').trim();

  const lines = [
    'Ein ruhiges, fotografisches Hochformat-Bild (Seitenverhältnis 2:3) als Hintergrund für ein Pinterest-Pin.',
    product ? `Motiv: ${product}.` : '',
    audience ? `Gemacht für: ${audience}.` : '',
    message ? `Stimmung: ${message}.` : '',
    'Natürliches Licht, klare Bildaufteilung, das Motiv sitzt in der oberen Bildhälfte.',
    'Die untere Bildhälfte bleibt ruhig und detailarm, damit Text darauf lesbar ist.',
    'Kein Text, keine Buchstaben, keine Schrift, keine Logos, kein Wasserzeichen, kein Rahmen.',
  ];
  return lines.filter(Boolean).join(' ');
}

/**
 * Ausschnitt am echten 2:3-Rahmen: das Bild wird mit `zoom` vergrößert und am
 * Ankerpunkt (`focus`) in ein 1000 × 1500-Fenster gelegt — dieselbe Rechnung
 * wie im Renderer (`cropToPinFrame`), damit die Vorschau nicht lügt.
 *
 * Kann der Browser nicht zeichnen, kommt das Original zurück (der Renderer
 * prüft das Bild ohnehin selbst).
 */
export async function cropBaseImageToPin(dataUrl: string, crop: PinCrop): Promise<string> {
  if (typeof document === 'undefined' || !dataUrl) return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image_load_failed'));
      el.src = dataUrl;
    });
    const iw = img.naturalWidth || PIN_WIDTH;
    const ih = img.naturalHeight || PIN_HEIGHT;
    const zoom = Math.min(2, Math.max(1, Number(crop.zoom) || 1));
    const scale = Math.max(PIN_WIDTH / iw, PIN_HEIGHT / ih) * zoom;
    const w = iw * scale;
    const h = ih * scale;
    const { fx, fy } = cropAnchor(crop.focus);
    const left = (PIN_WIDTH - w) * fx;
    const top = (PIN_HEIGHT - h) * fy;

    const canvas = document.createElement('canvas');
    canvas.width = PIN_WIDTH;
    canvas.height = PIN_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, left, top, w, h);
    return canvas.toDataURL('image/jpeg', 0.92);
  } catch {
    return dataUrl;
  }
}

/** Auswahlwerte für die Ausschnitt-Regler (Zoom). */
export const BASE_CROP_ZOOMS = [1, 1.25, 1.5, 1.75] as const;

/** Auswahlwerte für die Ausschnitt-Regler (Position). */
export const BASE_CROP_FOCUSES: PinCropFocus[] = ['centre', 'top', 'bottom', 'left', 'right'];
