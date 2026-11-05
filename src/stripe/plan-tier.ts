// ─────────────────────────────────────────────────────────────────────────────
// TARIF-ZUORDNUNG (Owner-Auftrag 2026-11-05, §17.2.2) — fail-closed
// ─────────────────────────────────────────────────────────────────────────────
// VORHER (Ist-Zustand, `src/api/stripe-webhook.ts` Z. 58–64):
//   return lookupKey.startsWith("pro_") ? "pro" : "free";
// Drei Fehler in einer Zeile:
//   1. Ein UNBEKANNTER Schlüssel wurde still zu 'free' (fail-OPEN, obwohl der
//      Kommentar „fail-closed" versprach).
//   2. `startsWith("pro_")` ist eine Falle: 'video_monthly' beginnt nicht mit
//      'pro_' ⇒ free. Und ein Präfix 'video_' würde 'video_plus_monthly'
//      ebenfalls als 'video' einordnen.
//   3. Kein Test konnte das bemerken, weil der Test die falsche Erwartung
//      festschrieb (`planTier(anderer Key) → free`).
//
// NACHHER: eine EXAKTE Zuordnung (Map, kein Objekt — damit '__proto__' und
// 'constructor' keine Treffer sind) und ein Wurf bei unbekannten Schlüsseln.
// Der Unterschied zwischen „kein Preis am Objekt" (null) und „Preis, den der
// Code nicht kennt" (Wurf) ist der Kern: das eine ist ein legitimer Zustand,
// das andere ein Fehler, den ein Mensch beheben muss.
//
// Bewusst KEINE Jahrespreise für Video (video_yearly/video_plus_yearly):
// §17.3.1 empfiehlt, ohne sie zu starten. Existiert je einer in Stripe, wirft
// diese Funktion — und der Abgleich Map ⇄ Stripe-Preise (S4) fällt vor dem
// ersten Verkauf auf.
// ─────────────────────────────────────────────────────────────────────────────

/** Alle Tarifnamen, die in `subscriptions.plan_tier` stehen dürfen. */
export type PlanTier = "free" | "pro" | "video" | "video_plus";

/**
 * Exakte Zuordnung Preis-lookup_key → Tarif. Die EINZIGE Quelle.
 * Reihenfolge ist ohne Bedeutung; die Menge ist es (siehe Freigabeliste unten).
 */
export const TIER_BY_LOOKUP_KEY: ReadonlyMap<string, PlanTier> = new Map([
  ["pro_monthly", "pro"],
  ["pro_yearly", "pro"],
  ["video_monthly", "video"],
  ["video_plus_monthly", "video_plus"],
]);

/** Verkaufbare Preis-Schlüssel (Freigabeliste des Checkouts) = dieselbe Menge. */
export const SELLABLE_LOOKUP_KEYS: readonly string[] = Object.freeze([
  ...TIER_BY_LOOKUP_KEY.keys(),
]);

export class UnknownPriceLookupKeyError extends Error {
  constructor(readonly lookupKey: string | null | undefined) {
    super(`Unbekannter Stripe-Preis-lookup_key: ${String(lookupKey)}`);
    this.name = "UnknownPriceLookupKeyError";
  }
}

/**
 * Tarif aus einem Stripe-Preis-lookup_key.
 *
 * @returns null  kein Preis/Schlüssel am Objekt — der Aufrufer entscheidet über
 *                den Fallback (bestehender DB-Tarif), NIE über 'free'.
 * @throws  UnknownPriceLookupKeyError  Schlüssel vorhanden, aber unbekannt.
 *                Absichtlich ein Wurf: ein bezahlter, nicht zuordenbarer Preis
 *                muss LAUT scheitern (Webhook 500 → Stripe wiederholt), nicht
 *                still als Free gespeichert werden.
 */
export function planTierForLookupKey(
  lookupKey: string | null | undefined,
): PlanTier | null {
  if (!lookupKey) return null;
  const tier = TIER_BY_LOOKUP_KEY.get(lookupKey);
  if (!tier) throw new UnknownPriceLookupKeyError(lookupKey);
  return tier;
}

/** Ist der Schlüssel verkaufbar (Checkout-Freigabeliste, §17.2.4 S3/S5)? */
export function isSellableLookupKey(lookupKey: string | null | undefined): boolean {
  return Boolean(lookupKey) && TIER_BY_LOOKUP_KEY.has(String(lookupKey));
}

/** Gehört der Preis zum Pro-Produkt? (Anwendung des Beta-Rabatts, T1) */
export function isProPriceLookupKey(lookupKey: string | null | undefined): boolean {
  if (!lookupKey) return false;
  return TIER_BY_LOOKUP_KEY.get(lookupKey) === "pro";
}

/**
 * Enthält der Tarif die Pro-Leistungen? Video und Video Plus sind „Pro + n
 * Videos" (§17.5.3) — wer dafür zahlt, darf NICHT auf Free fallen. Der
 * Zugriffs-Pfad (`qGetPlanTier`) bildet deshalb auf 'pro' ab.
 */
export function isProEquivalentTier(tier: PlanTier | string | null | undefined): boolean {
  return tier === "pro" || tier === "video" || tier === "video_plus";
}
