// ── Image-Studio-Deep-Link (Phase 2 TikTok „Vollständiges Konzept") ──────────
// Additiver Mechanismus: Die TikTok-ResultView verlinkt pro Bildidee mit einem
// vorbefüllten studioPrompt ins Image-Studio; image-studio.tsx liest "?prompt="
// und übernimmt den Prompt in sein Eingabefeld. Bestehende Einstiege der Route
// (?idea=, ?fromStrategy=1) bleiben unverändert — fromStrategy hat Vorrang.

/** Baut die Image-Studio-URL mit vorausgefülltem Prompt (Deep-Link). */
export function studioDeepLink(studioPrompt: string): string {
  return `/app/image-studio?prompt=${encodeURIComponent(studioPrompt)}`;
}

/** Auswertung der Image-Studio-Query-Parameter (reine Funktion, testbar).
 *  Wird von image-studio.tsx im Initial-Effekt verwendet. */
export interface StudioSearchPrefill {
  prompt?: string; // Phase 2: TikTok-Bildidee (studioPrompt)
  idea?: string; // bestehend: Ideen-Einstieg
  fromStrategy: boolean; // bestehend: Strategie-Prefill-Flow (Vorrang)
}

export function studioSearchPrefill(search: string): StudioSearchPrefill {
  const params = new URLSearchParams(search);
  return {
    prompt: params.get('prompt') || undefined,
    idea: params.get('idea') || undefined,
    fromStrategy: params.get('fromStrategy') === '1',
  };
}