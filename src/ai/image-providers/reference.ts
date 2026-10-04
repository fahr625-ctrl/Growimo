// ── Referenzbild-Kette (Stabilisierung Schritt 3, Punkt 3) ────────────────────
//
// Ursache des Owner-Befunds („eine Variation erzeugt Fremdinhalte, das Produkt
// wird ersetzt"): das Bild-Studio hielt vom hochgeladenen Bild nur
// `{ name, url: URL.createObjectURL(file) }` — eine reine ANZEIGE-URL ohne
// Inhalt und ohne Identität. Die ServerFn validierte nur { prompt, aspectRatio },
// und der Provider rief ausschließlich `images.generate` (Text → Bild). Das
// hochgeladene Produkt floss also NIE in die Generierung ein; die „Variation"
// war eine Neuerfindung aus dem Dateinamen.
//
// Diese Datei enthält die reparierte Kette als REINE, testbare Logik:
//   data-URL (Client) → Sanitisierung (Server-Validator) → Modus edit|generate
//   → harter Prompt-Baustein (Produkttreue).
//
// Der Prompt-Baustein selbst liegt als i18n-Key
// (`image_studio_prompt_reference_lock`, de + en) und wird hier nur angehängt.

/** Welcher OpenAI-Bildpfad ausgeführt wird. `edit` = Referenzbild wird mitgegeben. */
export type ImageRunMode = 'edit' | 'generate';

/** Erlaubte Bild-MIME-Typen für `images.edit` (gpt-image-1: png/webp/jpg). */
const DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/;

/**
 * Lässt NUR eine echte, base64-kodierte Bild-data-URL durch (fail-closed).
 * Wird sowohl im ServerFn-Validator (image-studio.tsx) als auch im Provider
 * verwendet, damit nie ein beliebiger String als „Bild" an OpenAI geht.
 *
 * Bewusst OHNE `\s` im Base64-Zeichensatz: Zeilenumbrüche/Leerzeichen in der
 * Nutzereingabe würden sonst als gültig durchgehen und erst bei OpenAI knallen.
 */
export function sanitizeReferenceImageData(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  return DATA_URL_RE.test(trimmed) ? trimmed : undefined;
}

/**
 * Entscheidung der Pipeline: mit gültiger Referenz → `edit`, ohne → `generate`.
 * Genau diese Entscheidung war vorher nirgends vorhanden (immer generate).
 */
export function imageRunMode(referenceImageData?: unknown): ImageRunMode {
  return sanitizeReferenceImageData(referenceImageData) ? 'edit' : 'generate';
}

export interface ParsedImageDataUrl {
  mime: string;
  base64: string;
  bytes: Uint8Array;
}

/** Zerlegt eine (bereits validierte) Bild-data-URL in MIME, Base64 und Bytes. */
export function parseImageDataUrl(dataUrl: unknown): ParsedImageDataUrl | null {
  const clean = sanitizeReferenceImageData(dataUrl);
  if (!clean) return null;
  const comma = clean.indexOf(',');
  const mime = clean.slice(5, clean.indexOf(';base64'));
  const base64 = clean.slice(comma + 1);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { mime, base64, bytes };
  } catch {
    return null;
  }
}

/** Dateiendung für den Upload an OpenAI (muss zum MIME-Typ passen). */
export function extensionForMime(mime: string): string {
  if (/jpe?g/.test(mime)) return 'jpg';
  if (/webp/.test(mime)) return 'webp';
  return 'png';
}

/**
 * Hängt den harten Produkttreue-Baustein an den Prompt — aber nur, wenn wirklich
 * eine Referenz mitgeht, und niemals doppelt (idempotent, weil der Baustein im
 * gespeicherten Karten-Prompt landet und bei Folge-Variationen erneut angehängt
 * würde).
 */
export function composePromptWithReferenceLock(
  prompt: string,
  lockLine: string,
  hasReference: boolean,
): string {
  const base = String(prompt ?? '').trim();
  if (!hasReference) return base;
  const lock = String(lockLine ?? '').trim();
  if (!lock) return base;
  if (base.includes(lock)) return base;
  return base ? `${base}\n\n${lock}` : lock;
}

/**
 * Oberes Limit für die Referenz-data-URL im Client. Vercel lehnt Request-Bodies
 * über ~4,5 MB ab; ein 1,4-MB-Data-URL (≈ 1 MB Binärbild) bleibt sicher darunter.
 * Größere Uploads werden im Client verkleinert (siehe lib/image-reference.ts).
 */
export const MAX_REFERENCE_DATA_URL_LENGTH = 1_400_000;
