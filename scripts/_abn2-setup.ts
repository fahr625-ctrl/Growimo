/* Stabilisierung Phase 5b (Tests C/D/F): neuer synthetischer Clerk-Nutzer +
 * Beta-Approval + Sign-in-Token. Owner-Konto bleibt unberührt.
 * Run: bun --env-file=.env scripts/_abn2-setup.ts
 * Schreibt: /home/team/shared/e2e/abn2-ticket.txt + abn2-user.txt + abn2-meta.json */
import { getDb } from "../src/db/index";
import fs from "fs";
const SECRET = process.env.CLERK_SECRET_KEY!;
const API = "https://api.clerk.com/v1";
const STAMP = Date.now().toString(36).slice(-6);
const TEST_EMAIL = `e2e-abn2-${STAMP}@ctomail.io`;
const FIRST = "E2E";
const LAST = "CDBot";
async function clerk(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SECRET}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
async function main() {
  if (!SECRET || !SECRET.startsWith("sk_test_")) {
    console.log("ABORT: no sk_test_ CLERK_SECRET_KEY in env");
    process.exit(1);
  }
  const u = await clerk("/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [TEST_EMAIL],
      first_name: FIRST,
      last_name: LAST,
      skip_password_requirement: true,
    }),
  });
  if (u.status !== 200 || !u.json?.id) {
    console.log("CREATE FAIL", u.status, (u.text || "").slice(0, 300));
    process.exit(1);
  }
  const userId: string = u.json.id;
  const email: string = u.json.email_addresses?.[0]?.email_address ?? TEST_EMAIL;
  console.log("USER", userId, email);
  const sql = getDb();
  await sql`INSERT INTO beta_signups (first_name, email, approved)
    VALUES (${FIRST + " " + LAST}, ${email}, TRUE)`;
  const beta: any = await sql`SELECT email, approved FROM beta_signups WHERE email = ${email}`;
  console.log("BETA", JSON.stringify(beta));
  const t = await clerk("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 3600 }),
  });
  if (t.status !== 200 || !t.json?.token) {
    console.log("TOKEN FAIL", t.status, (t.text || "").slice(0, 300));
    process.exit(1);
  }
  fs.mkdirSync("/home/team/shared/e2e", { recursive: true });
  fs.writeFileSync("/home/team/shared/e2e/abn2-ticket.txt", t.json.token);
  fs.writeFileSync("/home/team/shared/e2e/abn2-user.txt", userId);
  fs.writeFileSync(
    "/home/team/shared/e2e/abn2-meta.json",
    JSON.stringify({ clerkId: userId, email, createdAt: new Date().toISOString() }, null, 2),
  );
  console.log("OK TOKEN_LEN", t.json.token.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
