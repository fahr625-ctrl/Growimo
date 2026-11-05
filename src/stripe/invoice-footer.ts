/**
 * ── § 19 UStG auf JEDER Kundenrechnung (Owner-Auftrag 2026-11-04) ────────────
 *
 * Ziel: Ab der ALLERERSTEN Rechnung steht „Steuerbefreit für Kleinunternehmer
 * gemäß § 19 UStG" auf dem Beleg — und es wird keine Umsatzsteuer berechnet
 * oder ausgewiesen (kein Stripe Tax, `tax_behavior` bleibt `unspecified`).
 *
 * ── Warum `customer.invoice_settings.footer` und kein anderer Weg ───────────
 * Belegt in den installierten SDK-Typen (stripe 22.3.2):
 *   - `CustomerCreateParams.InvoiceSettings.footer` / `CustomerUpdateParams…`
 *     (`esm/resources/Customers.d.ts`) — „Default footer to be displayed on
 *     invoices for this customer."
 *   - `Invoice.footer: string | null` (`esm/resources/Invoices.d.ts`) — die
 *     Fußzeile ist am Rechnungsobjekt selbst zurücklesbar (Beleg-Objekt).
 *   - `Checkout.SessionCreateParams.SubscriptionData.InvoiceSettings` kennt
 *     NUR `issuer` — KEIN `footer` (nachgesehen, nicht erinnert). Der scheinbar
 *     naheliegende Weg `subscription_data.invoice_settings.footer` existiert im
 *     Checkout also NICHT. `Subscriptions.create` könnte `footer` setzen, wird
 *     von uns aber nicht benutzt (Checkout erzeugt das Abo).
 *   - `InvoiceUpdateParams.footer` wäre ein Nachtrag NACH der Rechnung — zu
 *     spät für Rechnung #1 (und nur ein Write mehr).
 *
 * Deshalb: der Kunde wird VOR der Checkout-Session serverseitig angelegt (bzw.
 * wiederverwendet) und trägt die Fußzeile in `invoice_settings.footer`. Stripe
 * übernimmt sie in jede Rechnung dieses Kunden — inklusive der ersten, die
 * unmittelbar beim Abschluss des Checkouts entsteht. Ein Nachtragen erst im
 * Webhook (`checkout.session.completed`) wäre strukturell zu spät: die Rechnung
 * #1 existiert zu diesem Zeitpunkt bereits und bleibt ohne Hinweis.
 *
 * ── Wechselwirkung mit dem DE-Gate (EUR + Rechnungsland DE) ────────────────
 * Sobald `customer` gesetzt ist, darf `customer_email` NICHT mehr mitgegeben
 * werden (Stripe-Fehler). Die E-Mail steht stattdessen am Kundenobjekt. Und
 * damit die im Checkout erhobene Rechnungsadresse am Kunden landet (Portal,
 * Rechnungen, DE-Gate-Nachvollziehbarkeit), ist `customer_update` PFLICHT:
 * `{ address: 'auto', name: 'auto' }`. `billing_address_collection: 'required'`
 * bleibt unverändert in Kraft (siehe `deCheckoutSessionParams()`), ebenso
 * `currency: 'eur'` und `adaptive_pricing: { enabled: false }`.
 *
 * Fail-closed: schlägt das Anlegen/Aktualisieren des Kunden fehl, entsteht
 * KEINE Session (kein Beleg ohne Hinweis). Ein Stripe-Ausfall an dieser Stelle
 * hätte auch `checkout.sessions.create` scheitern lassen.
 */
import { VAT_DISCLAIMER } from '../lib/legal';

/** Die Fußzeile, die auf jeder Rechnung stehen muss (eine Quelle: legal.ts). */
export const INVOICE_FOOTER = VAT_DISCLAIMER;

/** Minimal-Ausschnitt des Stripe-Kundenobjekts, den dieser Pfad braucht. */
export interface FooterCustomerLike {
  id: string;
  invoice_settings?: { footer?: string | null } | null;
}

/**
 * Struktureller Ausschnitt von `stripe.customers` — bewusst schmal, damit der
 * Pfad ohne Netz (Fake) getestet werden kann.
 */
export interface CustomersApi {
  list(params: {
    email: string;
    limit: number;
  }): Promise<{ data: FooterCustomerLike[] }>;
  create(params: {
    email?: string;
    invoice_settings: { footer: string };
  }): Promise<FooterCustomerLike>;
  update(
    id: string,
    params: { invoice_settings: { footer: string } },
  ): Promise<FooterCustomerLike>;
}

export interface ResolvedFooterCustomer {
  customerId: string;
  /** true = Kunde neu angelegt (erster Checkout dieser E-Mail). */
  created: boolean;
  /** true = Fußzeile wurde in diesem Aufruf geschrieben. */
  footerWritten: boolean;
}

/**
 * Liefert eine Kunden-ID, deren `invoice_settings.footer` garantiert den
 * § 19-Hinweis trägt. Vorhandener Kunde (gleiche E-Mail) wird wiederverwendet,
 * damit wiederholte/abgebrochene Checkouts keine Kunden-Dubletten erzeugen; ist
 * seine Fußzeile leer oder anders, wird sie gesetzt.
 */
export async function resolveInvoiceFooterCustomer(
  customers: CustomersApi,
  email: string | null,
): Promise<ResolvedFooterCustomer> {
  const normalized = email?.trim() ?? '';
  if (normalized.length > 0) {
    const existing = await customers.list({ email: normalized, limit: 1 });
    const found = existing.data[0];
    if (found) {
      if ((found.invoice_settings?.footer ?? '') === INVOICE_FOOTER) {
        return { customerId: found.id, created: false, footerWritten: false };
      }
      await customers.update(found.id, {
        invoice_settings: { footer: INVOICE_FOOTER },
      });
      return { customerId: found.id, created: false, footerWritten: true };
    }
  }
  const created = await customers.create({
    ...(normalized.length > 0 ? { email: normalized } : {}),
    invoice_settings: { footer: INVOICE_FOOTER },
  });
  return { customerId: created.id, created: true, footerWritten: true };
}

/**
 * Session-Parameter für den vorab angelegten Kunden.
 *
 * `customer_update` ist NUR zusammen mit `customer` erlaubt (Stripe-Doku) und
 * hier Pflicht: ohne `address: 'auto'` würde die im Checkout erhobene
 * Rechnungsadresse nicht am Kunden gespeichert.
 */
export function footerCustomerSessionParams(customerId: string): {
  customer: string;
  customer_update: { address: 'auto'; name: 'auto' };
} {
  return {
    customer: customerId,
    customer_update: { address: 'auto', name: 'auto' },
  };
}
