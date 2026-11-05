// READ-ONLY gegen Stripe-TESTMODUS (Teil A). Nur retrieve/list, keine Writes.
// Beweisführung: Existiert eine ID im Testmodus, kann sie kein Live-Objekt sein.
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY || '';
const mode = key.startsWith('sk_test_') ? 'test' : key.startsWith('sk_live_') ? 'live' : 'unknown';
console.log('key_mode=' + mode + ' len=' + key.length);

const stripe = new Stripe(key);
const ids = [
  { kind: 'cus', id: 'cus_test_e2e_probe' },
  { kind: 'sub', id: 'sub_e2e_probe' },
  { kind: 'cus', id: 'cus_VGnsrR8kAH1WWO' },
  { kind: 'sub', id: 'sub_1UGGH9CcIt8AuaKqEdYy3F7p' },
  { kind: 'cus', id: 'cus_VGo0uqHD0btS4l' },
  { kind: 'sub', id: 'sub_1UGGP2CcIt8AuaKqudMA075P' },
  { kind: 'cus', id: 'cus_VLQ7ZBRPoDKm9C' },
  { kind: 'sub', id: 'sub_1UKjHiCcIt8AuaKqtAp2445d' },
  { kind: 'cus', id: 'cus_VOgqXAMdozrKwF' },
  { kind: 'sub', id: 'sub_1UNtUMCcIt8AuaKq0nSDylRi' },
] as const;

const rows: Record<string, unknown>[] = [];
for (const { kind, id } of ids) {
  try {
    if (kind === 'cus') {
      const c = await stripe.customers.retrieve(id);
      rows.push({
        kind, id, exists: true,
        deleted: (c as { deleted?: boolean }).deleted ?? false,
        created: (c as { created?: number }).created ?? null,
        email: (c as { email?: string | null }).email ?? null,
        livemode: (c as { livemode?: boolean }).livemode ?? null,
      });
    } else {
      const s = await stripe.subscriptions.retrieve(id);
      rows.push({
        kind, id, exists: true,
        status: s.status,
        customer: typeof s.customer === 'string' ? s.customer : s.customer?.id,
        created: s.created,
        current_period_end: (s as unknown as { current_period_end?: number }).current_period_end ?? null,
        cancel_at_period_end: (s as unknown as { cancel_at_period_end?: boolean }).cancel_at_period_end ?? null,
        livemode: (s as unknown as { livemode?: boolean }).livemode ?? null,
      });
    }
  } catch (err) {
    rows.push({ kind, id, exists: false, error: (err as Error).message.slice(0, 120) });
  }
}

const totals = {
  customers: (await stripe.customers.list({ limit: 100 })).data.length,
  subscriptions: (await stripe.subscriptions.list({ limit: 100, status: 'all' })).data.length,
  invoices: (await stripe.invoices.list({ limit: 100 })).data.length,
};

const out = { mode, rows, totals };
await Bun.write('/tmp/tarife-a-stripe-testmode.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(rows, null, 1));
console.log('totals=' + JSON.stringify(totals));
process.exit(0);
