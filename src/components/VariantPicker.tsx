import { useCallback, useMemo, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import type { ContentResult, VariantAsset, VariantsResult } from '~/ai/types';
import { generateVariantsServer } from '~/ai/server';
import { useTranslation } from '~/i18n';
import { refreshUsage, useServerUsage } from '~/lib/usage-client';
import { ScoreCard } from './ScoreCard';
import { rankVariants } from './variantRanking';

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
  // FIX-BLOCK 1 (Owner-Auftrag 2026-10-08): Der A/B-Abruf ist eine
  // kostenpflichtige KI-Funktion und zählt 1 Generierung. Deshalb (a) ehrlicher
  // Hinweis VOR dem Klick, (b) Bestätigung, wenn < 2 Generierungen übrig sind,
  // (c) sichtbarer Verbrauch NACH dem Klick. Die Zahl kommt aus derselben
  // DB-Quelle wie das Limit-Banner (useServerUsage → getSubscriptionStatus).
  const { user } = useUser();
  const { usage, isOwner } = useServerUsage(user?.id);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [consumed, setConsumed] = useState<{ remaining: number; limit: number } | null>(null);
  const [limitHint, setLimitHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!content) return;
    setStatus('loading');
    setLimitHint(null);
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
        // (c) Sichtbarer Verbrauch: 1 Abruf = 1 Generierung. Der Wert ist der
        // Server-Stand vor dem Abruf minus 1 (der Server hat genau diese Einheit
        // gerade verbraucht); der Banner-Refresh holt kurz darauf den DB-Stand.
        if (!isOwner && usage) {
          setConsumed({ remaining: Math.max(usage.remaining - 1, 0), limit: usage.limit });
        } else if (!isOwner) {
          setConsumed({ remaining: -1, limit: -1 });
        }
        refreshUsage();
      } else {
        // Keine Varianten erstellt → der Server hat die Einheit kompensiert
        // (netto 0 Verbrauch, siehe generateVariantsServer).
        setVariants(null);
        setStatus('error');
      }
    } catch (err) {
      console.error('[VariantPicker] failed:', err);
      setVariants(null);
      setStatus('error');
      // 2a: Limit-Fehler ehrlich benennen (der Call wurde vom Guard blockiert,
      // es wurde NICHTS verbraucht).
      const msg = err instanceof Error ? err.message : '';
      if (/limit|aufgebraucht|used up/i.test(msg)) setLimitHint(msg);
    }
  }, [content, productIdea, strategyContext, locale, isOwner, usage]);

  const close = useCallback(() => {
    setStatus('idle');
    setVariants(null);
    setConsumed(null);
    setLimitHint(null);
    setConfirmOpen(false);
  }, []);

  /**
   * FIX-BLOCK 1: Bei < 2 verbleibenden Generierungen zuerst nachfragen (der
   * Abruf kostet 1). Bei 0 übrig läuft der Aufruf trotzdem zum Server — der
   * Guard blockiert ihn dann mit der ehrlichen Limit-Meldung und verbraucht
   * NICHTS (fail-closed, keine lokale Blockade).
   */
  const handleTriggerClick = useCallback(() => {
    if (usage && usage.remaining > 0 && usage.remaining < 2) {
      setConfirmOpen(true);
      return;
    }
    void load();
  }, [usage, load]);

  // 1c: Sortierung nach echter Bewertung + Empfehlung + Abstand zur zweitbesten.
  const ranking = useMemo(() => (variants ? rankVariants(variants) : null), [variants]);

  const adopt = useCallback(
    (variant: VariantAsset) => {
      onAdopt(variant);
      close();
    },
    [onAdopt, close],
  );

  return (
    <div className={className}>
      {/* Trigger + ehrlicher Kosten-Hinweis VOR dem Klick (FIX-BLOCK 1) */}
      {variants == null && status !== 'loading' && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleTriggerClick}
            disabled={!content}
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-300 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 shadow-sm transition-all hover:bg-indigo-50 hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>🅰️🅱️</span>
            {tLookup.variant_btn}
          </button>
          {/* Owner-/Admin-Override: keine Zähler-Anzeige (Vorgabe 8.2). */}
          {!isOwner && (
            <p className="text-[11px] leading-relaxed text-gray-500">
              {usage
                ? (tLookup.variant_cost_hint ?? '')
                    .replace('%d', String(Math.max(usage.remaining - 1, 0)))
                    .replace('%d', String(usage.limit))
                : tLookup.variant_cost_hint_plain}
            </p>
          )}
          {/* Optional (Empfehlung des Checks): Bestätigung bei < 2 verbleibenden
              Generierungen — der Abruf kostet eine davon. */}
          {confirmOpen && usage && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-amber-800">
                {(tLookup.variant_cost_confirm ?? '').replace('%d', String(usage.remaining))}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmOpen(false);
                    void load();
                  }}
                  className="rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-amber-700"
                >
                  {tLookup.variant_cost_confirm_yes}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                >
                  {tLookup.variant_cost_confirm_no}
                </button>
              </div>
            </div>
          )}
        </div>
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
          {/* Server-Meldung bei erreichtem Monatslimit (ehrlich benannt, es
              wurde nichts verbraucht — der Guard hat den Call blockiert). */}
          {limitHint && <p className="mt-1 text-[11px] font-bold text-red-700">{limitHint}</p>}
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
              {ranking && ranking.bestTotal != null && (
                <p className="mt-0.5 text-[11px] font-semibold text-emerald-700">
                  {tLookup.variant_ranked_note}
                </p>
              )}
              {/* (c) Sichtbarer Verbrauch nach dem Abruf (FIX-BLOCK 1). */}
              {consumed && (
                <p className="mt-0.5 text-[11px] font-bold text-indigo-700">
                  {consumed.remaining >= 0
                    ? (tLookup.variant_cost_done ?? '')
                        .replace('%d', String(consumed.remaining))
                        .replace('%d', String(consumed.limit))
                    : tLookup.variant_cost_done_plain}
                </p>
              )}
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
            {ranking && ranking.tie && (
              <p className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2 text-[11px] leading-relaxed text-gray-600">
                {tLookup.variant_tie_note}
              </p>
            )}
            {ranking?.ranked.map(({ index: idx, variant }) => {
              const recommended = ranking.recommendedIndex === idx;
              const angleKey = variant.angle ? `variant_angle_${variant.angle}` : '';
              const angleLabel = (angleKey && tLookup[angleKey]) || '';
              return (
                <div
                  key={idx}
                  className={`rounded-xl border p-4 ${recommended ? 'border-emerald-300 bg-emerald-50/40' : 'border-gray-200'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-bold text-indigo-800">
                          {((tLookup.variant_letter ?? '') as string).replace('%s', VARIANT_LETTERS[idx] ?? String(idx + 1))}
                        </span>
                        {/* 1c: echte Empfehlung nur bei echtem Vorsprung */}
                        {recommended && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
                            ★ {tLookup.variant_recommended}
                          </span>
                        )}
                        {/* 1c: Punkte-Vorsprung zur zweitbesten Variante */}
                        {recommended && ranking.deltaToRunnerUp != null && ranking.deltaToRunnerUp > 0 && (
                          <span className="inline-flex items-center rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 shadow-sm">
                            {((tLookup.variant_score_delta ?? '') as string).replace('%d', String(ranking.deltaToRunnerUp))}
                          </span>
                        )}
                      </span>
                      <h4 className="mt-1.5 text-sm font-bold text-gray-900">{variant.title}</h4>
                      {/* 1a/1c: der Ansatz, der dieser Variante zugewiesen wurde */}
                      {angleLabel && (
                        <p className="mt-1 text-[11px] font-semibold text-indigo-700">{angleLabel}</p>
                      )}
                      {variant.strategyNote && (
                        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{variant.strategyNote}</p>
                      )}
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
