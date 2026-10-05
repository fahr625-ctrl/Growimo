/* Reset the monthly usage counter of a SYNTHETIC test user to 0.
 * Run: bun --env-file=.env scripts/_mobile-e2e/reset-usage.ts <clerk_user_id>
 *
 * Why: synthetic E2E users are throwaway accounts (never the owner account).
 * The Free tier allows 5 generations per month; a mobile E2E run needs a few.
 * This script ONLY touches usage_monthly of the given clerk_id and prints the
 * before/after rows so the reset is provable in the evidence.
 */
import { getDb } from "../../src/db/index";

const sql = getDb();
const clerkId = process.argv[2];
if (!clerkId) {
  console.log("usage: bun --env-file=.env scripts/_mobile-e2e/reset-usage.ts <clerkUserId>");
  process.exit(1);
}

const u: any = await sql`SELECT id FROM users WHERE clerk_id = ${clerkId} LIMIT 1`;
if (!u.length) {
  console.log(JSON.stringify({ clerkId, userFound: false }));
  process.exit(0);
}
const uid = u[0].id;
const before: any = await sql`SELECT period, count FROM usage_monthly WHERE user_id = ${uid} ORDER BY period`;
await sql`DELETE FROM usage_monthly WHERE user_id = ${uid}`;
const after: any = await sql`SELECT period, count FROM usage_monthly WHERE user_id = ${uid} ORDER BY period`;
console.log(JSON.stringify({ clerkId, internalUserId: uid, reset: true, before, after }, null, 2));
