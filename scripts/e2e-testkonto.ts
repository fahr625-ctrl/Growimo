/* ============================================================================
 * Growimo — DEDIZIERTES E2E-TESTKONTO (Owner-Sicherheitsregel 2026-10-12)
 * ----------------------------------------------------------------------------
 * Ab sofort laufen ALLE automatisierten Browser-/E2E-Tests gegen dieses
 * Testkonto — NIE mehr gegen das Owner-Konto (k.bokel@web.de /
 * user_3KQScMnVPi30zj12OTNSJluvNvK). Das Owner-Konto ist für Tests tabu.
 *
 * Ausführen (Production-Clerk-Instanz, invite-only):
 *   source /etc/profile.d/cto-env-vars.sh
 *   cd /home/team/shared/site
 *   bun --env-file=.env run scripts/e2e-testkonto.ts ensure    # Konto anlegen (idempotent) + Credentials schreiben
 *   bun --env-file=.env run scripts/e2e-testkonto.ts token     # Sign-in-Token minten -> /home/team/shared/e2e/.ticket
 *   bun --env-file=.env run scripts/e2e-testkonto.ts show      # Status/Nachweis (kein Secret-Output)
 *   bun --env-file=.env run scripts/e2e-testkonto.ts betarow   # beta_signups-Zeile (approved=true) — nur diese eine Zeile
 *
 * Secret: CLERK_SECRET_KEY_PROD (sk_live_, Production-Instanz) aus
 * /etc/profile.d/cto-env-vars.sh. Bewusst NICHT CLERK_SECRET_KEY aus der
 * lokalen .env (das ist die Development-Instanz). Das Skript bevorzugt PROD.
 *
 * DB: DATABASE_URL (Prod-Neon). Nur SELECT + der eine dokumentierte INSERT
 * der Testkonto-Zeile. Owner-Daten werden nicht angefasst.
 * ==========================================================================*/
import { getDb } from "../src/db/index";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";

const API = "https://api.clerk.com/v1";
const SECRET = process.env.CLERK_SECRET_KEY_PROD ?? "";
const SHARED = "/home/team/shared/e2e";
const ENV_FILE = `${SHARED}/testkonto.env`;
const TICKET_FILE = `${SHARED}/.ticket`;

const TEST_EMAIL = process.env.TEST_EMAIL ?? "growimo-e2e@ctomail.io";
const TEST_FIRST = "Growimo";
const TEST_LAST = "E2E-Test";
const SOURCE = "e2e-testkonto-2026-10-12";

function die(m: string): never { console.error("ERR " + m); process.exit(1); }

function assertProdKey(): void {
  if (!SECRET) die("CLERK_SECRET_KEY_PROD fehlt. `source /etc/profile.d/cto-env-vars.sh` zuerst ausführen.");
  if (!SECRET.startsWith("sk_live_")) die("CLERK_SECRET_KEY_PROD ist kein Production-Key (sk_live_ erwartet). Abbruch — das Testkonto muss in der Production-Instanz liegen.");
}

async function clerk(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

function genPassword(): string {
  // 24 Zeichen base64url + garantiert alle Zeichenklassen (Clerk-Anforderungen)
  return randomBytes(18).toString("base64url") + "!Aa7";
}

function readTestkontoEnv(): Record<string, string> {
  if (!existsSync(ENV_FILE)) die(`${ENV_FILE} fehlt — erst 'ensure' ausführen.`);
  const out: Record<string, string> = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Konto per E-Mail finden (Production-Instanz). */
async function findUser(email: string): Promise<any | null> {
  const r = await clerk(`/users?email_address=${encodeURIComponent(email)}`);
  if (r.status !== 200) return null;
  const list = Array.isArray(r.json) ? r.json : r.json?.data ?? [];
  return list.find((u: any) =>
    (u.email_addresses || []).some((e: any) => (e.email_address || "").toLowerCase() === email.toLowerCase())
  ) ?? null;
}

async function cmdEnsure(): Promise<void> {
  assertProdKey();
  mkdirSync(SHARED, { recursive: true, mode: 0o700 });

  let user = await findUser(TEST_EMAIL);
  let password: string | null = null;

  if (user) {
    console.log("EXISTS user_id=" + user.id);
    // Passwort nicht neu setzen (Idempotenz) — Vorhandenes aus testkonto.env behalten.
    if (existsSync(ENV_FILE)) {
      const cur = readTestkontoEnv();
      if (cur.TEST_PASSWORD) password = cur.TEST_PASSWORD;
    }
  } else {
    password = genPassword();
    const c = await clerk("/users", {
      method: "POST",
      body: JSON.stringify({
        email_address: [TEST_EMAIL],
        password,
        first_name: TEST_FIRST,
        last_name: TEST_LAST,
      }),
    });
    console.log("CREATE status=" + c.status);
    if (c.status >= 300 || !c.json?.id) {
      console.log("CREATE body: " + c.text.slice(0, 400));
      die("Testkonto konnte nicht angelegt werden.");
    }
    user = c.json;
    console.log("CREATED user_id=" + user.id);
  }

  const userId: string = user.id;
  const email: string = user.email_addresses?.[0]?.email_address ?? TEST_EMAIL;

  const env =
    `# Growimo E2E-TESTKONTO — NUR für automatisierte Tests — KEIN Owner-Konto!\n` +
    `# Angelegt ${new Date().toISOString().slice(0, 10)} per scripts/e2e-testkonto.ts (${SOURCE}).\n` +
    `# Owner-Sicherheitsregel 2026-10-12: Owner-Konto (k.bokel@web.de) ist für Tests tabu.\n` +
    `# NICHT ins Repo committen. chmod 600.\n` +
    `TEST_USER_ID=${userId}\n` +
    `TEST_EMAIL=${email}\n` +
    `TEST_PASSWORD=${password ?? "(nicht gesetzt — Nutzer existierte bereits; Token-Login nutzen)"}\n` +
    `CLERK_INSTANCE=production\n` +
    `CLERK_API_BASE=${API}\n` +
    `NOTIZ="NUR für automatisierte Tests — kein Owner-Konto"\n`;
  writeFileSync(ENV_FILE, env, { mode: 0o600 });
  chmodSync(ENV_FILE, 0o600);
  console.log("WROTE " + ENV_FILE + " (mode 600)");
  console.log("TEST_USER_ID=" + userId);
  console.log("TEST_EMAIL=" + email);
  console.log("PASSWORD_LEN=" + (password ? password.length : 0));
}

async function cmdToken(): Promise<void> {
  assertProdKey();
  const env = readTestkontoEnv();
  const userId = process.env.TEST_USER_ID || env.TEST_USER_ID;
  if (!userId) die("TEST_USER_ID fehlt (testkonto.env).");
  const r = await clerk("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 3600 }),
  });
  if (r.status !== 200 || !r.json?.token) { console.log("BODY " + r.text.slice(0, 300)); die("Token-Mint fehlgeschlagen (status " + r.status + ")."); }
  writeFileSync(TICKET_FILE, r.json.token, { mode: 0o600 });
  chmodSync(TICKET_FILE, 0o600);
  console.log(`TOKEN_OK user_id=${userId} len=${r.json.token.length} file=${TICKET_FILE}`);
}

async function cmdBetarow(): Promise<void> {
  if (!process.env.DATABASE_URL) die("DATABASE_URL fehlt (bun --env-file=.env).");
  const env = readTestkontoEnv();
  const email = process.env.TEST_EMAIL || env.TEST_EMAIL;
  if (!email) die("TEST_EMAIL fehlt.");
  const sql = getDb();

  const before = await sql`select id, first_name, email, approved, created_at from beta_signups where lower(email) = lower(${email})`;
  console.log("BEFORE rows=" + before.length + " " + JSON.stringify(before));
  if (before.length === 0) {
    await sql`
      INSERT INTO beta_signups (first_name, email, approved)
      VALUES (${TEST_FIRST + " " + TEST_LAST}, ${email}, TRUE)
    `;
    console.log("INSERTED beta_signups row for " + email + " (approved=true, source=" + SOURCE + ")");
  } else {
    console.log("KNOWN row exists — kein zweiter INSERT (Idempotenz).");
  }
  const after = await sql`select id, first_name, email, approved, created_at from beta_signups where lower(email) = lower(${email})`;
  console.log("AFTER rows=" + after.length + " " + JSON.stringify(after));
  const n = await sql`select count(*)::int as n from beta_signups`;
  console.log("beta_signups total=" + n[0].n);
}

async function cmdShow(): Promise<void> {
  assertProdKey();
  const env = readTestkontoEnv();
  const r = await clerk(`/users/${env.TEST_USER_ID}`);
  const u = r.json ?? {};
  console.log(JSON.stringify({
    TEST_USER_ID: env.TEST_USER_ID,
    TEST_EMAIL: env.TEST_EMAIL,
    clerk_status: r.status,
    found: !!u.id,
    first_name: u.first_name, last_name: u.last_name,
    has_password: (u.password_enabled ?? null),
    emails: (u.email_addresses || []).map((e: any) => e.email_address),
    banned: u.banned ?? null,
    created_at: u.created_at,
  }, null, 1));
  if (process.env.DATABASE_URL) {
    const sql = getDb();
    const rows = await sql`select id, email, clerk_id, name, created_at from users where lower(email)=lower(${env.TEST_EMAIL})`;
    console.log("users row: " + JSON.stringify(rows));
    const beta = await sql`select id, email, approved from beta_signups where lower(email)=lower(${env.TEST_EMAIL})`;
    console.log("beta_signups row: " + JSON.stringify(beta));
  }
}

const cmd = process.argv[2] || "show";
const table: Record<string, () => Promise<void>> = {
  ensure: cmdEnsure, token: cmdToken, betarow: cmdBetarow, show: cmdShow,
};
const fn = table[cmd];
if (!fn) die("Unbekanntes Kommando: " + cmd + " (ensure|token|betarow|show)");
fn().catch((e) => die(e?.message ?? String(e)));
