import { createServerFn } from '@tanstack/react-start';

/**
 * Creates a Stripe Customer Portal session for managing billing.
 *
 * Returns the portal URL to redirect the user to.
 * When STRIPE_SECRET_KEY is not configured, throws a helpful error.
 */
export const createPortalSession = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const d = data as { customerId?: string; returnUrl?: string };
    if (!d.customerId || typeof d.customerId !== 'string') {
      throw new Error('customerId is required');
    }
    return {
      customerId: d.customerId,
      returnUrl: d.returnUrl ?? `${getOrigin()}/app/billing`,
    };
  })
  .handler(async ({ data }) => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        'Stripe is not configured. Set STRIPE_SECRET_KEY to enable the billing portal.',
      );
    }

    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(secretKey);

    const session = await stripe.billingPortal.sessions.create({
      customer: data.customerId,
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
