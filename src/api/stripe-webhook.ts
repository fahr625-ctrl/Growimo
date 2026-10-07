// ── Phase 8.3 Stripe-Webhook (Zahlungs-Events → subscriptions-Tabelle) ────────
// Owner-Entscheidung 2026-09-12 (verbindlich): Pro = 19 €/Monat (200
// Generierungen) · Jahresplan 190 € · Beta-Rabatt 50 % lebenslang NUR für
// vor-Public-Launch registrierte Beta-Nutzer · kein „unbegrenzt"-Tarif.
//
// Der Webhook ist der einzige Schreibpfad, der Zahlungsstatus in die
// subscriptions-Tabelle überträgt; der Usage-Guard (src/lib/usage-guard.ts →
// qGetPlanTier) liest exakt diese Tabelle und schaltet damit Free-5/Pro-200
// frei. Fail-closed: ohne STRIPE_WEBHOOK_SECRET wird JEDE Anfrage mit 500
// abgelehnt (Stripe retried) — nie ein stilles Ignorieren.
//
// Verarbeitete Events:
//   checkout.session.completed        → Subscription aktivieren (paid) + Customer
//   invoice.paid                      → current_period_end verlängern
//   customer.subscription.updated     → Status-Sync (active/cancelled/expired)
//                                       + Kündigungszustand (P2: cancel_at_period_end/cancel_at)
//   customer.subscription.deleted     → Status 'expired' (+ Kündigungszustand zurücksetzen)
//   refund-bezogene Events            → bewusst 200-OHNE DB-Wirkung (siehe unten)
//   alles andere                      → 200-ignorieren (Stripe-Semantik)
// Fehler (DB/Netz)                    → 500 → Stripe liefert das Event erneut.
//
// P2 Statusabbildung (2026-10-07, Owner-Auftrag): Der REFUND-Status wird
// bewusst NICHT über Events in die DB gespiegelt, sondern beim Rechnungs-Read
// live aus Stripe gelesen (`invoice.amount_refunded` → InvoiceSummary.refunded).
// Begründung: Rechnungen liegen in Growimo nicht in der DB (kein invoices-
// Tabelle) — die DB hat gar keinen Ort für einen Refund-Status, und eine
// eigene Spiegel-Tabelle wäre eine zweite Wahrheit, die bei fehlender
// Event-Zustellung still falsch bliebe. Stripe ist die Autorität.
import {
  qGetSubscriptionByStripeId,
  qUpsertSubscription,
} from "../db/queries";
import { periodEndOfSubscription, subscriptionCancelState } from "../stripe/invoices";

export const STRIPE_WEBHOOK_PATH = "/api/stripe-webhook";

/** Strikte Lookup-Keys (Preise kommen AUS Stripe via lookup_key — nichts im Code erfunden). */
export const PRO_MONTHLY_LOOKUP_KEY = "pro_monthly";
export const PRO_YEARLY_LOOKUP_KEY = "pro_yearly";

/** Promo-Code für den Beta-50 %-Rabatt (konfigurierbar per Env; kein Secret). */
export const BETA_PROMO_CODE = "BETA50";

/** plan_tier aus einem Stripe-Preis-lookup_key; null = nicht ableitbar (fail-closed). */
export function planTierForLookupKey(
  lookupKey: string | null | undefined,
): "free" | "pro" | null {
  if (!lookupKey) return null;
  return lookupKey.startsWith("pro_") ? "pro" : "free";
}

/**
 * Stripe-Subscription-Status → DB-Status (CHECK: active/cancelled/expired).
 * 'active'/'trialing' → active; 'canceled' → cancelled (Zugriff bis Periodenende);
 * alles andere (past_due/unpaid/incomplete/…) → expired (fail-closed: kein Zugriff).
 */
export function mapSubscriptionStatus(
  status: string | null | undefined,
): "active" | "cancelled" | "expired" {
  if (status === "active" || status === "trialing") return "active";
  if (status === "canceled") return "cancelled";
  return "expired";
}

/** Abhängigkeiten, die Tests ersetzen können (kein echtes Stripe-Netz nötig). */
export interface StripeWebhookDeps {
  /**
   * Lädt eine Subscription (für checkout.session.completed, wo das Event die
   * period_end nicht enthält). Produktion: strikte API-Calls; Tests: Fixture.
   */
  retrieveSubscription?: (subscriptionId: string) => Promise<{
    current_period_end?: number | null;
    items?: {
      data?: Array<
        | {
            current_period_end?: number | null;
            price?: { lookup_key?: string | null } | null;
          }
        | null
        | undefined
      >;
    };
  }>;
}

/**
 * Subscription-ID einer RECHNUNG.
 *
 * API-Version 2026-08-26.dahlia (Live-Stand des Testkontos, per echtem
 * Event-Payload verifiziert): das frühere Top-Level-Feld `invoice.subscription`
 * existiert NICHT mehr — die Verknüpfung steht unter
 * `invoice.parent.subscription_details.subscription`. Reihenfolge:
 * neuer Pfad zuerst, alter Pfad als Rückwärtskompatibilität.
 */
export function invoiceSubscriptionId(invoice: Record<string, unknown>): string | null {
  const parent = invoice.parent as
    | { subscription_details?: { subscription?: unknown } | null }
    | null
    | undefined;
  return (
    subscriptionIdOf(parent?.subscription_details?.subscription) ??
    subscriptionIdOf(invoice.subscription)
  );
}

/** Rechnungsposten 0 (typsicher genug für beide API-Formen). */
function firstInvoiceLine(
  invoice: Record<string, unknown>,
): Record<string, unknown> | null {
  const lines = invoice.lines as { data?: unknown[] } | null | undefined;
  const first = Array.isArray(lines?.data) ? lines.data[0] : null;
  return first && typeof first === 'object' ? (first as Record<string, unknown>) : null;
}

/**
 * Endzeitpunkt der Abrechnungsperiode aus einer Rechnung (Unix-Sekunden).
 *
 * dahlia liefert am Posten `period.end` — das ist die Verlängerung der
 * Subscription-Periode (verifiziert am echten Event: `lines[0].period.end`
 * = 1792147764 = `items[0].current_period_end` der Subscription, während
 * `invoice.period_end` beim Erstkauf 1789555764 = Periodenbeginn war).
 * Deshalb: Posten-Periodenende zuerst, `invoice.period_end` als Fallback.
 */
export function invoicePeriodEnd(invoice: Record<string, unknown>): number | null {
  const line = firstInvoiceLine(invoice);
  const lineEnd = (line?.period as { end?: unknown } | null | undefined)?.end;
  if (typeof lineEnd === 'number') return lineEnd;
  return typeof invoice.period_end === 'number' ? invoice.period_end : null;
}

/**
 * lookup_key des Rechnungspreises — NUR in der alten API-Form vorhanden
 * (`lines[].price.lookup_key`). In dahlia ist `line.price` entfallen
 * (`lines[].pricing.price_details.price` trägt nur noch die price-ID, ohne
 * lookup_key) → dann `null`, und der bestehende DB-Tarif bleibt maßgeblich
 * (fail-closed: nie aus einer unlesbaren ID einen Tarif erfinden).
 */
export function invoicePriceLookupKey(invoice: Record<string, unknown>): string | null {
  const line = firstInvoiceLine(invoice);
  const legacy = line?.price as { lookup_key?: string | null } | null | undefined;
  return legacy?.lookup_key ?? null;
}

function subscriptionIdOf(id: unknown): string | null {
  if (!id) return null;
  // Stripe-Event-Objekte liefern die Subscription-ID entweder als String
  // (checkout.session.subscription, invoice.subscription) oder als Objekt
  // mit `id` (customer.subscription.* → sub.id). Unknown-narrowing statt Cast:
  // nur String-/Objekt-Fälle mit echtem `id`-Feld akzeptieren.
  if (typeof id === "string") return id || null;
  if (typeof id === "object" && id !== null) {
    const inner = (id as { id?: unknown }).id;
    return typeof inner === "string" && inner.length > 0 ? inner : null;
  }
  return null;
}

/**
 * Verarbeitet EIN Stripe-Event → subscriptions-Writes (idempotent, upsert über
 * stripe_subscription_id). Wirft bei Verarbeitungsfehlern (Aufrufer → 500, Stripe
 * retried); unbekannte Ereignisse und Events ohne Zahlung sind ein No-Op (200).
 */
export async function processStripeEvent(
  event: {
    type: string;
    data: { object: Record<string, unknown> };
  },
  deps: StripeWebhookDeps = {},
): Promise<void> {
  const { retrieveSubscription } = deps;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Record<string, unknown>;
    // Nur Subscription-Checkouts aus unserer App: mode subscription + bezahlt.
    if (session.mode && session.mode !== "subscription") return;
    const paymentStatus = session.payment_status;
    if (
      paymentStatus &&
      paymentStatus !== "paid" &&
      paymentStatus !== "no_payment_required"
    ) {
      // Async-Zahlung (z. B. SEPA) noch nicht bestätigt → invoice.paid aktiviert später.
      return;
    }
    const clerkUserId =
      (typeof session.client_reference_id === "string"
        ? session.client_reference_id
        : null) ||
      (typeof session.metadata === "object" && session.metadata
        ? String((session.metadata as Record<string, unknown>).userId ?? "")
        : "") ||
      null;
    const subscriptionId = subscriptionIdOf(session.subscription);
    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : (session.customer as { id?: string } | null)?.id ?? null;
    if (!clerkUserId || !subscriptionId) return; // nicht abbildbar → ignorieren
    if (!retrieveSubscription) {
      throw new Error("checkout.session.completed requires retrieveSubscription");
    }
    const sub = await retrieveSubscription(subscriptionId);
    if (!sub) throw new Error(`Subscription ${subscriptionId} not retrievable`);
    const lookupKey =
      sub.items?.data?.[0]?.price?.lookup_key ?? null;
    const tier =
      planTierForLookupKey(lookupKey) ??
      (await existingTierBySubscription(subscriptionId)) ??
      "free";
    await qUpsertSubscription({
      clerkUserId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      planTier: tier,
      status: "active",
      // Item-Pfad zuerst (API-Version 2026-08-26.dahlia führt current_period_end
      // am Subscription-ITEM), Top-Level-Fallback für ältere API-Versionen.
      currentPeriodEnd: periodEndOfSubscription(sub),
    });
    return;
  }

  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Record<string, unknown>;
    // Bug 2 (Bestandsaufnahme 2026-09-27): `invoice.subscription` existiert mit
    // API-Version 2026-08-26.dahlia nicht mehr — der Zweig war ein stiller
    // No-Op (kein DB-Zugriff, Antwort 200). Verknüpfung jetzt über
    // `parent.subscription_details.subscription`, alter Pfad als Fallback.
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (!subscriptionId) return;
    const existing = await qGetSubscriptionByStripeId(subscriptionId);
    if (!existing || !existing.clerkUserId) {
      // Reihenfolge: Session-Event noch nicht verarbeitet → 500, Stripe retried.
      throw new Error(`invoice.paid for unknown subscription ${subscriptionId}`);
    }
    const lookupKey = invoicePriceLookupKey(invoice);
    await qUpsertSubscription({
      clerkUserId: existing.clerkUserId,
      stripeCustomerId:
        (typeof invoice.customer === "string" ? invoice.customer : null) ??
        existing.stripeCustomerId,
      stripeSubscriptionId: subscriptionId,
      planTier: planTierForLookupKey(lookupKey) ?? existing.planTier,
      status: "active",
      // Posten-Periodenende (dahlia: lines[].period.end = echte Subscription-
      // Periode) zuerst, invoice.period_end als Fallback für ältere Formen.
      currentPeriodEnd: invoicePeriodEnd(invoice),
    });
    return;
  }

  if (event.type === "customer.subscription.updated") {
    const sub = event.data.object as Record<string, unknown>;
    const subscriptionId = typeof sub.id === "string" ? sub.id : null;
    if (!subscriptionId) return;
    const existing = await qGetSubscriptionByStripeId(subscriptionId);
    if (!existing || !existing.clerkUserId) {
      throw new Error(`subscription.updated for unknown subscription ${subscriptionId}`);
    }
    const lookupKey = (sub.items as { data?: { price?: { lookup_key?: string | null } | null }[] } | undefined)
      ?.data?.[0]?.price?.lookup_key ?? null;
    // P2 (2026-10-07): Kündigungszustand mitführen. Das Event ist die
    // Autorität für cancel_at_period_end/cancel_at — es wird auch dann
    // gespeichert, wenn der Stripe-Status 'active' bleibt (Kündigung zum
    // Periodenende!). Der Pro-Zugriff ändert sich dadurch NICHT (mapSubscription
    // Status bleibt unverändert = active bis zum echten Periodenende).
    const cancelState = subscriptionCancelState(sub);
    await qUpsertSubscription({
      clerkUserId: existing.clerkUserId,
      stripeCustomerId:
        (typeof sub.customer === "string" ? sub.customer : null) ??
        existing.stripeCustomerId,
      stripeSubscriptionId: subscriptionId,
      planTier: planTierForLookupKey(lookupKey) ?? existing.planTier,
      status: mapSubscriptionStatus(sub.status as string | null | undefined),
      // Item-Pfad zuerst (dahlia: current_period_end am Subscription-ITEM),
      // Top-Level-Fallback für ältere API-Versionen (dokumentierter 8.3d-Befund).
      currentPeriodEnd: periodEndOfSubscription(
        sub as unknown as Parameters<typeof periodEndOfSubscription>[0],
      ),
      cancelState,
    });
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Record<string, unknown>;
    const subscriptionId = typeof sub.id === "string" ? sub.id : null;
    if (!subscriptionId) return;
    const existing = await qGetSubscriptionByStripeId(subscriptionId);
    if (!existing || !existing.clerkUserId) {
      throw new Error(`subscription.deleted for unknown subscription ${subscriptionId}`);
    }
    await qUpsertSubscription({
      clerkUserId: existing.clerkUserId,
      stripeCustomerId: existing.stripeCustomerId,
      stripeSubscriptionId: subscriptionId,
      planTier: existing.planTier, // gelöscht = Zugriff beendet, Tarif bleibt dokumentiert
      status: "expired",
      currentPeriodEnd: null,
      // P2: das Abo ist beendet → keine terminierte Kündigung mehr anzeigen
      // (verhindert ein dauerhaftes „Gekündigt – läuft bis …" nach Ablauf).
      cancelState: { cancelAtPeriodEnd: false, cancelAt: null },
    });
    return;
  }

  // ── P2: Refund-bezogene Events — bewusst OHNE DB-Wirkung ────────────────────
  // `charge.refunded` / `invoice.updated` / `credit_note.created` ändern den
  // Refund-Status NICHT in der DB: Er wird beim Rechnungs-Read live aus Stripe
  // gelesen (`invoice.amount_refunded` → InvoiceSummary.amountRefunded/
  // refunded). Diese Zweige existieren nur, um die Entscheidung im Code
  // sichtbar zu machen — Verhalten identisch zum bisherigen 200-No-Op, damit
  // Stripe die Zustellung nicht als Fehler wiederholt.
  if (
    event.type === "charge.refunded" ||
    event.type === "invoice.updated" ||
    event.type === "credit_note.created" ||
    event.type === "charge.refund.updated"
  ) {
    return;
  }

  // Unbekanntes/irrelevantes Ereignis → 200-ignorieren (Stripe-Semantik).
}

/** Fallback-Tier, wenn das Event den Preis nicht enthält (fail-closed: vorhandene Zeile). */
async function existingTierBySubscription(
  subscriptionId: string,
): Promise<"free" | "pro" | null> {
  const existing = await qGetSubscriptionByStripeId(subscriptionId);
  return existing ? existing.planTier : null;
}

/** Produktions-Retrieve: echte Subscription inkl. Preis (per expand). */
async function retrieveSubscriptionForEvent(
  subscriptionId: string,
): Promise<{
  current_period_end?: number | null;
  items?: {
    data?: Array<
      | {
          current_period_end?: number | null;
          price?: { lookup_key?: string | null } | null;
        }
      | null
      | undefined
    >;
  };
}> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY to enable payments.");
  }
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(secretKey);
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  });
  // Die Stripe-v22-Typen führen `current_period_end` nicht auf der
  // Subscription-Response (obwohl die API es liefert — siehe Fixture in
  // stripe-webhook-test.ts). API-Version 2026-08-26.dahlia führt den Wert am
  // Subscription-ITEM (`items.data[].current_period_end`) — beides explizit
  // am SDK-Ergebnis ergänzen statt den übrigen Typ zu schwächen.
  const raw = sub as typeof sub & {
    current_period_end?: number | null;
    items?: {
      data?: Array<
        | {
            current_period_end?: number | null;
            price?: { lookup_key?: string | null } | null;
          }
        | null
        | undefined
      >;
    };
  };
  return {
    current_period_end: raw.current_period_end ?? null,
    items: raw.items,
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * POST-Endpoint /api/stripe-webhook. Nur hier wird die Signatur geprüft
 * (roher Body — KEIN JSON-Parsing vorher!). Antwort-Codes:
 *   200  Signatur ok + Event (erfolgreich oder bewusst) verarbeitet/ignoriert
 *   400  Signatur ungültig / Header fehlt / falsche Methode
 *   500  Webhook nicht konfiguriert (fail-closed) oder Verarbeitung fehlgeschlagen
 *        → Stripe liefert das Event automatisch erneut (Retry-Semantik).
 */
export async function handleStripeWebhookApi(
  req: Request,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== STRIPE_WEBHOOK_PATH) return null;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Fail-closed: kein stiller Erfolg. Saubere Meldung statt Crash — Stripe retried.
    console.error(
      "[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set — webhook disabled (fail-closed).",
    );
    return json({ error: "Webhook not configured" }, 500);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return json({ error: "Missing stripe-signature header" }, 400);

  // Roher Body — Signatur wird über den UNVERÄNDERTEN Body geprüft.
  const rawBody = await req.text();
  if (!rawBody) return json({ error: "Empty request body" }, 400);

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    const { default: Stripe } = await import("stripe");
    // constructEventAsync statt constructEvent: das subtile Standard-Crypto-
    // Provider ist ausschließlich async (Bun-Laufzeit wirft sonst
    // „SubtleCryptoProvider cannot be used in a synchronous context").
    const constructed = (await Stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      secret,
    )) as unknown as { type: string; data: { object: Record<string, unknown> } };
    if (!constructed || typeof constructed.type !== "string") {
      return json({ error: "Invalid event payload" }, 400);
    }
    event = constructed;
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed:", err);
    return json({ error: "Invalid signature" }, 400);
  }

  try {
    await processStripeEvent(event, {
      retrieveSubscription: retrieveSubscriptionForEvent,
    });
    return json({ received: true }, 200);
  } catch (err) {
    // DB-/Netzfehler → 500 → Stripe retried das Event (idempotente Upserts).
    console.error(`[stripe-webhook] processing ${event.type} failed — will retry:`, err);
    return json({ error: "Failed to process event" }, 500);
  }
}