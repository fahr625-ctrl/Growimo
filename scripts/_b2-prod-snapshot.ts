/**
 * B2-DB-SUITE (2026-11-06) — PROD-Zaehler-Snapshot, ausschliesslich SELECT.
 *
 * Belegt vor/nach dem Demo-Suite-Lauf, dass die Produktions-DB unberuehrt ist.
 * Es wird KEIN Statement ausser SELECT/`WITH` abgesetzt; die URL kommt aus .env
 * (Prod) und wird nur als Host/DB-Name ausgegeben.
 *
 * Aufruf: bun --env-file=.env run scripts/_b2-prod-snapshot.ts <label>
 */
import { neon } from "@neondatabase/serverless";
import { describeDbTarget } from "../src/db/test-guard";

const label = process.argv[2] ?? "(ohne Label)";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set (run with: bun --env-file=.env run ...)");
const dbname = new URL(url).pathname.replace(/^\//, "");
if (dbname === "growimo_demo") throw new Error("refusing: this snapshot must read the PROD DB, got growimo_demo");

const sql = neon(url);
const db = await sql`SELECT current_database() AS db`;
if (db[0].db === "growimo_demo") throw new Error("WRONG DB: growimo_demo");

console.log(`— PROD-Zaehler-Snapshot [${label}] (nur SELECT) —`);
console.log("Ziel:", describeDbTarget(url), "| current_database() =", db[0].db);

const rows = await sql`
  SELECT
    (SELECT count(*)::int FROM subscriptions)               AS subscriptions,
    (SELECT count(*)::int FROM users)                       AS users,
    (SELECT count(*)::int FROM beta_signups)                AS beta_signups,
    (SELECT count(*)::int FROM usage_monthly)               AS usage_monthly,
    (SELECT count(*)::int FROM usage_events)                AS usage_events,
    (SELECT count(*)::int FROM projects)                    AS projects,
    (SELECT count(*)::int FROM analytics_events)            AS analytics_events`;
console.log(JSON.stringify(rows[0], null, 2));

const tiers = await sql`
  SELECT plan_tier, status, count(*)::int AS n
  FROM subscriptions GROUP BY plan_tier, status ORDER BY plan_tier, status`;
console.log("subscriptions nach plan_tier/status:", JSON.stringify(tiers));

const newest = await sql`
  SELECT max(created_at) AS max_created FROM subscriptions`;
console.log("subscriptions max(created_at):", newest[0].max_created);

const usersNewest = await sql`SELECT max(created_at) AS max_created FROM users`;
console.log("users max(created_at):", usersNewest[0].max_created);
