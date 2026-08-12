// ── F8 Veröffentlichungs-Kalender: Abhak-Aufgaben je geplantem Item ──────────
// publishTasks() returns 3–6 concrete checklist tasks for one scheduled item.
// Reuse policy: Pinterest / Etsy / SEO have F5 action plans with REAL asset
// data embedded (title, keywords, CTA, tags, meta …) — we take the first
// concrete steps from buildActionPlan (condensed to ≤4) and append a final
// "publish" task, so the F5 logic is reused, not duplicated. Social posts and
// newsletters have no action plan builder; they get template tasks that still
// embed the real asset title / hook / hashtags.
//
// Task labels are built from the i18n dictionaries (publish_task_* keys) with
// {title}/{hook}/{tags} placeholders, so labels exist in de AND en. Pure
// function, never throws, no LLM.
import type { ContentType, PublishTask } from '../types';
import { de } from '~/i18n/de';
import { en } from '~/i18n/en';
import { buildActionPlan } from '../action-plans';
import type { ActionPlanStep } from '../action-plans/rules';

export interface TaskAssetInput {
  channel: ContentType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  lang?: 'de' | 'en';
}
type Lang = 'de' | 'en';

function clean(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/^[\s"„“»«''"]+|[\s"„“»«''"]+$/g, '').trim();
}
function metaStr(meta: Record<string, unknown> | undefined, key: string): string {
  const v = meta?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}
function metaList(meta: Record<string, unknown> | undefined, key: string): string[] {
  const v = meta?.[key];
  if (Array.isArray(v)) return v.map((x) => clean(String(x))).filter(Boolean).slice(0, 4);
  return [];
}
function shortTitle(title: string): string {
  const t = clean(title);
  return t.slice(0, 60) + (t.length > 60 ? '…' : '');
}

/** Localized dictionary access + placeholder replacement. */
function dict(lang: Lang): typeof de {
  return lang === 'en' ? en : de;
}
function label(lang: Lang, key: keyof typeof de, vars?: Record<string, string>): string {
  const raw: unknown = dict(lang)[key];
  let s = typeof raw === 'string' ? raw : '';
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v ?? '');
  return s;
}
function task(n: number, lang: Lang, key: keyof typeof de, vars?: Record<string, string>): PublishTask {
  return { id: `t${n}`, label: label(lang, key, vars), done: false };
}

/** Condense F5 action-plan steps into ≤4 tasks (they already embed real data). */
function tasksFromActionPlan(input: TaskAssetInput): PublishTask[] {
  try {
    const plan = buildActionPlan({
      channel: input.channel,
      title: input.title,
      body: input.body,
      metadata: input.metadata,
    });
    if (!plan) return [];
    const steps = plan.plan.slice(0, 4);
    return steps.map((s: ActionPlanStep, i: number) =>
      task(i + 1, input.lang ?? 'de', 'publish_task_action', {
        action: s.action,
        detail: s.detail,
      }),
    );
  } catch {
    return [];
  }
}

const FINAL_TASKS: Record<string, (input: TaskAssetInput) => PublishTask> = {
  pinterest_pin: (input) =>
    task(5, input.lang ?? 'de', 'publish_task_pin_publish', { title: shortTitle(input.title) }),
  etsy_listing: (input) =>
    task(5, input.lang ?? 'de', 'publish_task_etsy_activate', { title: shortTitle(input.title) }),
  seo_blog: (input) =>
    task(5, input.lang ?? 'de', 'publish_task_blog_publish', { title: shortTitle(input.title) }),
};

// ── Social post (no F5 builder → template with real title/hook/hashtags) ─────
function socialTasks(input: TaskAssetInput): PublishTask[] {
  const lang = input.lang ?? 'de';
  const title = shortTitle(input.title);
  const hook = clean(metaStr(input.metadata, 'hook') || input.body.split('\n')[0]?.slice(0, 80) || '');
  const hashtags = metaList(input.metadata, 'hashtags');
  const tags = hashtags.length > 0 ? hashtags.join(' ') : '#produkt #neu';
  return [
    task(1, lang, 'publish_task_social_create', { hook: hook.slice(0, 60) }),
    task(2, lang, 'publish_task_social_tags', { tags }),
    task(3, lang, 'publish_task_social_media'),
    task(4, lang, 'publish_task_social_publish', { title }),
  ];
}
// ── Newsletter (no F5 builder → template with real subject) ──────────────────
function newsletterTasks(input: TaskAssetInput): PublishTask[] {
  const lang = input.lang ?? 'de';
  const title = shortTitle(input.title);
  return [
    task(1, lang, 'publish_task_mail_create', { title }),
    task(2, lang, 'publish_task_mail_subject'),
    task(3, lang, 'publish_task_mail_list'),
    task(4, lang, 'publish_task_mail_test'),
    task(5, lang, 'publish_task_mail_send'),
  ];
}

/**
 * 3–6 checkable publish tasks for one scheduled item.
 * Never throws; falls back to a minimal generic list on any error.
 */
export function publishTasks(input: TaskAssetInput): PublishTask[] {
  const lang = input.lang ?? 'de';
  try {
    if (input.channel === 'social_post') return socialTasks(input);
    if (input.channel === 'email_newsletter') return newsletterTasks(input);
    // pinterest / etsy / seo: reuse F5 action plan steps + final publish task
    const fromPlan = tasksFromActionPlan(input);
    if (fromPlan.length >= 3) {
      const final = FINAL_TASKS[input.channel];
      if (final) return [...fromPlan.slice(0, 4), final(input)].slice(0, 6);
      return fromPlan.slice(0, 6);
    }
    // Fallback (F5 unavailable): still embed the real title.
    const title = shortTitle(input.title);
    if (input.channel === 'pinterest_pin') {
      return [
        task(1, lang, 'publish_task_pin_create', { title }),
        task(2, lang, 'publish_task_pin_desc'),
        task(3, lang, 'publish_task_pin_image'),
        task(4, lang, 'publish_task_pin_publish', { title }),
      ];
    }
    if (input.channel === 'etsy_listing') {
      return [
        task(1, lang, 'publish_task_etsy_create', { title }),
        task(2, lang, 'publish_task_etsy_desc'),
        task(3, lang, 'publish_task_etsy_shop'),
        task(4, lang, 'publish_task_etsy_activate', { title }),
      ];
    }
    return [
      task(1, lang, 'publish_task_blog_publish', { title }),
      task(2, lang, 'publish_task_blog_meta'),
      task(3, lang, 'publish_task_blog_links'),
      task(4, lang, 'publish_task_blog_submit'),
    ];
  } catch {
    return [task(1, lang, 'publish_task_fallback', { title: shortTitle(input.title) })];
  }
}
