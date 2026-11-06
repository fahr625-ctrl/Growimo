/**
 * B2-DB-SUITE (2026-11-06) — Schema-Angleich der Demo-DB an den Branch-Stand.
 *
 * initDb() ist idempotent (CREATE TABLE IF NOT EXISTS + DROP/ADD CONSTRAINT) und
 * laeuft sonst beim App-Start. Hier explizit gegen `growimo_demo`, damit die
 * Suite auf demselben Schema-Stand laeuft wie der Branch (u. a. B1-Migration:
 * plan_tier-CHECK mit video/video_plus, Tabelle beta_entitlements).
 *
 * Fail-closed: bricht ab, wenn die verbundene DB nicht `growimo_demo` ist.
 *
 * Aufruf: bun --env-file=/tmp/b2/demo.env run scripts/_b2-demo-init.ts
 */
import { neon } from "@neondatabase/serverless";

const DEMO_DB_NAME = "growimo_demo";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
const dbname = new URL(url).pathname.replace(/^\//, "");
if (dbname !== DEMO_DB_NAME) throw new Error(`refusing: connected target is ${dbname}, not ${DEMO_DB_NAME}`);

const probe = neon(url);
const who = await probe`SELECT current_database() AS db`;
if (who[0].db !== DEMO_DB_NAME) throw new Error(`WRONG DB: ${who[0].db}`);

const before = await probe`
  SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid = 'subscriptions'::regclass AND conname LIKE '%plan_tier%'`;
console.log("vorher plan_tier-Constraint:", before.length ? before[0].def : "(keiner)");

const { initDb } = await import("../src/db/init");
const res = await initDb();
console.log("initDb:", JSON.stringify(res));

const after = await probe`
  SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid = 'subscriptions'::regclass AND conname LIKE '%plan_tier%'`;
console.log("nachher plan_tier-Constraint:", after.length ? after[0].def : "(keiner)");

const tables = await probe`
  SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
console.log("Tabellen (" + tables.length + "):", tables.map((t: { table_name: string }) => t.table_name).join(", "));
