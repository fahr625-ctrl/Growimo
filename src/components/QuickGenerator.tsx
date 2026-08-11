import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useUser } from '@clerk/clerk-react';
import { generateContentServer } from '~/ai/server';
import type { ContentResult, ContentType, ImproveOutcome } from '~/ai/types';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import BrandBadge from '~/components/BrandBadge';
import { ScoreCard } from '~/components/ScoreCard';
import { useTranslation } from '~/i18n';
import { saveProject, updateChannel } from '~/store/projects';
import { getBrandContext } from '~/store/brand';
import { canGenerate, recordGeneration } from '~/store/subscriptions';
import { trackEvent } from '~/store/analytics';
import { TONES, toneLabel } from '~/lib/tones';

const DEFAULT_TONE_KEY = 'growimo_default_tone';

export interface QuickGeneratorProps {
  contentType: ContentType;
  titleKey: 'gen_pinterest_title' | 'gen_etsy_title' | 'gen_blog_title';
  subtitleKey: 'gen_pinterest_subtitle' | 'gen_etsy_subtitle' | 'gen_blog_subtitle';
  ctaKey: 'gen_generate_pinterest' | 'gen_generate_etsy' | 'gen_generate_blog';
  icon: string;
  accent: string;
  /** Loading messages cycled while generating (i18n keys) */
  loadingKeys: string[];
  /** Pre-filled product idea from the ?idea= query parameter */
  initialIdea?: string;
}

// ── Section parsing for structured AI output ─────────────────────────────────
// OpenAI responses are "N. Heading\ncontent" blocks. We split them so each
// output gets its own card + copy button. Falls back to the raw body if the
// body doesn't follow that structure (e.g. malformed AI output).
interface Section {
  heading: string;
  content: string;
}

function parseSections(body: string): Section[] | null {
  const lines = body.split('\n');
  const sections: Section[] = [];
  let current: { heading: string; content: string[] } | null = null;
  const headingRe = /^\s*(\d{1,2})\s*[.)]\s+(.+?)\s*$/;

  for (const line of lines) {
    const m = line.match(headingRe);
    const heading = m?.[2]?.trim() ?? '';
    const looksLikeListItem =
      heading.startsWith('*') ||
      heading.includes('—') ||
      heading.includes('–') ||
      heading.startsWith('-');
    if (m && !looksLikeListItem && heading.length < 90) {
      if (current) {
        sections.push({ heading: current.heading, content: current.content.join('\n').trim() });
      }
      current = { heading, content: [] };
    } else if (current) {
      current.content.push(line);
    }
  }
  if (current) {
    sections.push({ heading: current.heading, content: current.content.join('\n').trim() });
  }

  const valid = sections.filter((s) => s.heading && s.content);
  return valid.length >= 2 ? valid : null;
}

// ── Shared page shell ────────────────────────────────────────────────────────

export function QuickGeneratorPage({ props }: { props: QuickGeneratorProps }) {
  return (
    <ProtectedRoute>
      <QuickGeneratorContent {...props} />
    </ProtectedRoute>
  );
}

function QuickGeneratorContent({
  contentType,
  titleKey,
  subtitleKey,
  ctaKey,
  icon,
  accent,
  loadingKeys,
  initialIdea,
}: QuickGeneratorProps) {
  const { user } = useUser();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const draftKey = `growimo_quick_${contentType}_draft`;

  // ── State ──────────────────────────────────────────────────────────────────
  const [productIdea, setProductIdea] = useState('');
  const [tone, setTone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [result, setResult] = useState<ContentResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const [showUpsell, setShowUpsell] = useState(false);
  const loadingIndexRef = useRef(0);

  // ── Restore draft + prefs + ?idea= on mount ────────────────────────────────
  useEffect(() => {
    let restoredIdea: string | null = null;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (typeof draft.productIdea === 'string') restoredIdea = draft.productIdea;
        if (typeof draft.tone === 'string') setTone(draft.tone);
      }
      const defaultTone = localStorage.getItem(DEFAULT_TONE_KEY);
      if (defaultTone && TONES.includes(defaultTone as (typeof TONES)[number])) {
        setTone((prev) => prev || defaultTone);
      }
    } catch {
      // ignore storage errors
    }
    // ?idea= pre-fill wins only when there is no saved draft
    if (!restoredIdea && initialIdea && initialIdea.trim()) {
      setProductIdea(initialIdea);
    } else if (restoredIdea) {
      setProductIdea(restoredIdea);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Save draft as the user types ───────────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ productIdea, tone }));
    } catch {
      // ignore storage errors
    }
  }, [productIdea, tone, draftKey]);

  // ── Cycle loading messages ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading) return;
    const lookup = t as unknown as Record<string, string>;
    loadingIndexRef.current = 0;
    setLoadingMessage(lookup[loadingKeys[0]] ?? t.loading_analyze);
    const interval = setInterval(() => {
      loadingIndexRef.current = (loadingIndexRef.current + 1) % loadingKeys.length;
      setLoadingMessage(lookup[loadingKeys[loadingIndexRef.current]] ?? t.loading_finalize);
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // ── Generate ───────────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!productIdea.trim()) return;
    const uid = user?.id ?? 'anonymous';
    setErrorMessage(null);

    if (!canGenerate(uid)) {
      setShowUpsell(true);
      return;
    }

    setIsLoading(true);
    setResult(null);
    setSavedProjectId(null);

    try {
      const brandCtx = getBrandContext();
      const enhancedIdea = brandCtx ? `${brandCtx}\n\nProdukt: ${productIdea}` : productIdea;

      const generated = (await generateContentServer({
        data: {
          contentType,
          productIdea: enhancedIdea,
          tone: tone || undefined,
        },
      })) as ContentResult;

      setResult(generated);
      recordGeneration(uid);

      try {
        trackEvent('strategy_created', { channels: contentType });
      } catch {
        // ignore analytics errors
      }
    } catch (error) {
      console.error('Generation failed:', error);
      const message = error instanceof Error ? error.message : t.common_unknown_error;
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [productIdea, tone, contentType, user?.id]);

  // ── Save to project ────────────────────────────────────────────────────────
  const handleSaveProject = useCallback(async () => {
    if (!result) return;
    const uid = user?.id ?? 'anonymous';
    const projectTitle =
      productIdea.length > 50 ? productIdea.slice(0, 50) + '...' : productIdea;

    try {
      const saved = await saveProject(
      uid,
      {
        userId: uid,
        title: projectTitle,
        productIdea,
        contentTypes: [contentType],
        status: 'completed',
      },
      [
        {
          contentType,
          title: result.title,
          body: result.body,
          metadata: {
            ...(result.metadata ?? {}),
            // F1: persist the score with the asset so it survives reloads
            score: result.score ?? undefined,
          },
        },
      ],
    );
      setSavedProjectId(saved.id);
    } catch (err) {
      console.error('saveProject failed:', err);
    }
  }, [result, productIdea, contentType, user?.id]);

  // ── Copy helper ────────────────────────────────────────────────────────────
  const copyText = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
      } catch {
        return false;
      }
    }
  }, []);

  // ── F2 Verbesserungsschleife: swap result + persist to the saved project ──
  const handleImproved = useCallback(
    async (outcome: ImproveOutcome) => {
      if (!outcome.improved || !outcome.improvedContent) return;
      const improved = outcome.improvedContent;
      setResult(improved);
      // Overwrite the saved asset (simpler correct option) and keep
      // metadata.score updated so the library/detail show the new score.
      if (savedProjectId) {
        try {
          await updateChannel(savedProjectId, contentType, {
            title: improved.title,
            body: improved.body,
            metadata: {
              ...(improved.metadata ?? {}),
              score: improved.score ?? undefined,
            },
          });
        } catch (err) {
          console.error('Persisting improved content failed:', err);
        }
      }
    },
    [savedProjectId, contentType],
  );

  const sections = useMemo(
    () => (result ? parseSections(result.body) : null),
    [result],
  );
  const canGenerateNow = productIdea.trim().length > 0;

  return (
    <div className="mx-auto max-w-3xl animate-fadeIn">
      {/* Header */}
      <div className="mb-8 text-center">
        <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${accent} text-2xl shadow-sm`}>
          {icon}
        </span>
        <h1 className="mt-4 text-3xl font-extrabold text-gray-900 sm:text-4xl">
          {t[titleKey]}
        </h1>
        <p className="mt-2 text-sm text-gray-500 sm:text-base">
          {t[subtitleKey]}
        </p>
      </div>

      {/* Input card */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <label htmlFor="quick-idea" className="mb-2 block text-sm font-semibold text-gray-700">
          {t.gen_idea_label}
        </label>
        <BrandBadge />
        <textarea
          id="quick-idea"
          value={productIdea}
          onChange={(e) => setProductIdea(e.target.value)}
          placeholder={t.gen_idea_placeholder}
          rows={4}
          className="mt-2 w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />

        {/* Tone selector (optional) */}
        <div className="mt-5">
          <span className="mb-2 block text-sm font-semibold text-gray-700">
            {t.strategy_tone_label}
          </span>
          <div className="flex flex-wrap gap-2">
            {TONES.map((tn) => (
              <button
                key={tn}
                type="button"
                onClick={() => setTone(tone === tn ? '' : tn)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  tone === tn
                    ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {toneLabel(t, tn)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerateNow}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-xl hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            ✨ {t[ctaKey]}
          </button>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 bg-white py-16 shadow-sm">
          <div className="relative mb-6">
            <div className="h-16 w-16 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl">✨</span>
            </div>
          </div>
          <p className="animate-pulse text-sm font-medium text-gray-600">
            {loadingMessage}
          </p>
        </div>
      )}

      {/* Error */}
      {!isLoading && errorMessage && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800">
          <p className="font-semibold">{t.results_generation_failed}</p>
          <p className="mt-1">{errorMessage}</p>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="mt-3 text-sm font-medium text-red-700 underline hover:text-red-900"
          >
            {t.common_retry}
          </button>
        </div>
      )}


      {/* Results */}
      {!isLoading && result && (
        <div className="space-y-4">
          {/* Result header */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                  {t.results_generated_badge}
                </span>
                <h2 className="mt-1 text-lg font-bold text-gray-900">{result.title}</h2>
              </div>
              <CopyButton text={result.body} label={t.common_copy_all} copiedLabel={t.common_all_copied} />
            </div>

            {/* Actions */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSaveProject}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-lg hover:-translate-y-0.5"
              >
                💾 {t.gen_save_project}
              </button>
              {savedProjectId && (
                <button
                  type="button"
                  onClick={() =>
                    navigate({
                      to: '/app/projects/$projectId',
                      params: { projectId: savedProjectId },
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-xl border border-blue-300 bg-white px-5 py-2.5 text-sm font-semibold text-blue-700 shadow-sm transition-all hover:bg-blue-50"
                >
                  ✓ {t.results_view_project}
                </button>
              )}
              <Link
                to="/app/new-project"
                search={{ idea: productIdea }}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50"
              >
                🚀 {t.gen_open_strategy}
              </Link>
            </div>
          </div>

          {/* F1 Qualitäts-Score + F2 Verbesserungsschleife — decision layer */}
          <ScoreCard
            score={result.score}
            defaultExpanded
            content={result}
            productIdea={productIdea}
            onImproved={handleImproved}
          />

          {/* Sections */}
          {sections ? (
            <div className="space-y-3">
              {sections.map((section, idx) => (
                <SectionCard
                  key={`${section.heading}-${idx}`}
                  index={idx}
                  heading={section.heading}
                  content={section.content}
                  copy={copyText}
                  copyLabel={t.common_copy}
                  copiedLabel={t.common_copied}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-700">
                {result.body}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Upsell modal for usage limits */}
      {showUpsell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md animate-fadeIn rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-2xl">
              ⚡
            </div>
            <h3 className="mt-4 text-center text-lg font-bold text-gray-900">
              {t.usage_limit_title}
            </h3>
            <p className="mt-2 text-center text-sm text-gray-500">
              {t.usage_limit_desc.replace('%d', '5')}
            </p>
            <div className="mt-6 space-y-3">
              <Link
                to="/app/pricing"
                onClick={() => setShowUpsell(false)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700"
              >
                {t.usage_limit_cta}
              </Link>
              <button
                type="button"
                onClick={() => setShowUpsell(false)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition-all hover:bg-gray-50"
              >
                {t.usage_limit_later}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section card with copy button ────────────────────────────────────────────

function SectionCard({
  index,
  heading,
  content,
  copy,
  copyLabel,
  copiedLabel,
}: {
  index: number;
  heading: string;
  content: string;
  copy: (text: string) => Promise<boolean>;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    const ok = await copy(content);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [copy, content]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-gray-900">
          <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-[10px] font-bold text-white">
            {index + 1}
          </span>
          {heading}
        </h3>
        <button
          type="button"
          onClick={handleCopy}
          className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
            copied
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {copied ? (
            <>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {copiedLabel}
            </>
          ) : (
            <>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {copyLabel}
            </>
          )}
        </button>
      </div>
      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-700">
        {content}
      </pre>
    </div>
  );
}

// ── Generic copy button ───────────────────────────────────────────────────────

function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const handleClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-semibold transition-all ${
        copied
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
      }`}
    >
      {copied ? (
        <>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {copiedLabel}
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}
