// P2-Nachfass: Live-Read des Kündigungs-/Refund-Zustands über die PROD-ServerFns.
// Read-only: nur SELECTs, Clerk-Session minten+revoken, lesende ServerFn-Aufrufe.
import { getDb } from "../src/db/index";

const BASE = "https://www.growimo.app";
// fn-ids aus dem Billing-Client-Chunk des aktuellen Deployments
const FN_BILLING = "1e32769b9f4187e7b22465c258f554db13a58a39fbc0e57c4c67176f2f276ebd";
const FN_OTHER = "89ea514fb0d9a98f1f71f547acb9b6766f3b8a629eb93f6215ac779e285fcff1";

function decodeServerFnJson(parsed: any): any {
  if (!parsed || typeof parsed !== "object" || typeof parsed.t !== "number") return parsed;
  const cache = new Map<number, any>();
  const walk = (n: any): any => {
    if (n === null || typeof n !== "object") return n;
    const i = n.i;
    if (typeof i === "number" && cache.has(i)) return cache.get(i);
    let out: any;
    const t = n.t;
    if (t === 0 || t === 1) out = n.s;
    else if (t === 2) out = n.s === 0 ? null : n.s === 1 ? undefined : n.s === 2 ? true : false;
    else if (t === 9) {
      out = [];
      if (typeof i === "number") cache.set(i, out);
      for (const x of n.a ?? []) out.push(walk(x));
    } else if (t === 10 || t === 11) {
      out = {};
      if (typeof i === "number") cache.set(i, out);
      const p = n.p ?? {};
      const keys: string[] = Array.isArray(p.k) ? p.k : [];
      const vals: any[] = Array.isArray(p.v) ? p.v : [];
      for (let j = 0; j < keys.length; j++) out[keys[j]] = walk(vals[j]);
    } else out = n.s !== undefined ? walk(n.s) : undefined;
    return out;
  };
  const env = walk(parsed);
  if (env && typeof env === "object" && "result" in env) return env.result ?? env.error ?? env;
  return env;
}

const out: string[] = [];
const log = (s: string) => { out.push(s); console.log(s); };

async function main() {
  const sql = getDb();
  const rows: any[] = await sql`
    SELECT u.clerk_id, u.email, s.plan_tier, s.status, s.stripe_customer_id,
           s.stripe_subscription_id, s.current_period_end, s.cancel_at_period_end,
           s.cancel_at, s.updated_at
    FROM subscriptions s JOIN users u ON u.id = s.user_id
    WHERE s.stripe_subscription_id IS NOT NULL
    ORDER BY s.updated_at DESC LIMIT 5`;
  log("=== DB subscriptions (neueste 5) ===");
  log(JSON.stringify(rows, null, 1));

  const owner = rows.find((r) => r.plan_tier === "pro");
  if (!owner) { log("KEIN pro-Eintrag gefunden"); return; }
  const clerkId: string = owner.clerk_id;
  log(`owner clerk=${clerkId.slice(0, 12)}… sub=${String(owner.stripe_subscription_id).slice(0, 12)}…`);
  log(`DB cancel_at_period_end=${owner.cancel_at_period_end} cancel_at=${owner.cancel_at} updated_at=${owner.updated_at}`);

  // Clerk-Session minten
  const CK = process.env.CLERK_SECRET_KEY!;
  const mk = await fetch("https://api.clerk.com/v1/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${CK}`, "content-type": "application/json" },
    body: JSON.stringify({ user_id: clerkId }),
  });
  const sess: any = await mk.json();
  log(`session create: HTTP ${mk.status} id=${String(sess?.id).slice(0, 12)}…`);
  const tk = await fetch(`https://api.clerk.com/v1/sessions/${sess.id}/tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CK}`, "content-type": "application/json" },
    body: "{}",
  });
  const tok: any = await tk.json();
  log(`token: HTTP ${tk.status} jwtLen=${tok?.jwt?.length ?? 0}`);

  for (const [name, id] of [["getBillingOverview?", FN_BILLING], ["other-fn", FN_OTHER]] as const) {
    const res = await fetch(`${BASE}/_serverFn/${id}`, {
      headers: {
        "x-tsr-serverFn": "true",
        origin: BASE,
        accept: "application/x-tss-framed, application/x-ndjson, application/json",
        cookie: `__session=${tok.jwt}`,
      },
    });
    const text = await res.text();
    log(`\n=== ${name} ${id.slice(0, 8)} → HTTP ${res.status} len=${text.length} ===`);
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { log("raw:" + text.slice(0, 300)); continue; }
    const dec = decodeServerFnJson(parsed);
    log("decoded: " + JSON.stringify(dec, null, 1).slice(0, 2500));
  }

  const rv = await fetch(`https://api.clerk.com/v1/sessions/${sess.id}/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CK}` },
  });
  log(`\nrevoke: HTTP ${rv.status}`);

  await Bun.write("/tmp/p2-live-read.json", out.join("\n"));
}

await main();
process.exit(0);
