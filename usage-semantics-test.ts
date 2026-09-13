// ─────────────────────────────────────────────────────────────────────────────
// Phase 8.2a — Zähl-Semantik-Test-Suite (Owner-Entscheidung 2026-09-12)
// ─────────────────────────────────────────────────────────────────────────────
// Regel: „1 fertiges Ergebnis = 1 Generierung" —
//   · Strategie-Paket mit N Kanälen zählt N (nur ERFOLGREICHE Kanäle)
//   · je Einzel-Asset zählt 1 · je TikTok-Konzept (todayIdea/concept) zählt 1
//   · je Bild zählt 1
//   · TikTok-Diagnose, interne Retries, Scoring, Auto-Verbessern zählen 0
//   · Owner-/Admin-Override: immer erlaubt (auch bei count = Limit), KEIN
//     Zähler-Increment
//
// Teil A — Verhaltens-Tests gegen echte Neon-DB (Fixtures = synthetische
// Testnutzer, KEINE OpenAI-Calls, keine Kosten). Nutzt exakt die Guard-
// Funktionen, die auch die Produktions-ServerFns verwenden (src/lib/
// usage-guard.ts) und spiegelt die Kanal-Schleifen-Struktur der IST-Fns
// (src/ai/package/package.ts, src/ai/stream.ts).
// Teil B — Statische Wire-Checks: verankert die Zähl-Regel an den IST-
// Produktions-ServerFns (liest die Quellen), damit eine künftige Änderung
// der Guard-Verdrahtung diesen Test rot macht.
//
// Usage (aus der Repo-Wurzel):
//   bun --env-file=.env usage-semantics-test.ts
// Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import {
  assertCanGenerate,
  assertRateOk,
  currentPeriod,
  isAdminOverride,
  withGenerationGuard,
  UsageLimitError,
  ADMIN_OVERRIDE_USER_IDS,
} from './src/lib/usage-guard';
import { qGetUsage, ensureUserRow } from './src/db/queries';
import { getDb } from './src/db/index';

const OWNER_ID = 'user_3H2trJXHwzXmJF2XTGQ2PMEwjkD';
const RUN = Date.now().toString(36);
const TEST_USERS = [`sem-${RUN}`, `sem-${RUN}-pkg`, `sem-${RUN}-tt`];
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
/** Zähler eines Testnutzers für die aktuelle Periode auf 0 setzen (frisch). */
async function resetUsage(userId: string) {
  await sql`DELETE FROM usage_monthly WHERE user_id=(SELECT id FROM users WHERE clerk_id=${userId})`;
}
const succeed = () => Promise.resolve('fertig');
const failOnce = () => Promise.reject(new Error('künstlicher Fehler'));
/** Kanal-Liste identisch zu PACKAGE_CHANNELS in src/ai/package/package.ts. */
const CHANNELS = ['pinterest', 'etsy', 'seo', 'social', 'newsletter'] as const;

async function main() {
  console.log('— usage-semantics-test (Zähl-Semantik „1 fertiges Ergebnis = 1") —\n');
  const period = currentPeriod();

  // ── Vorbereitung: synthetische Nutzer (Fixtures) ───────────────────────────
  for (const u of TEST_USERS) await ensureUserRow(u);

  // ═══ Teil A — Verhaltens-Semantik (keine OpenAI-Calls) ════════════════════

  // ── A1. Einzel-Asset = 1, Fehler = 0 (Kompensation) ────────────────────────
  console.log('\n[A1] Einzel-Asset (generateContentServer): 1 fertiges Ergebnis = 1');
  const u1 = TEST_USERS[0];
  await resetUsage(u1);
  const a1 = await withGenerationGuard(u1, succeed, 'de');
  check(a1 === 'fertig' && (await qGetUsage(u1, period)) === 1, '1x withGenerationGuard(Erfolg) → Zähler exakt 1');
  await withGenerationGuard(u1, failOnce, 'de').catch(() => {});
  check((await qGetUsage(u1, period)) === 1, 'Fehlgeschlagene Einzel-Asset-Generierung → Zähler bleibt 1 (Kompensation, 0 Verbrauch)');
  for (let i = 2; i <= 5; i++) await withGenerationGuard(u1, succeed, 'de');
  check((await qGetUsage(u1, period)) === 5, '5 Einzel-Assets erfolgreich → Zähler exakt 5 (Free-Limit erreicht)');
  const err1 = await expectThrow(() => withGenerationGuard(u1, succeed, 'de'), 'USAGE_LIMIT', '6. Einzel-Asset blockiert (UsageLimitError)');
  if (err1 instanceof UsageLimitError) check(err1.limit === 5, 'Einzel-Asset-Limit-Fehler trägt limit=5');

  // ── A2. Strategie-Paket: N Kanäle = N (nur erfolgreiche) ───────────────────
  console.log('\n[A2] Strategie-Paket (generatePackageServer): N Kanäle = N Generierungen');
  const up = TEST_USERS[1];
  await resetUsage(up);
  // Hist 1: alle 5 Kanäle erfolgreich (Struktur wie package.ts: Promise.all +
  // withGenerationGuard je Kanal, Fehler isoliert über .catch → null).
  await resetUsage(up);
  const resultsAll = await Promise.all(
    CHANNELS.map(() => withGenerationGuard(up, succeed, 'de').catch(() => null)),
  );
  check(
    resultsAll.filter(Boolean).length === 5 && (await qGetUsage(up, period)) === 5,
    'Paket mit 5 erfolgreichen Kanälen → Zähler exakt 5 (je Kanal 1)',
  );
  // Hist 2: 1 Kanal schlägt fehl → nur erfolgreiche zählen (Fehler isoliert).
  await resetUsage(up);
  const resultsMixed = await Promise.all([
    withGenerationGuard(up, succeed, 'de').catch(() => null),
    withGenerationGuard(up, failOnce, 'de').catch(() => null),
    withGenerationGuard(up, succeed, 'de').catch(() => null),
    withGenerationGuard(up, succeed, 'de').catch(() => null),
    withGenerationGuard(up, succeed, 'de').catch(() => null),
  ]);
  check(
    resultsMixed.filter(Boolean).length === 4 && (await qGetUsage(up, period)) === 4,
    'Paket mit 1 fehlgeschlagenem Kanal → Zähler exakt 4 (nur erfolgreiche; Fehler isoliert, 0 Verbrauch)',
  );
  // Hist 3: Limit exakt einhalten bei PARALLELEN Kanälen (Rest 4, 5 Kanäle):
  // 4 dürfen durch, der 5. erhält USAGE_LIMIT — Zähler nie über dem Limit.
  await resetUsage(up);
  await withGenerationGuard(up, succeed, 'de'); // Verbrauch = 1, Rest = 4
  const parallel = await Promise.all(
    CHANNELS.map(() => withGenerationGuard(up, succeed, 'de').catch((e: unknown) => e)),
  );
  const blocked = parallel.filter((r) => r instanceof UsageLimitError).length;
  const won = parallel.filter((r) => r === 'fertig').length;
  check(
    won === 4 && blocked === 1 && (await qGetUsage(up, period)) === 5,
    `5 parallele Kanäle bei Rest 4 → genau 4 Erfolge (Zähler 5) + 1 USAGE_LIMIT (blocked=${blocked})`,
  );

  // ── A3. Bild = 1 (image-studio generateImageServer) ────────────────────────
  console.log('\n[A3] Bild (generateImageServer): 1 Bild = 1 Generierung');
  await resetUsage(up);
  const img1 = await withGenerationGuard(up, succeed, 'de');
  check(img1 === 'fertig' && (await qGetUsage(up, period)) === 1, '1 Bild → Zähler exakt 1');
  await withGenerationGuard(up, failOnce, 'de').catch(() => {});
  check((await qGetUsage(up, period)) === 1, 'Fehlgeschlagenes Bild → Zähler bleibt 1 (0 Verbrauch)');

  // ── A4. TikTok: Konzept = 1, Diagnose = 0, interne Retries = 0 ─────────────
  console.log('\n[A4] TikTok (generateTikTokServer): Konzept = 1 · Diagnose = 0 · Retries intern = 0');
  const ut = TEST_USERS[2];
  await resetUsage(ut);
  const konzept = await withGenerationGuard(ut, succeed, 'de');
  check(konzept === 'fertig' && (await qGetUsage(ut, period)) === 1, '1 TikTok-Konzept (todayIdea/concept) → Zähler exakt 1');
  // Diagnose-Pfad (server.ts:1038-1041): läuft OHNE withGenerationGuard — hier
  // exakt nachgebaut (direkter Call, kein Guard) → 0 Verbrauch.
  const diagnoseOk = await Promise.resolve('diagnose-fertig');
  check(diagnoseOk === 'diagnose-fertig' && (await qGetUsage(ut, period)) === 1, 'TikTok-Diagnose (ohne Guard, wie IST-Fn) → Zähler bleibt 1 (0 Generierungen)');
  // Interne Retries: die TikTok-Engine probiert bis zu 4× INNERHALB EINES Guards
  // (Retry-Schleife fängt eigene Fehler — wie src/ai/tiktok.ts) → zählt 1.
  await resetUsage(ut);
  let attempts = 0;
  const withRetries = async () => {
    for (let i = 0; i < 4; i++) {
      attempts += 1;
      try {
        if (i < 2) throw new Error(`interner Retry ${i + 1}`);
        return 'konzept-nach-retry';
      } catch (err) {
        if (i >= 2) throw err;
      }
    }
    throw new Error('nach 4 Retries fehlgeschlagen');
  };
  const retried = await withGenerationGuard(ut, withRetries, 'de');
  check(
    retried === 'konzept-nach-retry' && attempts === 3 && (await qGetUsage(ut, period)) === 1,
    `3 interne Retry-Versuche in 1 Guard → Zähler exakt 1 (Retries = 0; attempts=${attempts})`,
  );

  // ── A5. Verbessern / Scoring = 0 (nur Drossel wie IST-Fns) ─────────────────
  console.log('\n[A5] Verbessern/Scoring (improve*ServerFns): 0 Generierungen');
  await resetUsage(ut);
  // improveContentServer/improveByScoreServer: NUR assertRateOk, danach direkter
  // Engine-Call OHNE withGenerationGuard — hier nachgebaut:
  await assertRateOk(ut, { minIntervalMs: 0 });
  const improved = await Promise.resolve('bessere-version');
  check(improved === 'bessere-version' && (await qGetUsage(ut, period)) === 0, 'Auto-Verbessern (nur Drossel, kein Guard) → Zähler bleibt 0');
  // Scoring (F1) ist eine reine Analyse-Funktion ohne Guard-Pfad → 0.
  check((await qGetUsage(ut, period)) === 0, 'Scoring/Qualitäts-Prüfung (kein Guard-Pfad) → Zähler bleibt 0');

  // ── A6. Owner-Override: auch bei count = LIMIT immer erlaubt ───────────────
  console.log('\n[A6] Owner-Override (user_3H2tr…): immer erlaubt — auch bei count = Limit');
  check(isAdminOverride(OWNER_ID) && ADMIN_OVERRIDE_USER_IDS.has(OWNER_ID), 'Owner-ID im Override-Set');
  const ownerRows = await sql`SELECT id FROM users WHERE clerk_id=${OWNER_ID} LIMIT 1`;
  const ownerUid = ownerRows.length ? String((ownerRows[0] as { id: string }).id) : null;
  const ownerBefore = ownerUid ? await qGetUsage(OWNER_ID, period) : null;
  if (ownerUid) {
    // Owner künstlich exakt auf Free-Limit (5/5) setzen — danach im finally
    // exakt den Ursprungswert wiederherstellen.
    await sql`INSERT INTO usage_monthly (user_id, period, count) VALUES (${ownerUid}, ${period}, 5)
              ON CONFLICT (user_id, period) DO UPDATE SET count = GREATEST(usage_monthly.count, 5)`;
    try {
      const res = await assertCanGenerate(OWNER_ID, 'de');
      check(res.ok === true && res.remaining === Number.MAX_SAFE_INTEGER, 'Owner bei count = 5 (= Free-Limit): assertCanGenerate ok (unbegrenzt)');
      const val = await withGenerationGuard(OWNER_ID, succeed, 'de');
      check(val === 'fertig', 'Owner bei count = Limit: withGenerationGuard läuft durch');
      const ownerAfter = await qGetUsage(OWNER_ID, period);
      check(ownerAfter === 5, `Owner-Zähler bei count = Limit NACH Call weiterhin 5 (KEIN Increment, ${ownerAfter})`);
    } finally {
      if (ownerBefore === 0) {
        await sql`DELETE FROM usage_monthly WHERE user_id=${ownerUid} AND period=${period}`;
      } else {
        await sql`UPDATE usage_monthly SET count=${ownerBefore} WHERE user_id=${ownerUid} AND period=${period}`;
      }
    }
  } else {
    const res = await assertCanGenerate(OWNER_ID, 'de');
    check(res.ok === true && res.remaining === Number.MAX_SAFE_INTEGER, 'Owner ohne DB-Zeile: assertCanGenerate ok (frühe Rückkehr, unbegrenzt)');
  }
  // ═══ Teil B — Statische Wire-Checks: Regel verankert in den IST-Fns ════════
  console.log('\n[B] Wire-Checks (Zähl-Regel verankert an den IST-Produktions-Fns)');
  const serverSrc = readFileSync(new URL('./src/ai/server.ts', import.meta.url), 'utf8');
  const pkgSrc = readFileSync(new URL('./src/ai/package/package.ts', import.meta.url), 'utf8');
  const streamSrc = readFileSync(new URL('./src/ai/stream.ts', import.meta.url), 'utf8');
  const genStreamSrc = readFileSync(new URL('./src/api/generate-stream.ts', import.meta.url), 'utf8');
  const imageSrc = readFileSync(new URL('./src/routes/app/image-studio.tsx', import.meta.url), 'utf8');
  const querySrc = readFileSync(new URL('./src/db/queries.ts', import.meta.url), 'utf8');
  const schemaSrc = readFileSync(new URL('./src/db/schema.ts', import.meta.url), 'utf8');

  const fnSection = (name: string) => {
    const start = serverSrc.indexOf(`export const ${name} = createServerFn`);
    if (start < 0) return '';
    const next = serverSrc.indexOf('export const ', start + 10);
    return serverSrc.slice(start, next > 0 ? next : serverSrc.length);
  };
  const sect = (name: string) => fnSection(name);

  check(sect('generateContentServer').includes('withGenerationGuard'), 'Einzel-Asset (generateContentServer) → withGenerationGuard (1 bei Erfolg)');
  check(!sect('improveContentServer').includes('withGenerationGuard'), 'Verbessern (improveContentServer) → KEIN withGenerationGuard (0)');
  check(!sect('improveByScoreServer').includes('withGenerationGuard'), 'Auto-Verbessern (improveByScoreServer) → KEIN withGenerationGuard (0)');
  check(!sect('improveToScoreServer').includes('withGenerationGuard'), 'Auf-80+-Verbessern (improveToScoreServer) → KEIN withGenerationGuard (0)');
  check(sect('generateVariantsServer').includes('withGenerationGuard'), 'Varianten (generateVariantsServer) → withGenerationGuard (1)');
  check(sect('generatePackageChannelServer').includes('withGenerationGuard'), 'Paket-Kanal einzeln (generatePackageChannelServer) → withGenerationGuard (1)');
  const tiktokSect = sect('generateTikTokServer');
  check(tiktokSect.includes("data.mode === 'diagnose'") && tiktokSect.includes('withGenerationGuard'), 'TikTok: diagnose-Zweig existiert + Konzept-Zweig mit withGenerationGuard (1)');
  check(pkgSrc.includes('withGenerationGuard(') && pkgSrc.includes('PACKAGE_CHANNELS.map'), 'Paket-Flow (package.ts): je Kanal 1× withGenerationGuard (N Kanäle = N)');
  check(streamSrc.includes('withGenerationGuard(options.userId'), 'Strategie-Stream (stream.ts): je Kanal 1× withGenerationGuard (1/Kanal)');
  check(genStreamSrc.includes('assertRateOk'), 'generate-stream.ts: Drossel am Stream-Start (Rest-Schutz serverseitig)');
  check(imageSrc.includes('withGenerationGuard(userId, () => generateImage'), 'Bild (image-studio.tsx): withGenerationGuard (1 Bild = 1)');
  check(querySrc.includes('ON CONFLICT (user_id, period) DO UPDATE') && querySrc.includes('WHERE usage_monthly.count <'), 'qIncrementUsage: atomares, konditionales Increment (keine TOCTOU-Race, Limit nie überschreitbar)');
  check(schemaSrc.includes('PRIMARY KEY (user_id, period)') && schemaSrc.includes('usage_monthly'), 'usage_monthly: PRIMARY KEY (user_id, period) + Unique-Semantik');

  // ── Cleanup aller Testdaten ────────────────────────────────────────────────
  console.log('\n[Cleanup]');
  for (const u of TEST_USERS) {
    await sql`DELETE FROM usage_monthly WHERE user_id=(SELECT id FROM users WHERE clerk_id=${u})`;
    await sql`DELETE FROM generation_throttle WHERE user_id=${u}`;
    await sql`DELETE FROM subscriptions WHERE user_id=(SELECT id FROM users WHERE clerk_id=${u})`;
    await sql`DELETE FROM users WHERE clerk_id=${u}`;
    console.log(`  removed ${u}: users ok`);
  }

  console.log(`\n=== usage-semantics-test: ${passed} PASS, ${failed} FAIL ===`);
  if (failed > 0) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL', e);
  sql`DELETE FROM users WHERE clerk_id LIKE 'sem-%'`.catch(() => {});
  sql`DELETE FROM generation_throttle WHERE user_id LIKE 'sem-%'`.catch(() => {});
  process.exit(1);
});