// ── F2-UX (Phase 8.4d) — pure "what can the user do here?" logic ─────────────
// Extracted from ScoreCard.tsx so the button/hint rules can be unit-tested
// without a React renderer.
//
// Background (F2-E2E finding, 2026-09-17): `canImprove` demanded
// `total < 90` AND `issues.length > 0`, while "✨ Auf 80+ verbessern" demanded
// `total < 80`. An asset scoring 88/100 with zero open issues therefore showed
// NEITHER button — the user saw a strong card with no next step at all
// ("dead zone" 80–89 with no open issues).
//
// Chosen fix: keep the engine untouched (there is genuinely nothing to fix, and
// re-running the improver on a clean asset would burn an LLM call for nothing)
// and state the situation honestly in the card instead of showing a button that
// cannot do anything. Nothing about the usage counting changes — Improve still
// costs 0 generations.
export type ScoreLike = {
  total: number;
  issues: unknown[];
};

export type ScoreCardBusyState = {
  /** an asset is attached (the card is the F2 improve entry point) */
  hasContent: boolean;
  /** an improve run is in flight (improve OR improve-to-target) */
  busy: boolean;
  /** a delta / no-issues banner from a finished run is already on screen */
  hasOutcome: boolean;
  /** the last improve attempt failed (error banner on screen) */
  hasError: boolean;
};

export type ScoreCardActions = {
  /** "⚡ Verbessern" — fix the listed issues (unchanged rule) */
  canImprove: boolean;
  /** "✨ Auf 80+ verbessern" — loop until the target (unchanged rule) */
  canImproveToTarget: boolean;
  /** >= target with zero open issues: say "already strong", hide no-action card */
  showStrongNoActionHint: boolean;
  /** >= 90 with open issues: the engine deliberately refuses to rework */
  showTopRangeNoActionHint: boolean;
};

/** A total score at or above this means the asset is already strong. */
export const ALREADY_STRONG_TOTAL = 90;

export type ImproveDeltaTitleKey =
  | 'improve_delta_title'
  | 'improve_delta_title_flat'
  | 'improve_delta_title_down';

/**
 * F2-UX (8.4d): the before/after banner used to be titled "Qualität gesteigert"
 * (quality improved) even at a delta of ±0 (84 → 84). Only claim a gain when the
 * score actually rose; a tie gets a neutral wording and a loss is named as one.
 */
export function improveDeltaTitleKey(delta: number): ImproveDeltaTitleKey {
  if (delta > 0) return 'improve_delta_title';
  if (delta === 0) return 'improve_delta_title_flat';
  return 'improve_delta_title_down';
}

export function resolveScoreCardActions(
  score: ScoreLike | null | undefined,
  state: ScoreCardBusyState,
  target: number,
): ScoreCardActions {
  const none: ScoreCardActions = {
    canImprove: false,
    canImproveToTarget: false,
    showStrongNoActionHint: false,
    showTopRangeNoActionHint: false,
  };
  if (score == null) return none;

  const canImprove =
    state.hasContent &&
    score.issues.length > 0 &&
    score.total < ALREADY_STRONG_TOTAL &&
    !state.busy;

  const canImproveToTarget = state.hasContent && score.total < target && !state.busy;

  // The honest hint only speaks when nothing else does: it is the improve entry
  // point (asset attached), no run in flight, no banner from a finished run, no
  // error — never a second message next to one.
  const quiet = state.hasContent && !state.busy && !state.hasOutcome && !state.hasError;

  const showStrongNoActionHint = quiet && score.issues.length === 0 && score.total >= target;
  const showTopRangeNoActionHint = quiet && score.issues.length > 0 && score.total >= ALREADY_STRONG_TOTAL;

  return { canImprove, canImproveToTarget, showStrongNoActionHint, showTopRangeNoActionHint };
}
