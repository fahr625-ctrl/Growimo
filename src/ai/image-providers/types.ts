/**
 * Seitenverhältnisse, die die App an das Bildmodell gibt (Schritt 3,
 * Owner-Freigabe 2026-10-07). `'9:16'` ist neu (TikTok/Reels/Shorts, Hochkant)
 * und wird von `gpt-image-2` als freie Auflösung `720x1280` bedient — vorher
 * mappte die Ratio-Map `9:16` still auf `2:3` (falsches Format).
 */
export type ImageAspectRatio = '2:3' | '1:1' | '4:3' | '16:9' | '9:16';

/** Whitelist der unterstützten Formate (Laufzeit-Prüfung, fail-closed) — genau
 *  die Werte, die `SIZES` in `generate.ts` kennt. */
export const IMAGE_ASPECT_RATIOS: readonly ImageAspectRatio[] = [
  '2:3',
  '1:1',
  '4:3',
  '16:9',
  '9:16',
];

/** Ist der Wert ein unterstütztes Format? (fail-closed: nur Whitelist.) */
export function isImageAspectRatio(value: unknown): value is ImageAspectRatio {
  return typeof value === 'string' && (IMAGE_ASPECT_RATIOS as readonly string[]).includes(value);
}

/** Zahlenwert der unterstützten Formate (Breite/Höhe). */
const ASPECT_RATIO_VALUES: Record<ImageAspectRatio, number> = {
  '2:3': 2 / 3,
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
};

/**
 * Bildvariations-Fix B (Owner-Freigabe 2026-10-12) — welches Growimo-Format passt
 * zu den Maßen eines hochgeladenen Bilds?
 *
 * Vorher wurde der Upload-Pfad hart auf `1:1` gezwungen: Eine 2:3-Design-Vorlage
 * (Pinterest) wurde damit auf ein Quadrat umgebaut und das Layout (Spruch, Rahmen,
 * Baum) musste neu erfunden werden — genau der Owner-Befund.
 *
 * Abstand bemessen über den LOGARITHMUS des Seitenverhältnisses: das behandelt
 * Hoch- und Querformat symmetrisch (eine 3:2-Vorlage landet auf 4:3, nicht auf
 * 16:9) und bevorzugt damit die Orientierung der Vorlage.
 * `null` = Maße unbrauchbar → der Aufrufer entscheidet den Rückfall (1:1).
 */
export function nearestImageAspectRatio(width: number, height: number): ImageAspectRatio | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const target = width / height;
  let best: ImageAspectRatio | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const ratio of IMAGE_ASPECT_RATIOS) {
    // Toleranz, damit exakte Treffer stabil den ersten (2:3) und nicht den
    // zufällig gleich weit entfernten Nachbarn wählen.
    const distance = Math.abs(Math.log(target / ASPECT_RATIO_VALUES[ratio]));
    if (distance < bestDistance - 1e-12) {
      bestDistance = distance;
      best = ratio;
    }
  }
  return best;
}

export interface ImageGenerationRequest {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  style?: string;
  referenceImageUrl?: string;
  /**
   * Stabilisierung Schritt 3 (Punkt 3) — der ECHTE Bildinhalt der Vorlage als
   * data-URL (`data:image/(png|jpeg|webp);base64,…`). Ist sie gesetzt, läuft die
   * Generierung über `images.edit` und das Produkt bleibt identisch; ohne sie
   * bleibt es Text→Bild. Feld existierte vorher nicht — deshalb konnte keine
   * Bildidentität durch die Pipeline reisen.
   */
  referenceImageData?: string;
}

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  aspectRatio: string;
  createdAt: Date;
}

export interface ImageProvider {
  name: string;
  generateImage(req: ImageGenerationRequest): Promise<GeneratedImage>;
}
