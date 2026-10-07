import OpenAI, { toFile } from 'openai';
import {
  extensionForMime,
  imageRunMode,
  parseImageDataUrl,
} from './reference';
import type { ImageAspectRatio } from './types';

// gpt-image-2 is the working model for this API key (dall-e-3/dall-e-2 no longer
// exist on the endpoint). Two paths:
//   • images.generations — text → image (no reference)
//   • images.edits       — reference image + prompt (Stabilisierung Schritt 3)
// Both always return base64-encoded PNGs (response_format is not supported).
//
// Schritt 3 (Owner-Freigabe 2026-10-07): Wechsel gpt-image-1 → gpt-image-2.
// Die installierte SDK kennt das Modell bereits
// (node_modules/openai/resources/images.d.ts: ImageModel) — kein Fallback-Code.
const MODEL = 'gpt-image-2';

/**
 * Seitenverhältnis → Modell-Auflösung (Schritt 3, Owner-Vorgabe „korrekte
 * Seitenverhältnisse").
 *
 * Warum nicht mehr die drei Standardgrößen: `gpt-image-1` konnte nur
 * 1024x1024 / 1024x1536 / 1536x1024 — also mussten `4:3` UND `16:9` beide auf
 * `1536x1024` (= 3:2) gemappt werden. Das war schlicht falsch (ein 16:9-Bild
 * kam als 3:2 heraus). `gpt-image-2` akzeptiert freie Auflösungen als
 * `WIDTHxHEIGHT`-String, solange beide Kanten durch 16 teilbar sind, das
 * Seitenverhältnis zwischen 1:3 und 3:1 liegt und Pixel-/Kantenlimits passen
 * (SDK-Doku: size ist `(string & {}) | '1024x1024' | …`, gültig für
 * `images.generate` UND `images.edit`).
 *
 * Alle Werte unten sind exakt (kantengenau geprüft, beide Kanten durch 16 teilbar):
 *   '2:3'  → 1024x1536  (2:3,    1.572.864 px, Standardgröße des Modells)
 *   '1:1'  → 1024x1024  (1:1,    1.048.576 px, Standardgröße des Modells)
 *   '4:3'  → 1152x864   (4:3,      995.328 px; 1152/16=72, 864/16=54)
 *   '16:9' → 1280x720   (16:9,     921.600 px; 1280/16=80, 720/16=45)
 *   '9:16' → 720x1280   (9:16,     921.600 px; 720/16=45, 1280/16=80)
 * Unbekannte Ratio fällt weiterhin auf 1024x1024 zurück (fail-safe).
 */
const SIZES: Record<string, string> = {
  '2:3': '1024x1536',
  '1:1': '1024x1024',
  '4:3': '1152x864',
  '16:9': '1280x720',
  '9:16': '720x1280',
};

/** Werte, die die installierte SDK (openai ^6) für `quality` akzeptiert. */
export type ImageQuality = 'low' | 'medium' | 'high';

/**
 * Qualitätsstufe für BEIDE Bild-Pfade (Schritt 2, Owner-Freigabe 2026-10-07).
 *
 * Vorgabe: Default `'high'` — **fail-closed**. Nur die drei von der SDK
 * akzeptierten Werte (`low` | `medium` | `high`, siehe
 * node_modules/openai/resources/images.d.ts) werden durchgelassen; JEDER andere
 * Wert (unset, Tippfehler, oder Qualitätsstufen neuerer Modelle wie `auto` /
 * `xhigh` / `max`) fällt auf `'high'` zurück, damit nie ein ungültiger Wert an
 * `images.generate` / `images.edit` geht. Rückwärts-Pfad: `IMAGE_QUALITY=medium`
 * stellt exakt das alte Verhalten (Kosten) wieder her — ohne Deploy.
 */
export function resolveImageQuality(): ImageQuality {
  const raw = process.env.IMAGE_QUALITY;
  return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : 'high';
}

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
  const ratio = aspectRatio as ImageAspectRatio;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('[image-generation] OPENAI_API_KEY is not configured');
  const client = new OpenAI({ apiKey });
  const size = SIZES[ratio] ?? '1024x1024';
  const mode = imageRunMode(referenceImageData);
  // Derselbe Env-Schalter für beide Pfade (Default 'high', siehe oben).
  const quality = resolveImageQuality();

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
      quality,
      // Produkttreue: das Modell soll das Eingabebild so genau wie möglich
      // übernehmen. `input_fidelity` ist laut SDK für „gpt-image-1 und
      // gpt-image-1.5 und spätere Modelle" gültig — gpt-image-2 also inklusive
      // (images.d.ts). Der Edit-/Varianten-Pfad bleibt damit FUNKTIONAL
      // unverändert; Schritt 3 ändert hier nur die Modell-Konstante, Schritt 2
      // hängt `quality` am selben Env-Schalter wie der Generate-Pfad.
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
    quality,
    n: 1,
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error('[image-generation] OpenAI returned no image data');
  return { url: `data:image/png;base64,${b64}` };
}
