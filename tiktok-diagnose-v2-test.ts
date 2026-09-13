// TikTok-Modul Diagnose v2 — „Video-Thema/Hook + neue Video-Version (rebuilt)"
// Test-Suite: Parser (rebuilt-Felder), probabilistische Kausal-Sprache (de+en),
// Themenbezogenheit (mit/ohne videoTopic), UI-Verdrahtung (diagnose-Payload),
// i18n-Parität der neuen Keys. Muster wie Phase 1–4: Bun-Mini-Server als
// OpenAI-Mock (OPENAI_BASE_URL) + generateTikTok + reine Funktionen.
// Usage (aus der Repo-Wurzel):  bun tiktok-diagnose-v2-test.ts
import {
  generateTikTok,
  topicGroundedInRebuilt,
  topicTokens,
  type TikTokInput,
  type TikTokDiagnoseResult,
  type TikTokDiagnoseSelfCheck,
} from './src/ai/tiktok';
import { diagnoseVideoContext } from './src/routes/app/tiktok.tsx';
// ── OpenAI-Mock-Server (wie Phase 1–4) ────────────────────────────────────────
type Responder = (attempt: number, userPrompt: string) => string;
let currentResponder: Responder | null = null;
let attemptCounter = 0;
const seenUserPrompts: string[] = [];
const seenSystemPrompts: string[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const body = (await req.json()) as { messages?: Array<{ role?: string; content?: unknown }> };
    const userMsg = (body?.messages?.find((m) => m.role === 'user')?.content as string | undefined) ?? '';
    const systemMsg = (body?.messages?.find((m) => m.role === 'system')?.content as string | undefined) ?? '';
    seenUserPrompts.push(userMsg);
    seenSystemPrompts.push(systemMsg);
    attemptCounter += 1;
    const content = currentResponder ? currentResponder(attemptCounter, userMsg) : '{}';
    return Response.json({
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  },
});
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}/v1`;
process.env.OPENAI_API_KEY = 'sk-mock';
// ── Canned Payloads ───────────────────────────────────────────────────────────
const cleanDiagSelfCheck: TikTokDiagnoseSelfCheck = {
  inventsMetrics: false,
  unprovenPromise: false,
  prescribedEnthusiasm: false,
  vagueNextTest: false,
  groundedInNumbers: true,
  lengthGrounded: true,
};
/** DE-Fixture: volle Diagnose MIT rebuilt, themenbezogen („Torte backen") und
 *  probabilistisch formuliert („wahrscheinlich", „könnte", „möglicherweise") —
 *  KEINE bewiesene Kausalität, KEINE Regel-A-/B-Muster. */
function deFixtureWithRebuilt() {
  return JSON.stringify({
    videoTopic: 'Torte backen',
    biggestProblem: 'Die Wiedergabedauer bricht früh ein — wahrscheinlich, weil der Einstieg die Torte erst zu spät zeigt.',
    whatWorks: ['Die 2500 Aufrufe deuten darauf hin, dass der Titel Interesse weckt'],
    whatToImprove: ['Der Einstieg könnte den Torten-Backprozess schneller zeigen', 'Die Zutaten-Einblendung kommt möglicherweise zu spät'],
    newHook: 'So backst du eine Torte, die jeder sehen will',
    optimized: 'Szene 1: Torten-Hook mit Frage in Sekunde 0-1, Szene 2: Torten-Rohling im direkten Schnitt, Szene 3: CTA',
    nextTest: 'Setze den Torten-Rohling in Sekunde 1 ein und beobachte die durchschnittliche Wiedergabedauer.',
    rebuilt: {
      hook: 'Die dreistöckige Torte in 3 Schritten – zeig ich dir jetzt',
      timedScenes: [
        { time: '0-2s', scene: 'Torten-Rohling auf dem Teller, Kamera fährt langsam hoch', text: 'Eine dreistöckige Torte in 3 Schritten' },
        { time: '2-10s', scene: 'Teig wird in die Form gefüllt', text: 'Hier kommt der Torten-Teig hinein' },
        { time: '10-20s', scene: 'Fertige Torte wird angeschnitten', text: 'So sieht die fertige Torte aus' },
      ],
      voiceover: 'Zeig in den ersten zwei Sekunden die fertige Torte und erkläre dann die drei Schritte: Teig, Form, Backen.',
      cta: 'Folge mir für weitere Torten-Rezepte',
      seconds: 20,
    },
    lengthRecommendation: {
      seconds: 20,
      structure: '0-2s: Torten-Hook, 2-10s: Teig, 10-20s: Ergebnis',
      reason: 'Basierend auf deinen 2500 Views und 38,1% Watch-Rate bei 42s Länge (16s durchschnittliche Wiedergabedauer) bricht die Aufmerksamkeit früh ein — kürze auf 20 Sekunden und zeige die Torte in den ersten Sekunden.',
    },
    selfCheck: cleanDiagSelfCheck,
  });
}
/** EN-Fixture: analog („Baking a layer cake"), probabilistisch („likely",
 *  „may"), ohne bewiesene Kausalität. */
function enFixtureWithRebuilt() {
  return JSON.stringify({
    videoTopic: 'Baking a layer cake',
    biggestProblem: 'Watch time drops early — likely because the opening shows the cake too late.',
    whatWorks: ['2500 views suggest the title creates interest'],
    whatToImprove: ['The opening could show the cake sooner', 'The ingredient overlay may appear too late'],
    newHook: 'This is how you bake a cake everyone wants to see',
    optimized: 'Scene 1: cake hook question in seconds 0-1, Scene 2: cake batter in a direct cut, Scene 3: CTA',
    nextTest: 'Show the cake batter in second 1 and watch the average watch time.',
    rebuilt: {
      hook: 'A three-tier cake in 3 steps — watch this',
      timedScenes: [
        { time: '0-2s', scene: 'Layer cake on a plate, camera tilts up', text: 'A three-tier cake in 3 steps' },
        { time: '2-10s', scene: 'Batter goes into the pan', text: 'Here comes the cake batter' },
        { time: '10-20s', scene: 'Finished cake is sliced', text: 'This is the finished cake' },
      ],
      voiceover: 'Show the finished cake in the first two seconds, then explain the three steps: batter, pan, baking.',
      cta: 'Follow for more cake recipes',
      seconds: 20,
    },
    lengthRecommendation: {
      seconds: 20,
      structure: '0-2s cake hook, 2-10s batter, 10-20s result',
      reason: 'Based on your 2500 views and 38.1% watch rate at 42s length (16s average watch time), attention drops early — shorten to 20 seconds and show the cake within the first seconds.',
    },
    selfCheck: cleanDiagSelfCheck,
  });
}
/** OHNE rebuilt (altes Diagnose-Format): rendert weiterhin korrekt. */
function deOldDiagnosePayload() {
  return JSON.stringify({
    biggestProblem: 'Die Wiedergabedauer bricht direkt nach dem Hook ein – wahrscheinlich wirkt der Einstieg zu langsam.',
    whatWorks: ['Der Hook scheint die Zielgruppe anzusprechen'],
    whatToImprove: ['Die erste Einblendung kommt eventuell zu spät', 'Der Mittelteil könnte Tempo verlieren'],
    newHook: 'So hältst du deine Zuschauer im Video',
    optimized: 'Szene 1: Hook mit Frage, Szene 2: Antwort im direkten Schnitt',
    nextTest: 'Setze die erste Einblendung auf Sekunde 1 und beobachte die Wiedergabedauer.',
    lengthRecommendation: {
      seconds: 25,
      structure: '0-2s: Hook, 2-18s: Inhalt mit Fix, 18-25s: CTA',
      reason: 'Basierend auf deinen 2500 Views und 38,1% Watch-Rate bei 42s Länge (16s durchschnittliche Wiedergabedauer) bricht die Aufmerksamkeit früh ein — kürze auf 25 Sekunden.',
    },
    selfCheck: cleanDiagSelfCheck,
  });
}
/** Ohne Themenangabe: ehrlicher Hinweis, KEIN erfundenes Thema im Output. */
function deFixtureNoTopicHonest() {
  return JSON.stringify({
    biggestProblem: 'Die Wiedergabedauer bricht früh ein — ohne Themenangabe bleiben die Empfehlungen allgemeiner.',
    whatWorks: ['Die 2500 Aufrufe deuten darauf hin, dass der Titel Interesse weckt'],
    whatToImprove: ['Der Einstieg könnte schneller zum Punkt kommen'],
    newHook: 'So hältst du deine Zuschauer ab Sekunde 1 im Video',
    optimized: 'Szene 1: Hook-Frage, Szene 2: Antwort im direkten Schnitt, Szene 3: CTA',
    nextTest: 'Setze die erste Einblendung auf Sekunde 1 und beobachte die Wiedergabedauer.',
    rebuilt: {
      hook: 'Das Thema des Videos wird hier konkret gemacht, sobald du es angibst',
      timedScenes: [
        { time: '0-2s', scene: 'Hook-Frage, die zum Thema hinführen kann', text: 'Das zeig ich dir jetzt' },
        { time: '2-18s', scene: 'Kern-Inhalt mit dem Fix', text: 'Hier kommt der Kern des Videos' },
        { time: '18-25s', scene: 'Call-to-Action', text: 'Folge für mehr' },
      ],
      voiceover: 'Ohne Themenangabe bleibt die Vorlage allgemein — beschreibe dein Video, dann wird jeder Satz konkret auf dein Thema zugeschnitten.',
      cta: 'Folge für mehr',
      seconds: 25,
    },
    lengthRecommendation: {
      seconds: 25,
      structure: '0-2s: Hook, 2-18s: Inhalt, 18-25s: CTA',
      reason: 'Basierend auf deinen 2500 Views und 38,1% Watch-Rate bei 42s Länge (16s durchschnittliche Wiedergabedauer) bricht die Aufmerksamkeit früh ein — kürze auf 25 Sekunden.',
    },
    selfCheck: cleanDiagSelfCheck,
  });
}
const fullMetrics = { views: 2500, length: '42s', avgWatch: 16 };
function baseInput(over: Partial<TikTokInput>): TikTokInput {
  return { mode: 'todayIdea', biz: 'Handgemachte Keramikbecher', ...over };
}
// ── Harness (wie Phase 1–4) ───────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(cond: boolean, label: string) {
  if (cond) { passed += 1; console.log(`  PASS ${label}`); }
  else { failed += 1; failures.push(label); console.log(`  FAIL ${label}`); }
}
async function scenario(name: string, fn: () => Promise<void>) {
  attemptCounter = 0;
  seenUserPrompts.length = 0;
  seenSystemPrompts.length = 0;
  console.log(`\n[${name}]`);
  try { await fn(); }
  catch (e) { failed += 1; failures.push(`${name} threw: ${(e as Error).message}`); console.log(`  FAIL ${name} threw: ${(e as Error).message}`); }
  console.log(`  // ${attemptCounter} engine call(s)`);
}
const lastPrompt = () => seenUserPrompts[seenUserPrompts.length - 1] ?? '';
// ── Test-Patterns (regex-basiert, de+en) ──────────────────────────────────────
const PROBABILISTIC_DE = /wahrscheinlich|kann(?:st)?\s+(?:darauf\s+)?hinweisen|möglicherweise|ein\s+möglicher\s+grund|könnte/i;
const PROBABILISTIC_EN = /\blikely\b|\b(?:may|might)\b|\bpossible\b|\bcould\b|\bsuggests?\b/i;
const PROVEN_CAUSE_DE = /der\s+grund\s+(?:dafür\s+)?ist|die\s+ursache\s+(?:dafür\s+)?(?:ist|sind|war|waren)|das\s+problem\s+ist[,\s]+dass|liegt\s+(?:es\s+)?daran|beweis(t|en)\b/i;
const PROVEN_CAUSE_EN = /\bthe\s+reason\s+(?:for\s+this\s+)?is\b|\bthe\s+cause\s+(?:of\s+this\s+)?is\b|\bproves?\s+that\b|\bclearly\s+shows?\s+that\b/i;
function blobOf(r: TikTokDiagnoseResult): string {
  return [
    r.biggestProblem, r.whatToImprove.join(' '), r.newHook, r.optimized, r.nextTest,
    r.rebuilt ? [r.rebuilt.hook, r.rebuilt.voiceover, r.rebuilt.cta,
      r.rebuilt.timedScenes.map((s) => `${s.time} ${s.scene} ${s.text}`).join(' ')].join(' ') : '',
  ].join(' ').toLowerCase();
}
// ── S1: Parser — rebuilt-Felder werden korrekt geparst (DE) ───────────────────
await scenario('P1 Parser: rebuilt-Felder + videoTopic-Echo (DE)', async () => {
  currentResponder = () => deFixtureWithRebuilt();
  const res = (await generateTikTok(
    baseInput({ mode: 'diagnose', metrics: fullMetrics, videoTopic: 'Torte backen', videoHook: 'So einfach backst du eine Torte' }),
    'de',
  )) as TikTokDiagnoseResult;
  check(res.mode === 'diagnose' && (res as { dataGap?: boolean }).dataGap === undefined, 'volle Diagnose (kein dataGap)');
  check(res.videoTopic === 'Torte backen', 'videoTopic-Echo = "Torte backen"');
  check(res.rebuilt !== undefined, 'rebuilt vorhanden');
  const rb = res.rebuilt!;
  check(rb.hook.includes('Torte'), 'rebuilt.hook nennt das Thema (Torte)');
  check(Array.isArray(rb.timedScenes) && rb.timedScenes.length === 3, 'timedScenes mit 3 Einträgen');
  check(rb.timedScenes.every((s) => s.time.trim() !== '' && s.scene.trim() !== ''), 'jede Szene hat Zeitmarke + Szenenbeschreibung');
  check(rb.timedScenes.every((s) => /^\d+-\d+s$/.test(s.time.trim())), 'Zeitmarken im Format "0-2s" (Sekunden)');
  check(rb.timedScenes.some((s) => s.text.trim() !== ''), 'Szenen enthalten Text/Voice-over-Texte');
  check(rb.voiceover.length > 20, 'voiceover: kompletter Text vorhanden');
  check(rb.cta.trim().length > 0, 'cta vorhanden');
  check(rb.seconds === 20, 'seconds = 20 (empfohlene Länge)');
  check(attemptCounter === 1, '1 Call (Fixture ist regel-sauber)');
});
// ── P2: Parser — altes Ergebnis OHNE rebuilt → undefined, restliche Felder ok ─
await scenario('P2 Parser: altes Diagnose-Ergebnis ohne rebuilt → rebuilt undefined, Panels bleiben gültig', async () => {
  currentResponder = () => deOldDiagnosePayload();
  const res = (await generateTikTok(
    baseInput({ mode: 'diagnose', metrics: fullMetrics }),
    'de',
  )) as TikTokDiagnoseResult;
  check(res.mode === 'diagnose', 'Mode diagnose');
  check(res.rebuilt === undefined, 'rebuilt === undefined (altes Format)');
  check(res.biggestProblem.trim().length > 0, 'biggestProblem bleibt gültig');
  check(res.newHook.trim().length > 0 && res.optimized.trim().length > 0 && res.nextTest.trim().length > 0, 'newHook/optimized/nextTest bleiben gültig');
  check(res.lengthRecommendation !== undefined, 'lengthRecommendation weiterhin geparst');
  check(topicGroundedInRebuilt(undefined, res) === true, 'topicGroundedInRebuilt ohne Thema = true (kein Verwerfungsgrund)');
  check(attemptCounter === 1, '1 Call');
});
// ── P3: probabilistische Kausal-Sprache (DE + EN, regex-basiert) ─────────────
await scenario('P3 probabilistische Kausal-Sprache: DE-Fixture (niedrige avgWatch)', async () => {
  currentResponder = () => deFixtureWithRebuilt();
  const res = (await generateTikTok(
    baseInput({ mode: 'diagnose', metrics: { views: 2500, length: '42s', avgWatch: 3 } }),
    'de',
  )) as TikTokDiagnoseResult;
  const blob = blobOf(res);
  check(PROBABILISTIC_DE.test(blob), 'enthält probabilistische Formulierung (wahrscheinlich/könnte/möglicherweise)');
  check(!PROVEN_CAUSE_DE.test(blob), 'KEINE bewiesene Kausal-Behauptung ("der Grund ist"/"liegt daran"/"beweist")');
  check(res.biggestProblem.toLowerCase().includes('wahrscheinlich'), 'biggestProblem nutzt "wahrscheinlich"');
  // 2 Calls = 1 Diagnose + 1 Metric-Guard-Bereinigung: die Fixture nennt "38,1%",
  // das steht NICHT in den Nutzerkennzahlen (avgWatch=3 → 7,1%) → der Guard
  // lädt die nicht belegte Zahl per LLM-Cleanup (erwartet, KEIN Diagnose-Retry).
  check(attemptCounter === 2, '2 Calls: 1 Diagnose + 1 Metric-Guard-Bereinigung (belegte Zahlen unverändert)');
});
await scenario('P4 probabilistische Kausal-Sprache: EN-Fixture (niedrige avgWatch)', async () => {
  currentResponder = () => enFixtureWithRebuilt();
  const res = (await generateTikTok(
    baseInput({ mode: 'diagnose', metrics: { views: 2500, length: '42s', avgWatch: 3 } }),
    'en',
  )) as TikTokDiagnoseResult;
  const blob = blobOf(res);
  check(PROBABILISTIC_EN.test(blob), 'enthält probabilistische Formulierung (likely/may/could/suggests)');
  check(!PROVEN_CAUSE_EN.test(blob), 'KEINE bewiesene Kausal-Behauptung ("the reason is"/"proves that")');
  check(res.biggestProblem.toLowerCase().includes('likely'), 'biggestProblem nutzt "likely"');
  // wie P3: 2. Call = Metric-Guard-Bereinigung der nicht belegten "38.1%".
  check(attemptCounter === 2, '2 Calls: 1 Diagnose + 1 Metric-Guard-Bereinigung');
});
// ── P4: Themenbezogenheit — mit videoTopic → rebuilt bezieht das Thema ein ────
await scenario('P5 Themenbezogenheit: videoTopic "Torte backen" → rebuilt im Thema', async () => {
  currentResponder = () => deFixtureWithRebuilt();
  const res = (await generateTikTok(
    baseInput({ mode: 'diagnose', metrics: fullMetrics, videoTopic: 'Torte backen' }),
    'de',
  )) as TikTokDiagnoseResult;
  check(topicTokens('Torte backen').includes('torte'), 'topicTokens zerlegt "Torte backen" in Inhaltstokens');
  check(topicGroundedInRebuilt('Torte backen', res) === true, 'topicGroundedInRebuilt → true (Torte wörtlich in newHook/optimized/rebuilt)');
  const sceneBlob = res.rebuilt!.timedScenes.map((s) => s.scene + ' ' + s.text).join(' ').toLowerCase();
  check(sceneBlob.includes('torte'), 'Timed-Szenen beziehen das Thema ein (Torte wörtlich)');
  check((res.rebuilt!.hook + ' ' + res.rebuilt!.voiceover + ' ' + res.rebuilt!.cta).toLowerCase().includes('torte'), 'Hook/Voice-over/CTA beziehen das Thema ein');
  check(attemptCounter === 1, '1 Call (themenbezogen, kein Retry)');
});
// ── P5: ohne videoTopic → kein erfundenes Thema + ehrlicher Hinweis ───────────
await scenario('P6 OHNE videoTopic: kein erfundenes Thema, ehrlicher Hinweis', async () => {
  currentResponder = () => deFixtureNoTopicHonest();
  const res = (await generateTikTok(
    baseInput({ mode: 'diagnose', metrics: fullMetrics }),
    'de',
  )) as TikTokDiagnoseResult;
  check(res.videoTopic === undefined, 'kein videoTopic-Echo (nichts erfunden)');
  check(res.biggestProblem.toLowerCase().includes('ohne themenangabe'), 'ehrlicher Hinweis: Empfehlungen ohne Themenangabe allgemeiner');
  check(topicGroundedInRebuilt(undefined, res) === true, 'topicGroundedInRebuilt(undefined) = true');
  check(res.rebuilt !== undefined, 'rebuilt trotzdem vorhanden (allgemeine Vorlage)');
  const prompt = lastPrompt();
  check(!prompt.includes('VIDEO-THEMA'), 'User-Prompt ohne videoTopic: kein Themen-Block, keine Erfindung');
  check(attemptCounter === 1, '1 Call');
});
await scenario('P7 User-Prompt: videoTopic/videoHook werden als Faktenquelle übergeben', async () => {
  currentResponder = () => deFixtureWithRebuilt();
  await generateTikTok(
    baseInput({ mode: 'diagnose', metrics: fullMetrics, videoTopic: 'Torte backen', videoHook: 'So einfach backst du eine Torte' }),
    'de',
  );
  const p = lastPrompt();
  check(p.includes('VIDEO-THEMA'), 'Prompt enthält den Themen-Block');
  check(p.includes('Torte backen'), 'Prompt enthält das Thema wörtlich');
  check(p.includes('So einfach backst du eine Torte'), 'Prompt enthält den aktuellen Hook wörtlich');
  // ohne videoHook: nur das Thema
  await generateTikTok(baseInput({ mode: 'diagnose', metrics: fullMetrics, videoTopic: 'Torte backen' }), 'de');
  const p2 = lastPrompt();
  check(p2.includes('Torte backen') && !p2.includes('So einfach backst du eine Torte'), 'ohne Hook: nur das Thema im Prompt');
});
// ── P6: Echo-Fallback — LLM echoet Thema nicht → Engine setzt es deterministisch
await scenario('P8 Echo-Fallback: LLM liefert kein videoTopic-Echo → Engine setzt es aus dem Input', async () => {
  // Fixture OHNE videoTopic-Feld, aber Input MIT videoTopic
  const payload = JSON.parse(deOldDiagnosePayload()) as Record<string, unknown>;
  delete payload.videoTopic;
  currentResponder = () => JSON.stringify(payload);
  const res = (await generateTikTok(
    baseInput({ mode: 'diagnose', metrics: fullMetrics, videoTopic: 'Torte backen' }),
    'de',
  )) as TikTokDiagnoseResult;
  check(res.videoTopic === 'Torte backen', 'deterministischer Echo-Fallback setzt videoTopic aus dem Input');
});
// ── P7: UI-Verdrahtung — diagnose-Payload (nur present values) ────────────────
await scenario('P9 UI-Verdrahtung: diagnoseVideoContext (Payload-Baustein)', async () => {
  const filled = diagnoseVideoContext('  Torte backen  ', 'So einfach backst du eine Torte');
  check(filled.videoTopic === 'Torte backen', 'gefülltes videoTopic wird getrimmt übernommen');
  check(filled.videoHook === 'So einfach backst du eine Torte', 'gefüllter videoHook wird übernommen');
  const empty = diagnoseVideoContext('', '');
  check(empty.videoTopic === undefined && empty.videoHook === undefined, 'leere Felder → undefined (kein Payload-Eintrag)');
  const onlyHook = diagnoseVideoContext('', 'Mein Hook');
  check(onlyHook.videoTopic === undefined && onlyHook.videoHook === 'Mein Hook', 'nur Hook gefüllt → nur videoHook gesetzt');
  const onlyTopic = diagnoseVideoContext('Mein Thema', '   ');
  check(onlyTopic.videoTopic === 'Mein Thema' && onlyTopic.videoHook === undefined, 'nur Thema gefüllt → nur videoTopic gesetzt');
});
// ── P8: Prompt-Härtung (Quell-Nachweis) + i18n-Parität ────────────────────────
await scenario('P10 Prompt-Härtung: probabilistische Kausal-Sprache + Themen-Regeln in de/en-System-Prompt', async () => {
  const src = await Bun.file('./src/ai/tiktok.ts').text();
  check(src.includes('PROBABILISTIC CAUSAL LANGUAGE (HARD RULE)'), 'EN-Prompt: probabilistische Kausal-Sprache als HARD-Regel');
  check(src.includes('probabilistisch'), 'DE-Prompt: probabilistische Formulierung gefordert');
  check(src.includes('VIDEO TOPIC & CURRENT HOOK'), 'EN-Prompt: Themen-Regel (kein Erfinden ohne Thema)');
  check(src.includes('VIDEO-THEMA & AKTUELLER HOOK'), 'DE-Prompt: Themen-Regel (kein Erfinden ohne Thema)');
  check(src.includes('never "the reason is"') || src.includes('never \"the reason is\"'), 'EN-Prompt: verbotene Kausal-Formulierungen genannt');
});
await scenario('P11 i18n-Parität: neue Diagnose-v2-Keys in de.ts UND en.ts', async () => {
  const deSrc = await Bun.file('./src/i18n/de.ts').text();
  const enSrc = await Bun.file('./src/i18n/en.ts').text();
  const keys = [
    'tiktok_diag_video_topic', 'tiktok_diag_video_topic_ph',
    'tiktok_diag_video_hook', 'tiktok_diag_video_hook_ph',
    'tiktok_result_rebuilt', 'tiktok_result_rebuilt_voiceover', 'tiktok_result_rebuilt_seconds',
  ];
  check(keys.every((k) => deSrc.includes(k) && enSrc.includes(k)), 'alle 7 neuen Keys in beiden Dateien (PARITÄT)');
  check(deSrc.includes('Worum geht es in deinem Video?') && enSrc.includes('What is your video about?'), 'Labels übersetzt (de/en)');
  check(deSrc.includes('Empfohlene Länge: %s s') && enSrc.includes('Recommended length: %s s'), 'Längen-Key mit %s-Platzhalter (de/en)');
});
server.stop(true);
// ── Ergebnis ──────────────────────────────────────────────────────────────────
console.log(`\n===== ERGEBNIS =====`);
console.log(`PASS: ${passed}  FAIL: ${failed}`);
if (failures.length) {
  console.log('Fehlgeschlagen:', failures.join(' | '));
  process.exit(1);
}
console.log('ALLE TESTS BESTANDEN');