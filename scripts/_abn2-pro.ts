/* Stabilisierung Phase 5b: Pro-200-Kontingent für den synthetischen Testnutzer
 * über die ECHTE Verdrahtung (subscriptions-Zeile → qGetPlanTier →
 * getSubscriptionStatus → Usage-Guard). Kein Owner-Konto, keine Stripe-Zahlung.
 * Run: bun --env-file=.env scripts/_abn2-pro.ts <clerk_user_id>
 * Idempotent: legt höchstens eine Test-Subscription an. */
import { getDb } from "../src/db/index";
const CLERK = process.argv[2];
if (!CLERK || !CLERK.startsWith("user_")) {
  console.log("ABORT: need clerk user_id as argv[2]");
  process.exit(1);
}
if (CLERK.includes("owner") || CLERK.length < 20) {
  console.log("ABORT: suspicious id");
  process.exit(1);
}
const sql = getDb();
const meta = JSON.parse(
  (await import("fs")).readFileSync("/home/team/shared/e2e/abn2-meta.json", "utf8"),
);
if (meta.clerkId !== CLERK) {
  console.log("ABORT: clerk id does not match abn2-meta.json — refuse to touch another account");
  process.exit(1);
}
const existing: any = await sql`SELECT id FROM users WHERE clerk_id = ${CLERK} LIMIT 1`;
let userUuid: string;
if (existing.length > 0) {
  userUuid = String(existing[0].id);
  console.log("USER row exists", userUuid);
} else {
  const ins: any = await sql`INSERT INTO users (clerk_id, email, name)
    VALUES (${CLERK}, ${meta.email}, ${"E2E CDBot"}) RETURNING id`;
  userUuid = String(ins[0].id);
  console.log("USER row created", userUuid);
}
const subs: any = await sql`SELECT id, plan_tier, status FROM subscriptions WHERE user_id = ${userUuid}`;
console.log("SUB before", JSON.stringify(subs));
if (subs.length === 0) {
  await sql`INSERT INTO subscriptions (user_id, plan_tier, status, current_period_end)
    VALUES (${userUuid}, 'pro', 'active', NOW() + INTERVAL '1 month')`;
  console.log("SUB inserted (pro/active)");
} else {
  console.log("SUB already present — untouched");
}
const after: any = await sql`SELECT plan_tier, status FROM subscriptions WHERE user_id = ${userUuid} AND status = 'active' ORDER BY created_at DESC LIMIT 1`;
console.log("SUB after", JSON.stringify(after));
const usage: any = await sql`SELECT period, count FROM usage_monthly WHERE user_id = ${userUuid}`;
console.log("USAGE", JSON.stringify(usage));
