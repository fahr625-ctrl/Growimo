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
import {
  isAnalyticsErrorCategory,
  isAnalyticsErrorCode,
} from "~/lib/analytics-error";

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
  /**
   * Phase Analytics-Erweiterung: pseudonymer Besucher-Schlüssel
   * (= user_pseudonym wenn eingeloggt, sonst der zufällige Cookie-Wert).
   * NUR aus einem gültigen Zufallswert oder dem Server-Pseudonym — niemals aus
   * IP/User-Agent. Format wird hier erneut geprüft (Defense in depth).
   */
  visitorKey?: string | null;
  /** true = für dieses Event wurde ein frischer Besucher-Schlüssel ausgegeben. */
  visitorNew?: boolean | null;
  /** Fehleranalyse: Whitelist-Kategorie, nur bei status='error'. */
  errorCategory?: string | null;
  /** Fehleranalyse: kurzer technischer Code (nie eine Meldung). */
  errorCode?: string | null;
}

/** Besucher-Schlüssel: 32–64 hex (Cookie-UUID) ODER HMAC-Pseudonym (64 hex). */
const VISITOR_KEY_RE = /^[0-9a-f]{8,64}$/;

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
    // Additive Felder: streng re-validiert, sonst NULL (fail-closed).
    const visitorKey =
      typeof row.visitorKey === "string" && VISITOR_KEY_RE.test(row.visitorKey)
        ? row.visitorKey
        : null;
    const visitorNew = typeof row.visitorNew === "boolean" ? row.visitorNew : null;
    const errorCategory =
      status === "error" && isAnalyticsErrorCategory(row.errorCategory)
        ? row.errorCategory
        : null;
    const errorCode =
      status === "error" && isAnalyticsErrorCode(row.errorCode) ? row.errorCode : null;
    await sql`
      INSERT INTO analytics_events
        (user_pseudonym, event, channel, status, duration_ms, referrer_host, utm_source, metadata,
         visitor_key, visitor_new, error_category, error_code)
      VALUES (${row.userPseudonym}, ${row.event}, ${channel}, ${status}, ${durationMs}, ${referrerHost}, ${utmSource}, ${JSON.stringify(metadata)},
              ${visitorKey}, ${visitorNew}, ${errorCategory}, ${errorCode})
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
