import type { StrategyImagePayload } from '~/lib/strategy-image';

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

/** Search-Objekt für die SPA-Navigation (Router-`Link`, Phase 3.3a):
 *  gleiche URL wie `studioDeepLink`, aber ohne Vollseiten-Sprung. */
export function studioSearch(studioPrompt: string): { prompt: string } {
  return { prompt: studioPrompt };
}

/** Phase 3.3c — Prefill-Auflösung des Studios als reine Funktion (testbar).
 *
 * Vorher kehrte der Studio-Effekt bei `fromStrategy=1` VOR den
 * `?prompt=`/`?idea=`-Zweigen zurück; war der (damals einmalig konsumierte)
 * Strategie-Prefill verbraucht, blieb das Promptfeld leer — z. B. beim
 * Browser-„Zurück“/Reload. Jetzt: Strategie-Prefill hat weiterhin Vorrang,
 * aber bei fehlendem Payload fällt die Auflösung auf `?prompt=` (TikTok-
 * Bildidee) bzw. `?idea=` zurück — nie ein Einmal-Prefill ohne Fallback. */
export interface StudioPrefillResolution {
  /** Vorzubefüllender Prompt ('' = nichts vorbefüllen). */
  prompt: string;
  /** Gesetzter Strategie-Prefill (Stamp-Karte) oder null. */
  strategy: StrategyImagePayload | null;
  /** Einstieg aus dem TikTok-Deep-Link (?prompt=) → Rückweg anbieten. */
  fromTikTok: boolean;
}

export function resolveStudioPrefill(
  search: string,
  strategy: StrategyImagePayload | null,
): StudioPrefillResolution {
  const p = studioSearchPrefill(search);
  if (p.fromStrategy && strategy) {
    return { prompt: strategy.prompt, strategy, fromTikTok: false };
  }
  if (p.prompt) return { prompt: p.prompt, strategy: null, fromTikTok: true };
  if (p.idea) return { prompt: p.idea, strategy: null, fromTikTok: false };
  return { prompt: '', strategy: null, fromTikTok: false };
}