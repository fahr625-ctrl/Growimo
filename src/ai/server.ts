import { createServerFn } from '@tanstack/react-start';
import type { AutoImproveSectionOutcome, ContentRequest, ContentResult, ContentScore, ContentType, DeclaredFacts, ImproveOutcome, PerformanceEntry, PerformanceOverview, PrioritizeAsset, PrioritizeOutcome, PublishPlanItem, UserPreferencesView, VariantsResult } from './types';
import type { MarketingPackage } from './package/package';
import type { TikTokInput, TikTokMode, TikTokResult } from './tiktok';
import { diagnoseRetentionGaps } from './tiktok';

// Phase 8.2 — Usage-/Limit-System (Kostenschutz): LAZY importiert, damit der
// Client-Bundle nie DB/JWKS-Code zieht (gleiche Strategie wie die dynamischen
// Engine-Imports in den Handlern unten). Guards: Einzel-Asset, Paket-Kanäle,
// TikTok todayIdea/concept, Varianten = je 1 Generierung; Verbessern/Scoring/
// Analyse/Priorisierung = 0 (Owner-Entscheidung 2026-09-12).
// FIX-BLOCK 1 (Owner-Auftrag 2026-10-08): Auch die TikTok-Diagnose v2 zählt
// jetzt 1 Generierung (vollwertige LLM-Generierung) — nur echte interne
// Retries/Scoring/Verbessern bleiben bei 0. Jeder Verbrauch wird im
// usage_events-Ledger mit seiner Aktion zugeordnet (siehe usage-guard.ts).
async function usageGuard() {
  return import('../lib/usage-guard');
}

/**
 * FIX-BLOCK 1 — interner Marker: die A/B-Engine liefert bei Fehlern `null`.
 * Der Guard kompensiert daraufhin die reservierte Einheit (netto 0) und der
 * Handler antwortet wie bisher mit `null` („nie blockieren, Original bleibt").
 */
class VariantGenerationUnavailable extends Error {
  constructor() {
    super('VARIANT_GENERATION_UNAVAILABLE');
    this.name = 'VariantGenerationUnavailable';
  }
}

/** Phase 8.2 — Nutzer-Identität (Clerk) auflösen; fail-closed bei Generierung. */
async function guardUserId(payloadFallback?: string): Promise<string> {
  const g = await usageGuard();
  const uid = await g.resolveUserIdFromServerFn(payloadFallback);
  if (!uid) {
    throw new Error('Keine gültige Sitzung — bitte neu anmelden.');
  }
  return uid;
}

/**
 * Stabilisierung Schritt 2, Punkt 5: Die 5 publizierbaren Kanäle laufen
 * serverseitig IMMER durch den Fakten-Post-Check ("kein Kanal-Pfad ohne
 * Post-Check"). Nicht-Kanal-Typen (Analyse/Strategie-Hilfstexte) bleiben
 * bewusst unverändert, damit bestehende Ausgaben nicht verschlechtert werden.
 */
const FACT_GUARDED_CONTENT_TYPES = [
  'pinterest_pin',
  'etsy_listing',
  'seo_blog',
  'social_post',
  'email_newsletter',
];
function shouldEnforceFacts(contentType: unknown): boolean {
  return typeof contentType === 'string' && FACT_GUARDED_CONTENT_TYPES.includes(contentType);
}

/**
 * Sanitize declared facts (Stabilisierung Schritt 2, Punkt 4) — nur Strings,
 * Längen gedeckelt, leere Werte fallen weg (fail-safe). */
function sanitizeDeclaredFacts(input: unknown): DeclaredFacts | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Record<string, unknown>;
  const take = (key: string): string | undefined => {
    const v = raw[key];
    return typeof v === 'string' && v.trim() ? v.trim().slice(0, 1200) : undefined;
  };
  const extra = Array.isArray(raw.extra)
    ? (raw.extra as unknown[])
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        .slice(0, 40)
        .map((v) => v.trim().slice(0, 600))
    : undefined;
  const facts: DeclaredFacts = {
    size: take('size'),
    material: take('material'),
    price: take('price'),
    shipping: take('shipping'),
    special: take('special'),
    extra: extra && extra.length > 0 ? extra : undefined,
  };
  const hasAny = Object.values(facts).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
  return hasAny ? facts : undefined;
}

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
      // Stabilisierung Schritt 2, Punkt 4/5: strukturierte Nutzerangaben
      // (Produktdetails) als erlaubte Werteliste für den Fakten-Check.
      declaredFacts: sanitizeDeclaredFacts(d.declaredFacts),
    };
  })
  .handler(async ({ data }): Promise<ContentResult> => {
    console.log('[server.generateContent] Received:', JSON.stringify(data));
    const g = await usageGuard();
    const userId = await guardUserId();
    // Phase 8.2 — Drossel (2 s) + Guard: Einzel-Asset = 1 Generierung.
    await g.assertRateOk(userId);
    const { generateContent } = await import('./generate');
    // Stabilisierung Schritt 2, Punkt 5: JEDER Kanal-Pfad (QuickGenerator,
    // Projekt-Flow, Kanal-Paket) läuft durch den Fakten-Post-Check. Server-seitig
    // gesetzt (nicht vom Client manipulierbar). Nicht-Kanal-Typen bleiben wie bisher.
    // FIX-BLOCK 1: Zuordnung im Ledger = Aktion + Kanal (Content-Type).
    return g.withGenerationGuard(
      userId,
      () => generateContent({ ...data, enforceFacts: shouldEnforceFacts(data.contentType) }),
      'de',
      { action: 'generate_content', detail: String(data.contentType) },
    );
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
    return {
      ...d,
      declaredFacts: sanitizeDeclaredFacts((d as { declaredFacts?: unknown }).declaredFacts),
    };
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
      // Stabilisierung Schritt 2, Punkt 5: auch der Verbessern-Pfad läuft durch
      // den Fakten-Post-Check. `factGroundingStrict` + Grounding = Idee/Produktdaten:
      // der bisherige Content im Prompt ist KEIN Beleg (er könnte selbst erfunden sein).
      enforceFacts: true,
      factGrounding: data.productIdea || '',
      factGroundingStrict: true,
      declaredFacts: (data as { declaredFacts?: DeclaredFacts }).declaredFacts,
    };

    const { generateContent } = await import('./generate');
    // Phase 8.2 — Verbessern zählt 0 Generierungen (Owner-Entscheidung), aber
    // die Drossel (2 s) gilt auch hier (LLM-Kosten).
    try {
      const g = await usageGuard();
      const uid = await guardUserId();
      await g.assertRateOk(uid);
    } catch { /* ohne Sitzung: Verbessern läuft wie bisher (kein harter Guard) */ }
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
    // Phase 8.2 — Auto-Verbessern = 0 Generierungen; nur Drossel.
    try {
      const g = await usageGuard();
      const uid = await guardUserId();
      await g.assertRateOk(uid);
    } catch { /* ohne Sitzung unverändert laufen lassen */ }
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
 * F2 "Auf 80+ verbessern" server-side: repeatedly applies improveByScore until
 * the total score reaches `target` (default 80) or the score plateaus. Reuses
 * the exact improveByScore engine — same contract (oldScore/newScore/delta +
 * improvedContent) so the UI can swap + persist like the normal F2 flow. The
 * target drives the wording, never the ranking/structure.
 */
export const improveToScoreServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as {
      contentType: ContentType;
      productIdea?: string;
      title: string;
      body: string;
      metadata?: Record<string, unknown>;
      score: ContentScore;
      target?: number;
    };
    if (!d || typeof d !== 'object') throw new Error('data is required');
    if (!d.contentType) throw new Error('contentType is required');
    if (!d.title) throw new Error('title is required');
    if (!d.body) throw new Error('body is required');
    if (!d.score || typeof d.score.total !== 'number') throw new Error('score is required');
    const target = typeof d.target === 'number' && d.target > 0 && d.target <= 100 ? Math.round(d.target) : 80;
    return {
      contentType: d.contentType,
      productIdea: d.productIdea ?? '',
      title: d.title,
      body: d.body,
      metadata: d.metadata ?? {},
      score: d.score,
      target,
    };
  })
  .handler(async ({ data }): Promise<ImproveOutcome> => {
    console.log('[server.improveToScore]', data.contentType, 'old:', data.score.total, 'target:', data.target);
    // Phase 8.2 — Auto-Verbessern = 0 Generierungen; nur Drossel.
    try {
      const g = await usageGuard();
      const uid = await guardUserId();
      await g.assertRateOk(uid);
    } catch { /* ohne Sitzung unverändert laufen lassen */ }
    const { improveToScore } = await import('./improve');
    const outcome = await improveToScore(
      { contentType: data.contentType, productIdea: data.productIdea },
      {
        contentType: data.contentType,
        title: data.title,
        body: data.body,
        metadata: data.metadata,
        score: data.score,
      },
      data.score,
      data.target,
    );
    console.log(
      '[server.improveToScore] outcome:',
      outcome.improved ? `improved ${outcome.oldScore?.total} → ${outcome.newScore?.total}` : outcome.reason,
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
    // Phase 8.2 — bereichsgenaues Auto-Verbessern = 0 Generierungen; nur Drossel.
    try {
      const g = await usageGuard();
      const uid = await guardUserId();
      await g.assertRateOk(uid, { lang: data.lang });
    } catch { /* ohne Sitzung unverändert laufen lassen */ }
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
    // Phase 8.2 — Varianten: 1 OpenAI-Aufruf = 1 Generierung (Guard+Drossel).
    const g = await usageGuard();
    const userId = await guardUserId();
    await g.assertRateOk(userId, { lang: data.lang });
    const { generateVariants } = await import('./variants');
    const original: ContentResult = {
      contentType: data.contentType,
      title: data.currentTitle,
      body: data.currentBody,
      metadata: data.metadata,
    };
    // FIX-BLOCK 1: Der A/B-Abruf ist ein vollwertiges neues LLM-Ergebnis und
    // zählt 1 Generierung — er läuft deshalb durch DIESELBE konditionale
    // Guard-Kette wie alle anderen Pfade (Reservierung vor dem Call,
    // Kompensation bei Fehler, Limit blockiert den Call).
    let result: VariantsResult | null = null;
    try {
      result = await g.withGenerationGuard(
        userId,
        async () => {
          const r = await generateVariants(
            {
              contentType: data.contentType,
              productIdea: data.productIdea,
              strategyContext: data.strategyContext,
            },
            original,
            data.lang,
          );
          // Die Engine liefert bei Fehlern `null` statt zu werfen. Damit
          // „1 Generierung = 1 fertiges Ergebnis" gilt, wird dieser Fall wie ein
          // Fehler behandelt: der Guard kompensiert (netto 0 Verbrauch) und das
          // Ledger schreibt keinen Verbrauch.
          if (!r) throw new VariantGenerationUnavailable();
          return r;
        },
        data.lang,
        { action: 'ab_variants', detail: String(data.contentType) },
      );
    } catch (err) {
      if (err instanceof VariantGenerationUnavailable) {
        result = null; // bisheriges Verhalten: nie blockieren, Original bleibt
      } else {
        throw err; // UsageLimitError/Rate-Limit müssen beim Client ankommen
      }
    }
    console.log(
      '[server.generateVariants] outcome:',
      result ? `${result.variants.length} variants scored` : 'null (failed, Einheit freigegeben)',
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
    // Phase 8.2 — Priorisierung = Analyse = 0 Generierungen; nur Drossel.
    try {
      const g = await usageGuard();
      const uid = await guardUserId();
      await g.assertRateOk(uid, { lang: data.lang });
    } catch { /* ohne Sitzung unverändert laufen lassen */ }
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
 * F10 persist ONE like/dislike signal for a generated asset. The asset
 * snapshot (title/body/channel) is used for the deterministic classification
 * (tone/format/channel) — no DB lookup needed, so even fresh unsaved content
 * can be rated. Returns the updated preference view (never throws).
 */
export const recordFeedbackServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as {
      userId?: unknown;
      assetId?: unknown;
      kind?: unknown;
      reason?: unknown;
      title?: unknown;
      body?: unknown;
      channel?: unknown;
    };
    if (!d || typeof d !== 'object' || typeof d.userId !== 'string' || !d.userId) {
      throw new Error('userId is required');
    }
    if (typeof d.assetId !== 'string' || !d.assetId) throw new Error('assetId is required');
    if (d.kind !== 'like' && d.kind !== 'dislike') throw new Error('kind must be like or dislike');
    return {
      userId: d.userId,
      assetId: d.assetId,
      kind: d.kind as 'like' | 'dislike',
      reason: typeof d.reason === 'string' && d.reason.trim() ? d.reason.trim() : undefined,
      title: typeof d.title === 'string' ? d.title : undefined,
      body: typeof d.body === 'string' ? d.body : undefined,
      channel: typeof d.channel === 'string' ? d.channel : undefined,
    };
  })
  .handler(async ({ data }): Promise<UserPreferencesView | null> => {
    console.log('[server.recordFeedback]', data.kind, data.assetId.slice(0, 12), 'user:', data.userId.slice(0, 12));
    const { recordFeedback } = await import('./learning');
    return recordFeedback(data.userId, data.assetId, data.kind, {
      reason: data.reason,
      title: data.title,
      body: data.body,
      channel: data.channel,
    });
  });

/**
 * F10 full preference profile for one user: counters, data-sufficiency gate
 * and the derived preferred tone/format/channel. Deterministic — no LLM. Also
 * used internally by the generation loop (buildLearningProfile).
 */
export const getPreferencesServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as { userId?: unknown };
    if (!d || typeof d !== 'object' || typeof d.userId !== 'string' || !d.userId) {
      throw new Error('userId is required');
    }
    return { userId: d.userId };
  })
  .handler(async ({ data }): Promise<UserPreferencesView> => {
    console.log('[server.getPreferences] user:', data.userId.slice(0, 12));
    const { buildLearningProfile } = await import('./learning');
    return buildLearningProfile(data.userId);
  });

/**
 * F10 reset the user's preferences (delete the row) — starts learning fresh.
 */
export const resetPreferencesServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as { userId?: unknown };
    if (!d || typeof d !== 'object' || typeof d.userId !== 'string' || !d.userId) {
      throw new Error('userId is required');
    }
    return { userId: d.userId };
  })
  .handler(async ({ data }): Promise<{ reset: boolean }> => {
    console.log('[server.resetPreferences] user:', data.userId.slice(0, 12));
    const { resetPreferences } = await import('./learning');
    const reset = await resetPreferences(data.userId);
    return { reset };
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
    // Phase 8.2 — Paket zählt pro Kanal (1/Kanal, nur erfolgreiche). Cookie-
    // Identität gewinnt vor payload-userId (Quota-Diebstahl-Schutz). Drossel +
    // Early-Fail, wenn das Kontingent komplett leer ist (kein Kernel-Verbrauch).
    const g = await usageGuard();
    // guardUserId: Session-Cookie gewinnt; Payload-Fallback für Normalnutzer.
    // Admin-/Owner-IDs werden NIE aus dem Request-Body akzeptiert (fail-closed,
    // Override nur über serverseitig verifizierte Session erreichbar).
    const userId = await guardUserId(data.userId);
    await g.assertRateOk(userId, { lang: data.lang });
    await g.assertCanGenerate(userId, data.lang);
    const { generateMarketingPackage } = await import('./package/package');
    const pkg = await generateMarketingPackage(data.productIdea, {
      lang: data.lang,
      brief: data.brief,
      userId,
    });
    const ok = Object.values(pkg.channels).filter(Boolean).length;
    console.log(
      '[server.generatePackage] done:',
      `${ok}/5 channels,`,
      'prioritized:', pkg.prioritized ? pkg.prioritized.ordered.map((i) => i.channel).join(' > ') : 'n/a',
    );
    return pkg;
  });

// ── Problem 2: Progressive Marketing-Paket (client-side streaming) ────────────
// Instead of one blocking call that waits for all 5 channels, the client:
//   1. fetchPackageKernelServer → shared kernel + context (fast, 1 LLM call),
//   2. generatePackageChannelServer × 5 in PARALLEL, rendering each the moment
//      its Promise resolves,
//   3. finalizePackagePrioritiesServer → deterministic F3 prioritization.
export const fetchPackageKernelServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as { productIdea?: unknown; lang?: unknown; brief?: unknown; userId?: unknown; brandContext?: unknown };
    if (!d || typeof d !== 'object') throw new Error('data is required');
    if (typeof d.productIdea !== 'string' || !d.productIdea.trim()) throw new Error('productIdea is required');
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
      // Phase 4.2 — Markenrahmen (client-seitig gebaut; leer = kein Profil/AUS).
      brandContext:
        typeof d.brandContext === 'string' && d.brandContext.trim()
          ? d.brandContext.slice(0, 8000)
          : undefined,
    };
  })
  .handler(async ({ data }) => {
    console.log('[server.fetchPackageKernel] idea:', data.productIdea.slice(0, 80));
    // Phase 8.2 — Kernel verbraucht KEINE Einheit (kein fertiges Ergebnis),
    // aber Drossel + Early-Fail bei leerem Kontingent (kein verbranntes LLM).
    const g = await usageGuard();
    // guardUserId: Session-Cookie gewinnt; Payload-Fallback für Normalnutzer.
    // Admin-/Owner-IDs werden NIE aus dem Request-Body akzeptiert (fail-closed).
    const userId = await guardUserId(data.userId);
    await g.assertRateOk(userId, { lang: data.lang });
    await g.assertCanGenerate(userId, data.lang);
    const { preparePackageContext } = await import('./package/package');
    return preparePackageContext(data.productIdea, {
      lang: data.lang,
      brief: data.brief,
      userId,
      brandContext: data.brandContext, // Phase 4.2 — gleiches Kontext-Modell wie Einzel-Kanäle
    });
  });
export const generatePackageChannelServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as { productIdea?: unknown; contentType?: unknown; context?: unknown; brandContext?: unknown; grounding?: unknown };
    if (!d || typeof d !== 'object') throw new Error('data is required');
    if (typeof d.productIdea !== 'string' || !d.productIdea.trim()) throw new Error('productIdea is required');
    const ct = d.contentType;
    const allowed: ContentType[] = ['pinterest_pin', 'etsy_listing', 'seo_blog', 'social_post', 'email_newsletter'];
    if (typeof ct !== 'string' || !(allowed as string[]).includes(ct)) throw new Error('contentType is required');
    // Phase 4.2 — Markenrahmen der Kanäle (kommt aus dem Kernel-Prep; der
    // Client schickt ihn erneut mit, damit er auch bei direktem Kanal-Aufruf
    // gilt). Leer = kein Markenprofil aktiv.
    const brandContext =
      typeof d.brandContext === 'string' && d.brandContext.trim() ? d.brandContext.slice(0, 8000) : '';
    // Stabilisierung Schritt 2, Punkt 5: NUR die Nutzerangaben aus dem Kernel-Prep
    // (Idee + Markenprofil + F6-Brief) sind Grounding — Kernel/F9/F10 nicht.
    const grounding = typeof d.grounding === 'string' && d.grounding.trim() ? d.grounding.slice(0, 12000) : '';
    return {
      productIdea: d.productIdea.trim(),
      contentType: ct as ContentType,
      context: [brandContext, typeof d.context === 'string' ? d.context : ''].filter(Boolean).join('\n\n'),
      grounding: [d.productIdea.trim(), grounding, brandContext].filter(Boolean).join('\n'),
    };
  })
  .handler(async ({ data }) => {
    console.log('[server.generatePackageChannel] channel:', data.contentType);
    // Phase 8.2 — Kanal = 1 Generierung (nur bei Erfolg). KEINE Drossel hier:
    // der progressive Paket-Flow feuert 5 Kanäle parallel (2-s-Fenster würde
    // die Parallelität fälschlich blockieren — Drossel liegt im Kernel-Start).
    const g = await usageGuard();
    const userId = await guardUserId();
    const { generatePackageChannelWithContext } = await import('./package/package');
    return g.withGenerationGuard(
      userId,
      () =>
        generatePackageChannelWithContext(data.contentType, data.productIdea, data.context, data.grounding),
      'de',
      { action: 'package_channel', detail: String(data.contentType) },
    );
  });
export const finalizePackagePrioritiesServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as { channels?: unknown; lang?: unknown };
    if (!d || typeof d !== 'object') throw new Error('data is required');
    return {
      channels: (d.channels as Record<string, ContentResult | null>) ?? {},
      lang: (d.lang === 'en' ? 'en' : 'de') as 'de' | 'en',
    };
  })
  .handler(async ({ data }): Promise<PrioritizeOutcome | null> => {
    const { prioritizeChannelsSync } = await import('./prioritize');
    const assets: PrioritizeAsset[] = Object.entries(data.channels)
      .filter(([, c]) => c && typeof c === 'object' && 'title' in (c as object))
      .map(([key, c]) => {
        const cc = c as ContentResult;
        return { channel: key as ContentType, qualityScore: cc.score?.total ?? null, title: cc.title };
      });
    if (assets.length < 2) return null;
    return prioritizeChannelsSync(assets, data.lang);
  });
/**
 * TikTok-Bereich: eigenständige Server-Fn für die drei Modi (todayIdea /
 * concept / diagnose). Ruft die gleiche GPT-4o-Engine wie der Rest der App
 * (siehe src/ai/tiktok.ts) mit strukturiertem System-Prompt auf. `lang`
 * steuert die Ausgabesprache (de/en). Ergebnisse werden strukturiert als
 * TikTokResult zurückgegeben und im UI übersichtlich dargestellt (nicht
 * persistiert — bewusst additive Erweiterung, keine DB-Migration).
 */
export const generateTikTokServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as {
      mode?: unknown;
      biz?: unknown;
      brandContext?: unknown;
      history?: unknown;
      goal?: unknown;
      audience?: unknown;
      topic?: unknown;
      metrics?: unknown;
      lang?: unknown;
      projectContext?: unknown;
      previousDirection?: unknown;
      videoTopic?: unknown;
      videoHook?: unknown;
    };
    if (!d || typeof d !== 'object') throw new Error('data is required');
    const mode = d.mode as TikTokMode;
    if (mode !== 'todayIdea' && mode !== 'concept' && mode !== 'diagnose') {
      throw new Error('mode is required');
    }
    const brandContext =
      typeof d.brandContext === 'string' && d.brandContext.trim() ? d.brandContext.trim() : undefined;
    // Phase 4 — Projekt-Kontext validieren (optional, LESEND): kompakter
    // Faktenblock aus dem gewählten Projekt (title/productIdea/brief-Extrakt).
    // Nur vorhandene String-Felder werden übernommen (nie erfinden); leere
    // Blöcke werden verworfen (Flow verhält sich wie ohne Projekt).
    const projectContext =
      d.projectContext && typeof d.projectContext === 'object' && !Array.isArray(d.projectContext)
        ? (() => {
            const pc = d.projectContext as Record<string, unknown>;
            const str = (v: unknown, max: number): string | undefined => {
              if (typeof v !== 'string') return undefined;
              const t = v.trim();
              return t ? t.slice(0, max) : undefined;
            };
            const title = str(pc.title, 200);
            const productIdea = str(pc.productIdea, 4000);
            const brief = str(pc.brief, 6000);
            const projectId = str(pc.projectId, 64);
            if (!title && !productIdea && !brief) return undefined;
            return { projectId, title, productIdea, brief };
          })()
        : undefined;
    // biz ist Pflicht ODER ein (vollständiges) Markenprofil liefert die Fakten
    // via brandContext ODER das gewählte Projekt liefert sie via projectContext
    // (Phase 4 — „Mein Projekt“ statt Topic-Eingabe, nur lesend).
    if (typeof d.biz !== 'string' || !d.biz.trim()) {
      if (!brandContext && !projectContext) {
        throw new Error('biz (Unternehmensbeschreibung), ein Markenprofil oder ein Projekt ist erforderlich');
      }
    }
    const history = Array.isArray(d.history)
      ? d.history
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim())
          .slice(0, 10)
      : undefined;
    // Metriken 0-vs-fehlend: nur tatsächlich gelieferte Werte durchreichen —
    // eine Zahl 0 bleibt 0 (echte Info), ein fehlender/leerer Wert wird als
    // undefined weggelassen und taucht NICHT als 0 im Prompt auf.
    const metrics: TikTokInput['metrics'] =
      mode === 'diagnose' && d.metrics && typeof d.metrics === 'object'
        ? (() => {
            const m = d.metrics as Record<string, unknown>;
            const num = (v: unknown): number | undefined => {
              if (typeof v === 'number' && Number.isFinite(v)) return v;
              if (typeof v === 'string' && v.trim() !== '') {
                const n = Number(v);
                return Number.isFinite(n) ? n : undefined;
              }
              return undefined;
            };
            const text = (v: unknown): string | undefined =>
              typeof v === 'string' && v.trim() ? v.trim() : undefined;
            return {
              views: num(m.views),
              length: text(m.length),
              avgWatch: num(m.avgWatch),
              likes: num(m.likes),
              comments: num(m.comments),
              shares: num(m.shares),
              profileVisits: num(m.profileVisits),
            };
          })()
        : undefined;
    // Phase 3 — Pflichtfelder der Diagnose schärfen: views + length + avgWatch
    // müssen angegeben sein, damit die Diagnose mit Retentions-Daten läuft.
    // Fehlt etwas, wirft der Validator eine klare Meldung mit den exakten
    // fehlenden Feldern (kein Raten ohne Daten — Engine mufft ebenso ab).
    if (mode === 'diagnose') {
      const gaps = diagnoseRetentionGaps(metrics);
      if (gaps.length > 0) {
        const de = d.lang !== 'en';
        const labels: Record<string, string> = de
          ? { views: 'Aufrufe (Views)', length: 'Videolänge', avgWatch: 'durchschnittliche Wiedergabedauer' }
          : { views: 'Views', length: 'video length', avgWatch: 'average watch time' };
        const list = gaps.map((k) => labels[k]).join(', ');
        throw new Error(
          de
            ? `Für eine fundierte TikTok-Diagnose fehlen: ${list}. Bitte ergänze diese Angaben — ohne sie kann Growimo die Länge und den Aufbau nicht mit Zahlen belegen (Growimo rät bewusst nicht).`
            : `A grounded TikTok diagnosis needs: ${list}. Please add them — without them Growimo cannot back the length/structure recommendation with numbers (it deliberately does not guess).`,
        );
      }
    }
    return {
      mode,
      biz: typeof d.biz === 'string' ? d.biz.trim() : '',
      brandContext,
      history,
      goal: typeof d.goal === 'string' && d.goal.trim() ? d.goal.trim() : undefined,
      audience: typeof d.audience === 'string' && d.audience.trim() ? d.audience.trim() : undefined,
      topic: typeof d.topic === 'string' && d.topic.trim() ? d.topic.trim() : undefined,
      metrics,
      projectContext,
      // Diversität (todayIdea, optional): zuletzt verwendete Content-Richtung —
      // von der Engine deterministisch ausgeschlossen, damit die Folge-Idee
      // eine andere Richtung nimmt. Fehlt der Parameter (Fallback ohne
      // Client-Änderung), wählt die Engine selbst deterministisch.
      previousDirection:
        typeof d.previousDirection === 'string' && d.previousDirection.trim()
          ? d.previousDirection.trim()
          : undefined,
      // Diagnose v2 — Video-Thema/Hook optional durchreichen (nur present
      // values, getrimmt, max. 500 Zeichen; KEIN Pflichtfeld — leere/fehlende
      // Eingaben bleiben undefined, die Engine erfindet dann kein Thema).
      videoTopic:
        typeof d.videoTopic === 'string' && d.videoTopic.trim()
          ? d.videoTopic.trim().slice(0, 500)
          : undefined,
      videoHook:
        typeof d.videoHook === 'string' && d.videoHook.trim()
          ? d.videoHook.trim().slice(0, 500)
          : undefined,
      lang: (d.lang === 'en' ? 'en' : 'de') as 'de' | 'en',
    };
  })
  .handler(async ({ data }): Promise<TikTokResult> => {
    console.log('[server.generateTikTok]', data.mode, 'lang:', data.lang, 'biz:', data.biz.slice(0, 60));
    // Phase 8.2 — todayIdea/concept = je 1 Generierung (nur bei Erfolg).
    // FIX-BLOCK 1 (Owner-Auftrag 2026-10-08, verbindlich): Die Diagnose v2 ist
    // eine vollwertige LLM-Generierung mit neuem Ergebnis (NEUE VIDEO-VERSION)
    // und zählt deshalb ebenfalls 1 Generierung — zuvor umging sie den
    // Kostenschutz komplett (Kostenleck, live belegt). Drossel gilt für alle.
    const g = await usageGuard();
    const userId = await guardUserId();
    await g.assertRateOk(userId, { lang: data.lang });
    const { generateTikTok, TIKTOK_TIMEOUT_MS } = await import('./tiktok');
    // Phase 5 — Server-seitiges Timeout: der TikTok-Aufruf (1 blockierender Call
    // mit bis zu 4 Retries) darf höchstens TIKTOK_TIMEOUT_MS laufen. Bei Ablauf
    // bricht das Signal die Retry-Schleife ab und die Engine liefert eine
    // ehrliche Fehlermeldung statt eines Hängers. Bewusst < Client-Timeout
    // (90 s), damit die saubere Antwort vor dem Client-Timeout ankommt.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIKTOK_TIMEOUT_MS);
    try {
      // FIX-BLOCK 1: alle drei TikTok-Modi (todayIdea / concept / diagnose)
      // laufen durch denselben konditionalen Guard — je 1 Generierung, nur bei
      // Erfolg, Limit blockiert den Call, Owner-Override unverändert unbegrenzt.
      // Die Aktion landet im usage_events-Ledger (Zuordenbarkeit der Zähler-Zeile).
      const action =
        data.mode === 'diagnose'
          ? 'tiktok_diagnose'
          : data.mode === 'todayIdea'
            ? 'tiktok_todayidea'
            : 'tiktok_concept';
      return await g.withGenerationGuard(
        userId,
        () => generateTikTok(data, data.lang, ctrl.signal),
        data.lang,
        { action, detail: data.mode },
      );
    } finally {
      clearTimeout(timer);
    }
  });
