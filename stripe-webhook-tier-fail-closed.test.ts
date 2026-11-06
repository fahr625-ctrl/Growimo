// ─────────────────────────────────────────────────────────────────────────────
// B2-TESTS: Webhook propagiert „Preis nicht zuordenbar" statt still 'free'
// ─────────────────────────────────────────────────────────────────────────────
// Owner-Auftrag 2026-11-05, §17.2.3/§17.2.4 S2. Beweist Punkt 3 des Auftrags:
// ALLE DREI Webhook-Aufrufstellen (checkout.session.completed, invoice.paid,
// customer.subscription.updated) werfen bei unbekanntem lookup_key bzw. nicht
// bestimmbarem Tarif — und schreiben in diesem Fall NICHTS.
//
//   bun test stripe-webhook-tier-fail-closed.test.ts
//
// KEINE DB, KEIN NETZ, KEINE SECRETS: `src/db/queries` ist per Bun-mock.module
// durch einen In-Memory-Fake ersetzt (die einzige Stelle, über die der Webhook
// die DB erreicht — `src/api/stripe-webhook.ts` Z. 32–38). Damit läuft der Test
// ohne Prod-DB-Schreibzugriff (Auftrags-Randbedingung „nur SELECT") und ohne die
// Neon-HTTP-Abhängigkeit, die eine lokale Postgres nicht bedienen kann.
// ─────────────────────────────────────────────────────────────────────────────
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";

// ── In-Memory-Ersatz für src/db/queries.ts ──────────────────────────────────
type Row = {
  clerkUserId: string;
  planTier: string;
  status?: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: Date | null;
};

const dbState = {
  rows: new Map<string, Row>(),
  upserts: [] as Array<Record<string, unknown>>,
  clerkIdByCustomer: new Map<string, string>(),
};

mock.module("./src/db/queries", () => ({
  qGetClerkIdByStripeCustomer: async (customerId: string) =>
    dbState.clerkIdByCustomer.get(customerId) ?? null,
  qGetSubscriptionByStripeId: async (id: string) => dbState.rows.get(id) ?? null,
  qUpsertSubscription: async (input: Record<string, unknown>) => {
    dbState.upserts.push(input);
    const subId = String(input.stripeSubscriptionId);
    dbState.rows.set(subId, {
      clerkUserId: String(input.clerkUserId),
      planTier: String(input.planTier),
      status: input.status as string | undefined,
      stripeCustomerId: (input.stripeCustomerId as string | null) ?? null,
      stripeSubscriptionId: subId,
      currentPeriodEnd: (input.currentPeriodEnd as Date | null) ?? null,
    });
  },
  qGetOrFreezeBetaEntitlement: async () => ({ entitled: false }),
  qSetSubscriptionDiscountCoupon: async () => {},
}));

// Import NACH dem Mock (sonst lädt das echte Modul).
const {
  processStripeEvent,
  handleStripeWebhookApi,
  UnknownPriceLookupKeyError,
  UnresolvablePlanTierError,
  STRIPE_WEBHOOK_PATH,
} = await import("./src/api/stripe-webhook");

const CUST = "cus_b2_failclosed";
const SUB = "sub_b2_failclosed";
const PERIOD_END = 1_894_051_200;

const retrieveWith = (lookupKey: string | null) => async () => ({
  current_period_end: PERIOD_END,
  items: { data: [{ price: { lookup_key: lookupKey } }] },
});

/**
 * HERMETISCHE Dependencies: der checkout-Zweig ruft bei fehlendem Rechnungsland
 * den DE-Gate (`cancelSubscription` + ggf. `refundPaymentIntent`) und bei
 * vorhandener Kunden-E-Mail `setInvoiceEmail` — beides sind ECHTE
 * Stripe-Schreibzugriffe, wenn man sie nicht ersetzt. Ein Test darf niemals
 * Stripe erreichen, deshalb sind alle drei hier Fake.
 */
const deGateCalls: string[] = [];
const hermeticDeps = (lookupKey: string | null) => ({
  retrieveSubscription: retrieveWith(lookupKey),
  deGate: {
    cancelSubscription: async (id: string) => {
      deGateCalls.push(`cancel:${id}`);
    },
    refundPaymentIntent: async (id: string) => {
      deGateCalls.push(`refund:${id}`);
    },
  },
  setInvoiceEmail: async () => {},
  reconcileBetaDiscount: async () => "noop",
});

const checkoutEvent = () => ({
  id: "evt_b2_checkout",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_b2",
      mode: "subscription",
      payment_status: "paid",
      client_reference_id: "wh-b2-user",
      metadata: { userId: "wh-b2-user" },
      customer: CUST,
      subscription: SUB,
      // DE-Rechnungsadresse: sonst greift das DE-Gate (fail-closed) und der
      // Test prüft den falschen Zweig.
      customer_details: {
        email: "b2-failclosed@example.test",
        address: { country: "DE" },
      },
    },
  },
});

const invoicePaidEvent = (lookupKey: string | null, sub = SUB) => ({
  id: "evt_b2_invoice",
  type: "invoice.paid",
  data: {
    object: {
      id: "in_b2",
      customer: CUST,
      parent: { subscription_details: { subscription: sub } },
      period_end: PERIOD_END,
      lines: {
        data: lookupKey === null
          ? [{ period: { end: PERIOD_END } }]
          : [{ period: { end: PERIOD_END }, price: { lookup_key: lookupKey } }],
      },
    },
  },
});

const subscriptionUpdatedEvent = (lookupKey: string | null, sub = SUB) => ({
  id: "evt_b2_updated",
  type: "customer.subscription.updated",
  data: {
    object: {
      id: sub,
      customer: CUST,
      status: "active",
      items: {
        data: lookupKey === null
          ? [{ current_period_end: PERIOD_END }]
          : [{ current_period_end: PERIOD_END, price: { lookup_key: lookupKey } }],
      },
    },
  },
});

const seedRow = (sub = SUB, planTier = "pro") => {
  dbState.rows.set(sub, {
    clerkUserId: "wh-b2-user",
    planTier,
    status: "active",
    stripeCustomerId: CUST,
    stripeSubscriptionId: sub,
    currentPeriodEnd: new Date(PERIOD_END * 1000),
  });
};

/** Fängt den Fehler und liefert ihn (null = kein Fehler geworfen). */
async function catchError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}

beforeEach(() => {
  dbState.rows.clear();
  dbState.upserts.length = 0;
  dbState.clerkIdByCustomer.clear();
  deGateCalls.length = 0;
});

// ── Aufrufstelle 1: checkout.session.completed ───────────────────────────────
describe("Aufrufstelle 1 — checkout.session.completed", () => {
  test("unbekannter lookup_key → UnknownPriceLookupKeyError, KEIN DB-Write", async () => {
    const err = await catchError(() =>
      processStripeEvent(checkoutEvent(), hermeticDeps("pro_monthly_typo")),
    );
    expect(err).toBeInstanceOf(UnknownPriceLookupKeyError);
    expect((err as Error).message).toContain("pro_monthly_typo");
    expect(dbState.upserts).toHaveLength(0);
  });

  test("unbekannter lookup_key schreibt auch keine 'free'-Zeile", async () => {
    await catchError(() =>
      processStripeEvent(checkoutEvent(), hermeticDeps("video_yearly")),
    );
    expect(dbState.rows.size).toBe(0);
    expect(dbState.upserts.filter((u) => u.planTier === "free")).toHaveLength(0);
  });

  test("kein lookup_key + kein DB-Tarif → UnresolvablePlanTierError, KEIN DB-Write", async () => {
    const err = await catchError(() =>
      processStripeEvent(checkoutEvent(), hermeticDeps(null)),
    );
    expect(err).toBeInstanceOf(UnresolvablePlanTierError);
    expect((err as Error).message).toContain(SUB);
    expect(dbState.upserts).toHaveLength(0);
  });

  test("kein lookup_key + vorhandener DB-Tarif → bestehender Tarif, NICHT free", async () => {
    seedRow(SUB, "pro");
    await processStripeEvent(checkoutEvent(), hermeticDeps(null));
    expect(dbState.upserts).toHaveLength(1);
    expect(dbState.upserts[0].planTier).toBe("pro");
  });

  test("bekannter lookup_key pro_yearly → pro (Gegenkontrolle)", async () => {
    await processStripeEvent(checkoutEvent(), hermeticDeps("pro_yearly"));
    expect(dbState.upserts).toHaveLength(1);
    expect(dbState.upserts[0].planTier).toBe("pro");
    expect(dbState.upserts[0].status).toBe("active");
    // DE-Rechnungsadresse ⇒ das Gate darf NICHT eingreifen (kein Cancel/Refund).
    expect(deGateCalls).toHaveLength(0);
  });

  test("ohne Rechnungsland greift das DE-Gate (Fixture-Kontrolle, hermetisch)", async () => {
    // Beweist, warum `checkoutEvent()` ein DE-Land trägt: fehlt es, ist der
    // Zweig fail-closed und canceln würde — mit Fake-Deps, nie gegen Stripe.
    const event = checkoutEvent();
    delete (event.data.object as { customer_details?: unknown }).customer_details;
    await processStripeEvent(event, hermeticDeps("pro_monthly"));
    expect(deGateCalls).toEqual([`cancel:${SUB}`]);
    expect(dbState.upserts[0].status).toBe("expired");
  });
});

// ── Aufrufstelle 2: invoice.paid ─────────────────────────────────────────────
describe("Aufrufstelle 2 — invoice.paid", () => {
  test("unbekannter lookup_key → UnknownPriceLookupKeyError, KEIN DB-Write", async () => {
    seedRow();
    const err = await catchError(() => processStripeEvent(invoicePaidEvent("pro_monthl")));
    expect(err).toBeInstanceOf(UnknownPriceLookupKeyError);
    expect((err as Error).message).toContain("pro_monthl");
    expect(dbState.upserts).toHaveLength(0);
  });

  test("kein lookup_key (dahlia-Payload) + DB-Tarif → Verlängerung ohne Wurf", async () => {
    seedRow(SUB, "pro");
    await processStripeEvent(invoicePaidEvent(null));
    expect(dbState.upserts).toHaveLength(1);
    expect(dbState.upserts[0].planTier).toBe("pro");
  });

  test("kein lookup_key + DB-Tarif unbrauchbar → UnresolvablePlanTierError", async () => {
    seedRow(SUB, "premium"); // Wert, den der Code nicht kennt
    const err = await catchError(() => processStripeEvent(invoicePaidEvent(null)));
    expect(err).toBeInstanceOf(UnresolvablePlanTierError);
    expect(dbState.upserts).toHaveLength(0);
  });

  test("unbekannte Subscription → Wurf (Retry-Semantik)", async () => {
    const err = await catchError(() => processStripeEvent(invoicePaidEvent("pro_monthly", "sub_ghost")));
    expect(err).toBeInstanceOf(Error);
    expect(dbState.upserts).toHaveLength(0);
  });
});

// ── Aufrufstelle 3: customer.subscription.updated ────────────────────────────
describe("Aufrufstelle 3 — customer.subscription.updated", () => {
  test("unbekannter lookup_key → UnknownPriceLookupKeyError, KEIN DB-Write", async () => {
    seedRow();
    const err = await catchError(() => processStripeEvent(subscriptionUpdatedEvent("pro_monthly_x")));
    expect(err).toBeInstanceOf(UnknownPriceLookupKeyError);
    expect((err as Error).message).toContain("pro_monthly_x");
    expect(dbState.upserts).toHaveLength(0);
  });

  test("kein lookup_key + DB-Tarif → Update ohne Wurf (kein free)", async () => {
    seedRow(SUB, "video");
    await processStripeEvent(subscriptionUpdatedEvent(null), {
      reconcileBetaDiscount: async () => "noop",
    });
    expect(dbState.upserts).toHaveLength(1);
    expect(dbState.upserts[0].planTier).toBe("video");
  });

  test("unbekannter lookup_key → Reparatur des Beta-Rabatts läuft NICHT (kein Schreib-Nebenweg)", async () => {
    seedRow();
    let reconcileCalls = 0;
    await catchError(() =>
      processStripeEvent(subscriptionUpdatedEvent("tippfehler"), {
        reconcileBetaDiscount: async () => {
          reconcileCalls += 1;
          return "noop";
        },
      }),
    );
    expect(reconcileCalls).toBe(0);
    expect(dbState.upserts).toHaveLength(0);
  });
});

// ── HTTP-Ebene: der Endpoint antwortet mit 500 statt 200 ─────────────────────
describe("HTTP-Endpoint /api/stripe-webhook — Fehler wird zum 500", () => {
  const SECRET = "whsec_b2_failclosed_test";
  const sign = (payload: string) => {
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", SECRET).update(`${t}.${payload}`).digest("hex");
    return `t=${t},v1=${v1}`;
  };
  const post = (body: string) =>
    new Request(`https://growimo.test${STRIPE_WEBHOOK_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": sign(body) },
      body,
    });

  const withSecret = async (fn: () => Promise<void>) => {
    const prev = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = prev;
    }
  };

  test("unbekannter Preis in invoice.paid → 500 {Failed to process event}, kein Write", async () => {
    await withSecret(async () => {
      seedRow();
      const body = JSON.stringify(invoicePaidEvent("pro_monthly_typo"));
      const res = await handleStripeWebhookApi(post(body), STRIPE_WEBHOOK_PATH);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(500);
      expect(await res!.json()).toEqual({ error: "Failed to process event" });
      expect(dbState.upserts).toHaveLength(0);
    });
  });

  test("unbekannte Subscription → 500 (Fehler erreicht den Handler)", async () => {
    await withSecret(async () => {
      const body = JSON.stringify(invoicePaidEvent("pro_monthly", "sub_ghost"));
      const res = await handleStripeWebhookApi(post(body), STRIPE_WEBHOOK_PATH);
      expect(res!.status).toBe(500);
    });
  });

  test("Gegenkontrolle: gültiges Event → 200 {received:true} und genau ein Write", async () => {
    await withSecret(async () => {
      seedRow();
      const body = JSON.stringify(invoicePaidEvent("pro_monthly"));
      const res = await handleStripeWebhookApi(post(body), STRIPE_WEBHOOK_PATH);
      expect(res!.status).toBe(200);
      expect(await res!.json()).toEqual({ received: true });
      expect(dbState.upserts).toHaveLength(1);
      expect(dbState.upserts[0].planTier).toBe("pro");
    });
  });
});

// ── Invariante über ALLE Tests ───────────────────────────────────────────────
describe("Invariante", () => {
  test("kein Zahlungs-Event schreibt jemals planTier 'free'", async () => {
    seedRow();
    await catchError(() => processStripeEvent(invoicePaidEvent("unbekannt_1")));
    await catchError(() =>
      processStripeEvent(checkoutEvent(), hermeticDeps("unbekannt_2")),
    );
    await catchError(() => processStripeEvent(subscriptionUpdatedEvent("unbekannt_3")));
    expect(dbState.upserts.filter((u) => u.planTier === "free")).toHaveLength(0);
  });
});
