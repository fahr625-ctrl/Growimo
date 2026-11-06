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
//
// B2-DB-Suite (2026-11-06): processStripeEvent ruft im DEFAULT echte Stripe-
// Endpunkte (DE-Gate: subscriptions.cancel/refunds.create; Beta-Rabatt:
// Coupon-Reparatur; Rechnungsmail: customers.update). Der erste Lauf gegen die
// Demo-DB brach deshalb mit 404 "No such subscription" ab. Alle Aufrufe laufen
// jetzt über `processOffline(...)`, das die vorhandenen Seams (deps.deGate,
// deps.reconcileBetaDiscount, deps.setInvoiceEmail) mit Recordern füllt —
// dieselben Codepfade, aber ohne Netz. Ziel-DB MUSS die Demo-DB sein
// (`growimo_demo`); gegen die Prod-DB blockiert der Test-Guard jeden Write.
//   bun --env-file=/tmp/b2/demo.env stripe-webhook-test.ts
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac } from 'node:crypto';
import { getDb } from './src/db/index';
import {
  handleStripeWebhookApi,
  processStripeEvent,
  planTierForLookupKey,
  mapSubscriptionStatus,
  invoiceSubscriptionId,
  invoicePeriodEnd,
  invoicePriceLookupKey,
  UnknownPriceLookupKeyError,
  UnresolvablePlanTierError,
  STRIPE_WEBHOOK_PATH,
  type StripeWebhookDeps,
  PRO_MONTHLY_LOOKUP_KEY,
  PRO_YEARLY_LOOKUP_KEY,
} from './src/api/stripe-webhook';
import {
  qGetPlanTier,
  qGetSubscriptionByStripeId,
  qGetSubscriptionForUser,
  qGetRemaining,
  qUpsertSubscription,
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
/** Wie expectThrow, aber für SYNCHRONE Würfe (planTierForLookupKey). */
const expectThrowSync = (fn: () => unknown, label: string): unknown => {
  try {
    fn();
    check(false, `${label} (kein Fehler geworfen)`);
    return null;
  } catch (err) {
    check(err instanceof Error, `${label} → ${(err as Error).message.slice(0, 60)}`);
    return err;
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
// B2-DB-Suite (2026-11-06): Die Session traegt jetzt das Rechnungsland.
// Ohne Adresse greift das DE-Launch-Gate (fail-closed: "Land fehlt = nicht DE")
// und der Checkout landet NICHT auf pro — genau das ist im ersten Demo-Lauf
// passiert. Default 'DE' = der Normalfall, den die restliche Suite annimmt;
// country: null bildet die fehlende Adresse ab, 'US' den Auslandskauf.
const sessionCompletedEvent = (
  clerkId: string,
  sub: string,
  cust: string,
  opts: {
    lookupKey?: string;
    paymentStatus?: string;
    country?: string | null;
    paymentIntent?: string;
    email?: string;
  } = {},
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
      customer_details: {
        address: { country: opts.country === null ? null : (opts.country ?? 'DE') },
        ...(opts.email ? { email: opts.email } : {}),
      },
      ...(opts.paymentIntent ? { payment_intent: opts.paymentIntent } : {}),
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

// ── Offline-Dependencies (B2-DB-Suite, 2026-11-06) ───────────────────────────
// Befund des ersten Demo-DB-Laufs: der Suite-Kopf sagt "KEINE echten Stripe-
// Keys/-API-Calls", aber seit DE-Launch-Gate (2026-10-26) und Beta-Rabatt-
// Reparatur (2026-11-05) ruft processStripeEvent im DEFAULT echte Endpunkte:
//   subscriptions.cancel / refunds.create / customers.update / Coupon-Reparatur.
// Der Lauf brach deshalb in [2] mit 404 "No such subscription" ab. Die Seams
// (deps.deGate, deps.reconcileBetaDiscount, deps.setInvoiceEmail) sind im
// Produktionscode bereits vorhanden — hier werden sie mit Recordern gefuellt.
// Damit laufen DIESELBEN Codepfade, aber ohne Netz.
const deGateCalls: Array<{ kind: "cancel" | "refund"; id: string; key?: string }> = [];
const invoiceEmailCalls: Array<{ customerId: string; email: string }> = [];
const betaReconcileCalls: Array<{ subscriptionId: string; clerkUserId: string }> = [];
const resetOfflineRecorders = () => {
  deGateCalls.length = 0;
  invoiceEmailCalls.length = 0;
  betaReconcileCalls.length = 0;
};
const offlineDeps = (extra: StripeWebhookDeps = {}): StripeWebhookDeps => ({
  deGate: {
    async cancelSubscription(id, key) {
      deGateCalls.push({ kind: "cancel", id, key });
    },
    async refundPaymentIntent(id, key) {
      deGateCalls.push({ kind: "refund", id, key });
    },
  },
  setInvoiceEmail: async (customerId, email) => {
    invoiceEmailCalls.push({ customerId, email });
  },
  reconcileBetaDiscount: async (input) => {
    betaReconcileCalls.push(input);
    return "noop";
  },
  ...extra,
});
/** processStripeEvent mit vollstaendig offline Dependencies. */
const processOffline = (
  event: Parameters<typeof processStripeEvent>[0],
  extra: StripeWebhookDeps = {},
) => processStripeEvent(event, offlineDeps(extra));

async function main() {
  try {
    console.log('— stripe-webhook-test (Phase 8.3) —\n');
    console.log('Testnutzer:', TEST_USERS.join(', '), '| sub:', SUB_A);

    // ── [0] Reine Helper (kein DB) ──────────────────────────────────────────
    console.log('\n[0] Helper: lookup_key / Status-Mapping / Preis-Keys');
    check(planTierForLookupKey(PRO_MONTHLY_LOOKUP_KEY) === 'pro', `planTier('${PRO_MONTHLY_LOOKUP_KEY}') → pro`);
    check(planTierForLookupKey(PRO_YEARLY_LOOKUP_KEY) === 'pro', `planTier('${PRO_YEARLY_LOOKUP_KEY}') → pro`);
    // B2 (Owner-Auftrag 2026-11-05): Der alte Test schrieb hier
    // `planTier('other_price') === 'free'` fest und hielt damit das fail-OPEN-
    // Verhalten fest. Richtig ist: ein bezahlter, nicht zuordenbarer Preis ist
    // ein FEHLER (Wurf → Webhook 500 → Stripe wiederholt), niemals 'free'.
    const unknownErr = expectThrowSync(
      () => planTierForLookupKey('other_price'),
      "planTier('other_price') → WIRFT (fail-closed, kein 'free')",
    );
    check(
      unknownErr instanceof UnknownPriceLookupKeyError,
      'unbekannter Key → UnknownPriceLookupKeyError (Typ)',
    );
    check(
      unknownErr instanceof Error && unknownErr.message.includes('other_price'),
      'Fehlertext nennt den unbekannten Schlüssel',
    );
    check(planTierForLookupKey(null) === null, 'planTier(null) → null (nicht ableitbar)');
    check(planTierForLookupKey(undefined) === null, 'planTier(undefined) → null');
    check(planTierForLookupKey('') === null, "planTier('') → null (wie 'kein Preis')");
    // Detail-Unit-Tests der Zuordnung (auch ohne DB lauffähig):
    //   bun test src/stripe/plan-tier.test.ts
    //   bun test src/api/stripe-webhook.tier-fail-closed.test.ts
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
    await processOffline(sessionCompletedEvent(TEST_USERS[0], SUB_A, CUS_A), {
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
    await processOffline(sessionCompletedEvent(TEST_USERS[0], SUB_A, CUS_A), {
      retrieveSubscription: retrieveFixture,
    });
    const rows = await sql`SELECT count(*)::int AS n FROM subscriptions WHERE stripe_subscription_id = ${SUB_A}`;
    check(Number(rows[0].n) === 1, 'Retry/Doppel-Event → weiterhin GENAU 1 Zeile (idempotent via UNIQUE-Index)');

    // ── [2b] B2 (Owner-Auftrag 2026-11-05): fail-closed an ALLEN Aufrufstellen ─
    // Ein unbekannter lookup_key darf NIE still als 'free' gespeichert werden.
    // Erwartet: Wurf → der Endpoint antwortet 500 → Stripe wiederholt das Event
    // (Selbstheilung nach einem Fix). Beweis hier über die drei Aufrufstellen.
    console.log('\n[2b] B2 fail-closed: unbekannter lookup_key an allen drei Aufrufstellen');
    const tierBefore = (await qGetSubscriptionByStripeId(SUB_A))?.planTier;
    const unknownKey = 'pro_monthly_typo';
    const badRetrieve = async () => ({
      current_period_end: 1_893_456_000,
      items: { data: [{ price: { lookup_key: unknownKey } }] },
    });
    await expectThrow(
      () =>
        processOffline(
          sessionCompletedEvent(TEST_USERS[0], `sub_b2ck_${RUN}`, `cus_b2ck_${RUN}`),
          { retrieveSubscription: badRetrieve },
        ),
      'checkout.session.completed: unbekannter lookup_key → Wurf (kein free)',
    );
    check(
      (await qGetSubscriptionByStripeId(`sub_b2ck_${RUN}`)) === null,
      'checkout: bei unbekanntem Preis wird KEINE subscriptions-Zeile angelegt',
    );
    await expectThrow(
      () => processOffline(invoicePaidEvent(SUB_A, CUS_A, 1_894_051_200, unknownKey)),
      'invoice.paid: unbekannter lookup_key → Wurf (kein free)',
    );
    await expectThrow(
      () => processOffline(subscriptionUpdatedEvent(SUB_A, CUS_A, 'active', 1_894_051_200, unknownKey)),
      'customer.subscription.updated: unbekannter lookup_key → Wurf (kein free)',
    );
    row = await qGetSubscriptionByStripeId(SUB_A);
    check(
      row?.planTier === 'pro' && row?.planTier === tierBefore,
      'kein Schreibvorgang: plan_tier bleibt pro (NICHT free)',
    );
    // Kein lookup_key UND kein DB-Tarif ⇒ eigener Fehlertyp (Retry-Semantik).
    const unresolvable = await (async () => {
      try {
        await processOffline(
          sessionCompletedEvent(TEST_USERS[1], `sub_b2nr_${RUN}`, `cus_b2nr_${RUN}`),
          { retrieveSubscription: async () => ({ current_period_end: 1_893_456_000, items: { data: [{}] } }) },
        );
        return null;
      } catch (err) {
        return err;
      }
    })();
    check(
      unresolvable instanceof UnresolvablePlanTierError,
      'checkout: kein lookup_key + kein DB-Tarif → UnresolvablePlanTierError (Typ)',
    );
    check(
      (await qGetSubscriptionByStripeId(`sub_b2nr_${RUN}`)) === null,
      'checkout: nicht bestimmbarer Tarif → KEINE Zeile (nichts geschrieben)',
    );

    // ── [2c] DE-Launch-Gate (2026-10-26) — offline, mit Recordern ───────────
    // Das Gate ist eine Sperre, die im Fehlerfall Geld bewegt (cancel + refund).
    // Deshalb hier explizit: Ausland → kein Pro + cancel(+refund); DE → kein Call.
    console.log('\n[2c] DE-Launch-Gate: Ausland wird gesperrt, DE nicht angefasst');
    resetOfflineRecorders();
    const usSub = `sub_${RUN}_us`;
    const usUser = TEST_USERS[1];
    await processOffline(sessionCompletedEvent(usUser, usSub, `cus_${RUN}_us`, { country: 'US' }), {
      retrieveSubscription: retrieveFixture,
    });
    const usRow = await qGetSubscriptionByStripeId(usSub);
    check(usRow !== null, 'Ausland (US): subscriptions-Zeile wird angelegt (Nachvollziehbarkeit)');
    check(usRow?.status === 'expired', 'Ausland (US): status = expired (KEIN Pro)');
    check((await qGetPlanTier(usUser)) === 'free', 'Ausland (US): qGetPlanTier = free (kein Pro-Zugriff)');
    check(
      deGateCalls.length === 1 && deGateCalls[0].kind === 'cancel' && deGateCalls[0].id === usSub,
      'Ausland (US): GENAU EIN cancel für die Subscription',
    );
    check(
      deGateCalls.some((c) => c.kind === 'cancel' && c.key?.startsWith('degate:sub:')),
      'cancel bekommt einen Idempotency-Key (degate:sub:…)',
    );
    check(!deGateCalls.some((c) => c.kind === 'refund'), 'ohne payment_intent: KEIN refund');

    // Ausland MIT PaymentIntent → cancel UND volle Erstattung
    resetOfflineRecorders();
    const usPiSub = `sub_${RUN}_uspi`;
    const usPi = `pi_${RUN}_us`;
    await processOffline(
      sessionCompletedEvent(usUser, usPiSub, `cus_${RUN}_uspi`, { country: 'US', paymentIntent: usPi }),
      { retrieveSubscription: retrieveFixture },
    );
    check(
      deGateCalls.length === 2 &&
        deGateCalls[0].kind === 'cancel' &&
        deGateCalls[1].kind === 'refund' &&
        deGateCalls[1].id === usPi,
      'Ausland + PaymentIntent: erst cancel, dann refund des PaymentIntent',
    );
    check(
      (await qGetSubscriptionByStripeId(usPiSub))?.status === 'expired',
      'Ausland + PaymentIntent: status bleibt expired',
    );

    // Fehlende Rechnungsadresse → wie Ausland (fail-closed)
    resetOfflineRecorders();
    const noAddrSub = `sub_${RUN}_noaddr`;
    await processOffline(sessionCompletedEvent(usUser, noAddrSub, `cus_${RUN}_noaddr`, { country: null }), {
      retrieveSubscription: retrieveFixture,
    });
    check(
      (await qGetSubscriptionByStripeId(noAddrSub))?.status === 'expired' &&
        deGateCalls.filter((c) => c.kind === 'cancel').length === 1,
      'fehlende Adresse → wie Ausland: expired + cancel (fail-closed)',
    );

    // DE-Normalfall: kein Gate-Call, Rechnungsmail wird gesetzt (best effort)
    resetOfflineRecorders();
    const deSub = `sub_${RUN}_de`;
    const deUser = TEST_USERS[1];
    await processOffline(
      sessionCompletedEvent(deUser, deSub, `cus_${RUN}_de`, { email: `wh-${RUN}-de@example.com` }),
      { retrieveSubscription: retrieveFixture },
    );
    const deRow = await qGetSubscriptionByStripeId(deSub);
    check(deRow?.status === 'active' && deRow?.planTier === 'pro', 'DE: Checkout aktiviert pro (Normalfall)');
    check(deGateCalls.length === 0, 'DE: KEIN cancel/refund (Gate greift nicht)');
    check(
      invoiceEmailCalls.length === 1 && invoiceEmailCalls[0].email === `wh-${RUN}-de@example.com`,
      'DE: Rechnungsmail wird gesetzt (setInvoiceEmail-Seam)',
    );
    await processOffline(subscriptionDeletedEvent(deSub, `cus_${RUN}_de`));
    check((await qGetPlanTier(deUser)) === 'free', 'DE: nach deleted wieder free (Ausgangslage für [3])');

    // Beta-Rabatt-Reparatur läuft bei subscription.updated (Seam statt Netz).
    // Bewusst ein ANDERER period_end als im folgenden invoice.paid-Test, damit
    // dessen Verlängerungs-Assertion nicht trivial erfüllt ist.
    resetOfflineRecorders();
    await processOffline(subscriptionUpdatedEvent(SUB_A, CUS_A, 'active', 1_893_000_000));
    check(
      betaReconcileCalls.length === 1 && betaReconcileCalls[0].subscriptionId === SUB_A,
      'subscription.updated ruft die Beta-Rabatt-Reparatur (Seam, kein Netz)',
    );

    // invoice.paid verlängert current_period_end
    const nextPeriod = 1_894_051_200;
    await processOffline(invoicePaidEvent(SUB_A, CUS_A, nextPeriod));
    row = await qGetSubscriptionByStripeId(SUB_A);
    check(row !== null && row.currentPeriodEnd?.getTime() === nextPeriod * 1000, 'invoice.paid verlängert current_period_end');

    // ── Bug 2 (2026-09-27): invoice.paid in der ECHTEN API-Form (dahlia) ────
    // Die Fixtures oben bauen die ALTE Form (`subscription` auf oberster Ebene,
    // `lines[].price.lookup_key`) — Stripe sendet sie mit API-Version
    // 2026-08-26.dahlia nicht mehr, weshalb der Zweig ein stiller No-Op war.
    // Hier läuft zusätzlich ein VERBATIM abgelegtes, echtes Event-Objekt aus dem
    // Testkonto durch denselben Handler (Details: stripe-invoice-paid-dahlia-test.ts).
    const realFixture = (await Bun.file(
      `${import.meta.dir}/stripe-fixtures/invoice-paid-dahlia-real.json`,
    ).json()) as { type: string; data: { object: Record<string, unknown> } };
    const realInvoice = realFixture.data.object as Record<string, any>;
    const realLineEnd = Number(realInvoice.lines.data[0].period.end);
    check(realFixture.type === 'invoice.paid', 'echtes Fixture-Event ist invoice.paid');
    check(!('subscription' in realInvoice), 'echtes Payload hat KEIN Top-Level `subscription` (Ursache des No-Ops)');
    check(
      invoiceSubscriptionId(realInvoice) === realInvoice.parent.subscription_details.subscription,
      'invoiceSubscriptionId liest parent.subscription_details.subscription',
    );
    check(invoicePeriodEnd(realInvoice) === realLineEnd, 'invoicePeriodEnd liest den Posten-Pfad (lines[].period.end)');
    check(invoicePriceLookupKey(realInvoice) === null, 'dahlia-Payload trägt keinen lookup_key → bestehender Tarif bleibt');
    const realSubForTest = `sub_realform_${RUN}`;
    // Zeile VOR dem Event anlegen: invoice.paid ist (bewusst) fail-closed und
    // wirft für unbekannte Subscriptions. Ausgangswert = alter Wert, damit die
    // Verlängerung messbar ist.
    await qUpsertSubscription({
      clerkUserId: TEST_USERS[2],
      stripeCustomerId: `cus_realform_${RUN}`,
      stripeSubscriptionId: realSubForTest,
      planTier: 'pro',
      status: 'active',
      currentPeriodEnd: realLineEnd - 30 * 86400,
    });
    await processOffline(
      {
        type: 'invoice.paid',
        data: {
          object: {
            ...realInvoice,
            parent: { subscription_details: { subscription: realSubForTest }, type: 'subscription_details' },
          },
        },
      },
    );
    const realFormRow = await qGetSubscriptionByStripeId(realSubForTest);
    check(
      realFormRow !== null && realFormRow.currentPeriodEnd?.getTime() === realLineEnd * 1000,
      `invoice.paid in ECHTER Form schreibt die DB (current_period_end = ${realLineEnd})`,
    );
    check(realFormRow?.planTier === 'pro', 'echte Form: Tarif bleibt pro (kein lookup_key nötig)');
    await sql`DELETE FROM subscriptions WHERE stripe_subscription_id = ${realSubForTest}`;
    // dahlia (8.3d-Befund): subscription.updated mit period_end NUR am Item →
    // Item-Pfad lesen (periodEndOfSubscription), DB-Zeile bekommt den Wert.
    const dahliaPeriod = 1_893_700_000;
    await processOffline(subscriptionUpdatedDahliaEvent(SUB_A, CUS_A, 'active', dahliaPeriod));
    row = await qGetSubscriptionByStripeId(SUB_A);
    check(row !== null && row.currentPeriodEnd?.getTime() === dahliaPeriod * 1000, 'subscription.updated (dahlia, period_end am Item) → current_period_end gespeichert');
    // dahlia-checkout: retrieve liefert period_end NUR am Item → gleicher Effekt
    await processOffline(sessionCompletedEvent(TEST_USERS[1], `sub_dahlia_${RUN}`, CUS_A), {
      retrieveSubscription: dahliaRetrieveFixture,
    });
    const dahliaRow = await qGetSubscriptionByStripeId(`sub_dahlia_${RUN}`);
    check(dahliaRow !== null && dahliaRow.currentPeriodEnd?.getTime() === 1_893_999_600 * 1000, 'checkout mit retrieve (period_end am Item) → current_period_end gespeichert');
    // dahlia-Testabonnements beenden, damit die Guard-Prüfungen in [3] wieder
    // von „kein aktives Abo → free" ausgehen können.
    await processOffline(subscriptionDeletedEvent(`sub_dahlia_${RUN}`, CUS_A));
    const dahliaGone = await qGetSubscriptionByStripeId(`sub_dahlia_${RUN}`);
    check(dahliaGone?.status === 'expired', 'dahlia-Testabo nach deleted → expired (Guard-Unabhängigkeit)');

    // subscription.updated canceled → cancelled
    await processOffline(subscriptionUpdatedEvent(SUB_A, CUS_A, 'canceled'));
    row = await qGetSubscriptionByStripeId(SUB_A);
    check(row?.status === 'cancelled', "subscription.updated 'canceled' → status cancelled");

    // subscription.updated past_due → expired (Zugriff aus)
    await processOffline(subscriptionUpdatedEvent(SUB_A, CUS_A, 'past_due'));
    row = await qGetSubscriptionByStripeId(SUB_A);
    check(row?.status === 'expired', "subscription.updated 'past_due' → status expired");

    // wieder aktiv (z. B. Zahlung kam doch)
    await processOffline(subscriptionUpdatedEvent(SUB_A, CUS_A, 'active'));
    row = await qGetSubscriptionByStripeId(SUB_A);
    check(row?.status === 'active' && row.planTier === 'pro', "subscription.updated 'active' → wieder active + pro");

    // subscription.deleted → expired
    await processOffline(subscriptionDeletedEvent(SUB_A, CUS_A));
    row = await qGetSubscriptionByStripeId(SUB_A);
    check(row?.status === 'expired', 'subscription.deleted → status expired');

    // unbekanntes Event → No-Op, kein Crash, keine Zeile
    await processOffline({ type: 'charge.succeeded', data: { object: { id: 'ch_1' } } });
    check(true, 'unbekanntes Event → No-Op (200-ignorieren)');

    // checkout unbezahlt → NICHT aktivieren
    await processOffline(sessionCompletedEvent(TEST_USERS[1], `sub_unpaid_${RUN}`, 'cus_unpaid', { paymentStatus: 'unpaid' }), {
      retrieveSubscription: retrieveFixture,
    });
    const unpaidRow = await qGetSubscriptionByStripeId(`sub_unpaid_${RUN}`);
    check(unpaidRow === null, 'checkout mit payment_status unpaid → KEINE Aktivierung (fail-closed)');

    // invoice für unbekannte Subscription → wirft (500 → Stripe retried)
    await expectThrow(
      () => processOffline(invoicePaidEvent(`sub_ghost_${RUN}`, 'cus_ghost')),
      'invoice.paid für unbekannte Subscription → wirft (Retry-Semantik)',
    );

    // ── [3] Guard↔Tier: Free 3 (einmalig) / Pro 200 ─────────────────────────
    console.log('\n[3] Usage-Guard ↔ subscriptions-Tabelle');
    check((await qGetPlanTier(TEST_USERS[1])) === 'free', 'Ohne Abo → plan_tier free (Default)');
    // Owner-Entscheid 2026-10-22 (Commit 6b5beef): Free = 3 Generierungen,
    // EINMALIG (kein Monats-Reset). Die alte Erwartung 5 war ueberholt.
    check(limitForPlan('free') === FREE_LIMIT && FREE_LIMIT === 3, 'Free-Limit = 3 einmalig (Owner-Festlegung 2026-10-22)');
    check(limitForPlan('pro') === PRO_LIMIT && PRO_LIMIT === 200, 'Pro-Limit = 200 (Owner-Festlegung)');
    // Signatur ist qGetRemaining(userId, period, limit) — vorher waren Periode
    // und Limit vertauscht (limit='2099-01' → NaN).
    const freeRemaining = await qGetRemaining(TEST_USERS[1], '2099-01', FREE_LIMIT);
    check(freeRemaining === FREE_LIMIT && freeRemaining === 3, 'Free: 3 von 3 verbleibend');
    check((await qGetPlanTier(TEST_USERS[0])) === 'free', 'nach deleted → plan_tier wieder free (kein aktives Abo)');

    // Neues aktives Pro-Abo → Guard schaltet 200 frei
    await processOffline(sessionCompletedEvent(TEST_USERS[0], `sub_pro2_${RUN}`, `cus_pro2_${RUN}`), {
      retrieveSubscription: retrieveFixture,
    });
    check((await qGetPlanTier(TEST_USERS[0])) === 'pro', 'aktiver Pro-Eintrag → qGetPlanTier = pro');
    const proRemaining = await qGetRemaining(TEST_USERS[0], '2099-01', PRO_LIMIT);
    check(proRemaining === PRO_LIMIT, `Pro: ${PRO_LIMIT} von ${PRO_LIMIT} verbleibend (Guard-Verzahnung)`);
    check(limitForPlan(await qGetPlanTier(TEST_USERS[0])) === 200, 'limitForPlan(qGetPlanTier) = 200');

    // ── [4] Beta-Berechtigung (isBetaUserEmail) ──────────────────────────────
    console.log('\n[4] Beta-Coupon-Berechtigungslogik (beta_signups approved)');
    // Beta-Ende (2026-10-08): approved wird explizit gesetzt — der DB-Default ist
    // jetzt FALSE; nur ein vor dem Public Launch registrierter Nutzer (approved=true)
    // bekommt den lebenslangen BETA50-Rabatt.
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
      () => processOffline(sessionCompletedEvent(TEST_USERS[0], `sub_nofetch_${RUN}`, 'cus_x')),
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