// ─────────────────────────────────────────────────────────────────────────────
// B2-UNIT-TESTS: Tarif-Zuordnung Preis-lookup_key → plan_tier (fail-closed)
// ─────────────────────────────────────────────────────────────────────────────
// Owner-Auftrag 2026-11-05, §17.2.2. Reine Logik, KEINE DB, KEIN Netz, keine
// Env-Variablen — läuft in Millisekunden und ohne Test-Framework (bewusst im
// Stil der übrigen Repo-Suiten: `check()` + Exit-Code, keine `bun:test`-Typen,
// die im Repo nicht installiert sind):
//
//   bun plan-tier-test.ts
//
// Was hier festgeschrieben wird (und was NICHT mehr behauptet werden darf):
//   · bekannte Schlüssel → der richtige Tarif
//   · unbekannter Schlüssel → UnknownPriceLookupKeyError (NIE 'free')
//   · der Fehlertext NENNT den Schlüssel (diagnostizierbar im Webhook-Log)
//
// ZWEI BEWUSSTE ABWEICHUNGEN von der Auftragsformulierung (dokumentiert in
// TESTBERICHT.md, Abschnitt „B2-TESTS"):
//   1. `null`/`undefined`/leerer String werfen NICHT, sie liefern `null`.
//      Grund: mit API-Version 2026-08-26.dahlia trägt `invoice.paid` KEINEN
//      lookup_key (belegt am echten Event-Payload). Würfe die Funktion dort,
//      wäre jede legitime Verlängerung ein 500er und der Kunde verlöre Pro.
//      Der Fail-closed-Teil liegt deshalb an den AUFRUFSTELLEN
//      (`resolveTierOrThrow` / `tierForWrite`): kein Preis UND kein DB-Tarif
//      ⇒ UnresolvablePlanTierError. Belegt in
//      `stripe-webhook-tier-fail-closed.test.ts`.
//   2. `video_monthly` existiert im Branch bereits (B1/B2, §17.3.1) und bildet
//      auf 'video' ab — es ist damit KEIN unbekannter Schlüssel. Unbekannt (und
//      damit werfend) sind `video_yearly` / `video_plus_yearly` (bewusst nicht
//      angelegt) und jeder Tippfehler.
// ─────────────────────────────────────────────────────────────────────────────
import {
  SELLABLE_LOOKUP_KEYS,
  TIER_BY_LOOKUP_KEY,
  UnknownPriceLookupKeyError,
  isProEquivalentTier,
  isProPriceLookupKey,
  isSellableLookupKey,
  planTierForLookupKey,
} from "./src/stripe/plan-tier";

let passed = 0;
let failed = 0;
const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ PASS: ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ FAIL: ${label}`);
  }
};

/** Führt fn aus und liefert den geworfenen Fehler (null = kein Wurf). */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}

/** Schlüssel, die es (noch) nicht gibt — jeder muss werfen. */
const UNKNOWN_KEYS = [
  "video_yearly", // §17.3.1: bewusst nicht angelegt
  "video_plus_yearly", // dito
  "pro_monthly_typo", // Tippfehler
  "pro_monthl", // Tippfehler
  "PRO_MONTHLY", // Groß-/Kleinschreibung ist exakt
  "pro", // Tarifname, kein Preis-Schlüssel
  "free",
  "monthly",
  " pro_monthly", // führendes Leerzeichen
  "pro_monthly ", // nachgestelltes Leerzeichen
  "__proto__", // Map statt Objekt: kein Prototype-Treffer
  "constructor",
  "toString",
  "hasOwnProperty",
];

console.log("— plan-tier-test (B2, fail-closed Tarif-Zuordnung) —\n");

// ── [1] Bekannte Schlüssel ──────────────────────────────────────────────────
console.log("[1] Bekannte lookup_keys → richtiger Tarif");
check(planTierForLookupKey("pro_monthly") === "pro", "pro_monthly → pro");
check(planTierForLookupKey("pro_yearly") === "pro", "pro_yearly → pro");
check(planTierForLookupKey("video_monthly") === "video", "video_monthly → video (Branch-Stand B1/B2)");
check(planTierForLookupKey("video_plus_monthly") === "video_plus", "video_plus_monthly → video_plus");
let allMapped = true;
for (const key of TIER_BY_LOOKUP_KEY.keys()) {
  const tier = planTierForLookupKey(key);
  if (!tier || tier === "free") allMapped = false;
}
check(allMapped, "jeder Schlüssel der Map ist zuordenbar und nie 'free'");

// ── [2] Unbekannte Schlüssel werfen ─────────────────────────────────────────
console.log("\n[2] Unbekannte lookup_keys → UnknownPriceLookupKeyError (fail-closed)");
for (const key of UNKNOWN_KEYS) {
  const err = thrownBy(() => planTierForLookupKey(key));
  check(err instanceof UnknownPriceLookupKeyError, `"${key}" → UnknownPriceLookupKeyError`);
  const typed = err as UnknownPriceLookupKeyError;
  check(
    err instanceof Error && typed.message.includes(key),
    `"${key}" → Fehlertext nennt den Schlüssel`,
  );
  check(typed.lookupKey === key, `"${key}" → .lookupKey trägt den Schlüssel`);
}
check(
  thrownBy(() => planTierForLookupKey("tippfehler")) instanceof Error &&
    (thrownBy(() => planTierForLookupKey("tippfehler")) as Error).name === "UnknownPriceLookupKeyError",
  "Fehler-Name ist 'UnknownPriceLookupKeyError' (Log-Diagnose)",
);

// Der alte fail-open-Pfad darf nirgends mehr auftauchen.
console.log("\n[3] Der alte fail-open-Pfad ist weg");
let anyFree = false;
for (const key of UNKNOWN_KEYS) {
  const err = thrownBy(() => planTierForLookupKey(key));
  if (err === null) {
    // Kein Wurf ist hier schon falsch; ein Ergebnis 'free' wäre der Altbug.
    anyFree = true;
  }
}
check(!anyFree, "kein unbekannter Schlüssel wird still zu 'free'");

// ── [4] Kein Preis am Objekt (null) — kein Fehler, kein free ────────────────
console.log("\n[4] Kein Preis am Objekt → null (Aufrufer entscheidet, NIE free)");
check(planTierForLookupKey(null) === null, "null → null");
check(planTierForLookupKey(undefined) === null, "undefined → null");
check(planTierForLookupKey("") === null, "leerer String → null (wie 'kein Preis')");

// ── [5] Freigabeliste / Pro-Erkennung ───────────────────────────────────────
console.log("\n[5] Freigabeliste / Pro-Erkennung");
check(
  [...SELLABLE_LOOKUP_KEYS].sort().join(",") === [...TIER_BY_LOOKUP_KEY.keys()].sort().join(","),
  "SELLABLE_LOOKUP_KEYS == Map-Schlüssel (eine Quelle)",
);
check(Object.isFrozen(SELLABLE_LOOKUP_KEYS), "SELLABLE_LOOKUP_KEYS ist eingefroren");
check(isSellableLookupKey("pro_monthly") === true, "isSellable(pro_monthly) → true");
check(isSellableLookupKey("video_plus_monthly") === true, "isSellable(video_plus_monthly) → true");
check(isSellableLookupKey("video_yearly") === false, "isSellable(video_yearly) → false (kein Wurf)");
check(isSellableLookupKey("__proto__") === false, "isSellable(__proto__) → false");
check(isSellableLookupKey("") === false && isSellableLookupKey(null) === false && isSellableLookupKey(undefined) === false, "isSellable(leer/null/undefined) → false");
check(isProPriceLookupKey("pro_monthly") === true && isProPriceLookupKey("pro_yearly") === true, "isProPreis(pro_monthly|pro_yearly) → true");
check(isProPriceLookupKey("video_monthly") === false && isProPriceLookupKey("video_plus_monthly") === false, "isProPreis(video*) → false (Beta-Rabatt nur auf Pro)");
check(isProPriceLookupKey(null) === false && isProPriceLookupKey("tippfehler") === false, "isProPreis(null|Tippfehler) → false");
check(isProEquivalentTier("pro") === true && isProEquivalentTier("video") === true && isProEquivalentTier("video_plus") === true, "isProEquivalentTier(pro|video|video_plus) → true");
check(isProEquivalentTier("free") === false && isProEquivalentTier(null) === false && isProEquivalentTier("premium") === false, "isProEquivalentTier(free|null|premium) → false");

// ── Bilanz ──────────────────────────────────────────────────────────────────
console.log(`\n=== plan-tier-test: ${passed} PASS, ${failed} FAIL ===`);
if (failed > 0) {
  console.log("Fehlgeschlagen:");
  for (const f of failures) console.log("  - " + f);
  process.exitCode = 1;
}
