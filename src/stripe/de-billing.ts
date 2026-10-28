/**
 * ── DE-Launch-Gate (Owner-Auftrag 2026-10-26, Teil A) ─────────────────────────
 * Growimo startet Deutschland-only. Zwei Sperren, absichtlich unabhängig:
 *
 *   1. VOR dem Checkout (app-seitig): createCheckoutSession verlangt ein
 *      Rechnungsland und akzeptiert ausschließlich 'DE' (fail-closed, VOR dem
 *      ersten Stripe-Call). Die Session setzt zusätzlich `currency: 'eur'`
 *      (überschreibt die Adaptive-Pricing-Lokalisierung pro Session) und
 *      `billing_address_collection: 'required'`.
 *   2. NACH der Zahlung (Defense in depth): der Webhook liest das tatsächliche
 *      Rechnungsland aus `customer_details.address.country` und cancelt +
 *      erstattet, wenn es nicht 'DE' ist (oder fehlt). Grund: Stripe Checkout
 *      hat für die RECHNUNGSADRESSE KEINEN Länder-Filter — `allowed_countries`
 *      existiert nur an `shipping_address_collection` (siehe BEFUND-TEIL-A.md,
 *      Research-Abschnitt mit Zitat). Alles, was die Checkout-Seite selbst
 *      einschränkt, wäre also nicht garantiert.
 *
 * Reine Funktionen (kein DB-/Netz-Zugriff) — die Stripe-Schreibzugriffe sind als
 * Dependencies injiziert, damit Tests ohne echtes Stripe laufen.
 */

/** Einzig erlaubtes Rechnungsland beim Launch (ISO 3166-1 alpha-2). */
export const DE_BILLING_COUNTRY = 'DE';

/** Fehlercode, den Client und Tests auswerten (i18n: pricing_billing_country_blocked). */
export const DE_BILLING_REJECT_CODE = 'billing_country_not_de';

/** Billing-Portal-/Checkout-Metadatum zur Nachvollziehbarkeit im Stripe-Dashboard. */
export const DE_BILLING_METADATA_KEY = 'billingCountryGate';

export type BillingCountryReason = 'de' | 'non_de' | 'missing';

export class DeBillingCountryError extends Error {
  readonly code = DE_BILLING_REJECT_CODE;
  constructor(message = 'Billing country must be DE') {
    super(`${DE_BILLING_REJECT_CODE}: ${message}`);
    this.name = 'DeBillingCountryError';
  }
}

/**
 * Normalisiert ein Land auf 'DE'/'AT'/… oder '' (unbekannt/fehlend).
 * Nur echte zweistellige ISO-Codes zählen — alles andere ist '' und damit
 * NICHT erlaubt (fail-closed statt „leer = in Ordnung").
 */
export function normalizeBillingCountry(value: unknown): string {
  if (typeof value !== 'string') return '';
  const upper = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : '';
}

/** true nur bei exakt 'DE' (Groß-/Kleinschreibung + Whitespace toleriert). */
export function isDeBillingCountry(value: unknown): boolean {
  return normalizeBillingCountry(value) === DE_BILLING_COUNTRY;
}

/**
 * Fail-closed-Prüfung für den Checkout-Serverfn: wirft, wenn das Land nicht
 * 'DE' ist — inklusive fehlendem/ungültigem Wert.
 */
export function assertDeBillingCountry(value: unknown): 'DE' {
  if (!isDeBillingCountry(value)) {
    throw new DeBillingCountryError(
      'Ein Abschluss ist derzeit nur mit Rechnungsadresse in Deutschland möglich.',
    );
  }
  return DE_BILLING_COUNTRY;
}

export type BillingCountryPolicy = {
  allowed: boolean;
  reason: BillingCountryReason;
};

/** Policy-Entscheidung, ohne zu werfen (Webhook-Pfad). */
export function evaluateBillingCountryPolicy(
  value: unknown,
): BillingCountryPolicy {
  const country = normalizeBillingCountry(value);
  if (country === DE_BILLING_COUNTRY) return { allowed: true, reason: 'de' };
  if (country === '') return { allowed: false, reason: 'missing' };
  return { allowed: false, reason: 'non_de' };
}

/**
 * Feste, DE-erzwingende Session-Parameter.
 *
 * `currency: 'eur'` — Stripe-Doku (manual-currency-prices): „you can override
 * this behavior by specifying a currency when you create the Checkout Session …
 * the Checkout Session's currency is always EUR (eur) regardless of the
 * customer's location." Damit ist die Preisdarstellung im Checkout Euro, ohne
 * den Account-weiten Adaptive-Pricing-Schalter anzufassen (kein Dashboard-Write).
 *
 * `billing_address_collection: 'required'` — die Rechnungsadresse (und damit das
 * Land) wird IMMER erhoben; genau dieses Feld wertet der Webhook aus.
 *
 * `customer_update` wird bewusst NICHT gesetzt: Stripe erlaubt es nur zusammen
 * mit einem übergebenen `customer` (Doku: „Can only be provided when `customer`
 * is provided"), und wir legen den Kunden erst im Checkout an.
 */
export function deCheckoutSessionParams(): {
  currency: 'eur';
  billing_address_collection: 'required';
} {
  return {
    currency: 'eur',
    billing_address_collection: 'required',
  };
}

/**
 * Rechnungsland aus einem Checkout-Session-Objekt (Event-Payload).
 * Quelle: `customer_details.address.country` (Doku: „The customer's address
 * after a completed Checkout Session"). Fehlt sie, ist das Ergebnis '' →
 * fail-closed.
 */
export function billingCountryFromSession(
  session: Record<string, unknown> | null | undefined,
): string {
  if (!session || typeof session !== 'object') return '';
  const details = session.customer_details as
    | { address?: { country?: unknown } | null }
    | null
    | undefined;
  return normalizeBillingCountry(details?.address?.country);
}

/** PaymentIntent-ID der Session (String ODER expandiertes Objekt). */
export function paymentIntentIdFromSession(
  session: Record<string, unknown> | null | undefined,
): string | null {
  const raw = session?.payment_intent;
  if (typeof raw === 'string') return raw || null;
  if (raw && typeof raw === 'object') {
    const id = (raw as { id?: unknown }).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

/** Kunden-E-Mail der Session (für customer.email / Rechnungsmail). */
export function customerEmailFromSession(
  session: Record<string, unknown> | null | undefined,
): string | null {
  const details = session?.customer_details as
    | { email?: unknown }
    | null
    | undefined;
  const fromDetails = details?.email;
  if (typeof fromDetails === 'string' && fromDetails.includes('@')) {
    return fromDetails;
  }
  const fromSession = session?.customer_email;
  if (typeof fromSession === 'string' && fromSession.includes('@')) {
    return fromSession;
  }
  return null;
}

/**
 * Idempotenz-Basis für Cancel+Refund. Stripe liefert dasselbe Event bei einem
 * Retry mit derselben Event-ID; wiederholte Zustellungen (auch nach einem
 * 500 unsererseits) treffen damit denselben Idempotency-Key und lösen keinen
 * zweiten Cancel/Refund aus. Ist keine Event-ID vorhanden (Fixtures/Tests),
 * wird die Subscription-ID genutzt — ebenfalls stabil.
 */
export function deGateIdempotencyBase(input: {
  eventId?: string | null;
  subscriptionId: string;
}): string {
  const stable = input.eventId && input.eventId.length > 0
    ? input.eventId
    : `sub:${input.subscriptionId}`;
  // Stripe-Idempotency-Keys: max. 255 Zeichen.
  return `degate:${stable}`.slice(0, 240);
}

/** Stripe-Schreibzugriffe, die die DE-Policy braucht (in Tests ersetzt). */
export interface DeGateDeps {
  cancelSubscription: (subscriptionId: string, idempotencyKey: string) => Promise<void>;
  refundPaymentIntent: (paymentIntentId: string, idempotencyKey: string) => Promise<void>;
}

export type DeGateEnforcement = {
  allowed: boolean;
  reason: BillingCountryReason;
  action: 'none' | 'cancel_only' | 'cancel_and_refund';
  idempotencyBase: string | null;
};

/**
 * Zentrale Durchsetzung der DE-Policy für eine abgeschlossene Checkout-Session.
 *
 * - Land 'DE'            → nichts tun (Rückgabe action='none', kein Stripe-Call).
 * - Land ≠ 'DE'          → Subscription sofort canceln; existiert ein
 *                          PaymentIntent, wird die Zahlung vollständig erstattet.
 * - Land fehlt           → wie „≠ DE" (fail-closed). Begründung: mit
 *                          `billing_address_collection: 'required'` kann das
 *                          praktisch nicht passieren — wenn es doch passiert,
 *                          ist die Annahme der Sperre verletzt, und ein
 *                          möglicherweise ausländischer Kunde darf nicht
 *                          kostenpflichtig bleiben.
 *
 * Zahlungsdaten/Fehler werden NICHT verschluckt: wirft eine der beiden
 * Aktionen, propagiert der Fehler → Webhook antwortet 500 → Stripe liefert das
 * Event erneut (Idempotency-Key verhindert Doppelwirkung).
 */
export async function enforceDeBillingPolicy(
  input: {
    country: unknown;
    subscriptionId: string;
    paymentIntentId?: string | null;
    eventId?: string | null;
  },
  deps: DeGateDeps,
): Promise<DeGateEnforcement> {
  const policy = evaluateBillingCountryPolicy(input.country);
  if (policy.allowed) {
    return {
      allowed: true,
      reason: policy.reason,
      action: 'none',
      idempotencyBase: null,
    };
  }

  const base = deGateIdempotencyBase({
    eventId: input.eventId,
    subscriptionId: input.subscriptionId,
  });

  // Reihenfolge: erst canceln (stoppt jede weitere Abbuchung), dann erstatten.
  // Scheitert das Erstatten, ist das Abo trotzdem beendet und der 500-Retry
  // holt die Erstattung nach (Cancel ist dann „already canceled" → toleriert).
  await deps.cancelSubscription(input.subscriptionId, `${base}:cancel`);

  const paymentIntentId = input.paymentIntentId ?? null;
  if (!paymentIntentId) {
    return {
      allowed: false,
      reason: policy.reason,
      action: 'cancel_only',
      idempotencyBase: base,
    };
  }

  await deps.refundPaymentIntent(paymentIntentId, `${base}:refund`);
  return {
    allowed: false,
    reason: policy.reason,
    action: 'cancel_and_refund',
    idempotencyBase: base,
  };
}

/** Toleranz für „schon erledigt"-Fehler (Retry nach Erfolg → kein Fehlschlag). */
function isAlreadyDoneError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /already (been )?(cancel|refund)|has been canceled|has been refunded|already canceled/i.test(
    message,
  );
}

async function stripeClient(): Promise<import('stripe').default> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      'Stripe is not configured. Set STRIPE_SECRET_KEY to enable payments.',
    );
  }
  const { default: Stripe } = await import('stripe');
  return new Stripe(secretKey);
}

/**
 * Produktions-Dependencies: echte Stripe-Writes (Cancel + vollständige
 * Erstattung) mit Idempotency-Keys. Wird nur im Webhook-Pfad benutzt.
 */
export function productionDeGateDeps(): DeGateDeps {
  return {
    async cancelSubscription(subscriptionId, idempotencyKey) {
      const stripe = await stripeClient();
      try {
        await stripe.subscriptions.cancel(
          subscriptionId,
          {},
          { idempotencyKey },
        );
      } catch (err) {
        if (isAlreadyDoneError(err)) return;
        throw err;
      }
    },
    async refundPaymentIntent(paymentIntentId, idempotencyKey) {
      const stripe = await stripeClient();
      try {
        // KEIN `amount` = volle Erstattung des noch nicht erstatteten Betrags.
        await stripe.refunds.create(
          {
            payment_intent: paymentIntentId,
            reason: 'requested_by_customer',
            metadata: { deGate: DE_BILLING_REJECT_CODE },
          },
          { idempotencyKey },
        );
      } catch (err) {
        if (isAlreadyDoneError(err)) return;
        throw err;
      }
    },
  };
}

/**
 * Rechnungsmail-Sicherheit: die Kunden-E-Mail (`customer.email`, Top-Level-Feld)
 * setzen — Stripe adressiert Rechnungen und Rechnungsmails an dieses Feld
 * (Invoice → `customer_email`). `invoice_settings` selbst kennt KEIN `email`
 * (nur `custom_fields`/`default_payment_method`/`footer`/`rendering_options`;
 * belegt in den SDK-Typen `CustomerUpdateParams.InvoiceSettings`), deshalb
 * läuft die Absicherung über `customers.update({ email })`.
 * Best effort — ein Fehler hier darf eine bezahlte, erlaubte (DE) Zahlung nicht
 * zu einem 500 machen.
 */
export async function syncCustomerInvoiceEmail(
  customerId: string,
  email: string,
  idempotencyKey: string,
): Promise<void> {
  const stripe = await stripeClient();
  await stripe.customers.update(customerId, { email }, { idempotencyKey });
}
