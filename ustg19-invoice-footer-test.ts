/**
 * § 19 UStG — Rechnungs-Fußzeile: Logik-Test OHNE Netz (Fake-Stripe-Kunden).
 *
 * Prüft den Pfad aus `src/stripe/invoice-footer.ts`:
 *   - neuer Kunde wird MIT `invoice_settings.footer` = § 19-Hinweis angelegt,
 *   - vorhandener Kunde (gleiche E-Mail) wird WIEDERVERWENDET (keine Dubletten),
 *   - vorhandener Kunde mit leerer/falscher Fußzeile bekommt sie nachgesetzt,
 *   - Session-Parameter setzen `customer` + `customer_update` (Pflicht bei
 *     vorab angelegtem Kunden; `customer_email` entfällt dafür).
 * Dazu die Quelltext-Verdrahtung in `src/stripe/checkout.ts` (statisch), damit
 * ein späterer Umbau den Hinweis nicht still verliert.
 *
 * Lauf: `bun ustg19-invoice-footer-test.ts`
 */
import { readFileSync } from 'node:fs';
import {
  INVOICE_FOOTER,
  footerCustomerSessionParams,
  resolveInvoiceFooterCustomer,
  type CustomersApi,
  type FooterCustomerLike,
} from './src/stripe/invoice-footer';
import { VAT_DISCLAIMER } from './src/lib/legal';

let passed = 0;
let failed = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.log(`FAIL: ${label}${detail === undefined ? '' : ` — ${String(detail)}`}`);
  }
}

const EXPECTED = 'Steuerbefreit für Kleinunternehmer gemäß § 19 UStG.';

// ── 0. Eine Quelle: legal.ts ↔ Rechnungs-Fußzeile ───────────────────────────
check(INVOICE_FOOTER === VAT_DISCLAIMER, 'INVOICE_FOOTER ist exakt VAT_DISCLAIMER (keine zweite Kopie)');
check(INVOICE_FOOTER === EXPECTED, 'Fußzeile = Owner-Wortlaut § 19 UStG', INVOICE_FOOTER);

// ── Fake-Stripe ────────────────────────────────────────────────────────────
type Call =
  | { fn: 'list'; email: string }
  | { fn: 'create'; email?: string; footer: string }
  | { fn: 'update'; id: string; footer: string };

function fakeCustomers(seed: FooterCustomerLike[] = []) {
  const calls: Call[] = [];
  const store = [...seed];
  const api: CustomersApi = {
    async list({ email }) {
      calls.push({ fn: 'list', email });
      return { data: store.filter((c) => (c as { email?: string }).email === email) };
    },
    async create(params) {
      calls.push({ fn: 'create', email: params.email, footer: params.invoice_settings.footer });
      const created = {
        id: `cus_new_${store.length + 1}`,
        email: params.email,
        invoice_settings: { footer: params.invoice_settings.footer },
      } as FooterCustomerLike & { email?: string };
      store.push(created);
      return created;
    },
    async update(id, params) {
      calls.push({ fn: 'update', id, footer: params.invoice_settings.footer });
      const found = store.find((c) => c.id === id);
      if (found) found.invoice_settings = { footer: params.invoice_settings.footer };
      return found ?? { id, invoice_settings: { footer: params.invoice_settings.footer } };
    },
  };
  return { api, calls, store };
}

// ── 1. Neuer Kunde ─────────────────────────────────────────────────────────
{
  const { api, calls, store } = fakeCustomers();
  const res = await resolveInvoiceFooterCustomer(api, 'neu@example.de');
  check(res.created === true, 'neuer Kunde: created = true');
  check(res.footerWritten === true, 'neuer Kunde: Fußzeile geschrieben');
  check(store[0]?.invoice_settings?.footer === EXPECTED, 'neuer Kunde trägt die Fußzeile im Kundenobjekt', store[0]?.invoice_settings?.footer);
  check(
    calls.some((c) => c.fn === 'create' && c.footer === EXPECTED && c.email === 'neu@example.de'),
    'create() bekommt E-Mail + Fußzeile',
  );
  check(res.customerId === 'cus_new_1', 'Kunden-ID wird zurückgegeben', res.customerId);
}

// ── 2. Vorhandener Kunde mit richtiger Fußzeile → Wiederverwendung ─────────
{
  const store = [
    { id: 'cus_alt', email: 'beta@example.de', invoice_settings: { footer: EXPECTED } } as
      FooterCustomerLike & { email?: string },
  ];
  const fake = fakeCustomers(store);
  const res = await resolveInvoiceFooterCustomer(fake.api, 'beta@example.de');
  check(res.created === false, 'vorhandener Kunde: created = false (keine Dublette)');
  check(res.customerId === 'cus_alt', 'vorhandene Kunden-ID wird wiederverwendet', res.customerId);
  check(res.footerWritten === false, 'Fußzeile war schon richtig → kein unnötiger Write');
  check(!fake.calls.some((c) => c.fn === 'update'), 'kein update() bei korrekter Fußzeile');
}

// ── 3. Vorhandener Kunde OHNE Fußzeile → wird nachgesetzt ──────────────────
{
  const store = [{ id: 'cus_ohne', email: 'alt@example.de', invoice_settings: null } as FooterCustomerLike & { email?: string }];
  const fake = fakeCustomers(store);
  const res = await resolveInvoiceFooterCustomer(fake.api, 'alt@example.de');
  check(res.created === false && res.customerId === 'cus_ohne', 'Kunde ohne Fußzeile wird wiederverwendet');
  check(res.footerWritten === true, 'fehlende Fußzeile wird gesetzt');
  check(
    fake.calls.some((c) => c.fn === 'update' && c.id === 'cus_ohne' && c.footer === EXPECTED),
    'update() schreibt die § 19-Fußzeile',
  );
  check(fake.store[0]?.invoice_settings?.footer === EXPECTED, 'Kundenobjekt trägt die Fußzeile danach', fake.store[0]?.invoice_settings?.footer);
}

// ── 4. Ohne E-Mail (Randfall) → Kunde trotzdem mit Fußzeile ────────────────
{
  const { api, calls } = fakeCustomers();
  const res = await resolveInvoiceFooterCustomer(api, null);
  check(res.created === true, 'ohne E-Mail: Kunde wird angelegt (Fußzeile gilt trotzdem)');
  check(!calls.some((c) => c.fn === 'create' && c.email !== undefined), 'create() ohne erfundene E-Mail');
  check(calls.some((c) => c.fn === 'create' && c.footer === EXPECTED), 'create() setzt die Fußzeile auch ohne E-Mail');
}

// ── 5. Leerer String/Whitespace = keine E-Mail ────────────────────────────
{
  const { api, calls } = fakeCustomers();
  await resolveInvoiceFooterCustomer(api, '   ');
  check(!calls.some((c) => c.fn === 'list'), 'Whitespace-E-Mail: keine sinnlose list()-Suche');
  check(calls.some((c) => c.fn === 'create' && c.email === undefined), 'Whitespace-E-Mail: kein leerer E-Mail-Wert am Kunden');
}

// ── 6. Session-Parameter ──────────────────────────────────────────────────
{
  const p = footerCustomerSessionParams('cus_123');
  check(p.customer === 'cus_123', 'Session setzt customer');
  check(
    p.customer_update.address === 'auto' && p.customer_update.name === 'auto',
    'Session setzt customer_update { address: auto, name: auto } (Rechnungsadresse landet am Kunden)',
  );
  check(
    Object.keys(p).sort().join(',') === 'customer,customer_update',
    'keine weiteren (nicht dokumentierten) Session-Parameter',
    Object.keys(p).join(','),
  );
}

// ── 7. Verdrahtung in checkout.ts (statisch) ──────────────────────────────
{
  const src = readFileSync('./src/stripe/checkout.ts', 'utf8');
  /** Kommentare entfernen — geprüft wird CODE, nicht die Erklärung daneben. */
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
  const code = stripComments(src);
  check(src.includes('resolveInvoiceFooterCustomer'), 'checkout.ts legt den Kunden mit Fußzeile an');
  check(src.includes('footerCustomerSessionParams'), 'checkout.ts nutzt die Fußzeilen-Session-Parameter');
  check(!code.includes('customer_email'), 'checkout.ts sendet KEIN customer_email mehr (mit customer unzulässig)');
  const before = src.indexOf('resolveInvoiceFooterCustomer');
  const sessionIdx = src.indexOf('checkout.sessions.create');
  check(before > 0 && sessionIdx > before, 'Kunde wird VOR sessions.create aufgelöst (Fußzeile ab Rechnung #1)');
  check(src.includes('...deCheckoutSessionParams()'), 'DE-Gate-Parameter (EUR + Rechnungsadresse) unverändert aktiv');
  // Kein Stripe Tax, keine Steuer-Automatik (nur CODE, keine Kommentare):
  const stripeCode = stripComments(
    ['src/stripe/checkout.ts', 'src/stripe/invoice-footer.ts', 'src/stripe/de-billing.ts']
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n'),
  );
  check(!/automatic_tax/.test(stripeCode), 'kein automatic_tax im Stripe-Code (keine Steuerberechnung)');
  check(!/tax_id_collection/.test(stripeCode), 'kein tax_id_collection im Stripe-Code');
  check(!/tax_behavior/.test(stripeCode), 'kein tax_behavior im Stripe-Code (Preise unangetastet)');
  check(!/tax_rates/.test(stripeCode), 'kein tax_rates im Stripe-Code (keine Steuersätze am Posten)');
}

console.log('\n────────────────────────────────────────────');
console.log(`ERGEBNIS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
