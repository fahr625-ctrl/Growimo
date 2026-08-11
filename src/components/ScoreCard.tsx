import { useState } from 'react';
import type { ContentScore, ScoreDimension } from '~/ai/types';
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

/**
 * Expandable F1 score card: header (badge + "Warum dieser Score?" summary),
 * then sub-score bars with labels, and the issue list with concrete fixes.
 * Renders a subtle "Bewertung nicht verfügbar" state when score is null.
 */
export function ScoreCard({
  score,
  defaultExpanded = false,
}: {
  score: ContentScore | null | undefined;
  defaultExpanded?: boolean;
}) {
  const { t } = useTranslation();
  const tLookup = t as unknown as Record<string, string>;
  const [expanded, setExpanded] = useState(defaultExpanded);

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
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
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

      {/* Summary line (always visible) */}
      <p className="border-t border-gray-100 px-4 py-2.5 text-xs leading-relaxed text-gray-600">
        {score.summary}
      </p>

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
                {score.issues.map((issue, idx) => (
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
                  </li>
                ))}
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
