// ── Admin-Analytics MVP Phase 2: Aggregations-SQL (server-only) ──────────────
// Owner-only report backend for GET/POST /api/admin-analytics (route lives in
// src/api/admin-analytics.ts). Reads from BOTH event systems (no double count):
//  - tracking_events  (11 TRACKED_EVENTS, raw Clerk user_id, logged-in only)
//  - analytics_events (pageview + generation_started/finished, HMAC-pseudonym
//    or NULL = anonymous)
//
// Privacy contract:
//  - This module returns ONLY counts. No user_id, no user_pseudonym, no raw
//    rows ever leave these functions.
//  - Owner-/Test-Ausschluss (gleiche Semantik wie qGetTrackingReport): rows
//    belonging to TEST_USER_IDS are filtered out of every aggregate.
//    tracking_events stores raw Clerk ids → exclude directly. analytics_events
//    stores HMAC-SHA256(ANALYTICS_SALT, clerk_id) → the salt is needed to
//    compute the exclusion hashes server-side (same formula as the write path
//    in src/api/analytics.ts). WITHOUT salt no pseudonym can be computed at
//    all (write path stores NULL), so exclusion is moot — documented, not
//    silently skipped: `excludedPseudonyms()` returns [] and the report flags
//    `pseudonymExclusionActive: false`.
//
// Time windows (Server-TZ = DB-TZ, dokumentiert):
//  - "heute"      = created_at::date = CURRENT_DATE (calendar day in DB TZ)
//  - 7/30/90 Tage = created_at >= NOW() - make_interval(days => N) (rolling)
//  - "all"        = no time filter. Trend is always capped at 30 days.
//
// Besucher-KPI (pragmatische Entscheidung, dokumentiert): anonymous pageviews
// have user_pseudonym NULL, so a single "unique visitors" number would be
// meaningless. The KPI therefore reports three honest numbers:
//  - views             = COUNT(*) of pageview events in window
//  - uniquePseudonyms  = COUNT(DISTINCT user_pseudonym) of pageviews, NULLs
//                        ignored (= logged-in visitors, pseudonymised)
//  - anonymousViews    = COUNT(*) of pageviews with user_pseudonym IS NULL
// plus viewsToday (same views definition, calendar day) and — from
// tracking_events — registrations + activeUsers (same definitions as
// qGetTrackingReport).
//
// "Nutzer je Funktion" (Näherung, ehrlich dokumentiert): per function row we
// compute an EXACT COUNT(DISTINCT …) over the UNION of that function's events
// via a single `event IN (...)` query — no overlap error WITHIN a row. Across
// rows the same user may appear multiple times (uses TikTok AND Pinterest),
// so rows are NOT additive — documented in the field comment and not summed.
import { createHmac } from "node:crypto";
import { getDb } from "./index";
import { ANALYTICS_TTL_DAYS } from "./analytics";
import { TEST_USER_IDS, TRACKED_EVENTS } from "~/lib/tracking";

// ── Types (counts only — never ids) ──────────────────────────────────────────

export interface AdminAnalyticsKpi {
  views: number;
  uniquePseudonyms: number;
  anonymousViews: number;
  viewsToday: number;
  registrations: number;
  activeUsers: number;
  /**
   * Phase Analytics-Erweiterung (additiv): COUNT(DISTINCT visitor_key) der
   * Pageviews im Fenster. visitor_key = HMAC-Pseudonym (eingeloggt) oder der
   * zufällige, nur mit Einwilligung gesetzte Cookie-Wert. Altzzeilen (vor
   * Einführung) haben NULL und zählen hier nicht mit. Jeder Schlüssel zählt je
   * Fenster genau einmal — die Zahlen der Fenster sind NICHT addierbar.
   */
  uniqueVisitors: number;
  /** Erstmalig ausgegebene Besucher-Schlüssel im Fenster (Transparenz). */
  newVisitors: number;
}

export interface AdminAnalyticsErrorEvent {
  /** Modul/Kanal (NULL möglich, z. B. wenn kein Kanal gesetzt war). */
  channel: string | null;
  /** ISO-Zeitstempel des Fehlers. */
  at: string;
  /** Whitelist-Kategorie; nicht erfasste Altzfehler erscheinen als `unknown`. */
  category: string;
  /** Kurzer technischer Code (nie eine Meldung/Stacktrace). */
  code: string | null;
  /** true = Kategorie/Code wurden bei diesem Event wirklich erfasst. */
  recorded: boolean;
}

export interface AdminAnalyticsReport {
  rangeDays: number | null;
  generatedAt: string;
  /** Owner/test activity filtered out of every aggregate (same as dashboard default). */
  excludedOwnerTestActivity: boolean;
  /** Number of excluded test user ids (count only — ids never leave the server). */
  excludedTestUsers: number;
  /** False when no ANALYTICS_SALT is set (then no pseudonyms exist at all). */
  pseudonymExclusionActive: boolean;
  /** Rows older than ANALYTICS_TTL_DAYS removed by the lazy TTL before aggregating. */
  ttlDeleted: number;
  kpi: AdminAnalyticsKpi;
  /** Pageviews per calendar day, last N days (N = min(rangeDays ?? 30, 30)), zero-filled. */
  trend: { day: string; views: number }[];
  topReferrers: { host: string; count: number }[];
  topUtmSources: { source: string; count: number }[];
  /**
   * Event counts, no double counting: the 11 TRACKED_EVENTS come from
   * tracking_events, the new events (pageview, generation_started,
   * generation_finished) come from analytics_events.
   */
  featureUsage: { event: string; count: number }[];
  generationByChannel: {
    channel: string;
    started: number;
    done: number;
    errors: number;
    avgMs: number | null;
    medianMs: number | null;
  }[];
  /**
   * Distinct users per function. Exact per row (DISTINCT over the union of the
   * row's events); rows are NOT additive across functions (overlap possible).
   * analytics-based rows count only non-NULL pseudonyms (anonymous use is
   * unattributable by design).
   */
  usersPerFunction: {
    function: string;
    users: number;
    source: "tracking" | "analytics";
    events: string[];
  }[];
  /**
   * Phase Analytics-Erweiterung: erster Zeitstempel, an dem überhaupt ein
   * Besucher-Schlüssel erfasst wurde (ISO) — null = noch keine Daten. Die UI
   * weist damit ehrlich darauf hin, dass Zeiträume davor keine belastbare
   * Unique-Visitor-Zahl haben (kein Backfill möglich).
   */
  visitorsSince: string | null;
  /** Neueste Fehler (max. 100) OHNE Pseudonym/Route/Rohzeile/Prompt. */
  errorEvents: AdminAnalyticsErrorEvent[];
  /** Zählung je Kategorie im Fenster (inkl. 'unknown' für nicht erfasste). */
  errorsByCategory: { category: string; count: number }[];
  /** Erster Zeitstempel mit erfasster Fehlerkategorie (ISO) — null = keine. */
  errorDataSince: string | null;
  /** Gesamtzahl der Fehler im Fenster (gleiche Definition wie generationByChannel.errors, aber inkl. TikTok-Events). */
  errorsTotal: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Zeitstempel → ISO-String (oder null). Neon liefert timestamptz je nach
 * Treiberversion als Date oder String — beide Formen werden korrekt behandelt.
 */
function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── Exclusion helpers ────────────────────────────────────────────────────────

/** HMAC pseudonyms of TEST_USER_IDS — [] when no salt is configured. */
export function excludedPseudonyms(): string[] {
  const salt = process.env.ANALYTICS_SALT || "";
  if (!salt || TEST_USER_IDS.length === 0) return [];
  return TEST_USER_IDS.map((id) =>
    createHmac("sha256", salt).update(id).digest("hex"),
  );
}

// ── Function mapping for "Nutzer je Funktion" ────────────────────────────────
// One function = one row = exact COUNT(DISTINCT user) over the listed events.

const TRACKING_FUNCTIONS: { function: string; events: string[] }[] = [
  { function: "tiktok", events: ["tiktok_area_opened", "tiktok_created", "tiktok_diagnosed"] },
  { function: "pinterest", events: ["pinterest_pin_created"] },
  { function: "strategie", events: ["project_created"] },
  { function: "image_studio", events: ["image_studio_opened", "image_generated"] },
  { function: "paket_preise", events: ["package_or_pricing_opened", "upgrade_clicked"] },
  { function: "konto", events: ["user_registered", "user_login"] },
];

// ── Report ───────────────────────────────────────────────────────────────────

/**
 * Compute the full owner report. `rangeDays` = rolling window in days
 * (null = all-time). `ttlDeleted` = rows the caller already removed via lazy
 * TTL (passed through for transparency). Never throws ids — counts only.
 */
export async function qGetAdminAnalyticsReport(
  rangeDays: number | null,
  ttlDeleted: number,
): Promise<AdminAnalyticsReport> {
  const sql = getDb();
  const EXCL = TEST_USER_IDS.length > 0 ? TEST_USER_IDS : null;
  const exclPseudo = excludedPseudonyms();
  const EXCLP = exclPseudo.length > 0 ? exclPseudo : null;
  // NOTE: user_pseudonym is nullable — `col <> ALL(arr)` is NULL (not true)
  // for NULL rows, so the exclusion must keep NULLs explicitly. Anonymous
  // pageviews (NULL) are real visitor traffic and must stay counted.
  const pseudoKept = EXCLP
    ? sql`(user_pseudonym IS NULL OR user_pseudonym <> ALL(${EXCLP}))`
    : sql`(TRUE)`;

  // Zeitfenster. NEU (additiv): rangeDays === 0 bedeutet „heute" = Kalendertag
  // in DB-Zeit (identische Definition wie die bestehende viewsToday-Zahl,
  // Z. oben). 7/30/90/all bleiben unverändert (rollierend bzw. ohne Filter).
  const windowed =
    rangeDays == null
      ? sql``
      : rangeDays === 0
        ? sql`AND created_at::date = CURRENT_DATE`
        : sql`AND created_at >= NOW() - make_interval(days => ${rangeDays})`;

  // ── KPI: pageviews (analytics_events) ──
  const kpiRows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE event = 'pageview') AS views,
      COUNT(DISTINCT user_pseudonym) FILTER (WHERE event = 'pageview') AS uniques,
      COUNT(*) FILTER (WHERE event = 'pageview' AND user_pseudonym IS NULL) AS anon,
      COUNT(*) FILTER (WHERE event = 'pageview' AND created_at::date = CURRENT_DATE) AS today,
      COUNT(DISTINCT visitor_key) FILTER (WHERE event = 'pageview' AND visitor_key IS NOT NULL) AS uniq_visitors,
      COUNT(*) FILTER (WHERE event = 'pageview' AND visitor_new IS TRUE) AS new_visitors
    FROM analytics_events
    WHERE ${pseudoKept}
      ${windowed}
  `;

  // ── KPI: registrations + active users (tracking_events, same defs as qGetTrackingReport) ──
  const regRows = await sql`
    SELECT COUNT(*) AS n FROM tracking_events
    WHERE event = 'user_registered'
      ${windowed}
      ${EXCL ? sql`AND user_id <> ALL(${EXCL})` : sql``}
  `;
  const activeRows = await sql`
    SELECT COUNT(DISTINCT user_id) AS n FROM tracking_events
    WHERE event <> 'user_registered'
      ${windowed}
      ${EXCL ? sql`AND user_id <> ALL(${EXCL})` : sql``}
  `;

  // ── Trend: pageviews per day, zero-filled via generate_series (capped 30) ──
  // „heute" (0) → genau ein Tag; 7/30/90/all → unverändert min(N,30).
  const trendDays = Math.min(Math.max(rangeDays ?? 30, 1), 30);
  const trendRows = await sql`
    SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(a.id) AS n
    FROM generate_series(
      CURRENT_DATE - make_interval(days => ${trendDays - 1}),
      CURRENT_DATE, interval '1 day'
    ) AS d
    LEFT JOIN analytics_events a
      ON a.created_at::date = d::date
      AND a.event = 'pageview'
      AND ${pseudoKept}
    GROUP BY d ORDER BY d
  `;

  // ── Top referrers + UTM sources (pageviews only, windowed) ──
  const refRows = await sql`
    SELECT referrer_host AS host, COUNT(*) AS n FROM analytics_events
    WHERE event = 'pageview' AND referrer_host IS NOT NULL
      AND ${pseudoKept}
      ${windowed}
    GROUP BY referrer_host ORDER BY n DESC LIMIT 10
  `;
  const utmRows = await sql`
    SELECT utm_source AS source, COUNT(*) AS n FROM analytics_events
    WHERE event = 'pageview' AND utm_source IS NOT NULL
      AND ${pseudoKept}
      ${windowed}
    GROUP BY utm_source ORDER BY n DESC LIMIT 10
  `;

  // ── Feature usage: 11 tracked events (tracking_events) + new events (analytics_events) ──
  const trackedUsageRows = await sql`
    SELECT event, COUNT(*) AS n FROM tracking_events
    WHERE 1=1
      ${windowed}
      ${EXCL ? sql`AND user_id <> ALL(${EXCL})` : sql``}
    GROUP BY event
  `;
  const newUsageRows = await sql`
    SELECT event, COUNT(*) AS n FROM analytics_events
    WHERE event IN ('pageview', 'generation_started', 'generation_finished')
      AND ${pseudoKept}
      ${windowed}
    GROUP BY event
  `;
  const featureUsage = [
    ...trackedUsageRows.map((r) => ({ event: String(r.event), count: Number(r.n) })),
    ...newUsageRows.map((r) => ({ event: String(r.event), count: Number(r.n) })),
  ].sort((a, b) => b.count - a.count);

  // ── Generation status + duration per channel (analytics_events) ──
  const genRows = await sql`
    SELECT channel,
      COUNT(*) FILTER (WHERE event = 'generation_started') AS started,
      COUNT(*) FILTER (WHERE event = 'generation_finished' AND status = 'done') AS done,
      COUNT(*) FILTER (WHERE event = 'generation_finished' AND status = 'error') AS errors,
      ROUND(AVG(duration_ms) FILTER (WHERE event = 'generation_finished' AND status = 'done')) AS avg_ms,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms)
        FILTER (WHERE event = 'generation_finished' AND status = 'done') AS median_ms
    FROM analytics_events
    WHERE event IN ('generation_started', 'generation_finished')
      AND channel IS NOT NULL
      AND ${pseudoKept}
      ${windowed}
    GROUP BY channel ORDER BY done DESC
  `;

  // ── Users per function: tracking groups (exact DISTINCT over event union) ──
  const usersPerFunction: AdminAnalyticsReport["usersPerFunction"] = [];
  for (const f of TRACKING_FUNCTIONS) {
    // Defensive: mapping is static, but only whitelisted tracked events
    // may reach SQL. Neon has no IN-list expansion, so single-event groups
    // use `=`, multi-event groups use OR chains.
    const evts = f.events.filter((e) =>
      (TRACKED_EVENTS as readonly string[]).includes(e),
    );
    if (evts.length === 0) continue;
    const evtMatch =
      evts.length === 1
        ? sql`event = ${evts[0]}`
        : evts.length === 2
          ? sql`(event = ${evts[0]} OR event = ${evts[1]})`
          : sql`(event = ${evts[0]} OR event = ${evts[1]} OR event = ${evts[2]})`;
    const r = await sql`
      SELECT COUNT(DISTINCT user_id) AS n FROM tracking_events
      WHERE ${evtMatch}
        ${windowed}
        ${EXCL ? sql`AND user_id <> ALL(${EXCL})` : sql``}
    `;
    usersPerFunction.push({
      function: f.function,
      users: Number(r[0].n),
      source: "tracking",
      events: evts,
    });
  }

  // ── Users per function: generation channels (DISTINCT pseudonym, finished only) ──
  // Näherung (dokumentiert): per-user attribution uses generation_finished
  // rows only — started rows carry no completion context and anonymous rows
  // (NULL pseudonym) are unattributable by design.
  const genUserRows = await sql`
    SELECT channel, COUNT(DISTINCT user_pseudonym) AS n FROM analytics_events
    WHERE event = 'generation_finished'
      AND channel IS NOT NULL
      AND user_pseudonym IS NOT NULL
      ${EXCLP ? sql`AND user_pseudonym <> ALL(${EXCLP})` : sql``}
      ${windowed}
    GROUP BY channel ORDER BY n DESC
  `;
  for (const r of genUserRows) {
    usersPerFunction.push({
      function: `generierung:${String(r.channel)}`,
      users: Number(r.n),
      source: "analytics",
      events: ["generation_finished"],
    });
  }

  // ── Phase Analytics-Erweiterung: Unique Visitors ────────────────────────────
  // Erster Zeitstempel, an dem überhaupt eine Besucher-Kennung erfasst wurde.
  // BEWUSST ohne Zeitfenster (die Aussage „messbar seit" ist fensterunabhängig)
  // und OHNE Backfill — ältere Zeilen haben keine Kennung, das bleibt so.
  const visitorsSinceRows = await sql`
    SELECT MIN(created_at) AS since FROM analytics_events
    WHERE visitor_key IS NOT NULL AND ${pseudoKept}
  `;

  // ── Phase Analytics-Erweiterung: Fehleranalyse ──────────────────────────────
  // Nur NICHT-sensible Felder: Kanal, Zeitpunkt, Whitelist-Kategorie, Kurzcode.
  // NIE Pseudonym, Route, Meldung, Stacktrace, Prompt, E-Mail.
  const errorRows = await sql`
    SELECT channel, created_at, error_category, error_code
    FROM analytics_events
    WHERE status = 'error' AND ${pseudoKept} ${windowed}
    ORDER BY created_at DESC
    LIMIT 100
  `;
  const errorCatRows = await sql`
    SELECT COALESCE(error_category, 'unknown') AS category, COUNT(*) AS n
    FROM analytics_events
    WHERE status = 'error' AND ${pseudoKept} ${windowed}
    GROUP BY 1 ORDER BY n DESC
  `;
  const errorTotalRows = await sql`
    SELECT COUNT(*) AS n FROM analytics_events
    WHERE status = 'error' AND ${pseudoKept} ${windowed}
  `;
  const errorSinceRows = await sql`
    SELECT MIN(created_at) AS since FROM analytics_events
    WHERE error_category IS NOT NULL AND ${pseudoKept}
  `;

  const k = kpiRows[0];
  return {
    rangeDays,
    generatedAt: new Date().toISOString(),
    excludedOwnerTestActivity: true,
    excludedTestUsers: TEST_USER_IDS.length,
    pseudonymExclusionActive: EXCLP !== null,
    ttlDeleted,
    kpi: {
      views: Number(k.views),
      uniquePseudonyms: Number(k.uniques),
      anonymousViews: Number(k.anon),
      viewsToday: Number(k.today),
      registrations: Number(regRows[0].n),
      activeUsers: Number(activeRows[0].n),
      uniqueVisitors: Number(k.uniq_visitors),
      newVisitors: Number(k.new_visitors),
    },
    trend: trendRows.map((r) => ({ day: String(r.day), views: Number(r.n) })),
    topReferrers: refRows.map((r) => ({ host: String(r.host), count: Number(r.n) })),
    topUtmSources: utmRows.map((r) => ({ source: String(r.source), count: Number(r.n) })),
    featureUsage,
    generationByChannel: genRows.map((r) => ({
      channel: String(r.channel),
      started: Number(r.started),
      done: Number(r.done),
      errors: Number(r.errors),
      avgMs: r.avg_ms === null ? null : Number(r.avg_ms),
      medianMs: r.median_ms === null ? null : Number(r.median_ms),
    })),
    usersPerFunction,
    visitorsSince: toIso(visitorsSinceRows[0]?.since),
    errorEvents: errorRows.map((r) => ({
      channel: r.channel === null || r.channel === undefined ? null : String(r.channel),
      at: toIso(r.created_at) ?? "",
      category: r.error_category === null || r.error_category === undefined
        ? "unknown"
        : String(r.error_category),
      code: r.error_code === null || r.error_code === undefined ? null : String(r.error_code),
      recorded: r.error_category !== null && r.error_category !== undefined,
    })),
    errorsByCategory: errorCatRows.map((r) => ({
      category: String(r.category),
      count: Number(r.n),
    })),
    errorDataSince: toIso(errorSinceRows[0]?.since),
    errorsTotal: Number(errorTotalRows[0].n),
  };
}

/** TTL window for analytics_events (days) — single source of truth lives in src/db/analytics.ts. */
export { ANALYTICS_TTL_DAYS };
