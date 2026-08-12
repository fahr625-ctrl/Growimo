import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useUser } from '@clerk/clerk-react';
import { generateContentServer } from '~/ai/server';
import type { ContentType, ContentRequest, ContentResult } from '~/ai/types';
import { CONTENT_TYPE_REGISTRY, getContentTypeConfig } from '~/ai/content-types';
import { TONES, toneLabel } from '~/lib/tones';
import { contentTypeLabel } from '~/lib/content-types';
import { formatDate } from '~/lib/date';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import AnalysisDashboard, { AnalysisPlaceholder } from '~/components/AnalysisDashboard';
import BrandBadge from '~/components/BrandBadge';
import { useTranslation } from '~/i18n';
import { saveProject, getProjectsByUser } from '~/store/projects';
import type { Project } from '~/store/projects';
import { getBrandContext } from '~/store/brand';
import { canGenerate, recordGeneration, getRemainingGenerations } from '~/store/subscriptions';
import { trackEvent } from '~/store/analytics';

// ── Tone options ──────────────────────────────────────────────────────────────

// ── Search params type ────────────────────────────────────────────────────────
interface NewProjectSearch {
  idea?: string;
}

// ── Route definition ──────────────────────────────────────────────────────────
export const Route = createFileRoute('/app/new-project')({
  validateSearch: (search: Record<string, unknown>): NewProjectSearch => {
    return {
      idea: typeof search.idea === 'string' ? search.idea : undefined,
    };
  },
  component: NewProjectPage,
});

function NewProjectPage() {
  return (
    <ProtectedRoute>
      <NewProjectContent />
    </ProtectedRoute>
  );
}

// ── Main content component ────────────────────────────────────────────────────
function NewProjectContent() {
  const { user } = useUser();
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const { idea: ideaParam } = useSearch({ from: '/app/new-project' });

  // Loading messages from translations
  const LOADING_MESSAGES = useMemo(() => [
    t.loading_analyze,
    t.loading_research,
    t.loading_pinterest,
    t.loading_blog,
    t.loading_etsy,
    t.loading_social,
    t.loading_email,
    t.loading_plan,
    t.loading_ideas,
    t.loading_trends,
    t.loading_finalize,
  ], [t]);

  // Step state: 1 = input+selection, 2 = results
  const [step, setStep] = useState(1);

  // Step 1 state
  const [productIdea, setProductIdea] = useState('');
  const [tone, setTone] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<ContentType[]>([]);

  // Product details state (collapsible form)
  const [productDetails, setProductDetails] = useState({
    size: '', material: '', targetAudience: '', platform: '',
    style: '', language: 'Deutsch', price: '', shipping: '', special: '',
  });
  const [showDetails, setShowDetails] = useState(false);

  // Step 2 state
  const [results, setResults] = useState<ContentResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0]);
  const loadingIndexRef = useRef(0);
  const [copiedAll, setCopiedAll] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Upsell modal for usage limits
  const [showUpsell, setShowUpsell] = useState(false);


  // ── Cycle loading messages ────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading) return;
    loadingIndexRef.current = 0;
    setLoadingMessage(LOADING_MESSAGES[0]);
    const interval = setInterval(() => {
      loadingIndexRef.current =
        (loadingIndexRef.current + 1) % LOADING_MESSAGES.length;
      setLoadingMessage(LOADING_MESSAGES[loadingIndexRef.current]);
    }, 2000);
    return () => clearInterval(interval);
  }, [isLoading, LOADING_MESSAGES]);

  // ── Auto-save draft to localStorage ───────────────────────────────────────
  const uid = user?.id ?? 'anonymous';
  const draftKey = `growimo_draft_${uid}`;

  // Restore draft on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft.productIdea) setProductIdea(draft.productIdea);
      if (draft.tone) setTone(draft.tone);
      if (draft.selectedTypes?.length) setSelectedTypes(draft.selectedTypes);
      if (draft.productDetails) setProductDetails(draft.productDetails);
      if (draft.showDetails) setShowDetails(draft.showDetails);
    } catch {
      // Ignore parse errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-fill product idea from URL ?idea= param (only on mount, only if not already set)
  useEffect(() => {
    if (ideaParam && ideaParam.trim()) {
      setProductIdea((prev) => prev || decodeURIComponent(ideaParam));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-select default tone + content types from settings (only when no draft)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) return; // a draft restores everything — don't override it
      const defaultTone = localStorage.getItem('growimo_default_tone');
      if (defaultTone && TONES.includes(defaultTone as (typeof TONES)[number])) {
        setTone((prev) => prev || defaultTone);
      }
      const defaultTypesRaw = localStorage.getItem('growimo_default_types');
      if (defaultTypesRaw) {
        const parsed = JSON.parse(defaultTypesRaw);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((tp: unknown) =>
            CONTENT_TYPE_REGISTRY.some((c) => c.type === tp),
          );
          if (valid.length > 0) setSelectedTypes(valid);
        }
      }
    } catch {
      // ignore storage errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save draft as user types/selects
  useEffect(() => {
    if (step !== 1) return;
    try {
      const draft = {
        productIdea,
        tone,
        selectedTypes,
        productDetails,
        showDetails,
      };
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // Ignore storage errors
    }
  }, [productIdea, tone, selectedTypes, productDetails, showDetails, step, draftKey]);

  // ── Toggle a content type selection ────────────────────────────────────────
  const toggleContentType = useCallback((type: ContentType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((tp) => tp !== type) : [...prev, type],
    );
  }, []);

  // ── Select all / clear all ─────────────────────────────────────────────────
  const selectAll = useCallback(() => {
    setSelectedTypes(CONTENT_TYPE_REGISTRY.map((c) => c.type));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedTypes([]);
  }, []);

  // ── Build additional context from product details ──────────────────────────
  const buildAdditionalContext = useCallback(() => {
    const f = productDetails;
    return [
      f.size && `Größe/Maße: ${f.size}`,
      f.material && `Material: ${f.material}`,
      f.targetAudience && `Zielgruppe: ${f.targetAudience}`,
      f.platform && `Verkaufsplattform: ${f.platform}`,
      f.style && `Stil: ${f.style}`,
      f.language && `Sprache: ${f.language}`,
      f.price && `Preis: ${f.price}`,
      f.shipping && `Versand: ${f.shipping}`,
      f.special && `Besonderheiten: ${f.special}`,
    ].filter(Boolean).join('\n');
  }, [productDetails]);

  // ── Generate all selected content types ────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (selectedTypes.length === 0) return;

    const uid = user?.id ?? 'anonymous';
    setErrorMessage(null);

    // Check usage limits
    if (!canGenerate(uid)) {
      setShowUpsell(true);
      return;
    }

    setIsLoading(true);
    setStep(2);
    setResults([]);
    setSavedProjectId(null);

    try {
      // Inject brand context into product idea
      const brandCtx = getBrandContext();
      const enhancedIdea = brandCtx ? `${brandCtx}\n\nProdukt: ${productIdea}` : productIdea;

      const requests: ContentRequest[] = selectedTypes.map((contentType) => ({
        contentType,
        productIdea: enhancedIdea,
        tone: tone || undefined,
        additionalContext: buildAdditionalContext() || undefined,
      }));

      const generated: ContentResult[] = await Promise.all(
        requests.map((req) => generateContentServer({ data: req })),
      ) as ContentResult[];

      setResults(generated);

      // Record this generation in usage tracking
      recordGeneration(uid);

      // Save to in-memory store
      const userId = user?.id ?? 'anonymous';
      const projectTitle =
        productIdea.length > 50
          ? productIdea.slice(0, 50) + '...'
          : productIdea;

      const saved = await saveProject(
        userId,
        {
          title: projectTitle,
          productIdea,
          contentTypes: selectedTypes,
          status: 'completed',
        },
        generated.map((r) => ({
          contentType: r.contentType,
          title: r.title,
          body: r.body,
          metadata: r.metadata,
        })),
      );
      setSavedProjectId(saved.id);

      // Track strategy creation
      try {
        trackEvent('strategy_created', {
          contentTypes: String(selectedTypes.length),
          channels: selectedTypes.join(','),
        });
      } catch { /* ignore analytics errors */ }

      // Clear draft after successful generation
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }

      // Auto-generate analysis after all content — pass the full generated content
      try {
        // Build a comprehensive content summary for analysis
        const contentSummary = generated
          .map((r) => {
            const config = getContentTypeConfig(r.contentType);
            return `=== ${config?.label ?? r.contentType} ===\nTitel: ${r.title}\n\n${r.body}`;
          })
          .join('\n\n');

        const analysisResult = (await generateContentServer({
          data: {
            contentType: 'marketing_analysis',
            productIdea:
              enhancedIdea +
              '\n\n--- GENERIERTE INHALTE ZUR ANALYSE ---\n\n' +
              contentSummary,
            tone: tone || undefined,
            additionalContext: buildAdditionalContext() || undefined,
          },
        })) as ContentResult;
        setResults((prev) => [...prev, analysisResult]);

        // Auto-generate Market Intelligence alongside analysis
        try {
          const miResult = (await generateContentServer({
            data: {
              contentType: 'market_intelligence',
              productIdea: enhancedIdea,
              tone: tone || undefined,
              additionalContext: buildAdditionalContext() || undefined,
            },
          })) as ContentResult;
          setResults((prev) => [...prev, miResult]);
        } catch (miError) {
          console.error('Market Intelligence generation failed:', miError);
        }
      } catch (analysisError) {
        console.error('Analysis generation failed:', analysisError);
      }
    } catch (error) {
      console.error('Generation failed:', error);
      const message = t.common_unknown_error;
      setResults([]);
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedTypes, productIdea, tone, user?.id, buildAdditionalContext, draftKey]);

  // ── Handle content improvement from analysis ────────────────────────────────
  const handleImproveResult = useCallback((contentType: ContentType, improvedResult: ContentResult) => {
    setResults((prev) =>
      prev.map((r) =>
        r.contentType === contentType && r.contentType !== 'marketing_analysis'
          ? { ...improvedResult }
          : r,
      ),
    );
  }, []);

  // ── Copy single result ─────────────────────────────────────────────────────
  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    }
  }, []);

  // ── Copy all results as a formatted document ──────────────────────────────
  const handleCopyAll = useCallback(async () => {
    const allText = results
      .map((r) => {
        const config = getContentTypeConfig(r.contentType);
        return `${config?.icon ?? ''} **${r.title}**\n\n${r.body}`;
      })
      .join('\n\n---\n\n');

    const ok = await handleCopy(allText);
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    }
  }, [results, handleCopy]);

  // ── Reset ──────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setStep(1);
    setProductIdea('');
    setTone('');
    setSelectedTypes([]);
    setResults([]);
    setIsLoading(false);
    setSavedProjectId(null);
    setErrorMessage(null);
    setProductDetails({
      size: '', material: '', targetAudience: '', platform: '',
      style: '', language: 'Deutsch', price: '', shipping: '', special: '',
    });
    setShowDetails(false);
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
  }, [draftKey]);

  // ── Compute stats for results ──────────────────────────────────────────────
  const totalWords = results.reduce((sum, r) => sum + r.body.split(/\s+/).length, 0);
  const channelCount = results.length;
  const readTimeSeconds = Math.max(1, Math.round(totalWords / 200 * 60));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Step 1: Idea + Content Type Selection */}
      {step === 1 && (
        <Step1Strategy
          productIdea={productIdea}
          setProductIdea={setProductIdea}
          tone={tone}
          setTone={setTone}
          selectedTypes={selectedTypes}
          toggleContentType={toggleContentType}
          selectAll={selectAll}
          clearSelection={clearSelection}
          onGenerate={handleGenerate}
          productDetails={productDetails}
          setProductDetails={setProductDetails}
          showDetails={showDetails}
          setShowDetails={setShowDetails}
        />
      )}

      {/* Step 2: Results Dashboard */}
      {step === 2 && (
        <Step2Results
          isLoading={isLoading}
          loadingMessage={loadingMessage}
          selectedCount={selectedTypes.length}
          results={results}
          productIdea={productIdea}
          tone={tone}
          channelCount={channelCount}
          totalWords={totalWords}
          readTimeSeconds={readTimeSeconds}
          copiedAll={copiedAll}
          savedProjectId={savedProjectId}
          errorMessage={errorMessage}
          onCopyAll={handleCopyAll}
          onReset={handleReset}
          onViewProject={() =>
            savedProjectId &&
            navigate({
              to: '/app/projects/$projectId',
              params: { projectId: savedProjectId },
            })
          }
          onDismissError={() => {
            setErrorMessage(null);
            setStep(1);
          }}
          onImproveResult={handleImproveResult}
        />
      )}

      {/* Upsell Modal */}
      {showUpsell && (
        <UpsellModal
          onClose={() => setShowUpsell(false)}
          remaining={getRemainingGenerations(user?.id ?? 'anonymous')}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 1: Create Marketing Strategy
// ═══════════════════════════════════════════════════════════════════════════════

function Step1Strategy({
  productIdea,
  setProductIdea,
  tone,
  setTone,
  selectedTypes,
  toggleContentType,
  selectAll,
  clearSelection,
  onGenerate,
  productDetails,
  setProductDetails,
  showDetails,
  setShowDetails,
}: {
  productIdea: string;
  setProductIdea: (v: string) => void;
  tone: string;
  setTone: (v: string) => void;
  selectedTypes: ContentType[];
  toggleContentType: (type: ContentType) => void;
  selectAll: () => void;
  clearSelection: () => void;
  onGenerate: () => void;
  productDetails: {
    size: string; material: string; targetAudience: string; platform: string;
    style: string; language: string; price: string; shipping: string; special: string;
  };
  setProductDetails: React.Dispatch<React.SetStateAction<{
    size: string; material: string; targetAudience: string; platform: string;
    style: string; language: string; price: string; shipping: string; special: string;
  }>>;
  showDetails: boolean;
  setShowDetails: (v: boolean) => void;
}) {
  const { t, locale } = useTranslation();
  const canGen = productIdea.trim().length > 0 && selectedTypes.length > 0;

  const updateDetail = (field: string, value: string) => {
    setProductDetails((prev) => ({ ...prev, [field]: value }));
  };

  const detailFields = [
    { key: 'size', label: t.strategy_details_size, placeholder: t.strategy_details_size_ph },
    { key: 'material', label: t.strategy_details_material, placeholder: t.strategy_details_material_ph },
    { key: 'targetAudience', label: t.strategy_details_audience, placeholder: t.strategy_details_audience_ph },
    { key: 'platform', label: t.strategy_details_platform, placeholder: t.strategy_details_platform_ph },
    { key: 'style', label: t.strategy_details_style, placeholder: t.strategy_details_style_ph },
    { key: 'language', label: t.strategy_details_language, placeholder: 'Deutsch', type: 'select', options: ['Deutsch', 'English', 'Français', 'Español', 'Italiano', 'Nederlands', 'Polski', 'Svenska', 'Norsk', 'Dansk'] },
    { key: 'price', label: t.strategy_details_price, placeholder: t.strategy_details_price_ph },
    { key: 'shipping', label: t.strategy_details_shipping, placeholder: t.strategy_details_shipping_ph },
    { key: 'special', label: t.strategy_details_special, placeholder: t.strategy_details_special_ph },
  ];

  return (
    <div className="mx-auto max-w-4xl animate-fadeIn">
      {/* Hero header */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">
          {t.strategy_title}
        </h1>
        <p className="mt-3 text-lg text-gray-500">
          {t.strategy_subtitle}
        </p>
      </div>

      {/* Product idea input */}
      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <label
          htmlFor="product-idea"
          className="mb-2 block text-sm font-semibold text-gray-700"
        >
          {t.strategy_idea_label}
        </label>
        <BrandBadge />
        <div className="mt-2">
          <textarea
          id="product-idea"
          value={productIdea}
          onChange={(e) => setProductIdea(e.target.value)}
          placeholder={t.strategy_idea_placeholder}
          rows={4}
          className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        </div>

        {/* Tone selector */}
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
      </div>

      {/* ── Product Details (collapsible) ─────────────────────────────────── */}
      <div className="mb-8">
        {!showDetails ? (
          <button
            type="button"
            onClick={() => setShowDetails(true)}
            className="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-3 text-sm text-gray-500 transition-all hover:border-blue-300 hover:bg-blue-50/30 hover:text-blue-600"
          >
            <span className="text-base">➕</span>
            <span>{t.strategy_product_details_add}</span>
          </button>
        ) : (
          <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/40 to-purple-50/40 p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-blue-800">
                {t.strategy_product_details_title}
              </h3>
              <button
                type="button"
                onClick={() => setShowDetails(false)}
                className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
              >
                {t.strategy_product_details_hide}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {detailFields.map((field) => (
                <div key={field.key}>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600">
                    {field.label}
                  </label>
                  {'type' in field && field.type === 'select' ? (
                    <select
                      value={productDetails[field.key as keyof typeof productDetails]}
                      onChange={(e) => updateDetail(field.key, e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    >
                      {(field.options ?? []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={productDetails[field.key as keyof typeof productDetails]}
                      onChange={(e) => updateDetail(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Content type selection */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              {t.strategy_select_types}
            </h3>
            <p className="text-sm text-gray-500">
              {t.strategy_select_types_desc}{' '}
              {selectedTypes.length > 0 && (
                <span className="font-medium text-blue-600">
                  {t.strategy_selected_count.replace('%d', String(selectedTypes.length))}
                </span>
              )}
            </p>
          </div>
          {/* Quick-toggle links */}
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              onClick={selectAll}
              className="font-medium text-blue-600 hover:text-blue-800 transition-colors"
            >
              {t.strategy_select_all}
            </button>
            <span className="text-gray-300">|</span>
            <button
              type="button"
              onClick={clearSelection}
              className="font-medium text-gray-400 hover:text-gray-600 transition-colors"
            >
              {t.strategy_clear_selection}
            </button>
          </div>
        </div>

        {/* 2x4 responsive grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CONTENT_TYPE_REGISTRY.map((ct) => {
            const isSelected = selectedTypes.includes(ct.type);
            return (
              <button
                key={ct.type}
                type="button"
                onClick={() => toggleContentType(ct.type)}
                className={`relative flex flex-col items-center gap-1.5 rounded-xl border-2 p-4 text-center transition-all hover:-translate-y-0.5 ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 shadow-md'
                    : 'border-gray-200 bg-white hover:border-gray-200 hover:shadow-sm'
                }`}
              >
                {isSelected && (
                  <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs text-white">
                    ✓
                  </span>
                )}
                <span className="text-2xl">{ct.icon}</span>
                <span
                  className={`text-xs font-semibold leading-tight ${
                    isSelected ? 'text-blue-700' : 'text-gray-700'
                  }`}
                >
                  {contentTypeLabel(t, ct.type)}
                </span>
                <span className="text-[10px] leading-tight text-gray-400 line-clamp-2">
                  {ct.description}
                </span>
              </button>
            );
          })}
        </div>

        {/* Generate CTA */}
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGen}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-xl hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {t.strategy_create_btn}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 2: Results Dashboard
// ═══════════════════════════════════════════════════════════════════════════════

function Step2Results({
  isLoading,
  loadingMessage,
  selectedCount,
  results,
  productIdea,
  tone,
  channelCount,
  totalWords,
  readTimeSeconds,
  copiedAll,
  savedProjectId,
  errorMessage,
  onCopyAll,
  onReset,
  onViewProject,
  onDismissError,
  onImproveResult,
}: {
  isLoading: boolean;
  loadingMessage: string;
  selectedCount: number;
  results: ContentResult[];
  productIdea: string;
  tone: string;
  channelCount: number;
  totalWords: number;
  readTimeSeconds: number;
  copiedAll: boolean;
  savedProjectId: string | null;
  errorMessage: string | null;
  onCopyAll: () => void;
  onReset: () => void;
  onViewProject: () => void;
  onDismissError: () => void;
  onImproveResult: (contentType: ContentType, result: ContentResult) => void;
}) {
  const { t, locale } = useTranslation();
  const toneLabel = tone
    ? tone.charAt(0).toUpperCase() + tone.slice(1)
    : null;

  return (
    <div className="mx-auto max-w-4xl animate-fadeIn">
      {/* Loading state */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="relative mb-6">
            <div className="h-16 w-16 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl">✨</span>
            </div>
          </div>
          <p className="animate-pulse text-sm font-medium text-gray-600">
            {loadingMessage}
          </p>
          <p className="mt-2 text-xs text-gray-400">
            {t.loading_generating_count.replace('%d', String(selectedCount))}
          </p>
        </div>
      )}

      {/* Error message */}
      {!isLoading && errorMessage && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800">
          <p className="font-semibold">{t.results_generation_failed}</p>
          <p className="mt-1">{errorMessage}</p>
          <button
          onClick={onDismissError}
          className="mt-3 text-sm font-medium text-red-700 underline hover:text-red-900"
          >
          {t.common_retry}
          </button>
        </div>
      )}

      {/* Results */}
      {!isLoading && results.length > 0 && (
        <>
          {/* Consistency header */}
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/50 px-5 py-3">
            <span className="text-sm text-gray-600">
              {t.results_consistency_prefix}
              <span className="font-semibold text-gray-900">
                "{productIdea.length > 80
                  ? productIdea.slice(0, 80) + '...'
                  : productIdea}"
              </span>
            </span>
            {toneLabel && (
              <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                {t.results_tone_label.replace('%s', toneLabel)}
              </span>
            )}
          </div>


          {/* Header: title + stats + actions */}
          <div className="mb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {productIdea.length > 60
                    ? productIdea.slice(0, 60) + '...'
                    : productIdea}
                </h2>
                <p className="mt-0.5 text-sm text-gray-500">
                  {formatDate(new Date(), locale)}
                </p>
              </div>
              <button
                type="button"
                onClick={onCopyAll}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
              >
                {copiedAll ? (
                  <>
                    <svg
                      className="h-4 w-4 text-emerald-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    {t.results_all_copied}
                  </>
                ) : (
                  <>
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                    {t.common_copy_all}
                  </>
                )}
              </button>
            </div>

            {/* Stats bar */}
            <div className="mt-4 flex flex-wrap gap-4">
              <StatBadge
                icon="📡"
                label={channelCount === 1
                  ? t.results_channel_count.replace('%d', String(channelCount))
                  : t.results_channel_count_plural.replace('%d', String(channelCount))}
              />
              <StatBadge
                icon="📝"
                label={t.results_words.replace('%s', totalWords.toLocaleString())}
              />
              <StatBadge
                icon="⏱️"
                label={t.results_read_time.replace('%d', String(readTimeSeconds))}
              />
            </div>
          </div>

          {/* Accordion results */}
          <AccordionResults
            results={results}
            productIdea={productIdea}
            savedProjectId={savedProjectId}
            onImproveResult={onImproveResult}
          />

          {/* Actions footer */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-xl hover:-translate-y-0.5"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              {t.results_new}
            </button>
            {savedProjectId && (
              <button
                type="button"
                onClick={onViewProject}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-300 bg-white px-6 py-3 text-sm font-semibold text-blue-700 shadow-sm transition-all hover:bg-blue-50 hover:shadow-md"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                  />
                </svg>
                {t.results_view_project}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Stat badge ────────────────────────────────────────────────────────────────

function StatBadge({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600">
      <span>{icon}</span>
      {label}
    </span>
  );
}

// ── Accordion results (single-open) ──────────────────────────────────────────

function AccordionResults({
  results,
  productIdea,
  savedProjectId,
  onImproveResult,
}: {
  results: ContentResult[];
  productIdea: string;
  savedProjectId: string | null;
  onImproveResult: (contentType: ContentType, result: ContentResult) => void;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const { t, locale } = useTranslation();
  const { user } = useUser();

  // Load all projects from PostgreSQL for cross-project intelligence
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  useEffect(() => {
    let cancelled = false;
    getProjectsByUser(user?.id ?? 'anonymous')
      .then((projects) => {
        if (!cancelled) setAllProjects(projects);
      })
      .catch((err) => {
        console.error('Failed to load projects for intelligence:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Find market intelligence content if it exists
  const marketIntelResult = results.find((r) => r.contentType === 'market_intelligence') ?? null;

  return (
    <div className="space-y-3">
      {results.map((result, idx) => {
        const config = getContentTypeConfig(result.contentType);
        const isOpen = openIndex === idx;
        const isAnalysis = result.contentType === 'marketing_analysis';
        const isMarketIntel = result.contentType === 'market_intelligence';

        // Market Intelligence is rendered inside AnalysisDashboard — skip standalone accordion
        if (isMarketIntel) return null;

        const cardClasses = isAnalysis
          ? 'overflow-hidden rounded-xl border border-blue-300 bg-gradient-to-r from-blue-50 to-purple-50 shadow-sm transition-all hover:shadow-md'
          : 'overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all hover:shadow-md';

        const headerClasses = isAnalysis
          ? 'flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-blue-100/50'
          : 'flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50';

        return (
          <div
            key={result.contentType + '-' + idx}
            className={cardClasses}
          >
            {/* Accordion header */}
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : idx)}
              className={headerClasses}
            >
              <span className="flex-shrink-0 text-xl">
                {config?.icon ?? '📄'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">
                  {config?.label ?? result.contentType}
                </p>
                <p className="truncate text-xs text-gray-500">{result.title}</p>
              </div>
              {isAnalysis && (
                <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  ⭐
                </span>
              )}
              <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                {t.results_generated_badge}
              </span>
              <svg
                className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform duration-200 ${
                  isOpen ? 'rotate-180' : ''
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {/* Accordion body */}
            <div
              className={`grid transition-all duration-300 ease-in-out ${
                isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="overflow-hidden">
                <div className={`px-5 py-4 ${isAnalysis ? 'border-t border-blue-200 bg-white/60' : 'border-t border-gray-100'}`}>
                  {isAnalysis ? (
                    <AnalysisDashboard
                      data={result}
                      allResults={results.filter(r => r.contentType !== 'marketing_analysis' && r.contentType !== 'market_intelligence')}
                      productIdea={productIdea}
                      projectId={savedProjectId}
                      onContentImproved={onImproveResult}
                      marketIntelligenceContent={marketIntelResult}
                      allProjects={allProjects}
                    />
                  ) : (
                    <>
                      <h4 className="mb-2 text-base font-bold text-gray-900">
                        {result.title}
                      </h4>
                      <pre className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 font-sans">
                        {result.body}
                      </pre>
                    </>
                  )}

                  {!isAnalysis && (
                    <div className="mt-4 flex justify-end">
                      <CopyButton text={result.body} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Copy button (reusable) ────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const { t, locale } = useTranslation();

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
        copied
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {copied ? (
        <>
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
          {t.common_copied}
        </>
      ) : (
        <>
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          {t.common_copy}
        </>
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Upsell Modal
// ═══════════════════════════════════════════════════════════════════════════════

function UpsellModal({
  onClose,
  remaining,
}: {
  onClose: () => void;
  remaining: number;
}) {
  const { t, locale } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md animate-fadeIn rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-2xl">
          ⚡
        </div>
        <h3 className="mt-4 text-center text-lg font-bold text-gray-900">
          {t.usage_limit_title}
        </h3>
        <p className="mt-2 text-center text-sm text-gray-500">
          {t.usage_limit_desc.replace('%d', String(5 - remaining))}
        </p>
        <div className="mt-6 space-y-3">
          <Link
            to="/app/pricing"
            onClick={onClose}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            {t.usage_limit_cta}
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition-all hover:bg-gray-50"
          >
            {t.usage_limit_later}
          </button>
        </div>
      </div>
    </div>
  );
}
