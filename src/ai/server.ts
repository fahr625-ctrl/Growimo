import { createServerFn } from '@tanstack/react-start';
import type { ContentRequest, ContentResult, ContentScore, ContentType, ImproveOutcome, PrioritizeAsset, PrioritizeOutcome } from './types';

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
