// ─────────────────────────────────────────────────────────────────────────────
// MIGRATIONS-PRÜFUNG AUF EINER WEGWERF-DB (Owner-Auftrag 2026-11-05, §17.1.6)
// ─────────────────────────────────────────────────────────────────────────────
// Läuft NUR gegen eine lokale Postgres-Instanz (DATABASE_URL muss auf
// 127.0.0.1/localhost zeigen) — die Prod-DB wird von diesem Skript nicht
// berührt, es bricht sonst ab.
//
// Beweist in dieser Reihenfolge:
//   1. ALTES Schema (master) spielt ein und akzeptiert 'free'/'pro'
//   2. NEUES Schema (dieser Branch) spielt über die ECHTE initDb-Statement-Liste
//      (splitSqlStatements) ein
//   3. Bestandszeilen sind danach unverändert (Werte + Anzahl)
//   4. Der CHECK akzeptiert 'video' und 'video_plus' und lehnt 'premium' ab (23514)
//   5. Das neue Schema ist IDEMPOTENT (zweiter Lauf, Diff der Constraint-Def. leer)
//   6. beta_entitlements: ON CONFLICT DO NOTHING idempotent, ON DELETE CASCADE wirkt
//   7. discount_coupon_id ist nullable, ohne Default
//   8. ROLLBACK funktioniert — und VERWEIGERT, solange eine 'video'-Zeile existiert
//
// Aufruf: bun scripts/tarife-migration-wegwerf-db.ts
// ─────────────────────────────────────────────────────────────────────────────
import { SQL } from "bun";
import { readFileSync } from "node:fs";
import { splitSqlStatements } from "../src/db/sql-split";

const BASE = process.env.PG_BASE_URL || "postgresql://postgres@127.0.0.1:55432";
if (!/127\.0\.0\.1|localhost/.test(BASE)) {
  console.error("ABBRUCH: Dieses Skript läuft nur gegen eine lokale Wegwerf-DB.");
  process.exit(2);
}

const DB = "growimo_mig_wegwerf";
const admin = new SQL(`${BASE}/postgres`);

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`  ✓ PASS: ${label}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${detail === undefined ? "" : " → " + JSON.stringify(detail)}`);
  }
}

async function errCode(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as { errno?: string; code?: string }).errno ?? (e as { code?: string }).code ?? String(e);
  }
}

const oldSql = readFileSync("/tmp/schema-old.sql", "utf8");
const newSql = readFileSync("/tmp/schema-new.sql", "utf8");

console.log("— Tarif-Migration auf Wegwerf-DB (" + DB + ") —\n");

await admin.unsafe(`DROP DATABASE IF EXISTS ${DB}`);
await admin.unsafe(`CREATE DATABASE ${DB}`);
const sql = new SQL(`${BASE}/${DB}`);

// 1) Altes Schema
console.log("[1] Altes Schema (master) einspielen");
for (const stmt of splitSqlStatements(oldSql).statements) await sql.unsafe(stmt);
const oldDef = (await sql`
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid = 'subscriptions'::regclass AND conname = 'subscriptions_plan_tier_check'
`) as Array<{ def: string }>;
check("alter CHECK ist ('free','pro')", /free.*pro/.test(oldDef[0]?.def ?? "") && !/video/.test(oldDef[0]?.def ?? ""), oldDef[0]?.def);

// 2) Bestandszeilen anlegen (wie in Prod: alle 'pro', plus 'free')
const u = async (email: string) =>
  ((await sql`INSERT INTO users (email, clerk_id) VALUES (${email}, ${"clerk-" + email}) RETURNING id`) as Array<{ id: string }>)[0].id;
const uA = await u("mig-a@example.test");
const uB = await u("mig-b@example.test");
const uC = await u("mig-c@example.test");
await sql`INSERT INTO subscriptions (user_id, plan_tier, status, stripe_customer_id, stripe_subscription_id)
          VALUES (${uA}, 'free', 'expired', 'cus_test_e2e_probe', 'sub_e2e_probe')`;
await sql`INSERT INTO subscriptions (user_id, plan_tier, status, stripe_customer_id, stripe_subscription_id)
          VALUES (${uB}, 'pro', 'expired', 'cus_VGnsrR8kAH1WWO', 'sub_1UGGH9CcIt8AuaKqEdYy3F7p')`;
await sql`INSERT INTO subscriptions (user_id, plan_tier, status, stripe_customer_id, stripe_subscription_id)
          VALUES (${uC}, 'pro', 'active', 'cus_VOgqXAMdozrKwF', 'sub_1UNtUMCcIt8AuaKq0nSDylRi')`;

const snap = async () =>
  (await sql`SELECT plan_tier, status, count(*)::int AS n FROM subscriptions GROUP BY 1,2 ORDER BY 1,2`) as Array<Record<string, unknown>>;
const before = JSON.stringify(await snap());
check("Bestand vor Migration: 3 Zeilen (1 free, 2 pro)", (await sql`SELECT count(*)::int AS n FROM subscriptions` as Array<{ n: number }>)[0].n === 3);

// 3) Neues Schema — über die ECHTE initDb-Statement-Liste
console.log("\n[2] Neues Schema über splitSqlStatements (das, was initDb sendet)");
const splitRes = splitSqlStatements(newSql);
const stmts = splitRes.statements;
let applyErr: string | null = null;
try {
  for (const stmt of stmts) await sql.unsafe(stmt);
} catch (e) {
  applyErr = String(e);
}
check(`neues Schema spielt ein (${stmts.length} Statements, 0 Split-Issues)`, applyErr === null && splitRes.issues.length === 0, { applyErr, issues: splitRes.issues });

const newDef = (await sql`
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid = 'subscriptions'::regclass AND conname = 'subscriptions_plan_tier_check'
`) as Array<{ def: string }>;
check("CHECK erweitert um video/video_plus", /video_plus/.test(newDef[0]?.def ?? "") && /'video'/.test(newDef[0]?.def ?? ""), newDef[0]?.def);

// 4) Bestand unverändert
console.log("\n[3] Bestand unverändert");
const after = JSON.stringify(await snap());
check("Zeilen/Werte identisch vor↔nach", before === after, { before, after });

// 5) Neue Werte
console.log("\n[4] Neue Tarif-Werte");
const e1 = await errCode(async () => sql`INSERT INTO subscriptions (user_id, plan_tier, status) VALUES (${uA}, 'video', 'active')`);
check("'video' wird akzeptiert", e1 === null, e1);
const e2 = await errCode(async () => sql`INSERT INTO subscriptions (user_id, plan_tier, status) VALUES (${uA}, 'video_plus', 'active')`);
check("'video_plus' wird akzeptiert", e2 === null, e2);
const e3 = await errCode(async () => sql`INSERT INTO subscriptions (user_id, plan_tier, status) VALUES (${uA}, 'premium', 'active')`);
check("'premium' wird abgelehnt (23514)", e3 === "23514", e3);

// 6) Idempotenz
console.log("\n[5] Idempotenz (zweiter Lauf)");
const beforeRows = JSON.stringify(await snap());
let applyErr2: string | null = null;
try {
  for (const stmt of splitSqlStatements(newSql).statements) await sql.unsafe(stmt);
} catch (e) {
  applyErr2 = String(e);
}
const newDef2 = (await sql`
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid = 'subscriptions'::regclass AND conname = 'subscriptions_plan_tier_check'
`) as Array<{ def: string }>;
check("zweiter Lauf ohne Fehler", applyErr2 === null, applyErr2);
check("Constraint-Definition unverändert", newDef2[0]?.def === newDef[0]?.def, newDef2[0]?.def);
check("keine Zeile verändert/dupliziert", beforeRows === JSON.stringify(await snap()));
check("genau EIN plan_tier-CHECK", ((await sql`
  SELECT count(*)::int AS n FROM pg_constraint
  WHERE conrelid = 'subscriptions'::regclass AND conname = 'subscriptions_plan_tier_check'`) as Array<{ n: number }>)[0].n === 1);

// 7) Neue Spalte / neue Tabelle
console.log("\n[6] Neue Spalte + Tabelle");
const col = (await sql`
  SELECT is_nullable, column_default FROM information_schema.columns
  WHERE table_name = 'subscriptions' AND column_name = 'discount_coupon_id'`) as Array<{ is_nullable: string; column_default: string | null }>;
check("discount_coupon_id existiert, nullable, ohne Default", col.length === 1 && col[0].is_nullable === "YES" && col[0].column_default === null, col);

const ins = await sql`INSERT INTO beta_entitlements (user_id, email, entitled, coupon_id) VALUES (${uB}, 'mig-b@example.test', TRUE, 'BETA50PRO')
                      ON CONFLICT (user_id) DO NOTHING RETURNING user_id`;
const ins2 = await sql`INSERT INTO beta_entitlements (user_id, email, entitled) VALUES (${uB}, 'andere@example.test', TRUE)
                       ON CONFLICT (user_id) DO NOTHING RETURNING user_id`;
check("beta_entitlements: erster Insert schreibt, zweiter nicht", ins.length === 1 && ins2.length === 0);
check("beta_entitlements: genau 1 Zeile, E-Mail bleibt die ursprüngliche",
  ((await sql`SELECT email FROM beta_entitlements WHERE user_id = ${uB}`) as Array<{ email: string }>)[0]?.email === "mig-b@example.test");
await sql`DELETE FROM users WHERE id = ${uB}`;
check("ON DELETE CASCADE: Anspruch verschwindet mit dem Konto",
  ((await sql`SELECT count(*)::int AS n FROM beta_entitlements`) as Array<{ n: number }>)[0].n === 0);

// 8) Rollback
console.log("\n[7] Rollback");
const rb = Bun.spawnSync(["bun", "scripts/tarife-rollback.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: `${BASE}/${DB}` },
  stdout: "pipe",
  stderr: "pipe",
});
check("Rollback VERWEIGERT, solange 'video'-Zeilen existieren (exit 3)", rb.exitCode === 3, {
  exit: rb.exitCode, out: rb.stdout.toString().slice(0, 200), err: rb.stderr.toString().slice(0, 200),
});
check("CHECK nach verweigertem Rollback unverändert (video noch erlaubt)",
  /video_plus/.test((((await sql`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'subscriptions'::regclass AND conname = 'subscriptions_plan_tier_check'`) as Array<{ def: string }>)[0]?.def) ?? ""));

await sql`DELETE FROM subscriptions WHERE plan_tier IN ('video','video_plus')`;
const rowsBeforeRb = JSON.stringify(await snap());
const rb2 = Bun.spawnSync(["bun", "scripts/tarife-rollback.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: `${BASE}/${DB}` },
  stdout: "pipe",
  stderr: "pipe",
});
check("Rollback läuft nach Entfernen der Video-Zeilen (exit 0)", rb2.exitCode === 0, {
  exit: rb2.exitCode, err: rb2.stderr.toString().slice(0, 300),
});
const rbDef = (await sql`
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid = 'subscriptions'::regclass AND conname = 'subscriptions_plan_tier_check'`) as Array<{ def: string }>;
check("CHECK wieder ('free','pro')", /free.*pro/.test(rbDef[0]?.def ?? "") && !/video/.test(rbDef[0]?.def ?? ""), rbDef[0]?.def);
check("Bestandszeilen nach Rollback unverändert", rowsBeforeRb === JSON.stringify(await snap()));
check("beta_entitlements entfernt", ((await sql`
  SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'beta_entitlements'`) as Array<{ n: number }>)[0].n === 0);
check("discount_coupon_id entfernt", ((await sql`
  SELECT count(*)::int AS n FROM information_schema.columns
  WHERE table_name = 'subscriptions' AND column_name = 'discount_coupon_id'`) as Array<{ n: number }>)[0].n === 0);

const rb3 = Bun.spawnSync(["bun", "scripts/tarife-rollback.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: `${BASE}/${DB}` },
  stdout: "pipe",
  stderr: "pipe",
});
check("Rollback ist idempotent (zweiter Lauf exit 0)", rb3.exitCode === 0, { exit: rb3.exitCode });

console.log(`\n=== tarife-migration-wegwerf-db: ${pass} PASS, ${fail} FAIL ===`);
await sql.close();
await admin.unsafe(`DROP DATABASE IF EXISTS ${DB}`);
await admin.close();
process.exit(fail === 0 ? 0 : 1);
