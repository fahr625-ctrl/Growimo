/**
 * B2-DB-SUITE (2026-11-06) — Patch 2: die drei roten Checks in [3] korrigieren.
 *
 * Kein Abschwaechen — die Erwartungen werden auf den BELEGTEN Live-Vertrag
 * gezogen:
 *  · Free-Kontingent ist seit dem Owner-Entscheid 2026-10-22 (Commit 6b5beef)
 *    GENAU 3, einmalig (Business-Plan: "Free 0 € / GENAU 3 KI-Generierungen
 *    EINMALIG"). Der Test hielt noch die alte Zahl 5 fest.
 *  · qGetRemaining(userId, period, limit) — der Test rief
 *    qGetRemaining(user, 'free'|'pro', '2099-01') auf, also Periode und Limit
 *    vertauscht. Folge: limit='2099-01' → Math.max(NaN,0) → NaN → Check rot.
 *    (Beleg: src/db/queries.ts:1266-1273.)
 * Beide Erwartungen bleiben exakte Zahlen, nicht ">0".
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "stripe-webhook-test.ts";
let src = readFileSync(FILE, "utf8");
function must(cond: boolean, msg: string) {
  if (!cond) throw new Error(`PATCH FAILED: ${msg}`);
  console.log(`  ok: ${msg}`);
}

const oldFree = `    check(limitForPlan('free') === FREE_LIMIT && FREE_LIMIT === 5, 'Free-Limit = 5 (Owner-Festlegung)');`;
must(src.includes(oldFree), "alter Free-Limit-Check gefunden");
src = src.replace(
  oldFree,
  `    // Owner-Entscheid 2026-10-22 (Commit 6b5beef): Free = 3 Generierungen,
    // EINMALIG (kein Monats-Reset). Die alte Erwartung 5 war ueberholt.
    check(limitForPlan('free') === FREE_LIMIT && FREE_LIMIT === 3, 'Free-Limit = 3 einmalig (Owner-Festlegung 2026-10-22)');`,
);

const oldFreeRem = `    const freeRemaining = await qGetRemaining(TEST_USERS[1], 'free', '2099-01');`;
must(src.includes(oldFreeRem), "alter Free-Remaining-Aufruf gefunden");
src = src.replace(
  oldFreeRem,
  `    // Signatur ist qGetRemaining(userId, period, limit) — vorher waren Periode
    // und Limit vertauscht (limit='2099-01' → NaN).
    const freeRemaining = await qGetRemaining(TEST_USERS[1], '2099-01', FREE_LIMIT);`,
);

const oldFreeCheck = `    check(freeRemaining === 5, 'Free: 5 von 5 verbleibend');`;
must(src.includes(oldFreeCheck), "alter Free-Remaining-Check gefunden");
src = src.replace(
  oldFreeCheck,
  `    check(freeRemaining === FREE_LIMIT && freeRemaining === 3, 'Free: 3 von 3 verbleibend');`,
);

const oldProRem = `    const proRemaining = await qGetRemaining(TEST_USERS[0], 'pro', '2099-01');`;
must(src.includes(oldProRem), "alter Pro-Remaining-Aufruf gefunden");
src = src.replace(
  oldProRem,
  `    const proRemaining = await qGetRemaining(TEST_USERS[0], '2099-01', PRO_LIMIT);`,
);

const oldProCheck = "check(proRemaining === PRO_LIMIT, `Pro: ${PRO_LIMIT} von ${PRO_LIMIT} verbleibend (Guard-Verzahnung)`);";
must(src.includes(oldProCheck), "alter Pro-Remaining-Check gefunden");

writeFileSync(FILE, src);
console.log("PATCH 2 OK —", FILE);
