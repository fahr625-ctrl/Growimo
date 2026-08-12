// ── F9 Server-side verification: Performance-Feedback-Loop ──────────────────
// Run: bun --env-file=.env run f9-test.ts
//
// ECHTE DB: legt einen dedizierten Test-Nutzer + Test-Projekt mit 5
// Pinterest-Pins an (3 mit Zahl+CTA im Titel → hohe Saves, 2 ohne → niedrige
// Saves) und loggt 5 Performance-Einträge. Danach:
//   (a) getPerformanceOverview (buildPerformanceOverview) →
//       assert: Erfolgsfaktor mit echter Zahl (Stichprobe ≥ 3, ≥ 20 % relativer
//       Unterschied), Trend berechnet, Vorschlag nicht leer, dataSufficiency.
//   (b) buildPerformanceContext → assert: enthält den Faktor; wird in den
//       generate-additionalContext eingebaut (Paket-Naht, gleiche Array-Logik
//       wie src/ai/package/generate.ts).
//   (c) Persistenz-Roundtrip: qLogPerformance (Upsert) → Re-Read → Update →
//       Re-Read.
// Aufräumen: Test-Nutzer + Projekt werden am Ende gelöscht (Cascade).
// Writes f9-test-evidence.txt and exits 0 when every check passed.
import { writeFileSync } from 'node:fs';
import { getDb } from './src/db/index';
import { initDb } from './src/db/init';
import { ensureUserRow, qLogPerformance, qGetPerformanceEntries } from './src/db/queries';
import { buildPerformanceOverview } from './src/ai/performance';
import { buildPerformanceContext } from './src/ai/performance/context';
import { kernelContext } from './src/ai/package/generate';
import type { MarketingKernel } from './src/ai/package/kernel';

const EVIDENCE = 'f9-test-evidence.txt';
const evidence: string[] = [];
const TEST_CLERK = 'f9-test-user';
const TEST_EMAIL = 'f9-test@growimo.local';

function fail(msg: string): never {
  evidence.push(`\n❌ FAIL: ${msg}`);
  writeFileSync(EVIDENCE, evidence.join('\n'));
  throw new Error('F9-FAIL: ' + msg);
}
function note(msg: string): void {
  evidence.push(msg);
  console.log('  ' + msg);
}

function daysAgoIso(days: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function main(): Promise<void> {
  await initDb();
  const sql = getDb();
  evidence.push(`F9 TEST-EVIDENCE — ${new Date().toISOString()}`);

  // Alte Test-Reste entfernen (frühere Läufe können abgebrochen sein)
  await sql`DELETE FROM users WHERE clerk_id = ${TEST_CLERK}`;

  // ── Test-Nutzer + Test-Projekt + 5 Pins anlegen ────────────────────────────
  const userId = await ensureUserRow(TEST_CLERK, TEST_EMAIL, 'F9 Test User');
  note(`Test-Nutzer: ${userId.slice(0, 8)}… (clerk ${TEST_CLERK})`);

  const projRows = await sql`
    INSERT INTO projects (user_id, title, product_idea, content_types, status)
    VALUES (${userId}, 'F9-Test: Performance-Loop', 'Test-Produkt für den Performance-Feedback-Loop', '["pinterest_pin"]', 'completed')
    RETURNING id
  `;
  const projectId = String(projRows[0].id);

  const pins: Array<{ title: string; body: string; impressions: number; saves: number; clicks: number; daysAgo: number }> = [
    { title: '10 Weihnachtsgeschenke für 2026 – Jetzt entdecken', body: '1. Hook\nGeschenke finden.\n2. Details\nMehr Inhalt.', impressions: 10000, saves: 600, clicks: 150, daysAgo: 3 },
    { title: '7 Tipps für mehr Saves – Jetzt ansehen', body: '1. Hook\nSaves steigern.\n2. Details\nMehr Inhalt.', impressions: 8000, saves: 480, clicks: 120, daysAgo: 6 },
    { title: '5 Ideen zum Ausprobieren – Jetzt kaufen', body: '1. Hook\nIdeen ausprobieren.\n2. Details\nMehr Inhalt.', impressions: 5000, saves: 300, clicks: 75, daysAgo: 9 },
    { title: 'Geschenkideen für die Familie', body: '1. Hook\nFamilienideen.\n2. Details\nMehr Inhalt.', impressions: 10000, saves: 100, clicks: 30, daysAgo: 12 },
    { title: 'Meine schönsten Funde', body: '1. Hook\nSchöne Funde.\n2. Details\nMehr Inhalt.', impressions: 6000, saves: 60, clicks: 20, daysAgo: 14 },
  ];

  const assetIds: string[] = [];
  for (const pin of pins) {
    const rows = await sql`
      INSERT INTO generated_content (project_id, user_id, content_type, title, body, metadata)
      VALUES (${projectId}, ${userId}, 'pinterest_pin', ${pin.title}, ${pin.body}, '{}')
      RETURNING id
    `;
    assetIds.push(String(rows[0].id));
  }
  note(`Test-Projekt ${projectId.slice(0, 8)}… mit ${assetIds.length} Pins angelegt.`);

  // ── 5 Performance-Einträge loggen (bekannte Metriken) ──────────────────────
  for (let i = 0; i < pins.length; i++) {
    const p = pins[i];
    const row = await qLogPerformance(TEST_CLERK, {
      assetId: assetIds[i],
      channel: 'pinterest_pin',
      publishedAt: daysAgoIso(p.daysAgo),
      metrics: { impressions: p.impressions, saves: p.saves, outbound_clicks: p.clicks },
      notes: i < 3 ? 'Test: Zahl+CTA im Titel' : 'Test: ohne Zahl',
    });
    if (!row) fail(`logPerformance ${i} lieferte null`);
  }
  const stored = await qGetPerformanceEntries(TEST_CLERK);
  if (stored.length !== 5) fail(`gespeicherte Einträge: ${stored.length}, erwartet 5`);
  note(`✅ 5 Einträge geloggt (Upsert), Persistenz-Roundtrip OK (${stored.length} Zeilen).`);

  // ── (a) Overview + Analyse ─────────────────────────────────────────────────
  const overview = await buildPerformanceOverview(TEST_CLERK, { lang: 'de' });
  evidence.push('');
  note(`Overview: ${overview.entries.length} Einträge, ${overview.channels.length} Kanäle, ruleVersion=${overview.ruleVersion}`);

  const pin = overview.channels.find((c) => c.channel === 'pinterest_pin');
  if (!pin) fail('Kein pinterest_pin-Kanal in der Übersicht');
  if (pin.count !== 5) fail(`Pin-Kanal hat ${pin.count} Assets, erwartet 5`);
  note(`Kanal pinterest_pin: ${pin.count} Assets, Ø-Score ${pin.avgScore}, bestes Asset „${pin.bestAsset?.title.slice(0, 30)}…“ (${pin.bestAsset?.score})`);
  if (pin.avgScore < 50 || pin.avgScore > 90) fail(`Ø-Score ${pin.avgScore} außerhalb Erwartung (50–90)`);

  // Datenlage
  if (!overview.dataSufficiency.enoughData) fail('dataSufficiency.enoughData sollte true sein (5 Pins ≥ 3)');
  note(`✅ dataSufficiency: enoughData=true (perChannel pinterest_pin=${overview.dataSufficiency.perChannel.pinterest_pin})`);

  // Erfolgsfaktor mit echter Zahl (Stichprobe ≥ 3, Unterschied ≥ 20 %)
  const factor = overview.successFactors.find((f) => f.channel === 'pinterest_pin');
  if (!factor) fail('Kein Erfolgsfaktor für pinterest_pin erkannt (Stichprobe 5, Top 100 vs. Bottom 20)');
  if (factor.sampleSize < 3) fail(`Faktor-Stichprobe ${factor.sampleSize} < 3`);
  if (!(factor.magnitude >= 1.2)) fail(`Faktor-Magnitude ${factor.magnitude} < 1.2`);
  if (!factor.evidence.includes('×')) fail(`Evidence ohne „×“: ${factor.evidence}`);
  const numInEvidence = factor.evidence.match(/\d/);
  if (!numInEvidence) fail(`Evidence ohne echte Zahl: ${factor.evidence}`);
  note(`🎯 Erfolgsfaktor: ${factor.factor} (×${factor.magnitude}, n=${factor.sampleSize}) — ${factor.evidence}`);

  // Vorschlag nicht leer + betroffene Assets
  const suggestion = overview.suggestions.find((s) => s.channel === 'pinterest_pin');
  if (!suggestion) fail('Kein Verbesserungsvorschlag erzeugt');
  if (!suggestion.action.trim()) fail('Vorschlag-Action leer');
  if (suggestion.affectedAssets < 1) fail(`affectedAssets ${suggestion.affectedAssets} < 1`);
  note(`💡 Vorschlag: ${suggestion.action} — ${suggestion.reason} (${suggestion.affectedAssets} betroffene Assets)`);

  // Trend berechnet (diese Woche vs. Vorwoche: 3 vs. 2 Einträge)
  const trend = overview.overallTrend;
  if (!trend) fail('Kein Gesamt-Trend berechnet');
  note(`📊 Gesamt-Trend: Ø ${trend.avgScore} (n=${trend.count}), delta=${trend.delta} %`);
  const pinTrend = pin.trend;
  note(`📊 Kanal-Trend pinterest_pin: Ø ${pinTrend?.avgScore}, delta=${pinTrend?.delta} %`);
  if (pin.weeklyScores.length < 2) fail(`weeklyScores nur ${pin.weeklyScores.length} Wochen (Mini-Balken brauchen ≥ 2)`);
  note(`📊 Mini-Balken: ${pin.weeklyScores.map((w) => `${w.week}:${w.avg}`).join(', ')}`);

  // ── (b) Kontext in die Generierung eingebaut ───────────────────────────────
  const perfContext = buildPerformanceContext(overview, 'de');
  if (!perfContext) fail('buildPerformanceContext lieferte leeren String trotz enoughData');
  if (!perfContext.includes('📈')) fail('Kontext-Header fehlt');
  if (!perfContext.includes(factor.evidence.slice(0, 25))) {
    fail(`Kontext enthält den Faktor nicht: ${perfContext.slice(0, 120)}`);
  }
  note(`📈 Kontext-Block (${perfContext.length} Zeichen) enthält den Erfolgsfaktor.`);

  // Paket-Naht: [kernelContext, briefContext, perfContext].filter(Boolean).join('\n\n')
  const kernel: MarketingKernel = {
    keywords: ['geschenke', 'weihnachten'],
    mainHook: 'Geschenkideen',
    cta: 'Jetzt entdecken',
    voice: 'Freundlich',
    audienceNote: 'Geschenke-Suchende',
  };
  const packageAdditional = [kernelContext(kernel), '', perfContext].filter(Boolean).join('\n\n');
  if (!packageAdditional.includes('📈') || !packageAdditional.includes(factor.evidence.slice(0, 25))) {
    fail('Paket-additionalContext enthält den Performance-Kontext nicht');
  }
  note('✅ Paket-Naht: perfContext steckt in [kernelContext, briefContext, perfContext] → generate-additionalContext.');

  // QuickGenerator-Naht: [briefContext, perfContext] (gleiche buildPerformanceContext-Funktion)
  const quickAdditional = ['', perfContext].filter(Boolean).join('\n\n');
  if (!quickAdditional.includes('📈')) fail('QuickGenerator-Naht enthält den Kontext nicht');
  note('✅ QuickGenerator-Naht: perfContext wird an additionalContext angehängt.');

  // ── (c) Upsert-Roundtrip: Update desselben Assets ──────────────────────────
  const updated = await qLogPerformance(TEST_CLERK, {
    assetId: assetIds[0],
    channel: 'pinterest_pin',
    publishedAt: daysAgoIso(2),
    metrics: { impressions: 10000, saves: 800, outbound_clicks: 200 },
    notes: 'aktualisiert',
  });
  if (!updated) fail('Upsert lieferte null');
  if (updated.metrics.saves !== 800) fail(`Upsert-Saves ${updated.metrics.saves}, erwartet 800`);
  const reread = await qGetPerformanceEntries(TEST_CLERK);
  const rereadEntry = reread.find((r) => r.assetId === assetIds[0]);
  if (!rereadEntry || rereadEntry.metrics.saves !== 800) fail('Upsert nach Re-Read nicht persistiert');
  note('✅ Upsert-Roundtrip: Update überschreibt (user,asset)-Eintrag, Re-Read bestätigt.');

  // ── Aufräumen ──────────────────────────────────────────────────────────────
  await sql`DELETE FROM projects WHERE id = ${projectId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
  const leftover = await qGetPerformanceEntries(TEST_CLERK);
  if (leftover.length !== 0) fail('Aufräumen fehlgeschlagen — Einträge übrig');
  note('🧹 Test-Daten entfernt (Projekt + Nutzer kaskadierend gelöscht).');

  evidence.push('\n\nALLE F9-CHECKS BESTANDEN ✅');
  writeFileSync(EVIDENCE, evidence.join('\n'));
  console.log('\n✅ F9 alle Prüfungen bestanden — Evidence: ' + EVIDENCE);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('F9-TEST FAILED:', err instanceof Error ? err.message : err);
    writeFileSync(EVIDENCE, evidence.join('\n'));
    process.exit(1);
  });
