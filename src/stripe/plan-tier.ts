// ─────────────────────────────────────────────────────────────────────────────
// TARIF-ZUORDNUNG — fail-closed
// ─────────────────────────────────────────────────────────────────────────────
// VORHER (Ist-Zustand, `src/api/stripe-webhook.ts`):
//   startsWith(pro_) → pro, sonst → Free. Also: jeder Schlüssel, der nicht mit
//   pro_ beginnt, wurde still zum Free-Tarif.
// Zwei Fehler in einer Zeile:
//   1. Ein UNBEKANNTER Schlüssel wurde still zu 'free' (fail-OPEN, obwohl der
//      Kommentar „fail-closed" versprach). Ein zahlender Kunde mit einem neuen
//      oder falsch benannten Preis wäre still auf Free gefallen.
//   2. Kein Test konnte das bemerken, weil der Test die falsche Erwartung
//      festschrieb (`planTier(anderer Key) → free`).
//
// NACHHER: eine EXAKTE Zuordnung (Map, kein Objekt — damit '__proto__' und
// 'constructor' keine Treffer sind) und ein Wurf bei unbekannten Schlüsseln.
// Der Unterschied zwischen „kein Preis am Objekt" (null) und „Preis, den der
// Code nicht kennt" (Wurf) ist der Kern: das eine ist ein legitimer Zustand
// (der Aufrufer nimmt den gespeicherten Tarif), das andere ein Fehler, den ein
// Mensch beheben muss — laut, nicht still.
//
// DIESES MODUL KENNT NUR BEZAHLTE TARIFE. Es gibt hier bewusst KEINEN
// Free-Rückfall und auch keinen Free-Wert: `plan_tier = 'free'` entsteht
// ausschließlich aus einem ausdrücklichen Ereignis (Abo gelöscht/abgelaufen,
// Erst-Zustand eines Nutzers) — niemals aus einer Preis-Zuordnung. Genau das
// macht den alten Fehler unmöglich: es gibt in dieser Datei keinen Ausdruck,
// der auf den Free-Tarif zurückfällt (Nachweis: kein Fallback-Operator auf
// einen Free-Wert, kein Free-Wert im Code — siehe TESTBERICHT).
//
// ABGRENZUNG (Owner-Entscheidung 2026-11-06): Dieser Live-Ausschnitt enthält
// AUSSCHLIESSLICH die fail-closed-Preiszuordnung für die heute verkauften
// Tarife (pro_monthly / pro_yearly). Die zurückgestellten Video-Tarife sind
// absichtlich NICHT hier: sie kämen mit Schema-Änderungen, einer zusätzlichen
// Berechtigungs-Tabelle und einem Rabatt-Hook am Webhook mit — und ein Hook auf
// eine in Prod nicht existierende Tabelle würde jeden Zahlungs-Webhook zum
// 500er machen (zahlender Kunde bekommt kein Pro).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ein Tarif, den ein Stripe-PREIS abbilden kann. Heute ist das nur 'pro':
 * 'pro_monthly' und 'pro_yearly' sind zwei Preise desselben Tarifs.
 */
export type PaidPlanTier = "pro";

/**
 * Exakte Zuordnung Preis-lookup_key → Tarif. Die EINZIGE Quelle.
 * Reihenfolge ist ohne Bedeutung; die Menge ist es.
 */
export const TIER_BY_LOOKUP_KEY: ReadonlyMap<string, PaidPlanTier> = new Map([
  ["pro_monthly", "pro"],
  ["pro_yearly", "pro"],
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
): PaidPlanTier | null {
  if (!lookupKey) return null;
  const tier = TIER_BY_LOOKUP_KEY.get(lookupKey);
  if (!tier) throw new UnknownPriceLookupKeyError(lookupKey);
  return tier;
}

/** Ist der Schlüssel verkaufbar (Checkout-Freigabeliste)? */
export function isSellableLookupKey(lookupKey: string | null | undefined): boolean {
  return Boolean(lookupKey) && TIER_BY_LOOKUP_KEY.has(String(lookupKey));
}
