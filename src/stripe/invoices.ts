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
 * `pre_/post_payment_credit_notes_amount` sowie `payments?: ApiList<InvoicePayment>`).
 * Der Live-Read ergab deshalb am 2026-10-07 für die real erstattete Rechnung
 * `83SWNKUD-0001` hart `0`. Die Erstattung hängt am ZAHLUNGS-DATENSATZ der Rechnung
 * (`invoice.payments[].payment`):
 *   - `charge`:        `amount_refunded` = Zahl in kleinster Währungseinheit
 *   - `payment_record`: `amount_refunded` = { currency, value } (neues Modell, dahlia)
 *   - `payment_intent`: erstattet wird der zugehörige `latest_charge`
 * Kein Signal → 0 (fail-safe, es wird nie eine Erstattung behauptet).
 */
export function refundFromInvoicePayments(payments: unknown): number {
  let sum = 0;
  for (const ref of invoicePaymentRefs(payments)) sum += ref.inlineRefunded;
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

/** Art des Zahlungs-Datensatzes einer dahlia-Rechnung (`InvoicePayment.Payment.type`). */
export type InvoicePaymentKind = 'payment_intent' | 'charge' | 'payment_record';

/** Ein Zahlungs-Datensatz einer Rechnung, auf das Nötige reduziert. */
export interface InvoicePaymentRef {
  kind: InvoicePaymentKind | null;
  /** ID des Zahlungs-Objekts (`pi_…`/`ch_…`/`pr_…`), null wenn nicht ableitbar. */
  id: string | null;
  /** Erstattung, die DIREKT am Zahlungs-Objekt steht (0 = kein Feld vorhanden). */
  inlineRefunded: number;
}

/** Art einer Zahlungs-ID (`pi_…`/`ch_…`/`pr_…`) — null, wenn unbekannt. */
function kindOfId(id: string): InvoicePaymentKind | null {
  if (id.startsWith('pi_')) return 'payment_intent';
  if (id.startsWith('ch_')) return 'charge';
  if (id.startsWith('pr_')) return 'payment_record';
  return null;
}

/**
 * Betrag aus einem Stripe-Betragsfeld: Zahl (`Charge.amount_refunded`, alter Stil)
 * ODER Objekt `{ currency, value }` (`PaymentRecord.amount_refunded`, dahlia).
 * Alles andere → 0 (kein erfundener Betrag).
 */
function amountOf(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const v = (value as { value?: unknown }).value;
    if (typeof v === 'number') return v;
  }
  return 0;
}

/**
 * Zahlungs-Datensätze EINER dahlia-Rechnung (reine Funktion, testbar).
 *
 * Typ-Befund 2026-10-07 (stripe 22.3.2, API `2026-06-24.dahlia`,
 * `node_modules/stripe/esm/resources/InvoicePayments.d.ts`): Die Rechnung kennt
 * ihre Zahlung AUSSCHLIESSLICH über `payments?: ApiList<InvoicePayment>`
 * (`Invoices.d.ts`) — die Rechnung selbst hat kein `amount_refunded`, kein
 * `charge` und kein `payment_intent`. Jeder `InvoicePayment` trägt
 * `payment: InvoicePayment.Payment`:
 *   `{ type: 'payment_intent' | 'charge' | 'payment_record',
 *      payment_intent?: string | PaymentIntent,
 *      charge?: string | Charge,
 *      payment_record?: string | PaymentRecord }`
 * Die ID steht also NICHT unter `payment.id`, sondern unter dem typ-spezifischen
 * Feld (String, solange nicht expandiert). Die Erstattung liegt entweder dort
 * (`Charge.amount_refunded` Zahl / `PaymentRecord.amount_refunded.value`) oder
 * am `PaymentIntent.latest_charge` — sonst bleibt sie nur über die Refund-Liste
 * belegbar (siehe `refundTotalFromRefs`).
 */
export function invoicePaymentRefs(payments: unknown): InvoicePaymentRef[] {
  const list = Array.isArray(payments)
    ? payments
    : (payments as { data?: unknown } | null | undefined)?.data;
  if (!Array.isArray(list)) return [];
  const refs: InvoicePaymentRef[] = [];
  for (const entry of list) {
    const raw = (entry as { payment?: unknown } | null)?.payment ?? entry;
    if (typeof raw === 'string') {
      refs.push({ kind: kindOfId(raw), id: raw, inlineRefunded: 0 });
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, any>;
    const kind: InvoicePaymentKind | null =
      p.type === 'payment_intent' || p.type === 'charge' || p.type === 'payment_record'
        ? p.type
        : null;
    const sub = kind ? p[kind] : null;
    let inline = amountOf(p.amount_refunded);
    if (sub && typeof sub === 'object') {
      inline = Math.max(inline, amountOf(sub.amount_refunded));
      // PaymentIntent: die Erstattung sitzt am zugehörigen Charge.
      const charge = sub.latest_charge ?? sub.charge;
      if (charge && typeof charge === 'object') {
        inline = Math.max(inline, amountOf(charge.amount_refunded));
      }
    }
    let id: string | null =
      typeof sub === 'string'
        ? sub
        : sub && typeof sub === 'object'
          ? (typeof sub.id === 'string' ? sub.id : null)
          : null;
    if (!id) {
      // Zweitform (ID direkt am Zahlungs-Objekt, z. B. `{ type:'payment_intent', id:'pi_…' }`).
      for (const cand of [p.payment_intent, p.charge, p.payment_record, p.id]) {
        if (typeof cand === 'string' && kindOfId(cand)) {
          id = cand;
          break;
        }
      }
    }
    refs.push({ kind: kind ?? (id ? kindOfId(id) : null), id, inlineRefunded: inline });
  }
  return refs;
}

/** Buchführung für die Refund-Lookups einer Seite (Budget + Entdopplung). */
interface RefundLookup {
  seen: Set<string>;
  calls: number;
  budget: number;
}

/**
 * Letzter Beleg-Schritt: Erstattungen der Zahlungen einer Rechnung listen.
 * `RefundListParams` kennt in dieser API-Version nur `charge` und `payment_intent`
 * (`Refunds.d.ts`) — für `payment_record`-Zahlungen existiert keine Refund-Liste,
 * dort zählt ausschließlich das Direktfeld. Mehrfach gelistete Erstattungen
 * werden über die Refund-ID entdoppelt (kein doppelter Betrag), nicht belegte
 * oder rückgängig gemachte Erstattungen zählen nicht. Ohne Beleg → 0.
 */
async function refundTotalFromRefs(
  stripe: import('stripe').default,
  refs: InvoicePaymentRef[],
  lookup: RefundLookup,
): Promise<number> {
  let total = 0;
  for (const ref of refs) {
    if (!ref.id) continue;
    const param = ref.id.startsWith('pi_')
      ? { payment_intent: ref.id }
      : ref.id.startsWith('ch_')
        ? { charge: ref.id }
        : null;
    if (!param) continue;
    if (lookup.calls >= lookup.budget) break;
    lookup.calls += 1;
    try {
      const { data } = await stripe.refunds.list({ ...param, limit: 100 });
      for (const refund of data) {
        if (
          refund.status === 'failed' ||
          refund.status === 'canceled' ||
          refund.status === 'requires_action'
        ) {
          continue;
        }
        if (typeof refund.amount !== 'number') continue;
        const seenId =
          typeof refund.id === 'string'
            ? refund.id
            : `${ref.id}:${refund.amount}:${String(refund.created)}`;
        if (lookup.seen.has(seenId)) continue;
        lookup.seen.add(seenId);
        total += refund.amount;
      }
    } catch (err) {
      console.error('[invoices] refund lookup failed:', err);
    }
  }
  return total;
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
  const summaries: InvoiceSummary[] = [];
  // Budget begrenzt die Zahl zusätzlicher Stripe-Calls pro Seitenaufruf; `seen`
  // entdoppelt Erstattungen über mehrere Rechnungen/Zahlungen derselben Seite.
  const lookup: RefundLookup = { seen: new Set<string>(), calls: 0, budget: 5 };
  for (const raw of data) {
    const inv = raw as Record<string, any>;
    const firstLine = inv?.lines?.data?.[0];
    const period =
      firstLine && typeof firstLine.period === 'object' && firstLine.period
        ? (firstLine.period as { start?: number | null; end?: number | null })
        : null;
    const refund = invoiceRefundState(inv as { amount_refunded?: unknown });
    let refunded = refund.amountRefunded;
    if (refunded === 0) {
      // Kein Erstattungsfeld am Zahlungs-Datensatz lesbar (nicht expandiert) →
      // die Zahlung selbst benennen und ihre Erstattungen listen.
      const refs = invoicePaymentRefs(inv?.payments);
      if (refs.some((ref) => ref.id !== null)) {
        refunded = await refundTotalFromRefs(stripe, refs, lookup);
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
