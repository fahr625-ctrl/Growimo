/**
 * B2-DB-SUITE (2026-11-06) — Demo-DB-Probe, NUR LESEND.
 *
 * Baut aus der vorhandenen DATABASE_URL die URL der getrennten Demo-DB
 * `growimo_demo` (gleiche Neon-Instanz, eigener DB-Namespace) und prueft:
 *   · welcher DB-Name wirklich verbunden ist (current_database())
 *   · welche Tabellen existieren (Schema-Stand)
 *   · Zaehler der Tabellen, die die Suite anfasst
 *   · welche Policy der TEST-SUITE-PROD-GUARD fuer Prod- vs. Demo-URL ableitet
 *
 * Es wird KEIN Secret ausgegeben: nur Host + DB-Name (describeUrl).
 */
import { neon } from "@neondatabase/serverless";
import { describeDbTarget, isTestProcess, testDbPolicy, TEST_SUITE_ENV } from "../src/db/test-guard";

const DEMO_DB_NAME = "growimo_demo";

function demoUrlFrom(raw: string): string {
  const url = raw.replace(/\/neondb(\?|$)/, `/${DEMO_DB_NAME}$1`);
  if (!new RegExp(`/${DEMO_DB_NAME}(\\?|$)`).test(url)) {
    throw new Error(`refusing to run: URL does not point at ${DEMO_DB_NAME}`);
  }
  return url;
}

const prodUrl = process.env.DATABASE_URL;
if (!prodUrl) throw new Error("DATABASE_URL not set (run with: bun --env-file=.env run ...)");
const demoUrl = demoUrlFrom(prodUrl);

console.log("— B2 Demo-DB-Probe (read-only) —");
console.log("PROD-Ziel (nur Vergleich):", describeDbTarget(prodUrl));
console.log("DEMO-Ziel               :", describeDbTarget(demoUrl));
console.log("Guard-Policy PROD-URL   :", testDbPolicy(prodUrl));
console.log("Guard-Policy DEMO-URL   :", testDbPolicy(demoUrl));
// Der Guard klassifiziert nur in TEST-Prozessen (Einstiegsskript `*-test.ts`).
// Diese Probe heisst nicht so -> hier explizit markieren, damit die Ableitung
// fuer den echten Suite-Lauf (stripe-webhook-test.ts) sichtbar wird.
process.env[TEST_SUITE_ENV] = "1";
console.log("als Test-Prozess markiert:", isTestProcess());
console.log("Guard-Policy PROD-URL (Test-Prozess) :", testDbPolicy(prodUrl));
console.log("Guard-Policy DEMO-URL (Test-Prozess) :", testDbPolicy(demoUrl));
delete process.env[TEST_SUITE_ENV];
console.log("Host identisch?         :", new URL(prodUrl).hostname === new URL(demoUrl).hostname);
console.log("DB-Name unterschiedlich?:", new URL(prodUrl).pathname !== new URL(demoUrl).pathname);

const sql = neon(demoUrl);

const who = await sql`SELECT current_database() AS db, current_user AS usr, version() AS v`;
console.log("\nverbunden mit DB        :", who[0].db);
console.log("Rolle                   :", who[0].usr);
console.log("Server                  :", String(who[0].v).split(",")[0]);
if (who[0].db !== DEMO_DB_NAME) throw new Error(`WRONG DB: ${who[0].db} != ${DEMO_DB_NAME}`);

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name`;
console.log("\nTabellen in public (" + tables.length + "):");
console.log(tables.map((t: { table_name: string }) => t.table_name).join(", "));

for (const t of ["subscriptions", "users", "beta_signups", "beta_entitlements", "usage_monthly"]) {
  const exists = tables.some((r: { table_name: string }) => r.table_name === t);
  if (!exists) {
    console.log(`Zaehler ${t.padEnd(18)}: TABELLE FEHLT`);
    continue;
  }
  const n = await sql.query(`SELECT count(*)::int AS n FROM ${t}`);
  console.log(`Zaehler ${t.padEnd(18)}: ${n[0].n}`);
}

const check = await sql`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = 'subscriptions'::regclass AND conname LIKE '%plan_tier%'`;
console.log("\nplan_tier-Constraint:", check.length ? `${check[0].conname} → ${check[0].def}` : "(keiner)");
