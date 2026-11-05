// ─────────────────────────────────────────────────────────────────────────────
// BETA-RABATT: BERECHTIGUNG AM MENSCHEN, ANWENDUNG AM PREIS
// (Owner-Auftrag 2026-11-05, §17.4 — die Rückkehr-Regel Pro → Video → Pro)
// ─────────────────────────────────────────────────────────────────────────────
// Das Problem (Ist-Zustand, am Code belegt §17.4.1):
//   · `checkout.ts` setzt den Coupon, sobald die E-MAIL in `beta_signups`
//     steht — ohne zu prüfen, WELCHER Preis gekauft wird.
//   · `BETA50` hat KEINE Produktbindung (`applies_to` fehlt, live geprüft).
//   · Stripe rechnet beim Preiswechsel mit dem bestehenden Rabatt.
//   ⇒ Ein Beta-Nutzer auf Pro (9,50 €) wechselt auf Video (29 €) und zahlt
//     14,50 € — 50 % auf einen Tarif, den die Zusage nie gedeckt hat.
//
// Die Lösung ist eine Trennung, kein Zustand:
//   BERECHTIGUNG  „dieser Mensch ist Beta-Nutzer"  → beta_entitlements (Nutzer)
//   ANWENDUNG     „auf DIESEN Preis gilt 50 %"     → Stripe-Abo (Preis)
// Weil die Berechtigung am Nutzer hängt und nie verfällt, stellt sich die
// Rückkehr-Regel von selbst wieder her: Pro → Video nimmt den Rabatt weg,
// Video → Pro gibt ihn zurück. Es gibt KEIN Feld „hatte mal Rabatt".
//
// Diese Datei ist absichtlich DB- und Stripe-frei (nur Typen + reine Logik mit
// injizierten Abhängigkeiten) — deshalb ist jeder der vier Wechselpfade ohne
// Live-Stripe testbar.
// ─────────────────────────────────────────────────────────────────────────────

/** Coupon, der den Anspruch auf Pro erfüllt (Produktbindung auf Pro). */
export const BETA_PRO_COUPON_DEFAULT = "BETA50PRO";
/**
 * Alt-Coupon (live, 50 % forever, OHNE Produktbindung). Bleibt für immer in
 * `KNOWN_BETA_COUPONS`: ein Alt-Abo kann ihn tragen, und die Reparatur muss ihn
 * ENTFERNEN können, sobald der Preis kein Pro mehr ist. Stünde er nicht in der
 * Liste, gälte er als „fremd" und bliebe stehen — die Lücke bliebe offen.
 */
export const BETA_LEGACY_COUPON_DEFAULT = "BETA50";

/** Coupons, die diese Automatik verantwortet (alles andere ist fremd). */
export const KNOWN_BETA_COUPONS: ReadonlySet<string> = new Set([
  BETA_PRO_COUPON_DEFAULT,
  BETA_LEGACY_COUPON_DEFAULT,
]);

/** Konfigurierbar per Env (kein Secret) — wie bisher `STRIPE_BETA_COUPON`. */
export function betaProCouponId(): string {
  return process.env.STRIPE_BETA_COUPON_PRO || BETA_PRO_COUPON_DEFAULT;
}
export function betaLegacyCouponId(): string {
  return process.env.STRIPE_BETA_COUPON || BETA_LEGACY_COUPON_DEFAULT;
}

/** Ist dieser Coupon einer, den die Automatik verwalten darf? */
export function isKnownBetaCoupon(couponId: string | null | undefined): boolean {
  if (!couponId) return false;
  return KNOWN_BETA_COUPONS.has(couponId) || couponId === betaProCouponId() || couponId === betaLegacyCouponId();
}

/**
 * Zielzustand: GENAU EIN Coupon oder gar keiner. Niemals „hinzufügen".
 * Reine Funktion — die eigentliche Regel in einer Zeile.
 */
export function targetBetaCoupon(opts: {
  isProPrice: boolean;
  entitled: boolean;
}): string | null {
  return opts.isProPrice && opts.entitled ? betaProCouponId() : null;
}

/** Rabatt-Liste, die ein Checkout setzen muss (W1 — unsere Oberfläche). */
export function discountsForCheckout(opts: {
  isProPrice: boolean;
  entitled: boolean;
}): Array<{ coupon: string }> {
  const coupon = targetBetaCoupon(opts);
  return coupon ? [{ coupon }] : [];
}

// ── Stripe-Objekte lesen (defensiv: API-Versionen unterscheiden sich) ────────

export interface DiscountLike {
  coupon?: { id?: string | null } | string | null;
  promotion_code?: { id?: string | null; coupon?: { id?: string | null } | string | null } | string | null;
  source?: { coupon?: { id?: string | null } | string | null } | null;
}

export interface SubscriptionLike {
  id: string;
  items?: {
    data?: Array<{
      price?: { lookup_key?: string | null; id?: string | null } | null;
    } | null> | null;
  } | null;
  discounts?: { data?: Array<DiscountLike | null> | null } | DiscountLike[] | null;
  /** Ältere API-Form: genau ein Rabatt am Abo. */
  discount?: DiscountLike | null;
}

function idOf(value: { id?: string | null } | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value || null;
  return typeof value.id === "string" && value.id ? value.id : null;
}

/** Alle Coupon-IDs, die tatsächlich am Abo hängen (in Reihenfolge, ohne Duplikate). */
export function couponIdsOf(sub: SubscriptionLike): string[] {
  const raw: Array<DiscountLike | null> = [];
  const d = sub.discounts;
  if (Array.isArray(d)) raw.push(...d);
  else if (d && Array.isArray(d.data)) raw.push(...d.data);
  if (sub.discount) raw.push(sub.discount);

  const out: string[] = [];
  for (const entry of raw) {
    if (!entry) continue;
    const coupon =
      idOf(entry.coupon) ??
      idOf(entry.promotion_code && typeof entry.promotion_code === "object" ? entry.promotion_code.coupon : null) ??
      idOf(entry.source?.coupon ?? null);
    if (coupon && !out.includes(coupon)) out.push(coupon);
  }
  return out;
}

/** lookup_keys aller Abo-Positionen. */
export function priceLookupKeysOf(sub: SubscriptionLike): string[] {
  const items = sub.items?.data ?? [];
  const out: string[] = [];
  for (const item of items) {
    const key = item?.price?.lookup_key;
    if (typeof key === "string" && key) out.push(key);
  }
  return out;
}

/**
 * Trägt das Abo AUSSCHLIESSLICH Pro-Preise? (§17.4.6 F8: „alle Positionen sind
 * Pro" — bei einem künftigen Aufpreis-Paket ist diese Annahme bewusst die
 * konservative Seite: gemischte Positionen bekommen keinen Rabatt.)
 */
export function priceIsPro(sub: SubscriptionLike, isProKey: (key: string) => boolean): boolean {
  const keys = priceLookupKeysOf(sub);
  return keys.length > 0 && keys.every((k) => isProKey(k));
}

// ── Die Reparatur-Funktion (§17.4.4) ────────────────────────────────────────

export type ReconcileOutcome = "noop" | "repaired" | "foreign" | "missing";

export interface ReconcileDeps {
  /** Abo frisch aus Stripe lesen (die Wahrheit, nicht die DB-Kopie). */
  retrieveSubscription: (subscriptionId: string) => Promise<SubscriptionLike | null>;
  /** Rabattliste ERSETZEN (`discounts: ids`) — nie ergänzen. */
  setSubscriptionDiscounts: (subscriptionId: string, couponIds: string[]) => Promise<void>;
  /** Preis-Schlüssel → ist Pro? (injizierbar, damit der Test keine Stripe-Preise braucht) */
  isProLookupKey: (key: string) => boolean;
  /**
   * Diagnose-Spiegel: der Zustand, der NACH der Reparatur gilt (nur bei
   * `noop`/`repaired`, nie bei `foreign` — dort wurde nichts angefasst).
   * Optional, damit Tests ohne DB laufen.
   */
  persist?: (couponIds: string[]) => Promise<void>;
  log?: (event: string, detail: Record<string, unknown>) => void;
}

/** Zähler gegen Reparaturschleifen (§17.4.6 F10) — pro Prozess. */
const repairCounts = new Map<string, number>();

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/**
 * Bringt den Rabatt eines Abos auf den Zielzustand.
 *
 * Sechs Eigenschaften, jede mit Absicht:
 *  · ERSETZEN, nie ergänzen      → zwei Rabatte wären 75 % statt 50 %
 *  · `noop` bei Gleichheit       → sonst triggert die Reparatur sich selbst
 *                                  (sie löst `customer.subscription.updated` aus)
 *  · fremde Coupons unangetastet → eine Kulanz des Owners darf die Automatik
 *                                  nicht löschen. Befund, kein Fehler: kein Wurf
 *  · `BETA50` bleibt bekannt     → Alt-Abos werden korrekt bereinigt
 *  · Rückgabe ist ein Ergebnis   → der Aufrufer kann loggen, ohne zu raten
 *  · KEIN Zustand über den Aufruf hinaus → die Regel ist ableitbar, nicht
 *                                  gespeichert
 */
export async function reconcileBetaDiscount(opts: {
  subscriptionId: string;
  entitled: boolean;
  deps: ReconcileDeps;
}): Promise<ReconcileOutcome> {
  const { subscriptionId, entitled, deps } = opts;
  const log = deps.log ?? (() => {});
  const sub = await deps.retrieveSubscription(subscriptionId);
  if (!sub) {
    log("beta.reconcile.missing", { subscriptionId });
    return "missing";
  }

  const current = couponIdsOf(sub);
  const foreign = current.filter((id) => !isKnownBetaCoupon(id));
  if (foreign.length > 0) {
    // NICHT anfassen. Der Owner sieht den Befund im Log.
    log("beta.reconcile.foreign_coupon", { subscriptionId, foreign, current });
    return "foreign";
  }

  const isProPrice = priceIsPro(sub, deps.isProLookupKey);
  const target = targetBetaCoupon({ isProPrice, entitled });
  const want = target ? [target] : [];

  if (sameSet(current, want)) {
    await deps.persist?.(want);
    log("beta.reconcile.noop", { subscriptionId, current, isProPrice, entitled });
    return "noop";
  }

  await deps.setSubscriptionDiscounts(subscriptionId, want);
  await deps.persist?.(want);

  const n = (repairCounts.get(subscriptionId) ?? 0) + 1;
  repairCounts.set(subscriptionId, n);
  if (n > 3) {
    // Konvergiert die Reparatur nicht, ist etwas Grundsätzliches falsch.
    log("beta.reconcile.loop_alarm", { subscriptionId, repairs: n });
  } else {
    log("beta.reconcile.repaired", { subscriptionId, from: current, to: want, isProPrice, entitled });
  }
  return "repaired";
}

/** Nur für Tests: Reparaturzähler zurücksetzen. */
export function __resetRepairCounts(): void {
  repairCounts.clear();
}

// ── Coupon auflösen (Übergangssicherheit, §17.3.2 Weg B) ────────────────────

export interface CouponResolverDeps {
  /** `coupons.retrieve(id)` — wirft bei 404 (Stripe-Verhalten). */
  retrieveCoupon: (couponId: string) => Promise<{ id: string; percent_off?: number | null; valid?: boolean } | null>;
  log?: (event: string, detail: Record<string, unknown>) => void;
}

/**
 * Welcher Coupon gilt für einen berechtigten Pro-Kauf?
 *
 * Reihenfolge: `BETA50PRO` (produktgebunden) → `BETA50` (Alt-Coupon, Übergang).
 * Der Fallback ist die Übergangssicherheit aus §17.3.2: solange der neue Coupon
 * nicht existiert, darf ein Beta-Checkout NICHT scheitern. Er wird laut geloggt,
 * damit der Fallback nicht zur Dauerlösung wird.
 *
 * @returns Coupon-ID oder null (kein Coupon vorhanden → Aufrufer entscheidet).
 */
export async function resolveBetaCouponId(deps: CouponResolverDeps): Promise<string | null> {
  const log = deps.log ?? (() => {});
  const pro = betaProCouponId();
  try {
    const coupon = await deps.retrieveCoupon(pro);
    if (coupon && coupon.valid !== false) return pro;
    log("beta.coupon.invalid", { coupon: pro });
  } catch (err) {
    log("beta.coupon.missing", { coupon: pro, error: (err as Error)?.message });
  }
  const legacy = betaLegacyCouponId();
  if (legacy === pro) return null;
  try {
    const coupon = await deps.retrieveCoupon(legacy);
    if (coupon && coupon.valid !== false) {
      log("beta.coupon.legacy_fallback", { coupon: legacy });
      return legacy;
    }
  } catch (err) {
    log("beta.coupon.missing", { coupon: legacy, error: (err as Error)?.message });
  }
  return null;
}
