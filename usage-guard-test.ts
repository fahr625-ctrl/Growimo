// ─────────────────────────────────────────────────────────────────────────────
// Phase 8.2 — Usage-Guard Test-Suite (Free 5 / Pro 200 / Admin-Override)
// ─────────────────────────────────────────────────────────────────────────────
// Usage (aus der Repo-Wurzel, echte Test-DB — create the tables once via
// `bun --env-file=.env -e 'await import("./src/db/init").then(m=>m.initDb())'`):
//   bun --env-file=.env usage-guard-test.ts
//
// Testet die Guard-Funktionen DIREKT gegen die echte DB (Neon): atomares
// konditionales Increment, Monats-Periode, plan_tier-Lookup, Rate-Limit-Fenster
// und den internen Owner-/Admin-Override (Owner-ID user_3H2tr… darf über das
// Free-5-Limit hinaus generieren, Zähler steigt NICHT). Legt pro Lauf einen
// synthetischen Testnutzer an und räumt ALLE Testdaten im finally wieder ab.
// Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import {
  assertCanGenerate,
  assertRateOk,
  currentPeriod,
  isAdminOverride,
  limitForPlan,
  recordGeneration,
  releaseGeneration,
  withGenerationGuard,
  UsageLimitError,
  RateLimitError,
  ADMIN_OVERRIDE_USER_IDS,
  resolveUserIdFromServerFn,
} from './src/lib/usage-guard';
import { qGetPlanTier, qGetUsage, qIncrementUsage, ensureUserRow } from './src/db/queries';
import { getDb } from './src/db/index';

const OWNER_ID = 'user_3H2trJXHwzXmJF2XTGQ2PMEwjkD';
const TEST_USER = `guard-test-${Date.now().toString(36)}`;
const sql = getDb();

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
/** Erwartet einen Fehler mit `code`; gibt ihn zurück oder null (kein Fehler). */
const expectThrow = async (fn: () => Promise<unknown>, code: string, label: string) => {
  try {
    await fn();
    check(false, `${label} (kein Fehler geworfen)`);
    return null;
  } catch (err) {
    const hasCode = err instanceof Error && (err as { code?: string }).code === code;
    check(hasCode, `${label} → ${code}`);
    return err;
  }
};

async function main() {
  console.log('— usage-guard-test —\n');
  console.log('Testnutzer:', TEST_USER, '| Periode:', currentPeriod());

  // ── 0. Admin-Set-Check (rein, kein DB) ─────────────────────────────────────
  console.log('\n[0] Admin-Override-Set');
  check(ADMIN_OVERRIDE_USER_IDS.has(OWNER_ID), 'Owner-ID im Override-Set');
  check(ADMIN_OVERRIDE_USER_IDS.size === 1, 'genau eine ID (Owner) im Set');
  check(isAdminOverride(OWNER_ID), 'isAdminOverride(owner) === true');
  check(!isAdminOverride(TEST_USER), 'isAdminOverride(normal) === false');
  check(!isAdminOverride(null) && !isAdminOverride(undefined), 'isAdminOverride(null|undefined) === false');

  // ── 1. Free-Limit: 5/5 verbraucht → 6. blockiert ───────────────────────────
  console.log('\n[1] Free-Limit (5/Monat)');
  let p = currentPeriod();
  const first = await assertCanGenerate(TEST_USER, 'de');
  check(first.ok === true && first.remaining === 5, 'frischer Nutzer: assertCanGenerate ok, remaining=5');
  for (let i = 0; i < 5; i++) await recordGeneration(TEST_USER, 'de');
  const used5 = await qGetUsage(TEST_USER, p);
  check(used5 === 5, `5 recordGeneration → Zähler=${used5}/5`);
  const blockErr = await expectThrow(
    () => recordGeneration(TEST_USER, 'de'),
    'USAGE_LIMIT',
    '6. recordGeneration blockiert mit UsageLimitError',
  );
  if (blockErr instanceof UsageLimitError) {
    check(blockErr.remaining === 0 && blockErr.limit === 5, 'Fehler trägt remaining=0/limit=5');
    check(
      blockErr.message.includes('5/Monat') && blockErr.message.includes('200'),
      `Fehlermeldung mit Limit-Hinweis: "${blockErr.message.slice(0, 70)}…"`,
    );
  }
  await expectThrow(() => assertCanGenerate(TEST_USER, 'de'), 'USAGE_LIMIT', 'assertCanGenerate bei 0 Rest blockiert');

  // ── 2. Kompensation: Fehler verbraucht 0 ────────────────────────────────────
  console.log('\n[2] Kompensation (Fehler = 0 Verbrauch)');
  // Frischen Zählerstand herstellen (nach [1] ist der Nutzer auf 5/5).
  await sql`DELETE FROM usage_monthly WHERE user_id=(SELECT id FROM users WHERE clerk_id=${TEST_USER})`;
  const before = await qGetUsage(TEST_USER, p);
  check(before === 0, 'Ausgangslage Kompensation: Zähler=0');
  let origMsg = '';
  try {
    await withGenerationGuard(TEST_USER, async () => { throw new Error('künstlich'); }, 'de');
  } catch (err) {
    origMsg = err instanceof Error ? err.message : String(err);
  }
  check(origMsg === 'künstlich', 'withGenerationGuard bei Fehler wirft Originalfehler');
  const after = await qGetUsage(TEST_USER, p);
  check(before === after, `Zähler nach Fehler unverändert (${before} → ${after})`);
  const okVal = await withGenerationGuard(TEST_USER, async () => 'ok', 'de');
  check(okVal === 'ok' && (await qGetUsage(TEST_USER, p)) === before + 1, 'withGenerationGuard Erfolg → Zähler +1');
  await releaseGeneration(TEST_USER);
  check((await qGetUsage(TEST_USER, p)) === before, 'releaseGeneration → Zähler −1');

  // ── 3. Monatswechsel: alte Periode zählt nicht ──────────────────────────────
  console.log('\n[3] Monatswechsel');
  const oldPeriod = '2099-01';
  await sql`INSERT INTO usage_monthly (user_id, period, count) VALUES ((SELECT id FROM users WHERE clerk_id=${TEST_USER}), ${oldPeriod}, 5)
            ON CONFLICT (user_id, period) DO UPDATE SET count = 5`;
  const cur = await qGetUsage(TEST_USER, currentPeriod());
  const rem = (await assertCanGenerate(TEST_USER, 'de')).remaining;
  check(cur < 5 && rem === 5 - cur, `Verbrauch alter Periode (${oldPeriod}) zählt nicht (remaining=${rem})`);
  await sql`DELETE FROM usage_monthly WHERE user_id=(SELECT id FROM users WHERE clerk_id=${TEST_USER}) AND period=${oldPeriod}`;

  // ── 4. Pro-Limit (200) via plan_tier-Lookup ─────────────────────────────────
  console.log('\n[4] Pro-Limit (200/Monat)');
  const proUser = `${TEST_USER}-pro`;
  await ensureUserRow(proUser); // users-Zeile vor dem subscriptions-FK-Insert
  await sql`INSERT INTO subscriptions (user_id, plan_tier, status)
            VALUES ((SELECT id FROM users WHERE clerk_id=${proUser}), 'pro', 'active')
            ON CONFLICT DO NOTHING`;
  const tier = await qGetPlanTier(proUser);
  check(tier === 'pro' && limitForPlan(tier) === 200, 'qGetPlanTier → pro, Limit=200');
  for (let i = 0; i < 200; i++) {
    const n = await qIncrementUsage(proUser, p, 200);
    if (n == null) { check(false, `Pro-Increment ${i + 1} unerwartet blockiert`); break; }
  }
  const proUsed = await qGetUsage(proUser, p);
  check(proUsed === 200, `200 Pro-Generierungen ok (Zähler=${proUsed})`);
  const proErr = await expectThrow(() => recordGeneration(proUser, 'de'), 'USAGE_LIMIT', '201. Pro-Generierung blockiert');
  if (proErr instanceof UsageLimitError) check(proErr.limit === 200, 'Pro-Fehler trägt limit=200');

  // ── 5. Rate-Limit (Fenster) ─────────────────────────────────────────────────
  console.log('\n[5] Rate-Limit (2s-Fenster, hier 50ms via opts)');
  const rateUser = `${TEST_USER}-rate`;
  await assertRateOk(rateUser, { minIntervalMs: 50 });
  check(true, '1. assertRateOk ok (Eintrag gesetzt)');
  await expectThrow(() => assertRateOk(rateUser, { minIntervalMs: 50_000 }), 'RATE_LIMIT', '2. Call im Fenster → RateLimitError');
  await assertRateOk(rateUser, { minIntervalMs: 0 });
  check(true, 'minIntervalMs=0 → immer erlaubt (Tests)');

  // ── 6. Admin-/Owner-Override: über 5/5 hinweg, Zähler steigt NICHT ──────────
  console.log('\n[6] Owner-Override (unbegrenzt, kein Zähler-Increment)');
  const ownerRows = await sql`SELECT id FROM users WHERE clerk_id=${OWNER_ID} LIMIT 1`;
  const ownerUid = ownerRows.length ? String((ownerRows[0] as { id: string }).id) : null;
  if (ownerUid) {
    const ownerBefore = await qGetUsage(OWNER_ID, p);
    // Owner künstlich auf 5/5 setzen (Exhausted-Zustand), danach im finally
    // exakt auf den Ursprungswert zurücksetzen.
    await sql`INSERT INTO usage_monthly (user_id, period, count) VALUES (${ownerUid}, ${p}, GREATEST(5, ${ownerBefore}))
              ON CONFLICT (user_id, period) DO UPDATE SET count = GREATEST(usage_monthly.count, 5)`;
    try {
      const res = await assertCanGenerate(OWNER_ID, 'de');
      check(res.ok === true && res.remaining === Number.MAX_SAFE_INTEGER, 'Owner bei künstlich 5/5: assertCanGenerate ok (unbegrenzt)');
      const val = await withGenerationGuard(OWNER_ID, async () => 'owner-ok', 'de');
      check(val === 'owner-ok', 'Owner withGenerationGuard läuft durch (Call ok)');
      const ownerAfter = await qGetUsage(OWNER_ID, p);
      check(ownerAfter === 5, `Owner-Zähler nach Call weiterhin 5 (${ownerBefore}→gesetzt 5→${ownerAfter}, KEIN Increment)`);
      await assertRateOk(OWNER_ID, { minIntervalMs: 50_000 });
      check(true, 'Owner assertRateOk: KEIN Rate-Limit-Block (mini-Fenster ignoriert)');
    } finally {
      if (ownerBefore === 0) {
        await sql`DELETE FROM usage_monthly WHERE user_id=${ownerUid} AND period=${p}`;
      } else {
        await sql`UPDATE usage_monthly SET count=${ownerBefore} WHERE user_id=${ownerUid} AND period=${p}`;
      }
      const restored = await qGetUsage(OWNER_ID, p);
      check(restored === ownerBefore, `Owner-DB-Zustand wiederhergestellt (${restored})`);
    }
  } else {
    // Owner hat noch keine users-Zeile → Override rein über die frühe Rückkehr
    // testen (keine DB-Write an Owner).
    const res = await assertCanGenerate(OWNER_ID, 'de');
    check(res.ok === true, 'Owner ohne DB-Zeile: assertCanGenerate ok (frühe Rückkehr, kein DB-Zugriff)');
    const val = await withGenerationGuard(OWNER_ID, async () => 'owner-ok', 'de');
    check(val === 'owner-ok', 'Owner withGenerationGuard läuft durch');
  }

  // ── 7. Payload-Sicherheit: Owner-ID aus dem Request-Body wird verworfen ─────
  console.log('\n[7] Payload-Sicherheit (Owner-ID nie aus Request-Body)');
  const forged = await resolveUserIdFromServerFn(OWNER_ID);
  check(forged === null, 'resolveUserIdFromServerFn(ownerId als payload) → null (fail-closed)');
  const normal = await resolveUserIdFromServerFn(TEST_USER);
  check(normal === TEST_USER, 'resolveUserIdFromServerFn(normaler payload) → Fallback ok (nur ohne Session)');

  // ── 8. Cleanup aller Testdaten ──────────────────────────────────────────────
  console.log('\n[8] Cleanup');
  for (const u of [TEST_USER, proUser, rateUser]) {
    await sql`DELETE FROM usage_monthly WHERE user_id=(SELECT id FROM users WHERE clerk_id=${u})`;
    await sql`DELETE FROM generation_throttle WHERE user_id=${u}`;
    await sql`DELETE FROM subscriptions WHERE user_id=(SELECT id FROM users WHERE clerk_id=${u})`;
    const d = await sql`DELETE FROM users WHERE clerk_id=${u}`;
    console.log(`  removed ${u}: users=${d.count}`);
  }
  await sql`DELETE FROM generation_throttle WHERE user_id=${TEST_USER}`;

  console.log(`\n=== usage-guard-test: ${passed} PASS, ${failed} FAIL ===`);
  if (failed > 0) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL', e);
  // Aufräumversuch (best effort), damit Testnutzer nie liegen bleiben.
  sql`DELETE FROM users WHERE clerk_id LIKE 'guard-test-%'`.catch(() => {});
  sql`DELETE FROM generation_throttle WHERE user_id LIKE 'guard-test-%'`.catch(() => {});
  process.exit(1);
});