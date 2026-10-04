import OpenAI, { toFile } from 'openai';
import {
  extensionForMime,
  imageRunMode,
  parseImageDataUrl,
} from './reference';

// gpt-image-1 is the working model for this API key (dall-e-3/dall-e-2 no longer
// exist on the endpoint). Two paths:
//   • images.generations — text → image (no reference)
//   • images.edits       — reference image + prompt (Stabilisierung Schritt 3)
// Both always return base64-encoded PNGs (response_format is not supported).
const MODEL = 'gpt-image-1';
// gpt-image-1 supports 1024x1024, 1024x1536 (portrait) and 1536x1024 (landscape).
const SIZES: Record<string, string> = {
  '2:3': '1024x1536',
  '1:1': '1024x1024',
  '4:3': '1536x1024',
  '16:9': '1536x1024',
};
// gpt-image-1 always returns b64_json, so we hand the client a
// data:image/png;base64 URL directly. No filesystem writes are involved — this
// keeps the function compatible with Vercel serverless (read-only filesystem).
//
// `referenceImageData` (optional, data-URL eines Nutzer-/Produktbilds):
// Sobald sie vorhanden ist, läuft die Generierung über `images.edit` und das
// Produkt bleibt visuell gebunden (input_fidelity: 'high'). Ohne sie bleibt es
// bei Text→Bild — aber NIE stillschweigend als „Variation" verkauft; der
// Aufrufer (Bild-Studio) kennzeichnet den Fall ehrlich.
export async function generateImage(
  prompt: string,
  aspectRatio: string,
  referenceImageData?: string,
): Promise<{ url: string }> {
  const ratio = aspectRatio as '2:3' | '1:1' | '4:3' | '16:9';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('[image-generation] OPENAI_API_KEY is not configured');
  const client = new OpenAI({ apiKey });
  const size = SIZES[ratio] ?? '1024x1024';
  const mode = imageRunMode(referenceImageData);

  if (mode === 'edit') {
    const parsed = parseImageDataUrl(referenceImageData);
    if (!parsed) throw new Error('[image-generation] Referenzbild ist kein gültiges Bild');
    // Referenzbild als Datei an /v1/images/edits — der offizielle Weg der
    // installierten SDK (openai v6: `images.edit({ image: Uploadable })`).
    const image = await toFile(parsed.bytes, `reference.${extensionForMime(parsed.mime)}`, {
      type: parsed.mime,
    });
    const editResponse = await client.images.edit({
      model: MODEL,
      image,
      prompt,
      size,
      quality: 'medium',
      // Produkttreue: gpt-image-1 soll das Eingabebild so genau wie möglich
      // übernehmen (unterstützt nur gpt-image-1 / -1.5).
      input_fidelity: 'high',
      n: 1,
    });
    const editedB64 = editResponse.data?.[0]?.b64_json;
    if (!editedB64) throw new Error('[image-generation] OpenAI returned no image data');
    return { url: `data:image/png;base64,${editedB64}` };
  }

  const response = await client.images.generate({
    model: MODEL,
    prompt,
    size,
    quality: 'medium',
    n: 1,
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error('[image-generation] OpenAI returned no image data');
  return { url: `data:image/png;base64,${b64}` };
}
