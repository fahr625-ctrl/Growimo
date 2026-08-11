// ── F3 Veröffentlichungs-Priorisierung: "Was publiziere ich zuerst?" ──────────
// prioritizeChannels() is the public entry point. It is called server-side from
// the project detail page when ≥2 scored channels exist.
//
// Pipeline (decision-first, LLM-last):
//   1. Deterministic rules rank the channels (channel character + F1 scores).
//   2. ONE compact GPT-4o call rephrases the WHY (summary + per-channel
//      rationale) in the requested language. The order is fixed before the
//      call and the model is forbidden to change it.
//   3. Any failure degrades to the template texts — never blocks, like F1.
//
// Cost discipline: exactly one LLM call per prioritization.

import type { ContentType, PrioritizeAsset, PrioritizeOutcome, PriorityItem } from '../types';
import { phrasePriorities } from './llm';
import {
  CHANNEL_PROFILES,
  PRIORITIZE_RULE_VERSION,
  channelLabel,
  hasProfile,
  priorityScoreFor,
  rankAssets,
  templateSummary,
  type Lang,
} from './rules';

export { CHANNEL_PROFILES, PRIORITIZE_RULE_VERSION, hasProfile, priorityScoreFor };

/**
 * Prioritize a product's generated assets for publication.
 * Returns null when fewer than 2 publishable channels with a quality score are
 * provided — the UI must only show the card in that case.
 * Never throws: any LLM failure falls back to deterministic templates.
 */
export async function prioritizeChannels(
  assets: PrioritizeAsset[],
  opts: { productIdea?: string; lang?: Lang } = {},
): Promise<PrioritizeOutcome | null> {
  const lang: Lang = opts.lang === 'en' ? 'en' : 'de';

  // 1. Deterministic ranking (decision).
  const ordered = rankAssets(assets, lang);
  if (!ordered) return null;

  // 2. LLM phrasing (wording only — order stays).
  let summary = templateSummary(ordered, lang);
  let llmUsed = false;
  let llmTexts: { summary: string; rationales: Record<string, string> } | null = null;
  try {
    llmTexts = await phrasePriorities(ordered, opts.productIdea ?? '', lang);
  } catch (err) {
    console.error('[prioritize] LLM pass failed (templates kept):', err);
  }

  if (llmTexts) {
    llmUsed = true;
    if (llmTexts.summary) summary = llmTexts.summary;
    ordered.forEach((item) => {
      const r = llmTexts?.rationales[item.channel];
      if (r) item.rationale = r;
    });
  }

  return { ordered, summary, ruleVersion: PRIORITIZE_RULE_VERSION, llmUsed };
}

/** Pure synchronous variant (no LLM) — used by tests and fallback paths. */
export function prioritizeChannelsSync(
  assets: PrioritizeAsset[],
  lang: Lang = 'de',
): PrioritizeOutcome | null {
  const ordered = rankAssets(assets, lang);
  if (!ordered) return null;
  return {
    ordered,
    summary: templateSummary(ordered, lang),
    ruleVersion: PRIORITIZE_RULE_VERSION,
    llmUsed: false,
  };
}

export { channelLabel };

/** Helper: build PrioritizeAsset[] from stored contents. */
export function assetsFromContents(
  contents: Array<{ id: string; contentType: ContentType; title?: string; scoreTotal?: number | null }>,
): PrioritizeAsset[] {
  return contents.map((c) => ({
    channel: c.contentType,
    assetId: c.id,
    qualityScore: typeof c.scoreTotal === 'number' ? c.scoreTotal : null,
    title: c.title,
  }));
}

/** Whether the card should be shown: ≥2 publishable channels with a score. */
export function shouldShowPrioritize(assets: PrioritizeAsset[]): boolean {
  const scored = assets.filter(
    (a) => a.qualityScore != null && hasProfile(a.channel),
  );
  return scored.length >= 2;
}

/** Map a channel to its priority item fields (used by the UI for empty states). */
export function profileOf(channel: ContentType) {
  return CHANNEL_PROFILES[channel];
}

// re-export type for consumers
export type { PriorityItem };
