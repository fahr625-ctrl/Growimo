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
  FREE_ONCE_PERIOD,
  usagePeriodForPlan,
  getUsageInfo,
  isAdminOverride,
  limitForPlan,
  recordGeneration,
  releaseGeneration,
  withGenerationGuard,
  UsageLimitError,
  ADMIN_OVERRIDE_USER_IDS,
  resolveUserIdFromServerFn,
} from './src/lib/usage-guard';
import { qGetPlanTier, qGetUsage, qIncrementUsage, ensureUserRow } from './src/db/queries';
import { getDb } from './src/db/index';

// Owner-Clerk-ID aus der EINZIGEN Quelle (src/lib/owner-id.ts, über den Guard
// exportiert) statt einer Kopie im Test — die Kopie war veraltet und erzeugte
// zwei Dauer-Fails (2026-10-22).
const OWNER_ID = [...ADMIN_OVERRIDE_USER_IDS][0]!;
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

  // ── 1. Free-Kontingent: 3 EINMALIG verbraucht → 4. blockiert ───────────────
  // Owner-Entscheidung 2026-10-22: Free = 3 Generierungen einmalig pro Nutzer,
  // Periode 'once' (kein Monats-Rollover, kein Reset nach Kündigung).
  console.log('\n[1] Free-Kontingent (3 einmalig, Periode "once")');
  const p = FREE_ONCE_PERIOD;
  check(usagePeriodForPlan('free') === 'once', 'usagePeriodForPlan(free) === "once"');
  const first = await assertCanGenerate(TEST_USER, 'de');
  check(first.ok === true && first.remaining === 3, 'frischer Nutzer: assertCanGenerate ok, remaining=3');
  for (let i = 0; i < 3; i++) await recordGeneration(TEST_USER, 'de');
  const used3 = await qGetUsage(TEST_USER, p);
  check(used3 === 3, `3 recordGeneration → Zähler=${used3}/3 (Periode "once")`);
  const blockErr = await expectThrow(
    () => recordGeneration(TEST_USER, 'de'),
    'USAGE_LIMIT',
    '4. recordGeneration blockiert mit UsageLimitError',
  );
  if (blockErr instanceof UsageLimitError) {
    check(blockErr.remaining === 0 && blockErr.limit === 3, 'Fehler trägt remaining=0/limit=3');
    check(
      blockErr.message.includes('aufgebraucht') && blockErr.message.includes('19'),
      `Fehlermeldung ohne "monatlich", mit Abo-Hinweis: "${blockErr.message.slice(0, 70)}…"`,
    );
  }
  await expectThrow(() => assertCanGenerate(TEST_USER, 'de'), 'USAGE_LIMIT', 'assertCanGenerate bei 0 Rest blockiert');

  // ── 2. Kompensation: Fehler verbraucht 0 ────────────────────────────────────
  console.log('\n[2] Kompensation (Fehler = 0 Verbrauch)');
  // Frischen Zählerstand herstellen (nach [1] ist der Nutzer auf 5/5).
  await sql`DELETE FROM usage_events WHERE user_id=${TEST_USER}`;
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

  // ── 3. KEIN Monats-Reset für Free (Periode 'once') ──────────────────────────
  console.log('\n[3] Monats-Reset (Free: keiner)');
  // (a) Eine ALTE Monatszeile ('2099-01') darf das einmalige Kontingent nicht
  // berühren — Free liest ausschließlich die 'once'-Zeile.
  const oldPeriod = '2099-01';
  await sql`INSERT INTO usage_monthly (user_id, period, count) VALUES ((SELECT id FROM users WHERE clerk_id=${TEST_USER}), ${oldPeriod}, 5)
            ON CONFLICT (user_id, period) DO UPDATE SET count = 5`;
  const onceCount = await qGetUsage(TEST_USER, p);
  const rem = (await assertCanGenerate(TEST_USER, 'de')).remaining;
  check(onceCount === 0 && rem === 3, `Monatszeile (${oldPeriod}) zählt für Free nicht (remaining=${rem}/3)`);
  await sql`DELETE FROM usage_monthly WHERE user_id=(SELECT id FROM users WHERE clerk_id=${TEST_USER}) AND period=${oldPeriod}`;
  // (b) Monatswechsel (Date-Mock): Free bleibt 'once', Pro rollt weiter.
  const dec = new Date(2026, 11, 31, 23, 59, 59);
  const jan = new Date(2027, 0, 1, 0, 0, 1);
  check(
    usagePeriodForPlan('free', dec) === 'once' && usagePeriodForPlan('free', jan) === 'once',
    'Monatswechsel: Free-Periode bleibt konstant "once" (31.12. → 01.01.)',
  );
  check(
    usagePeriodForPlan('pro', dec) === '2026-12' && usagePeriodForPlan('pro', jan) === '2027-01',
    'Monatswechsel: Pro-Periode rollt 2026-12 → 2027-01',
  );
  // (c) getUsageInfo: Free liefert {limit:3, period:'once'}.
  const infoFree = await getUsageInfo(TEST_USER);
  check(
    infoFree.limit === 3 && infoFree.period === 'once' && infoFree.planTier === 'free',
    `getUsageInfo(free) → limit=${infoFree.limit}, period="${infoFree.period}", remaining=${infoFree.remaining}`,
  );

  // ── 4. Pro-Limit (200) via plan_tier-Lookup ─────────────────────────────────
  console.log('\n[4] Pro-Limit (200/Monat)');
  const proUser = `${TEST_USER}-pro`;
  await ensureUserRow(proUser); // users-Zeile vor dem subscriptions-FK-Insert
  await sql`INSERT INTO subscriptions (user_id, plan_tier, status)
            VALUES ((SELECT id FROM users WHERE clerk_id=${proUser}), 'pro', 'active')
            ON CONFLICT DO NOTHING`;
  const tier = await qGetPlanTier(proUser);
  check(tier === 'pro' && limitForPlan(tier) === 200, 'qGetPlanTier → pro, Limit=200');
  const pPro = usagePeriodForPlan('pro'); // 'YYYY-MM' — Pro rollt monatlich
  check(pPro === currentPeriod(), `Pro-Periode = aktueller Monat (${pPro})`);
  for (let i = 0; i < 200; i++) {
    const n = await qIncrementUsage(proUser, pPro, 200);
    if (n == null) { check(false, `Pro-Increment ${i + 1} unerwartet blockiert`); break; }
  }
  const proUsed = await qGetUsage(proUser, pPro);
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
    // FIX-BLOCK 2 (2026-10-08): Der Usage-Guard schreibt seit FIX-BLOCK 1 eine
    // usage_events-Zeile pro Verbrauch. Ohne diesen Delete blieb pro Lauf eine
    // Restzeile in der Prod-DB liegen (Wachstum 1/Lauf).
    await sql`DELETE FROM usage_events WHERE user_id=${u}`;
    await sql`DELETE FROM usage_monthly WHERE user_id=(SELECT id FROM users WHERE clerk_id=${u})`;
    await sql`DELETE FROM generation_throttle WHERE user_id=${u}`;
    await sql`DELETE FROM subscriptions WHERE user_id=(SELECT id FROM users WHERE clerk_id=${u})`;
    // TS2339 (FIX-BLOCK 3, 2026-10-08): Die Statement-Ergebnisse von
    // @neondatabase/serverless sind für Nicht-SELECT-Queries als RowList typisiert
    // und deklarieren `count` (Feld der Neon-Full-Results) nicht. Laufzeit-Feld ist
    // laut Neon-Doku vorhanden → dokumentierter Cast statt Typ-Lücke.
    const d = (await sql`DELETE FROM users WHERE clerk_id=${u}`) as unknown as {
      count?: number;
    };
    console.log(`  removed ${u}: users=${d.count ?? 0}`);
  }
  // FIX-BLOCK 5 Nacharbeit (2026-10-08): Der Check unten prüft GLOBAL alle
  // `guard-test-%`-Reste, die Schleife oben räumte aber nur die IDs DIESES Laufs
  // (TEST_USER = guard-test-<Date.now()36>). Wurde ein früherer Lauf mitten im
  // 200er-Pro-Lauf abgebrochen (z. B. durch einen Plattform-Neustart), blieben
  // dessen Zeilen liegen und die Suite meldete dauerhaft "31 PASS, 1 FAIL",
  // obwohl sie selbst fehlerfrei aufgeräumt hatte. Deshalb hier ein
  // Präfix-Sweep (nur synthetische Test-IDs, kein produktiver Datenbereich),
  // der dieselbe Invariante herstellt, die der Check unten behauptet.
  await sql`DELETE FROM usage_events WHERE user_id LIKE 'guard-test-%'`;
  await sql`DELETE FROM usage_monthly WHERE user_id IN (SELECT id FROM users WHERE clerk_id LIKE 'guard-test-%')`;
  await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE clerk_id LIKE 'guard-test-%')`;
  await sql`DELETE FROM generation_throttle WHERE user_id LIKE 'guard-test-%'`;
  await sql`DELETE FROM users WHERE clerk_id LIKE 'guard-test-%'`;
  const leftoverEvents = await sql`SELECT COUNT(*) AS n FROM usage_events WHERE user_id LIKE 'guard-test-%'`;
  check(Number(leftoverEvents[0].n) === 0, `keine Test-Ledger-Zeilen übrig (${leftoverEvents[0].n})`);

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
  // FIX-BLOCK 5 Nacharbeit: um usage_monthly/subscriptions ergänzt (Kinder von users).
  sql`DELETE FROM usage_events WHERE user_id LIKE 'guard-test-%'`.catch(() => {});
  sql`DELETE FROM usage_monthly WHERE user_id IN (SELECT id FROM users WHERE clerk_id LIKE 'guard-test-%')`.catch(() => {});
  sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE clerk_id LIKE 'guard-test-%')`.catch(() => {});
  sql`DELETE FROM generation_throttle WHERE user_id LIKE 'guard-test-%'`.catch(() => {});
  sql`DELETE FROM users WHERE clerk_id LIKE 'guard-test-%'`.catch(() => {});
  process.exit(1);
});