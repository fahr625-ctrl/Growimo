import { createServerFn } from '@tanstack/react-start';

/**
 * Phase 8.4b — Billing-Verlauf (Invoices) + Live-Abo-Info.
 *
 * Liefert für den angemeldeten Nutzer die Rechnungen seines Stripe-Customers
 * (NUR Testmodus; sk_test aus STRIPE_SECRET_KEY, KEIN Client-Key) plus das
 * aktuelle Periodenende live aus Stripe.
 *
 * Bekannte Einschränkung (8.3d-Befund): Die Konto-API-Version
 * `2026-08-26.dahlia` führt `current_period_end` am Subscription-ITEM
 * (`items.data[].current_period_end`), nicht an der Subscription selbst — die
 * subscriptions-DB-Zeile bekam daher bisher NULL. Diese Funktion liest den
 * Perioden-Endpunkt deshalb live aus dem Item-Pfad (Fallback: Top-Level-Feld
 * für getestete API-Versionen) und fällt sonst auf den DB-Wert zurück.
 *
 * Fail-soft: Stripe-/DB-Fehler brechen die Billing-Seite nicht — die UI zeigt
 * den Fehlerhinweis und den Leerzustand. Ohne Session → signedIn:false.
 */
export interface InvoiceSummary {
  id: string;
  number: string | null;
  /** Unix-Sekunden (Stripe-Zeitstempel). */
  created: number;
  /** Kleinste Währungseinheit (Cent). */
  amountPaid: number;
  /**
   * P2 Statusabbildung (2026-10-07): bereits erstatteter Betrag in Cent
   * (`invoice.amount_refunded`). 0 = keine Erstattung.
   */
  amountRefunded: number;
  /** true, wenn amountRefunded > 0 — die UI zeigt dann „Erstattet"/„Refunded". */
  refunded: boolean;
  currency: string;
  /** Stripe-Invoice-Status: paid | open | void | draft | uncollectible | … */
  status: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  /** Abrechnungszeitraum (Unix-s) aus der ersten Line-Item-Periode. */
  periodStart: number | null;
  periodEnd: number | null;
  description: string | null;
}

export interface BillingOverviewResult {
  signedIn: boolean;
  stripeConfigured: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** Live aus Stripe (Item-Pfad) bzw. DB-Fallback — ISO oder null. */
  currentPeriodEnd: string | null;
  /**
   * P2: Kündigung zum Periodenende. Live aus Stripe gelesen (autoritativ,
   * funktioniert auch wenn das `customer.subscription.updated`-Event (noch)
   * nicht zugestellt wurde), Fallback = DB-Spalte.
   */
  cancelAtPeriodEnd: boolean;
  /** P2: terminierter Kündigungszeitpunkt (ISO) oder null. */
  cancelAt: string | null;
  invoices: InvoiceSummary[];
  /** Fehlerhinweis für die UI (nie ein Stripe-Secret/etc.). */
  error: string | null;
}

/**
 * P2: Erstattungszustand EINER Stripe-Rechnung (reine Funktion, testbar).
 * Stripe setzt `invoice.status` nach einer Erstattung NICHT um (bleibt `paid`)
 * und lässt `amount_paid` stehen — die einzige belastbare Quelle ist
 * `amount_refunded` (Summe aller Erstattungen dieser Rechnung).
 */
export function invoiceRefundState(invoice: {
  amount_refunded?: unknown;
  amount_paid?: unknown;
}): { amountRefunded: number; refunded: boolean } {
  const amountRefunded =
    typeof invoice.amount_refunded === 'number' ? invoice.amount_refunded : 0;
  return { amountRefunded, refunded: amountRefunded > 0 };
}

/**
 * Reine Stripe-Funktion (importierbar für Tests/Skripte): alle Rechnungen eines
 * Stripe-Customers als schlanke Summaries (keine rohen SDK-Objekte im Payload).
 */
export async function fetchInvoicesForCustomer(
  stripe: import('stripe').default,
  customerId: string,
  limit = 24,
): Promise<InvoiceSummary[]> {
  const { data } = await stripe.invoices.list({ customer: customerId, limit });
  return data.map((inv) => {
    const firstLine = inv.lines?.data?.[0];
    const period =
      firstLine && typeof firstLine.period === 'object' && firstLine.period
        ? (firstLine.period as { start?: number | null; end?: number | null })
        : null;
    const refund = invoiceRefundState(inv as unknown as { amount_refunded?: unknown });
    return {
      id: inv.id,
      number: inv.number ?? null,
      created: inv.created,
      amountPaid: inv.amount_paid,
      amountRefunded: refund.amountRefunded,
      refunded: refund.refunded,
      currency: inv.currency,
      status: inv.status ?? 'unknown',
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
      periodStart: typeof period?.start === 'number' ? period.start : null,
      periodEnd: typeof period?.end === 'number' ? period.end : null,
      description: firstLine?.description ?? null,
    };
  });
}

/**
 * Perioden-Ende (Unix-s) einer Stripe-Subscription.
 * Relevanz: API-Version `2026-08-26.dahlia` führt `current_period_end` am
 * Subscription-ITEM (`items.data[0].current_period_end`); ältere Versionen an
 * der Subscription selbst. Beide Pfade werden geprüft (Item zuerst).
 */
export function periodEndOfSubscription(sub: {
  current_period_end?: number | null;
  items?: {
    data?: Array<{ current_period_end?: number | null } | null | undefined>;
  };
}): number | null {
  const item = sub.items?.data?.[0];
  if (item && typeof item.current_period_end === 'number') {
    return item.current_period_end;
  }
  return typeof sub.current_period_end === 'number' ? sub.current_period_end : null;
}

/**
 * P2: Kündigungszustand einer Stripe-Subscription (reine Funktion, testbar).
 *
 * Liest `cancel_at_period_end` (Kündigung zum Periodenende, Abo bleibt bis
 * `current_period_end` aktiv) und `cancel_at` (Unix-s oder null). Fallback für
 * API-Versionen, die statt des Feldes `cancellation_details.reason` führen
 * (`'cancel_at_period_end'` = im Kundenportal zum Periodenende gekündigt).
 * Kein Feld vorhanden → false (fail-safe: nichts anzeigen, was nicht belegt ist).
 */
export function subscriptionCancelState(sub: {
  cancel_at_period_end?: unknown;
  cancel_at?: unknown;
  cancellation_details?: { reason?: unknown } | null;
}): { cancelAtPeriodEnd: boolean; cancelAt: number | null } {
  const explicit =
    typeof sub.cancel_at_period_end === 'boolean' ? sub.cancel_at_period_end : null;
  const reason = sub.cancellation_details?.reason;
  return {
    cancelAtPeriodEnd: explicit ?? reason === 'cancel_at_period_end',
    cancelAt: typeof sub.cancel_at === 'number' ? sub.cancel_at : null,
  };
}

export interface LiveSubscriptionState {
  /** Unix-Sekunden oder null (Item-Pfad zuerst, Top-Level-Fallback). */
  currentPeriodEnd: number | null;
  /** Kündigung zum Periodenende (aus Stripe, autoritativ). */
  cancelAtPeriodEnd: boolean;
  /** Unix-Sekunden des terminierten Kündigungszeitpunkts oder null. */
  cancelAt: number | null;
}

/**
 * Live aus Stripe: Periodenende + Kündigungszustand einer Subscription (ein
 * einziger Retrieve). null bei Fehlern/unauffindbar (UI fällt auf DB-Werte
 * zurück) — die Billing-Seite darf daran nie scheitern.
 */
export async function fetchLiveSubscriptionState(
  stripe: import('stripe').default,
  subscriptionId: string,
): Promise<LiveSubscriptionState | null> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const raw = sub as import('stripe').default.Subscription & {
      current_period_end?: number | null;
      cancel_at_period_end?: unknown;
      cancel_at?: unknown;
      cancellation_details?: { reason?: unknown } | null;
      items?: {
        data?: Array<{
          current_period_end?: number | null;
        } | null>;
      };
    };
    return {
      currentPeriodEnd: periodEndOfSubscription(raw),
      ...subscriptionCancelState(raw),
    };
  } catch (err) {
    console.error('[invoices] live subscription state lookup failed:', err);
    return null;
  }
}

/**
 * Live aus Stripe: aktuelles Perioden-Ende einer Subscription (Item-Pfad).
 * null bei Fehlern/unauffindbar (UI fällt auf DB-Wert zurück).
 */
export async function fetchLivePeriodEnd(
  stripe: import('stripe').default,
  subscriptionId: string,
): Promise<number | null> {
  const state = await fetchLiveSubscriptionState(stripe, subscriptionId);
  return state?.currentPeriodEnd ?? null;
}

export const getBillingOverview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BillingOverviewResult> => {
    const base: BillingOverviewResult = {
      signedIn: false,
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      invoices: [],
      error: null,
    };

    const { resolveUserIdFromServerFn } = await import('../lib/usage-guard');
    const userId = await resolveUserIdFromServerFn(undefined);
    if (!userId) return base;

    try {
      const { qGetSubscriptionForUser } = await import('../db/queries');
      const row = await qGetSubscriptionForUser(userId);
      if (!row) return { ...base, signedIn: true };

      const result: BillingOverviewResult = {
        ...base,
        signedIn: true,
        stripeCustomerId: row.stripeCustomerId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        currentPeriodEnd: row.currentPeriodEnd
          ? row.currentPeriodEnd.toISOString()
          : null,
        // DB-Stand (Webhook); wird unten durch den Live-Wert aus Stripe
        // überschrieben, sobald dieser vorliegt.
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        cancelAt: row.cancelAt ? row.cancelAt.toISOString() : null,
      };

      const secretKey = process.env.STRIPE_SECRET_KEY;
      if (!secretKey) return result;

      const { default: Stripe } = await import('stripe');
      const stripe = new Stripe(secretKey);

      // Rechnungen (NUR Serverseite — nie ein Client-Key).
      if (row.stripeCustomerId) {
        try {
          result.invoices = await fetchInvoicesForCustomer(
            stripe,
            row.stripeCustomerId,
          );
        } catch (err) {
          console.error('[invoices] fetch failed:', err);
          result.error = 'invoice_fetch_failed';
        }
      }

      // Live-Periodenende (Item-Pfad, dahlia) — heilt die bekannte
      // current_period_end-NULL-Einschränkung in der ANZEIGE (DB bleibt NULL).
      // P2 (2026-10-07): derselbe Retrieve liefert den Kündigungszustand
      // (cancel_at_period_end/cancel_at) — er ist damit auch dann korrekt
      // sichtbar, wenn das subscription.updated-Event (noch) nicht zugestellt
      // wurde. Nur Anzeige: die Pro-/Quota-Entscheidung bleibt unverändert in
      // der DB (qGetPlanTier).
      if (row.stripeSubscriptionId) {
        const live = await fetchLiveSubscriptionState(
          stripe,
          row.stripeSubscriptionId,
        );
        if (live) {
          if (live.currentPeriodEnd) {
            result.currentPeriodEnd = new Date(
              live.currentPeriodEnd * 1000,
            ).toISOString();
          }
          result.cancelAtPeriodEnd = live.cancelAtPeriodEnd;
          result.cancelAt = live.cancelAt
            ? new Date(live.cancelAt * 1000).toISOString()
            : null;
        }
      }

      return result;
    } catch (err) {
      console.error('[invoices] billing overview failed (fail-soft):', err);
      return { ...base, signedIn: true, error: 'billing_overview_failed' };
    }
  },
);