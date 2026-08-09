import { createServerFn } from '@tanstack/react-start';

/**
 * Creates a Stripe Checkout Session for upgrading to Pro.
 *
 * Returns the session URL to redirect the user to.
 * When STRIPE_SECRET_KEY is not configured, throws a helpful error.
 */
export const createCheckoutSession = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const d = data as { userId?: string; priceLookupKey?: string; successUrl?: string; cancelUrl?: string };
    if (!d.userId || typeof d.userId !== 'string') {
      throw new Error('userId is required');
    }
    return {
      userId: d.userId,
      priceLookupKey: d.priceLookupKey ?? 'pro_monthly',
      successUrl: d.successUrl ?? `${getOrigin()}/app/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: d.cancelUrl ?? `${getOrigin()}/app/pricing`,
    };
  })
  .handler(async ({ data }) => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        'Stripe is not configured. Set STRIPE_SECRET_KEY to enable payments.',
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
        'Create one in the Stripe Dashboard with that lookup_key.',
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: prices.data[0].id,
          quantity: 1,
        },
      ],
      client_reference_id: data.userId,
      success_url: data.successUrl,
      cancel_url: data.cancelUrl,
      metadata: {
        userId: data.userId,
      },
    });

    return { url: session.url };
  });

function getOrigin(): string {
  // In production, derive from the request; fallback for local dev
  if (typeof process !== 'undefined' && process.env?.PUBLIC_SITE_URL) {
    return process.env.PUBLIC_SITE_URL;
  }
  return 'http://localhost:3000';
}
