/**
 * B2-DB-SUITE (2026-11-06) — Patch fuer stripe-webhook-test.ts.
 *
 * Anlass: Der erste Lauf gegen die Demo-DB brach in [2] ab, weil
 * processStripeEvent im DEFAULT echte Stripe-Endpunkte aufruft:
 *   · DE-Launch-Gate (2026-10-26) → subscriptions.cancel + refunds.create
 *   · Beta-Rabatt-Reparatur (2026-11-05) → retrieve/coupon-Writes
 *   · Rechnungsmail → customers.update
 * Der Suite-Kopf behauptet dagegen "KEINE echten Stripe-Keys/-API-Calls".
 * Fix: die bereits vorhandenen Test-Seams (deps.deGate, deps.reconcileBetaDiscount,
 * deps.setInvoiceEmail) mit Recorder-Fakes fuellen — Produktionscode unveraendert.
 * Zusaetzlich: Checkout-Fixture bekommt das DE-Rechnungsland (Normalfall) und
 * einen eigenen Block [2c], der das DE-Gate offline prueft.
 *
 * Jede Ersetzung wird geprueft; fehlt eine Stelle, bricht das Skript ab.
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const FILE = "stripe-webhook-test.ts";
copyFileSync(FILE, "/tmp/b2/stripe-webhook-test.ts.vor-patch");
let src = readFileSync(FILE, "utf8");

function must(cond: boolean, msg: string) {
  if (!cond) throw new Error(`PATCH FAILED: ${msg}`);
  console.log(`  ok: ${msg}`);
}

// ── 1) Alle Aufrufe auf den Offline-Wrapper umstellen ────────────────────────
const beforeCalls = (src.match(/processStripeEvent\(/g) ?? []).length;
src = src.replace(/processStripeEvent\(/g, "processOffline(");
must(beforeCalls >= 20, `processStripeEvent( → processOffline( (${beforeCalls} Stellen)`);

// ── 2) Import des Deps-Typs ────────────────────────────────────────────────
const importAnchor = `  STRIPE_WEBHOOK_PATH,`;
must(src.includes(importAnchor), "Import-Anker STRIPE_WEBHOOK_PATH gefunden");
src = src.replace(
  importAnchor,
  `${importAnchor}\n  type StripeWebhookDeps,`,
);

// ── 3) Offline-Dependencies + Wrapper vor main() ───────────────────────────
const mainAnchor = `async function main() {`;
must(src.includes(mainAnchor), "main()-Anker gefunden");
const offlineBlock = `// ── Offline-Dependencies (B2-DB-Suite, 2026-11-06) ───────────────────────────
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

`;
src = src.replace(mainAnchor, offlineBlock + mainAnchor);

// ── 4) Checkout-Fixture: Rechnungsland (DE = Normalfall) + optional PI/Mail ─
const oldFixture = `const sessionCompletedEvent = (
  clerkId: string,
  sub: string,
  cust: string,
  opts: { lookupKey?: string; paymentStatus?: string } = {},
) => ({
  type: 'checkout.session.completed',
  data: {
    object: {
      id: \`cs_test_\${RUN}\`,
      mode: 'subscription',
      payment_status: opts.paymentStatus ?? 'paid',
      client_reference_id: clerkId,
      metadata: { userId: clerkId },
      customer: cust,
      subscription: sub,
    },
  },
});`;
must(src.includes(oldFixture), "sessionCompletedEvent-Fixture gefunden");
const newFixture = `// B2-DB-Suite (2026-11-06): Die Session traegt jetzt das Rechnungsland.
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
      id: \`cs_test_\${RUN}\`,
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
});`;
src = src.replace(oldFixture, newFixture);

// ── 5) Block [2c]: DE-Gate offline ─────────────────────────────────────────
const gateAnchor = `    // invoice.paid verlängert current_period_end`;
must(src.includes(gateAnchor), "Anker 'invoice.paid verlängert' gefunden");
const gateBlock = `    // ── [2c] DE-Launch-Gate (2026-10-26) — offline, mit Recordern ───────────
    // Das Gate ist eine Sperre, die im Fehlerfall Geld bewegt (cancel + refund).
    // Deshalb hier explizit: Ausland → kein Pro + cancel(+refund); DE → kein Call.
    console.log('\\n[2c] DE-Launch-Gate: Ausland wird gesperrt, DE nicht angefasst');
    resetOfflineRecorders();
    const usSub = \`sub_\${RUN}_us\`;
    const usUser = TEST_USERS[1];
    await processOffline(sessionCompletedEvent(usUser, usSub, \`cus_\${RUN}_us\`, { country: 'US' }), {
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
    const usPiSub = \`sub_\${RUN}_uspi\`;
    const usPi = \`pi_\${RUN}_us\`;
    await processOffline(
      sessionCompletedEvent(usUser, usPiSub, \`cus_\${RUN}_uspi\`, { country: 'US', paymentIntent: usPi }),
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
    const noAddrSub = \`sub_\${RUN}_noaddr\`;
    await processOffline(sessionCompletedEvent(usUser, noAddrSub, \`cus_\${RUN}_noaddr\`, { country: null }), {
      retrieveSubscription: retrieveFixture,
    });
    check(
      (await qGetSubscriptionByStripeId(noAddrSub))?.status === 'expired' &&
        deGateCalls.filter((c) => c.kind === 'cancel').length === 1,
      'fehlende Adresse → wie Ausland: expired + cancel (fail-closed)',
    );

    // DE-Normalfall: kein Gate-Call, Rechnungsmail wird gesetzt (best effort)
    resetOfflineRecorders();
    const deSub = \`sub_\${RUN}_de\`;
    const deUser = TEST_USERS[1];
    await processOffline(
      sessionCompletedEvent(deUser, deSub, \`cus_\${RUN}_de\`, { email: \`wh-\${RUN}-de@example.com\` }),
      { retrieveSubscription: retrieveFixture },
    );
    const deRow = await qGetSubscriptionByStripeId(deSub);
    check(deRow?.status === 'active' && deRow?.planTier === 'pro', 'DE: Checkout aktiviert pro (Normalfall)');
    check(deGateCalls.length === 0, 'DE: KEIN cancel/refund (Gate greift nicht)');
    check(
      invoiceEmailCalls.length === 1 && invoiceEmailCalls[0].email === \`wh-\${RUN}-de@example.com\`,
      'DE: Rechnungsmail wird gesetzt (setInvoiceEmail-Seam)',
    );
    await processOffline(subscriptionDeletedEvent(deSub, \`cus_\${RUN}_de\`));
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

${gateAnchor}`;
src = src.replace(gateAnchor, gateBlock);

writeFileSync(FILE, src);
console.log("PATCH OK —", FILE, "aktualisiert");
