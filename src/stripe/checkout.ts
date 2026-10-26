import { createServerFn } from '@tanstack/react-start';
import { getOrigin } from './origin';
import {
  assertEarlyStartConsent,
  buildConsentRecord,
  earlyStartMode,
} from './checkout-consent';

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
 *
 * ENTWURF 2026-10-24 — WIDERRUFSRECHT (§§ 355, 356 Abs. 4/5, 357a Abs. 1 BGB):
 * Ein Pro-Abo ist eine laufzeitgebundene Dienstleistung. Ohne ausdrückliches
 * Verlangen des vorzeitigen Beginns darf vor Ablauf der 14-tägigen
 * Widerrufsfrist nicht mit der Leistung begonnen werden, und im Widerrufsfall
 * gibt es keinen Wertersatz. Deshalb gilt: Im Modus 'required'
 * (Default, Env WIDERRUF_EARLY_START nicht auf 'off') baut dieser ServerFn
 * OHNE Zustimmung GAR KEINE Session — der Fehler kommt vor jedem Stripe-Call
 * (fail-closed, keine Kosten, kein Redirect). Die Zustimmung wird mit
 * Textversion + Zeitpunkt + Preis persistiert (Nachweis), BEVOR die Session
 * entsteht; scheitert der Nachweis, entsteht keine Session.
 */
export const createCheckoutSession = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const d = data as {
      userId?: string;
      priceLookupKey?: string;
      earlyStartConsent?: unknown;
      consentVersion?: unknown;
    };
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
      // Bewusst ungeprüft durchgereicht: die Bewertung passiert serverseitig in
      // assertEarlyStartConsent (nur echtes `true` zählt, kein truthy-Cast).
      earlyStartConsent: d.earlyStartConsent,
      consentVersion: d.consentVersion,
    };
  })
  .handler(async ({ data }) => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        'Stripe is not configured. Set STRIPE_SECRET_KEY to enable payments.',
      );
    }

    // Identität serverseitig auflösen — NUR aus dem verifizierten Session-Cookie.
    // Owner-Entscheidung 2026-10-26 (Maßnahme (c)): der frühere Payload-Fallback
    // (`?? data.userId`) ist entfernt; ohne gültige Sitzung fail-closed.
    const { resolveUserIdFromServerFn } = await import('../lib/usage-guard');
    const userId = await resolveUserIdFromServerFn();
    if (!userId || userId === 'anonymous') {
      throw new Error(
        'No valid session — please sign in again before starting the checkout.',
      );
    }

    // Widerrufs-Gate (ENTWURF 2026-10-24): VOR jedem Stripe-Call. Wirft
    // WiderrufConsentError (code 'widerruf_consent_required'), wenn im Modus
    // 'required' die Zustimmung fehlt oder die Textversion veraltet ist.
    const consentMode = earlyStartMode();
    const consent = assertEarlyStartConsent(
      { earlyStartConsent: data.earlyStartConsent, consentVersion: data.consentVersion },
      consentMode,
    );

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

    // Beta-Rabatt auflösen (bevorzugt Promotion-Code, sonst Coupon):
    // discounts[].promotion_code erwartet die promo_…-ID, NICHT den Code-String
    // („BETA50" wäre ein API-Fehler). Fehlt die ID → Fallback auf den Coupon
    // (discounts[].coupon akzeptiert die Coupon-ID als String) statt gar keinem
    // Rabatt. Coupon-Weg ist der aktuell funktionierende Live-Weg (die
    // Plattform-Stripe-API kann Promotion-Codes nicht anlegen, Stand 2026-10-06);
    // Promo-Code wird bevorzugt, falls in Zukunft vorhanden.
    // Fail-closed: Discount nur für isBeta, nie werfen.
    const couponId = process.env.STRIPE_BETA_COUPON || 'BETA50';
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

    // Rückkehr-URLs MÜSSEN auf der echten App-Origin enden (Bug 1): die Origin
    // kommt aus PUBLIC_SITE_URL → Origin/Forwarded-Host/Host des Requests →
    // https://www.growimo.app. Nie localhost in Production (src/stripe/origin.ts).
    const origin = await getOrigin();

    // ── Widerrufs-Nachweis (ENTWURF 2026-10-24) ─────────────────────────────
    // BEVOR die Session entsteht: Zustimmung mit Textversion + Zeitpunkt +
    // gewähltem Preis persistieren. Scheitert der Nachweis, wird KEINE Session
    // gebaut (fail-closed: eine Zahlung ohne dokumentierte Zustimmung wäre im
    // Widerrufsfall nicht belegbar). Modus 'off' (Variante i) schreibt nichts.
    let consentId: string | null = null;
    if (consent.required) {
      const { qInsertCheckoutConsent } = await import('../db/queries');
      consentId = await qInsertCheckoutConsent(
        buildConsentRecord({
          clerkUserId: userId,
          priceLookupKey: data.priceLookupKey,
        }),
      );
      if (!consentId) {
        throw new Error(
          'Die Zustimmung zum vorzeitigen Beginn konnte nicht dokumentiert werden — der Checkout wurde abgebrochen. Bitte versuche es erneut.',
        );
      }
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
      success_url: `${origin}/app/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/app/pricing`,
      ...(isBeta
        ? {
            discounts: [
              promoId ? { promotion_code: promoId } : { coupon: couponId },
            ],
          }
        : {}),
      metadata: {
        userId,
        // ENTWURF 2026-10-24: Zustand der Widerrufs-Zustimmung auch im
        // Stripe-Objekt dokumentieren (der Nachweis selbst liegt in der DB,
        // Tabelle checkout_consents).
        widerrufConsent: consent.required ? 'early_start_express' : 'none',
        widerrufConsentVersion: consent.version,
      },
    });

    // Session-ID an den Nachweis hängen (fail-soft: der Nachweis existiert
    // bereits; ein Fehler hier darf einen bezahlten Checkout nicht verhindern).
    if (consentId) {
      try {
        const { qSetCheckoutConsentSession } = await import('../db/queries');
        await qSetCheckoutConsentSession(consentId, session.id);
      } catch (err) {
        console.error('[checkout] Widerrufs-Nachweis ohne Session-ID:', err);
      }
    }

    return {
      url: session.url,
      isBeta,
      consentRecorded: Boolean(consentId),
      consentVersion: consent.version,
    };
  });
