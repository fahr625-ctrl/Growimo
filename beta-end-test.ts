/**
 * BETA-ENDE — Verifikations-Suite (Owner-Auftrag 2026-10-08, Phase 10-Vorbereitung)
 * =============================================================================
 * Prüft die vier Punkte des Auftrags gegen den echten Code:
 *
 *  (a) POST /api/beta-signup ist GESCHLOSSEN: HTTP 410, KEIN INSERT, keine
 *      neue beta_signups-Zeile (DB-COUNT vorher == nachher), i18n-String da.
 *  (b) Auto-Freischaltung aus: Schema-Default FALSE + idempotente Migration
 *      (Quelltext-Assertions; der Live-Default der DB wird NUR gelesen und
 *      als INFO ausgegeben — die Migration greift mit dem nächsten Deploy,
 *      wenn initSchema läuft).
 *  (c) BETA50 nur für Bestands-Beta-Nutzer: bestehende approved=true-Zeile →
 *      isBetaUserEmail() = true, unbekannte E-Mail → false (echter Code-Pfad
 *      des Checkouts, read-only) + Quelltext-Assertions auf checkout.ts
 *      (Rabatt ausschließlich hinter `isBeta`, Coupon-ID 'BETA50' unangetastet).
 *  (d) Gate offen: kein Wartelisten-Block mehr, ensureUser für JEDEN
 *      eingeloggten Nutzer, ProtectedRoute für Ausgeloggte erhalten,
 *      /app/beta-welcome geschützt, Landing ohne Beta-Modal mit Launch-CTAs,
 *      FAQ + Willkommens-Texte launch-tauglich (de/en paritätisch).
 *
 * Keine echten Stripe-/OpenAI-Calls. Die DB wird ausschließlich GELESEN
 * (COUNT/MIN/MAX) — der Test schreibt nichts.
 *
 * Ausführen:  bun --env-file=.env beta-end-test.ts
 */
import { readFileSync } from "node:fs";
import { getDb } from "./src/db/index";
import { handleBetaApi, isBetaUserEmail } from "./src/api/beta";
import { de } from "./src/i18n/de";
import { en } from "./src/i18n/en";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log("PASS:", name); }
  else { failures.push(detail ? `${name} — ${detail}` : name); console.log("FAIL:", name, detail ? `— ${detail}` : ""); }
}
function info(msg: string) { console.log("INFO:", msg); }

const read = (p: string) => readFileSync(p, "utf8");
const api = read("./src/api/beta.ts");
const schema = read("./src/db/schema.ts");
const app = read("./src/routes/app.tsx");
const landing = read("./src/components/LandingPage.tsx");
const checkout = read("./src/stripe/checkout.ts");
const betaWelcome = read("./src/routes/app/beta-welcome.tsx");

// ── (a) Signup-Endpoint geschlossen ──────────────────────────────────────────
console.log("\n── (a) POST /api/beta-signup: 410, kein INSERT ──────────────────");
{
  check("(a) kein INSERT mehr in src/api/beta.ts", !/INSERT INTO beta_signups/.test(api));
  check("(a) kein hardkodiertes approved=true mehr im Endpoint", !/VALUES \(\$\{first\},\$\{email\},true\)/.test(api));
  check("(a) 410-Antwort im Code verdrahtet", api.includes("{ status: 410 }") || api.includes("status: 410"));
  check("(a) Fehlercode beta_program_ended im Payload", api.includes('code: "beta_program_ended"'));
  check("(a) kein Notification-Append mehr (beta-notifications.jsonl)", !api.includes("beta-notifications.jsonl"));
  check("(a) isBetaUserEmail prüft weiter approved = true", /WHERE LOWER\(email\) = \$\{normalized\} AND approved = true/.test(api));

  const stamp = Date.now().toString(36);
  const freshEmail = `e2e-betaend-${stamp}@ctomail.io`;
  let countBefore: number | null = null;
  let countAfter: number | null = null;
  let rowForFresh: number | null = null;
  let status = 0;
  let payload: any = null;
  try {
    const sql = getDb();
    const c0: any = await sql`SELECT COUNT(*)::int AS n FROM beta_signups`;
    countBefore = c0[0].n;

    const res = await handleBetaApi(
      new Request("https://www.growimo.app/api/beta-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ first_name: "E2E", email: freshEmail }),
      }),
      "/api/beta-signup",
    );
    status = res ? res.status : 0;
    payload = res ? await res.json().catch(() => null) : null;

    const c1: any = await sql`SELECT COUNT(*)::int AS n FROM beta_signups`;
    countAfter = c1[0].n;
    const f: any = await sql`SELECT COUNT(*)::int AS n FROM beta_signups WHERE LOWER(email) = ${freshEmail}`;
    rowForFresh = f[0].n;

    check("(a) POST /api/beta-signup → HTTP 410", status === 410, `tatsächlich ${status}`);
    check("(a) Payload nennt den beendeten Zustand", payload?.code === "beta_program_ended" && typeof payload?.message === "string");
    check("(a) DB-COUNT vorher == nachher (kein INSERT)", countBefore === countAfter, `${countBefore} → ${countAfter}`);
    check("(a) für die Test-E-Mail existiert KEINE Zeile", rowForFresh === 0, `Zeilen: ${rowForFresh}`);
    info(`(a) COUNT(*) beta_signups: vorher ${countBefore}, nachher ${countAfter}`);

    const getRes = await handleBetaApi(
      new Request("https://www.growimo.app/api/beta-signup", { method: "GET" }),
      "/api/beta-signup",
    );
    check("(a) GET auf denselben Pfad → 405 (unverändert)", getRes?.status === 405, `tatsächlich ${getRes?.status}`);
  } catch (e: any) {
    check("(a) 410-Pfad ohne DB prüfbar", false, `DB-Fehler: ${String(e?.message).slice(0, 120)}`);
  }
}

// ── (b) Auto-Freischaltung aus (Schema + Migration) ──────────────────────────
console.log("\n── (b) Schema-Default FALSE + idempotente Migration ─────────────");
{
  check("(b) Tabellendefinition: approved NOT NULL DEFAULT FALSE",
    /approved BOOLEAN NOT NULL DEFAULT FALSE/.test(schema));
  check("(b) kein DEFAULT TRUE mehr in schema.ts", !/approved BOOLEAN[^;]*DEFAULT TRUE/.test(schema));
  check("(b) Migration setzt den Spalten-Default idempotent",
    /ALTER TABLE beta_signups ALTER COLUMN approved SET DEFAULT false;/.test(schema));
  check("(b) Migration ist wiederholbar (SET DEFAULT ist idempotent, kein UPDATE)",
    !/UPDATE beta_signups SET approved/.test(schema));
  check("(b) keine bestehenden Zeilen werden umgeschrieben (kein UPDATE/DELETE im Schema)",
    !/UPDATE beta_signups|DELETE FROM beta_signups/.test(schema));

  try {
    const sql = getDb();
    const col: any = await sql`SELECT column_default FROM information_schema.columns
      WHERE table_name = 'beta_signups' AND column_name = 'approved'`;
    info(`(b) Live-DB column_default VOR dem nächsten initSchema-Deploy: ${JSON.stringify(col[0]?.column_default)} (erwartet nach Deploy: 'false')`);
    check("(b) Spalte approved existiert in der Live-DB", col.length === 1);
  } catch (e: any) {
    info(`(b) information_schema nicht lesbar: ${String(e?.message).slice(0, 120)}`);
  }
}

// ── (c) BETA50 nur für Bestands-Beta-Nutzer ──────────────────────────────────
console.log("\n── (c) Rabatt-Logik: Bestand = true, neu = false ────────────────");
{
  check("(c) checkout matcht über isBetaUserEmail (beta_signups approved=true)", checkout.includes("await isBetaUserEmail(email)"));
  check("(c) fail-closed: ohne E-Mail kein Rabatt", /const isBeta = email \? await isBetaUserEmail\(email\) : false;/.test(checkout));
  check("(c) Discounts-Block ist an isBeta gekoppelt", checkout.includes("...(isBeta") && checkout.includes(": {}),"));
  check("(c) Coupon-ID 'BETA50' unverändert vorhanden", checkout.includes("process.env.STRIPE_BETA_COUPON || 'BETA50'") && checkout.includes("process.env.STRIPE_BETA_PROMO_CODE || 'BETA50'"));
  check("(c) Coupon wird NICHT für Nicht-Beta angehängt (kein unbedingtes discounts:)",
    /\(isBeta\s*\n?\s*\?/.test(checkout));

  try {
    const sql = getDb();
    const c0: any = await sql`SELECT COUNT(*)::int AS n FROM beta_signups`;
    const oldest: any = await sql`SELECT LOWER(email) AS email FROM beta_signups
      WHERE approved = true ORDER BY created_at ASC LIMIT 1`;
    if (oldest.length > 0) {
      const existingEmail: string = oldest[0].email;
      const gotExisting = await isBetaUserEmail(existingEmail);
      check("(c) bestehender Beta-Nutzer (approved=true) bekommt den Rabatt weiter", gotExisting === true);
      info(`(c) Treffer-E-Mail maskiert: ${existingEmail.slice(0, 2)}***@${existingEmail.split("@")[1]}`);
    } else {
      info("(c) keine approved=true-Zeile in der DB gefunden — Bestands-Check übersprungen");
    }
    const fresh = await isBetaUserEmail(`e2e-betaend-${Date.now().toString(36)}@ctomail.io`);
    check("(c) neue E-Mail ohne Zeile bekommt KEINEN Rabatt", fresh === false);
    check("(c) leere E-Mail → false (fail-closed)", (await isBetaUserEmail("")) === false && (await isBetaUserEmail(null)) === false);
    const c1: any = await sql`SELECT COUNT(*)::int AS n FROM beta_signups`;
    check("(c) Rabatt-Prüfungen haben nichts geschrieben", c0[0].n === c1[0].n, `${c0[0].n} → ${c1[0].n}`);
  } catch (e: any) {
    check("(c) Rabatt-Logik gegen die DB prüfbar", false, `DB-Fehler: ${String(e?.message).slice(0, 120)}`);
  }
}

// ── (d) Gate offen / Landing / Texte ────────────────────────────────────────
console.log("\n── (d) Öffentliche Registrierung, Gate offen ────────────────────");
{
  check("(d) kein WaitlistScreen mehr (Komponente und Aufruf entfernt)",
    !app.includes("function WaitlistScreen") && !app.includes("<WaitlistScreen"));
  check("(d) kein blockierender 'checking'-Spinner-Zweig mehr", !app.includes('beta === "checking"'));
  check("(d) kein 'denied'-Zweig mehr (Warteliste)", !app.includes('beta === "denied"'));
  check("(d) kein 'error'-Retry-Block mehr", !app.includes('beta === "error"'));
  check("(d) keine Beta-Check-Requests mehr aus dem Layout", !app.includes('fetch("/api/beta-access"'));
  check("(d) ensureUser läuft AUF isSignedIn (nicht auf beta==='approved')",
    app.includes("if (!isSignedIn) return;") && !app.includes('if (beta !== "approved") return;'));
  check("(d) ensureUser-Aufruf unverändert gekoppelt an die Clerk-ID", app.includes("clerkUser.id,"));
  check("(d) ProtectedRoute bleibt der Schutz für Ausgeloggte", read("./src/components/ProtectedRoute.tsx").includes('window.location.href = "/app/sign-in"'));
  check("(d) /app/beta-welcome hängt an ProtectedRoute", betaWelcome.includes("<ProtectedRoute>"));
  check("(d) Layout gibt beta-welcome weiter als eigenes Layout aus", app.includes("if (isBetaWelcome)"));

  check("(d) Landing referenziert kein BetaSignupModal mehr", !landing.includes("BetaSignupModal") && !landing.includes("openBetaSignup"));
  const ctas = (landing.match(/href="\/app\/sign-up"/g) ?? []).length;
  check("(d) alle 5 Landing-CTAs führen zur Registrierung", ctas === 5, `gefunden: ${ctas}`);
  check("(d) kein BETA_SIGNUP_EVENT mehr im Landing-Code", !landing.includes("BETA_SIGNUP_EVENT"));

  // Texte (de/en)
  check("(d) FAQ Frage 5 launch-tauglich (kein Beta-Zugang)",
    !de.faq_q5.toLowerCase().includes("beta") && !en.faq_q5.toLowerCase().includes("beta"));
  check("(d) FAQ Antwort 5 nennt Preise/Free-Tarif",
    de.faq_a5.includes("Free-Tarif") && de.faq_a5.includes("19 €") && en.faq_a5.includes("Free plan") && en.faq_a5.includes("€19"));
  check("(d) kein 'Lebenslanger Rabatt auf Pro' mehr in den Willkommens-Benefits",
    !de.beta_benefit3_title.toLowerCase().includes("rabatt") && !en.beta_benefit3_title.toLowerCase().includes("discount"));
  check("(d) kein 'Kostenloser Zugang während der Beta' mehr", !de.beta_benefit1_title.toLowerCase().includes("beta") && !en.beta_benefit1_title.toLowerCase().includes("beta"));
  check("(d) neue i18n-Strings für das Beta-Ende (de+en)",
    typeof (de as any).beta_ended_title === "string" && typeof (en as any).beta_ended_title === "string"
    && de.beta_ended_text.length > 10 && en.beta_ended_text.length > 10);
  check("(d) i18n de/en Parität unverändert", Object.keys(de).length === Object.keys(en).length,
    `${Object.keys(de).length} vs ${Object.keys(en).length}`);
  check("(d) Pricing-Badge für Bestands-Beta-Nutzer bleibt erhalten", de.pricing_beta_badge.includes("Beta"));
}

// ── DB-Snapshot (read-only, ohne personenbezogene Daten) ────────────────────
console.log("\n── DB-Snapshot beta_signups (nur Aggregate, read-only) ──────────");
{
  try {
    const sql = getDb();
    const r: any = await sql`SELECT COUNT(*)::int AS n,
        MIN(created_at) AS first_at, MAX(created_at) AS last_at,
        COUNT(DISTINCT LOWER(email))::int AS distinct_emails,
        COUNT(*) FILTER (WHERE approved = true)::int AS approved_n
      FROM beta_signups`;
    const row = r[0];
    info(`COUNT=${row.n} · DISTINCT(LOWER(email))=${row.distinct_emails} · approved=true=${row.approved_n}`);
    info(`MIN(created_at)=${row.first_at?.toISOString?.() ?? row.first_at} · MAX(created_at)=${row.last_at?.toISOString?.() ?? row.last_at}`);
    check("(e) COUNT ist eine Zahl und ≥ 0", typeof row.n === "number" && row.n >= 0);
    // Befund (kein Fehler des Umbaus): der Altbestand enthält Doppel-Anmeldungen
    // (derselbe String in mehreren Zeilen) — der alte Endpoint war idempotent,
    // Test-Skripte haben aber direkt eingefügt. Wird als INFO dokumentiert.
    info(`(e) Doppel-Anmeldungen im Altbestand: COUNT - DISTINCT = ${row.n - row.distinct_emails}`);
    check("(e) alle Bestandszeilen sind approved=true (Rabatt bleibt für alle)", row.approved_n === row.n, `${row.approved_n} von ${row.n}`);
  } catch (e: any) {
    check("(e) DB-Snapshot lesbar", false, `DB-Fehler: ${String(e?.message).slice(0, 120)}`);
  }
}

console.log(`\n=== beta-end-test: ${passed} PASS, ${failures.length} FAIL ===`);
if (failures.length > 0) {
  console.log("Failures:", failures.join(" | "));
  process.exitCode = 1;
}
