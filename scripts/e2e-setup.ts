/* E2E test setup: create a Clerk test user, mark approved in beta_signups,
 * and mint a sign-in token. Prints results for the browser login step.
 *
 * ⚠️ SEIT 2026-10-12 (Owner-Sicherheitsregel): Für E2E-Logins stattdessen
 * `scripts/e2e-testkonto.ts` verwenden — es nutzt das dedizierte, dauerhafte
 * Testkonto (user_3KbZIeGa0b1MWX0NvZrUCXRcgA8 / growimo-e2e@ctomail.io) in der
 * PRODUCTION-Clerk-Instanz (CLERK_SECRET_KEY_PROD) und schreibt
 * /home/team/shared/e2e/testkonto.env. Dieses Skript hier legt bei jedem Aufruf
 * ein eigenes Wegwerf-Konto an und liest CLERK_SECRET_KEY (Development-Instanz
 * aus der lokalen .env) — Tokens daraus funktionieren auf www.growimo.app nicht.
 * Das Owner-Konto darf nicht mehr für Tests verwendet werden.
 * Doku: /home/team/shared/e2e/README-2026-10-12.md */
import { getDb } from "../src/db/index";

const SECRET = process.env.CLERK_SECRET_KEY!;
const API = "https://api.clerk.com/v1";
const TEST_EMAIL = "e2e-pinterest@ctomail.io";
const TEST_NAME = "E2E Pinterest Tester";

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
  // 1. Create the user (idempotent)
  let user = await clerk("/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [TEST_EMAIL],
      first_name: "E2E",
      last_name: "Pinterest Tester",
      skip_password_requirement: true,
    }),
  });
  console.log("CREATE USER status:", user.status);
  let userId: string | null = null;
  if (user.json && user.json.id) {
    userId = user.json.id;
    console.log("USER ID:", userId);
  } else {
    // Already exists — find it
    const list = await clerk(`/users?email_address=${TEST_EMAIL}`);
    if (list.json && list.json.data && list.json.data.length) {
      userId = list.json.data[0].id;
      console.log("FOUND existing USER ID:", userId);
    } else {
      console.log("WARN could not find user: ", list.text);
    }
  }

  // 2. Ensure beta_signups approved row (explicit approved = TRUE)
  // Beta-Ende (Owner-Auftrag 2026-10-08): `approved` MUSS hier explizit TRUE sein —
    // der DB-Default ist jetzt FALSE (keine Auto-Freischaltung mehr). Ohne diesen
    // expliziten Wert gäbe es für den Testnutzer keinen BETA50-Rabatt mehr.
  if (process.env.DATABASE_URL) {
    const sql = getDb();
    await sql`
      INSERT INTO beta_signups (first_name, email, approved)
      VALUES (${TEST_NAME}, ${TEST_EMAIL}, TRUE)
      ON CONFLICT DO UPDATE SET approved = TRUE
    `.catch((e) => {
      // no unique constraint likely; just insert
      return sql`
        INSERT INTO beta_signups (first_name, email, approved)
        VALUES (${TEST_NAME}, ${TEST_EMAIL}, TRUE)
      `;
    });
    const check = await sql`SELECT id, email, approved FROM beta_signups WHERE LOWER(email)=${TEST_EMAIL}`;
    console.log("BETA_SIGNUPS row:", JSON.stringify(check));
  } else {
    console.log("NO DATABASE_URL in env");
  }

  // 3. Mint sign-in token
  if (userId) {
    const tok = await clerk("/sign_in_tokens", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, expires_in_seconds: 3600 }),
    });
    console.log("SIGN_IN_TOKEN status:", tok.status);
    console.log("SIGN_IN_TOKEN body:", tok.text);
  }
}

main().catch((e) => { console.error("ERR", e); process.exit(1); });
