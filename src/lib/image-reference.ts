// ── Referenzbild im Browser (Stabilisierung Schritt 3, Punkt 3) ───────────────
//
// Vorher: `handleFiles` erzeugte aus der Datei nur eine Anzeige-URL
// (`URL.createObjectURL`). Diese Datei liest den ECHTEN Bildinhalt als data-URL
// ein und hält ihn klein genug für den ServerFn-Request.
//
// Wichtig (Owner-Vorgabe / Speicherlast): data-URLs werden NUR im React-State
// für den laufenden Vorgang gehalten — NIE in der sessionStorage (die Galerie
// persistiert weiterhin nur Metadaten/Vorschauen, siehe lib/image-gallery.ts).
import {
  MAX_REFERENCE_DATA_URL_LENGTH,
  sanitizeReferenceImageData,
} from '~/ai/image-providers/reference';

/** Status eines hochgeladenen Bilds (ehrliche UI: lesen/bereit/nicht lesbar). */
export type UploadStatus = 'reading' | 'ready' | 'failed';

export interface UploadEntry {
  name: string;
  /** Anzeige-URL (Object-URL) — nur für die Vorschau, KEINE Bildidentität. */
  url: string;
  /** Echter Bildinhalt als data-URL; `null`, solange nicht gelesen/unlesbar. */
  dataUrl: string | null;
  mime: string;
  status: UploadStatus;
}

/** Liest eine Datei als data-URL (FileReader, client-only). */
export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('Datei konnte nicht gelesen werden'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Datei konnte nicht gelesen werden'));
    reader.readAsDataURL(file);
  });
}

/** Muss die data-URL vor dem Versand verkleinert werden? (rein, testbar) */
export function shouldShrinkReference(
  dataUrl: string,
  maxLength: number = MAX_REFERENCE_DATA_URL_LENGTH,
): boolean {
  return typeof dataUrl === 'string' && dataUrl.length > maxLength;
}

/** Zielgröße der längeren Bildkante beim Verkleinern. */
export const REFERENCE_MAX_EDGE = 1024;

/**
 * Verkleinert eine zu große data-URL über ein Canvas. Gibt bei jedem Fehler
 * (Canvas nicht verfügbar, unbekanntes Format) die ORIGINAL-data-URL zurück —
 * der Aufrufer entscheidet dann über `sanitizeReferenceImageData`, ob sie
 * brauchbar ist (fail-closed: keine stille Text→Bild-„Variation").
 */
export async function shrinkReferenceImage(
  dataUrl: string,
  maxLength: number = MAX_REFERENCE_DATA_URL_LENGTH,
): Promise<string> {
  if (!shouldShrinkReference(dataUrl, maxLength)) return dataUrl;
  try {
    const image = await loadImage(dataUrl);
    const scale = Math.min(1, REFERENCE_MAX_EDGE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    // Weißer Grund: JPEG kennt keine Transparenz — sonst würden transparente
    // Produktfotos schwarz.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const jpeg = canvas.toDataURL('image/jpeg', 0.85);
    return sanitizeReferenceImageData(jpeg) ? jpeg : dataUrl;
  } catch {
    return dataUrl;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
    img.src = src;
  });
}

/**
 * Welche Bildreferenz geht in die Strategie-zu-Bild-Generierung?
 *
 * Reihenfolge (Owner-Punkt 5 „vorhandenes Produktbild (sofern vorhanden)"):
 *   1. Referenz aus dem Strategie-Prefill (falls ein Aufrufer eine mitschickt)
 *   2. das erste im Studio hochgeladene, wirklich lesbare Produktbild
 * Ohne beides: `undefined` → ehrliche Text→Bild-Generierung (kein Fake-Edit).
 *
 * Reine Funktion, damit die Entscheidung ohne DOM testbar ist.
 */
export function pickStrategyReferenceImage(
  prefillReference: string | null | undefined,
  uploads: Array<{ dataUrl: string | null }>,
): string | undefined {
  const fromPrefill = sanitizeReferenceImageData(prefillReference);
  if (fromPrefill) return fromPrefill;
  for (const upload of uploads) {
    const usable = sanitizeReferenceImageData(upload?.dataUrl);
    if (usable) return usable;
  }
  return undefined;
}
