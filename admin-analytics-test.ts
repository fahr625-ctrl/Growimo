// MVP Phase 2 test: /api/admin-analytics (Bun mini-server + real Clerk JWTs).
// Run: bun --env-file=.env run ./admin-analytics-test.ts
// Seeds dummy rows, asserts DELTAS (prod DB has real traffic — absolute numbers
// are meaningless), cleans up afterwards. ANALYTICS_SALT is set IN-MEMORY only
// here (ephemeral test salt, never written to any file).
// @ts-nocheck — test script, not part of the app bundle.
import { createHmac, randomBytes } from "node:crypto";

process.env.ANALYTICS_SALT = randomBytes(32).toString("hex");
const SALT = process.env.ANALYTICS_SALT;

const { getDb } = await import("./src/db/index.ts");
const { qInsertTrackingEvent } = await import("./src/db/queries.ts");
const { handleAdminAnalyticsApi } = await import("./src/api/admin-analytics.ts");
const { OWNER_USER_ID } = await import("./src/lib/tracking.ts");

const SECRET = process.env.CLERK_SECRET_KEY!;
const NON_OWNER = "user_3IYfD4pQhQ1HKjH6pb7tlLkQnAo"; // existing e2e user
const sql = getDb();
const pseudo = (id: string) => createHmac("sha256", SALT).update(id).digest("hex");

async function clerkToken(userId: string): Promise<string> {
  const c = await fetch("https://api.clerk.com/v1/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!c.ok) throw new Error(`session create ${c.status} for ${userId}: ${await c.text()}`);
  const sid = ((await c.json()) as { id: string }).id;
  const t = await fetch(`https://api.clerk.com/v1/sessions/${sid}/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
  });
  if (!t.ok) throw new Error(`token ${t.status}: ${await t.text()}`);
  return ((await t.json()) as { jwt: string }).jwt;
}

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};

// ── Server + tokens first (before-snapshot needs an authenticated call) ──
const PORT = 3457;
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const r = await handleAdminAnalyticsApi(req, pathname);
    return r ?? new Response("not found", { status: 404 });
  },
});
const BASE = `http://127.0.0.1:${PORT}/api/admin-analytics`;

const ownerJwt = await clerkToken(OWNER_USER_ID);
const nonOwnerJwt = await clerkToken(NON_OWNER);
const withCookie = (jwt: string) => ({ Cookie: `__session=${jwt}` });
const snap = async () => {
  const r = await fetch(`${BASE}?rangeDays=30`, { headers: withCookie(ownerJwt) });
  if (r.status !== 200) throw new Error(`snapshot got ${r.status}`);
  return (await r.json()) as Record<string, any>;
};
const before = await snap();

// ── Seed (after before-snapshot, so (c) asserts true deltas) ──
const TP1 = "test_adminanalytics_user1";
const TP2 = "test_adminanalytics_user2";
const P1 = pseudo(TP1), P2 = pseudo(TP2), PO = pseudo(OWNER_USER_ID);
await sql`DELETE FROM tracking_events WHERE user_id IN (${TP1}, ${TP2})`;
await sql`DELETE FROM analytics_events WHERE user_pseudonym IN (${P1}, ${P2}, ${PO}, 'testpseudo-anon-check') OR user_pseudonym IS NULL AND event = 'pageview' AND referrer_host = 'phase2-test.invalid'`;
await qInsertTrackingEvent(TP1, "user_registered", {});
await qInsertTrackingEvent(TP1, "project_created", {});
await qInsertTrackingEvent(TP1, "tiktok_created", {});
await qInsertTrackingEvent(TP2, "user_registered", {});
await qInsertTrackingEvent(OWNER_USER_ID, "project_created", {}); // must be excluded
await sql`INSERT INTO analytics_events (user_pseudonym, event, channel, status, duration_ms, referrer_host, utm_source, metadata) VALUES
  (${P1}, 'pageview', NULL, NULL, NULL, 'google.com', 'newsletter', '{"route":"/"}'),
  (${P1}, 'pageview', NULL, NULL, NULL, 'google.com', NULL, '{"route":"/"}'),
  (NULL, 'pageview', NULL, NULL, NULL, 'phase2-test.invalid', NULL, '{"route":"/"}'),
  (${P2}, 'generation_started', 'pinterest_pin', 'started', NULL, NULL, NULL, '{}'),
  (${P2}, 'generation_finished', 'pinterest_pin', 'done', 12000, NULL, NULL, '{}'),
  (${P1}, 'generation_finished', 'seo_blog', 'error', 3000, NULL, NULL, '{}'),
  (${PO}, 'pageview', NULL, NULL, NULL, 'google.com', NULL, '{"route":"/"}')`;
// Expired row (>90d) for lazy-TTL check (bypasses insert helper to set created_at).
await sql`INSERT INTO analytics_events (user_pseudonym, event, created_at) VALUES ('testpseudo-anon-check', 'pageview', NOW() - make_interval(days => 100))`;
const expiredBefore = await sql`SELECT COUNT(*) AS n FROM analytics_events WHERE user_pseudonym = 'testpseudo-anon-check'`;
check("seed expired row present", Number(expiredBefore[0].n) === 1);

// (a) no cookie → 401
{
  const r = await fetch(BASE);
  check("(a) no cookie → 401", r.status === 401, `got ${r.status}`);
}
// (b) non-owner → 403, no data
{
  const r = await fetch(BASE, { headers: withCookie(nonOwnerJwt) });
  const j = (await r.json()) as Record<string, unknown>;
  check("(b) non-owner → 403", r.status === 403, `got ${r.status}`);
  check("(b) no data leaked", !("kpi" in j) && !("trend" in j) && !("featureUsage" in j), JSON.stringify(j).slice(0, 120));
}
// (d) invalid rangeDays → 400 (owner auth, so gate passes, validation fails)
{
  const r = await fetch(`${BASE}?rangeDays=bogus`, { headers: withCookie(ownerJwt) });
  check("(d) rangeDays=bogus → 400", r.status === 400, `got ${r.status}`);
  const r2 = await fetch(BASE, { method: "POST", headers: { ...withCookie(ownerJwt), "Content-Type": "application/json" }, body: JSON.stringify({ rangeDays: 13 }) });
  check("(d) POST rangeDays=13 → 400", r2.status === 400, `got ${r2.status}`);
}
// (c) asserts report(after seed) − before-snapshot deltas (see above).
{
  const r = await fetch(`${BASE}?rangeDays=30`, { headers: withCookie(ownerJwt) });
  check("(c) owner → 200", r.status === 200, `got ${r.status}`);
  const j = (await r.json()) as Record<string, any>;
  const sections = ["kpi", "trend", "topReferrers", "topUtmSources", "featureUsage", "generationByChannel", "usersPerFunction"];
  check("(c) all sections present", sections.every((s) => s in j), Object.keys(j).join(","));
  const D = (o: any, k: string) => Number(o?.[k] ?? 0);
  const dKpi = {
    views: D(j.kpi, "views") - D(before.kpi, "views"),
    uniques: D(j.kpi, "uniquePseudonyms") - D(before.kpi, "uniquePseudonyms"),
    anon: D(j.kpi, "anonymousViews") - D(before.kpi, "anonymousViews"),
    reg: D(j.kpi, "registrations") - D(before.kpi, "registrations"),
    active: D(j.kpi, "activeUsers") - D(before.kpi, "activeUsers"),
  };
  // Seed net effect: P1x2 pageviews + anonx1 + owner-pseudo pageview excluded
  // → views +3, uniques +1 (P1), anon +1. tracking TP1(reg,proj,tiktok) +
  // TP2(reg only — counts as registration but NOT as active user, same
  // definition as qGetTrackingReport) + OWNER(project, excluded)
  // → reg +2, active +1 (TP1 only).
  check("(c) Δviews=+3 (owner excluded)", dKpi.views === 3, JSON.stringify(dKpi));
  check("(c) ΔuniquePseudonyms=+1", dKpi.uniques === 1, JSON.stringify(dKpi));
  check("(c) ΔanonymousViews=+1", dKpi.anon === 1, JSON.stringify(dKpi));
  check("(c) Δregistrations=+2", dKpi.reg === 2, JSON.stringify(dKpi));
  check("(c) ΔactiveUsers=+1 (TP1; reg-only TP2 excluded by def)", dKpi.active === 1, JSON.stringify(dKpi));
  const featDelta = (e: string) =>
    Number(j.featureUsage?.find((f: any) => f.event === e)?.count ?? 0) -
    Number(before.featureUsage?.find((f: any) => f.event === e)?.count ?? 0);
  // NOTE: the (c) snapshot call above runs the lazy TTL first, so the seeded
  // 100-day-old expired row is already deleted when this report is computed.
  check("(c) ΔfeatureUsage pageview=+3 (expired row already TTL-deleted)", featDelta("pageview") === 3, `pvΔ=${featDelta("pageview")}`);
  // TP1(reg,proj,tiktok) + TP2(reg only — no non-registration event, so NOT
  // active) + OWNER(project, excluded) → project_created only +1 (TP1).
  check("(c) ΔfeatureUsage project_created=+1 (TP1; TP2 has none, OWNER excluded)", featDelta("project_created") === 1, `pcΔ=${featDelta("project_created")}`);
  const genDelta = (ch: string) => {
    const a = j.generationByChannel?.find((g: any) => g.channel === ch) ?? {};
    const b = before.generationByChannel?.find((g: any) => g.channel === ch) ?? {};
    return { started: D(a, "started") - D(b, "started"), done: D(a, "done") - D(b, "done"), errors: D(a, "errors") - D(b, "errors") };
  };
  const pinD = genDelta("pinterest_pin"), seoD = genDelta("seo_blog");
  check("(c) Δpinterest started/done=+1, avgMs=12000", pinD.started === 1 && pinD.done === 1 &&
    j.generationByChannel?.find((g: any) => g.channel === "pinterest_pin")?.avgMs === 12000, JSON.stringify(pinD));
  check("(c) Δseo errors=+1", seoD.errors === 1, JSON.stringify(seoD));
  const upfDelta = (fn: string) =>
    Number(j.usersPerFunction?.find((u: any) => u.function === fn)?.users ?? 0) -
    Number(before.usersPerFunction?.find((u: any) => u.function === fn)?.users ?? 0);
  check("(c) ΔusersPerFunction tiktok=+1", upfDelta("tiktok") === 1, `Δ=${upfDelta("tiktok")}`);
  check("(c) ΔusersPerFunction strategie=+1 (TP1; TP2 has no project_created, owner excluded)", upfDelta("strategie") === 1, `Δ=${upfDelta("strategie")}`);
  const body = JSON.stringify(j);
  check("(c) no raw ids leak", !body.includes(OWNER_USER_ID) && !body.includes(TP1) && !body.includes(P1), "leak!");
  check("(c) exclusion flags", j.excludedOwnerTestActivity === true && j.pseudonymExclusionActive === true);
  check("(c) trend length 30, zero-filled", Array.isArray(j.trend) && j.trend.length === 30);
  check("(c) ttlDeleted reported", typeof j.ttlDeleted === "number");
}
// (e) lazy TTL deleted the expired row
{
  const after = await sql`SELECT COUNT(*) AS n FROM analytics_events WHERE user_pseudonym = 'testpseudo-anon-check'`;
  check("(e) expired row deleted by lazy TTL", Number(after[0].n) === 0, `remaining=${after[0].n}`);
}

// ── Cleanup ──
await sql`DELETE FROM tracking_events WHERE user_id IN (${TP1}, ${TP2})`;
await sql`DELETE FROM analytics_events WHERE user_pseudonym IN (${P1}, ${P2}, ${PO}) OR (user_pseudonym IS NULL AND referrer_host = 'phase2-test.invalid')`;
server.stop();
console.log(`\nRESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
