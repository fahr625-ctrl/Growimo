import { createServerFn } from '@tanstack/react-start';
import type { AutoImproveSectionOutcome, ContentRequest, ContentResult, ContentScore, ContentType, ImproveOutcome, PrioritizeAsset, PrioritizeOutcome } from './types';
import type { MarketingPackage } from './package/package';

/**
 * Reports whether the OpenAI API key is configured on the server.
 * Never exposes the key value itself — only a boolean status.
 */
export const getApiKeyStatusServer = createServerFn({ method: 'GET' }).handler(
  async () => {
    return { configured: Boolean(process.env.OPENAI_API_KEY) };
  },
);

/**
 * Server-side AI content generation.
 * Runs on the server so process.env.OPENAI_API_KEY is accessible.
 */
export const generateContentServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    console.log('[server.validator] Raw input type:', typeof input, 'keys:', input && typeof input === 'object' ? Object.keys(input as object) : 'N/A');
    console.log('[server.validator] Raw input:', JSON.stringify(input).slice(0, 300));

    // TanStack strips the { data: ... } wrapper — input IS the payload directly
    const d = input as ContentRequest;
    if (!d || typeof d !== 'object') throw new Error('data is required');
    if (!d.contentType) throw new Error('contentType is required');
    if (!d.productIdea) throw new Error('productIdea is required');
    return {
      contentType: d.contentType,
      productIdea: d.productIdea,
      tone: d.tone,
      additionalContext: d.additionalContext,
    };
  })
  .handler(async ({ data }): Promise<ContentResult> => {
    console.log('[server.generateContent] Received:', JSON.stringify(data));
    const { generateContent } = await import('./generate');
    const result = await generateContent(data);
    console.log('[server.generateContent] Result:', JSON.stringify(result).slice(0, 200));
    return result;
  });

/**
 * Server-side AI content improvement.
 * Takes existing content + analysis feedback and regenerates an improved version.
 */
export const improveContentServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as {
      contentType: ContentType;
      currentContent: string;
      analysisFeedback: string;
      productIdea: string;
    };
    if (!d || typeof d !== 'object') throw new Error('data is required');
    if (!d.contentType) throw new Error('contentType is required');
    if (!d.currentContent) throw new Error('currentContent is required');
    if (!d.analysisFeedback) throw new Error('analysisFeedback is required');
    return d;
  })
  .handler(async ({ data }): Promise<ContentResult> => {
    console.log('[server.improveContent] Improving:', data.contentType);

    const channelLabels: Record<string, string> = {
      seo_blog: 'SEO-Blogbeitrag',
      pinterest_pin: 'Pinterest-Pin',
      etsy_listing: 'Etsy-Listing',
      social_post: 'Social-Media-Beitrag',
      email_newsletter: 'E-Mail-Newsletter',
    };

    const channelLabel = channelLabels[data.contentType] || data.contentType;

    // Build an improvement request using the content type's own system prompt context
    const improvementRequest: ContentRequest = {
      contentType: data.contentType,
      productIdea: data.productIdea || 'Produkt',
      tone: undefined,
      additionalContext: `Verbessere den folgenden ${channelLabel} basierend auf dieser Analyse. Behalte die gleiche Struktur bei, aber optimiere gemäß den Kritikpunkten.

=== AKTUELLER CONTENT ===
${data.currentContent}

=== ANALYSE-FEEDBACK ===
${data.analysisFeedback}

=== ANWEISUNG ===
Generiere eine verbesserte Version des ${channelLabel}. Behalte das gleiche Format und die gleiche Struktur bei. Setze JEDEN konkreten Verbesserungsvorschlag aus der Analyse um. Optimiere Keywords, emotionale Trigger, Lesbarkeit und Conversion-Elemente. Antworte vollständig auf Deutsch.`,
    };

    const { generateContent } = await import('./generate');
    const result = await generateContent(improvementRequest);
    console.log('[server.improveContent] Result:', result.title);
    return result;
  });

/**
 * F2 server-side auto-improve loop: apply the score's concrete fixes to an
 * existing asset, re-score the result, and return the delta + before/after.
 * Consumes the F1 ScoreIssue fix contract (field/action/suggestion) directly.
 */
export const improveByScoreServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as {
      contentType: ContentType;
      productIdea?: string;
      title: string;
      body: string;
      metadata?: Record<string, unknown>;
      score: ContentScore;
    };
    if (!d || typeof d !== 'object') throw new Error('data is required');
    if (!d.contentType) throw new Error('contentType is required');
    if (!d.title) throw new Error('title is required');
    if (!d.body) throw new Error('body is required');
    if (!d.score || typeof d.score.total !== 'number') throw new Error('score is required');
    return {
      contentType: d.contentType,
      productIdea: d.productIdea ?? '',
      title: d.title,
      body: d.body,
      metadata: d.metadata ?? {},
      score: d.score,
    };
  })
  .handler(async ({ data }): Promise<ImproveOutcome> => {
    console.log('[server.improveByScore]', data.contentType, 'old score:', data.score.total);
    const { improveByScore } = await import('./improve');
    const outcome = await improveByScore(
      { contentType: data.contentType, productIdea: data.productIdea },
      {
        contentType: data.contentType,
        title: data.title,
        body: data.body,
        metadata: data.metadata,
        score: data.score,
      },
      data.score,
    );
    console.log(
      '[server.improveByScore] outcome:',
      outcome.improved ? 'improved' : outcome.reason,
      outcome.improved ? `new score: ${outcome.newScore?.total}` : '',
    );
    return outcome;
  });

/**
 * F2.1 server-side section-precise auto-improve: ONE click regenerates ONLY
 * the affected field/section (Pinterest-Titel, Etsy-Beschreibung, …) with the
 * existing strategy + quality rules, deterministically splices the new value
 * into the original, re-scores via the F1 pipeline and returns the
 * before/after + delta. Never blocks — on any error improved:false, original
 * untouched (same contract as improveByScoreServer).
 */
export const autoImproveSectionServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as {
      contentType: ContentType;
      field: string;
      currentTitle?: string;
      currentBody?: string;
      metadata?: Record<string, unknown>;
      productIdea?: string;
      strategyContext?: string;
      fix?: { field?: string; action?: string; suggestion?: string };
      score?: ContentScore | null;
      lang?: 'de' | 'en';
    };
    if (!d || typeof d !== 'object') throw new Error('data is required');
    if (!d.contentType) throw new Error('contentType is required');
    if (!d.field) throw new Error('field is required');
    if (!d.currentTitle && !d.currentBody) throw new Error('content is required');
    if (!d.fix || typeof d.fix !== 'object' || !d.fix.suggestion) throw new Error('fix is required');
    const score = d.score && typeof d.score.total === 'number' ? d.score : null;
    return {
      contentType: d.contentType,
      field: d.field,
      currentTitle: d.currentTitle ?? '',
      currentBody: d.currentBody ?? '',
      metadata: d.metadata ?? {},
      productIdea: d.productIdea ?? '',
      strategyContext: d.strategyContext ?? '',
      fix: { field: d.fix.field ?? d.field, action: d.fix.action ?? 'rewrite', suggestion: d.fix.suggestion },
      score,
      lang: (d.lang === 'en' ? 'en' : 'de') as 'de' | 'en',
    };
  })
  .handler(async ({ data }): Promise<AutoImproveSectionOutcome> => {
    console.log('[server.autoImproveSection]', data.contentType, 'field:', data.field);
    const { autoImproveSection } = await import('./auto-improve');
    const original: ContentResult = {
      contentType: data.contentType,
      title: data.currentTitle,
      body: data.currentBody,
      metadata: data.metadata,
      score: data.score,
    };
    const outcome = await autoImproveSection(
      { contentType: data.contentType, productIdea: data.productIdea, strategyContext: data.strategyContext },
      original,
      data.fix,
      data.score,
      data.lang,
    );
    console.log(
      '[server.autoImproveSection] outcome:',
      outcome.improved ? `improved ${outcome.oldScore?.total} → ${outcome.newScore?.total}` : outcome.reason,
    );
    return outcome;
  });

/**
 * F3 server-side publication prioritization.
 * Takes the project's scored assets (channel + F1 quality score per asset),
 * ranks them deterministically and phrases the WHY via one GPT-4o call.
 * Returns null when fewer than 2 scored publishable channels are provided.
 */
export const prioritizeServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as {
      assets?: Array<{ channel: ContentType; assetId?: string; qualityScore?: number | null }>;
      productIdea?: string;
      lang?: string;
    };
    if (!d || typeof d !== 'object') throw new Error('data is required');
    if (!Array.isArray(d.assets) || d.assets.length === 0) throw new Error('assets are required');
    const assets: PrioritizeAsset[] = d.assets.map((a) => ({
      channel: a.channel,
      assetId: a.assetId,
      qualityScore: typeof a.qualityScore === 'number' ? a.qualityScore : null,
    }));
    return {
      assets,
      productIdea: d.productIdea ?? '',
      lang: (d.lang === 'en' ? 'en' : 'de') as 'de' | 'en',
    };
  })
  .handler(async ({ data }): Promise<PrioritizeOutcome | null> => {
    console.log('[server.prioritize]', data.assets.length, 'assets, lang:', data.lang);
    const { prioritizeChannels } = await import('./prioritize');
    const outcome = await prioritizeChannels(data.assets, {
      productIdea: data.productIdea,
      lang: data.lang,
    });
    console.log(
      '[server.prioritize] outcome:',
      outcome ? `ranked ${outcome.ordered.length} channels (llm: ${outcome.llmUsed})` : 'null (<2 scored channels)',
    );
    return outcome;
  });

/**
 * F4 server-side complete marketing package.
 * ONE product idea → shared strategic kernel → all five channels (each with
 * F1 score) → F3 prioritization. Single channel failures are skipped (null),
 * the package itself never blocks. Cost: 1 kernel + 5 generations + 5 score
 * passes per call.
 */
export const generatePackageServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as { productIdea?: unknown; lang?: unknown; brief?: unknown };
    if (!d || typeof d !== 'object') throw new Error('data is required');
    if (typeof d.productIdea !== 'string' || !d.productIdea.trim()) {
      throw new Error('productIdea is required');
    }
    let brief: Record<string, string> | null = null;
    if (d.brief && typeof d.brief === 'object') {
      brief = {};
      for (const [k, v] of Object.entries(d.brief as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim()) brief[k] = v.trim();
      }
      if (Object.keys(brief).length === 0) brief = null;
    }
    return {
      productIdea: d.productIdea.trim(),
      lang: (d.lang === 'en' ? 'en' : 'de') as 'de' | 'en',
      brief,
    };
  })
  .handler(async ({ data }): Promise<MarketingPackage> => {
    console.log('[server.generatePackage] idea:', data.productIdea.slice(0, 80), 'lang:', data.lang);
    const { generateMarketingPackage } = await import('./package/package');
    const pkg = await generateMarketingPackage(data.productIdea, {
      lang: data.lang,
      brief: data.brief,
    });
    const ok = Object.values(pkg.channels).filter(Boolean).length;
    console.log(
      '[server.generatePackage] done:',
      `${ok}/5 channels,`,
      'prioritized:', pkg.prioritized ? pkg.prioritized.ordered.map((i) => i.channel).join(' > ') : 'n/a',
    );
    return pkg;
  });
