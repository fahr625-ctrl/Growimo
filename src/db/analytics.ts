// ── Admin-Analytics MVP Phase 1: Query-Layer (server-only) ─────────────────
// Privacy contract (owner requirement):
//  - analytics_events stores ONLY { user_pseudonym (HMAC or NULL), event,
//    channel, status, duration_ms, referrer_host, utm_source, metadata }.
//  - NO product ideas, NO generated texts, NO emails/names, NO IPs, NO raw
//    Clerk ids. Metadata is limited to the harmless route key ({route}).
import { getDb } from "./index";
import {
  isAnalyticsChannel,
  isAnalyticsEvent,
  isAnalyticsStatus,
} from "~/lib/analytics";

/** Row shape for qInsertAnalyticsEvent. Server-only (imports getDb). */
export interface AnalyticsEventRow {
  userPseudonym: string | null;
  event: string;
  channel?: string | null;
  status?: string | null;
  durationMs?: number | null;
  referrerHost?: string | null;
  utmSource?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Insert one analytics event. Fire-and-forget from the caller's point of view:
 * never throws (swallows + logs), so analytics can never break a feature.
 * The caller (src/api/analytics.ts) has already validated whitelist/limits.
 */
export async function qInsertAnalyticsEvent(row: AnalyticsEventRow): Promise<void> {
  try {
    if (!isAnalyticsEvent(row.event)) return;
    const sql = getDb();
    const channel =
      row.channel && isAnalyticsChannel(row.channel) ? row.channel : null;
    const status =
      row.status && isAnalyticsStatus(row.status) ? row.status : null;
    const durationMs =
      typeof row.durationMs === "number" && Number.isFinite(row.durationMs)
        ? Math.max(0, Math.round(row.durationMs))
        : null;
    const referrerHost =
      typeof row.referrerHost === "string" && row.referrerHost ? row.referrerHost : null;
    const utmSource =
      typeof row.utmSource === "string" && row.utmSource ? row.utmSource : null;
    const metadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata
        : {};
    await sql`
      INSERT INTO analytics_events
        (user_pseudonym, event, channel, status, duration_ms, referrer_host, utm_source, metadata)
      VALUES (${row.userPseudonym}, ${row.event}, ${channel}, ${status}, ${durationMs}, ${referrerHost}, ${utmSource}, ${JSON.stringify(metadata)})
    `;
  } catch (err) {
    // Analytics must NEVER break the calling feature. Swallow + log only.
    console.error("[analytics] insert failed:", err);
  }
}

// Lazy TTL helper for Phase 2: delete analytics_events older than 90 days.
// Kept here (not wired) so the report route can call it on read.
export const ANALYTICS_TTL_DAYS = 90;
export const ANALYTICS_TTL_DELETE_LIMIT = 5000;

export async function qDeleteExpiredAnalyticsEvents(
  limit: number = ANALYTICS_TTL_DELETE_LIMIT,
): Promise<number> {
  try {
    const sql = getDb();
    const rows = await sql`
      DELETE FROM analytics_events
      WHERE id IN (
        SELECT id FROM analytics_events
        WHERE created_at < NOW() - make_interval(days => ${ANALYTICS_TTL_DAYS})
        LIMIT ${limit}
      )
      RETURNING id
    `;
    return rows.length;
  } catch (err) {
    console.error("[analytics] TTL delete failed:", err);
    return 0;
  }
}

// Re-export the shared vocabulary for server call sites.
export {
  ANALYTICS_CHANNELS,
  ANALYTICS_EVENTS,
  ANALYTICS_STATUSES,
  analyticsChannelForContentType,
  isAnalyticsChannel,
  isAnalyticsEvent,
  isAnalyticsStatus,
} from "~/lib/analytics";
export type { AnalyticsChannel, AnalyticsEvent, AnalyticsStatus } from "~/lib/analytics";
