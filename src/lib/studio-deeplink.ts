import type { StrategyImagePayload } from '~/lib/strategy-image';
import { isImageAspectRatio, type ImageAspectRatio } from '~/ai/image-providers/types';

// ── Image-Studio-Deep-Link (Phase 2 TikTok „Vollständiges Konzept") ──────────
// Additiver Mechanismus: Die TikTok-ResultView verlinkt pro Bildidee mit einem
// vorbefüllten studioPrompt ins Image-Studio; image-studio.tsx liest "?prompt="
// und übernimmt den Prompt in sein Eingabefeld. Bestehende Einstiege der Route
// (?idea=, ?fromStrategy=1) bleiben unverändert — fromStrategy hat Vorrang.
//
// Schritt 3 (Owner-Freigabe 2026-10-07): Der Deep-Link kann jetzt zusätzlich ein
// Format mitgeben (`?ratio=9:16`). TikTok-/Reels-Bildideen sind Hochkant — vorher
// landeten sie im Studio-Default 2:3 (Pinterest-Format). Rückwärtskompatibel:
// ohne Angabe bleibt alles wie vorher, und der TikTok-Einstieg erhält 9:16
// zusätzlich aus der Prefill-Auflösung (siehe resolveStudioPrefill).

/** Baut die Image-Studio-URL mit vorausgefülltem Prompt (Deep-Link). */
export function studioDeepLink(studioPrompt: string, ratio?: ImageAspectRatio): string {
  const base = `/app/image-studio?prompt=${encodeURIComponent(studioPrompt)}`;
  return ratio ? `${base}&ratio=${encodeURIComponent(ratio)}` : base;
}

/** Auswertung der Image-Studio-Query-Parameter (reine Funktion, testbar).
 *  Wird von image-studio.tsx im Initial-Effekt verwendet. */
export interface StudioSearchPrefill {
  prompt?: string; // Phase 2: TikTok-Bildidee (studioPrompt)
  idea?: string; // bestehend: Ideen-Einstieg
  fromStrategy: boolean; // bestehend: Strategie-Prefill-Flow (Vorrang)
  ratio?: ImageAspectRatio; // Schritt 3: Format aus dem Deep-Link (optional)
}

export function studioSearchPrefill(search: string): StudioSearchPrefill {
  const params = new URLSearchParams(search);
  const ratio = params.get('ratio');
  return {
    prompt: params.get('prompt') || undefined,
    idea: params.get('idea') || undefined,
    fromStrategy: params.get('fromStrategy') === '1',
    // Fail-closed: nur die Whitelist der Formate kommt durch.
    ...(isImageAspectRatio(ratio) ? { ratio } : {}),
  };
}

/** Search-Objekt für die SPA-Navigation (Router-`Link`, Phase 3.3a):
 *  gleiche URL wie `studioDeepLink`, aber ohne Vollseiten-Sprung. */
export function studioSearch(
  studioPrompt: string,
  ratio?: ImageAspectRatio,
): { prompt: string; ratio?: ImageAspectRatio } {
  return ratio ? { prompt: studioPrompt, ratio } : { prompt: studioPrompt };
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
  /**
   * Schritt 3: Vorzuwählendes Format. Explizit aus `?ratio=` — und beim
   * TikTok-Einstieg ohne Angabe automatisch `9:16` (Hochkant), weil die dortigen
   * Bildideen Hochkant-Video-/Reels-Motive sind. `undefined` = Studio-Default
   * (bzw. das Format des Strategie-Payloads) unverändert lassen.
   */
  ratio?: ImageAspectRatio;
}

export function resolveStudioPrefill(
  search: string,
  strategy: StrategyImagePayload | null,
): StudioPrefillResolution {
  const p = studioSearchPrefill(search);
  if (p.fromStrategy && strategy) {
    return { prompt: strategy.prompt, strategy, fromTikTok: false };
  }
  if (p.prompt) {
    // TikTok-Einstieg: Format mitgeben (explizit gewinnt, sonst 9:16 Hochkant).
    return { prompt: p.prompt, strategy: null, fromTikTok: true, ratio: p.ratio ?? '9:16' };
  }
  if (p.idea) return { prompt: p.idea, strategy: null, fromTikTok: false, ...(p.ratio ? { ratio: p.ratio } : {}) };
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
  /**
   * Schritt 4 (Owner-Freigabe 2026-10-07): Text-im-Bild-Regeln. Optional —
   * fehlen sie, ist die Ausgabe byte-identisch zum alten Verhalten (die
   * bestehenden Aufrufer/Tests bleiben damit unverändert grün).
   */
  rules?: StudioPromptRules;
}

/**
 * Text-im-Bild-Regeln als i18n-Strings (Schritt 4).
 *
 * `overlay` enthält `%s` — dort wird der kurze, in Anführungszeichen gesetzte
 * Overlay-Text eingesetzt (max. {@link MAX_OVERLAY_WORDS} Wörter).
 */
export interface StudioPromptRules {
  /** Overlay-Anweisung mit `%s` = gequoteter Bildtext. */
  overlay: string;
  /** Harte Regel für Fotostile ohne Overlay (Etsy/Produkt/Lifestyle). */
  noText: string;
  /** Typografie-Regel: deutsche Schriftzeichen, eine Schriftfamilie, Safe-Bereich. */
  typography: string;
  /** Negativ-Baustein: keine Wasserzeichen/Logos/erfundenen Texte. */
  negatives: string;
}

/** Harte Obergrenze für den Bildtext — ein Pin-Overlay ist 3–6 Wörter (Schritt 4). */
export const MAX_OVERLAY_WORDS = 6;

function oneLine(text: string | undefined): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Baut die Text-im-Bild-Anweisungen für den Studio-Prompt (Schritt 4).
 *
 * Owner-Vorgabe: Bildtext wird als präzise Instruktion gegeben, nicht als
 * deutsche Prosa — kurzer gequoteter String, explizite Typografie-Regeln
 * (ä ö ü ß, eine Schriftfamilie, Safe-Bereich), und ein Negativ-Baustein gegen
 * Wasserzeichen/Logos/erfundene Beschriftung. Ohne Overlay gilt:
 *   • Fotostile (Etsy-Produkt, Lifestyle) → ausdrücklich „kein Text im Bild",
 *   • Pinterest-Pin/Quote → kein Verbot (ein 3–6-Wörter-Overlay ist zulässig),
 *   • alle anderen Kanäle → nur Typografie-/Negativ-Baustein.
 * Rein: gleiche Eingabe ⇒ gleiche Ausgabe, ohne DOM/Storage.
 */
export function composeTextOverlayInstructions(
  payload: { overlay?: string; platform?: string },
  rules: StudioPromptRules,
): string[] {
  const raw = oneLine(payload.overlay).replace(/^["'„“”]+/, '').replace(/["'„“”]+$/, '').trim();
  const platform = oneLine(payload.platform).toLowerCase();
  const lines: string[] = [];
  if (raw) {
    const quoted = `"${raw.split(/\s+/).filter(Boolean).slice(0, MAX_OVERLAY_WORDS).join(' ')}"`;
    lines.push(rules.overlay.includes('%s') ? rules.overlay.replace('%s', quoted) : `${rules.overlay} ${quoted}`);
  } else if (/etsy|produkt|product|lifestyle|foto|photo/.test(platform)) {
    lines.push(rules.noText);
  }
  lines.push(rules.typography, rules.negatives);
  return lines.map(oneLine).filter(Boolean);
}

/** Baut den Studio-Prompt: Strategie-Prompt + Kontextzeilen + Text-im-Bild-Regeln. */
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
  // Schritt 4: Text-im-Bild-Regeln NUR wenn konfiguriert (sonst bleibt die
  // Ausgabe exakt wie vorher).
  if (labels.rules) {
    lines.push(...composeTextOverlayInstructions(payload, labels.rules));
  }
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