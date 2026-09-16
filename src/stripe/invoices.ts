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
  invoices: InvoiceSummary[];
  /** Fehlerhinweis für die UI (nie ein Stripe-Secret/etc.). */
  error: string | null;
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
    return {
      id: inv.id,
      number: inv.number ?? null,
      created: inv.created,
      amountPaid: inv.amount_paid,
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
 * Live aus Stripe: aktuelles Perioden-Ende einer Subscription (Item-Pfad).
 * null bei Fehlern/unauffindbar (UI fällt auf DB-Wert zurück).
 */
export async function fetchLivePeriodEnd(
  stripe: import('stripe').default,
  subscriptionId: string,
): Promise<number | null> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const raw = sub as import('stripe').default.Subscription & {
      current_period_end?: number | null;
      items?: {
        data?: Array<{
          current_period_end?: number | null;
        } | null>;
      };
    };
    return periodEndOfSubscription(raw);
  } catch (err) {
    console.error('[invoices] live period-end lookup failed:', err);
    return null;
  }
}

export const getBillingOverview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BillingOverviewResult> => {
    const base: BillingOverviewResult = {
      signedIn: false,
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
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
      if (row.stripeSubscriptionId) {
        const livePeriodEnd = await fetchLivePeriodEnd(
          stripe,
          row.stripeSubscriptionId,
        );
        if (livePeriodEnd) {
          result.currentPeriodEnd = new Date(livePeriodEnd * 1000).toISOString();
        }
      }

      return result;
    } catch (err) {
      console.error('[invoices] billing overview failed (fail-soft):', err);
      return { ...base, signedIn: true, error: 'billing_overview_failed' };
    }
  },
);