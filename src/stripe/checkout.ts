import { createServerFn } from '@tanstack/react-start';

/**
 * Creates a Stripe Checkout Session for upgrading to Pro.
 *
 * Valid lookup_keys (Preise kommen AUS Stripe via lookup_key — die Zahlen
 * 19 €/Monat bzw. 190 €/Jahr werden im Dashboard mit diesen Keys angelegt):
 *   - pro_monthly  → 19 €/Monat, 200 Generierungen
 *   - pro_yearly   → 190 €/Jahr  (= 12 × 19, Rabatt als Jahrespreis)
 *
 * Beta-Berechtigte (vor-Public-Launch registrierte Beta-Nutzer, approved=true)
 * erhalten automatisch den lebenslangen 50-%-Rabatt über den Promotion-Code
 * (STRIPE_BETA_PROMO_CODE, Default 'BETA50' — im Stripe-Dashboard anzulegen).
 *
 * Fail-closed: ohne STRIPE_SECRET_KEY wird eine saubere Fehlermeldung geworfen
 * (nie ein erfundener Preis/Redirect). Die Nutzer-Identität wird serverseitig
 * aus der Session verifiziert (Fallback auf die mitgeschickte userId nur ohne
 * __session-Cookie, identisch zum Usage-Guard).
 */
export const createCheckoutSession = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const d = data as { userId?: string; priceLookupKey?: string };
    if (!d.userId || typeof d.userId !== 'string') {
      throw new Error('userId is required');
    }
    const lookupKey = d.priceLookupKey ?? 'pro_monthly';
    if (lookupKey !== 'pro_monthly' && lookupKey !== 'pro_yearly') {
      throw new Error(`Unknown price lookup key: ${lookupKey}`);
    }
    return {
      userId: d.userId,
      priceLookupKey: lookupKey,
    };
  })
  .handler(async ({ data }) => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        'Stripe is not configured. Set STRIPE_SECRET_KEY to enable payments.',
      );
    }

    // Identität serverseitig auflösen (Session-Cookie bevorzugt, Payload-Fallback).
    const { resolveUserIdFromServerFn } = await import('../lib/usage-guard');
    const userId = (await resolveUserIdFromServerFn(data.userId)) ?? data.userId;
    if (!userId || userId === 'anonymous') {
      throw new Error(
        'No valid session — please sign in again before starting the checkout.',
      );
    }

    // Dynamic import so the stripe package is only loaded server-side
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(secretKey);

    // Look up the price by lookup_key
    const prices = await stripe.prices.list({
      lookup_keys: [data.priceLookupKey],
      limit: 1,
    });

    if (prices.data.length === 0) {
      throw new Error(
        `No Stripe price found with lookup_key "${data.priceLookupKey}". ` +
          'Create one in the Stripe Dashboard with that lookup_key (19 €/month or 190 €/year).',
      );
    }

    // Beta-50-%-Rabatt: serverseitig über die echte Nutzer-E-Mail (users-Tabelle →
    // beta_signups approved=true). Nie vom Client behauptet (fail-closed).
    const { isBetaUserEmail } = await import('../api/beta');
    const { qGetUserEmailByClerkId } = await import('../db/queries');
    const email = await qGetUserEmailByClerkId(userId);
    const isBeta = email ? await isBetaUserEmail(email) : false;

    // Promotion-Code-ID auflösen: discounts[].promotion_code erwartet die
    // promo_…-ID, NICHT den Code-String („BETA50" wäre ein API-Fehler).
    // Fehlt die ID (Code nicht angelegt/inaktiv) → kein Discount statt Fehler
    // (fail-closed: Beta-Nutzer zahlt dann den Normalpreis, kein Absturz).
    let promoId: string | undefined;
    if (isBeta) {
      const promoCode = process.env.STRIPE_BETA_PROMO_CODE || 'BETA50';
      const promos = await stripe.promotionCodes.list({
        code: promoCode,
        active: true,
        limit: 1,
      });
      promoId = promos.data[0]?.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: prices.data[0].id,
          quantity: 1,
        },
      ],
      client_reference_id: userId,
      success_url: `${getOrigin()}/app/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getOrigin()}/app/pricing`,
      ...(isBeta && promoId ? { discounts: [{ promotion_code: promoId }] } : {}),
      metadata: {
        userId,
      },
    });

    return { url: session.url, isBeta };
  });

function getOrigin(): string {
  // In production, derive from the request; fallback for local dev
  if (typeof process !== 'undefined' && process.env?.PUBLIC_SITE_URL) {
    return process.env.PUBLIC_SITE_URL;
  }
  return 'http://localhost:3000';
}