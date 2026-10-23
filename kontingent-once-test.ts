// ─────────────────────────────────────────────────────────────────────────────
// Kontingent-Umstellung (Owner-Entscheidung 2026-10-22) — Test-Suite
//   Free = 3 Generierungen EINMALIG pro Nutzer (Periode 'once', kein Reset)
//   Pro  = 200/Monat (Periode 'YYYY-MM', Rollover) — unverändert
//   Nach dem Free-Kontingent ist JEDE KI-Funktion nur mit Abo nutzbar (P3).
//
// Usage (aus der Repo-Wurzel, echte DB):
//   bun --env-file=.env kontingent-once-test.ts
//
// Deckt die Abnahmepunkte (a)–(j) ab: Konstanten, Perioden-Logik (inkl.
// Monatswechsel), atomares Increment + Limit-Deckel (auch 10 parallel),
// Guard-Kompensation/Ledger, getUsageInfo, Pro-Regression, Owner-Override,
// Limit-Meldungen de/en, keine hartkodierte 5 mehr, i18n-Parität.
// Legt synthetische Testnutzer an und räumt sie im finally vollständig ab.
// Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import {
  ADMIN_OVERRIDE_USER_IDS,
  FREE_LIMIT,
  FREE_ONCE_GRANT,
  FREE_ONCE_PERIOD,
  PRO_LIMIT,
  UsageLimitError,
  assertCanGenerate,
  currentPeriod,
  getUsageInfo,
  isAdminOverride,
  limitForPlan,
  recordGeneration,
  releaseGeneration,
  requireUserIdFromServerFn,
  resolveUserIdFromServerFn,
  usageLimitMessage,
  usagePeriodForPlan,
  withGenerationGuard,
} from './src/lib/usage-guard';
import { ensureUserRow, qGetUsage, qIncrementUsage } from './src/db/queries';
import { getDb } from './src/db/index';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';

const RUN = Date.now().toString(36);
const PREFIX = 'once-test-';
const U_FREE = `${PREFIX}${RUN}-free`;
const U_PRO = `${PREFIX}${RUN}-pro`;
const U_OWNER = [...ADMIN_OVERRIDE_USER_IDS][0]!;
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
async function resetUsage(userId: string) {
  await sql`DELETE FROM usage_monthly WHERE user_id=(SELECT id FROM users WHERE clerk_id=${userId})`;
  await sql`DELETE FROM usage_events WHERE user_id=${userId}`;
}
async function eventCount(userId: string): Promise<number> {
  const rows = await sql`SELECT COUNT(*) AS n FROM usage_events WHERE user_id=${userId}`;
  return Number((rows[0] as { n: unknown }).n);
}

async function main() {
  console.log('— kontingent-once-test (Free 3 einmalig / Pro 200 pro Monat) —\n');

  // ═══ (a) Konstanten + limitForPlan ════════════════════════════════════════
  console.log('[a] Konstanten / limitForPlan');
  check(FREE_ONCE_GRANT === 3, `FREE_ONCE_GRANT === 3 (${FREE_ONCE_GRANT})`);
  check(FREE_LIMIT === FREE_ONCE_GRANT, `FREE_LIMIT ist Alias auf FREE_ONCE_GRANT (${FREE_LIMIT})`);
  check(FREE_ONCE_PERIOD === 'once', `FREE_ONCE_PERIOD === "once" (${FREE_ONCE_PERIOD})`);
  check(PRO_LIMIT === 200, `PRO_LIMIT === 200 (${PRO_LIMIT})`);
  check(limitForPlan('free') === 3, `limitForPlan(free) === 3 (${limitForPlan('free')})`);
  check(limitForPlan('pro') === 200, `limitForPlan(pro) === 200 (${limitForPlan('pro')})`);

  // ═══ (b) Perioden-Logik inkl. Monatswechsel ═══════════════════════════════
  console.log('\n[b] usagePeriodForPlan (Free konstant, Pro Rollover)');
  const silvester = new Date(2026, 11, 31, 23, 59, 59);
  const neujahr = new Date(2027, 0, 1, 0, 0, 1);
  const spaeter = new Date(2030, 4, 17, 12, 0, 0);
  check(
    usagePeriodForPlan('free', silvester) === 'once' &&
      usagePeriodForPlan('free', neujahr) === 'once' &&
      usagePeriodForPlan('free', spaeter) === 'once',
    'free → "once" konstant (31.12.2026 / 01.01.2027 / 17.05.2030)',
  );
  check(
    usagePeriodForPlan('pro', silvester) === '2026-12' &&
      usagePeriodForPlan('pro', neujahr) === '2027-01',
    `pro → Rollover 2026-12 → 2027-01 (${usagePeriodForPlan('pro', silvester)} → ${usagePeriodForPlan('pro', neujahr)})`,
  );
  check(usagePeriodForPlan('pro') === currentPeriod(), 'pro → aktueller Monat (Default-Datum)');

  // ═══ (c) Atomares Increment + Limit-Deckel ════════════════════════════════
  console.log('\n[c] qIncrementUsage: 1./2./3. ok, 4. → null; 10 parallel → genau 3');
  await ensureUserRow(U_FREE);
  await resetUsage(U_FREE);
  const n1 = await qIncrementUsage(U_FREE, FREE_ONCE_PERIOD, 3);
  const n2 = await qIncrementUsage(U_FREE, FREE_ONCE_PERIOD, 3);
  const n3 = await qIncrementUsage(U_FREE, FREE_ONCE_PERIOD, 3);
  const n4 = await qIncrementUsage(U_FREE, FREE_ONCE_PERIOD, 3);
  check(n1 === 1 && n2 === 2 && n3 === 3, `Increment 1./2./3. → ${n1}/${n2}/${n3}`);
  check(n4 === null, '4. Increment → null (Limit 3, kein Überziehen)');
  check((await qGetUsage(U_FREE, FREE_ONCE_PERIOD)) === 3, 'Zähler steht bei 3');

  await resetUsage(U_FREE);
  const burst = await Promise.all(
    Array.from({ length: 10 }, () => qIncrementUsage(U_FREE, FREE_ONCE_PERIOD, 3)),
  );
  const burstOk = burst.filter((v) => v !== null).length;
  const burstFinal = await qGetUsage(U_FREE, FREE_ONCE_PERIOD);
  check(
    burstOk === 3 && burstFinal === 3,
    `10 parallele Increments → genau 3 Erfolge (ok=${burstOk}, Zähler=${burstFinal})`,
  );

  // ═══ (d) withGenerationGuard: Fehler = netto 0, Erfolg = 1 Event 'once' ═══
  console.log('\n[d] withGenerationGuard (Kompensation + Ledger)');
  await resetUsage(U_FREE);
  const evBefore = await eventCount(U_FREE);
  let origMsg = '';
  try {
    await withGenerationGuard(U_FREE, async () => { throw new Error('künstlich'); }, 'de');
  } catch (err) {
    origMsg = err instanceof Error ? err.message : String(err);
  }
  check(origMsg === 'künstlich', 'Fehlerfall: Originalfehler wird weitergeworfen');
  check((await qGetUsage(U_FREE, FREE_ONCE_PERIOD)) === 0, 'Fehlerfall: Zähler netto 0 (Kompensation)');
  check((await eventCount(U_FREE)) === evBefore, `Fehlerfall: KEIN usage_events-Eintrag (${evBefore} → ${await eventCount(U_FREE)})`);
  const okVal = await withGenerationGuard(U_FREE, async () => 'fertig', 'de');
  check(okVal === 'fertig', 'Erfolgsfall: Guard gibt Ergebnis durch');
  check((await qGetUsage(U_FREE, FREE_ONCE_PERIOD)) === 1, 'Erfolgsfall: Zähler +1');
  const evRows = await sql`SELECT period, action FROM usage_events WHERE user_id=${U_FREE}`;
  check(
    evRows.length === 1 && String((evRows[0] as { period: unknown }).period) === 'once',
    `Erfolgsfall: genau 1 usage_events-Zeile mit period="once" (n=${evRows.length})`,
  );
  await releaseGeneration(U_FREE);
  check((await qGetUsage(U_FREE, FREE_ONCE_PERIOD)) === 0, 'releaseGeneration → Zähler zurück auf 0');

  // ═══ (e) getUsageInfo (free) ══════════════════════════════════════════════
  console.log('\n[e] getUsageInfo (free)');
  const info0 = await getUsageInfo(U_FREE);
  check(
    info0.limit === 3 && info0.period === 'once' && info0.planTier === 'free' &&
      info0.used === 0 && info0.remaining === 3,
    `frisch → used=${info0.used}, remaining=${info0.remaining}, limit=${info0.limit}, period="${info0.period}"`,
  );
  await recordGeneration(U_FREE, 'de');
  const info1 = await getUsageInfo(U_FREE);
  check(
    info1.used === 1 && info1.remaining === 2 && info1.limit === 3,
    `nach 1 Verbrauch → used=${info1.used}, remaining=${info1.remaining}/3`,
  );
  const blockErr = await expectThrow(
    async () => {
      await recordGeneration(U_FREE, 'de');
      await recordGeneration(U_FREE, 'de');
      await recordGeneration(U_FREE, 'de'); // 4. → blockiert
    },
    'USAGE_LIMIT',
    '4. Verbrauch blockiert',
  );
  if (blockErr instanceof UsageLimitError) {
    check(blockErr.remaining === 0 && blockErr.limit === 3, 'UsageLimitError trägt remaining=0/limit=3');
    check(blockErr.planTier === 'free', 'UsageLimitError trägt planTier=free');
  }
  const infoExhausted = await getUsageInfo(U_FREE);
  check(infoExhausted.remaining === 0, 'erschöpft → remaining=0');
  await expectThrow(() => assertCanGenerate(U_FREE, 'de'), 'USAGE_LIMIT', 'assertCanGenerate bei 0 blockiert (P3-Gate-Basis)');

  // ═══ (f) Pro-Regression: 200/Monat + Monatswechsel ════════════════════════
  console.log('\n[f] Pro-Regression (200/Monat, Rollover)');
  await ensureUserRow(U_PRO);
  await resetUsage(U_PRO);
  await sql`INSERT INTO subscriptions (user_id, plan_tier, status)
            VALUES ((SELECT id FROM users WHERE clerk_id=${U_PRO}), 'pro', 'active')
            ON CONFLICT DO NOTHING`;
  const proInfo = await getUsageInfo(U_PRO);
  check(
    proInfo.planTier === 'pro' && proInfo.limit === 200 && proInfo.period === currentPeriod(),
    `getUsageInfo(pro) → limit=200, period="${proInfo.period}", remaining=${proInfo.remaining}`,
  );
  // Limit-Deckel ohne 200 Roundtrips: Zähler künstlich auf 199 setzen.
  const proUid = String((await sql`SELECT id FROM users WHERE clerk_id=${U_PRO} LIMIT 1`)[0]!.id);
  const pNow = usagePeriodForPlan('pro');
  await sql`INSERT INTO usage_monthly (user_id, period, count) VALUES (${proUid}, ${pNow}, 199)
            ON CONFLICT (user_id, period) DO UPDATE SET count = 199`;
  const lastOk = await qIncrementUsage(U_PRO, pNow, 200);
  const overLimit = await qIncrementUsage(U_PRO, pNow, 200);
  check(lastOk === 200 && overLimit === null, `Pro: 200. ok (${lastOk}), 201. blockiert (${overLimit})`);
  // Monatswechsel: eine neue Periode startet bei 0 (Rollover).
  const nextMonth = '2099-01';
  const rollover = await qIncrementUsage(U_PRO, nextMonth, 200);
  check(
    rollover === 1 && (await qGetUsage(U_PRO, pNow)) === 200,
    `Pro-Monatswechsel: neue Periode startet bei 1, alter Monat bleibt 200 (${rollover})`,
  );
  await sql`DELETE FROM usage_monthly WHERE user_id=${proUid} AND period=${nextMonth}`;

  // ═══ (g) Owner-Override: kein Increment, kein Event, kein Banner ══════════
  console.log('\n[g] Owner-Override (unbegrenzt, unsichtbar)');
  check(isAdminOverride(U_OWNER), `isAdminOverride(Owner) === true (${U_OWNER})`);
  const ownerInfo = await getUsageInfo(U_OWNER);
  // Bewusst KEIN Override in der Anzeige: getUsageInfo liefert den normalen
  // Tarif-Wert, und UsageStatus rendert für den Owner gar nichts (siehe unten).
  // Der Override wirkt ausschließlich in der Sperre (assertCanGenerate /
  // recordGeneration / withGenerationGuard) — so bleibt die Ausnahme unsichtbar.
  check(
    ownerInfo.limit !== Number.MAX_SAFE_INTEGER,
    `getUsageInfo(Owner) OHNE Override (limit=${ownerInfo.limit}, period="${ownerInfo.period}") — Anzeige bleibt normal, Override nur in der Sperre`,
  );
  const ownerEvBefore = await eventCount(U_OWNER);
  const ownerRec = await recordGeneration(U_OWNER, 'de');
  check(
    ownerRec.used === 0 && ownerRec.limit === Number.MAX_SAFE_INTEGER,
    `recordGeneration(Owner) → used=0, limit=MAX (${ownerRec.used}/${ownerRec.limit})`,
  );
  check((await eventCount(U_OWNER)) === ownerEvBefore, `Owner: KEIN usage_events-Eintrag (${ownerEvBefore})`);
  const ownerGen = await assertCanGenerate(U_OWNER, 'de');
  check(ownerGen.ok === true && ownerGen.remaining === Number.MAX_SAFE_INTEGER, 'Owner: assertCanGenerate immer ok');
  // „kein Banner": UsageStatus rendert für Owner null (UI-Vertrag im Quelltext).
  const statusSrc = readFileSync('src/components/UsageStatus.tsx', 'utf8');
  check(
    statusSrc.includes('if (!userId || isOwner) return null;'),
    'UsageStatus: Owner sieht KEIN Banner (frühe Rückkehr im Code)',
  );

  // ═══ (h) usageLimitMessage de/en ohne „monatlich" für Free ════════════════
  console.log('\n[h] usageLimitMessage (de/en)');
  const deFree = usageLimitMessage('de', 'free', 3);
  const enFree = usageLimitMessage('en', 'free', 3);
  check(!/monatlich/i.test(deFree), `de/free ohne "monatlich": "${deFree}"`);
  check(!/monthly/i.test(enFree), `en/free ohne "monthly": "${enFree}"`);
  check(deFree.includes('aufgebraucht') && deFree.includes('Abo'), 'de/free nennt aufgebraucht + Abo');
  check(enFree.includes('used up') && enFree.includes('subscription'), 'en/free nennt used up + subscription');
  check(deFree.includes('3') && enFree.includes('3'), 'beide Meldungen nennen die 3');
  const dePro = usageLimitMessage('de', 'pro', 200);
  const enPro = usageLimitMessage('en', 'pro', 200);
  check(/monatlich/i.test(dePro), `de/pro bleibt monatlich: "${dePro}"`);
  check(/monthly/i.test(enPro), `en/pro bleibt monthly: "${enPro}"`);

  // ═══ (i) Keine hartkodierte Free-5 mehr ═══════════════════════════════════
  console.log('\n[i] Grep: keine hartkodierte 5 (queries/store/new-project)');
  const queriesSrc = readFileSync('src/db/queries.ts', 'utf8');
  const storeSrc = readFileSync('src/store/subscriptions.ts', 'utf8');
  const npSrc = readFileSync('src/routes/app/new-project.tsx', 'utf8');
  check(!/200\s*:\s*5/.test(queriesSrc), 'queries.ts: kein "200 : 5" mehr');
  check(
    /export async function qGetRemaining\(\s*userId: string,\s*period: string,\s*limit: number,?\s*\)/.test(queriesSrc),
    'queries.ts: qGetRemaining(userId, period, limit) — Limit kommt vom Aufrufer',
  );
  check(!/import .*usage-guard/.test(queriesSrc), 'queries.ts: kein Import von usage-guard (kein Zyklus)');
  check(/if \(tier === 'pro'\) return 200;\s*\n\s*return 3;/.test(storeSrc), 'subscriptions.ts: Free-Limit = 3');
  check(npSrc.includes('const FREE_LIMIT_FALLBACK = 3;'), 'new-project.tsx: FREE_LIMIT_FALLBACK = 3');
  check(!npSrc.includes('FREE_LIMIT_FALLBACK = 5'), 'new-project.tsx: keine 5 mehr als Fallback');
  check(
    npSrc.includes('isQuotaExhaustedMessage') && npSrc.includes('quota_subscription_required'),
    'new-project.tsx: R4-Hinweis (Kontingent erschöpft → Abo) ist verdrahtet',
  );

  // ═══ (j) i18n-Parität + Free-Wording ══════════════════════════════════════
  console.log('\n[j] i18n-Parität de/en');
  const deKeys = Object.keys(de).sort();
  const enKeys = Object.keys(en).sort();
  check(deKeys.length === enKeys.length, `gleiche Anzahl Keys (de=${deKeys.length}, en=${enKeys.length})`);
  const missing = deKeys.filter((k) => !(k in en));
  const extra = enKeys.filter((k) => !(k in de));
  check(missing.length === 0 && extra.length === 0, `identische Key-Mengen (fehlt=${missing.length}, extra=${extra.length})`);
  const t = (o: Record<string, unknown>, k: string) => String(o[k] ?? '');
  check(
    t(de, 'usage_banner_title_free').length > 0 && t(en, 'usage_banner_title_free').length > 0,
    'usage_banner_title_free in de+en vorhanden',
  );
  check(
    t(de, 'usage_remaining_free_plural').includes('kostenlosen') &&
      t(en, 'usage_remaining_free_plural').includes('free generations'),
    'Free-Rest-Anzeige: "X von 3 kostenlosen Generierungen" (de/en)',
  );
  check(
    !/monatlich/i.test(t(de, 'usage_limit_exhausted')) && !/monthly/i.test(t(en, 'usage_limit_exhausted')),
    'usage_limit_exhausted ohne Monatsbezug (de/en)',
  );
  check(
    !/monatlich/i.test(t(de, 'usage_banner_free')) && !/monthly/i.test(t(en, 'usage_banner_free')),
    'usage_banner_free ohne Monatsbezug (de/en)',
  );
  check(
    t(de, 'quota_subscription_required').includes('Abo') && t(en, 'quota_subscription_required').includes('subscription'),
    'R4-String (quota_subscription_required) in de+en',
  );
  const landing5 = ['landing_pricing_free_features', 'landing_faq_a2', 'cta_banner_benefit1', 'faq_a5', 'beta_benefit1_text', 'billing_free_desc'];
  const stillFive = landing5.filter((k) => /5 Generierungen|5 generations|5\/Monat|5\/month/.test(t(de, k) + ' ' + t(en, k)));
  check(stillFive.length === 0, `Landing/Pricing/FAQ ohne "5 Generierungen" (Treffer: ${stillFive.join(',') || 'keine'})`);
  check(!/unbegrenzte|unlimited/i.test(t(de, 'usage_limit_alert') + ' ' + t(en, 'usage_limit_alert')), 'usage_limit_alert ohne falsches "unbegrenzt/unlimited"');

  // ═══ (k) P3-Härtung: 0-Einheiten-Pfade fail-closed ═══════════════════════
  // Owner-Entscheidung 2026-10-22 (P3): „Nach den 3 Gratisgenerierungen sind
  // ALLE KI-Funktionen nur mit Abo nutzbar." Die 5 0-Einheiten-Pfade
  // (Verbessern / Auto-Verbessern / Bereichs-Verbessern / Priorisieren) dürfen
  // deshalb NICHTS mehr schlucken: kein Gratis-KI-Call ohne gültige Sitzung.
  console.log('\n[k] P3-Härtung: kein schluckender catch in den 5 0-Einheiten-Pfaden');
  const serverSrc = readFileSync('src/ai/server.ts', 'utf8');
  const alteMarker = ['ohne Sitzung: weiter', 'ohne Sitzung unverändert', 'kein harter Guard'];
  const alteTreffer = alteMarker.filter((m) => serverSrc.includes(m));
  check(
    alteTreffer.length === 0,
    `kein alter Schluck-Marker mehr in server.ts (Treffer: ${alteTreffer.join(' | ') || 'keine'})`,
  );
  const failClosedCount = (serverSrc.match(/FAIL-CLOSED/g) ?? []).length;
  check(failClosedCount >= 5, `Marker "FAIL-CLOSED" mind. 5× vorhanden (${failClosedCount}×)`);

  // Struktur je Pfad: FAIL-CLOSED dokumentiert, guardUserId() direkt awaited,
  // KEIN catch und kein alter Schluck-Kommentar im Pfad-Block.
  const nullEinheitenPfade = [
    'improveContentServer',
    'improveByScoreServer',
    'improveToScoreServer',
    'autoImproveSectionServer',
    'prioritizeServer',
  ];
  const pfadProbleme: string[] = [];
  for (const name of nullEinheitenPfade) {
    const start = serverSrc.indexOf(`export const ${name} = createServerFn`);
    if (start < 0) {
      pfadProbleme.push(`${name}: nicht gefunden`);
      continue;
    }
    const nextExport = serverSrc.indexOf('\nexport const ', start + 1);
    const block = serverSrc.slice(start, nextExport > 0 ? nextExport : serverSrc.length);
    const probleme: string[] = [];
    if (!block.includes('FAIL-CLOSED')) probleme.push('FAIL-CLOSED fehlt');
    if (!block.includes('await guardUserId()')) probleme.push('guardUserId() fehlt');
    if (/catch\s*\(/.test(block)) probleme.push('catch vorhanden');
    if (block.includes('/* ohne Sitzung')) probleme.push('alter Schluck-Kommentar');
    if (probleme.length > 0) pfadProbleme.push(`${name}: ${probleme.join(', ')}`);
  }
  check(pfadProbleme.length === 0, `5/5 Pfade fail-closed strukturiert (${pfadProbleme.join(' | ') || 'alle ok'})`);

  // Runtime-Beweis auf GUARD-Ebene (ohne Start-Compiler): ohne gültige Sitzung
  // wirft das Gate, statt still durchzulaufen. `requireUserIdFromServerFn` ist
  // exakt das, was `guardUserId()` in server.ts aufruft.
  const ohneSitzung = await resolveUserIdFromServerFn();
  check(ohneSitzung === null, `resolveUserIdFromServerFn() ohne Request/Session → null (${String(ohneSitzung)})`);
  const guardErr = await (async () => {
    try {
      await requireUserIdFromServerFn();
      return null;
    } catch (e) {
      return e;
    }
  })();
  check(
    guardErr instanceof Error && /Keine gültige Sitzung/.test(guardErr.message),
    `requireUserIdFromServerFn() ohne uid → Fehler "Keine gültige Sitzung" (${guardErr instanceof Error ? guardErr.message : 'KEIN Fehler — geschluckt!'})`,
  );
  check(
    !(guardErr instanceof UsageLimitError),
    'Session-Fehler ist KEIN UsageLimitError (getrennt vom Kontingent-Fehler, wird nicht als Verbrauch verbucht)',
  );
  const adminPayload = [...ADMIN_OVERRIDE_USER_IDS][0]!;
  const adminErr = await (async () => {
    try {
      await requireUserIdFromServerFn(adminPayload);
      return null;
    } catch (e) {
      return e;
    }
  })();
  check(
    adminErr instanceof Error,
    `Owner-ID aus dem Payload wird verworfen → fail-closed (${adminErr instanceof Error ? 'wirft' : 'KEIN Fehler!'})`,
  );
  const normalUid = await requireUserIdFromServerFn(U_FREE);
  check(
    normalUid === U_FREE,
    'Positivkontrolle: normaler Payload-Fallback liefert die uid (Gate wirft nicht pauschal)',
  );

  console.log(`\n=== kontingent-once-test: ${passed} PASS, ${failed} FAIL ===`);
  console.log(`i18n: de=${deKeys.length} Keys, en=${enKeys.length} Keys`);
  if (failed > 0) console.log('Failures:', failures.join(' | '));
}

async function cleanup() {
  await sql`DELETE FROM usage_events WHERE user_id LIKE 'once-test-%'`;
  await sql`DELETE FROM usage_monthly WHERE user_id IN (SELECT id FROM users WHERE clerk_id LIKE 'once-test-%')`;
  await sql`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE clerk_id LIKE 'once-test-%')`;
  await sql`DELETE FROM generation_throttle WHERE user_id LIKE 'once-test-%'`;
  await sql`DELETE FROM users WHERE clerk_id LIKE 'once-test-%'`;
  const left = await sql`SELECT COUNT(*) AS n FROM users WHERE clerk_id LIKE 'once-test-%'`;
  const leftEvents = await sql`SELECT COUNT(*) AS n FROM usage_events WHERE user_id LIKE 'once-test-%'`;
  console.log(
    `\n[cleanup] users-Reste=${Number((left[0] as { n: unknown }).n)}, usage_events-Reste=${Number((leftEvents[0] as { n: unknown }).n)}`,
  );
}

main()
  .then(async () => {
    await cleanup();
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(async (e) => {
    console.error('FATAL', e);
    await cleanup().catch(() => {});
    process.exit(1);
  });
