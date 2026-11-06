/**
 * B2-DB-SUITE (2026-11-06) — Restzeilen-Pruefung der Demo-DB, NUR LESEND.
 *
 * Zaehlt die Tabellen, die die Suite beschreibt, und sucht gezielt nach
 * Suite-Fingerabdruecken (clerk_id 'wh-…', stripe_subscription_id 'sub_…',
 * beta_signups 'wh-…@example.com').
 *
 * Aufruf: bun --env-file=/tmp/b2/demo.env run scripts/_b2-demo-counts.ts <label>
 */
import { neon } from "@neondatabase/serverless";

const label = process.argv[2] ?? "(ohne Label)";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
const dbname = new URL(url).pathname.replace(/^\//, "");
if (dbname !== "growimo_demo") throw new Error(`refusing: target is ${dbname}, not growimo_demo`);

const sql = neon(url);
const who = await sql`SELECT current_database() AS db`;
console.log(`— Demo-DB Zaehler [${label}] —`);
console.log("current_database() =", who[0].db);

const counts = await sql`
  SELECT
    (SELECT count(*)::int FROM subscriptions)  AS subscriptions,
    (SELECT count(*)::int FROM users)          AS users,
    (SELECT count(*)::int FROM beta_signups)   AS beta_signups,
    (SELECT count(*)::int FROM beta_entitlements) AS beta_entitlements,
    (SELECT count(*)::int FROM usage_monthly)  AS usage_monthly,
    (SELECT count(*)::int FROM usage_events)   AS usage_events,
    (SELECT count(*)::int FROM projects)       AS projects,
    (SELECT count(*)::int FROM analytics_events) AS analytics_events`;
console.log(JSON.stringify(counts[0], null, 2));

const whUsers = await sql`SELECT count(*)::int AS n FROM users WHERE clerk_id LIKE 'wh-%'`;
console.log("Restzeilen users clerk_id 'wh-%'        :", whUsers[0].n);
const whSubs = await sql`SELECT count(*)::int AS n FROM subscriptions WHERE stripe_subscription_id LIKE 'sub_%'`;
console.log("Restzeilen subscriptions 'sub_%'        :", whSubs[0].n);
const whBeta = await sql`SELECT count(*)::int AS n FROM beta_signups WHERE email LIKE 'wh-%'`;
console.log("Restzeilen beta_signups 'wh-%'          :", whBeta[0].n);

const subRows = await sql`
  SELECT stripe_subscription_id, plan_tier, status FROM subscriptions ORDER BY created_at`;
console.log("subscriptions:", JSON.stringify(subRows));
const userRows = await sql`SELECT clerk_id, created_at FROM users ORDER BY created_at`;
console.log("users:", JSON.stringify(userRows));
