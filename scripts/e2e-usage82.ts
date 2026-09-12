// Phase 8.2 Prod-E2E: Free-5-Limit + Owner-Override (sparsam: 5+1 todayIdea-Calls)
// Usage: bun --env-file=.env scripts/e2e-usage82.ts   (nach Deploy)
// FIX 2026-09-12 (dokumentiert): Request-Body muss seroval-serialisiert sein
// (toJSONAsync), NICHT plain JSON — sonst HTTP 500 "Seroval caught an error
// during the deserialization process" (Server-Seite). Muster identisch zu
// scripts/_todayidea-full.ts (etabliertes Prod-E2E-Format).
import { toJSONAsync } from 'seroval';
import { getDb } from "../src/db/index";
const SQL = getDb();
const BASE = "https://www.growimo.app";
const API = "https://api.clerk.com/v1";
const SECRET = process.env.CLERK_SECRET_KEY!;
const TEST_USER = "user_3IYfD4pQhQ1HKjH6pb7tlLkQnAo"; // e2e-pinterest Test-Nutzer (NICHT Owner)
const OWNER = "user_3H2trJXHwzXmJF2XTGQ2PMEwjkD";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36";

async function clerk(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}`, ...(init.headers || {}) } });
  const text = await res.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
  return { status: res.status, json: j, text };
}
async function mintJwt(userId: string): Promise<string> {
  const sess = await clerk(`/sessions?userId=${userId}`);
  let sid = sess.json?.data?.find((s: any) => s.status === "active")?.id;
  if (!sid) { const c = await clerk(`/sessions`, { method: "POST", body: JSON.stringify({ user_id: userId }) }); sid = c.json?.id; }
  const tok = await clerk(`/sessions/${sid}/tokens`, { method: "POST" });
  return tok.json?.jwt || "";
}
async function todayIdea(jwt: string, idea: string): Promise<{ http: number; head: string }> {
  const body = JSON.stringify(await toJSONAsync({ data: { mode: "todayIdea", biz: "Handgemachte Keramiktasse mit Duftkerze, 29 EUR", topic: idea, audience: "Designliebhaber", lang: "de" } }));
  const res = await fetch(`${BASE}/_serverFn/c5a06ea39a783ee8b3870581fdd275a061a938a0f2f2e936944df44a51caba3c`, {
    method: "POST",
    headers: { "user-agent": UA, origin: BASE, "x-tsr-serverFn": "true", cookie: `__session=${jwt}`, "content-type": "application/json", accept: "application/x-tss-framed, application/x-ndjson, application/json" },
    body,
  });
  const text = await res.text();
  return { http: res.status, head: text.slice(0, 300).replace(/\n/g, "\\n") };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const period = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
async function usageOf(clerkId: string) {
  const r = await SQL`SELECT u.clerk_id, u.id, COALESCE(m.count,0) AS count FROM users u LEFT JOIN usage_monthly m ON m.user_id=u.id AND m.period=${period} WHERE u.clerk_id=${clerkId}`;
  return r.length ? Number((r[0] as any).count) : "NO_USER_ROW";
}

async function main() {
  console.log("=== E2E Phase 8.2 Usage-Limit + Owner-Override (Prod) ===");
  // Vorab: Test-Nutzer-Verbrauch prüfen und für den Test auf 0 zurücksetzen.
  const before = await usageOf(TEST_USER);
  console.log("Test-Nutzer Verbrauch VOR Test:", before);
  await SQL`DELETE FROM usage_monthly WHERE user_id=(SELECT id FROM users WHERE clerk_id=${TEST_USER}) AND period=${period}`;
  await SQL`DELETE FROM generation_throttle WHERE user_id=${TEST_USER}`;
  console.log("Test-Nutzer Zähler für Test zurückgesetzt auf 0");
  const jwtTest = await mintJwt(TEST_USER);
  const jwtOwner = await mintJwt(OWNER);
  console.log("JWT Test:", jwtTest.length, "JWT Owner:", jwtOwner.length);

  const ideas = ["Keramiktasse mit Lavendel-Duftkerze als Geschenk", "Handgefertigte Tassen fürs Homeoffice", "Keramik-Geschenkset mit Kerze", "Tassen mit Duftkerze für Hochzeitsgäste", "Frühstücksteller trifft Duftkerze"];
  for (let i = 0; i < 5; i++) {
    const r = await todayIdea(jwtTest, ideas[i]!);
    console.log(`[Test ${i + 1}/5] HTTP ${r.http} | ${r.head.slice(0, 90)}`);
    await sleep(2200);
  }
  console.log("→ 5/5 verbraucht. Jetzt 6. Call (erwartet: USAGE_LIMIT):");
  const r6 = await todayIdea(jwtTest, "Sechste Idee für den Limit-Test");
  console.log(`[Test 6] HTTP ${r6.http} | ${r6.head}`);
  await sleep(2500);
  console.log("→ Owner-Override (7. Call des Tages, Owner darf über 5 hinaus):");
  const ro = await todayIdea(jwtOwner, "Owner-Test-Idee über dem Free-Limit");
  console.log(`[Owner] HTTP ${ro.http} | ${ro.head}`);
  await sleep(500);

  const afterTest = await usageOf(TEST_USER);
  const ownerBefore = process.env.OWNER_BEFORE ?? "n/a";
  const afterOwner = await usageOf(OWNER);
  console.log("Test-Nutzer Verbrauch NACH Test:", afterTest);
  console.log("Owner Verbrauch (Zähler sollte NICHT steigen; vorher:", ownerBefore, "→ nachher:", afterOwner, ")");
  console.log("E2E_DONE");
}
main().catch((e) => { console.error("E2E_FATAL", e); process.exit(1); });