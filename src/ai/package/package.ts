// ── F4 Komplettes Marketing-Paket: Orchestrierung ─────────────────────────────
// generateMarketingPackage() is the package pipeline:
//   kernel (1 LLM call) → 5 channel generations (existing generators + kernel
//   context, each with F1 score) → F3 prioritization (deterministic rankAssets).
//
// Failure isolation: a failing channel is skipped (channels[key] = null) and
// the others keep running — the package never blocks. The kernel itself never
// throws (fallback kernel). Prioritization is the deterministic sync variant
// (rankAssets + template wording) so it adds ZERO LLM calls to the budget.
//
// Cost per package: 1 kernel + 5 generations + 5 score passes (no extra LLM).

import type { ContentResult, ContentType, PrioritizeOutcome } from '../types';
import { determineKernel, isFallbackKernel, type MarketingKernel } from './kernel';
import { generatePackageChannel, PACKAGE_CHANNELS } from './generate';
import { prioritizeChannelsSync } from '../prioritize';
import { buildBriefContext } from '../strategy-brief/questions';

export interface PackageChannelResult {
  pinterest: ContentResult | null;
  etsy: ContentResult | null;
  seo: ContentResult | null;
  social: ContentResult | null;
  newsletter: ContentResult | null;
}

export interface MarketingPackage {
  /** Shared strategic kernel — the consistency backbone of the package. */
  kernel: MarketingKernel;
  /** One scored ContentResult per channel; null when a channel failed. */
  channels: PackageChannelResult;
  /** F3 "was zuerst publizieren" outcome (deterministic rankAssets). */
  prioritized: PrioritizeOutcome | null;
  lang: 'de' | 'en';
  /** true when the kernel came from the fallback (LLM kernel call failed). */
  kernelFallback: boolean;
}

export interface PackageOptions {
  lang?: 'de' | 'en';
  /** Optional F6 Strategy-Brief answers (empty when F6 is not implemented). */
  brief?: Record<string, string> | null;
  /**
   * F9: user id — when present, the user's performance insights are loaded
   * (deterministic analysis, never blocks) and flow as context into every
   * channel generation. Empty when no performance data exists yet.
   */
  userId?: string;
}

/**
 * Generate a complete, coordinated marketing package for ONE product idea.
 * Never throws for a single failing channel — it is skipped individually.
 */
export async function generateMarketingPackage(
  productIdea: string,
  opts: PackageOptions = {},
): Promise<MarketingPackage> {
  const lang: 'de' | 'en' = opts.lang === 'en' ? 'en' : 'de';

  // 1. Shared kernel first — everything else builds on it. The F6 brief
  //    (optional) steers the kernel; empty brief behaves exactly like F4.
  const kernel = await determineKernel(productIdea, opts.brief ?? null);
  const kernelFallback = isFallbackKernel(kernel);

  // F6: brief context for every channel request (additionalContext).
  const briefContext = buildBriefContext(opts.brief ?? null, lang);

  // F9: performance insights as context — never blocking (error → empty).
  let perfContext = '';
  if (opts.userId) {
    try {
      const { buildPerformanceOverview } = await import('../performance');
      const { buildPerformanceContext } = await import('../performance/context');
      const overview = await buildPerformanceOverview(opts.userId, { lang });
      perfContext = buildPerformanceContext(overview, lang);
      if (perfContext) console.log('[package] performance context injected into channels');
    } catch (err) {
      console.error('[package] performance context skipped:', err);
      perfContext = '';
    }
  }

  // 2. All five channels in parallel; each failure is isolated.
  const channels: PackageChannelResult = {
    pinterest: null,
    etsy: null,
    seo: null,
    social: null,
    newsletter: null,
  };

  await Promise.all(
    PACKAGE_CHANNELS.map(async ({ key, contentType }) => {
      try {
        channels[key as keyof PackageChannelResult] = await generatePackageChannel(
          kernel,
          contentType,
          productIdea,
          briefContext,
          perfContext,
        );
      } catch (err) {
        console.error(`[package] channel ${contentType} failed — skipped:`, err);
        channels[key as keyof PackageChannelResult] = null;
      }
    }),
  );

  const ok = Object.values(channels).filter(Boolean).length;
  console.log(`[package] generated ${ok}/5 channels`);

  // 3. F3 prioritization from the scored channels (deterministic — 0 LLM calls).
  const assets = PACKAGE_CHANNELS.filter(({ key }) => channels[key as keyof PackageChannelResult])
    .map(({ key, contentType }) => {
      const c = channels[key as keyof PackageChannelResult] as ContentResult;
      return {
        channel: contentType,
        qualityScore: c.score?.total ?? null,
        title: c.title,
      };
    });
  const prioritized = prioritizeChannelsSync(assets, lang);

  return { kernel, channels, prioritized, lang, kernelFallback };
}

// Re-export for the server function / UI.
export type { ContentType };
