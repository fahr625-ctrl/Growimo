import { createServerFn } from '@tanstack/react-start';

/**
 * Creates a Stripe Customer Portal session for managing billing.
 *
 * The Stripe-Customer-ID wird SERVERSETTIG anhand der (Session-verifizierten)
 * userId aufgelöst (subscriptions-Tabelle) — die ID kommt nie vertrauenswürdig
 * vom Client. Fail-closed: ohne STRIPE_SECRET_KEY oder ohne verknüpften
 * Kunden wird eine saubere Fehlermeldung geworfen (nie ein Fallback-Portal).
 */
export const createPortalSession = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const d = data as { userId?: string; customerId?: string };
    if ((!d.userId || typeof d.userId !== 'string') && (!d.customerId || typeof d.customerId !== 'string')) {
      throw new Error('userId (or customerId) is required');
    }
    return {
      userId: d.userId,
      customerId: d.customerId,
      returnUrl: `${getOrigin()}/app/billing`,
    };
  })
  .handler(async ({ data }) => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        'Stripe is not configured. Set STRIPE_SECRET_KEY to enable the billing portal.',
      );
    }

    let customerId = data.customerId;
    if (!customerId && data.userId) {
      // Bevorzugt: serverseitig aufgelöste Identität + DB-Lookup (fail-closed).
      const { resolveUserIdFromServerFn } = await import('../lib/usage-guard');
      const { qGetCustomerIdForUser } = await import('../db/queries');
      const userId = (await resolveUserIdFromServerFn(data.userId)) ?? data.userId;
      if (userId && userId !== 'anonymous') {
        customerId = (await qGetCustomerIdForUser(userId)) ?? undefined;
      }
    }
    if (!customerId) {
      throw new Error('No Stripe customer is linked to this account.');
    }

    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(secretKey);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: data.returnUrl,
    });

    return { url: session.url };
  });

function getOrigin(): string {
  if (typeof process !== 'undefined' && process.env?.PUBLIC_SITE_URL) {
    return process.env.PUBLIC_SITE_URL;
  }
  return 'http://localhost:3000';
}