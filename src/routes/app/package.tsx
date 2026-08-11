import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { generatePackageServer } from '~/ai/server';
import type { ContentResult, ContentType, ImproveOutcome } from '~/ai/types';
import type { MarketingPackage } from '~/ai/package/package';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { ScoreBadge } from '~/components/ScoreBadge';
import { ScoreCard } from '~/components/ScoreCard';
import { PrioritizeCard } from '~/components/PrioritizeCard';
import { useTranslation } from '~/i18n';
import { contentTypeLabel } from '~/lib/content-types';
import { saveProject, updateChannel } from '~/store/projects';
import { canGenerate, recordGeneration } from '~/store/subscriptions';
import { trackEvent } from '~/store/analytics';

export const Route = createFileRoute('/app/package')({ component: PackagePage });

const CHANNEL_META: Array<{
  key: keyof MarketingPackage['channels'];
  contentType: ContentType;
  icon: string;
  color: string;
}> = [
  { key: 'pinterest', contentType: 'pinterest_pin', icon: '📌', color: 'bg-red-100 text-red-700' },
  { key: 'etsy', contentType: 'etsy_listing', icon: '🛍️', color: 'bg-orange-100 text-orange-700' },
  { key: 'seo', contentType: 'seo_blog', icon: '📝', color: 'bg-blue-100 text-blue-700' },
  { key: 'social', contentType: 'social_post', icon: '📱', color: 'bg-pink-100 text-pink-700' },
  { key: 'newsletter', contentType: 'email_newsletter', icon: '📧', color: 'bg-yellow-100 text-yellow-700' },
];

// ── Section parsing for structured AI output (same as QuickGenerator) ─────────

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

// ── Page ───────────────────────────────────────────────────────────────────────

function PackagePage() {
  return (
    <ProtectedRoute>
      <PackageContent />
    </ProtectedRoute>
  );
}

function PackageContent() {
  const { user } = useUser();
  const { t, locale } = useTranslation();
  const navigate = useNavigate();

  const [productIdea, setProductIdea] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [pkg, setPkg] = useState<MarketingPackage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const [showUpsell, setShowUpsell] = useState(false);
  const loadingIndexRef = useRef(0);

  // Restore draft
  useEffect(() => {
    try {
      const raw = localStorage.getItem('growimo_package_draft');
      if (raw) {
        const draft = JSON.parse(raw);
        if (typeof draft.productIdea === 'string') setProductIdea(draft.productIdea);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('growimo_package_draft', JSON.stringify({ productIdea }));
    } catch {
      // ignore storage errors
    }
  }, [productIdea]);

  // Cycle loading messages
  const loadingKeys = [
    'package_loading_1',
    'package_loading_2',
    'package_loading_3',
    'package_loading_4',
    'package_loading_5',
    'package_loading_6',
  ];
  useEffect(() => {
    if (!isLoading) return;
    const lookup = t as unknown as Record<string, string>;
    loadingIndexRef.current = 0;
    setLoadingMessage(lookup[loadingKeys[0]] ?? t.loading_analyze);
    const interval = setInterval(() => {
      loadingIndexRef.current = (loadingIndexRef.current + 1) % loadingKeys.length;
      setLoadingMessage(lookup[loadingKeys[loadingIndexRef.current]] ?? t.loading_finalize);
    }, 2500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // ── Generate the package ────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!productIdea.trim()) return;
    const uid = user?.id ?? 'anonymous';
    setErrorMessage(null);

    if (!canGenerate(uid)) {
      setShowUpsell(true);
      return;
    }

    setIsLoading(true);
    setPkg(null);
    setSavedProjectId(null);

    try {
      const result = (await generatePackageServer({
        data: { productIdea, lang: locale },
      })) as MarketingPackage;
      setPkg(result);
      recordGeneration(uid);
      try {
        trackEvent('package_created', { channels: Object.values(result.channels).filter(Boolean).length });
      } catch {
        // ignore analytics errors
      }
    } catch (error) {
      console.error('Package generation failed:', error);
      const message = error instanceof Error ? error.message : t.common_unknown_error;
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [productIdea, user?.id, locale]);

  // ── Save package as a project (all channels persisted like QuickGenerator) ──
  const handleSaveProject = useCallback(async () => {
    if (!pkg) return;
    const uid = user?.id ?? 'anonymous';
    const title = productIdea.length > 50 ? productIdea.slice(0, 50) + '...' : productIdea;

    const contents = CHANNEL_META.map(({ key, contentType }) => {
      const c = pkg.channels[key];
      if (!c) return null;
      return {
        contentType,
        title: c.title,
        body: c.body,
        metadata: {
          ...(c.metadata ?? {}),
          score: c.score ?? undefined,
        },
      };
    }).filter((c): c is NonNullable<typeof c> => c !== null);

    if (contents.length === 0) return;

    try {
      const saved = await saveProject(
        uid,
        {
          userId: uid,
          title,
          productIdea,
          contentTypes: contents.map((c) => c.contentType),
          status: 'completed',
        },
        contents,
      );
      setSavedProjectId(saved.id);
    } catch (err) {
      console.error('saveProject failed:', err);
    }
  }, [pkg, productIdea, user?.id]);

  // ── F2: apply improved asset to state + persisted project ───────────────
  const handleImproved = useCallback(
    async (channelKey: keyof MarketingPackage['channels'], outcome: ImproveOutcome) => {
      if (!outcome.improved || !outcome.improvedContent) return;
      const improved = outcome.improvedContent;
      setPkg((prev) => {
        if (!prev) return prev;
        return { ...prev, channels: { ...prev.channels, [channelKey]: improved } };
      });
      if (savedProjectId) {
        const meta = CHANNEL_META.find((m) => m.key === channelKey);
        if (!meta) return;
        try {
          await updateChannel(savedProjectId, meta.contentType, {
            title: improved.title,
            body: improved.body,
            metadata: { ...(improved.metadata ?? {}), score: improved.score ?? undefined },
          });
        } catch (err) {
          console.error('Persisting improved content failed:', err);
        }
      }
    },
    [savedProjectId],
  );

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

  const prioritizeAssets = useMemo(() => {
    if (!pkg) return [];
    return CHANNEL_META.filter(({ key }) => pkg.channels[key])
      .map(({ key, contentType }) => {
        const c = pkg.channels[key] as ContentResult;
        return {
          channel: contentType,
          qualityScore: c.score?.total ?? null,
          title: c.title,
        };
      });
  }, [pkg]);

  const canGenerateNow = productIdea.trim().length > 0;

  return (
    <div className="mx-auto max-w-4xl animate-fadeIn">
      {/* Header */}
      <div className="mb-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-purple-700 text-2xl shadow-sm">
          ✨
        </span>
        <h1 className="mt-4 text-3xl font-extrabold text-gray-900 sm:text-4xl">
          {t.package_title}
        </h1>
        <p className="mt-2 text-sm text-gray-500 sm:text-base">{t.package_subtitle}</p>
      </div>

      {/* Input card */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <label htmlFor="package-idea" className="mb-2 block text-sm font-semibold text-gray-700">
          {t.package_idea_label}
        </label>
        <textarea
          id="package-idea"
          value={productIdea}
          onChange={(e) => setProductIdea(e.target.value)}
          placeholder={t.package_idea_placeholder}
          rows={4}
          className="mt-2 w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-fuchsia-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20"
        />
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerateNow}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-700 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-fuchsia-200 transition-all hover:from-fuchsia-700 hover:to-purple-800 hover:shadow-xl hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {t.package_generate}
          </button>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 bg-white py-16 shadow-sm">
          <div className="relative mb-6">
            <div className="h-16 w-16 animate-spin rounded-full border-4 border-fuchsia-200 border-t-fuchsia-600" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl">✨</span>
            </div>
          </div>
          <p className="animate-pulse text-sm font-medium text-gray-600">{loadingMessage}</p>
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

      {/* Result */}
      {!isLoading && pkg && (
        <div className="space-y-5">
          {/* Result header + save */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-fuchsia-600">
                  {t.package_result_badge}
                </span>
                <h2 className="mt-1 text-lg font-bold text-gray-900">{productIdea}</h2>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSaveProject}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-700 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-fuchsia-200 transition-all hover:from-fuchsia-700 hover:to-purple-800 hover:shadow-lg hover:-translate-y-0.5"
              >
                {t.package_save_project}
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
                  className="inline-flex items-center gap-2 rounded-xl border border-fuchsia-300 bg-white px-5 py-2.5 text-sm font-semibold text-fuchsia-700 shadow-sm transition-all hover:bg-fuchsia-50"
                >
                  {t.package_saved_link}
                </button>
              )}
              <Link
                to="/app/package"
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50"
              >
                {t.package_open_idea}
              </Link>
            </div>
          </div>

          {/* Strategie-Kern-Karte */}
          <div className="overflow-hidden rounded-2xl border border-fuchsia-100 bg-gradient-to-br from-white via-fuchsia-50/40 to-purple-50/50 shadow-sm">
            <div className="border-b border-fuchsia-100 px-6 py-4">
              <span className="text-xs font-semibold uppercase tracking-wide text-fuchsia-600">
                {t.package_kernel_badge}
              </span>
              <h3 className="mt-0.5 text-lg font-bold text-gray-900">{t.package_kernel_title}</h3>
              <p className="mt-0.5 text-xs text-gray-500">{t.package_kernel_subtitle}</p>
            </div>
            <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {t.package_kernel_keywords}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {pkg.kernel.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center rounded-full border border-fuchsia-200 bg-fuchsia-50 px-3 py-1 text-sm font-medium text-fuchsia-800"
                    >
                      🔑 {kw}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {t.package_kernel_hook}
                </p>
                <p className="mt-1.5 text-sm font-medium leading-relaxed text-gray-800">
                  {pkg.kernel.mainHook}
                </p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {t.package_kernel_cta}
                </p>
                <p className="mt-1.5 text-sm font-medium leading-relaxed text-gray-800">
                  {pkg.kernel.cta}
                </p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {t.package_kernel_voice}
                </p>
                <p className="mt-1.5 text-sm font-medium leading-relaxed text-gray-800">
                  {pkg.kernel.voice}
                </p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {t.package_kernel_audience}
                </p>
                <p className="mt-1.5 text-sm font-medium leading-relaxed text-gray-800">
                  {pkg.kernel.audienceNote}
                </p>
              </div>
              {pkg.kernelFallback && (
                <p className="sm:col-span-2 text-xs text-amber-600">{t.package_kernel_fallback_note}</p>
              )}
            </div>
          </div>

          {/* F3 Priorisierung */}
          {prioritizeAssets.length >= 2 && (
            <PrioritizeCard assets={prioritizeAssets} productIdea={productIdea} />
          )}

          {/* Channels */}
          <div>
            <h3 className="text-lg font-bold text-gray-900">{t.package_channels_title}</h3>
            <p className="mt-0.5 text-xs text-gray-500">{t.package_channels_subtitle}</p>
            <div className="mt-4 space-y-4">
              {CHANNEL_META.map(({ key, contentType, icon, color }) => {
                const c = pkg.channels[key];
                if (!c) {
                  return (
                    <div
                      key={key}
                      className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-5 py-4 text-sm text-gray-500"
                    >
                      <span className={`mr-2 inline-flex h-8 w-8 items-center justify-center rounded-lg text-base ${color}`}>
                        {icon}
                      </span>
                      {contentTypeLabel(t, contentType)} — {t.package_channel_failed}
                    </div>
                  );
                }
                return (
                  <ChannelCard
                    key={key}
                    channelKey={key}
                    contentType={contentType}
                    icon={icon}
                    color={color}
                    content={c}
                    productIdea={productIdea}
                    copyText={copyText}
                    onImproved={(outcome) => void handleImproved(key, outcome)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Upsell modal for usage limits */}
      {showUpsell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md animate-fadeIn rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-2xl">
              ⚡
            </div>
            <h3 className="mt-4 text-center text-lg font-bold text-gray-900">{t.usage_limit_title}</h3>
            <p className="mt-2 text-center text-sm text-gray-500">{t.usage_limit_desc.replace('%d', '5')}</p>
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

// ── Single channel card (collapsible, score badge, sections, improve) ─────────

function ChannelCard({
  channelKey,
  contentType,
  icon,
  color,
  content,
  productIdea,
  copyText,
  onImproved,
}: {
  channelKey: string;
  contentType: ContentType;
  icon: string;
  color: string;
  content: ContentResult;
  productIdea: string;
  copyText: (text: string) => Promise<boolean>;
  onImproved: (outcome: ImproveOutcome) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [display, setDisplay] = useState<ContentResult>(content);
  const [copied, setCopied] = useState(false);
  const sections = useMemo(() => parseSections(display.body), [display.body]);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(display.body);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [copyText, display.body]);

  const handleImproved = useCallback(
    (outcome: ImproveOutcome) => {
      if (outcome.improved && outcome.improvedContent) setDisplay(outcome.improvedContent);
      onImproved(outcome);
    },
    [onImproved],
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all hover:shadow-md">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50"
      >
        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-lg ${color}`}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">{contentTypeLabel(t, contentType)}</p>
          <p className="truncate text-xs text-gray-500">{display.title}</p>
        </div>
        {display.score?.total != null && <ScoreBadge total={display.score.total} size="sm" />}
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

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h4 className="text-base font-bold text-gray-900">{display.title}</h4>
            <button
              type="button"
              onClick={handleCopy}
              className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                copied ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {copied ? '✓ ' + t.common_copied : '📋 ' + t.common_copy}
            </button>
          </div>

          {/* F1 Score + F2 Verbessern */}
          <div className="mb-4">
            <ScoreCard
              score={display.score ?? null}
              defaultExpanded
              content={display}
              productIdea={productIdea}
              onImproved={handleImproved}
            />
          </div>

          {sections ? (
            <div className="space-y-3">
              {sections.map((section, idx) => (
                <div key={`${channelKey}-${section.heading}-${idx}`} className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
                  <h5 className="mb-1.5 text-sm font-bold text-gray-900">
                    <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-600 text-[10px] font-bold text-white">
                      {idx + 1}
                    </span>
                    {section.heading}
                  </h5>
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-700">
                    {section.content}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap rounded-xl border border-gray-100 bg-gray-50/60 p-4 font-sans text-sm leading-relaxed text-gray-700">
              {display.body}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
