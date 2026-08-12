import { useCallback, useEffect, useRef, useState } from 'react';
import type { AutoImproveSectionOutcome, ContentResult, ContentScore, ImproveOutcome, ScoreDimension, ScoreIssue } from '~/ai/types';
import { autoImproveSectionServer, improveByScoreServer } from '~/ai/server';
import { isAutoImproveFieldSupported } from '~/ai/auto-improve/support';
import { useTranslation } from '~/i18n';
import { ScoreBadge, TONE_CLASSES, scoreTone } from './ScoreBadge';

const DIM_KEY: Record<string, string> = {
  title: 'score_dim_title',
  keywords: 'score_dim_keywords',
  cta: 'score_dim_cta',
  length: 'score_dim_length',
  image: 'score_dim_image',
  structure: 'score_dim_structure',
  relevance: 'score_dim_relevance',
};

function dimLabel(t: Record<string, string>, key: string, fallback: string): string {
  const i18nKey = DIM_KEY[key];
  return (i18nKey && t[i18nKey]) || fallback;
}

function ArrowRight() {
  return (
    <svg className="h-4 w-4 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 12h14" />
    </svg>
  );
}

function DeltaArrow({ delta }: { delta: number }) {
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-bold text-emerald-600">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
        +{delta}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-bold text-red-500">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        {delta}
      </span>
    );
  }
  return <span className="text-sm font-bold text-gray-400">±0</span>;
}

function Spinner({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

/**
 * F1+F2 score card: header (badge + "Warum dieser Score?"), expandable
 * sub-score bars, and the issue list with concrete fixes. When a `content` prop
 * is provided, the card becomes the F2 "Verbessern" entry point: one click
 * regenerates ONLY the weak parts (server-side), re-scores, shows the delta
 * (62 → 89) with a before/after comparison, and hands the improved asset to
 * the parent via onImproved so it replaces the displayed result.
 *
 * F2.1: each issue row whose field is supported (pinterest 'title',
 * etsy 'description') additionally gets a "✨ Automatisch verbessern" button
 * that regenerates ONLY that one field/section, re-scores it, and shows an
 * inline before/after with the score delta before the user applies it.
 */
export function ScoreCard({
  score,
  defaultExpanded = false,
  content,
  productIdea,
  strategyContext,
  onImproved,
}: {
  score: ContentScore | null | undefined;
  defaultExpanded?: boolean;
  /** F2: the full asset this score belongs to — enables the Verbessern button. */
  content?: ContentResult | null;
  /** F2: product idea context passed to the improvement call. */
  productIdea?: string;
  /** F2.1: strategy context (Brief/Kernel summary) for section improvements. */
  strategyContext?: string;
  /** F2: called with the outcome after an improvement (parent swaps + persists). */
  onImproved?: (outcome: ImproveOutcome) => void;
}) {
  const { t, locale } = useTranslation();
  const tLookup = t as unknown as Record<string, string>;
  const [expanded, setExpanded] = useState(defaultExpanded);

  // ── F2 improvement state ─────────────────────────────────────────────────
  const [isImproving, setIsImproving] = useState(false);
  const [improveError, setImproveError] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<ImproveOutcome | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const originalRef = useRef<{ title: string; body: string } | null>(null);
  const lastBodyRef = useRef<string | null>(null);

  // ── F2.1 section-improvement state (one row at a time) ───────────────────
  const [sectionState, setSectionState] = useState<{
    idx: number;
    status: 'loading' | 'done' | 'error';
    outcome?: AutoImproveSectionOutcome;
  } | null>(null);

  // Reset improvement state when the underlying asset changes (new generation).
  // The swap to the improved asset (parent calls onImproved) is NOT a reset —
  // the delta banner must survive it.
  useEffect(() => {
    const body = content?.body ?? null;
    const isOurImprovement =
      lastOutcome?.improved === true &&
      lastOutcome.improvedContent != null &&
      lastOutcome.improvedContent.body === body;
    if (lastBodyRef.current !== null && lastBodyRef.current !== body && !isOurImprovement) {
      setLastOutcome(null);
      setShowOriginal(false);
      setImproveError(false);
      setSectionState(null);
      originalRef.current = null;
    }
    lastBodyRef.current = body;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content?.body, lastOutcome]);

  const canImprove =
    content != null &&
    score != null &&
    score.issues.length > 0 &&
    score.total < 90 &&
    !isImproving;

  const handleImprove = useCallback(async () => {
    if (!content || !score || isImproving) return;
    originalRef.current = { title: content.title, body: content.body };
    setShowOriginal(false);
    setLastOutcome(null);
    setImproveError(false);
    setIsImproving(true);
    try {
      const outcome = await improveByScoreServer({
        data: {
          contentType: content.contentType,
          productIdea: productIdea ?? '',
          title: content.title,
          body: content.body,
          metadata: content.metadata ?? {},
          score,
        },
      });
      setLastOutcome(outcome);
      if (outcome.improved && outcome.improvedContent) {
        onImproved?.(outcome);
      }
    } catch (err) {
      console.error('[ScoreCard] improvement failed:', err);
      setImproveError(true);
      setLastOutcome({
        improved: false,
        reason: 'failed',
        oldScore: score,
        newScore: score,
        delta: 0,
        appliedFixes: [],
        unchangedSections: [],
        error: true,
      });
    } finally {
      setIsImproving(false);
    }
  }, [content, score, productIdea, isImproving, onImproved]);

  // ── F2.1: improve exactly ONE field/section (per-issue button) ────────────
  const runSectionImprove = useCallback(
    async (issue: ScoreIssue, idx: number) => {
      if (!content || !score || isImproving || sectionState) return;
      setSectionState({ idx, status: 'loading' });
      try {
        // Note: createServerFn's generic typing is broken in this codebase
        // (pre-existing TS2345 on every .handler) — the result is `unknown`,
        // so we cast to the known contract (same as the F2 flow at runtime).
        const outcome = (await autoImproveSectionServer({
          data: {
            contentType: content.contentType,
            field: issue.fix.field,
            currentTitle: content.title,
            currentBody: content.body,
            metadata: content.metadata ?? {},
            productIdea: productIdea ?? '',
            strategyContext,
            fix: issue.fix,
            score,
            lang: locale === 'en' ? 'en' : 'de',
          },
        })) as AutoImproveSectionOutcome;
        setSectionState({ idx, status: 'done', outcome });
      } catch (err) {
        console.error('[ScoreCard] section improvement failed:', err);
        setSectionState({ idx, status: 'error' });
      }
    },
    [content, score, productIdea, strategyContext, isImproving, sectionState, locale],
  );

  // F2.1: user confirms the before/after → hand the spliced asset to the
  // parent (same onImproved contract as F2 → updateChannel persists the new
  // score at the asset). "Verwerfen" just clears the inline state.
  const applySectionImprove = useCallback(
    (outcome: AutoImproveSectionOutcome) => {
      if (!outcome.improved || !outcome.improvedContent) return;
      const improveOutcome: ImproveOutcome = {
        improved: true,
        improvedContent: outcome.improvedContent,
        oldScore: outcome.oldScore,
        newScore: outcome.newScore,
        delta: (outcome.newScore?.total ?? 0) - (outcome.oldScore?.total ?? 0),
        appliedFixes: [],
        unchangedSections: [],
      };
      onImproved?.(improveOutcome);
      setSectionState(null);
    },
    [onImproved],
  );

  if (score == null) {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
        <p className="text-xs font-medium text-gray-500">{tLookup.score_unavailable}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-400">
          {tLookup.score_unavailable_desc}
        </p>
      </div>
    );
  }

  const sorted = [...score.subScores].sort((a, b) => b.weight - a.weight);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header — always visible */}
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:bg-gray-50"
        >
          <ScoreBadge total={score.total} />
          <span className="min-w-0 flex-1 text-xs font-semibold text-gray-700">
            {tLookup.score_summary_title}
          </span>
          <svg
            className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {canImprove && (
          <button
            type="button"
            onClick={handleImprove}
            disabled={isImproving}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isImproving ? (
              <>
                <Spinner />
                <span className="hidden sm:inline">{tLookup.improve_loading}</span>
                <span className="sm:hidden">{tLookup.improve_btn}</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                {tLookup.improve_btn}
              </>
            )}
          </button>
        )}
      </div>

      {/* Summary line (always visible) */}
      <p className="border-t border-gray-100 px-4 py-2.5 text-xs leading-relaxed text-gray-600">
        {score.summary}
      </p>

      {/* F2: improving state */}
      {isImproving && (
        <div className="flex items-center gap-3 border-t border-blue-100 bg-blue-50/60 px-4 py-3">
          <Spinner className="h-4 w-4 text-blue-600" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-blue-700">{tLookup.improve_loading}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-blue-600/80">
              {tLookup.improve_loading_desc}
            </p>
          </div>
        </div>
      )}

      {/* F2: improvement error — subtle, content untouched */}
      {improveError && !isImproving && (
        <div className="border-t border-amber-200 bg-amber-50/70 px-4 py-3">
          <p className="text-xs font-semibold text-amber-800">{tLookup.improve_error}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-amber-700/90">
            {tLookup.improve_error_desc}
          </p>
          {canImprove && (
            <button
              type="button"
              onClick={handleImprove}
              className="mt-2 text-[11px] font-semibold text-amber-800 underline hover:text-amber-900"
            >
              {tLookup.improve_retry}
            </button>
          )}
        </div>
      )}

      {/* F2: already-strong / no-issues state */}
      {!isImproving && lastOutcome && !lastOutcome.improved && !lastOutcome.error && (
        <div className="border-t border-emerald-100 bg-emerald-50/60 px-4 py-3">
          <p className="text-xs font-semibold text-emerald-700">
            {lastOutcome.reason === 'already_strong'
              ? tLookup.improve_already_strong
              : tLookup.improve_no_issues}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-700/80">
            {lastOutcome.reason === 'already_strong'
              ? tLookup.improve_already_strong_desc
              : tLookup.improve_no_issues_desc}
          </p>
        </div>
      )}

      {/* F2: delta + before/after comparison */}
      {!isImproving && lastOutcome?.improved && lastOutcome.oldScore && lastOutcome.newScore && (
        <div className="border-t border-emerald-100 bg-emerald-50/70 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">
              {tLookup.improve_delta_title}
            </span>
            <span className="ml-auto inline-flex items-center gap-2">
              <ScoreBadge total={lastOutcome.oldScore.total} />
              <ArrowRight />
              <ScoreBadge total={lastOutcome.newScore.total} />
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-gray-800 shadow-sm">
              {lastOutcome.oldScore.total} → {lastOutcome.newScore.total}
              <DeltaArrow delta={lastOutcome.delta} />
            </span>
          </div>

          {/* Changed sub-scores */}
          {lastOutcome.newScore.subScores.some((s) => {
            const old = lastOutcome.oldScore!.subScores.find((o) => o.key === s.key);
            return old && old.score !== s.score;
          }) && (
            <div className="mt-2.5 border-t border-emerald-100 pt-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700/80">
                {tLookup.improve_changed_dims}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {lastOutcome.newScore.subScores.map((s) => {
                  const old = lastOutcome.oldScore!.subScores.find((o) => o.key === s.key);
                  if (!old || old.score === s.score) return null;
                  const up = s.score > old.score;
                  return (
                    <span
                      key={s.key}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        up ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {dimLabel(tLookup, s.key, s.label)} {old.score} → {s.score}
                      {up ? ' ↑' : ' ↓'}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Kept sections */}
          {lastOutcome.unchangedSections.length > 0 && (
            <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/80">
              <span className="font-semibold">{tLookup.improve_kept_sections}:</span>{' '}
              {lastOutcome.unchangedSections.join(', ')}
            </p>
          )}

          <p className="mt-1.5 text-[11px] leading-relaxed text-emerald-800/70">
            {tLookup.improve_applied.replace('%d', String(lastOutcome.appliedFixes.length))} ·{' '}
            {tLookup.improve_regenerate_note}
          </p>

          {/* Original toggle */}
          {originalRef.current && (
            <button
              type="button"
              onClick={() => setShowOriginal((s) => !s)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 underline hover:text-emerald-900"
            >
              {showOriginal ? tLookup.improve_hide_original : tLookup.improve_show_original}
            </button>
          )}
          {showOriginal && originalRef.current && (
            <div className="mt-2 rounded-lg border border-dashed border-emerald-200 bg-white/70 p-3">
              <p className="text-xs font-bold text-gray-700">{originalRef.current.title}</p>
              <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-gray-600">
                {originalRef.current.body}
              </pre>
            </div>
          )}
        </div>
      )}

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3.5">
          {/* Sub-scores */}
          <div className="space-y-2.5">
            {sorted.map((sub) => {
              const tone = scoreTone(sub.score);
              const bar = TONE_CLASSES[tone].bar;
              return (
                <div key={sub.key} className="flex items-center gap-2.5">
                  <span className="w-24 flex-shrink-0 text-[11px] font-medium text-gray-600">
                    {dimLabel(tLookup, sub.key, sub.label)}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${bar} transition-all`}
                      style={{ width: `${sub.score}%` }}
                    />
                  </div>
                  <span className="w-8 flex-shrink-0 text-right text-[11px] font-semibold text-gray-700">
                    {sub.score}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Comments */}
          <div className="mt-3 space-y-1 border-t border-gray-100 pt-2.5">
            {sorted.map((sub) => (
              <p key={`c-${sub.key}`} className="text-[11px] leading-relaxed text-gray-500">
                <span className="font-medium text-gray-600">
                  {dimLabel(tLookup, sub.key, sub.label)}:
                </span>{' '}
                {sub.comment}
              </p>
            ))}
          </div>

          {/* Issues + fixes */}
          <div className="mt-3.5 border-t border-gray-100 pt-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
              {tLookup.score_issues_title}
            </p>
            {score.issues.length === 0 ? (
              <p className="text-xs font-medium text-emerald-700">{tLookup.score_issues_empty}</p>
            ) : (
              <ul className="space-y-2.5">
                {score.issues.map((issue, idx) => {
                  const supported = content != null && isAutoImproveFieldSupported(content.contentType, issue.fix.field);
                  const rowActive = sectionState?.idx === idx;
                  return (
                    <li key={idx} className="rounded-lg bg-gray-50 px-3 py-2.5">
                      <p className="flex items-start gap-1.5 text-xs text-gray-700">
                        <span className="mt-px flex-shrink-0">
                          {issue.severity === 'critical' ? (
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-[9px] font-bold text-red-700">
                              !
                            </span>
                          ) : (
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-[9px] font-bold text-amber-700">
                              i
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">{issue.message}</span>
                      </p>
                      <p className="mt-1.5 pl-[22px] text-[11px] leading-relaxed text-gray-500">
                        <span className="font-semibold text-gray-600">{tLookup.score_fix_label}</span>{' '}
                        {issue.fix.suggestion}
                      </p>

                      {/* F2.1: per-recommendation auto-improve (only supported fields) */}
                      {supported && !rowActive && (
                        <div className="mt-2 pl-[22px]">
                          <button
                            type="button"
                            disabled={isImproving || sectionState != null}
                            onClick={() => void runSectionImprove(issue, idx)}
                            className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-all hover:from-blue-700 hover:to-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span>✨</span>
                            {tLookup.autoimprove_btn}
                          </button>
                        </div>
                      )}

                      {/* F2.1: this row is loading */}
                      {supported && rowActive && sectionState?.status === 'loading' && (
                        <div className="mt-2 flex items-center gap-2 pl-[22px]">
                          <Spinner className="h-3.5 w-3.5 text-blue-600" />
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold text-blue-700">{tLookup.autoimprove_loading}</p>
                            <p className="text-[10px] leading-relaxed text-blue-600/80">
                              {tLookup.autoimprove_loading_desc}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* F2.1: this row failed — original untouched, retry */}
                      {supported && rowActive && sectionState?.status === 'error' && (
                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-2 pl-2">
                          <p className="text-[11px] font-semibold text-amber-800">{tLookup.autoimprove_error}</p>
                          <p className="text-[10px] leading-relaxed text-amber-700/90">
                            {tLookup.autoimprove_error_desc}
                          </p>
                          <button
                            type="button"
                            onClick={() => void runSectionImprove(issue, idx)}
                            className="mt-1 text-[10px] font-semibold text-amber-800 underline hover:text-amber-900"
                          >
                            {tLookup.autoimprove_retry}
                          </button>
                        </div>
                      )}

                      {/* F2.1: done — inline before/after + score delta + apply */}
                      {supported && rowActive && sectionState?.status === 'done' && sectionState.outcome && (
                        <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/50 px-2.5 py-2 pl-2">
                          {sectionState.outcome.improved &&
                          sectionState.outcome.oldScore &&
                          sectionState.outcome.newScore ? (
                            <>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-blue-700">
                                  {tLookup.autoimprove_delta}
                                </span>
                                <span className="ml-auto inline-flex items-center gap-1.5">
                                  <ScoreBadge total={sectionState.outcome.oldScore.total} />
                                  <ArrowRight />
                                  <ScoreBadge total={sectionState.outcome.newScore.total} />
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-gray-800 shadow-sm">
                                  {sectionState.outcome.oldScore.total} → {sectionState.outcome.newScore.total}
                                  <DeltaArrow delta={sectionState.outcome.newScore.total - sectionState.outcome.oldScore.total} />
                                </span>
                              </div>
                              <div className="mt-2 space-y-1.5 border-t border-blue-100 pt-1.5">
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                                    {tLookup.autoimprove_old}
                                  </p>
                                  <p className="line-through whitespace-pre-wrap text-[11px] leading-relaxed text-gray-400">
                                    {sectionState.outcome.oldValue.slice(0, 400)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                                    {tLookup.autoimprove_new}
                                  </p>
                                  <p className="whitespace-pre-wrap text-[11px] font-bold leading-relaxed text-gray-800">
                                    {sectionState.outcome.newValue.slice(0, 400)}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-2 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => applySectionImprove(sectionState.outcome!)}
                                  className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
                                >
                                  {tLookup.autoimprove_apply}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSectionState(null)}
                                  className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-100"
                                >
                                  {tLookup.autoimprove_discard}
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="text-[11px] font-semibold text-emerald-700">{tLookup.autoimprove_unchanged}</p>
                              <p className="mt-0.5 text-[10px] leading-relaxed text-emerald-700/80">
                                {tLookup.autoimprove_unchanged_desc}
                              </p>
                              <button
                                type="button"
                                onClick={() => setSectionState(null)}
                                className="mt-1.5 text-[10px] font-semibold text-emerald-700 underline hover:text-emerald-800"
                              >
                                {tLookup.autoimprove_discard}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Extract a ContentScore from a stored content row's metadata (JSONB). */
export function scoreFromMetadata(
  metadata: Record<string, unknown> | undefined,
): ContentScore | null | undefined {
  if (!metadata) return undefined;
  const s = metadata.score;
  if (s == null) return undefined;
  if (typeof s === 'object' && typeof (s as ContentScore).total === 'number') {
    return s as ContentScore;
  }
  return null;
}

export type { ScoreDimension };
