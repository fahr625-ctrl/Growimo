// ── Admin-Analytics MVP Phase 2: Owner-only report route (additiv) ──────────
// GET /api/admin-analytics?rangeDays=7|30|90|all (Default 30)
// POST /api/admin-analytics { rangeDays?: "7"|"30"|"90"|"all"|number|null }
// Owner-Gate exakt wie handleTrackingApi (src/api/tracking.ts): pathname-match,
// dann verifySessionSubject; kein sub → 401, sub !== OWNER → 403. KEINE Daten
// an Nicht-Owner. Antwort: reine Aggregate (counts), nie Rohdaten mit
// user_id/Pseudonym-Listen.
//
// Lazy-TTL: vor der Aggregation läuft qDeleteExpiredAnalyticsEvents() ( LIMIT-
// beschränkt, 90 Tage) — Phase 1 hat den Helper bereitgestellt, hier verdrahtet.
// Wiring: serve.ts + vercel-entry.ts, nach der Analytics-Route, vor SSR.
import { qDeleteExpiredAnalyticsEvents } from "../db/analytics";
import {
  qGetAdminAnalyticsReport,
  type AdminAnalyticsReport,
} from "../db/admin-analytics";
import { verifySessionSubject } from "./tracking";
import { OWNER_USER_ID } from "../lib/tracking";

const PATH = "/api/admin-analytics";

/** Allowed rangeDays values: 7 | 30 | 90 | all (null = all-time). Default 30. */
export function parseAdminAnalyticsRange(
  raw: unknown,
): { ok: true; rangeDays: number | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, rangeDays: 30 };
  }
  if (raw === "all") return { ok: true, rangeDays: null };
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (n === 7 || n === 30 || n === 90) return { ok: true, rangeDays: n };
  return { ok: false };
}

export async function handleAdminAnalyticsApi(
  req: Request,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== PATH) return null;
  if (req.method !== "GET" && req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Owner gate (identical semantics to handleTrackingApi).
  const sub = await verifySessionSubject(req);
  if (!sub) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (sub !== OWNER_USER_ID) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // rangeDays: GET → query param; POST → JSON body field.
  let rawRange: unknown;
  if (req.method === "GET") {
    try {
      rawRange = new URL(req.url).searchParams.get("rangeDays");
    } catch {
      rawRange = undefined;
    }
    // searchParams.get returns null when absent → default 30.
    if (rawRange === null) rawRange = undefined;
  } else {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      rawRange = body?.rangeDays;
    } catch {
      rawRange = undefined;
    }
  }
  const parsed = parseAdminAnalyticsRange(rawRange);
  if (!parsed.ok) {
    return Response.json(
      { error: "Invalid rangeDays (expected 7|30|90|all)" },
      { status: 400 },
    );
  }

  // Lazy TTL (LIMIT-beschränkt, schluckt Fehler intern → gibt 0 zurück).
  const ttlDeleted = await qDeleteExpiredAnalyticsEvents();

  let report: AdminAnalyticsReport;
  try {
    report = await qGetAdminAnalyticsReport(parsed.rangeDays, ttlDeleted);
  } catch (err) {
    console.error("[admin-analytics] report failed:", err);
    return Response.json({ error: "Report failed" }, { status: 500 });
  }
  return Response.json(report);
}
