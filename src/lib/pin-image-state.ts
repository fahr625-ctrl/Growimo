// ─────────────────────────────────────────────────────────────────────────────
// Pin-Baustein: Zustand über das Neuladen hinweg (2026-11-23)
// ─────────────────────────────────────────────────────────────────────────────
// Regel „Bild einmal berechnet, Bearbeiten frei": Ein bezahltes Bild darf nach
// einem Reload nicht verschwinden. Gespeichert wird deshalb NUR die
// Bild-REFERENZ (`generated_images.id`, Abruf über `GET /api/images/<id>`) plus
// Überschrift, Textfarbe und Layout — wenige hundert Bytes.
//
// Bewusst NICHT im localStorage: die Pixel. Das erzeugte Bild kommt als
// Data-URL (~4,6 MB bei 3,44 MB PNG) und sprengt das localStorage-Limit; die
// Pixel liegen bezahlt im Bildspeicher und werden von dort geholt.
// ─────────────────────────────────────────────────────────────────────────────

import type { PinLayoutId } from '~/lib/kampagne/pin-render';

/** Ein Eintrag, ein Pin — der zuletzt bearbeitete Pin dieses Browsers. */
export const PIN_STATE_KEY = 'growimo_pin_image_state_v1';

/** Das fertige Pinterest-Ergebnis, an dem der Pin-Baustein hängt. */
export const PIN_RESULT_KEY = 'growimo_quick_pinterest_pin_result';

export interface StoredPinState {
  /** Fingerabdruck aus Pin-Titel + Pin-Text: ordnet den Zustand genau diesem Pin zu. */
  key: string;
  /** `generated_images.id` — die bezahlte, gespeicherte Bild-Referenz. */
  imageId: string;
  headline: string;
  textColor: string;
  layout: PinLayoutId;
  savedAt: number;
}

/** Stabiler Fingerabdruck (djb2) — kein Zufall, damit er den Reload übersteht. */
export function pinFingerprint(title: string, description: string): string {
  const s = `${title}\u0000${description}`;
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}-${s.length.toString(36)}`;
}

/** Liest den gespeicherten Zustand; unlesbare Einträge werden übersprungen, nie gelöscht. */
export function loadPinState(): StoredPinState | null {
  try {
    const raw = window.localStorage.getItem(PIN_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPinState>;
    if (typeof parsed?.imageId !== 'string' || !parsed.imageId) return null;
    if (typeof parsed.key !== 'string' || typeof parsed.headline !== 'string') return null;
    return {
      key: parsed.key,
      imageId: parsed.imageId,
      headline: parsed.headline,
      textColor: typeof parsed.textColor === 'string' ? parsed.textColor : '#ffffff',
      layout: (parsed.layout ?? 'bottom-left') as PinLayoutId,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Schreibt den Zustand; ein voller/gesperrter Speicher darf die App nie stören. */
export function savePinState(state: StoredPinState): void {
  try {
    window.localStorage.setItem(PIN_STATE_KEY, JSON.stringify(state));
  } catch {
    // Speicher voll oder gesperrt — der Baustein läuft weiter, nur ohne Gedächtnis.
  }
}
