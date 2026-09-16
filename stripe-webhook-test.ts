// ─────────────────────────────────────────────────────────────────────────────
// Phase 8.3 — Stripe-Zahlungsflow Test-Suite (Webhook + Guard↔Tier + Beta)
// ─────────────────────────────────────────────────────────────────────────────
// Usage (aus der Repo-Wurzel, echte Test-DB — Schema einmal via
// `bun --env-file=.env -e 'await import("./src/db/init").then(m=>m.initDb())'`):
//   bun --env-file=.env stripe-webhook-test.ts
//
// KEINE echten Stripe-Keys/-API-Calls. Signaturprüfung über die statische
// SDK-Methode webhooks.generateTestHeaderString (funktioniert offline mit jedem
// Secret-String); Ereignis-Verarbeitung über processStripeEvent mit Fixture-
// Events + Fake-retrieveSubscription gegen die echte Neon-DB (synthetische
// Testnutzer, Cleanup im finally). Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac } from 'node:crypto';
import { getDb } from './src/db/index';
import {
  handleStripeWebhookApi,
  processStripeEvent,
  planTierForLookupKey,
  mapSubscriptionStatus,
  STRIPE_WEBHOOK_PATH,
  PRO_MONTHLY_LOOKUP_KEY,
  PRO_YEARLY_LOOKUP_KEY,
} from './src/api/stripe-webhook';
import {
  qGetPlanTier,
  qGetSubscriptionByStripeId,
  qGetSubscriptionForUser,
  qGetRemaining,
} from './src/db/queries';
import { isBetaUserEmail } from './src/api/beta';
import { limitForPlan, FREE_LIMIT, PRO_LIMIT } from './src/lib/usage-guard';

const RUN = Date.now().toString(36);
const TEST_USERS = [`wh-${RUN}-a`, `wh-${RUN}-free`, `wh-${RUN}-beta`];
const TEST_EMAILS = [`wh-${RUN}-beta@example.com`, `wh-${RUN}-nobeta@example.com`];
const SUB_A = `sub_${RUN}`;
const CUS_A = `cus_${RUN}`;
const sql = getDb();
let passed = 0;
let failed = 0;
const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ PASS: ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ FAIL: ${label}`);
  }
};
const expectThrow = async (fn: () => Promise<unknown>, label: string) => {
  try {
    await fn();
    check(false, `${label} (kein Fehler geworfen)`);
  } catch (err) {
    check(err instanceof Error, `${label} → ${(err as Error).message.slice(0, 60)}`);
  }
};

// ── Fixtures ─────────────────────────────────────────────────────────────────
const retrieveFixture = async (_subscriptionId: string, lookupKey = PRO_MONTHLY_LOOKUP_KEY) => ({
  current_period_end: 1_893_456_000, // 2030-01-15
  items: { data: [{ price: { lookup_key: lookupKey } }] },
});
// dahlia-Variante (8.3d-Befund, API-Version 2026-08-26.dahlia): current_period_end
// NUR am Subscription-ITEM — kein Top-Level-Feld. periodEndOfSubscription muss
// den Item-Pfad lesen.
const dahliaRetrieveFixture = async (_subscriptionId: string, lookupKey = PRO_MONTHLY_LOOKUP_KEY) => ({
  items: { data: [{ price: { lookup_key: lookupKey }, current_period_end: 1_893_999_600 }] },
});
const sessionCompletedEvent = (
  clerkId: string,
  sub: string,
  cust: string,
  opts: { lookupKey?: string; paymentStatus?: string } = {},
) => ({
  type: 'checkout.session.completed',
  data: {
    object: {
      id: `cs_test_${RUN}`,
      mode: 'subscription',
      payment_status: opts.paymentStatus ?? 'paid',
      client_reference_id: clerkId,
      metadata: { userId: clerkId },
      customer: cust,
      subscription: sub,
    },
  },
});
const invoicePaidEvent = (sub: string, cust: string, periodEnd = 1_894_051_200, lookupKey = PRO_MONTHLY_LOOKUP_KEY) => ({
  type: 'invoice.paid',
  data: {
    object: {
      id: `in_${RUN}`,
      subscription: sub,
      customer: cust,
      period_end: periodEnd,
      lines: { data: [{ price: { lookup_key: lookupKey } }] },
    },
  },
});
const subscriptionUpdatedEvent = (
  sub: string,
  cust: string,
  status: string,
  periodEnd = 1_894_051_200,
  lookupKey = PRO_MONTHLY_LOOKUP_KEY,
) => ({
  type: 'customer.subscription.updated',
  data: {
    object: {
      id: sub,
      customer: cust,
      status,
      current_period_end: periodEnd,
      items: { data: [{ price: { lookup_key: lookupKey } }] },
    },
  },
});
// dahlia-Variante: current_period_end NUR am Subscription-ITEM (kein Top-Level).
const subscriptionUpdatedDahliaEvent = (
  sub: string,
  cust: string,
  status: string,
  itemPeriodEnd = 1_893_700_000,
  lookupKey = PRO_MONTHLY_LOOKUP_KEY,
) => ({
  type: 'customer.subscription.updated',
  data: {
    object: {
      id: sub,
      customer: cust,
      status,
      items: { data: [{ price: { lookup_key: lookupKey }, current_period_end: itemPeriodEnd }] },
    },
  },
});
const subscriptionDeletedEvent = (sub: string, cust: string) => ({
  type: 'customer.subscription.deleted',
  data: { object: { id: sub, customer: cust } },
});

const post = (payload: string, signature?: string): Request => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature) headers['stripe-signature'] = signature;
  return new Request(`https://growimo.test${STRIPE_WEBHOOK_PATH}`, {
    method: 'POST',
    headers,
    body: payload,
  });
};

/**
 * Stripe-Webhook-Signatur selbst erzeugen (offizielles Schema:
 * t=<ts>,v1=HMAC-SHA256(secret, "<ts>.<payload>")). Verifikation macht die SDK-
 * constructEvent-Methode im Handler — Test prüft damit das echte Gegenstück.
 */
function stripeSignature(payload: string, secret: string, timestamp?: number): string {
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

async function main() {
  try {
    console.log('— stripe-webhook-test (Phase 8.3) —\n');
    console.log('Testnutzer:', TEST_USERS.join(', '), '| sub:', SUB_A);

    // ── [0] Reine Helper (kein DB) ──────────────────────────────────────────
    console.log('\n[0] Helper: lookup_key / Status-Mapping / Preis-Keys');
    check(planTierForLookupKey(PRO_MONTHLY_LOOKUP_KEY) === 'pro', `planTier('${PRO_MONTHLY_LOOKUP_KEY}') → pro`);
    check(planTierForLookupKey(PRO_YEARLY_LOOKUP_KEY) === 'pro', `planTier('${PRO_YEARLY_LOOKUP_KEY}') → pro`);
    check(planTierForLookupKey('other_price') === 'free', 'planTier(anderer Key) → free (fail-closed)');
    check(planTierForLookupKey(null) === null, 'planTier(null) → null (nicht ableitbar)');
    check(planTierForLookupKey(undefined) === null, 'planTier(undefined) → null');
    check(mapSubscriptionStatus('active') === 'active', "status 'active' → active");
    check(mapSubscriptionStatus('trialing') === 'active', "status 'trialing' → active");
    check(mapSubscriptionStatus('canceled') === 'cancelled', "status 'canceled' → cancelled");
    check(mapSubscriptionStatus('past_due') === 'expired', "status 'past_due' → expired");
    check(mapSubscriptionStatus('unpaid') === 'expired', "status 'unpaid' → expired");
    check(mapSubscriptionStatus(undefined) === 'expired', 'status undefined → expired (fail-closed)');
    check(PRO_MONTHLY_LOOKUP_KEY === 'pro_monthly' && PRO_YEARLY_LOOKUP_KEY === 'pro_yearly', 'verbindliche lookup_keys pro_monthly/pro_yearly');

    // ── [1] Fail-closed ohne Keys / Signaturprüfung (HTTP-Handler) ──────────
    console.log('\n[1] HTTP-Handler: fail-closed, Signatur (offline via generateTestHeaderString)');
    const origSecret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    let resp = await handleStripeWebhookApi(post(JSON.stringify({ id: 'evt_1', type: 'ping' })), STRIPE_WEBHOOK_PATH);
    check(resp !== null && resp.status === 500, 'ohne STRIPE_WEBHOOK_SECRET → 500 (fail-closed, saubere Meldung)');
    if (resp) { const body: { error?: string } = await resp.json(); check(body.error === 'Webhook not configured', 'Fehlertext „Webhook not configured" (kein Crash)'); }

    const testSecret = 'whsec_phase83_test_secret';
    process.env.STRIPE_WEBHOOK_SECRET = testSecret;
    resp = await handleStripeWebhookApi(
      new Request(`https://growimo.test${STRIPE_WEBHOOK_PATH}`, { method: 'GET' }),
      STRIPE_WEBHOOK_PATH,
    );
    check(resp !== null && resp.status === 405, 'GET statt POST → 405');
    resp = await handleStripeWebhookApi(post(JSON.stringify({ id: 'evt_1', type: 'ping' })), '/other');
    check(resp === null, 'fremder Pfad → null (andere Handler/SSR)');
    resp = await handleStripeWebhookApi(post(JSON.stringify({ id: 'evt_1', type: 'ping' })), STRIPE_WEBHOOK_PATH);
    check(resp !== null && resp.status === 400, 'ohne stripe-signature-Header → 400');
    const payload = JSON.stringify({ id: 'evt_ping_1', type: 'ping', data: { object: {} } });
    const goodSig = stripeSignature(payload, testSecret);
    resp = await handleStripeWebhookApi(post(payload, 't=1,v1=garbage'), STRIPE_WEBHOOK_PATH);
    check(resp !== null && resp.status === 400, 'ungültige Signatur → 400');
    resp = await handleStripeWebhookApi(post(payload, goodSig), STRIPE_WEBHOOK_PATH);
    check(resp !== null && resp.status === 200, 'gültige Signatur + unbekanntes Event (ping) → 200-ignorieren');
    if (resp) { const body: { received?: boolean } = await resp.json(); check(body.received === true, 'Response { received: true }'); }
    // Toleranz: Sig mit veraltetem Zeitstempel (v1 über 5 min) → 400
    const oldStamp = Math.floor(Date.now() / 1000) - 400;
    const oldSig = stripeSignature(payload, testSecret, oldStamp);
    resp = await handleStripeWebhookApi(post(payload, oldSig), STRIPE_WEBHOOK_PATH);
    check(resp !== null && resp.status === 400, 'abgelaufene Signatur (t=4min) → 400 (Toleranz)');
    if (origSecret) process.env.STRIPE_WEBHOOK_SECRET = origSecret;
    else delete process.env.STRIPE_WEBHOOK_SECRET;

    // ── [2] Event-Verarbeitung → subscriptions-Writes (echte DB) ─────────────
    console.log('\n[2] Event-Verarbeitung (upsert-Semantik, DB)');
    await processStripeEvent(sessionCompletedEvent(TEST_USERS[0], SUB_A, CUS_A), {
      retrieveSubscription: retrieveFixture,
    });
    let row = await qGetSubscriptionByStripeId(SUB_A);
    check(row !== null, 'checkout.session.completed legt subscriptions-Zeile an');
    check(row?.stripeCustomerId === CUS_A, 'stripe_customer_id aus Session gespeichert');
    check(row?.stripeSubscriptionId === SUB_A, 'stripe_subscription_id gespeichert');
    check(row?.planTier === 'pro', 'plan_tier = pro (lookup_key pro_monthly)');
    check(row?.status === 'active', 'status = active');
    check(row?.currentPeriodEnd instanceof Date && row.currentPeriodEnd.getTime() === 1_893_456_000_000, 'current_period_end (Unix-s) → Date');
    check(row?.clerkUserId === TEST_USERS[0], 'clerk_id über client_reference_id gemappt');
    row = await qGetSubscriptionForUser(TEST_USERS[0]);
    check(row !== null && row.stripeSubscriptionId === SUB_A, 'qGetSubscriptionForUser findet die Zeile');

    // Idempotenz: dasselbe Event erneut → keine zweite Zeile
    await processStripeEvent(sessionCompletedEvent(TEST_USERS[0], SUB_A, CUS_A), {
      retrieveSubscription: retrieveFixture,
    });
    const rows = await sql`SELECT count(*)::int AS n FROM subscriptions WHERE stripe_subscription_id = ${SUB_A}`;
    check(Number(rows[0].n) === 1, 'Retry/Doppel-Event → weiterhin GENAU 1 Zeile (idempotent via UNIQUE-Index)');

    // invoice.paid verlängert current_period_end
    const nextPeriod = 1_894_051_200;
    await processStripeEvent(invoicePaidEvent(SUB_A, CUS_A, nextPeriod));
    row = await qGetSubscriptionByStripeId(SUB_A);
    check(row !== null && row.currentPeriodEnd?.getTime() === nextPeriod * 1000, 'invoice.paid verlängert current_period_end');
    // dahlia (8.3d-Befund): subscription.updated mit period_end NUR am Item →
    // Item-Pfad lesen (periodEndOfSubscription), DB-Zeile bekommt den Wert.
    const dahliaPeriod = 1_893_700_000;
    await processStripeEvent(subscriptionUpdatedDahliaEvent(SUB_A, CUS_A, 'active', dahliaPeriod));
    row = await qGetSubscriptionByStripeId(SUB_A);
    check(row !== null && row.currentPeriodEnd?.getTime() === dahliaPeriod * 1000, 'subscription.updated (dahlia, period_end am Item) → current_period_end gespeichert');
    // dahlia-checkout: retrieve liefert period_end NUR am Item → gleicher Effekt
    await processStripeEvent(sessionCompletedEvent(TEST_USERS[1], `sub_dahlia_${RUN}`, CUS_A), {
      retrieveSubscription: dahliaRetrieveFixture,
    });
    const dahliaRow = await qGetSubscriptionByStripeId(`sub_dahlia_${RUN}`);
    check(dahliaRow !== null && dahliaRow.currentPeriodEnd?.getTime() === 1_893_999_600 * 1000, 'checkout mit retrieve (period_end am Item) → current_period_end gespeichert');
    // dahlia-Testabonnements beenden, damit die Guard-Prüfungen in [3] wieder
    // von „kein aktives Abo → free" ausgehen können.
    await processStripeEvent(subscriptionDeletedEvent(`sub_dahlia_${RUN}`, CUS_A));
    const dahliaGone = await qGetSubscriptionByStripeId(`sub_dahlia_${RUN}`);
    check(dahliaGone?.status === 'expired', 'dahlia-Testabo nach deleted → expired (Guard-Unabhängigkeit)');

    // subscription.updated canceled → cancelled
    await processStripeEvent(subscriptionUpdatedEvent(SUB_A, CUS_A, 'canceled'));
    row = await qGetSubscriptionByStripeId(SUB_A);
    check(row?.status === 'cancelled', "subscription.updated 'canceled' → status cancelled");

    // subscription.updated past_due → expired (Zugriff aus)
    await processStripeEvent(subscriptionUpdatedEvent(SUB_A, CUS_A, 'past_due'));
    row = await qGetSubscriptionByStripeId(SUB_A);
    check(row?.status === 'expired', "subscription.updated 'past_due' → status expired");

    // wieder aktiv (z. B. Zahlung kam doch)
    await processStripeEvent(subscriptionUpdatedEvent(SUB_A, CUS_A, 'active'));
    row = await qGetSubscriptionByStripeId(SUB_A);
    check(row?.status === 'active' && row.planTier === 'pro', "subscription.updated 'active' → wieder active + pro");

    // subscription.deleted → expired
    await processStripeEvent(subscriptionDeletedEvent(SUB_A, CUS_A));
    row = await qGetSubscriptionByStripeId(SUB_A);
    check(row?.status === 'expired', 'subscription.deleted → status expired');

    // unbekanntes Event → No-Op, kein Crash, keine Zeile
    await processStripeEvent({ type: 'charge.succeeded', data: { object: { id: 'ch_1' } } });
    check(true, 'unbekanntes Event → No-Op (200-ignorieren)');

    // checkout unbezahlt → NICHT aktivieren
    await processStripeEvent(sessionCompletedEvent(TEST_USERS[1], `sub_unpaid_${RUN}`, 'cus_unpaid', { paymentStatus: 'unpaid' }), {
      retrieveSubscription: retrieveFixture,
    });
    const unpaidRow = await qGetSubscriptionByStripeId(`sub_unpaid_${RUN}`);
    check(unpaidRow === null, 'checkout mit payment_status unpaid → KEINE Aktivierung (fail-closed)');

    // invoice für unbekannte Subscription → wirft (500 → Stripe retried)
    await expectThrow(
      () => processStripeEvent(invoicePaidEvent(`sub_ghost_${RUN}`, 'cus_ghost')),
      'invoice.paid für unbekannte Subscription → wirft (Retry-Semantik)',
    );

    // ── [3] Guard↔Tier: Free 5 / Pro 200 ─────────────────────────────────────
    console.log('\n[3] Usage-Guard ↔ subscriptions-Tabelle');
    check((await qGetPlanTier(TEST_USERS[1])) === 'free', 'Ohne Abo → plan_tier free (Default)');
    check(limitForPlan('free') === FREE_LIMIT && FREE_LIMIT === 5, 'Free-Limit = 5 (Owner-Festlegung)');
    check(limitForPlan('pro') === PRO_LIMIT && PRO_LIMIT === 200, 'Pro-Limit = 200 (Owner-Festlegung)');
    const freeRemaining = await qGetRemaining(TEST_USERS[1], 'free', '2099-01');
    check(freeRemaining === 5, 'Free: 5 von 5 verbleibend');
    check((await qGetPlanTier(TEST_USERS[0])) === 'free', 'nach deleted → plan_tier wieder free (kein aktives Abo)');

    // Neues aktives Pro-Abo → Guard schaltet 200 frei
    await processStripeEvent(sessionCompletedEvent(TEST_USERS[0], `sub_pro2_${RUN}`, `cus_pro2_${RUN}`), {
      retrieveSubscription: retrieveFixture,
    });
    check((await qGetPlanTier(TEST_USERS[0])) === 'pro', 'aktiver Pro-Eintrag → qGetPlanTier = pro');
    const proRemaining = await qGetRemaining(TEST_USERS[0], 'pro', '2099-01');
    check(proRemaining === PRO_LIMIT, `Pro: ${PRO_LIMIT} von ${PRO_LIMIT} verbleibend (Guard-Verzahnung)`);
    check(limitForPlan(await qGetPlanTier(TEST_USERS[0])) === 200, 'limitForPlan(qGetPlanTier) = 200');

    // ── [4] Beta-Berechtigung (isBetaUserEmail) ──────────────────────────────
    console.log('\n[4] Beta-Coupon-Berechtigungslogik (beta_signups approved)');
    await sql`INSERT INTO beta_signups (first_name, email, approved) VALUES ('Test', ${TEST_EMAILS[0]}, true)`;
    await sql`INSERT INTO beta_signups (first_name, email, approved) VALUES ('Test2', ${TEST_EMAILS[1]}, false)`;
    check(await isBetaUserEmail(TEST_EMAILS[0]) === true, 'approved=true → beta (50-%-Berechtigt)');
    check(await isBetaUserEmail(TEST_EMAILS[0].toUpperCase()) === true, 'Groß-/Kleinschreibung egal (LOWER-Match)');
    check(await isBetaUserEmail(TEST_EMAILS[1]) === false, 'approved=false → KEINE Beta-Berechtigung');
    check(await isBetaUserEmail('nobody@example.com') === false, 'unbekannte E-Mail → false (fail-closed)');
    check(await isBetaUserEmail(null) === false, 'leere E-Mail → false');

    // ── [5] Upsert-Guards ─────────────────────────────────────────────────────
    console.log('\n[5] Upsert-Datenintegrität');
    await expectThrow(
      () => processStripeEvent(sessionCompletedEvent(TEST_USERS[0], `sub_nofetch_${RUN}`, 'cus_x')),
      'checkout ohne retrieveSubscription-Dependency → wirft (fail-closed)',
    );

    // Gesamtbilanz
    console.log(`\n=== stripe-webhook-test: ${passed} PASS, ${failed} FAIL ===`);
    if (failed > 0) {
      console.log('Fehlgeschlagen:');
      for (const f of failures) console.log('  - ' + f);
      process.exitCode = 1;
    }
  } finally {
    // Cleanup: ALLE Testdaten entfernen (läuft VOR dem Exit — process.exitCode statt process.exit)
    try {
      for (const u of TEST_USERS) {
        await sql`DELETE FROM subscriptions WHERE user_id=(SELECT id FROM users WHERE clerk_id=${u})`;
      }
      for (const u of TEST_USERS) {
        await sql`DELETE FROM users WHERE clerk_id = ${u}`;
      }
      for (const e of TEST_EMAILS) {
        await sql`DELETE FROM beta_signups WHERE LOWER(email)=${e.toLowerCase()}`;
      }
      await sql`DELETE FROM subscriptions WHERE stripe_subscription_id LIKE ${`sub_${RUN}%`}`;
      console.log('  cleanup ok (users/subscriptions/beta_signups)');
    } catch (err) {
      console.error('  cleanup fehlgeschlagen:', err);
    }
  }
}

main().catch((err) => {
  console.error('Suite fehlgeschlagen (unexpected):', err);
  process.exitCode = 1;
});