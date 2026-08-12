// ── F8 Server-side verification: Veröffentlichungs-Kalender mit Prioritäten ──
// Run: bun --env-file=.env run f8-test.ts [projectId]
//
// REAL DB data (default: Projekt "Personalisierte Sternenhimmel-Poster",
// cb50fc2e-6a8c-4f4d-99e2-a3d3a42ad3a6). NOTE: this DB predates the F1 score
// persistence (kein metadata.score gespeichert), daher wird der F1-Score im
// Test für die publishbaren Kanäle on-the-fly berechnet — exakt so, wie die
// App es zur Generierungszeit tut. Der Plan selbst (Ranking + Termine + Tasks)
// bleibt zu 100 % deterministisch ohne LLM.
//   (a) buildPublishPlan() →
//       assert: Pinterest zuerst (exakt die rankAssets-Reihenfolge je Projekt),
//       Datum aufsteigend, bestTime vorhanden, 3–6 Tasks je Item mit echten
//       Asset-Daten (Titel-Fragment eingebettet).
//   (b) qSavePublishPlan → qGetPublishPlan → qUpdatePublishTask → qGetPublishPlan:
//       Checkbox-Zustand bleibt persistiert.
// Writes f8-test-evidence.txt and exits 0 when every check passed.
import { writeFileSync } from 'node:fs';
import { qGetProject, qGetAllContentByUser, qSavePublishPlan, qGetPublishPlan, qUpdatePublishTask } from './src/db/queries';
import { buildPublishPlan, qualityFromMetadata } from './src/ai/publish-plan';
import { rankAssets } from './src/ai/prioritize/rules';
import { scoreContent } from './src/ai/scoring';
import type { ContentType } from './src/ai/types';

const PROJECT_ID = process.argv[2] ?? 'cb50fc2e-6a8c-4f4d-99e2-a3d3a42ad3a6';
const EVIDENCE = 'f8-test-evidence.txt';
const evidence: string[] = [];
const PUBLISHABLE: ContentType[] = ['pinterest_pin', 'etsy_listing', 'seo_blog', 'social_post', 'email_newsletter'];

function fail(msg: string): never {
  evidence.push(`\n❌ FAIL: ${msg}`);
  writeFileSync(EVIDENCE, evidence.join('\n'));
  throw new Error('F8-FAIL: ' + msg);
}
function note(msg: string): void {
  evidence.push(msg);
  console.log('  ' + msg);
}

function dateKeyNow(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

async function main(): Promise<void> {
  const project = await qGetProject(PROJECT_ID);
  if (!project) throw new Error(`Projekt ${PROJECT_ID} nicht gefunden`);
  const userId = project.userId; // clerk id
  evidence.push(`F8 TEST-EVIDENCE — ${new Date().toISOString()}`);
  evidence.push(`Projekt: ${project.title} (${PROJECT_ID})`);
  evidence.push(`Produktidee: ${(project.productIdea ?? '').slice(0, 160)}`);

  // ── (a) Plan bauen (deterministisch, kein LLM) ──────────────────────────────
  const all = await qGetAllContentByUser(userId);
  note(`Geladene Inhalte des Nutzers: ${all.length}`);
  const projectContents = all.filter((c) => c.projectId === PROJECT_ID);
  const publishable = projectContents.filter((c) => (PUBLISHABLE as string[]).includes(c.contentType));
  if (publishable.length < 3) {
    fail(`Projekt hat nur ${publishable.length} publishbare Kanäle — erwartet ≥ 3 (Pinterest, Etsy, Blog)`);
  }
  // F1-Scores on-the-fly berechnen (App-Verhalten zur Generierungszeit; die DB
  // dieser Testdaten ist älter als die Score-Persistenz).
  const scoreByAsset = new Map<string, number>();
  for (const c of publishable) {
    const score = await scoreContent(
      { contentType: c.contentType, productIdea: project.productIdea ?? '' },
      { contentType: c.contentType, title: c.title, body: c.body, metadata: c.metadata },
    );
    scoreByAsset.set(c.id, score.total);
    note(`F1-Score ${c.contentType}: ${score.total}/100`);
  }
  const plan = buildPublishPlan(
    all.map((c) => ({
      projectId: c.projectId,
      projectTitle: c.projectTitle,
      channel: c.contentType,
      assetId: c.id,
      title: c.title,
      qualityScore: scoreByAsset.get(c.id) ?? qualityFromMetadata(c.metadata),
      body: c.body,
      metadata: c.metadata,
    })),
    { lang: 'de' },
  );
  if (plan.items.length < 2) fail(`Plan enthält nur ${plan.items.length} Items (erwartet ≥ 2)`);
  note(`Plan: ${plan.items.length} Items, ruleVersion=${plan.ruleVersion}, generatedAt=${plan.generatedAt}`);

  // 1) Exakte rankAssets-Reihenfolge je Projekt (Pinterest zuerst, wenn rank 1)
  const items = plan.items.filter((i) => i.projectId === PROJECT_ID);
  if (items.length < 2) fail(`Kein Plan für Projekt ${PROJECT_ID} (${items.length} Items)`);
  const ranked = rankAssets(
    projectContents.map((c) => ({
      channel: c.contentType,
      assetId: c.id,
      qualityScore: scoreByAsset.get(c.id) ?? qualityFromMetadata(c.metadata),
      title: c.title,
    })),
    'de',
  );
  if (!ranked) fail('rankAssets lieferte null für das Projekt');
  const rankOrder = ranked.map((r) => r.channel);
  const planOrder = [...items].sort((a, b) => a.rank - b.rank).map((i) => i.channel);
  note(`rankAssets-Reihenfolge: ${rankOrder.join(' > ')}`);
  note(`Plan-Reihenfolge (rank aufsteigend): ${planOrder.join(' > ')}`);
  if (JSON.stringify(planOrder) !== JSON.stringify(rankOrder)) {
    fail(`Plan-Reihenfolge ${planOrder.join('>')} ≠ rankAssets ${rankOrder.join('>')}`);
  }
  if (planOrder[0] !== 'pinterest_pin') {
    fail(`Rang 1 ist ${planOrder[0]} — erwartet pinterest_pin (schnellster Feedback-Loop)`);
  }
  note('✅ Pinterest zuerst, danach exakt die rankAssets-Reihenfolge.');

  // 2) Datum aufsteigend (global sortiert)
  const dates = plan.items.map((i) => i.scheduledDate);
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] < dates[i - 1]) fail(`Datum nicht aufsteigend: ${dates[i - 1]} > ${dates[i]}`);
  }
  note(`✅ Daten aufsteigend: ${dates[0]} … ${dates[dates.length - 1]}`);

  // 3) scheduledDate liegt in der Zukunft (heute + rank + channelDelay, ≥ +1 Tag)
  const todayKey = dateKeyNow(0);
  for (const item of items) {
    if (item.scheduledDate <= todayKey) {
      fail(`${item.channel}: scheduledDate ${item.scheduledDate} liegt nicht in der Zukunft (> ${todayKey})`);
    }
  }
  note('✅ Alle Termine liegen in der Zukunft (heute + Rang + Kanal-Kadenz).');

  // 4) bestTime vorhanden (semantischer Key aus Kanal-Profil)
  const knownTimes = new Set(['pinterest', 'etsy', 'blog', 'social', 'newsletter']);
  for (const item of items) {
    if (!item.bestTime || !knownTimes.has(item.bestTime)) {
      fail(`${item.channel}: bestTime fehlt/unbekannt (${item.bestTime})`);
    }
  }
  note(`✅ bestTime je Item vorhanden (${items.map((i) => i.bestTime).join(', ')}).`);

  // 5) 3–6 Tasks je Item + echte Asset-Daten (Titel-Fragment) eingebettet
  for (const item of items) {
    if (item.tasks.length < 3 || item.tasks.length > 6) {
      fail(`${item.channel}: ${item.tasks.length} Tasks (erwartet 3–6)`);
    }
    const allLabels = item.tasks.map((t) => t.label).join(' | ');
    const titleFrag = item.title.replace(/^[\s"„“»«'']+|[\s"„“»«'']+$/g, '').slice(0, 16);
    if (titleFrag.length >= 8 && !allLabels.includes(titleFrag.slice(0, 8))) {
      fail(`${item.channel}: kein Task referenziert das echte Asset „${titleFrag}…“`);
    }
    for (const t of item.tasks) {
      if (!t.id || !t.label || typeof t.done !== 'boolean') {
        fail(`${item.channel}: Task unvollständig (${JSON.stringify(t).slice(0, 80)})`);
      }
    }
    note(`${item.channel} (#${item.rank}, Score ${item.qualityScore}): ${item.tasks.length} Tasks — „${item.tasks[0].label.slice(0, 60)}…“`);
  }
  note('✅ 3–6 Tasks je Item, echte Asset-Daten (Titel) eingebettet, Zustand boolean.');

  // ── (b) Persistenz: save → get → updateTaskDone → get ───────────────────────
  evidence.push('');
  note('── Persistenz (publish_plan-Tabelle) ──');
  await qSavePublishPlan(
    userId,
    plan.items.map((i) => ({
      assetId: i.assetId,
      projectId: i.projectId,
      channel: i.channel,
      scheduledDate: i.scheduledDate,
      priorityScore: i.priorityScore,
      rank: i.rank,
      bestTime: i.bestTime,
      tasks: i.tasks,
      title: i.title,
      rationale: i.rationale,
    })),
  );
  const saved = await qGetPublishPlan(userId);
  if (saved.length < plan.items.length) {
    fail(`gespeichert: ${saved.length}, erwartet ≥ ${plan.items.length}`);
  }
  note(`Gespeichert: ${saved.length} Zeilen (user+asset-upsert).`);

  const target = saved.find((r) => r.assetId === items[0].assetId);
  if (!target) fail(`Item ${items[0].assetId} nicht in gespeichertem Plan`);
  if (target.tasks.length < 3) fail('gespeicherte Tasks fehlen');
  const taskId = target.tasks[0].id;
  const before = target.tasks[0].done;
  const updated = await qUpdatePublishTask(userId, target.assetId, taskId, !before);
  if (!updated) fail('updateTaskDoneServer-Basis (qUpdatePublishTask) lieferte null');
  const updatedTask = updated.tasks.find((t) => t.id === taskId);
  if (!updatedTask || updatedTask.done !== !before) {
    fail(`Task ${taskId}: done=${updatedTask?.done} nach Update, erwartet ${!before}`);
  }
  // Re-read from DB to prove persistence
  const reread = await qGetPublishPlan(userId);
  const rereadItem = reread.find((r) => r.assetId === target.assetId);
  const rereadTask = rereadItem?.tasks.find((t) => t.id === taskId);
  if (!rereadTask || rereadTask.done !== !before) {
    fail(`Task-Zustand nach Re-Read nicht persistiert (done=${rereadTask?.done})`);
  }
  // Zurücksetzen auf Ursprungszustand (Test räumt auf)
  await qUpdatePublishTask(userId, target.assetId, taskId, before);
  note(`✅ updateTaskDone persistiert: ${before} → ${!before} → Re-Read bestätigt (zurückgesetzt auf ${before}).`);
  evidence.push(`Beispiel-Item: ${target.channel} — ${target.title?.slice(0, 70)} am ${target.scheduledDate} (Rang ${target.rank}, Priorität ${target.priorityScore}, beste Zeit ${target.bestTime}).`);

  evidence.push('\n\nALLE F8-CHECKS BESTANDEN ✅');
  writeFileSync(EVIDENCE, evidence.join('\n'));
  console.log('\n✅ F8 alle Prüfungen bestanden — Evidence: ' + EVIDENCE);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('F8-TEST FAILED:', err instanceof Error ? err.message : err);
    writeFileSync(EVIDENCE, evidence.join('\n'));
    process.exit(1);
  });
