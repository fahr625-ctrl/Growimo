// ─────────────────────────────────────────────────────────────────────────────
// DE-Launch-Gate (Owner-Auftrag 2026-10-26, Teil A) — Test-Suite
// ─────────────────────────────────────────────────────────────────────────────
// Aufruf (aus der Repo-Wurzel, KEINE DB, KEIN Stripe-Netz):
//   bun run de-launch-gate-test.ts
//
// Geprüft:
//   A. Session-Parameter (currency=eur, billing_address_collection=required)
//   B. Rechnungsland-Prüfung: DE erlaubt; AT/leer/fehlend fail-closed
//   C. Webhook-Policy: AT → cancel+refund, DE → no-op, fehlendes Land →
//      cancel+refund (fail-closed), ohne PaymentIntent → cancel only
//   D. Idempotenz: gleiche Event-ID → gleicher Idempotency-Key (kein Doppel-Refund)
//   E. Statische Reihenfolge: die DE-Prüfung steht VOR jedem Stripe-Zugriff
//      (createCheckoutSession), und die Session nutzt die DE-Parameter.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import {
  DE_BILLING_COUNTRY,
  DE_BILLING_REJECT_CODE,
  assertDeBillingCountry,
  billingCountryFromSession,
  customerEmailFromSession,
  deCheckoutSessionParams,
  deGateIdempotencyBase,
  enforceDeBillingPolicy,
  evaluateBillingCountryPolicy,
  isDeBillingCountry,
  normalizeBillingCountry,
  paymentIntentIdFromSession,
  type DeGateDeps,
} from './src/stripe/de-billing';

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

type Call = { fn: 'cancel' | 'refund'; id: string; key: string };
function recorder(): { deps: DeGateDeps; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    deps: {
      async cancelSubscription(id, key) {
        calls.push({ fn: 'cancel', id, key });
      },
      async refundPaymentIntent(id, key) {
        calls.push({ fn: 'refund', id, key });
      },
    },
  };
}

async function main() {
  // ── A. Session-Parameter ────────────────────────────────────────────────────
  console.log('\nA. Checkout-Session-Parameter (Euro + Rechnungsadresse Pflicht)');
  const params = deCheckoutSessionParams();
  check(params.currency === 'eur', 'currency = eur (Euro im Checkout)');
  check(
    params.billing_address_collection === 'required',
    'billing_address_collection = required (Land wird immer erhoben)',
  );
  check(
    Object.keys(params).sort().join(',') === 'billing_address_collection,currency',
    'keine weiteren (nicht dokumentierten) Parameter gesetzt',
  );

  // ── B. Rechnungsland-Prüfung ───────────────────────────────────────────────
  console.log('\nB. Rechnungsland-Prüfung (fail-closed)');
  check(normalizeBillingCountry('de') === 'DE', "'de' → 'DE' (Kleinschreibung)");
  check(normalizeBillingCountry(' DE ') === 'DE', "Whitespace wird getrimmt");
  check(normalizeBillingCountry('AT') === 'AT', "'AT' bleibt 'AT'");
  check(normalizeBillingCountry('') === '', "leerer String → ''");
  check(normalizeBillingCountry(undefined) === '', "undefined → ''");
  check(normalizeBillingCountry(42) === '', "Zahl → '' (kein truthy-Cast)");
  check(normalizeBillingCountry('DEU') === '', "3-Zeichen-Code → '' (kein Fake-Land)");
  check(isDeBillingCountry('DE') === true, "isDeBillingCountry('DE') = true");
  check(isDeBillingCountry('AT') === false, "isDeBillingCountry('AT') = false");
  check(isDeBillingCountry(undefined) === false, 'isDeBillingCountry(undefined) = false');
  check(assertDeBillingCountry('DE') === DE_BILLING_COUNTRY, "assertDeBillingCountry('DE') liefert 'DE'");
  let codeOk = false;
  try {
    assertDeBillingCountry('AT');
  } catch (err) {
    codeOk = (err as { code?: string }).code === DE_BILLING_REJECT_CODE;
  }
  check(codeOk, `assertDeBillingCountry('AT') wirft code ${DE_BILLING_REJECT_CODE}`);
  let missingThrows = false;
  try {
    assertDeBillingCountry(undefined);
  } catch {
    missingThrows = true;
  }
  check(missingThrows, 'fehlendes Rechnungsland wird abgelehnt (fail-closed)');

  console.log('\nB2. Policy-Entscheidung (Webhook-Pfad, ohne Werfen)');
  check(evaluateBillingCountryPolicy('DE').allowed === true, "DE → allowed");
  check(
    evaluateBillingCountryPolicy('AT').allowed === false &&
      evaluateBillingCountryPolicy('AT').reason === 'non_de',
    "AT → blocked (reason non_de)",
  );
  check(
    evaluateBillingCountryPolicy(undefined).allowed === false &&
      evaluateBillingCountryPolicy(undefined).reason === 'missing',
    "fehlend → blocked (reason missing = fail-closed)",
  );

  console.log('\nB3. Lesen aus dem Session-Objekt');
  const sessionAt = {
    customer_details: { address: { country: 'AT' }, email: 'kunde@example.com' },
    payment_intent: 'pi_AT123',
  };
  const sessionDe = {
    customer_details: { address: { country: 'de' }, email: 'kunde@example.de' },
    payment_intent: { id: 'pi_DE123' },
  };
  check(billingCountryFromSession(sessionAt) === 'AT', 'AT-Session → AT');
  check(billingCountryFromSession(sessionDe) === 'DE', 'DE-Session (lowercase) → DE');
  check(billingCountryFromSession({}) === '', 'Session ohne customer_details → ""');
  check(billingCountryFromSession(null) === '', 'null → "" (kein Crash)');
  check(paymentIntentIdFromSession(sessionAt) === 'pi_AT123', 'payment_intent als String');
  check(paymentIntentIdFromSession(sessionDe) === 'pi_DE123', 'payment_intent als Objekt');
  check(paymentIntentIdFromSession({}) === null, 'fehlender payment_intent → null');
  check(
    customerEmailFromSession(sessionAt) === 'kunde@example.com',
    'customer_details.email wird gelesen',
  );
  check(
    customerEmailFromSession({ customer_email: 'fallback@example.de' }) ===
      'fallback@example.de',
    'Fallback customer_email',
  );
  check(customerEmailFromSession({}) === null, 'keine E-Mail → null');

  // ── C. Durchsetzung ────────────────────────────────────────────────────────
  console.log('\nC. Durchsetzung im Webhook (Cancel + volle Erstattung)');
  {
    const { deps, calls } = recorder();
    const res = await enforceDeBillingPolicy(
      { country: 'AT', subscriptionId: 'sub_AT', paymentIntentId: 'pi_AT', eventId: 'evt_1' },
      deps,
    );
    check(res.allowed === false, 'AT: nicht erlaubt');
    check(calls.length === 2, 'AT: genau 2 Stripe-Writes (cancel + refund)');
    check(calls[0]?.fn === 'cancel' && calls[0]?.id === 'sub_AT', 'AT: erst cancel der Subscription');
    check(calls[1]?.fn === 'refund' && calls[1]?.id === 'pi_AT', 'AT: dann volle Erstattung des PaymentIntent');
    check(res.action === 'cancel_and_refund', "AT: action = cancel_and_refund");
  }
  {
    const { deps, calls } = recorder();
    const res = await enforceDeBillingPolicy(
      { country: 'DE', subscriptionId: 'sub_DE', paymentIntentId: 'pi_DE', eventId: 'evt_2' },
      deps,
    );
    check(res.allowed === true, 'DE: erlaubt');
    check(res.action === 'none', 'DE: action = none');
    check(calls.length === 0, 'DE: KEIN Stripe-Write (Verhalten wie bisher)');
  }
  {
    const { deps, calls } = recorder();
    const res = await enforceDeBillingPolicy(
      // kein country-Feld → fail-closed wie „nicht DE"
      { subscriptionId: 'sub_MISSING', paymentIntentId: 'pi_MISSING', eventId: 'evt_3' },
      deps,
    );
    check(res.allowed === false && res.reason === 'missing', 'fehlendes Land: blockiert (missing)');
    check(calls.length === 2, 'fehlendes Land: cancel + refund (fail-closed)');
  }
  {
    const { deps, calls } = recorder();
    const res = await enforceDeBillingPolicy(
      { country: 'CH', subscriptionId: 'sub_NOPI', paymentIntentId: null, eventId: 'evt_4' },
      deps,
    );
    check(res.action === 'cancel_only', 'ohne PaymentIntent: cancel_only');
    check(calls.length === 1 && calls[0]?.fn === 'cancel', 'ohne PaymentIntent: nur cancel');
  }

  // ── D. Idempotenz ──────────────────────────────────────────────────────────
  console.log('\nD. Idempotenz (kein Doppel-Refund bei Stripe-Retry)');
  const base1 = deGateIdempotencyBase({ eventId: 'evt_same', subscriptionId: 'sub_A' });
  const base2 = deGateIdempotencyBase({ eventId: 'evt_same', subscriptionId: 'sub_A' });
  check(base1 === base2, 'gleiche Event-ID → gleicher Idempotency-Basis-Key');
  check(
    base1 !== deGateIdempotencyBase({ eventId: 'evt_other', subscriptionId: 'sub_A' }),
    'andere Event-ID → anderer Key (verschiedene Vorgänge kollidieren nicht)',
  );
  check(
    deGateIdempotencyBase({ eventId: null, subscriptionId: 'sub_B' }).includes('sub_B'),
    'ohne Event-ID: Subscription-ID als stabiler Fallback',
  );
  check(base1.length <= 255, 'Key-Länge ≤ 255 Zeichen (Stripe-Limit)');
  {
    // Zweimal dasselbe Event (Retry): der zweite Lauf benutzt dieselben Keys.
    const { deps, calls } = recorder();
    const ev = { country: 'AT', subscriptionId: 'sub_R', paymentIntentId: 'pi_R', eventId: 'evt_retry' };
    await enforceDeBillingPolicy(ev, deps);
    await enforceDeBillingPolicy(ev, deps);
    const refundKeys = calls.filter((c) => c.fn === 'refund').map((c) => c.key);
    check(refundKeys.length === 2, 'Retry ruft refund erneut auf (2 Aufrufe)');
    check(
      refundKeys[0] === refundKeys[1],
      'beide refund-Aufrufe tragen denselben Idempotency-Key (Stripe führt ihn EINMAL aus)',
    );
  }

  // ── E. Statische Verdrahtung ───────────────────────────────────────────────
  console.log('\nE. Verdrahtung in checkout.ts / stripe-webhook.ts (Quelltext-Prüfung)');
  const checkoutSrc = readFileSync('./src/stripe/checkout.ts', 'utf8');
  const gateIdx = checkoutSrc.indexOf('assertDeBillingCountry(data.billingCountry)');
  const stripeIdx = checkoutSrc.indexOf("await import('stripe')");
  check(gateIdx > 0, 'checkout.ts ruft assertDeBillingCountry(data.billingCountry)');
  check(
    gateIdx > 0 && stripeIdx > gateIdx,
    'DE-Prüfung steht VOR dem Stripe-Import/-Client (kein Stripe-Call ohne DE)',
  );
  check(
    checkoutSrc.includes('...deCheckoutSessionParams()'),
    'Session nutzt deCheckoutSessionParams() (currency eur + Rechnungsadresse Pflicht)',
  );
  check(
    readFileSync('./src/stripe/de-billing.ts', 'utf8').includes(
      DE_BILLING_REJECT_CODE,
    ) && checkoutSrc.includes('assertDeBillingCountry'),
    'Ablehnung trägt den auswertbaren Code billing_country_not_de (Client-Mapping)',
  );
  const webhookSrc = readFileSync('./src/api/stripe-webhook.ts', 'utf8');
  check(
    webhookSrc.includes('evaluateBillingCountryPolicy') &&
      webhookSrc.includes('enforceDeBillingPolicy'),
    'Webhook wertet die DE-Policy aus und setzt sie durch',
  );
  check(
    webhookSrc.indexOf('evaluateBillingCountryPolicy') < webhookSrc.indexOf('status: "expired",'),
    'Webhook setzt den DB-Endzustand (expired) auf dem Sperr-Pfad',
  );
  // Rechnungsmail: `invoice_settings` kennt KEIN `email` (nur custom_fields/
  // default_payment_method/footer/rendering_options) → Absicherung MUSS über das
  // Top-Level-Kundenfeld `customers.update({ email })` laufen, sonst TS2353 bzw.
  // eine wirkungslose Rechnungsmail-Absicherung.
  const deBillingSrc = readFileSync('./src/stripe/de-billing.ts', 'utf8');
  check(
    !deBillingSrc.includes('invoice_settings: { email'),
    'de-billing.ts nutzt KEIN (nicht existierendes) invoice_settings.email',
  );
  check(
    /customers\.update\(customerId, \{ email \}/.test(deBillingSrc),
    'Rechnungsmail-Absicherung setzt customer.email (Top-Level-Feld), nicht invoice_settings',
  );

  console.log('\n────────────────────────────────────────────');
  console.log(`ERGEBNIS: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('Fehlgeschlagen:', failures.join(' | '));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Suite fehlgeschlagen (unexpected):', err);
  process.exitCode = 1;
});
