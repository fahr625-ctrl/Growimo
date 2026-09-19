import { getDb } from "../src/db/index";
const CLERK = process.argv[2] || "";
const sql = getDb();
const u: any = await sql`SELECT id, clerk_id, email FROM users WHERE clerk_id = ${CLERK}`;
console.log("USERS", JSON.stringify(u));
if (u[0]) {
  const rows: any = await sql`SELECT user_id, period, count FROM usage_monthly WHERE user_id = ${u[0].id}`;
  console.log("USAGE", JSON.stringify(rows));
}
const sub: any = await sql`SELECT plan_tier, status FROM subscriptions s JOIN users uu ON uu.id = s.user_id WHERE uu.clerk_id = ${CLERK}`;
console.log("SUB", JSON.stringify(sub));
