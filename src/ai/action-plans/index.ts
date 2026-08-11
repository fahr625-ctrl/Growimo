// ── F5 Kanal-Aktionspläne: öffentliche API ────────────────────────────────────
// buildActionPlan() is a pure, synchronous, deterministic function — no LLM, no
// server round-trip. Given a generated asset it returns a concrete, checkable
// action plan (steps reference the asset's real title/keywords/CTA). Never
// throws: unsupported channels and malformed input yield null (UI hides the
// section in that case).
import type { ContentType } from '~/ai/types';
import type { ActionPlan } from './rules';
import { ACTION_PLAN_RULE_VERSION, PLAN_BUILDERS, hasActionPlan } from './rules';

export type { ActionPlan } from './rules';
export type { ActionPlanAsset } from './extract';

/**
 * Build the action plan for one generated asset.
 * @returns the plan, or null when the channel is unsupported / data unusable.
 */
export function buildActionPlan(input: {
  channel: ContentType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}): ActionPlan | null {
  try {
    if (!input) return null;
    const builder = PLAN_BUILDERS[input.channel];
    if (!builder) return null;
    const plan = builder(input);
    if (!plan || plan.length < 3) return null;
    const assetRef = (input.title && input.title.trim() !== '(H1)' ? input.title : input.channel)
      .trim()
      .slice(0, 120);
    return {
      channel: input.channel,
      assetRef,
      plan,
      ruleVersion: ACTION_PLAN_RULE_VERSION,
    };
  } catch {
    return null;
  }
}

/** Whether a channel supports action plans (pinterest / etsy / seo). */
export { hasActionPlan };
