import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prioritizeServer } from '~/ai/server';
import type { PrioritizeOutcome, PriorityTag } from '~/ai/types';
import { hasProfile } from '~/ai/prioritize';
import { useTranslation } from '~/i18n';
import { contentTypeLabel } from '~/lib/content-types';
import { ScoreBadge } from '~/components/ScoreBadge';
import type { ContentType } from '~/store/projects';

const CHANNEL_ICONS: Record<string, string> = {
  pinterest_pin: '📌',
  seo_blog: '📝',
  etsy_listing: '🛍️',
  social_post: '📱',
  email_newsletter: '📧',
};

const RANK_TONES = [
  'border-emerald-200 bg-emerald-50 text-emerald-700',
  'border-sky-200 bg-sky-50 text-sky-700',
  'border-violet-200 bg-violet-50 text-violet-700',
  'border-gray-200 bg-gray-50 text-gray-600',
  'border-gray-200 bg-gray-50 text-gray-600',
];

const TAG_KEYS: Record<PriorityTag, string> = {
  'fast-feedback': 'prioritize_tag_fast_feedback',
  'low-effort': 'prioritize_tag_low_effort',
  visual: 'prioritize_tag_visual',
  discovery: 'prioritize_tag_discovery',
  'direct-sales': 'prioritize_tag_direct_sales',
  'buyer-intent': 'prioritize_tag_buyer_intent',
  'existing-audience': 'prioritize_tag_existing_audience',
  engagement: 'prioritize_tag_engagement',
  compound: 'prioritize_tag_compound',
  'slow-burn': 'prioritize_tag_slow_burn',
  'strong-score': 'prioritize_tag_strong_score',
  'weak-score': 'prioritize_tag_weak_score',
  'improve-first': 'prioritize_tag_improve_first',
};

export interface PrioritizeCardAsset {
  channel: ContentType;
  assetId?: string;
  qualityScore: number | null;
  title?: string;
}

/**
 * F3 card: "📅 Was zuerst publizieren?" — ranked channels with plain-language
 * rationale + F1 score badges. Renders nothing when fewer than 2 scored
 * publishable channels are present. The ranking is computed server-side
 * (deterministic rules + one LLM phrasing pass); the LLM never decides the
 * order, only the wording.
 */
export function PrioritizeCard({
  assets,
  productIdea,
}: {
  assets: PrioritizeCardAsset[];
  productIdea?: string;
}) {
  const { t, locale } = useTranslation();
  const [outcome, setOutcome] = useState<PrioritizeOutcome | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const requestRef = useRef(0);

  // Only show when ≥2 publishable channels have a quality score.
  const visible = useMemo(
    () => assets.filter((a) => a.qualityScore != null && hasProfile(a.channel)).length >= 2,
    [assets],
  );

  const load = useCallback(async () => {
    const reqId = ++requestRef.current;
    setStatus('loading');
    try {
      const payload = assets.map((a) => ({
        channel: a.channel,
        assetId: a.assetId,
        qualityScore: a.qualityScore,
      }));
      const result = await prioritizeServer({ data: { assets: payload, productIdea, lang: locale } });
      if (requestRef.current !== reqId) return;
      setOutcome(result ?? null);
      setStatus('idle');
    } catch (err) {
      console.error('[PrioritizeCard] failed:', err);
      if (requestRef.current !== reqId) return;
      setOutcome(null);
      setStatus('error');
    }
  }, [assets, productIdea, locale]);

  useEffect(() => {
    if (visible) void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load, visible]);

  if (!visible) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <h2 className="text-lg font-bold text-gray-900">{t.prioritize_title}</h2>
        <p className="mt-0.5 text-xs text-gray-500">{t.prioritize_subtitle}</p>
      </div>

      <div className="px-5 py-4">
        {status === 'loading' && (
          <div className="flex items-center gap-3 text-gray-500">
            <svg className="h-5 w-5 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <div>
              <p className="text-sm font-semibold">{t.prioritize_loading}</p>
              <p className="text-xs">{t.prioritize_loading_desc}</p>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-semibold">{t.prioritize_error}</p>
            <p className="mt-0.5 text-xs">{t.prioritize_error_desc}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 inline-flex items-center rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
            >
              {t.prioritize_retry}
            </button>
          </div>
        )}

        {status === 'idle' && outcome && (
          <div>
            <p className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium leading-relaxed text-blue-900">
              {outcome.summary}
            </p>
            <ol className="space-y-3">
              {outcome.ordered.map((item) => (
                <li
                  key={item.channel}
                  className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm"
                >
                  <span
                    className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border text-sm font-bold ${
                      RANK_TONES[Math.min(item.rank - 1, RANK_TONES.length - 1)]
                    }`}
                  >
                    {item.rank}
                    {t.prioritize_rank_suffix}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">
                        {CHANNEL_ICONS[item.channel] ?? '📄'} {contentTypeLabel(t, item.channel)}
                      </span>
                      {item.qualityScore != null && <ScoreBadge total={item.qualityScore} size="sm" />}
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-gray-700">{item.rationale}</p>
                    {item.reasonTags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.reasonTags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500"
                          >
                            {(t as unknown as Record<string, string>)[TAG_KEYS[tag]]}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
