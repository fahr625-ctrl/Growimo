export interface ImageGenerationRequest {
  prompt: string;
  aspectRatio: '2:3' | '1:1' | '4:3' | '16:9';
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
