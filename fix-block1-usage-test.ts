// ─────────────────────────────────────────────────────────────────────────────
// FIX-BLOCK 1 (Owner-Auftrag 2026-10-08) — korrekte Nutzungszählung aller
// kostenpflichtigen KI-Funktionen. Test-Suite.
// ─────────────────────────────────────────────────────────────────────────────
// Aufruf (aus der Repo-Wurzel, echte DB):
//   bun --env-file=.env fix-block1-usage-test.ts
//
// Geprüft wird:
//   1. TikTok-Diagnose zählt 1 Generierung (Guard + Ledger-Aktion) und die
//      Server-Verdrahtung enthält den 0-Verbrauch-Sonderpfad NICHT mehr.
//   2. A/B-Varianten zählen 1 Generierung über DIESELBE konditionale Guard-Kette
//      (Limit blockiert den Call), Ledger-Aktion 'ab_variants'.
//   3. Anzeige = DB: getUsageInfo (die Quelle des Banners/der Hinweise) stimmt
//      exakt mit usage_monthly.count überein; kein Anzeige-Pfad liest mehr einen
//      eigenständigen lokalen Zähler.
//   4. Owner-/Admin-Override bleibt unbegrenzt, ohne Zähler UND ohne Ledger.
//   5. Event-Log: je Verbrauch genau eine usage_events-Zeile (Aktion, userId,
//      count_after, limit, Timestamp).
//   6. Free-Limit blockt den 6. Verbrauch — ohne Zähler-Erhöhung, ohne Ledger,
//      ohne Ausführung des KI-Calls.
//   7. Semantik: interne Retries/Scoring/Verbessern bleiben bei 0.
// Exit-Code 0 nur, wenn alle Checks grün. Synthetische Testnutzer werden im
// finally vollständig entfernt.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import {
  FREE_LIMIT,
  UsageLimitError,
  currentPeriod,
  getUsageInfo,
  isAdminOverride,
  limitForPlan,
  recordGeneration,
  withGenerationGuard,
} from './src/lib/usage-guard';
import { qGetUsage, qGetUsageEvents, qGetPlanTier, ensureUserRow } from './src/db/queries';
import { getDb } from './src/db/index';

const OWNER_ID = 'user_3H2trJXHwzXmJF2XTGQ2PMEwjkD';
const STAMP = Date.now().toString(36);
const U_DIAG = `fb1-diag-${STAMP}`;
const U_AB = `fb1-ab-${STAMP}`;
const U_LIMIT = `fb1-limit-${STAMP}`;
const ALL_USERS = [U_DIAG, U_AB, U_LIMIT];
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
const src = (p: string) => readFileSync(p, 'utf8');
const period = currentPeriod();

async function main() {
  console.log('— fix-block1-usage-test —\n');
  console.log('Testnutzer:', ALL_USERS.join(', '), '| Periode:', period);

  // ── 1. TikTok-Diagnose = 1 Generierung ─────────────────────────────────────
  console.log('\n[1] TikTok-Diagnose zählt 1 Generierung');
  const beforeDiag = await qGetUsage(U_DIAG, period);
  check(beforeDiag === 0, `Ausgangszähler Diagnose-Nutzer = 0 (${beforeDiag})`);
  let diagFnRan = false;
  await withGenerationGuard(U_DIAG, async () => { diagFnRan = true; return 'diagnose-ok'; }, 'de', {
    action: 'tiktok_diagnose',
    detail: 'diagnose',
  });
  const afterDiag = await qGetUsage(U_DIAG, period);
  // FIX-BLOCK 2 (2026-10-08): `diagFnRan === true` war für tsc ein TS2367
  // (das Flag wird nur in der Callback-Closure gesetzt, die Kontrollfluss-
  // Analyse sieht dort weiterhin literal `false`). Korrigiert statt
  // unterdrückt: `check(diagFnRan, …)` ist semantisch identisch (boolean).
  check(diagFnRan, 'Diagnose-Call ausgeführt');
  check(afterDiag === beforeDiag + 1, `Diagnose 1 Diagnose = +1 Generierung (${beforeDiag} → ${afterDiag})`);
  const diagInfo = await getUsageInfo(U_DIAG);
  check(
    diagInfo.used === afterDiag && diagInfo.remaining === FREE_LIMIT - afterDiag,
    `Anzeige-Wert = DB (used=${diagInfo.used}, remaining=${diagInfo.remaining}/${diagInfo.limit})`,
  );

  // Server-Verdrahtung: der frühere 0-Verbrauch-Sonderpfad darf nicht mehr existieren.
  const serverSrc = src('src/ai/server.ts');
  check(
    !/Diagnose zählt 0 Generierungen/.test(serverSrc),
    'server.ts enthält den alten „Diagnose zählt 0"-Pfad NICHT mehr',
  );
  check(
    !/if \(data\.mode === 'diagnose'\) \{\s*\n\s*\/\/ Diagnose/.test(serverSrc),
    'kein diagnose-Sonderzweig vor dem Guard mehr',
  );
  const diagnoseBranch = serverSrc.slice(serverSrc.indexOf('const action ='), serverSrc.indexOf('} finally {', serverSrc.indexOf('const action =')));
  check(
    diagnoseBranch.includes("data.mode === 'diagnose'") &&
      diagnoseBranch.includes('tiktok_diagnose') &&
      diagnoseBranch.includes('withGenerationGuard'),
    'Diagnose läuft durch withGenerationGuard und trägt die Aktion tiktok_diagnose',
  );

  // ── 2. A/B-Varianten = 1 Generierung, dieselbe Guard-Kette ─────────────────
  console.log('\n[2] A/B-Varianten zählen 1 Generierung');
  const beforeAb = await qGetUsage(U_AB, period);
  const abRes = await withGenerationGuard(U_AB, async () => 'variants', 'de', {
    action: 'ab_variants',
    detail: 'pinterest_pin',
  });
  const afterAb = await qGetUsage(U_AB, period);
  check(abRes === 'variants', 'A/B-Call ausgeführt');
  check(afterAb === beforeAb + 1, `A/B-Abruf = +1 Generierung (${beforeAb} → ${afterAb})`);
  const variantsSrc = serverSrc.slice(
    serverSrc.indexOf('export const generateVariantsServer'),
    serverSrc.indexOf('export const prioritizeServer'),
  );
  check(
    variantsSrc.includes('withGenerationGuard') && variantsSrc.includes("action: 'ab_variants'"),
    'generateVariantsServer läuft durch withGenerationGuard (Aktion ab_variants)',
  );
  check(
    (variantsSrc.match(/withGenerationGuard\(/g) ?? []).length === 1 &&
      !variantsSrc.includes('recordGeneration'),
    'A/B nutzt genau EINEN zentralen Guard-Aufruf (kein lokales Increment)',
  );
  check(
    /VariantGenerationUnavailable/.test(variantsSrc),
    'A/B kompensiert ein leeres Ergebnis (1 Generierung = 1 fertiges Ergebnis)',
  );

  // ── 3. Kein eigenständiger lokaler Zähler mehr in Anzeige-Pfaden ───────────
  console.log('\n[3] Anzeige = DB (eine Quelle)');
  const usageStatusSrc = src('src/components/UsageStatus.tsx');
  check(
    usageStatusSrc.includes('useServerUsage') && !usageStatusSrc.includes('getSubscriptionStatus()'),
    'UsageStatus (Rest-Anzeige + Limit-Banner) liest die gemeinsame Server-Quelle',
  );
  const usageClientSrc = src('src/lib/usage-client.ts');
  check(
    usageClientSrc.includes('getSubscriptionStatus') && usageClientSrc.includes('hydrateUsageFromServer'),
    'usage-client lädt den Server-Wert und spiegelt ihn in den Client-Store',
  );
  const tiktokPageSrc = src('src/routes/app/tiktok.tsx');
  check(
    !tiktokPageSrc.includes('getRemainingGenerations') && !tiktokPageSrc.includes('canGenerate'),
    'TikTok-Seite hat keinen eigenen/gelokalen Zähler',
  );
  // Banner-Wert == DB-Wert, für jeden der drei Testnutzer
  for (const u of ALL_USERS) {
    const dbCount = await qGetUsage(u, period);
    const info = await getUsageInfo(u);
    check(
      info.used === dbCount && info.remaining === info.limit - dbCount,
      `Anzeige == usage_monthly.count für ${u} (used=${info.used}/db=${dbCount}, remaining=${info.remaining})`,
    );
  }

  // ── 4. Owner-Override unverändert (unbegrenzt, kein Zähler, kein Ledger) ───
  console.log('\n[4] Owner-Override unbegrenzt');
  check(isAdminOverride(OWNER_ID), 'Owner-ID ist Override');
  const ownerBefore = await qGetUsage(OWNER_ID, period);
  const ownerEventsBefore = (await qGetUsageEvents(OWNER_ID, 200)).length;
  const ownerVal = await withGenerationGuard(OWNER_ID, async () => 'owner-ok', 'de', {
    action: 'tiktok_diagnose',
  });
  const ownerAfter = await qGetUsage(OWNER_ID, period);
  const ownerEventsAfter = (await qGetUsageEvents(OWNER_ID, 200)).length;
  check(ownerVal === 'owner-ok', 'Owner-Call läuft durch');
  check(ownerAfter === ownerBefore, `Owner-Zähler unverändert (${ownerBefore} → ${ownerAfter})`);
  check(ownerEventsAfter === ownerEventsBefore, 'Owner schreibt KEIN Usage-Event (kein Zähler)');
  const ownerInfo = await getUsageInfo(OWNER_ID);
  check(ownerInfo.limit === limitForPlan(await qGetPlanTier(OWNER_ID)), 'Owner-Anzeige-Limit = Tarif-Limit');

  // ── 5. Event-Log: jede Zeile ist zuordenbar ────────────────────────────────
  console.log('\n[5] Usage-Event-Ledger');
  const diagEvents = await qGetUsageEvents(U_DIAG, 10);
  check(diagEvents.length === 1, `genau 1 Ledger-Zeile nach 1 Diagnose (${diagEvents.length})`);
  const de0 = diagEvents[0];
  if (de0) {
    check(de0.action === 'tiktok_diagnose', `Aktion = tiktok_diagnose (${de0.action})`);
    check(de0.userId === U_DIAG, 'user_id = Clerk-ID des Verbrauchers');
    check(de0.countAfter === afterDiag, `count_after = Zählerstand nach Increment (${de0.countAfter})`);
    check(de0.limitValue === FREE_LIMIT, `limit_value = Free-Limit (${de0.limitValue})`);
    check(de0.period === period, `period = aktuelle Periode (${de0.period})`);
    check(!!de0.createdAt && !Number.isNaN(Date.parse(de0.createdAt)), `Timestamp vorhanden (${de0.createdAt})`);
  }
  const abEvents = await qGetUsageEvents(U_AB, 10);
  check(
    abEvents.length === 1 && abEvents[0]?.action === 'ab_variants',
    `A/B-Abruf schreibt genau 1 Zeile mit Aktion ab_variants (${abEvents.map((e) => e.action).join(',')})`,
  );
  check(abEvents[0]?.detail === 'pinterest_pin', `detail trägt den Kanal (${abEvents[0]?.detail})`);

  // ── 6. Free-Limit blockt (kein Verbrauch, keine Zeile, kein Call) ──────────
  console.log('\n[6] Free-Limit blockt den 6. Verbrauch');
  for (let i = 0; i < FREE_LIMIT; i++) {
    await recordGeneration(U_LIMIT, 'de', { action: 'generate_content', detail: 'pinterest_pin' });
  }
  const limitUsed = await qGetUsage(U_LIMIT, period);
  check(limitUsed === FREE_LIMIT, `5 Verbräuche → Zähler ${limitUsed}/${FREE_LIMIT}`);
  let ranOnLimit = false;
  let limitErr: unknown = null;
  try {
    await withGenerationGuard(U_LIMIT, async () => { ranOnLimit = true; return 'x'; }, 'de', {
      action: 'tiktok_diagnose',
    });
  } catch (err) {
    limitErr = err;
  }
  check(limitErr instanceof UsageLimitError, 'Diagnose am Limit wirft UsageLimitError (blockiert)');
  check(ranOnLimit === false, 'KI-Call wird am Limit NICHT ausgeführt (fail-closed)');
  check((await qGetUsage(U_LIMIT, period)) === FREE_LIMIT, 'Zähler bleibt am Limit (kein Überziehen)');
  const limitEvents = await qGetUsageEvents(U_LIMIT, 20);
  check(
    limitEvents.length === FREE_LIMIT,
    `Ledger hat genau ${FREE_LIMIT} Zeilen (blockierter 6. Verbrauch schreibt nichts: ${limitEvents.length})`,
  );
  check(
    limitEvents.every((e) => e.action === 'generate_content'),
    'alle Limit-Test-Zeilen tragen die Aktion generate_content',
  );

  // ── 7. Semantik: interne Retries/Scoring/Verbessern bleiben bei 0 ──────────
  console.log('\n[7] Semantik-Abgrenzung (Retries/Scoring/Verbessern = 0)');
  const improveSrc = serverSrc.slice(
    serverSrc.indexOf('export const improveContentServer'),
    serverSrc.indexOf('export const generateVariantsServer'),
  );
  check(
    !improveSrc.includes('withGenerationGuard') && !improveSrc.includes('recordGeneration'),
    'Verbessern (improveContentServer) verbraucht weiterhin 0 Generierungen',
  );
  const scoreSrc = src('src/ai/scoring/index.ts');
  check(
    !scoreSrc.includes('withGenerationGuard') && !scoreSrc.includes('qIncrementUsage'),
    'Scoring-Pipeline verbraucht 0 Generierungen',
  );
  const guardSrc = src('src/lib/usage-guard.ts');
  check(
    /Aufrufe|ACTION/.test(guardSrc) && guardSrc.includes('USAGE_ACTIONS'),
    'zentraler Aktions-Katalog im Usage-Guard vorhanden',
  );

  // ── 8. Cleanup ─────────────────────────────────────────────────────────────
  console.log('\n[8] Cleanup');
  for (const u of ALL_USERS) {
    await sql`DELETE FROM usage_events WHERE user_id = ${u}`;
    await sql`DELETE FROM usage_monthly WHERE user_id=(SELECT id FROM users WHERE clerk_id=${u})`;
    await sql`DELETE FROM generation_throttle WHERE user_id=${u}`;
    await sql`DELETE FROM subscriptions WHERE user_id=(SELECT id FROM users WHERE clerk_id=${u})`;
    await sql`DELETE FROM users WHERE clerk_id=${u}`;
  }
  const leftover = await sql`SELECT COUNT(*) AS n FROM usage_events WHERE user_id LIKE 'fb1-%'`;
  check(Number(leftover[0].n) === 0, `keine Test-Ledger-Zeilen übrig (${leftover[0].n})`);

  console.log(`\n=== fix-block1-usage-test: ${passed} PASS, ${failed} FAIL ===`);
  if (failed > 0) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

void ensureUserRow; // (Import bleibt für künftige Erweiterungen explizit)

main().catch(async (e) => {
  console.error('FATAL', e);
  for (const u of ALL_USERS) {
    try {
      await sql`DELETE FROM usage_events WHERE user_id = ${u}`;
      await sql`DELETE FROM users WHERE clerk_id = ${u}`;
    } catch { /* best effort */ }
  }
  process.exit(1);
});
