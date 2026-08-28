import type { GeneratedImage } from '~/ai/image-providers/types';

/**
 * Shared prefill bridge between a generated marketing strategy and the
 * existing Image Studio route (/app/image-studio).
 *
 * The strategy result is a single markdown-ish German body rendered as
 * `<pre>`. The image-relevant numbers live inside it:
 *   «8. Bildkonzept»      – full art-director image concept
 *   «9. KI-Bild-Prompt (ENGLISCH)» – one-line, copy-ready AI image prompt
 * Overlay text sits inside section 8 under "(f) Text-Overlay-Vorschlag".
 *
 * We do NOT build a second image pipeline. We only transfer the extracted
 * values to the existing Image Studio, which is told to prefill its prompt /
 * ratio and to surface the values + brand context as visible chips.
 */

export interface StrategyImagePayload {
  /** one-line KI-Bild-Prompt (prefilled into the prompt field). */
  prompt: string;
  /** full Bildkonzept text (section 8). */
  concept: string;
  /** overlay suggestion from section 8(f). */
  overlay: string;
  /** recommended aspect ratio ('2:3' | '4:3' | '1:1' | '16:9'). */
  ratio: GeneratedImage['aspectRatio'];
  /** the asset's content type, e.g. 'pinterest_pin'. */
  contentType: string;
  /** human-readable platform label (resolved here via key below). */
  platform: string;
}

/** sessionStorage key that carries the payload until the studio reads it. */
export const STRATEGY_PREFILL_KEY = 'growimo_strategy_prefill';

/** Field-proven section parser for numbered strategy headings. */
function splitSections(body: string): Map<string, string> {
  const map = new Map<string, string>();
  let currentKey: string | null = null;
  const headingRe = /^\s*(\d+)\.\s+(.+?)\s*$/;
  for (const line of body.split('\n')) {
    const m = line.match(headingRe);
    if (m) {
      currentKey = m[2].trim().toLowerCase();
      map.set(currentKey, '');
    } else if (currentKey) {
      map.set(currentKey, (map.get(currentKey) || '') + line + '\n');
    }
  }
  return map;
}

function firstLineOf(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0] ?? '';
}

function findSectionValue(
  sections: Map<string, string>,
  candidates: string[],
): string | null {
  for (const key of sections.keys()) {
    if (candidates.some((c) => key.startsWith(c))) {
      const value = sections.get(key)?.trim();
      if (value) return value;
    }
  }
  return null;
}

function extractOverlay(concept: string): string {
  const idx = concept.indexOf('Text-Overlay-Vorschlag');
  if (idx === -1) return '';
  const rest = concept.slice(idx).split('\n')[0].trim();
  const afterColon = rest.split(':').slice(1).join(':').trim();
  return afterColon.replace(/^„|"|'/, '').replace(/[„"']$/, '');
}

function detectRatio(contentType: string, body: string): GeneratedImage['aspectRatio'] {
  const ct = contentType.toLowerCase();
  if (/etsy/.test(ct)) return '4:3';
  if (/instagram|social/.test(ct)) return '1:1';
  if (/blog|seo/.test(ct)) return '16:9';
  // Pinterest strategies always demand vertical 2:3 — fall back to that.
  return '2:3';
}

/** Content-type → human platform label (kept here so the project page stays thin). */
export function platformLabelFor(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (/pinterest/.test(ct)) return 'Pinterest';
  if (/etsy/.test(ct)) return 'Etsy';
  if (/instagram/.test(ct)) return 'Instagram';
  if (/blog|seo/.test(ct)) return 'Blog';
  if (/email|newsletter/.test(ct)) return 'Newsletter';
  if (/social/.test(ct)) return 'Social Media';
  return contentType;
}

/**
 * Extracts an image-ready payload from a strategy body, or null when the
 * result contains no usable KI-Bild-Prompt.
 */
export function extractStrategyImage(
  body: string,
  contentType: string,
): StrategyImagePayload | null {
  if (!body) return null;
  const sections = splitSections(body);
  const prompt =
    findSectionValue(sections, ['ki-bild-prompt', 'bildprompt']) ?? '';
  const promptLine = firstLineOf(prompt);
  if (!promptLine) return null;

  const concept =
    findSectionValue(sections, ['bildkonzept']) ?? '';
  const overlay = concept ? extractOverlay(concept) : '';

  return {
    prompt: promptLine,
    concept: concept || '',
    overlay,
    ratio: detectRatio(contentType, body),
    contentType,
    platform: platformLabelFor(contentType),
  };
}

/** Writes the payload to sessionStorage so the studio can prefill. */
export function saveStrategyPrefill(payload: StrategyImagePayload): void {
  try {
    sessionStorage.setItem(STRATEGY_PREFILL_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage may be unavailable — prefill simply won't happen.
  }
}

/** Reads + clears the pending strategy prefill (one-shot). */
export function consumeStrategyPrefill(): StrategyImagePayload | null {
  try {
    const raw = sessionStorage.getItem(STRATEGY_PREFILL_KEY);
    sessionStorage.removeItem(STRATEGY_PREFILL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StrategyImagePayload>;
    if (!parsed.prompt) return null;
    const ratio: GeneratedImage['aspectRatio'] = ['2:3', '4:3', '1:1', '16:9'].includes(
      parsed.ratio as string,
    )
      ? (parsed.ratio as GeneratedImage['aspectRatio'])
      : '2:3';
    return {
      prompt: parsed.prompt,
      concept: parsed.concept ?? '',
      overlay: parsed.overlay ?? '',
      ratio,
      contentType: parsed.contentType ?? '',
      platform: parsed.platform ?? 'Pinterest',
    };
  } catch {
    return null;
  }
}
