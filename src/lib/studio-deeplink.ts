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

// ── „Bild jetzt erstellen": Prompt-Bau + Markenkontext (Schritt 3, Punkt 5) ───
//
// Der Owner verlangt, dass beim Klick die fünf Felder automatisch ankommen:
// Prompt, Format, Projekt-/Produktkontext, Produktbild, Markeninfos. Prompt und
// Format wurden bisher übernommen; Bildkonzept, Text-Overlay, Plattform,
// Produktidee und Marke waren reine Anzeige-Chips und beeinflussten die
// Generierung NICHT. Diese beiden reinen Funktionen schließen die Lücke und
// sind ohne DOM/Storage testbar.

export interface StrategyPromptLineLabels {
  product: string;
  concept: string;
  overlay: string;
  platform: string;
  brand: string;
}

function oneLine(text: string | undefined): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** Baut den Studio-Prompt: Strategie-Prompt + Kontextzeilen (leere entfallen). */
export function composeStrategyStudioPrompt(
  payload: Pick<
    StrategyImagePayload,
    'prompt' | 'concept' | 'overlay' | 'platform' | 'productIdea' | 'brandInfo'
  >,
  labels: StrategyPromptLineLabels,
): string {
  const entries: Array<[string, string]> = [
    [labels.product, oneLine(payload.productIdea)],
    [labels.concept, oneLine(payload.concept)],
    [labels.overlay, oneLine(payload.overlay)],
    [labels.platform, oneLine(payload.platform)],
    [labels.brand, oneLine(payload.brandInfo)],
  ];
  const lines = entries.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
  const head = String(payload.prompt ?? '').trim();
  if (lines.length === 0) return head;
  return head ? `${head}\n\n${lines.join('\n')}` : lines.join('\n');
}

/**
 * Kompakte Markeninfo-Zeile für den Bildprompt (Marke · Farben · Tonalität).
 * Ein ausgeschaltetes Markenprofil (Phase 1, C4) liefert bewusst NICHTS.
 */
export function formatStrategyBrandContext(
  profile: { brandName?: string; brandColors?: string; tone?: string; enabled?: boolean } | null,
): string {
  if (!profile || profile.enabled === false) return '';
  return [profile.brandName, profile.brandColors, profile.tone]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' · ');
}