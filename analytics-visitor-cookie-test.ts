// ── Phase Analytics-Erweiterung: Besucher-Cookie (Consent-Gate) ──────────────
// Run: bun --env-file=.env run ./analytics-visitor-cookie-test.ts
// Deckt ab: Cookie wird NUR mit Einwilligung gesetzt, alle Attribute korrekt,
// kein Cookie bei „nein"/ohne Entscheidung, Stabilitaät der Kennung, Beweis
// dass KEINE IP-/User-Agent-Ableitung stattfindet, eingeloggtes Pseudonym
// gewinnt gegen den Cookie-Wert, ungültiger Cookie wird ersetzt.
// @ts-nocheck — Testskript, nicht Teil des App-Bundles.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
process.env.ANALYTICS_SALT = randomBytes(32).toString("hex");
const SALT = process.env.ANALYTICS_SALT as string;
const { getDb } = await import("./src/db/index.ts");
const { handleAnalyticsApi, VISITOR_COOKIE_NAME, VISITOR_COOKIE_MAX_AGE } = await import("./src/api/analytics.ts");

const SECRET = process.env.CLERK_SECRET_KEY!;
const LOGGED_IN_USER = "user_3IYfD4pQhQ1HKjH6pb7tlLkQnAo"; // vorhandener e2e-Nutzer
const MARK = "visitor-cookie-test.invalid";
const sql = getDb();

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} ${extra}`);
  }
};

async function clerkSessionJwt(userId: string): Promise<string> {
  const c = await fetch("https://api.clerk.com/v1/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!c.ok) throw new Error(`session create ${c.status}: ${await c.text()}`);
  const sid = ((await c.json()) as { id: string }).id;
  const t = await fetch(`https://api.clerk.com/v1/sessions/${sid}/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
  });
  if (!t.ok) throw new Error(`token ${t.status}: ${await t.text()}`);
  return ((await t.json()) as { jwt: string }).jwt;
}

const PORT = 3461;
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const r = await handleAnalyticsApi(req, pathname);
    return r ?? new Response("not found", { status: 404 });
  },
});
const ENDPOINT = `http://127.0.0.1:${PORT}/api/analytics-events`;

await sql`DELETE FROM analytics_events WHERE referrer_host = ${MARK}`;

type PostOpts = {
  consent?: string | null;
  cookie?: string | null;
  forwardedFor?: string;
  userAgent?: string;
  session?: string;
};
async function post(opts: PostOpts = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-forwarded-for": opts.forwardedFor ?? "203.0.113.7",
    "user-agent": opts.userAgent ?? "Mozilla/5.0 (Test-Agent)",
  };
  if (opts.consent) headers["x-analytics-consent"] = opts.consent;
  const cookies: string[] = [];
  if (opts.cookie) cookies.push(`${VISITOR_COOKIE_NAME}=${opts.cookie}`);
  if (opts.session) cookies.push(`__session=${opts.session}`);
  if (cookies.length > 0) headers["cookie"] = cookies.join("; ");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ event: "pageview", referrerHost: MARK, metadata: { route: "/" } }),
  });
  return { status: res.status, setCookie: res.headers.get("set-cookie") };
}

async function lastRow() {
  const rows = await sql`
    SELECT user_pseudonym, visitor_key, visitor_new FROM analytics_events
    WHERE referrer_host = ${MARK} ORDER BY created_at DESC, id DESC LIMIT 1
  `;
  return rows[0] as
    | { user_pseudonym: string | null; visitor_key: string | null; visitor_new: boolean | null }
    | undefined;
}
const cookieValue = (setCookie: string | null): string | null => {
  const m = setCookie?.match(new RegExp(`${VISITOR_COOKIE_NAME}=([0-9a-f]+)`));
  return m ? m[1] : null;
};

// (a) ohne Einwilligung: kein Cookie, keine Kennung — aber Event wird erfasst
{
  const r = await post({});
  check("(a) ohne Header → 202", r.status === 202, `got ${r.status}`);
  check("(a) kein Set-Cookie", r.setCookie === null, String(r.setCookie));
  const row = await lastRow();
  check("(a) Event trotzdem gespeichert (Tracking unverändert)", row !== undefined);
  check("(a) visitor_key NULL ohne Einwilligung", row?.visitor_key === null, String(row?.visitor_key));
  check("(a) visitor_new NULL ohne Einwilligung", row?.visitor_new === null, String(row?.visitor_new));
}

// (b) ausdrücklich „nein": identisch zu (a)
{
  const r = await post({ consent: "denied" });
  check("(b) Header=denied → 202, kein Set-Cookie", r.status === 202 && r.setCookie === null, `status=${r.status} cookie=${r.setCookie}`);
  const row = await lastRow();
  check("(b) visitor_key NULL", row?.visitor_key === null, String(row?.visitor_key));
}

// (c) Einwilligung ohne Cookie: frischer Schlüssel, vollständige Attribute
let firstKey: string | null = null;
{
  const r = await post({ consent: "granted" });
  check("(c) Header=granted → 202", r.status === 202, `got ${r.status}`);
  const sc = r.setCookie ?? "";
  firstKey = cookieValue(sc);
  check("(c) Set-Cookie vorhanden", sc.length > 0);
  check("(c) Wert = 32 hex (zufällige UUID)", /^[0-9a-f]{32}$/.test(String(firstKey)), String(firstKey));
  check("(c) HttpOnly", /HttpOnly/i.test(sc));
  check("(c) Secure", /Secure/i.test(sc));
  check("(c) SameSite=Lax", /SameSite=Lax/i.test(sc));
  check("(c) Path=/", /Path=\//.test(sc));
  check(`(c) Max-Age=${VISITOR_COOKIE_MAX_AGE} (90 Tage)`, sc.includes(`Max-Age=${VISITOR_COOKIE_MAX_AGE}`), sc);
  const row = await lastRow();
  check("(c) visitor_key = Cookie-Wert", row?.visitor_key === firstKey, `${row?.visitor_key} != ${firstKey}`);
  check("(c) visitor_new = true (erstmalige Ausgabe)", row?.visitor_new === true, String(row?.visitor_new));
}

// (d) zweiter Aufruf mit demselben Cookie: KEIN neues Set-Cookie, gleiche Kennung
{
  const r = await post({ consent: "granted", cookie: firstKey });
  check("(d) mit Cookie → 202, kein neues Set-Cookie", r.status === 202 && r.setCookie === null, `status=${r.status} cookie=${r.setCookie}`);
  const row = await lastRow();
  check("(d) visitor_key unverändert", row?.visitor_key === firstKey, String(row?.visitor_key));
  check("(d) visitor_new = false", row?.visitor_new === false, String(row?.visitor_new));
}

// (e) Cookie vorhanden, aber OHNE Einwilligung: Cookie wird nicht gelesen/gesetzt
{
  const r = await post({ cookie: firstKey });
  const row = await lastRow();
  check("(e) ohne Einwilligung: kein Set-Cookie, visitor_key NULL (fail-closed)", r.setCookie === null && row?.visitor_key === null);
}

// (f) Beweis: keine IP-/User-Agent-Ableitung — zwei Aufrufe ohne Cookie mit
// unterschiedlicher IP und unterschiedlichem User-Agent erhalten zwei
// VERSCHIEDENE zufällige Werte (wären sie abgeleitet, wären sie gleich).
{
  const r1 = await post({ consent: "granted", forwardedFor: "198.51.100.11", userAgent: "Agent-A/1.0" });
  const k1 = cookieValue(r1.setCookie);
  const r2 = await post({ consent: "granted", forwardedFor: "198.51.100.11", userAgent: "Agent-A/1.0" });
  const k2 = cookieValue(r2.setCookie);
  const r3 = await post({ consent: "granted", forwardedFor: "198.51.100.99", userAgent: "Agent-B/9.9" });
  const k3 = cookieValue(r3.setCookie);
  check("(f) gleiche IP+UA → trotzdem verschiedene Werte", k1 !== null && k2 !== null && k1 !== k2, `${k1}/${k2}`);
  check("(f) andere IP+UA → ebenfalls verschiedener Wert", k3 !== null && k3 !== k1 && k3 !== k2);
  check("(f) alle Werte 32 hex", [k1, k2, k3].every((k) => /^[0-9a-f]{32}$/.test(String(k))));
}

// (g) ungültiger Cookie-Wert wird nicht übernommen, sondern ersetzt
{
  const r = await post({ consent: "granted", cookie: "zzz-not-a-key" });
  const k = cookieValue(r.setCookie);
  check("(g) ungültiger Cookie → neuer, gültiger Wert", k !== null && /^[0-9a-f]{32}$/.test(k), String(k));
  const row = await lastRow();
  check("(g) visitor_key = neuer Wert (nicht der Müllwert)", row?.visitor_key === k);
}

// (h) eingeloggt + Einwilligung: das Pseudonym gewinnt, der Cookie-Wert ist irrelevant
{
  const jwt = await clerkSessionJwt(LOGGED_IN_USER);
  const foreign = randomUUID().replace(/-/g, "");
  const r = await post({ consent: "granted", session: jwt, cookie: foreign });
  check("(h) eingeloggt + Einwilligung → 202", r.status === 202, `got ${r.status}`);
  const expected = createHmac("sha256", SALT).update(LOGGED_IN_USER).digest("hex");
  const row = await lastRow();
  check("(h) user_pseudonym = HMAC(Salt, sub)", row?.user_pseudonym === expected, String(row?.user_pseudonym));
  check("(h) visitor_key = Pseudonym (nicht der Cookie-Wert)", row?.visitor_key === expected && row?.visitor_key !== foreign);
  check("(h) visitor_new = false (kein neuer Schlüssel nötig)", row?.visitor_new === false, String(row?.visitor_new));
}

// (i) eingeloggt OHNE Einwilligung: Pseudonym ja, Cookie nein
{
  const jwt = await clerkSessionJwt(LOGGED_IN_USER);
  const r = await post({ session: jwt });
  const row = await lastRow();
  const expected = createHmac("sha256", SALT).update(LOGGED_IN_USER).digest("hex");
  check("(i) kein Set-Cookie ohne Einwilligung, visitor_key = Pseudonym", r.setCookie === null && row?.visitor_key === expected, `cookie=${r.setCookie}`);
}

// (j) Bestand: keine IP/User-Agent irgendwo im Schema der Tabelle
{
  const cols = await sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'analytics_events'
  `;
  const names = cols.map((c: any) => String(c.column_name));
  check("(j) keine IP-/UA-Spalte in analytics_events", !names.some((n) => /ip|agent|fingerprint|email/i.test(n)), names.join(","));
  check("(j) neue Spalten vorhanden", ["visitor_key", "visitor_new", "error_category", "error_code"].every((n) => names.includes(n)), names.join(","));
}

await sql`DELETE FROM analytics_events WHERE referrer_host = ${MARK}`;
const left = await sql`SELECT COUNT(*) AS n FROM analytics_events WHERE referrer_host = ${MARK}`;
check("(k) Cleanup: Seed-Zeilen entfernt", Number(left[0].n) === 0);
server.stop();
console.log(`\nRESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
