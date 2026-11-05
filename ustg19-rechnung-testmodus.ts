/**
 * ── § 19 UStG — BELEG IM TESTMODUS (Owner-Auftrag 2026-11-04, Teil B) ────────
 *
 * Baut mit dem TEST-Schlüssel (`sk_test_…`) genau die Produktionsparameter nach
 * und liest die Belege AM OBJEKT zurück:
 *
 *   1. Testkunde über den ECHTEN Produktionscode anlegen
 *      (`resolveInvoiceFooterCustomer` aus src/stripe/invoice-footer.ts) →
 *      `customer.invoice_settings.footer` muss den § 19-Hinweis tragen.
 *   2. Test-Abo auf `pro_monthly` (lookup_key, 1900 eur) → Rechnung abrufen:
 *      19,00 € / 1900 Cent, eur, KEINE Steuer (`tax`, `total_tax_amounts`,
 *      `automatic_tax`), `total == subtotal`, Fußzeile am Rechnungsobjekt.
 *   3. Gegenprobe BETA50 (Coupon, Testmodus) → 950 Cent, Steuer 0, Fußzeile da.
 *   4. Gegenprobe Jahr (`pro_yearly`) → 19000 Cent, Steuer 0, Fußzeile da.
 *   5. Checkout-Session mit den PRODUKTIONS-Parametern (customer +
 *      customer_update + currency eur + billing_address_collection required +
 *      adaptive_pricing aus) → Stripe akzeptiert die Kombination; danach wird
 *      die Session abgelaufen (keine Zahlung, kein Live-Objekt).
 *   6. Aufräumen: Abos kündigen, Rechnungen entwerten, Kunden löschen — mit
 *      Nachweis (retrieve → resource_missing, list → 0 Treffer).
 *
 * KEINE echte Zahlung (`payment_behavior: 'default_incomplete'` = Rechnung
 * bleibt offen, kein Zahlungsvorgang), KEINE Live-Objekte (Guard unten).
 *
 * Lauf: `bun ustg19-rechnung-testmodus.ts`  (STRIPE_SECRET_KEY = sk_test_…)
 */
import Stripe from 'stripe';
import {
  INVOICE_FOOTER,
  footerCustomerSessionParams,
  resolveInvoiceFooterCustomer,
} from './src/stripe/invoice-footer';

const key = process.env.STRIPE_SECRET_KEY ?? '';
if (!key.startsWith('sk_test_')) {
  throw new Error(
    'ABBRUCH: STRIPE_SECRET_KEY ist kein Testschlüssel (sk_test_…) — es werden KEINE Live-Objekte erzeugt.',
  );
}
const stripe = new Stripe(key);

const results: Array<{ ok: boolean; label: string; detail?: unknown }> = [];
function check(ok: boolean, label: string, detail?: unknown) {
  results.push({ ok, label, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

const run = `ustg19-${Date.now()}`;
const createdCustomers: string[] = [];
const createdSubs: string[] = [];
const createdSessions: string[] = [];
const evidence: Record<string, unknown> = { run, invoiceFooter: INVOICE_FOOTER, cases: {} };

/** Preise im Testmodus über lookup_key (identisch zur Produktion). */
async function priceIdFor(lookupKey: string): Promise<string> {
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  const price = prices.data[0];
  if (!price) throw new Error(`Kein Test-Preis mit lookup_key ${lookupKey}`);
  return price.id;
}

/** Rechnungs-Kernwerte, die belegt werden müssen. */
function invoiceFacts(invoice: Stripe.Invoice) {
  const taxAmounts = (invoice as unknown as { total_tax_amounts?: unknown[] }).total_tax_amounts ?? [];
  const tax = (invoice as unknown as { tax?: number | null }).tax ?? null;
  const automaticTax = (invoice as unknown as { automatic_tax?: { enabled?: boolean; status?: string | null } })
    .automatic_tax;
  return {
    id: invoice.id,
    number: invoice.number,
    currency: invoice.currency,
    subtotal: invoice.subtotal,
    total: invoice.total,
    amount_due: invoice.amount_due,
    amount_paid: invoice.amount_paid,
    tax,
    total_tax_amounts: taxAmounts,
    automatic_tax: automaticTax,
    footer: invoice.footer,
    customer: typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer as { id?: string } | null)?.id,
    status: invoice.status,
  };
}

/**
 * Test-Abo + Rechnung für einen Kunden. `payment_behavior: 'default_incomplete'`
 * erzeugt die Rechnung OHNE Zahlungsvorgang (kein Geld, keine Karte).
 */
async function subscriptionInvoice(
  customerId: string,
  lookupKey: string,
  couponId?: string,
): Promise<{ subscriptionId: string; invoice: Stripe.Invoice }> {
  const price = await priceIdFor(lookupKey);
  const sub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price }],
    payment_behavior: 'default_incomplete',
    ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
    expand: ['latest_invoice'],
  });
  createdSubs.push(sub.id);
  const latest = sub.latest_invoice;
  const invoiceId = typeof latest === 'string' ? latest : latest?.id;
  if (!invoiceId) throw new Error('Abo ohne Rechnung (latest_invoice fehlt)');
  // Frisch zurücklesen — Beleg ist das zurückgelesene Objekt, nicht der Request.
  const invoice = await stripe.invoices.retrieve(invoiceId);
  return { subscriptionId: sub.id, invoice };
}

async function main() {
  // ── 1. Testkunde über den PRODUKTIONSCODE ────────────────────────────────
  const email = `${run}@growimo-test.invalid`;
  const resolved = await resolveInvoiceFooterCustomer(stripe.customers, email);
  createdCustomers.push(resolved.customerId);
  check(resolved.created === true, '1. Produktionscode legt neuen Testkunden an', resolved);
  const customer = await stripe.customers.retrieve(resolved.customerId);
  const footer = (customer as Stripe.Customer).invoice_settings?.footer ?? null;
  check(footer === INVOICE_FOOTER, '1. customer.invoice_settings.footer (zurückgelesen) = § 19-Hinweis', footer);
  check((customer as Stripe.Customer).email === email, '1. Kunde trägt die Test-E-Mail', (customer as Stripe.Customer).email);
  evidence.customer = {
    id: resolved.customerId,
    email,
    invoice_settings: (customer as Stripe.Customer).invoice_settings,
  };

  // ── 2. Monat 19,00 € ─────────────────────────────────────────────────────
  const monthly = await subscriptionInvoice(resolved.customerId, 'pro_monthly');
  const m = invoiceFacts(monthly.invoice);
  check(m.currency === 'eur', '2. Monatsrechnung: Währung eur', m.currency);
  check(m.subtotal === 1900, '2. Monatsrechnung: subtotal 1900 Cent (19,00 €)', m.subtotal);
  check(m.total === 1900, '2. Monatsrechnung: total 1900 Cent', m.total);
  check(m.amount_due === 1900, '2. Monatsrechnung: amount_due 1900 Cent', m.amount_due);
  check(m.total === m.subtotal, '2. Monatsrechnung: total == subtotal (keine Steuer obendrauf)', { total: m.total, subtotal: m.subtotal });
  check((m.tax ?? 0) === 0, '2. Monatsrechnung: tax = 0', m.tax);
  check(Array.isArray(m.total_tax_amounts) && m.total_tax_amounts.length === 0, '2. Monatsrechnung: total_tax_amounts leer', m.total_tax_amounts);
  check(m.automatic_tax?.enabled !== true, '2. Monatsrechnung: automatic_tax nicht aktiv', m.automatic_tax);
  check(m.footer === INVOICE_FOOTER, '2. Monatsrechnung: § 19-Hinweis steht AM RECHNUNGSOBJEKT', m.footer);
  evidence.cases = { ...(evidence.cases as object), monthly: m };

  // ── 3. Gegenprobe BETA50 ─────────────────────────────────────────────────
  const betaEmail = `${run}-beta@growimo-test.invalid`;
  const betaCustomer = await resolveInvoiceFooterCustomer(stripe.customers, betaEmail);
  createdCustomers.push(betaCustomer.customerId);
  const coupons = await stripe.coupons.list({ limit: 100 });
  const beta50 = coupons.data.find((c) => c.id === 'BETA50' || c.name === 'BETA50');
  check(Boolean(beta50), '3. Coupon BETA50 im Testmodus vorhanden', beta50?.id);
  if (!beta50) throw new Error('Coupon BETA50 fehlt im Testmodus — Gegenprobe nicht möglich');
  const beta = await subscriptionInvoice(betaCustomer.customerId, 'pro_monthly', beta50.id);
  const b = invoiceFacts(beta.invoice);
  check(b.total === 950, '3. BETA50: total 950 Cent (9,50 €)', b.total);
  check(b.subtotal === 1900, '3. BETA50: subtotal bleibt 1900 Cent (Rabatt als Rabatt, nicht als Preisänderung)', b.subtotal);
  check((b.tax ?? 0) === 0, '3. BETA50: tax = 0', b.tax);
  check(Array.isArray(b.total_tax_amounts) && b.total_tax_amounts.length === 0, '3. BETA50: total_tax_amounts leer', b.total_tax_amounts);
  check(b.footer === INVOICE_FOOTER, '3. BETA50: § 19-Hinweis weiterhin am Rechnungsobjekt', b.footer);
  check(b.total === b.subtotal - 950, '3. BETA50: total = subtotal − 50 %', { total: b.total, subtotal: b.subtotal });
  const discounts = (beta.invoice as unknown as { discounts?: unknown[] }).discounts ?? [];
  check(discounts.length > 0, '3. BETA50: Rechnung trägt einen Discount-Eintrag', discounts.length);
  evidence.cases = { ...(evidence.cases as object), beta50: { ...b, discounts } };

  // ── 4. Gegenprobe Jahr 190,00 € ──────────────────────────────────────────
  const yearlyEmail = `${run}-yearly@growimo-test.invalid`;
  const yearlyCustomer = await resolveInvoiceFooterCustomer(stripe.customers, yearlyEmail);
  createdCustomers.push(yearlyCustomer.customerId);
  const yearly = await subscriptionInvoice(yearlyCustomer.customerId, 'pro_yearly');
  const y = invoiceFacts(yearly.invoice);
  check(y.currency === 'eur', '4. Jahresrechnung: Währung eur', y.currency);
  check(y.subtotal === 19000, '4. Jahresrechnung: subtotal 19000 Cent (190,00 €)', y.subtotal);
  check(y.total === 19000, '4. Jahresrechnung: total 19000 Cent', y.total);
  check(y.total === y.subtotal, '4. Jahresrechnung: total == subtotal (keine Steuer)', { total: y.total, subtotal: y.subtotal });
  check((y.tax ?? 0) === 0, '4. Jahresrechnung: tax = 0', y.tax);
  check(Array.isArray(y.total_tax_amounts) && y.total_tax_amounts.length === 0, '4. Jahresrechnung: total_tax_amounts leer', y.total_tax_amounts);
  check(y.footer === INVOICE_FOOTER, '4. Jahresrechnung: § 19-Hinweis am Rechnungsobjekt', y.footer);
  evidence.cases = { ...(evidence.cases as object), yearly: y };

  // ── 5. Checkout-Session mit PRODUKTIONS-Parametern (nur Parameter-Beleg) ──
  const sessionPrice = await priceIdFor('pro_monthly');
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: sessionPrice, quantity: 1 }],
    currency: 'eur',
    billing_address_collection: 'required',
    adaptive_pricing: { enabled: false },
    ...footerCustomerSessionParams(resolved.customerId),
    client_reference_id: 'ustg19-testmodus',
    success_url: 'https://www.growimo.app/app/billing?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://www.growimo.app/app/pricing',
    metadata: { ustg19: run },
  });
  createdSessions.push(session.id);
  check(session.currency === 'eur', '5. Session: currency eur', session.currency);
  check(session.billing_address_collection === 'required', '5. Session: billing_address_collection required', session.billing_address_collection);
  const sessionCustomer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  check(sessionCustomer === resolved.customerId, '5. Session nutzt den vorab angelegten Kunden (Fußzeile gilt ab Rechnung #1)', sessionCustomer);
  evidence.session = {
    id: session.id,
    currency: session.currency,
    billing_address_collection: session.billing_address_collection,
    customer: sessionCustomer,
    adaptive_pricing: (session as unknown as { adaptive_pricing?: unknown }).adaptive_pricing,
    url_present: Boolean(session.url),
  };

  // ── 6. Aufräumen ─────────────────────────────────────────────────────────
  for (const id of createdSessions) {
    try {
      await stripe.checkout.sessions.expire(id);
    } catch (err) {
      console.log(`INFO: Session ${id} nicht abgelaufen: ${(err as Error).message}`);
    }
  }
  for (const id of createdSubs) {
    try {
      await stripe.subscriptions.cancel(id);
    } catch (err) {
      console.log(`INFO: Abo ${id} nicht gekündigt: ${(err as Error).message}`);
    }
  }
  // Offene Rechnungen entwerten (gehören zu den Testkunden).
  const openInvoices = await stripe.invoices.list({ limit: 100 });
  const voided: string[] = [];
  for (const inv of openInvoices.data) {
    const cust = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
    if (cust && createdCustomers.includes(cust) && inv.status === 'open') {
      try {
        await stripe.invoices.voidInvoice(inv.id);
        voided.push(inv.id);
      } catch (err) {
        console.log(`INFO: Rechnung ${inv.id} nicht entwertet: ${(err as Error).message}`);
      }
    }
  }
  const deletedCustomers: string[] = [];
  for (const id of createdCustomers) {
    try {
      const del = await stripe.customers.del(id);
      if (del.deleted) deletedCustomers.push(id);
    } catch (err) {
      console.log(`INFO: Kunde ${id} nicht gelöscht: ${(err as Error).message}`);
    }
  }
  check(deletedCustomers.length === createdCustomers.length, '6. alle Testkunden gelöscht', { created: createdCustomers.length, deleted: deletedCustomers.length });

  // Nachweis: Kunden wirklich weg (retrieve → resource_missing), keine Reste.
  for (const id of createdCustomers) {
    let gone = false;
    try {
      const again = await stripe.customers.retrieve(id);
      gone = (again as { deleted?: boolean }).deleted === true;
    } catch (err) {
      gone = (err as { code?: string }).code === 'resource_missing';
    }
    check(gone, `6. Kunde ${id} ist nicht mehr abrufbar (gelöscht)`, gone);
  }
  for (const id of createdSubs) {
    const sub = await stripe.subscriptions.retrieve(id);
    check(sub.status === 'canceled', `6. Abo ${id} ist gekündigt`, sub.status);
  }
  const leftover = await stripe.customers.list({ email: email, limit: 3 });
  check(leftover.data.length === 0, '6. keine Kunden mit der Test-E-Mail übrig', leftover.data.length);

  evidence.cleanup = {
    sessions_expired: createdSessions,
    subscriptions_canceled: createdSubs,
    invoices_voided: voided,
    customers_deleted: deletedCustomers,
  };

  const failed = results.filter((r) => !r.ok);
  console.log('\n────────────────────────────────────────────');
  console.log(`ERGEBNIS: ${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) {
    console.log('Fehlgeschlagen:', failed.map((f) => f.label).join(' | '));
    process.exitCode = 1;
  }
  await Bun.write(
    '/home/team/shared/ustg19-2026-11-04/testmodus-evidenz.json',
    JSON.stringify({ results, evidence }, null, 2),
  );
  console.log('Evidenz: /home/team/shared/ustg19-2026-11-04/testmodus-evidenz.json');
}

await main();
