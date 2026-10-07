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
 * P2-Nachfass (2026-10-07, live belegt): Erstattungsbetrag aus den ZAHLUNGEN einer
 * Rechnung. Grund: die API-Version `2026-06-24.dahlia` (stripe 22.3.2) führt
 * `amount_refunded` NICHT mehr am Invoice-Objekt (Typ-Nachweis: `Invoice` hat nur
 * `amount_paid`, `amount_paid_off_stripe`, `amount_remaining`,
 * `pre_/post_payment_credit_notes_amount`). Der Live-Read ergab deshalb am
 * 2026-10-07 für die real erstattete Rechnung `83SWNKUD-0001` hart `0`.
 * Die Erstattung steht am Zahlungs-Datensatz der Rechnung (`invoice.payments[].payment`):
 *   - `payment_record`: `amount_refunded` = { currency, value }  (neues Modell, dahlia)
 *   - `charge`:        `amount_refunded` = Zahl in kleinster Währungseinheit
 * Beides wird gelesen; kein Signal → 0 (fail-safe, es wird nie eine Erstattung behauptet).
 */
export function refundFromInvoicePayments(payments: unknown): number {
  const list = Array.isArray(payments)
    ? payments
    : (payments as { data?: unknown } | null | undefined)?.data;
  if (!Array.isArray(list)) return 0;
  let sum = 0;
  for (const entry of list) {
    const payment = (entry as { payment?: unknown } | null)?.payment ?? entry;
    const refunded = (payment as { amount_refunded?: unknown } | null)?.amount_refunded;
    if (typeof refunded === 'number') sum += refunded;
    else if (refunded && typeof refunded === 'object') {
      const value = (refunded as { value?: unknown }).value;
      if (typeof value === 'number') sum += value;
    }
  }
  return sum;
}

/**
 * P2: Erstattungszustand EINER Stripe-Rechnung (reine Funktion, testbar).
 * Stripe setzt `invoice.status` nach einer Erstattung NICHT um (bleibt `paid`)
 * und lässt `amount_paid` stehen — belastbar sind nur die Erstattungsfelder:
 * `invoice.amount_refunded` (ältere API-Versionen) ODER die Zahlungen der
 * Rechnung (`payments[].payment.amount_refunded`, siehe oben). Der größere der
 * beiden Werte gilt (idempotent für Versionen, die beides liefern).
 */
export function invoiceRefundState(invoice: {
  amount_refunded?: unknown;
  amount_paid?: unknown;
  payments?: unknown;
}): { amountRefunded: number; refunded: boolean } {
  const legacy =
    typeof invoice.amount_refunded === 'number' ? invoice.amount_refunded : 0;
  const amountRefunded = Math.max(legacy, refundFromInvoicePayments(invoice.payments));
  return { amountRefunded, refunded: amountRefunded > 0 };
}

/** Zahlungen einer Rechnung als Array (dahlia: `invoice.payments` = Liste). */
function invoicePayments(invoice: unknown): unknown[] {
  const payments = (invoice as { payments?: unknown } | null)?.payments;
  const list = Array.isArray(payments)
    ? payments
    : (payments as { data?: unknown } | null | undefined)?.data;
  return Array.isArray(list) ? list : [];
}

/** PaymentIntent-IDs der Zahlungen einer Rechnung (nur `pi_…`, für den Refund-Fallback). */
function paymentIntentIdsOfInvoice(invoice: unknown): string[] {
  const ids: string[] = [];
  for (const entry of invoicePayments(invoice)) {
    const payment = (entry as { payment?: unknown } | null)?.payment ?? entry;
    const id = typeof payment === 'string' ? payment : (payment as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && id.startsWith('pi_')) ids.push(id);
  }
  return ids;
}

/**
 * Letzter Refund-Fallback: Erstattungen pro PaymentIntent listen (die einzige
 * von der API-Version unterstützte Filter-Option neben `charge`). Wird nur
 * aufgerufen, wenn am Rechnungs-/Zahlungsobjekt kein Erstattungsfeld vorliegt.
 */
async function refundTotalFromPaymentIntents(
  stripe: import('stripe').default,
  paymentIntentIds: string[],
): Promise<number> {
  let sum = 0;
  for (const id of paymentIntentIds) {
    try {
      const { data } = await stripe.refunds.list({ payment_intent: id, limit: 100 });
      for (const refund of data) {
        if (refund.status === 'failed' || refund.status === 'canceled') continue;
        if (typeof refund.amount === 'number') sum += refund.amount;
      }
    } catch (err) {
      console.error('[invoices] refund lookup failed:', err);
    }
  }
  return sum;
}

// TEMPORÄR (Diagnose P2-Nachfass 2026-10-07): eine kompakte Form-Zeile pro
// Serverprozess, damit live belegt werden kann, WO die Erstattung in dieser
// API-Version steht. Wird nach der Live-Verifikation wieder entfernt.
let refundShapeLogged = false;
function logRefundShapeOnce(first: unknown): void {
  if (refundShapeLogged) return;
  refundShapeLogged = true;
  const inv = first as Record<string, any>;
  console.log(
    '[invoices] refund-shape',
    JSON.stringify({
      number: inv?.number ?? null,
      status: inv?.status ?? null,
      amountPaid: inv?.amount_paid ?? null,
      legacyAmountRefunded: inv?.amount_refunded ?? null,
      postPaymentCreditNotes: inv?.post_payment_credit_notes_amount ?? null,
      paymentsPresent: inv?.payments !== undefined,
      payments: invoicePayments(first).map((entry) => {
        const e = entry as Record<string, any>;
        const p = e?.payment ?? e;
        const id = typeof p === 'string' ? p : p?.id;
        return {
          type: p?.type ?? e?.type ?? null,
          id: typeof id === 'string' ? id.slice(0, 12) : null,
          amountRefunded: p?.amount_refunded ?? null,
        };
      }),
    }),
  );
}

/**
 * Reine Stripe-Funktion (importierbar für Tests/Skripte): alle Rechnungen eines
 * Stripe-Customers als schlanke Summaries (keine rohen SDK-Objekte im Payload).
 *
 * P2-Nachfass: die Rechnungen werden mit `payments.data.payment` expandiert, weil
 * der Erstattungszustand in dieser API-Version nur dort steht (siehe
 * `refundFromInvoicePayments`). Schlägt die Expansion fehl, wird ohne sie erneut
 * gelistet — die Billing-Seite darf an einer Expand-Option nie scheitern.
 */
export async function fetchInvoicesForCustomer(
  stripe: import('stripe').default,
  customerId: string,
  limit = 24,
): Promise<InvoiceSummary[]> {
  let data: unknown[];
  try {
    const res = await stripe.invoices.list({
      customer: customerId,
      limit,
      expand: ['data.payments.data.payment'],
    });
    data = res.data as unknown[];
  } catch (err) {
    console.error('[invoices] list with payments expand failed, retrying plain:', err);
    const res = await stripe.invoices.list({ customer: customerId, limit });
    data = res.data as unknown[];
  }
  if (data.length > 0) logRefundShapeOnce(data[0]);

  const summaries: InvoiceSummary[] = [];
  let fallbackBudget = 5; // begrenzt die Zahl zusätzlicher Stripe-Calls pro Seitenaufruf
  for (const raw of data) {
    const inv = raw as Record<string, any>;
    const firstLine = inv?.lines?.data?.[0];
    const period =
      firstLine && typeof firstLine.period === 'object' && firstLine.period
        ? (firstLine.period as { start?: number | null; end?: number | null })
        : null;
    const refund = invoiceRefundState(inv as { amount_refunded?: unknown });
    let refunded = refund.amountRefunded;
    if (refunded === 0 && fallbackBudget > 0) {
      const ids = paymentIntentIdsOfInvoice(inv);
      if (ids.length > 0) {
        fallbackBudget -= 1;
        refunded = await refundTotalFromPaymentIntents(stripe, ids);
      }
    }
    summaries.push({
      id: inv.id,
      number: inv.number ?? null,
      created: inv.created,
      amountPaid: inv.amount_paid,
      amountRefunded: refunded,
      refunded: refunded > 0,
      currency: inv.currency,
      status: inv.status ?? 'unknown',
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
      periodStart: typeof period?.start === 'number' ? period.start : null,
      periodEnd: typeof period?.end === 'number' ? period.end : null,
      description: firstLine?.description ?? null,
    });
  }
  return summaries;
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
 * `current_period_end` aktiv) und `cancel_at` (Unix-s oder null).
 *
 * **P2-Nachfass (2026-10-07, live belegt):** die Live-Subscription des Owners war im
 * Kundenportal gekündigt (`cancel_at` = 2026-11-07T11:57:13Z = Periodenende,
 * Stripe-Dashboard: „Läuft ab am 07.11."), der API-Read lieferte aber
 * `cancel_at_period_end = false`. Das Legacy-Feld wird von dieser API-Version
 * (2026-06-24.dahlia) also NICHT mehr auf `true` gesetzt — deshalb gilt eine
 * Kündigung als erkannt, wenn EINES der belegten Signale vorliegt:
 *   (1) `cancel_at_period_end === true` (explizit), ODER
 *   (2) `cancel_at` eine Zahl ist — laut SDK-Doku „a date in the future at which the
 *       subscription will automatically get canceled" (d. h. terminiert), ODER
 *   (3) `cancellation_details.reason` eine Kündigungsursache ist
 *       (`cancellation_requested` | `canceled_by_retention_policy`; der alte Wert
 *       `cancel_at_period_end` wird weiter akzeptiert), ODER
 *   (4) `canceled_at` gesetzt ist (SDK-Doku: auch bei Kündigung zum Periodenende wird
 *       der Zeitpunkt des Kündigungs-Requests dort festgehalten).
 * **Präzedenz:** diese Signale schlagen ein explizites `cancel_at_period_end: false`
 * (genau die Live-Kombination). Ohne jedes Signal gilt `false` als „nicht gekündigt" —
 * es wird nie eine Kündigung behauptet, die nicht belegt ist.
 */
export function subscriptionCancelState(sub: {
  cancel_at_period_end?: unknown;
  cancel_at?: unknown;
  canceled_at?: unknown;
  cancellation_details?: { reason?: unknown } | null;
}): { cancelAtPeriodEnd: boolean; cancelAt: number | null } {
  const explicit =
    typeof sub.cancel_at_period_end === 'boolean' ? sub.cancel_at_period_end : null;
  const cancelAt = typeof sub.cancel_at === 'number' ? sub.cancel_at : null;
  const reason = sub.cancellation_details?.reason;
  const cancelReason =
    reason === 'cancellation_requested' ||
    reason === 'canceled_by_retention_policy' ||
    reason === 'cancel_at_period_end';
  const scheduled =
    cancelAt !== null || cancelReason || typeof sub.canceled_at === 'number';
  return {
    cancelAtPeriodEnd: scheduled ? true : (explicit ?? false),
    cancelAt,
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