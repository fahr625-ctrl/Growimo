import { useCallback, useState } from 'react';
import type { ContentResult, VariantAsset, VariantsResult } from '~/ai/types';
import { generateVariantsServer } from '~/ai/server';
import { useTranslation } from '~/i18n';
import { ScoreCard } from './ScoreCard';

const VARIANT_LETTERS = ['A', 'B', 'C', 'D'];

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

/**
 * F7 A/B-Varianten: one click asks the decision engine for 3 scored alternative
 * variants (title + full body) of the current asset. Every variant shows its
 * F1 score (ScoreCard pattern) and a "Diese Variante übernehmen" button — the
 * chosen variant replaces the asset and is persisted by the parent (same path
 * as F2/F2.1 via onImproved/updateChannel), keeping the variant's score on the
 * asset. Includes loading / error / retry states; never blocks the page.
 */
export function VariantPicker({
  content,
  productIdea,
  strategyContext,
  onAdopt,
  className = '',
}: {
  /** The asset to create variants of (null → button disabled). */
  content: ContentResult | null;
  /** Product idea context handed to the variant generation call. */
  productIdea?: string;
  /** F6 Brief/Kernel strategy context for consistent angles. */
  strategyContext?: string;
  /** Called with the chosen variant — the parent swaps + persists (updateChannel). */
  onAdopt: (variant: VariantAsset) => void;
  /** Optional extra classes for the trigger button. */
  className?: string;
}) {
  const { t, locale } = useTranslation();
  const tLookup = t as unknown as Record<string, string>;
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [variants, setVariants] = useState<VariantAsset[] | null>(null);

  const load = useCallback(async () => {
    if (!content) return;
    setStatus('loading');
    try {
      // createServerFn's generic typing is broken in this codebase
      // (pre-existing) — the result is `unknown`, cast to the known contract
      // (same as the F2/F2.1 flows at runtime).
      const outcome = (await generateVariantsServer({
        data: {
          contentType: content.contentType,
          currentTitle: content.title,
          currentBody: content.body,
          metadata: content.metadata ?? {},
          productIdea: productIdea ?? '',
          strategyContext,
          lang: locale === 'en' ? 'en' : 'de',
        },
      })) as VariantsResult | null;
      if (outcome && outcome.variants.length > 0) {
        setVariants(outcome.variants);
        setStatus('idle');
      } else {
        setVariants(null);
        setStatus('error');
      }
    } catch (err) {
      console.error('[VariantPicker] failed:', err);
      setVariants(null);
      setStatus('error');
    }
  }, [content, productIdea, strategyContext, locale]);

  const close = useCallback(() => {
    setStatus('idle');
    setVariants(null);
  }, []);

  const adopt = useCallback(
    (variant: VariantAsset) => {
      onAdopt(variant);
      close();
    },
    [onAdopt, close],
  );

  return (
    <div className={className}>
      {/* Trigger */}
      {variants == null && status !== 'loading' && (
        <button
          type="button"
          onClick={() => void load()}
          disabled={!content}
          className="inline-flex items-center gap-2 rounded-xl border border-indigo-300 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 shadow-sm transition-all hover:bg-indigo-50 hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>🅰️🅱️</span>
          {tLookup.variant_btn}
        </button>
      )}

      {/* Loading */}
      {status === 'loading' && (
        <div className="flex items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
          <Spinner className="h-4 w-4 text-indigo-600" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-indigo-700">{tLookup.variant_loading}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-indigo-600/80">
              {tLookup.variant_loading_desc}
            </p>
          </div>
        </div>
      )}

      {/* Error + retry */}
      {status === 'error' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
          <p className="text-xs font-semibold text-amber-800">{tLookup.variant_error}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-amber-700/90">
            {tLookup.variant_error_desc}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="text-[11px] font-semibold text-amber-800 underline hover:text-amber-900"
            >
              {tLookup.variant_retry}
            </button>
            <button
              type="button"
              onClick={close}
              className="text-[11px] font-semibold text-gray-500 underline hover:text-gray-700"
            >
              {tLookup.variant_close}
            </button>
          </div>
        </div>
      )}

      {/* Variants panel */}
      {variants != null && status !== 'loading' && (
        <div className="overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-indigo-100 bg-gradient-to-r from-indigo-50/80 to-purple-50/60 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900">{tLookup.variant_title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
                {tLookup.variant_subtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="flex-shrink-0 rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-100"
            >
              {tLookup.variant_close}
            </button>
          </div>
          <div className="space-y-4 p-4">
            {variants.map((variant, idx) => (
              <div key={idx} className="rounded-xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-bold text-indigo-800">
                      {((tLookup.variant_letter ?? '') as string).replace('%s', VARIANT_LETTERS[idx] ?? String(idx + 1))}
                    </span>
                    <h4 className="mt-1.5 text-sm font-bold text-gray-900">{variant.title}</h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => adopt(variant)}
                    className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
                  >
                    ✓ {tLookup.variant_adopt}
                  </button>
                </div>

                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50/60 p-3 font-sans text-[11px] leading-relaxed text-gray-700">
                  {variant.body}
                </pre>

                {/* F1 score + sub-scores (ScoreCard pattern, no improve buttons) */}
                <div className="mt-3">
                  <ScoreCard score={variant.score} defaultExpanded />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
