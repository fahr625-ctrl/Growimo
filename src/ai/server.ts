import { createServerFn } from '@tanstack/react-start';
import type { AutoImproveSectionOutcome, ContentRequest, ContentResult, ContentScore, ContentType, ImproveOutcome, PerformanceEntry, PerformanceOverview, PrioritizeAsset, PrioritizeOutcome, PublishPlanItem, VariantsResult } from './types';
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
 * F7 server-side A/B variants: ONE GPT-4o call (json_object) creates 3
 * clearly different variants {title, body} of an existing asset (same
 * parser-compatible structure as the original), each scored through the
 * EXISTING F1 pipeline (scoreContent). Never blocks — on any error null is
 * returned and the original asset stays untouched.
 */
export const generateVariantsServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as {
      contentType: ContentType;
      currentTitle?: string;
      currentBody?: string;
      metadata?: Record<string, unknown>;
      productIdea?: string;
      strategyContext?: string;
      lang?: 'de' | 'en';
    };
    if (!d || typeof d !== 'object') throw new Error('data is required');
    if (!d.contentType) throw new Error('contentType is required');
    if (!d.currentTitle && !d.currentBody) throw new Error('content is required');
    return {
      contentType: d.contentType,
      currentTitle: d.currentTitle ?? '',
      currentBody: d.currentBody ?? '',
      metadata: d.metadata ?? {},
      productIdea: d.productIdea ?? '',
      strategyContext: d.strategyContext ?? '',
      lang: (d.lang === 'en' ? 'en' : 'de') as 'de' | 'en',
    };
  })
  .handler(async ({ data }): Promise<VariantsResult | null> => {
    console.log('[server.generateVariants]', data.contentType, 'lang:', data.lang);
    const { generateVariants } = await import('./variants');
    const original: ContentResult = {
      contentType: data.contentType,
      title: data.currentTitle,
      body: data.currentBody,
      metadata: data.metadata,
    };
    const result = await generateVariants(
      {
        contentType: data.contentType,
        productIdea: data.productIdea,
        strategyContext: data.strategyContext,
      },
      original,
      data.lang,
    );
    console.log(
      '[server.generateVariants] outcome:',
      result ? `${result.variants.length} variants scored` : 'null (failed)',
    );
    return result;
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
 * F8 server-side publish-plan builder. Reads the user's stored contents,
 * groups them per project, ranks each project with the deterministic F3 rules
 * and spreads the items over the next days (rank + channel cadence). NO LLM —
 * zero cost. Returns the plan so the client can show it before saving.
 */
export const buildPublishPlanServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as { userId?: unknown; lang?: unknown };
    if (!d || typeof d !== 'object' || typeof d.userId !== 'string' || !d.userId) {
      throw new Error('userId is required');
    }
    return { userId: d.userId, lang: (d.lang === 'en' ? 'en' : 'de') as 'de' | 'en' };
  })
  .handler(async ({ data }): Promise<{ items: PublishPlanItem[]; generatedAt: string; ruleVersion: number }> => {
    console.log('[server.buildPublishPlan] user:', data.userId.slice(0, 12), 'lang:', data.lang);
    const { qGetAllContentByUser } = await import('../db/queries');
    const { buildPublishPlan, qualityFromMetadata } = await import('./publish-plan');
    const contents = await qGetAllContentByUser(data.userId);
    const plan = buildPublishPlan(
      contents.map((c) => ({
        projectId: c.projectId,
        projectTitle: c.projectTitle,
        channel: c.contentType,
        assetId: c.id,
        title: c.title,
        qualityScore: qualityFromMetadata(c.metadata),
        body: c.body,
        metadata: c.metadata,
      })),
      { lang: data.lang },
    );
    console.log('[server.buildPublishPlan] done:', plan.items.length, 'items');
    return plan;
  });

/**
 * F8 persist the generated plan (upsert per user+asset). Returns the stored rows.
 */
export const savePublishPlanServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as { userId?: unknown; plan?: unknown };
    if (!d || typeof d !== 'object' || typeof d.userId !== 'string' || !d.userId) {
      throw new Error('userId is required');
    }
    const plan = d.plan as { items?: PublishPlanItem[] };
    if (!Array.isArray(plan?.items)) throw new Error('plan.items are required');
    return { userId: d.userId, items: plan.items };
  })
  .handler(async ({ data }): Promise<{ saved: number }> => {
    console.log('[server.savePublishPlan] items:', data.items.length);
    const { qSavePublishPlan } = await import('../db/queries');
    const rows = await qSavePublishPlan(
      data.userId,
      data.items.map((i) => ({
        assetId: i.assetId,
        projectId: i.projectId,
        channel: i.channel,
        scheduledDate: i.scheduledDate,
        priorityScore: i.priorityScore,
        rank: i.rank,
        bestTime: i.bestTime,
        tasks: i.tasks ?? [],
        title: i.title,
        rationale: i.rationale,
      })),
    );
    return { saved: rows.length };
  });

/**
 * F8 flip one checklist task's done state (persisted per user+asset+task).
 */
export const updateTaskDoneServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as { userId?: unknown; itemId?: unknown; taskId?: unknown; done?: unknown };
    if (!d || typeof d !== 'object' || typeof d.userId !== 'string' || !d.userId) throw new Error('userId is required');
    if (typeof d.itemId !== 'string' || !d.itemId) throw new Error('itemId is required');
    if (typeof d.taskId !== 'string' || !d.taskId) throw new Error('taskId is required');
    return { userId: d.userId, itemId: d.itemId, taskId: d.taskId, done: Boolean(d.done) };
  })
  .handler(async ({ data }): Promise<PublishPlanItem | null> => {
    console.log('[server.updateTaskDone]', data.itemId.slice(0, 12), data.taskId, data.done);
    const { qUpdatePublishTask } = await import('../db/queries');
    const row = await qUpdatePublishTask(data.userId, data.itemId, data.taskId, data.done);
    if (!row) return null;
    return {
      id: row.assetId,
      projectId: row.projectId,
      projectTitle: row.title ?? '',
      channel: row.channel as ContentType,
      assetId: row.assetId,
      title: row.title ?? '',
      qualityScore: null,
      priorityScore: row.priorityScore,
      rank: row.rank,
      scheduledDate: row.scheduledDate,
      bestTime: row.bestTime ?? 'social',
      rationale: row.rationale ?? '',
      tasks: row.tasks,
    };
  });

/**
 * F8 read the stored plan for a user (ordered by date + priority).
 */
export const getPublishPlanServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as { userId?: unknown };
    if (!d || typeof d !== 'object' || typeof d.userId !== 'string' || !d.userId) {
      throw new Error('userId is required');
    }
    return { userId: d.userId };
  })
  .handler(async ({ data }): Promise<PublishPlanItem[]> => {
    console.log('[server.getPublishPlan] user:', data.userId.slice(0, 12));
    const { qGetPublishPlan } = await import('../db/queries');
    const rows = await qGetPublishPlan(data.userId);
    return rows.map((row) => ({
      id: row.assetId,
      projectId: row.projectId,
      projectTitle: row.title ?? '',
      channel: row.channel as ContentType,
      assetId: row.assetId,
      title: row.title ?? '',
      qualityScore: null,
      priorityScore: row.priorityScore,
      rank: row.rank,
      scheduledDate: row.scheduledDate,
      bestTime: row.bestTime ?? 'social',
      rationale: row.rationale ?? '',
      tasks: row.tasks,
    }));
  });

/**
 * F9 persist one performance entry (upsert per user+asset). Returns the row.
 */
export const logPerformanceServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as {
      userId?: unknown;
      assetId?: unknown;
      channel?: unknown;
      publishedAt?: unknown;
      metrics?: unknown;
      notes?: unknown;
    };
    if (!d || typeof d !== 'object' || typeof d.userId !== 'string' || !d.userId) {
      throw new Error('userId is required');
    }
    if (typeof d.assetId !== 'string' || !d.assetId) throw new Error('assetId is required');
    if (typeof d.channel !== 'string' || !d.channel) throw new Error('channel is required');
    const metrics: Record<string, number> = {};
    if (d.metrics && typeof d.metrics === 'object') {
      for (const [k, v] of Object.entries(d.metrics as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) metrics[k] = n;
      }
    }
    return {
      userId: d.userId,
      assetId: d.assetId,
      channel: d.channel,
      publishedAt: typeof d.publishedAt === 'string' ? d.publishedAt : undefined,
      metrics,
      notes: typeof d.notes === 'string' && d.notes.trim() ? d.notes.trim() : undefined,
    };
  })
  .handler(async ({ data }): Promise<PerformanceEntry | null> => {
    console.log('[server.logPerformance]', data.channel, data.assetId.slice(0, 12), Object.keys(data.metrics).join(','));
    const { qLogPerformance } = await import('../db/queries');
    const row = await qLogPerformance(data.userId, data);
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      assetId: row.assetId,
      channel: row.channel as ContentType,
      publishedAt: row.publishedAt,
      metrics: row.metrics,
      notes: row.notes ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

/**
 * F9 full performance overview: entries, per-channel summaries, success
 * factors, suggestions, trends + honest data sufficiency. Deterministic —
 * no LLM. Also used internally by the generation loop (buildPerformanceOverview).
 */
export const getPerformanceOverviewServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as { userId?: unknown; lang?: unknown };
    if (!d || typeof d !== 'object' || typeof d.userId !== 'string' || !d.userId) {
      throw new Error('userId is required');
    }
    return { userId: d.userId, lang: (d.lang === 'en' ? 'en' : 'de') as 'de' | 'en' };
  })
  .handler(async ({ data }): Promise<PerformanceOverview> => {
    console.log('[server.getPerformanceOverview] user:', data.userId.slice(0, 12));
    const { buildPerformanceOverview } = await import('./performance');
    return buildPerformanceOverview(data.userId, { lang: data.lang });
  });

/**
 * F9 list the user's publishable assets (for the "Performance erfassen" form),
 * including plan dates, F1 scores and whether an entry already exists.
 */
export const getPublishedAssetsServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as { userId?: unknown };
    if (!d || typeof d !== 'object' || typeof d.userId !== 'string' || !d.userId) {
      throw new Error('userId is required');
    }
    return { userId: d.userId };
  })
  .handler(async ({ data }) => {
    console.log('[server.getPublishedAssets] user:', data.userId.slice(0, 12));
    const { qGetPublishedAssets } = await import('../db/queries');
    return qGetPublishedAssets(data.userId);
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
    const d = input as { productIdea?: unknown; lang?: unknown; brief?: unknown; userId?: unknown };
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
      userId: typeof d.userId === 'string' && d.userId ? d.userId : undefined,
    };
  })
  .handler(async ({ data }): Promise<MarketingPackage> => {
    console.log('[server.generatePackage] idea:', data.productIdea.slice(0, 80), 'lang:', data.lang);
    const { generateMarketingPackage } = await import('./package/package');
    const pkg = await generateMarketingPackage(data.productIdea, {
      lang: data.lang,
      brief: data.brief,
      userId: data.userId,
    });
    const ok = Object.values(pkg.channels).filter(Boolean).length;
    console.log(
      '[server.generatePackage] done:',
      `${ok}/5 channels,`,
      'prioritized:', pkg.prioritized ? pkg.prioritized.ordered.map((i) => i.channel).join(' > ') : 'n/a',
    );
    return pkg;
  });
