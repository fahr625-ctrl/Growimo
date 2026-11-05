/**
 * § 19 UStG — TESTMODUS-Probe (read-only): Welche Preise/Coupons existieren im
 * Testmodus? Kein Write. Lauf: `bun --env-file=.env ustg19-probe.ts`
 * (STRIPE_SECRET_KEY muss ein sk_test_… sein — der Guard unten bricht sonst ab).
 */
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY ?? '';
if (!key.startsWith('sk_test_')) {
  throw new Error('ABBRUCH: kein Testschlüssel (sk_test_…) — es werden KEINE Live-Objekte angefasst.');
}
const stripe = new Stripe(key);

const prices = await stripe.prices.list({ limit: 100 });
const out = prices.data.map((p) => ({
  id: p.id,
  lookup_key: p.lookup_key,
  unit_amount: p.unit_amount,
  currency: p.currency,
  recurring: p.recurring?.interval ?? null,
  active: p.active,
  tax_behavior: p.tax_behavior,
  livemode: p.livemode,
}));
console.log('PRICES', JSON.stringify(out, null, 2));

const coupons = await stripe.coupons.list({ limit: 100 });
console.log(
  'COUPONS',
  JSON.stringify(
    coupons.data.map((c) => ({
      id: c.id,
      percent_off: c.percent_off,
      duration: c.duration,
      valid: c.valid,
      livemode: c.livemode,
    })),
    null,
    2,
  ),
);

const promos = await stripe.promotionCodes.list({ limit: 100 });
console.log('PROMOS', JSON.stringify(promos.data.map((p) => ({ id: p.id, code: p.code, active: p.active })), null, 2));

const customers = await stripe.customers.list({ limit: 5 });
console.log('CUSTOMERS_COUNT_SAMPLE', customers.data.length, 'has_more', customers.has_more);

const invoices = await stripe.invoices.list({ limit: 5 });
console.log('INVOICES_SAMPLE', invoices.data.length, 'has_more', invoices.has_more);
