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
//   customer.subscription.deleted     → Status 'expired'
//   alles andere                      → 200-ignorieren (Stripe-Semantik)
// Fehler (DB/Netz)                    → 500 → Stripe liefert das Event erneut.
import {
  qGetSubscriptionByStripeId,
  qUpsertSubscription,
} from "../db/queries";

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
    current_period_end: number | null;
    items?: { data?: { price?: { lookup_key?: string | null } | null }[] };
  }>;
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
      currentPeriodEnd: sub.current_period_end,
    });
    return;
  }

  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Record<string, unknown>;
    const subscriptionId = subscriptionIdOf(invoice.subscription);
    if (!subscriptionId) return;
    const existing = await qGetSubscriptionByStripeId(subscriptionId);
    if (!existing || !existing.clerkUserId) {
      // Reihenfolge: Session-Event noch nicht verarbeitet → 500, Stripe retried.
      throw new Error(`invoice.paid for unknown subscription ${subscriptionId}`);
    }
    const lookupKey = (invoice.lines as { data?: { price?: { lookup_key?: string | null } | null }[] } | undefined)
      ?.data?.[0]?.price?.lookup_key ?? null;
    await qUpsertSubscription({
      clerkUserId: existing.clerkUserId,
      stripeCustomerId:
        (typeof invoice.customer === "string" ? invoice.customer : null) ??
        existing.stripeCustomerId,
      stripeSubscriptionId: subscriptionId,
      planTier: planTierForLookupKey(lookupKey) ?? existing.planTier,
      status: "active",
      currentPeriodEnd:
        typeof invoice.period_end === "number" ? invoice.period_end : null,
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
    await qUpsertSubscription({
      clerkUserId: existing.clerkUserId,
      stripeCustomerId:
        (typeof sub.customer === "string" ? sub.customer : null) ??
        existing.stripeCustomerId,
      stripeSubscriptionId: subscriptionId,
      planTier: planTierForLookupKey(lookupKey) ?? existing.planTier,
      status: mapSubscriptionStatus(sub.status as string | null | undefined),
      currentPeriodEnd:
        typeof sub.current_period_end === "number" ? sub.current_period_end : null,
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
    });
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
): Promise<{ current_period_end: number | null; items?: { data?: { price?: { lookup_key?: string | null } | null }[] } }> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY to enable payments.");
  }
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(secretKey);
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  });
  // Die Stripe-v22-Typen führen `current_period_end` nicht auf dem
  // Subscription-Response (obwohl die API es als Unix-Timestamp liefert —
  // siehe Fixture in stripe-webhook-test.ts). Das dokumentierte Feld explizit
  // am SDK-Ergebnis ergänzen statt den übrigen Typ zu schwächen.
  const raw = sub as typeof sub & { current_period_end?: number | null };
  return {
    current_period_end: raw.current_period_end ?? null,
    items: raw.items as {
      data?: { price?: { lookup_key?: string | null } | null }[];
    },
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