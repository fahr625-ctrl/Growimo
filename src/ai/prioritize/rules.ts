// ── F3 deterministic priority rules ──────────────────────────────────────────
// The DECISION is made here, deterministically, from two signals:
//   1. Channel character (speed / effort / impact) — the base priority.
//   2. The existing F1 Qualitäts-Score of the generated asset — a modifier.
// The LLM (see llm.ts) is only allowed to rephrase the WHY, never the order.
//
// Channel characters (owner-aligned):
//   pinterest_pin    fast feedback, low effort, visual discovery
//   social_post      fast feedback, low effort, engagement
//   etsy_listing     direct sales, buyer intent, medium effort
//   email_newsletter existing audience, engagement, medium effort
//   seo_blog         slow burn, compound, high effort
//
// Only these five are publishable channels; marketing plans / product ideas /
// analyses are not "published" and are excluded from the ranking.

import type { ContentType, PriorityItem, PriorityTag, PrioritizeAsset } from '../types';

export const PRIORITIZE_RULE_VERSION = 1;

export type Lang = 'de' | 'en';

export interface ChannelProfile {
  /** Deterministic base priority 0–100 from the channel character. */
  base: number;
  speed: 'fast' | 'medium' | 'slow';
  effort: 'low' | 'medium' | 'high';
  impact: 'direct' | 'compound' | 'engagement';
  /** Stable reason tags the UI translates. */
  tags: PriorityTag[];
  /** Fallback rationale — used when the LLM phrasing pass is unavailable. */
  rationale: Record<Lang, string>;
}

export const CHANNEL_PROFILES: Record<string, ChannelProfile> = {
  pinterest_pin: {
    base: 88,
    speed: 'fast',
    effort: 'low',
    impact: 'direct',
    tags: ['fast-feedback', 'low-effort', 'visual', 'discovery'],
    rationale: {
      de: 'Pinterest zuerst: schnellster Feedback-Loop, dein Produkt ist visuell und der Aufwand niedrig — nur Pin-Bild und Beschreibung nötig.',
      en: 'Pinterest first: the fastest feedback loop, your product is visual and the effort is low — only a pin image and description are needed.',
    },
  },
  social_post: {
    base: 80,
    speed: 'fast',
    effort: 'low',
    impact: 'engagement',
    tags: ['fast-feedback', 'low-effort', 'engagement'],
    rationale: {
      de: 'Social-Post als Zweites: schnell gepostet, baut Reichweite auf und liefert direktes Feedback von deiner Community.',
      en: 'Social post next: quick to publish, builds reach and gives direct feedback from your community.',
    },
  },
  etsy_listing: {
    base: 74,
    speed: 'medium',
    effort: 'medium',
    impact: 'direct',
    tags: ['direct-sales', 'buyer-intent', 'low-effort'],
    rationale: {
      de: 'Etsy-Listing: braucht nur die Bilder, die du schon hast, und trifft Leute mit Kaufabsicht — dein direktester Verkaufskanal.',
      en: 'Etsy listing: it only needs the images you already have and reaches people with buying intent — your most direct sales channel.',
    },
  },
  email_newsletter: {
    base: 66,
    speed: 'medium',
    effort: 'medium',
    impact: 'engagement',
    tags: ['existing-audience', 'engagement'],
    rationale: {
      de: 'Newsletter: spricht deine bestehende Zielgruppe an und festigt die Bindung — aber erst sinnvoll, wenn du schon Reichweite aufgebaut hast.',
      en: 'Newsletter: speaks to your existing audience and deepens the relationship — but only useful once you have built some reach.',
    },
  },
  seo_blog: {
    base: 48,
    speed: 'slow',
    effort: 'high',
    impact: 'compound',
    tags: ['compound', 'slow-burn'],
    rationale: {
      de: 'SEO-Blog: wirkt langfristig und braucht 4–6 Wochen, bis er rankt — früh starten (Google muss den Artikel erst finden), aber nicht zuerst Ergebnisse erwarten.',
      en: 'SEO blog: compounds long-term but needs 4–6 weeks to rank — start it early (Google must discover it first), but do not expect results immediately.',
    },
  },
};

/** Only these content types are publishable channels. */
export const PUBLISHABLE_CHANNELS: ContentType[] = [
  'pinterest_pin',
  'social_post',
  'etsy_listing',
  'email_newsletter',
  'seo_blog',
];

export function hasProfile(channel: ContentType): boolean {
  return Boolean(CHANNEL_PROFILES[channel]);
}

/** Combined priority: channel base + F1 quality modifier. Never exceeds 0–100. */
export function priorityScoreFor(channel: ContentType, quality: number | null): number {
  const base = CHANNEL_PROFILES[channel]?.base ?? 0;
  const adjustment = quality == null ? 0 : (quality - 60) * 0.25;
  return Math.max(0, Math.min(100, Math.round(base + adjustment)));
}

/** Extra tags derived from the asset's quality score. */
export function qualityTags(quality: number | null): PriorityTag[] {
  if (quality == null) return [];
  if (quality >= 80) return ['strong-score'];
  if (quality < 55) return ['weak-score', 'improve-first'];
  return [];
}

function channelLabel(channel: ContentType, lang: Lang): string {
  const labels: Record<string, Record<Lang, string>> = {
    pinterest_pin: { de: 'Pinterest-Pin', en: 'Pinterest pin' },
    social_post: { de: 'Social-Media-Beitrag', en: 'Social media post' },
    etsy_listing: { de: 'Etsy-Listing', en: 'Etsy listing' },
    email_newsletter: { de: 'E-Mail-Newsletter', en: 'Email newsletter' },
    seo_blog: { de: 'SEO-Blogartikel', en: 'SEO blog post' },
  };
  return labels[channel]?.[lang] ?? channel;
}

/** Quality-aware suffix appended to the template rationale (fallback path). */
function qualitySuffix(quality: number | null, lang: Lang): string {
  if (quality == null) return '';
  if (quality >= 80) {
    return lang === 'de'
      ? ` Der Qualitäts-Score ist stark (${quality}/100) — sofort veröffentlichungsreif.`
      : ` The quality score is strong (${quality}/100) — ready to publish now.`;
  }
  if (quality < 55) {
    return lang === 'de'
      ? ` Der Score (${quality}/100) ist noch schwach — vorher mit „Verbessern“ nachschärfen.`
      : ` The score (${quality}/100) is still weak — sharpen it with “Improve” first.`;
  }
  return '';
}

/**
 * Deterministic ranking. Never throws. Filters to publishable channels with a
 * known quality score; returns null when fewer than 2 such assets exist (the
 * card must only appear with ≥2 scored channels).
 */
export function rankAssets(
  assets: PrioritizeAsset[],
  lang: Lang = 'de',
): PriorityItem[] | null {
  const ranked = assets
    .filter((a) => a.qualityScore != null && hasProfile(a.channel))
    .map((a) => {
      const profile = CHANNEL_PROFILES[a.channel];
      const quality = a.qualityScore as number;
      return {
        channel: a.channel,
        assetId: a.assetId,
        qualityScore: quality,
        priorityScore: priorityScoreFor(a.channel, quality),
        rationale:
          profile.rationale[lang] + qualitySuffix(quality, lang),
        reasonTags: [...profile.tags, ...qualityTags(quality)],
      };
    });

  if (ranked.length < 2) return null;

  ranked.sort(
    (x, y) =>
      y.priorityScore - x.priorityScore ||
      (CHANNEL_PROFILES[y.channel]?.base ?? 0) -
        (CHANNEL_PROFILES[x.channel]?.base ?? 0) ||
      x.channel.localeCompare(y.channel),
  );

  return ranked.map((item, i) => ({ ...item, rank: i + 1 }));
}

/** Fallback one-sentence summary built from the ranked channels. */
export function templateSummary(ordered: PriorityItem[], lang: Lang): string {
  const label = (channel: ContentType) => channelLabel(channel, lang);
  const [first, second, ...rest] = ordered;
  if (!first || !second) return '';
  const chain = [first, second, ...rest].map((i) => label(i.channel)).join(', dann ');
  return lang === 'de'
    ? `Publiziere zuerst ${chain} — so bekommst du am schnellsten Feedback und erste Ergebnisse.`
    : `Publish ${chain} first — that way you get feedback and first results fastest.`;
}

export { channelLabel };
