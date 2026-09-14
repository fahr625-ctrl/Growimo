// ─────────────────────────────────────────────────────────────────────────────
// Phase 8.3c — Stripe-Testmodus-E2E (KOMPLETT, KEIN Production-Deploy)
// ─────────────────────────────────────────────────────────────────────────────
// Ziel: lokale Instanz (stripe83-local-server.ts) + echte Neon-DB + echte
// Clerk-Sessions. Zwei Modi:
//
//   OHNE  STRIPE_SECRET_KEY (aktuell): läuft alles, was keinen Stripe-Schlüssel
//     braucht — Webhook-HTTP-Matrix (Signaturen 200/400/405/500-fail-closed),
//     Webhook-Erfolgspfad via signierten customer.subscription.updated-Events
//     (DB-Zeile + Idempotenz), Abo-Status/Guard-ServerFn (tier pro/200, free/5,
//     beta), Checkout/Portal-Fail-closed. Key-abhängige Checks → SKIP (belegt,
//     dass der Code ohne Key sauber fail-closed statt zu crashen).
//   MIT   STRIPE_SECRET_KEY: zusätzlich der volle echte Pfad — idempotentes
//     Anlegen/Verifizieren von Product „Growimo Pro", Preisen pro_monthly
//     19 €/pro_yearly 190 €, Coupon BETA50 (50 %, forever) + Promotion-Code
//     BETA50; Checkout-Sessions inkl. Beta-50-% (amount_total 950); Webhook mit
//     ECHTEN Stripe-Objekten (customer + subscription per API), Portal-URL.
//
// Usage (Repo-Wurzel; .env = echte DB/CLERK-Keys; STRIPE_WEBHOOK_SECRET wird
// lokal generiert, KEIN Secret wird ausgegeben):
//   bun --env-file=.env stripe83-e2e.ts
// Exit-Code 0 nur wenn 0 FAIL (SKIP zählt nicht als Fehler).
// ─────────────────────────────────────────────────────────────────────────────
import { toJSONAsync } from "seroval";
import { getDb } from "./src/db/index";
import {
  qUpsertSubscription,
  qGetSubscriptionByStripeId,
  qGetSubscriptionForUser,
  qGetPlanTier,
  qGetCustomerIdForUser,
  qGetUserEmailByClerkId,
  ensureUserRow,
} from "./src/db/queries";
import { getUsageInfo } from "./src/lib/usage-guard";
import { isBetaUserEmail } from "./src/api/beta";
import { STRIPE_WEBHOOK_PATH } from "./src/api/stripe-webhook";

const RUN = Date.now().toString(36).slice(-6);
const PORT_A = Number(process.env.E2E_PORT_A ?? 3188);
const PORT_B = PORT_A + 1; // Instanz OHNE STRIPE_WEBHOOK_SECRET (fail-closed-500)
const BASE_A = `http://127.0.0.1:${PORT_A}`;
const BASE_B = `http://127.0.0.1:${PORT_B}`;

// ServerFn-IDs aus dem aktuellen Build (dist, deterministisch pro Code-Stand):
const FN_CHECKOUT = "a4b324efe2ab35926848c9344b3c872eabb6dc48d1b0f7e38cb26ff946fade3f";
const FN_PORTAL = "89ea514fb0d9a98f1f71f547acb9b6766f3b8a629eb93f6215ac779e285fcff1";
const FN_STATUS = "fd63f1bc35807d8aeb04eee6b0394324517a92efd4e03a3a6ccb857d07e037de";

const SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const HAS_KEY = SECRET_KEY.startsWith("sk_test_");
const WH_SECRET = `whsec_e2e_${RUN}`; // lokales Test-Secret (Aufgabe: „ODER lokales Test-Secret")

const SUFFIX = `e2e-stripe-${RUN}`;
const USERS = {
  pro: { clerkId: `user_e2e_${RUN}_pro`, email: `${SUFFIX}-pro@ctomail.io`, name: "E2E Stripe Pro" },
  beta: { clerkId: `user_e2e_${RUN}_beta`, email: `${SUFFIX}-beta@ctomail.io`, name: "E2E Stripe Beta" },
  free: { clerkId: `user_e2e_${RUN}_free`, email: `${SUFFIX}-free@ctomail.io`, name: "E2E Stripe Free" },
};
const SUB_ID = `sub_e2e_${RUN}`;
const CUS_ID = `cus_test_e2e_${RUN}`;
const PERIOD_END = Math.floor(Date.now() / 1000) + 30 * 86400; // +30 Tage

let passed = 0, failed = 0, skipped = 0;
const fails: string[] = [];
const check = (cond: boolean, label: string) => {
  if (cond) { passed += 1; console.log(`  ✓ PASS: ${label}`); }
  else { failed += 1; fails.push(label); console.log(`  ✗ FAIL: ${label}`); }
};
const skip = (label: string, why: string) => { skipped += 1; console.log(`  – SKIP: ${label} (${why})`); };

const sql = getDb();

// ── Clerk-API (echte Test-Nutzer + Session-JWTs) ─────────────────────────────
const CLERK_API = "https://api.clerk.com/v1";
async function clerk(path: string, init: RequestInit = {}) {
  const res = await fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* noop */ }
  return { status: res.status, json: json as any, text };
}
async function ensureClerkUser(u: { email: string; name: string }) {
  let res = await clerk("/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [u.email], first_name: "E2E",
      last_name: u.name.replace("E2E Stripe ", ""), skip_password_requirement: true,
    }),
  });
  if (res.status === 422 || res.status === 400) {
    const list = await clerk(`/users?email_address=${encodeURIComponent(u.email)}`);
    if (list.json?.data?.length) return String(list.json.data[0].id);
    throw new Error(`Clerk user create failed: ${res.text.slice(0, 200)}`);
  }
  if (!res.json?.id) throw new Error(`Clerk user create failed: ${res.text.slice(0, 200)}`);
  return String(res.json.id);
}
async function mintJwt(clerkId: string): Promise<string> {
  const list = await clerk(`/sessions?userId=${clerkId}`);
  let sid = list.json?.data?.find((s: any) => s.status === "active")?.id;
  if (!sid) {
    const c = await clerk("/sessions", { method: "POST", body: JSON.stringify({ user_id: clerkId }) });
    sid = c.json?.id;
  }
  if (!sid) throw new Error("Clerk session create failed");
  const tok = await clerk(`/sessions/${sid}/tokens`, { method: "POST" });
  if (!tok.json?.jwt) throw new Error("Clerk session token mint failed");
  return String(tok.json.jwt);
}
async function deleteClerkUser(clerkId: string) {
  try { await clerk(`/users/${clerkId}`, { method: "DELETE" }); } catch { /* noop */ }
}

// ── Lokale Instanzen starten/stoppen ─────────────────────────────────────────
async function spawnServer(port: number, withWhSecret: boolean) {
  // Deterministische Kind-Umgebung: KEINE geerbten Shell-Variablen (dort lauern
  // Platzhalter wie VITE_CLERK_PUBLISHABLE_KEY="[SENSITIVE]" aus dem
  // vercel-env-pull), CWD /tmp (kein Auto-Load von .env.local am Repo-Root),
  // echte Werte ausschließlich über /tmp/e2e-child.env aus der .env.
  const whsecValue = withWhSecret ? WH_SECRET : "";
  const env = {
    PATH: "/usr/bin:/bin:/usr/local/bin",
    HOME: process.env.HOME ?? "/home/agent-lead",
    PORT: String(port),
    STRIPE_WEBHOOK_SECRET: whsecValue,
    ...(HAS_KEY ? { STRIPE_SECRET_KEY: SECRET_KEY } : {}),
  };
  const proc = Bun.spawn({
    cmd: [process.execPath, "--env-file=/tmp/e2e-child.env", `${import.meta.dir}/stripe83-local-server.ts`],
    cwd: "/tmp",
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + "/", { signal: AbortSignal.timeout(2000) });
      if (r.status >= 200 && r.status < 500) return proc;
    } catch { /* not up yet */ }
    await Bun.sleep(300);
  }
  try { proc.kill(); } catch { /* noop */ }
  let childLog = "";
  try {
    childLog = await new Response(proc.stdout).text() + " | " + await new Response(proc.stderr).text();
  } catch { /* noop */ }
  throw new Error(`server on :${port} did not start — child: ${childLog.slice(0, 800)}`);
}
async function stopServer(proc: unknown) {
  try { (proc as any).kill(); } catch { /* noop */ }
}

// ── Webhook-Helfer ───────────────────────────────────────────────────────────
async function loadStripeSdk() {
  const m = await import("stripe");
  return (m as any).default ?? m;
}
async function signatureFor(payload: string, secret: string, ts = Math.floor(Date.now() / 1000)): Promise<string> {
  const Stripe = await loadStripeSdk();
  return Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: ts });
}
function eventPayload(type: string, obj: Record<string, unknown>): string {
  return JSON.stringify({ id: `evt_${RUN}_${type.replace(/\./g, "_")}`, object: "event", type, data: { object: obj } });
}
function subscriptionUpdatedObj(status: string, periodEnd: number, lookupKey = "pro_monthly") {
  return { id: SUB_ID, customer: CUS_ID, status, current_period_end: periodEnd, items: { data: [{ price: { lookup_key: lookupKey } }] } };
}
function checkoutCompletedObj(paymentStatus = "paid") {
  return {
    id: `cs_test_${RUN}`, mode: "subscription", payment_status: paymentStatus,
    client_reference_id: USERS.pro.clerkId, metadata: { userId: USERS.pro.clerkId },
    customer: CUS_ID, subscription: SUB_ID,
  };
}
async function postWebhook(base: string, payload: string, opts: { signature?: string; header?: boolean } = {}) {
  const header = opts.header === false ? null : opts.signature ?? (await signatureFor(payload, WH_SECRET));
  return fetch(`${base}${STRIPE_WEBHOOK_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(header !== null ? { "stripe-signature": header } : {}) },
    body: payload,
    signal: AbortSignal.timeout(15000),
  });
}

// ── ServerFn-Helfer (TanStack-Transport, seroval wie der echte Client) ───────
async function serverFnCall(base: string, fnId: string, opts: { method?: "GET" | "POST"; data?: unknown; cookie?: string }) {
  const isGet = opts.method === "GET";
  const body = isGet ? undefined : JSON.stringify(await toJSONAsync({ data: opts.data }));
  const res = await fetch(`${base}/_serverFn/${fnId}`, {
    method: isGet ? "GET" : "POST",
    headers: {
      "x-tsr-serverFn": "true",
      accept: "application/x-tss-framed, application/x-ndjson, application/json",
      ...(isGet ? {} : { "content-type": "application/json" }),
      ...(opts.cookie ? { cookie: `__session=${opts.cookie}` } : {}),
    },
    body,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, text, json: json as any };
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(`=== Phase 8.3c Stripe-Testmodus-E2E — RUN ${RUN} | STRIPE_SECRET_KEY ${HAS_KEY ? "SET (voller Modus)" : "NOT SET (Fail-closed-Modus)"} ===`);

const servers: unknown[] = [];
let jwt = { pro: "", beta: "", free: "" };

try {
  // ── Fixtures: echte Clerk-Nutzer + JWTs + DB-Zeilen ─────────────────────
  console.log("\n[0] Fixtures (Clerk-Nutzer, Sessions, DB)");
  for (const key of ["pro", "beta", "free"] as const) {
    const u = USERS[key];
    const clerkId = await ensureClerkUser(u);
    u.clerkId = clerkId;
    await ensureUserRow(clerkId, u.email, u.name);
    jwt[key] = await mintJwt(clerkId);
    check(jwt[key].length > 50, `Clerk-Session-JWT für ${key} gemintet (len=${jwt[key].length})`);
  }
  await sql`INSERT INTO beta_signups (first_name, email, approved) VALUES (${"E2E"}, ${USERS.beta.email}, TRUE)
            ON CONFLICT DO NOTHING`.catch(() =>
    sql`INSERT INTO beta_signups (first_name, email, approved) VALUES (${"E2E"}, ${USERS.beta.email}, TRUE)`);
  const betaRows = await sql`SELECT id FROM beta_signups WHERE LOWER(email) = ${USERS.beta.email} AND approved = TRUE`;
  check(betaRows.length === 1, "beta_signups approved-Zeile für Beta-Nutzer angelegt");
  // Pro-Nutzer: Subscription-Zeile = simulierte checkout.session.completed-Schreibung
  // (im vollen Modus erzeugt stattdessen der echte Stripe-Webhook die Zeile).
  await qUpsertSubscription({
    clerkUserId: USERS.pro.clerkId, stripeCustomerId: CUS_ID, stripeSubscriptionId: SUB_ID,
    planTier: "pro", status: "active", currentPeriodEnd: PERIOD_END,
  });
  const preRow = await qGetSubscriptionByStripeId(SUB_ID);
  check(preRow !== null && preRow.planTier === "pro" && preRow.status === "active", "Simulierte Checkout-Zeile in DB (pro/active, Grundlage für Webhook-E2E)");

  // ── Lokale Instanzen ─────────────────────────────────────────────────────
  console.log("\n[0.5] Lokale Instanz(en) starten");
  // Kind-Env-Datei aus der echten .env erzeugen (nur benötigte Variablen;
  // die .env ist gitignored und enthält keine Secret-Platzhalter).
  {
    const envFile = Bun.file(".env").text().then((t) => {
      const pick = new Map<string, string>();
      for (const line of t.split("\n")) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (!m) continue;
        const key = m[1], val = m[2].replace(/^"(.*)"$/, "$1");
        if (["DATABASE_URL", "VITE_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"].includes(key)) pick.set(key, val);
      }
      return [...pick.entries()].map(([k, v]) => `${k}=${v}`).join("\n");
    });
    await Bun.write("/tmp/e2e-child.env", await envFile);
  }
  const serverA = await spawnServer(PORT_A, true);
  servers.push(serverA);
  console.log(`  Server A (mit Webhook-Secret) auf ${BASE_A}`);
  const serverB = await spawnServer(PORT_B, false);
  servers.push(serverB);
  console.log(`  Server B (OHNE Webhook-Secret) auf ${BASE_B}`);

  // ── [1] Webhook-HTTP-Matrix ──────────────────────────────────────────────
  console.log("\n[1] Webhook-HTTP-Matrix (Signaturen/Statuscodes über echtes HTTP)");
  let res = await fetch(`${BASE_A}${STRIPE_WEBHOOK_PATH}`, { method: "GET" });
  check(res.status === 405, "GET /api/stripe-webhook → 405");
  res = await postWebhook(BASE_A, eventPayload("ping", {}), { header: false });
  check(res.status === 400, "POST ohne stripe-signature-Header → 400");
  res = await postWebhook(BASE_A, eventPayload("ping", {}), { signature: "t=1,v1=garbage" });
  check(res.status === 400, "POST mit ungültiger Signatur → 400");
  const pingPayload = eventPayload("ping", {});
  const pingSig = await signatureFor(pingPayload, WH_SECRET);
  res = await postWebhook(BASE_A, pingPayload, { signature: pingSig });
  const pingBody: any = await res.json().catch(() => null);
  check(res.status === 200 && pingBody?.received === true, "Gültige Signatur (generateTestHeaderString) + ping → 200 {received:true}");
  // Manipulierter Body: Signatur für Payload A, gesendet wird Payload B → 400
  const otherPayload = eventPayload("ping", { id: "tampered" });
  res = await postWebhook(BASE_A, otherPayload, { signature: pingSig });
  check(res.status === 400, "Manipulierter Body (Signatur passt nicht) → 400");
  const oldSig = await signatureFor(pingPayload, WH_SECRET, Math.floor(Date.now() / 1000) - 400);
  res = await postWebhook(BASE_A, pingPayload, { signature: oldSig });
  check(res.status === 400, "Signatur mit veraltetem Timestamp (t=−400s) → 400 (Toleranz)");
  res = await postWebhook(BASE_B, pingPayload, { signature: pingSig });
  let noSecretBody: any = null;
  try { noSecretBody = await res.json(); } catch { /* noop */ }
  check(res.status === 500, "Server ohne STRIPE_WEBHOOK_SECRET → 500 (fail-closed)");
  check(noSecretBody?.error === "Webhook not configured", "Fail-closed-Fehlertext korrekt (kein stilles 200)");

  // ── [2] Webhook-Erfolgspfad + DB + Idempotenz (signierte Events, HTTP) ──
  console.log("\n[2] Webhook-Erfolgspfad (customer.subscription.updated → DB) + Idempotenz");
  const ts2 = Math.floor(Date.now() / 1000) + 40 * 86400;
  const updPayload = eventPayload("customer.subscription.updated", subscriptionUpdatedObj("active", ts2));
  res = await postWebhook(BASE_A, updPayload);
  check(res.status === 200, "Signiertes customer.subscription.updated (active/pro_monthly) → HTTP 200");
  let row = await qGetSubscriptionByStripeId(SUB_ID);
  check(row !== null, "subscriptions-Zeile nach Webhook vorhanden");
  check(row?.planTier === "pro" && row?.status === "active", `plan_tier='pro', status='active' (tatsächlich: ${row?.planTier}/${row?.status})`);
  check(row?.stripeCustomerId === CUS_ID, "stripe_customer_id gespeichert");
  check(row?.stripeSubscriptionId === SUB_ID, "stripe_subscription_id gespeichert");
  check(row?.currentPeriodEnd instanceof Date && row.currentPeriodEnd.getTime() === ts2 * 1000, "current_period_end auf Event-Zeitstempel verlängert");
  // Doppel-Send (Idempotenz)
  res = await postWebhook(BASE_A, updPayload);
  check(res.status === 200, "Doppel-Send desselben Events → HTTP 200");
  const cnt = await sql`SELECT count(*)::int AS n FROM subscriptions WHERE stripe_subscription_id = ${SUB_ID}`;
  check(Number(cnt[0].n) === 1, `Doppel-Send → weiterhin GENAU 1 Zeile (Idempotenz via UNIQUE-Index; n=${cnt[0].n})`);
  check((await qGetSubscriptionForUser(USERS.pro.clerkId))?.stripeSubscriptionId === SUB_ID, "qGetSubscriptionForUser findet die Zeile");

  // checkout.session.completed ohne STRIPE_SECRET_KEY → 500 fail-closed (mit Key → echter Pfad in [6])
  res = await postWebhook(BASE_A, eventPayload("checkout.session.completed", checkoutCompletedObj()));
  if (HAS_KEY) {
    check(res.status === 200, "Signiertes checkout.session.completed (echte Objekte) → HTTP 200 (voller Modus)");
  } else {
    let b: any = null; try { b = await res.json(); } catch { /* noop */ }
    check(res.status === 500 && String(b?.error).includes("Failed to process event"),
      "checkout.session.completed ohne STRIPE_SECRET_KEY → HTTP 500 (fail-closed, Stripe-Retry-Semantik) — wird 200 sobald der Key gesetzt ist");
  }

  // ── [3] Abo-Status + Guard (ServerFn über HTTP, echte Clerk-Session) ─────
  console.log("\n[3] getSubscriptionStatus (ServerFn, echte Session) + Guard (tier/limit)");
  const st = await serverFnCall(BASE_A, FN_STATUS, { method: "GET", cookie: jwt.pro });
  check(st.status === 200, `getSubscriptionStatus HTTP 200 (status=${st.status})`);
  const stj = st.json;
  check(stj?.signedIn === true, "signedIn=true (Session verifiziert)");
  check(stj?.tier === "pro", `tier=pro (tatsächlich: ${stj?.tier})`);
  check(stj?.status === "active", `status=active (tatsächlich: ${stj?.status})`);
  check(stj?.stripeCustomerId === CUS_ID, "stripeCustomerId aus DB");
  check(stj?.usage?.limit === 200, `usage.limit=200 (tatsächlich: ${stj?.usage?.limit})`);
  check(stj?.usage?.planTier === "pro", `usage.planTier=pro (tatsächlich: ${stj?.usage?.planTier})`);
  check(stj?.usage?.remaining === 200, `usage.remaining=200 (unverbraucht, tatsächlich: ${stj?.usage?.remaining})`);
  // direkte DB-Verifikation
  check((await qGetPlanTier(USERS.pro.clerkId)) === "pro", "qGetPlanTier(pro) = 'pro' (DB)");
  const usageDb = await getUsageInfo(USERS.pro.clerkId);
  check(usageDb.limit === 200 && usageDb.planTier === "pro", "getUsageInfo(pro) limit=200/tier=pro (DB)");
  // Free-Default ohne Abo
  const stFree = await serverFnCall(BASE_A, FN_STATUS, { method: "GET", cookie: jwt.free });
  check(stFree.status === 200 && stFree.json?.tier === "free", `Free-Default: getSubscriptionStatus tier=free (tatsächlich: ${stFree.json?.tier})`);
  check(stFree.json?.usage?.limit === 5, `Free-Default: usage.limit=5 (tatsächlich: ${stFree.json?.usage?.limit})`);
  check((await qGetPlanTier(USERS.free.clerkId)) === "free", "qGetPlanTier(free) = 'free' (DB)");
  // Beta-Flag über echte E-Mail
  const stBeta = await serverFnCall(BASE_A, FN_STATUS, { method: "GET", cookie: jwt.beta });
  check(stBeta.json?.isBeta === true, `Beta-Nutzer: isBeta=true über beta_signups approved (tatsächlich: ${stBeta.json?.isBeta})`);
  check((await isBetaUserEmail(USERS.beta.email)) === true, "isBetaUserEmail(email) = true (DB-Pfad)");
  check((await qGetUserEmailByClerkId(USERS.pro.clerkId)) === USERS.pro.email, "qGetUserEmailByClerkId liefert echte E-Mail");

  // ── [4] Checkout-ServerFn ────────────────────────────────────────────────
  console.log("\n[4] createCheckoutSession (ServerFn)");
  const chk = await serverFnCall(BASE_A, FN_CHECKOUT, { method: "POST", data: { userId: USERS.pro.clerkId, priceLookupKey: "pro_monthly" }, cookie: jwt.pro });
  if (!HAS_KEY) {
    check(chk.status >= 400 && String(chk.text).includes("Stripe is not configured"),
      `ohne Key → sauberer Fail-closed-Fehler (HTTP ${chk.status}, Meldung enthält „Stripe is not configured“)`);
  } else {
    check(chk.status === 200 && typeof chk.json?.url === "string" && chk.json.url.startsWith("https://checkout.stripe.com"), "Checkout-Session erzeugt (url vorhanden)");
  }

  // ── [5] Portal-ServerFn ──────────────────────────────────────────────────
  console.log("\n[5] createPortalSession (ServerFn)");
  const por = await serverFnCall(BASE_A, FN_PORTAL, { method: "POST", data: { userId: USERS.pro.clerkId }, cookie: jwt.pro });
  if (!HAS_KEY) {
    check(por.status >= 400 && String(por.text).includes("Stripe is not configured"), `ohne Key → sauberer Fail-closed-Fehler (HTTP ${por.status})`);
  } else {
    check(por.status === 200 && typeof por.json?.url === "string" && String(por.json.url).startsWith("https://billing.stripe.com"), "Portal-Session erzeugt (url ok)");
  }

  // ── [6] Voller Modus: Stripe-Setup idempotent + echte Objekte ────────────
  if (HAS_KEY) {
    console.log("\n[6] Stripe-Setup idempotent (Product/Preise/Coupon/Promo) + Verifikation");
    const Stripe = await loadStripeSdk();
    const stripe = new Stripe(SECRET_KEY);

    async function ensureStripeSetup(): Promise<{ priceMonthly: string; priceYearly: string }> {
      let product = (await stripe.products.list({ limit: 100 })).data.find((p: any) => p.name === "Growimo Pro");
      if (!product) product = await stripe.products.create({ name: "Growimo Pro", metadata: { phase: "8.3-e2e" } });
      let p1 = (await stripe.prices.list({ lookup_keys: ["pro_monthly"], limit: 1 })).data[0];
      if (!p1) p1 = await stripe.prices.create({ product: product.id, unit_amount: 1900, currency: "eur", recurring: { interval: "month" }, lookup_key: "pro_monthly" });
      let p2 = (await stripe.prices.list({ lookup_keys: ["pro_yearly"], limit: 1 })).data[0];
      if (!p2) p2 = await stripe.prices.create({ product: product.id, unit_amount: 19000, currency: "eur", recurring: { interval: "year" }, lookup_key: "pro_yearly" });
      let coupon: any;
      try { coupon = await stripe.coupons.retrieve("BETA50"); } catch { coupon = null; }
      if (!coupon) coupon = await stripe.coupons.create({ id: "BETA50", percent_off: 50, duration: "forever", name: "Beta 50 %" });
      let promo: any[] = [];
      try { promo = (await stripe.promotionCodes.list({ code: "BETA50", active: true, limit: 1 })).data; } catch { promo = []; }
      if (promo.length === 0) await stripe.promotionCodes.create({ coupon: "BETA50", code: "BETA50" });
      return { priceMonthly: p1.id, priceYearly: p2.id };
    }
    const s1 = await ensureStripeSetup();
    const s2 = await ensureStripeSetup();
    check(s1.priceMonthly === s2.priceMonthly && s1.priceYearly === s2.priceYearly, "Setup idempotent: zweiter Lauf findet existierende Objekte (gleiche IDs)");
    const listM = (await stripe.prices.list({ lookup_keys: ["pro_monthly"], limit: 1 })).data[0];
    const listY = (await stripe.prices.list({ lookup_keys: ["pro_yearly"], limit: 1 })).data[0];
    check(listM?.unit_amount === 1900 && listY?.unit_amount === 19000, `Preise korrekt: pro_monthly=${listM?.unit_amount} ct, pro_yearly=${listY?.unit_amount} ct (Soll 1900/19000)`);
    check(listM?.currency === "eur" && listY?.currency === "eur", "Währung eur");
    check(listM?.recurring?.interval === "month" && listY?.recurring?.interval === "year", "Intervalle month/year");
    const cpn = await stripe.coupons.retrieve("BETA50");
    check(cpn.percent_off === 50 && cpn.duration === "forever" && cpn.name === "Beta 50 %", "Coupon BETA50: 50 % / forever / „Beta 50 %“");
    const prm = (await stripe.promotionCodes.list({ code: "BETA50", active: true, limit: 1 })).data[0];
    check(prm?.coupon === "BETA50" && prm?.active === true, "Promotion-Code BETA50 aktiv, an Coupon BETA50 gebunden");

    // Checkout inkl. Beta-50 % (amount_total = 950)
    const chkPro = await serverFnCall(BASE_A, FN_CHECKOUT, { method: "POST", data: { userId: USERS.pro.clerkId, priceLookupKey: "pro_monthly" }, cookie: jwt.pro });
    check(chkPro.status === 200 && chkPro.json?.isBeta === false, `Checkout (Non-Beta): isBeta=false (tatsächlich: ${chkPro.json?.isBeta})`);
    const proSessionId = String(chkPro.json?.url ?? "").split("/c/pay/")[1]?.split("?")[0] ?? "";
    const ses = await stripe.checkout.sessions.retrieve(proSessionId);
    check(ses.mode === "subscription", "Session-Mode=subscription");
    check(ses.amount_total === 1900, `Session amount_total=1900 ct (tatsächlich: ${ses.amount_total})`);
    check((ses.discounts?.length ?? 0) === 0, "Kein Discount für Non-Beta");
    const chkBeta = await serverFnCall(BASE_A, FN_CHECKOUT, { method: "POST", data: { userId: USERS.beta.clerkId, priceLookupKey: "pro_monthly" }, cookie: jwt.beta });
    check(chkBeta.status === 200 && chkBeta.json?.isBeta === true, `Checkout (Beta): isBeta=true — serverseitige Beta-Logik belegt (tatsächlich: ${chkBeta.json?.isBeta})`);
    const betaSessionId = String(chkBeta.json?.url ?? "").split("/c/pay/")[1]?.split("?")[0] ?? "";
    if (betaSessionId) {
      const sesB = await stripe.checkout.sessions.retrieve(betaSessionId);
      check(sesB.amount_total === 950, `Beta-Checkout amount_total=950 ct = 50 % von 1900 (tatsächlich: ${sesB.amount_total})`);
      check(sesB.total_details?.amount_discount === 950, `amount_discount=950 (tatsächlich: ${sesB.total_details?.amount_discount})`);
      check((sesB.discounts?.length ?? 0) === 1, "Session enthält genau 1 Discount (Promotion-Code BETA50)");
    } else {
      skip("Beta-Checkout amount_total=950", "keine Session-URL");
    }

    // Webhook mit ECHTEN Stripe-Objekten: customer + subscription per API
    const cust = await stripe.customers.create({ email: USERS.pro.email, name: "E2E Stripe Pro" });
    const sub = await stripe.subscriptions.create({ customer: cust.id, items: [{ price: s1.priceMonthly }] });
    const realPayload = eventPayload("checkout.session.completed", {
      id: `cs_test_${RUN}_real`, mode: "subscription", payment_status: "paid",
      client_reference_id: USERS.pro.clerkId, metadata: { userId: USERS.pro.clerkId },
      customer: cust.id, subscription: sub.id,
    });
    res = await postWebhook(BASE_A, realPayload);
    check(res.status === 200, `Webhook mit echten Stripe-Objekten (customer+subscription per API) → HTTP 200 (status=${res.status})`);
    const realRow = await qGetSubscriptionByStripeId(sub.id);
    check(realRow !== null && realRow.planTier === "pro" && realRow.status === "active", "Echte Subscription → DB-Zeile pro/active");
    check(realRow?.stripeCustomerId === cust.id, "stripe_customer_id = echte customer.id");
    await postWebhook(BASE_A, realPayload);
    const realCnt = await sql`SELECT count(*)::int AS n FROM subscriptions WHERE stripe_subscription_id = ${sub.id}`;
    check(Number(realCnt[0].n) === 1, "Doppel-Send (echtes Event) → genau 1 Zeile (Idempotenz)");

    // Portal mit echtem Customer
    const por2 = await serverFnCall(BASE_A, FN_PORTAL, { method: "POST", data: { userId: USERS.pro.clerkId }, cookie: jwt.pro });
    check(por2.status === 200 && String(por2.json?.url).startsWith("https://billing.stripe.com"), `Portal-URL ok (status=${por2.status})`);
    check((await qGetCustomerIdForUser(USERS.pro.clerkId)) === cust.id, "qGetCustomerIdForUser = echter Customer");

    // Cleanup Stripe-Testobjekte (Testmodus; Product/Preise/Coupon/Promo bleiben — idempotentes Setup)
    try { await stripe.subscriptions.del(sub.id); } catch { /* noop */ }
    try { await stripe.customers.del(cust.id); } catch { /* noop */ }
  } else {
    skip("Stripe-Setup idempotent (Product „Growimo Pro“/Preise pro_monthly+pro_yearly/Coupon BETA50/Promo BETA50)", "STRIPE_SECRET_KEY nicht verfügbar (Verifizierung inkl. Beträge 1900/19000 ct)");
    skip("Checkout-Session inkl. Beta-50 % (amount_total=950 vs 1900, isBeta serverseitig)", "STRIPE_SECRET_KEY nicht verfügbar");
    skip("Webhook mit echten Stripe-Objekten (customer+subscription per API)", "STRIPE_SECRET_KEY nicht verfügbar");
    skip("Portal-URL mit echtem Customer", "STRIPE_SECRET_KEY nicht verfügbar");
  }

  // ── [7] Deleted-Event → expired ──────────────────────────────────────────
  console.log("\n[7] customer.subscription.deleted → status expired");
  res = await postWebhook(BASE_A, eventPayload("customer.subscription.deleted", subscriptionUpdatedObj("canceled", 0)));
  check(res.status === 200, "Signiertes customer.subscription.deleted → HTTP 200");
  row = await qGetSubscriptionByStripeId(SUB_ID);
  check(row?.status === "expired", `status=expired nach deleted-Event (tatsächlich: ${row?.status})`);

} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  failed += 1;
  fails.push(`EARLY-ABORT: ${msg}`);
  console.error(`  ✗ FAIL (EARLY-ABORT): ${msg}`);
} finally {
  // ── [8] Cleanup: Fixture-Nutzer/Subscriptions/Beta-Zeilen / Clerk / Server ──
  console.log("\n[8] Cleanup");
  try {
    for (const u of Object.values(USERS)) {
      await sql`DELETE FROM subscriptions WHERE stripe_customer_id = ${CUS_ID} OR user_id IN (SELECT id FROM users WHERE clerk_id = ${u.clerkId})`.catch(() => null);
      await sql`DELETE FROM users WHERE clerk_id = ${u.clerkId}`.catch(() => null);
      await sql`DELETE FROM beta_signups WHERE LOWER(email) = ${u.email.toLowerCase()}`.catch(() => null);
      await deleteClerkUser(u.clerkId);
    }
    const residue = await sql`SELECT count(*)::int AS n FROM users WHERE clerk_id LIKE ${`user_e2e_${RUN}%`}`;
    check(Number(residue[0].n) === 0, "Fixture-User-Zeilen vollständig aus der DB entfernt");
    const subResidue = await sql`SELECT count(*)::int AS n FROM subscriptions WHERE stripe_subscription_id = ${SUB_ID}`;
    check(Number(subResidue[0].n) === 0, "Fixture-Subscription-Zeilen entfernt");
  } catch (e) {
    console.error("  Cleanup-Warnung:", e instanceof Error ? e.message : e);
  }
  for (const s of servers) await stopServer(s);
}

console.log(`\n=== ERGEBNIS: ${passed} PASS / ${failed} FAIL / ${skipped} SKIP ===`);
if (failed > 0) {
  console.log("FAILS:", fails.join(" | "));
  process.exit(1);
}
if (!HAS_KEY) {
  console.log("Hinweis: STRIPE_SECRET_KEY fehlt — die [6]-Szenarien wurden als SKIP geführt. Vollständiger Lauf mit dem Key: bun --env-file=<env-mit-key> stripe83-e2e.ts");
}
process.exit(0);