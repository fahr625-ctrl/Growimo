// ── F8 Veröffentlichungs-Kalender: deterministische Plan-Regeln ──────────────
// buildPublishPlan() is a pure, synchronous, deterministic function — NO LLM,
// NO network. Given a user's generated contents it:
//   1. groups assets by project,
//   2. reuses the F3 rankAssets() ranking per project (channel character + F1
//      quality score — the exact same order the user saw in "Publish first"),
//   3. distributes the ranked items over the next days:
//        scheduledDate = today + (rank + channelDelay) days
//      where channelDelay nudges the cadence: Pinterest/social publish early
//      (fast feedback), Etsy/newsletter in the middle, the SEO blog last-ish
//      (Google needs time to index & rank — but still scheduled early enough
//      that it can compound). The rank dominates, so the priority order is
//      preserved: an item can never overtake a higher-ranked one.
//   4. attaches a best-time key (channel profile) and 3–6 concrete publish
//      tasks per item (see tasks.ts).
// Never throws: assets without a score or unknown channels are skipped, and a
// project with <2 ranked channels simply contributes nothing.
import type {
  ContentType,
  PublishPlan,
  PublishPlanItem,
  PrioritizeAsset,
  PublishTask,
} from '../types';
import { rankAssets, CHANNEL_PROFILES, priorityScoreFor, hasProfile } from '../prioritize/rules';
import { publishTasks } from './tasks';

export const PUBLISH_PLAN_RULE_VERSION = 1;

/** Input row: everything buildPublishPlan needs about one generated asset. */
export interface PlanAssetInput {
  projectId: string;
  projectTitle: string;
  channel: ContentType;
  assetId: string;
  title: string;
  /** F1 score 0–100, or null when scoring is missing/unsupported. */
  qualityScore: number | null;
  /** Raw asset body (used to embed real data into tasks). */
  body?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Deterministic cadence per channel: extra days added on top of the rank.
 * Pinterest & social → 0 (fast feedback wins), Etsy & newsletter → +1,
 * SEO blog → +2 (slow burn: start it, then let Google catch up).
 * Documented in the F8 plan card so users can follow the logic.
 */
export const CHANNEL_DAY_DELAY: Record<string, number> = {
  pinterest_pin: 0,
  social_post: 0,
  etsy_listing: 1,
  email_newsletter: 1,
  seo_blog: 2,
};

/**
 * Best-publishing-time semantic key per publishable channel. The UI maps these
 * to localized strings (publish_plan_time_* i18n keys); storing the key (not a
 * translated sentence) keeps the plan language-independent.
 */
export const CHANNEL_BEST_TIME: Record<string, string> = {
  pinterest_pin: 'pinterest', // abends (Sa 20–23 Uhr, So 14–16 Uhr)
  etsy_listing: 'etsy', // nachmittags (Di–Do 10–14 Uhr)
  seo_blog: 'blog', // morgens (Mo–Mi bis 9 Uhr)
  social_post: 'social', // Mi 11 Uhr, Fr 14 Uhr
  email_newsletter: 'newsletter', // Mi 11 Uhr, Fr 14 Uhr
};

/** Extract the F1 quality score from a stored content row (metadata.score.total). */
export function qualityFromMetadata(
  metadata: Record<string, unknown> | undefined,
): number | null {
  const s = metadata?.score;
  if (s && typeof s === 'object' && typeof (s as { total?: unknown }).total === 'number') {
    return (s as { total: number }).total;
  }
  return null;
}

/** YYYY-MM-DD (local time) for "today + offsetDays". */
function dateInDays(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Build the deterministic publish plan for a user's generated contents.
 * Pure function — call it server-side (buildPublishPlanServer) or in tests.
 * @returns items sorted by (scheduledDate, priorityScore desc) — never throws.
 */
export function buildPublishPlan(
  userContent: PlanAssetInput[],
  opts: { lang?: 'de' | 'en' } = {},
): PublishPlan {
  const lang: 'de' | 'en' = opts.lang === 'en' ? 'en' : 'de';
  const items: PublishPlanItem[] = [];
  // Group by project (stable order: insertion order of the input list).
  const byProject = new Map<string, PlanAssetInput[]>();
  for (const c of userContent) {
    if (!c.assetId || !hasProfile(c.channel)) continue;
    const list = byProject.get(c.projectId) ?? [];
    list.push(c);
    byProject.set(c.projectId, list);
  }
  for (const [projectId, assets] of byProject) {
    const projectTitle = assets[0]?.projectTitle ?? projectId;
    // Reuse the F3 deterministic ranking — the SAME order the user saw on the
    // project detail page (channel base + F1 quality, no LLM).
    const prioritized: PrioritizeAsset[] = assets.map((a) => ({
      channel: a.channel,
      assetId: a.assetId,
      qualityScore: a.qualityScore,
      title: a.title,
    }));
    const ordered = rankAssets(prioritized, lang);
    if (!ordered) continue; // <2 scored publishable channels → no plan for this project
    for (const p of ordered) {
      const asset = assets.find((a) => a.assetId === p.assetId);
      if (!asset) continue;
      const delay = CHANNEL_DAY_DELAY[p.channel] ?? 0;
      const tasks: PublishTask[] = publishTasks({
        channel: p.channel,
        title: asset.title,
        body: asset.body ?? '',
        metadata: asset.metadata,
        lang,
      });
      items.push({
        id: p.assetId as string,
        projectId,
        projectTitle,
        channel: p.channel,
        assetId: p.assetId as string,
        title: asset.title,
        qualityScore: p.qualityScore,
        priorityScore: p.priorityScore,
        rank: p.rank,
        scheduledDate: dateInDays(p.rank + delay),
        bestTime: CHANNEL_BEST_TIME[p.channel] ?? 'social',
        rationale: p.rationale,
        tasks,
      });
    }
  }
  // Global sort: earliest date first, then highest priority — a flat, scannable
  // "what do I publish when" list across all projects.
  items.sort(
    (a, b) =>
      a.scheduledDate.localeCompare(b.scheduledDate) ||
      b.priorityScore - a.priorityScore ||
      a.rank - b.rank,
  );
  return {
    items,
    generatedAt: new Date().toISOString(),
    ruleVersion: PUBLISH_PLAN_RULE_VERSION,
  };
}

/** Export a few helpers for tests / UI reuse. */
export { priorityScoreFor, CHANNEL_PROFILES };
