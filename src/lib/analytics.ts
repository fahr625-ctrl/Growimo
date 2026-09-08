// ── Admin-Analytics MVP Phase 1: Event-Vokabular (client-bundle-safe) ───────
// Shared config used by the client helper (src/lib/analytics-client) and the
// server route (src/api/analytics.ts). No import side effects, safe for the
// client bundle.
//
// Privacy contract (owner requirement):
//  - analytics_events stores ONLY { user_pseudonym (HMAC or NULL), event,
//    channel, status, duration_ms, referrer_host, utm_source, metadata }.
//  - NO product ideas, NO generated texts, NO emails/names, NO IPs, NO raw
//    Clerk ids. Metadata is limited to the harmless route key ({route}).

// ── Event vocabulary ─────────────────────────────────────────────────────────
// pageview + generation_started/finished + every TRACKED_EVENTS name (so the
// existing 11 success/open events can be mirrored here later without schema
// or validator changes). report() in Phase 2 reads from this table.
export const ANALYTICS_EVENTS = [
  "pageview",
  "generation_started",
  "generation_finished",
  "image_generated",
  "tiktok_created",
  "tiktok_diagnosed",
  "user_registered",
  "user_login",
  "project_created",
  "image_studio_opened",
  "pinterest_pin_created",
  "package_or_pricing_opened",
  "upgrade_clicked",
  "tiktok_area_opened",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export function isAnalyticsEvent(e: string): e is AnalyticsEvent {
  return (ANALYTICS_EVENTS as readonly string[]).includes(e);
}

// ── Channel + status vocabularies ────────────────────────────────────────────
export const ANALYTICS_CHANNELS = [
  "pinterest_pin",
  "etsy_listing",
  "seo_blog",
  "social_post",
  "email_newsletter",
  "package",
  "image",
  "tiktok",
] as const;

export type AnalyticsChannel = (typeof ANALYTICS_CHANNELS)[number];

export function isAnalyticsChannel(c: string): c is AnalyticsChannel {
  return (ANALYTICS_CHANNELS as readonly string[]).includes(c);
}

export const ANALYTICS_STATUSES = ["started", "done", "error", "aborted"] as const;

export type AnalyticsStatus = (typeof ANALYTICS_STATUSES)[number];

export function isAnalyticsStatus(s: string): s is AnalyticsStatus {
  return (ANALYTICS_STATUSES as readonly string[]).includes(s);
}

// Map a generation ContentType to the analytics channel value. marketing_*
// analysis types have no own channel — they belong to the strategy run.
export function analyticsChannelForContentType(
  contentType: string,
): AnalyticsChannel | null {
  switch (contentType) {
    case "pinterest_pin":
      return "pinterest_pin";
    case "etsy_listing":
      return "etsy_listing";
    case "seo_blog":
      return "seo_blog";
    case "social_post":
      return "social_post";
    case "email_newsletter":
      return "email_newsletter";
    default:
      return null;
  }
}
