// ─────────────────────────────────────────────────────────────────────────────
// ROLLBACK der Tarif-Migration (Owner-Auftrag 2026-11-05, §17.1.5)
// ─────────────────────────────────────────────────────────────────────────────
// NIMMT ZURÜCK, WAS schema.ts ADDITIV HINZUGEFÜGT HAT:
//   1. plan_tier-CHECK zurück auf ('free','pro')
//   2. subscriptions.discount_coupon_id entfernen
//   3. beta_entitlements entfernen
//
// REIHENFOLGE IST ABSICHT: der CHECK zuerst. Enthält die Tabelle eine Zeile
// 'video' oder 'video_plus', schlägt das ADD fehl und der Lauf bricht ab, BEVOR
// Spalten/Tabellen verschwinden. Genau das ist gewünscht: die Rücknahme ist nur
// zulässig, solange kein Kunde einen Video-Tarif hat (§17.1.5).
//
// Der Verlust von beta_entitlements ist unkritisch: die Zeilen entstehen beim
// nächsten Checkout erneut aus beta_signups (Freeze beim ersten Gebrauch).
//
// Aufruf:  DATABASE_URL=postgres://… bun scripts/tarife-rollback.ts
// Idempotent: zweimal ausführbar.
// ─────────────────────────────────────────────────────────────────────────────
import { SQL } from "bun";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt");
  process.exit(2);
}

const sql = new SQL(url);

const blocking = (await sql`
  SELECT plan_tier, count(*)::int AS n FROM subscriptions
  WHERE plan_tier NOT IN ('free', 'pro') GROUP BY 1
`) as Array<{ plan_tier: string; n: number }>;

if (blocking.length > 0) {
  console.error(
    "ROLLBACK VERWEIGERT: es existieren Video-Tarif-Zeilen " +
      JSON.stringify(blocking) +
      " — die Constraint kann nicht zurückgenommen werden, ohne Kunden den Tarif zu nehmen.",
  );
  await sql.close();
  process.exit(3);
}

await sql`ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_tier_check`;
await sql`ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_tier_check
  CHECK (plan_tier IN ('free', 'pro'))`;
await sql`ALTER TABLE subscriptions DROP COLUMN IF EXISTS discount_coupon_id`;
await sql`DROP TABLE IF EXISTS beta_entitlements`;

const def = (await sql`
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid = 'subscriptions'::regclass AND conname = 'subscriptions_plan_tier_check'
`) as Array<{ def: string }>;
console.log("ROLLBACK OK — CHECK jetzt: " + (def[0]?.def ?? "(fehlt)"));
await sql.close();
