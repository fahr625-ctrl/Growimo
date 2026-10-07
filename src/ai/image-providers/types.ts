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
