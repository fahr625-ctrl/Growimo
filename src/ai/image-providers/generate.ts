import OpenAI, { toFile } from 'openai';
import {
  extensionForMime,
  imageRunMode,
  parseImageDataUrl,
  // Bild-Lauf-Modus ('edit' | 'generate') — wird in ImageStreamOutcome typisiert.
  type ImageRunMode,
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

// ── Modellabhängige Edit-/Variations-Optionen (Launch-Fix 2026-10-08) ─────────
// `input_fidelity` ist ein gpt-image-1-only Parameter: die OpenAI-API lehnt ihn
// für `gpt-image-2` mit HTTP 400 ab („The model 'gpt-image-2' does not support
// the 'input_fidelity' parameter", 100 % reproduzierbar im Launch-Test Teil 1
// vom 2026-10-08). Betroffen war damit der KOMPLETTE Variations-/Edit-/
// Referenz-Pfad, weil der Parameter dort hart verdrahtet an `images.edit` ging
// — auch der fail-closed-Rückfall scheiterte, weil er denselben Wert sendet.
// Die SDK-Typdefinition (node_modules/openai/resources/images.d.ts) prüft den
// Modellnamen NICHT (der Parameter ist an allen ImageModel-Werten typisiert);
// die Zurückweisung passiert erst serverseitig. Der Kommentar am alten Aufruf
// („gültig für gpt-image-1.5 und spätere Modelle") war insofern falsch.
//
// Deshalb wird die Option modellabhängig zusammengesetzt und per Conditional
// Spread in den Request gehängt: nur wenn das aktive Modell den Parameter
// wirklich unterstützt, geht `input_fidelity` mit — bei gpt-image-2 entfällt er
// ersatzlos (die Bindung ans Referenzbild kommt dort aus dem Bild selbst, nicht
// aus dem Parameter). Der Text→Bild-Pfad (`images.generate`) sendet den
// Parameter ohnehin nie und bleibt unverändert.
export function modelSupportsInputFidelity(model: string = MODEL): boolean {
  // Nur die gpt-image-1-Familie (gpt-image-1, gpt-image-1.5, …) kennt den
  // Parameter. Bewusst positiv geprüft statt „alles außer gpt-image-2", damit
  // ein künftiges Modell nicht stillschweigend wieder einen 400er erzeugt.
  return model === 'gpt-image-1' || model.startsWith('gpt-image-1.');
}

/**
 * `{ input_fidelity: 'high' }` nur für Modelle, die den Parameter unterstützen,
 * sonst `{}` — am Aufruf gespreizt (`...editFidelityOptions()`). `model` ist
 * injizierbar, damit die Suiten beide Zweige ohne echten API-Call beweisen
 * können; ohne Argument gilt das aktive `MODEL`.
 */
export function editFidelityOptions(model: string = MODEL): { input_fidelity?: 'high' } {
  return modelSupportsInputFidelity(model) ? { input_fidelity: 'high' } : {};
}

// gpt-image-1 always returns b64_json, so we hand the client a
// data:image/png;base64 URL directly. No filesystem writes are involved — this
// keeps the function compatible with Vercel serverless (read-only filesystem).
//
// `referenceImageData` (optional, data-URL eines Nutzer-/Produktbilds):
// Sobald sie vorhanden ist, läuft die Generierung über `images.edit` und das
// Produkt bleibt visuell gebunden (bei gpt-image-1 zusätzlich über
// `input_fidelity: 'high'` — modellabhängig, siehe editFidelityOptions; für
// gpt-image-2 entfällt der Parameter, die API lehnt ihn ab). Ohne sie bleibt es
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
      // übernehmen. `input_fidelity` geht NUR bei Modellen in den Request, die
      // den Parameter serverseitig akzeptieren (gpt-image-1-Familie) —
      // gpt-image-2 lehnt ihn mit 400 ab (`modelSupportsInputFidelity`). Daher
      // modellabhängig per Conditional Spread statt fest verdrahtet; Schritt 2
      // hängt `quality` am selben Env-Schalter wie der Generate-Pfad.
      ...editFidelityOptions(),
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

// ── Option 1 (Owner-Freigabe 2026-10-07): Streaming mit echten Zwischenbildern ─
// Befund der Latenz-Analyse (bild-performance-analyse-2026-10-07.md): ~99 % der
// Klick→Bild-Zeit (~74 s) ist OpenAI-Inferenz und NICHT reduzierbar, solange
// gpt-image-2 / `quality=high` / die exakten Größen gelten. Der einzige wirksame
// Hebel ist die WAHRGENOMMENE Wartezeit: `stream: true` + `partial_images`
// liefert echte Modell-Zwischenstände, die sich vor den Augen des Nutzers
// verfeinern.
//
// WICHTIG — hier wird NICHTS an der Qualität gedreht: derselbe Modellname
// (`MODEL`), dieselbe Quality (`resolveImageQuality()`, Default `high`),
// dieselbe exakte Größe (`SIZES`), derselbe Prompt, dasselbe PNG-Ausgabeformat
// (`data:image/png;base64,…` wie bei `generateImage`). Die Zwischenbilder sind
// reine Vorschau-Stände; das ERSTE gelieferte Bild ist nicht das Endergebnis.
//
// Kosten (recherchiert, OpenAI-Doku „Image generation" → Abschnitt
// „Partial images cost"): jedes Zwischenbild kostet zusätzlich 100 image output
// tokens. gpt-image-2 Standard: $15 / 1M image output tokens
// (developers.openai.com/api/docs/pricing) → $0,0015 je Zwischenbild, also
// ~0,3 US-Cent pro Bild bei 2 Zwischenbildern (gegen $0,165 für ein
// gpt-image-2/high-1024x1536-Bild laut Doku-Tabelle, ≈ +1,8 %).

/** Anzahl der Zwischenbilder (SDK erlaubt 0–3). 2 = ein früher Zwischenstand +
 *  ein verfeinerter Zwischenstand, danach das Endbild — sichtbarer Fortschritt,
 *  minimale Zusatzkosten. */
export const IMAGE_PARTIAL_COUNT = 2;

export interface ImageStreamPartial {
  /** 0-basierte Reihenfolge des Zwischenbilds (aus dem Streaming-Event). */
  index: number;
  /** `data:image/png;base64,…` — direkt als `<img src>` anzeigbar. */
  dataUrl: string;
}

export interface ImageStreamOutcome {
  /** Endbild als data-URL — identisches Format wie `generateImage`. */
  url: string;
  mode: ImageRunMode;
  /** Anzahl tatsächlich empfangener Zwischenbilder (0 = Fallback/keine). */
  partials: number;
  /** true = Streaming nicht möglich, klassisch generiert (fail-closed). */
  usedFallback: boolean;
}

/** Minimale, gemeinsame Sicht auf beide Streaming-Event-Familien
 *  (`image_generation.*` aus images.generate, `image_edit.*` aus images.edit). */
interface StreamEventLike {
  type: string;
  b64_json?: string;
  output_format?: string;
  partial_image_index?: number;
}

/**
 * data-URL wie im bisherigen Pfad. Für `png` (unser Default, weil `output_format`
 * nie gesetzt wird) entsteht byte-identisch `data:image/png;base64,…`.
 */
function streamDataUrl(b64: string, format?: string): string {
  const mime = format === 'jpeg' || format === 'webp' ? format : 'png';
  return `data:image/${mime};base64,${b64}`;
}

/**
 * Wie `generateImage`, aber mit `stream: true` + `partial_images`:
 *   • jedes Zwischenbild geht sofort an `onPartial` (Client zeigt es live),
 *   • Rückgabe ist das ENDBILD (unveränderte Qualität/Format/Größe),
 *   • schlägt der Streaming-Aufruf fehl, BEVOR ein Zwischenbild ankam (z. B.
 *     API-Version/Parameter nicht unterstützt), fällt der Pfad fail-closed auf
 *     die bisherige, nicht-streamende Generierung zurück (`usedFallback: true`).
 *     Kam schon ein Zwischenbild an, wird NICHT erneut generiert — ein zweiter
 *     Lauf wäre ein doppelter, bezahlter Modell-Call.
 */
export async function generateImageStreaming(
  prompt: string,
  aspectRatio: string,
  referenceImageData: string | undefined,
  onPartial: (partial: ImageStreamPartial) => void,
): Promise<ImageStreamOutcome> {
  const ratio = aspectRatio as ImageAspectRatio;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('[image-generation] OPENAI_API_KEY is not configured');
  const client = new OpenAI({ apiKey });
  const size = SIZES[ratio] ?? '1024x1024';
  const mode = imageRunMode(referenceImageData);
  const quality = resolveImageQuality();

  let partials = 0;
  try {
    let stream: AsyncIterable<StreamEventLike>;
    if (mode === 'edit') {
      const parsed = parseImageDataUrl(referenceImageData);
      if (!parsed) throw new Error('[image-generation] Referenzbild ist kein gültiges Bild');
      const image = await toFile(parsed.bytes, `reference.${extensionForMime(parsed.mime)}`, {
        type: parsed.mime,
      });
      // Identische Parameter wie im nicht-streamenden Edit-Pfad oben — nur
      // zusätzlich stream/partial_images. `input_fidelity` ebenfalls
      // modellabhängig (gpt-image-2: weglassen, sonst 400).
      stream = (await client.images.edit({
        model: MODEL,
        image,
        prompt,
        size,
        quality,
        ...editFidelityOptions(),
        n: 1,
        stream: true,
        partial_images: IMAGE_PARTIAL_COUNT,
      })) as unknown as AsyncIterable<StreamEventLike>;
    } else {
      stream = (await client.images.generate({
        model: MODEL,
        prompt,
        size,
        quality,
        n: 1,
        stream: true,
        partial_images: IMAGE_PARTIAL_COUNT,
      })) as unknown as AsyncIterable<StreamEventLike>;
    }

    let final: { b64: string; format?: string } | null = null;
    for await (const event of stream) {
      const type = event?.type ?? '';
      if (type.endsWith('partial_image') && typeof event.b64_json === 'string') {
        partials += 1;
        onPartial({
          index: typeof event.partial_image_index === 'number' ? event.partial_image_index : partials - 1,
          dataUrl: streamDataUrl(event.b64_json, event.output_format),
        });
        continue;
      }
      if (type.endsWith('completed') && typeof event.b64_json === 'string') {
        final = { b64: event.b64_json, format: event.output_format };
      }
    }
    if (!final) throw new Error('[image-generation] Streaming lieferte kein Endbild');
    return { url: streamDataUrl(final.b64, final.format), mode, partials, usedFallback: false };
  } catch (err) {
    // Fail-closed-Fallback NUR ohne vorheriges Zwischenbild (siehe Doku oben).
    if (partials > 0) throw err;
    console.warn('[image-generation] Streaming nicht verfügbar — Fallback auf klassische Generierung:', err);
  }

  // Rückwärts-Pfad: exakt der bisherige, nicht-streamende Aufruf.
  const fallback = await generateImage(prompt, aspectRatio, referenceImageData);
  return { url: fallback.url, mode, partials: 0, usedFallback: true };
}
