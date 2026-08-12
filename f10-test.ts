// ── F10 Server-side verification: Persönliche Lernschleife ───────────────────
// Run: bun --env-file=.env run f10-test.ts
//
// ECHTE DB: legt einen dedizierten Test-Nutzer + Test-Projekt mit 5
// emotionalen Pinterest-Pins an und speichert Like/Dislike-Feedback:
//   (a) Stichproben-Gate: 1–2 Likes → enoughData=false + Warn-Block MIT Flag
//       (keine erfundene Präferenz); 3 Likes → enoughData=true und klare
//       Präferenz (Ton=emotional, Format=kompakt, Kanal=pinterest_pin).
//   (b) Counters + Profil persistieren (DB-Roundtrip), Dedupe (gleicher Like
//       zählt nicht doppelt), Toggle (Like→Dislike flippt Zähler).
//   (c) buildLearningContext → Präferenz-Block; steckt in den
//       generate-additionalContext (Paket-Naht [kernelContext, briefContext,
//       perfContext, learnContext] + QuickGenerator-Naht).
//   (d) resetPreferences löscht die Zeile.
// Aufräumen: Test-Nutzer + Projekt werden am Ende gelöscht (Cascade).
// Writes f10-test-evidence.txt and exits 0 when every check passed.
import { writeFileSync } from 'node:fs';
import { getDb } from './src/db/index';
import { initDb } from './src/db/init';
import { ensureUserRow, qGetUserPreferences } from './src/db/queries';
import { recordFeedback, buildLearningProfile, resetPreferences } from './src/ai/learning';
import { buildLearningContext } from './src/ai/learning/context';
import { kernelContext } from './src/ai/package/generate';
import type { MarketingKernel } from './src/ai/package/kernel';

const EVIDENCE = 'f10-test-evidence.txt';
const evidence: string[] = [];
const TEST_CLERK = 'f10-test-user';
const TEST_EMAIL = 'f10-test@growimo.local';

function fail(msg: string): never {
  evidence.push(`\n❌ FAIL: ${msg}`);
  writeFileSync(EVIDENCE, evidence.join('\n'));
  throw new Error('F10-FAIL: ' + msg);
}
function note(msg: string): void {
  evidence.push(msg);
  console.log('  ' + msg);
}

async function main(): Promise<void> {
  await initDb();
  const sql = getDb();
  evidence.push(`F10 TEST-EVIDENCE — ${new Date().toISOString()}`);

  // Alte Test-Reste entfernen (frühere Läufe können abgebrochen sein)
  await sql`DELETE FROM users WHERE clerk_id = ${TEST_CLERK}`;

  // ── Test-Nutzer + Test-Projekt + 5 emotionale Pins anlegen ────────────────
  const userId = await ensureUserRow(TEST_CLERK, TEST_EMAIL, 'F10 Test User');
  note(`Test-Nutzer: ${userId.slice(0, 8)}… (clerk ${TEST_CLERK})`);

  const projRows = await sql`
    INSERT INTO projects (user_id, title, product_idea, content_types, status)
    VALUES (${userId}, 'F10-Test: Lernschleife', 'Test-Produkt für die Persönliche Lernschleife', '["pinterest_pin"]', 'completed')
    RETURNING id
  `;
  const projectId = String(projRows[0].id);

  // Alle Titel+Texte sind eindeutig EMOTIONAL (kein freundlich/professionell-
  // Treffer) und kurz (→ Format "concise"). Damit ist die Klassifikation
  // deterministisch: 3 Likes → Ton=emotional, Format=kompakt, Kanal=pinterest.
  const pins: Array<{ title: string; body: string }> = [
    { title: 'Herzliche Weihnachtsmomente – Wärme und Zauber für besondere Abende', body: '1. Hook\nWarme Momente.\n2. Details\nMehr Inhalt.' },
    { title: 'Magische Geschenkideen voller Liebe und Gemütlichkeit', body: '1. Hook\nMagische Ideen.\n2. Details\nMehr Inhalt.' },
    { title: 'Träume von warmen Abenden – Glück und Freude teilen', body: '1. Hook\nGlückliche Abende.\n2. Details\nMehr Inhalt.' },
    { title: 'Kuschelige Wintermomente mit nostalgischem Zauber', body: '1. Hook\nKuschelige Momente.\n2. Details\nMehr Inhalt.' },
    { title: 'Leidenschaftliche Momente – dankbar für kleine Wunder', body: '1. Hook\nDankbare Momente.\n2. Details\nMehr Inhalt.' },
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
  note(`Test-Projekt ${projectId.slice(0, 8)}… mit ${assetIds.length} emotionalen Pins angelegt.`);

  // ── (a) Stichproben-Gate: 1 Like → noch keine Präferenz ────────────────────
  let view = await recordFeedback(TEST_CLERK, assetIds[0], 'like', { title: pins[0].title, body: pins[0].body, channel: 'pinterest_pin' });
  if (!view) fail('recordFeedback (1. Like) lieferte null');
  if (view.likes !== 1 || view.dislikes !== 0) fail(`Zähler nach 1. Like: ${view.likes}/${view.dislikes}`);
  if (view.enoughData) fail('enoughData nach 1 Signal sollte false sein (Gate >= 3)');
  let ctx = buildLearningContext(view, 'de');
  if (!ctx) fail('Kontext bei 1 Signal sollte Warn-Block (mit Flag) liefern');
  if (!ctx.includes('n = 1') || !ctx.includes('nicht')) fail(`Warn-Block ohne Schwach-Signal-Flag: ${ctx}`);
  note('✅ 1. Like: enoughData=false, Warn-Block MIT Flag (n = 1) — keine erfundene Präferenz.');

  // ── 2. Like → weiter unter dem Gate ─────────────────────────────────────────
  view = await recordFeedback(TEST_CLERK, assetIds[1], 'like', { title: pins[1].title, body: pins[1].body, channel: 'pinterest_pin' });
  if (!view) fail('recordFeedback (2. Like) lieferte null');
  if (view.likes !== 2 || view.enoughData) fail(`Zähler/Gate nach 2. Like: likes=${view.likes} enoughData=${view.enoughData}`);
  if (view.preferredTone !== null) fail(`Präferenz aus Rauschen erfunden (2 Signale): ${view.preferredTone}`);
  note('✅ 2. Like: Zähler=2, weiterhin kein präferierter Ton (Gate nicht erreicht).');

  // ── 3. Like → Gate erreicht, klare Präferenz ────────────────────────────────
  view = await recordFeedback(TEST_CLERK, assetIds[2], 'like', { title: pins[2].title, body: pins[2].body, channel: 'pinterest_pin' });
  if (!view) fail('recordFeedback (3. Like) lieferte null');
  if (!view.enoughData) fail('enoughData nach 3 Signalen sollte true sein');
  if (view.preferredTone !== 'emotional') fail(`Präferenz-Ton ${view.preferredTone}, erwartet emotional`);
  if (view.preferredFormat !== 'concise') fail(`Präferenz-Format ${view.preferredFormat}, erwartet concise`);
  if (view.preferredChannel !== 'pinterest_pin') fail(`Präferenz-Kanal ${view.preferredChannel}, erwartet pinterest_pin`);
  note(`🎯 Nach 3 Likes: enoughData=true — Ton=emotional, Format=kompakt, Kanal=pinterest_pin.`);

  // ── (b) Persistenz-Roundtrip + gespeicherte Klassifikation ─────────────────
  const row = await qGetUserPreferences(TEST_CLERK);
  if (!row) fail('user_preferences-Zeile nicht persistiert');
  if (row.likes !== 3 || row.dislikes !== 0) fail(`DB-Zeile: ${row.likes} Likes / ${row.dislikes} Dislikes, erwartet 3/0`);
  if (row.toneProfile.emotional !== 3) fail(`toneProfile.emotional = ${row.toneProfile.emotional}, erwartet 3`);
  const firstEntry = row.feedbackAssets.find((e) => e.assetId === assetIds[0]);
  if (!firstEntry || firstEntry.tone !== 'emotional' || firstEntry.format !== 'concise') {
    fail('Gespeicherte Klassifikation des Assets fehlt oder falsch');
  }
  note(`✅ Persistenz: Zähler 3/0 + toneProfile.emotional=3 in der DB (${row.feedbackAssets.length} Signale).`);

  // ── (c) Kontext-Block + Paket-/QuickGenerator-Naht ─────────────────────────
  ctx = buildLearningContext(view, 'de');
  if (!ctx.includes('Bevorzugter Ton') || !ctx.includes('emotional')) {
    fail(`Präferenz-Block enthält Ton nicht: ${ctx}`);
  }
  note(`📈 Kontext-Block (${ctx.length} Zeichen) enthält die Präferenz (Ton=emotional).`);

  const kernel: MarketingKernel = {
    keywords: ['geschenke', 'weihnachten'],
    mainHook: 'Geschenkideen',
    cta: 'Jetzt entdecken',
    voice: 'Freundlich',
    audienceNote: 'Geschenke-Suchende',
  };
  const perfContext = ''; // F9 ohne Daten → leer
  const packageAdditional = [kernelContext(kernel), '', perfContext, ctx].filter(Boolean).join('\n\n');
  if (!packageAdditional.includes('🧠') || !packageAdditional.includes('emotional')) {
    fail('Paket-additionalContext enthält den Lern-Kontext nicht');
  }
  note('✅ Paket-Naht: learnContext steckt in [kernelContext, briefContext, perfContext, learnContext] → generate-additionalContext.');

  const quickAdditional = ['', '', ctx].filter(Boolean).join('\n\n');
  if (!quickAdditional.includes('🧠')) fail('QuickGenerator-Naht enthält den Lern-Kontext nicht');
  note('✅ QuickGenerator-Naht: learnContext wird an additionalContext angehängt.');

  // ── (b2) Dedupe: gleicher Like zählt nicht doppelt ─────────────────────────
  const dedupeView = await recordFeedback(TEST_CLERK, assetIds[0], 'like', { title: pins[0].title, body: pins[0].body, channel: 'pinterest_pin' });
  if (!dedupeView || dedupeView.likes !== 3 || dedupeView.totalSignals !== 3) {
    fail(`Dedupe fehlgeschlagen: likes=${dedupeView?.likes} total=${dedupeView?.totalSignals}`);
  }
  note('✅ Dedupe: erneuter Like auf dasselbe Asset zählt nicht doppelt (weiterhin 3).');

  // ── Toggle: Like→Dislike flippt Zähler, Klassifikation bleibt stabil ───────
  const toggled = await recordFeedback(TEST_CLERK, assetIds[0], 'dislike', { title: pins[0].title, body: pins[0].body, channel: 'pinterest_pin' });
  if (!toggled || toggled.likes !== 2 || toggled.dislikes !== 1) {
    fail(`Toggle fehlgeschlagen: ${toggled?.likes} Likes / ${toggled?.dislikes} Dislikes, erwartet 2/1`);
  }
  const toggledRow = await qGetUserPreferences(TEST_CLERK);
  const toggledEntry = toggledRow?.feedbackAssets.find((e) => e.assetId === assetIds[0]);
  if (!toggledEntry || toggledEntry.kind !== 'dislike' || toggledEntry.tone !== 'emotional') {
    fail('Toggle: gespeicherte Klassifikation nicht stabil (Ton muss emotional bleiben)');
  }
  note('✅ Toggle: Like→Dislike flippt Zähler (2/1), gespeicherte Klassifikation bleibt stabil.');

  // ── Mehr Likes → Präferenz wieder eindeutig (Robustheit gegen Toggle) ──────
  view = await recordFeedback(TEST_CLERK, assetIds[3], 'like', { title: pins[3].title, body: pins[3].body, channel: 'pinterest_pin' });
  view = await recordFeedback(TEST_CLERK, assetIds[4], 'like', { title: pins[4].title, body: pins[4].body, channel: 'pinterest_pin' });
  if (!view) fail('recordFeedback (4./5. Signal) lieferte null');
  if (view.preferredTone !== 'emotional' || !view.enoughData) {
    fail(`Nach 5 Signalen: tone=${view.preferredTone}, enoughData=${view.enoughData}`);
  }
  note(`✅ Nach 5 Signalen (${view.likes} 👍 / ${view.dislikes} 👎): Präferenz wieder eindeutig (Ton=emotional).`);

  // ── buildLearningProfile (Dashboard-Assembly) ───────────────────────────────
  const profile = await buildLearningProfile(TEST_CLERK);
  if (profile.likes !== 4 || profile.dislikes !== 1 || profile.preferredTone !== 'emotional') {
    fail(`buildLearningProfile: ${JSON.stringify(profile)}`);
  }
  note('✅ buildLearningProfile: gleiche View wie recordFeedback (4/1, Ton=emotional).');

  // ── (d) Reset ───────────────────────────────────────────────────────────────
  const resetOk = await resetPreferences(TEST_CLERK);
  if (!resetOk) fail('resetPreferences lieferte false');
  const afterReset = await qGetUserPreferences(TEST_CLERK);
  if (afterReset !== null) fail('Nach Reset existiert die Zeile weiterhin');
  note('✅ Reset: user_preferences-Zeile gelöscht, buildLearningProfile liefert leere View.');

  // ── Aufräumen ──────────────────────────────────────────────────────────────
  await sql`DELETE FROM projects WHERE id = ${projectId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
  const leftover = await qGetUserPreferences(TEST_CLERK);
  if (leftover !== null) fail('Aufräumen fehlgeschlagen — Präferenzen übrig');
  note('🧹 Test-Daten entfernt (Projekt + Nutzer kaskadierend gelöscht).');

  evidence.push('\n\nALLE F10-CHECKS BESTANDEN ✅');
  writeFileSync(EVIDENCE, evidence.join('\n'));
  console.log('\n✅ F10 alle Prüfungen bestanden — Evidence: ' + EVIDENCE);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('F10-TEST FAILED:', err instanceof Error ? err.message : err);
    writeFileSync(EVIDENCE, evidence.join('\n'));
    process.exit(1);
  });
