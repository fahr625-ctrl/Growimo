// ─────────────────────────────────────────────────────────────────────────────
// Pin-Bild aus fertigem Pin-Text (2026-11-17)
// ─────────────────────────────────────────────────────────────────────────────
// Der Nutzer hat den Pinterest-Text schon fertig. Dieser Prompt erzeugt NUR das
// HINTERGRUNDBILD dafür — keinen Text im Bild: das Modell zeichnet keinen Text
// (Architektur-Regel), Überschrift und Layout kommen anschließend aus dem
// deterministischen Renderer (`renderPinPng`, fünf Layouts).
//
// Nichts wird erfunden: das Motiv besteht ausschließlich aus den Worten des
// Nutzers (Produktidee, Pin-Titel, Pin-Text). Fehlt alles, gibt es KEINEN
// Prompt und damit kein Bild (fail-closed) — statt eines austauschbaren
// Stockmotivs, das der Nutzer nie beschrieben hat.
// ─────────────────────────────────────────────────────────────────────────────

/** Obergrenze des Prompts (die Route trimmt nur, sie begrenzt nicht). */
export const PIN_IMAGE_PROMPT_MAX = 1800;

export interface PinImagePromptInput {
  /** Pin-Titel aus dem fertigen Ergebnis. */
  title: string;
  /** Pin-Beschreibung/-Text aus dem fertigen Ergebnis. */
  description?: string | null;
  /** Produktangaben des Nutzers (Ideenfeld). */
  productIdea?: string | null;
}

/**
 * Anführungszeichen entfernen: sie lesen sich für ein Bildmodell wie Text, der
 * gezeichnet werden soll — und Text im Bild ist hier ausdrücklich verboten.
 */
function words(value: string | null | undefined, max: number): string {
  return (value ?? '')
    .replace(/["„“”'‚‘’«»`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** Der Prompt für EIN Hintergrundbild — `null`, wenn es nichts zu beschreiben gibt. */
export function buildPinImagePrompt(input: PinImagePromptInput): string | null {
  const product = words(input.productIdea, 500);
  const title = words(input.title, 160);
  const description = words(input.description, 400);
  if (!product && !title && !description) return null;

  const parts = [
    'Vertical 2:3 editorial photograph as the background of a Pinterest pin.',
    product ? `Subject: ${product}.` : '',
    title ? `Theme: ${title}.` : '',
    description ? `Context: ${description}.` : '',
    // Die untere Bildhälfte bleibt ruhig: dort sitzt später die Textfläche des
    // Renderers. Das ist eine Kompositionsvorgabe, keine Produktaussage.
    'Photorealistic, natural daylight, calm and uncluttered composition, the lower half stays quiet and evenly lit, sharp focus, no people looking into the camera, no signage.',
    'Absolutely no text, no letters, no numbers, no words, no logos, no watermarks, no UI elements in the image.',
  ].filter(Boolean);

  return parts.join(' ').slice(0, PIN_IMAGE_PROMPT_MAX);
}
