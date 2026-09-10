// TikTok-Modul Phase 2 — „Vollständiges Konzept" (format, timedScenes, title,
// imageIdeas + Image-Studio-Deep-Link). Muster wie Phase 1: Bun-Mini-Server als
// OpenAI-Mock (OPENAI_BASE_URL) + generateTikTok + Parser + Deep-Link-Helfer.
//
// Szenarien:
//  S1  concept OHNE topic (de)  → Konzept enthält alle neuen Felder + Zeitangaben
//  S2  concept OHNE topic (en)  → ebenso (zweisprachig)
//  S3  concept MIT topic        → Regression + neue Felder
//  S4  todayIdea MIT Markenprofil → alle neuen Felder vorhanden
//  S5  alte Outputs (ohne neue Felder) → Parser-Fallback, kein Crash, Return trotzdem
//  S6  Unvollständiges Konzept → Retry mit VOLLSTÄNDIGKEITSHINWEIS (2 Calls)
//  S7  max_tokens=2400 wird gesendet; volle Antwort wird nicht abgeschnitten
//  S8  diagnose bleibt funktional (Phase-1-Regression)
//  S9  todayIdea Regel-A → Retry (Phase-1-Regression)
//  S10 Image-Studio-Deep-Link: URL trägt den encodierten studioPrompt
//  S11 Image-Studio-Route: studioSearchPrefill übernimmt ?prompt= (Routebene)
import { generateTikTok, conceptCompleteness, type TikTokInput } from './src/ai/tiktok';
import { studioDeepLink, studioSearchPrefill } from './src/lib/studio-deeplink';

// ── OpenAI-Mock-Server (wie Phase 1, erweitert um max_tokens-Aufzeichnung) ───
type Responder = (attempt: number, userPrompt: string) => string;
let currentResponder: Responder | null = null;
let attemptCounter = 0;
const seenUserPrompts: string[] = [];
const seenSystemPrompts: string[] = [];
const seenMaxTokens: number[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const body = (await req.json()) as {
      messages?: Array<{ role?: string; content?: unknown }>;
      max_tokens?: number;
    };
    seenMaxTokens.push(body.max_tokens ?? 0);
    const userMsg =
      (body?.messages?.find((m) => m.role === 'user')?.content as string | undefined) ?? '';
    const systemMsg =
      (body?.messages?.find((m) => m.role === 'system')?.content as string | undefined) ?? '';
    seenUserPrompts.push(userMsg);
    seenSystemPrompts.push(systemMsg);
    attemptCounter += 1;
    const content = currentResponder ? currentResponder(attemptCounter, userMsg) : '{}';
    return Response.json({
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  },
});
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}/v1`;
process.env.OPENAI_API_KEY = 'sk-mock';

// ── Canned Payloads ───────────────────────────────────────────────────────────
const cleanIdeaSelfCheck = {
  usesConcreteBrandFact: true,
  addressesCurrentChallenge: true,
  interchangeable: false,
  soundsLikeAd: false,
  inventsUserOrTestimonial: false,
  unprovenPerformancePromise: false,
  prescribedEnthusiasm: false,
};

/** Vollständiges Phase-2-Konzept (alle neuen Felder). */
function fullConceptPayload(selfCheck = cleanIdeaSelfCheck) {
  return JSON.stringify({
    idea: 'Wir zeigen Schritt für Schritt, wie aus einer einzelnen Marketing-Idee in der echten App ein kompletter Content-Plan wird.',
    hook: 'Eine Idee. Ein kompletter Plan. In der echten App.',
    length: '15 Sekunden',
    format: 'Tutorial/How-to – Schritt für Schritt (passt zum Ziel: Verkäufe)',
    title: 'So wird aus einer Idee ein Content-Plan',
    timedScenes: [
      { time: '0-2s', scene: 'Nahaufnahme: Ich öffne die App und tippe die erste Idee ein', text: 'Eine Idee' },
      { time: '2-8s', scene: 'Ich wähle TikTok aus und drücke auf Generieren', text: 'Ein kompletter Plan' },
      { time: '8-15s', scene: 'Das fertige Konzept mit Szenen, Hook und Titel erscheint', text: '' },
    ],
    scenes: ['Szene 1: App öffnen', 'Szene 2: Idee eingeben', 'Szene 3: Ergebnis zeigen'],
    overlays: ['Eine Idee', 'Ein kompletter Plan'],
    spokenText: 'Ich probiere es direkt in der App aus.',
    caption: 'Ich habe meine eigene Marketing-App getestet.',
    hashtags: ['#marketing', '#ki', '#contentplan'],
    cta: 'Was würdest du zuerst testen?',
    why: 'Weil die Szene eine echte Demonstration zeigt und Neugier aufbaut.',
    imageIdeas: [
      { description: 'Cover/Thumbnail: App-Zuhaltung mit Plan-Ergebnis', studioPrompt: 'Produktfoto, minimalistischer Stil, warmes Licht, Smartphone mit Marketing-App, Nahaufnahme, weicher Hintergrund' },
      { description: 'Mood-Bild Szene 2: Tippen auf dem Bildschirm', studioPrompt: 'Close-up Finger tippt auf Touchscreen, dunkler Schreibtisch, bläuliches Licht, authentische Arbeitsatmosphäre' },
      { description: 'After-Bild: fertiger Content-Plan auf Papier', studioPrompt: 'Layout mit Checkliste und Zeitplan, Tageslicht von links, flache Perspektive, cleanes Design' },
    ],
    selfCheck,
  });
}

/** Alter Output OHNE Phase-2-Felder (Parser-Fallback-Test). */
function oldIdeaPayload(selfCheck = cleanIdeaSelfCheck) {
  return JSON.stringify({
    idea: 'Wir zeigen, wie eine einzelne Marketing-Idee in der echten App zum fertigen Content-Plan wird.',
    hook: 'Ich habe eine Idee - und Growimo macht daraus einen kompletten Plan',
    length: '15 Sekunden',
    scenes: ['Szene 1: Ich öffne die App', 'Szene 2: Ich gebe die Idee ein', 'Szene 3: Das fertige Ergebnis erscheint'],
    overlays: ['Eine Idee', 'Ein kompletter Plan'],
    spokenText: 'Ich probiere es direkt in der App aus.',
    caption: 'Ich habe meine eigene Marketing-App getestet.',
    hashtags: ['#marketing', '#ki'],
    cta: 'Was würdest du zuerst testen?',
    why: 'Weil die Szene eine echte Demonstration zeigt und Neugier aufbaut.',
    selfCheck,
  });
}

function diagnosePayload() {
  return JSON.stringify({
    biggestProblem: 'Die Wiedergabedauer bricht direkt nach dem Hook ein.',
    whatWorks: ['Der Hook spricht die Zielgruppe an'],
    whatToImprove: ['Die erste Einblendung kommt zu spät', 'Der Mittelteil verliert an Tempo'],
    newHook: 'So hältst du deine Zuschauer im Video',
    optimized: 'Szene 1: Hook mit Frage, Szene 2: Antwort im direkten Schnitt',
    nextTest: 'Setze die erste Einblendung auf Sekunde 1 und beobachte die Wiedergabedauer.',
    selfCheck: { inventsMetrics: false, unprovenPromise: false, prescribedEnthusiasm: false, vagueNextTest: false, groundedInNumbers: true },
  });
}

const RULE_A_IDEA = JSON.stringify({
  idea: 'Zeig, wie eine Idee zum Plan wird.',
  hook: 'Steigere deine Reichweite in nur 10 Sekunden',
  length: '15 Sekunden',
  scenes: ['Szene 1', 'Szene 2'],
  overlays: ['Text'],
  spokenText: '',
  caption: 'Test',
  hashtags: ['#test'],
  cta: 'Schreib deine Meinung',
  why: 'Weil es Aufmerksamkeit erzeugt.',
  selfCheck: cleanIdeaSelfCheck,
});

// ── Harness (wie Phase 1) ─────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(cond: boolean, label: string) {
  if (cond) {
    passed += 1;
    console.log(`  PASS ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL ${label}`);
  }
}
async function scenario(name: string, fn: () => Promise<void>) {
  attemptCounter = 0;
  seenUserPrompts.length = 0;
  seenSystemPrompts.length = 0;
  seenMaxTokens.length = 0;
  const t0 = performance.now();
  console.log(`\n[${name}]`);
  try {
    await fn();
  } catch (e) {
    failed += 1;
    failures.push(`${name} threw: ${(e as Error).message}`);
    console.log(`  FAIL ${name} threw: ${(e as Error).message}`);
  }
  console.log(`  // ${Math.round(performance.now() - t0)} ms, ${attemptCounter} engine call(s)`);
}
const lastPrompt = () => seenUserPrompts[seenUserPrompts.length - 1] ?? '';
const promptOf = (i: number) => seenUserPrompts[i] ?? '';
const systemPromptOf = (i: number) => seenSystemPrompts[i] ?? '';
function baseInput(over: Partial<TikTokInput>): TikTokInput {
  return { mode: 'todayIdea', biz: 'Handgemachte Keramikbecher', ...over };
}

function assertFullConcept(r: { format?: unknown; title?: unknown; timedScenes?: unknown; imageIdeas?: unknown }, tag: string) {
  check(typeof r.format === 'string' && r.format.length > 0, `${tag}: format vorhanden`);
  check(typeof r.title === 'string' && r.title.length > 0, `${tag}: title vorhanden`);
  check(Array.isArray(r.timedScenes) && (r.timedScenes as Array<{ time: string }>).length >= 3, `${tag}: timedScenes (≥3) vorhanden`);
  const times = (r.timedScenes as Array<{ time: string }>) || [];
  check(times.every((s) => typeof s.time === 'string' && /\d/.test(s.time)), `${tag}: jeder Eintrag hat Zeitangabe`);
  check(times.every((s) => typeof s.scene === 'string' && s.scene.length > 0), `${tag}: jeder Eintrag hat Szene`);
  check(Array.isArray(r.imageIdeas) && (r.imageIdeas as Array<{ studioPrompt: string }>).length >= 2, `${tag}: imageIdeas (≥2) vorhanden`);
  check((r.imageIdeas as Array<{ studioPrompt: string }>).every((i) => typeof i.studioPrompt === 'string' && i.studioPrompt.length > 0), `${tag}: jeder studioPrompt vorhanden`);
}

// ── Szenarien ─────────────────────────────────────────────────────────────────
await scenario('S1 concept OHNE topic (de) → vollständiges Konzept', async () => {
  currentResponder = () => fullConceptPayload();
  const res = await generateTikTok(baseInput({ mode: 'concept', topic: undefined }), 'de');
  check(res.mode === 'concept', 'Mode concept');
  const r = res as Parameters<typeof assertFullConcept>[0] & { idea: string; hook: string; scenes: string[]; caption: string; hashtags: string[]; why: string };
  check(r.idea && r.hook && r.scenes.length >= 3 && r.caption && r.hashtags.length >= 2 && r.why, 'alte Pflichtfelder weiterhin da');
  assertFullConcept(r, 'de');
  check(lastPrompt().includes('Kein Thema angegeben'), 'Prompt: Thema wird selbst gewählt');
  check(systemPromptOf(0).includes('timedScenes'), 'System-Prompt-Schema erwähnt timedScenes');
  check(systemPromptOf(0).includes('imageIdeas'), 'System-Prompt-Schema erwähnt imageIdeas');
  check(systemPromptOf(0).includes('format'), 'System-Prompt-Schema erwähnt format');
  check(attemptCounter === 1, '1 Call (kein Retry bei vollem Konzept)');
});

await scenario('S2 concept OHNE topic (en) → vollständiges Konzept', async () => {
  currentResponder = () => fullConceptPayload();
  const res = await generateTikTok(baseInput({ mode: 'concept', topic: undefined }), 'en');
  check(res.mode === 'concept', 'Mode concept');
  assertFullConcept(res as Parameters<typeof assertFullConcept>[0], 'en');
  check(lastPrompt().includes('No topic provided'), 'Prompt: englisches Selbstwahl-Szenario');
  check(systemPromptOf(0).includes('timedScenes'), 'EN-Schema: timedScenes im System-Prompt');
});

await scenario('S3 concept MIT topic → Regression + neue Felder', async () => {
  currentResponder = () => fullConceptPayload();
  const res = await generateTikTok(baseInput({ mode: 'concept', topic: 'Das Ritual des Teetrinkens' }), 'de');
  check(res.mode === 'concept', 'Mode concept');
  check(lastPrompt().includes('Das Ritual des Teetrinkens'), 'Topic-Zeile im Prompt');
  check(!lastPrompt().includes('Kein Thema angegeben'), 'kein Selbstwahl-Hinweis bei Topic');
  assertFullConcept(res as Parameters<typeof assertFullConcept>[0], 'mit topic');
  check(attemptCounter === 1, '1 Call');
});

await scenario('S4 todayIdea MIT Markenprofil (brandContext) → alle neuen Felder', async () => {
  currentResponder = () => fullConceptPayload();
  const res = await generateTikTok(
    baseInput({ mode: 'todayIdea', biz: '', brandContext: 'MARKENKONTEXT (authoritative Faktenbasis):\n- Marke: Keramikstudio Müller\n- Angebot: handgemachte Keramikbecher\n- Zielgruppe: Kaffeeliebhaber:innen 25-40' }),
    'de',
  );
  check(res.mode === 'todayIdea', 'Mode todayIdea');
  assertFullConcept(res as Parameters<typeof assertFullConcept>[0], 'todayIdea');
  check(lastPrompt().includes('MARKENKONTEXT'), 'Prompt enthält brandContext');
  check(attemptCounter === 1, '1 Call');
});

await scenario('S5 alte Outputs (ohne neue Felder) → Parser-Fallback, kein Crash', async () => {
  // Alle 4 Versuche liefern den ALTEN Output ohne Phase-2-Felder
  currentResponder = () => oldIdeaPayload();
  const res = await generateTikTok(baseInput({ mode: 'concept', topic: 'Keramik als Geschenk' }), 'de');
  check(res.mode === 'concept', 'Return trotz alter Struktur (kein Crash)');
  const r = res as { idea: string; hook: string; length: string; scenes: string[]; format?: string; timedScenes?: unknown; title?: string; imageIdeas?: unknown; caption: string; hashtags: string[]; why: string };
  check(r.idea && r.hook && r.length && r.scenes.length >= 3 && r.caption && r.hashtags.length >= 2 && r.why, 'alte Felder vollständig geparst');
  check(r.format === undefined, 'format Fallback: undefined');
  check(r.title === undefined, 'title Fallback: undefined');
  check(r.timedScenes === undefined, 'timedScenes Fallback: undefined (UI rendert scenes)');
  check(r.imageIdeas === undefined, 'imageIdeas Fallback: undefined');
  check(conceptCompleteness(r).length > 0, 'Vollständigkeitsprüfung erkennt fehlende Felder');
  check(attemptCounter === 4, '4 Calls (Retry wegen Unvollständigkeit, dann Soft-Fallback)');
});

await scenario('S6 unvollständig (Versuch 1) → vollständig (Versuch 2) mit VOLLSTÄNDIGKEITSHINWEIS', async () => {
  let call = 0;
  currentResponder = () => {
    call += 1;
    return call === 1 ? oldIdeaPayload() : fullConceptPayload();
  };
  const res = await generateTikTok(baseInput({ mode: 'concept' }), 'de');
  check(attemptCounter === 2, `Retry wegen Unvollständigkeit (2 Calls, war ${attemptCounter})`);
  const r = res as Parameters<typeof assertFullConcept>[0] & { format?: string };
  assertFullConcept(r, 'nach Retry');
  const p2 = promptOf(1);
  check(p2.includes('VOLLSTÄNDIGKEITSHINWEIS') || p2.includes('COMPLETENESS NOTE'), 'Completeness-Hinweis im 2. Prompt');
  check(p2.includes('format') && p2.includes('timedScenes'), 'Hinweis nennt fehlende Felder');
});

await scenario('S7 max_tokens=2400 + Antwort nicht abgeschnitten (volle Antwort)', async () => {
  currentResponder = () => fullConceptPayload();
  const res = await generateTikTok(baseInput({ mode: 'concept', topic: 'Sehr langes Thema mit vielen Details zur Abdeckung des Schemas' }), 'de');
  check(seenMaxTokens.length > 0, 'Request wurde gesendet');
  check(seenMaxTokens.every((m) => m === 2400), `max_tokens=2400 wird gesendet (war: ${seenMaxTokens.join(',')})`);
  // „Nicht abgeschnitten": Die Antwort ist ein vollständig parsebares JSON mit
  // allen 17 Feldern — ein abgeschnittener Stream würde beim Parser scheitern.
  const r = res as { format: string; title: string; timedScenes: unknown[]; imageIdeas: unknown[]; selfCheck?: unknown };
  check(r.format && r.title && r.timedScenes.length === 3 && r.imageIdeas.length === 3, 'volle Antwort: alle Felder inkl. aller Einträge da');
  check(res.mode === 'concept', 'Return vollständig');
});

await scenario('S8 diagnose bleibt funktional (Phase-1-Regression)', async () => {
  currentResponder = () => diagnosePayload();
  const res = await generateTikTok(baseInput({ mode: 'diagnose', metrics: { views: 1200 } }), 'de');
  check(res.mode === 'diagnose', 'Mode diagnose');
  const r = res as { biggestProblem: string; whatWorks: string[]; whatToImprove: string[]; newHook: string; optimized: string; nextTest: string };
  check(r.biggestProblem && r.newHook && r.optimized && r.nextTest, 'alle Diagnose-Pflichtfelder');
  check(r.whatWorks.length >= 1 && r.whatToImprove.length >= 2, 'Listen geparst');
  check(lastPrompt().includes('Aufrufe (Views): 1200'), 'Metriken im Prompt');
  check(attemptCounter === 1, '1 Call');
});

await scenario('S9 todayIdea Regel-A → Retry (Phase-1-Regression)', async () => {
  let call = 0;
  currentResponder = () => {
    call += 1;
    return call === 1 ? RULE_A_IDEA : fullConceptPayload();
  };
  const res = await generateTikTok(baseInput({ mode: 'todayIdea' }), 'de');
  check(attemptCounter === 2, `Retry (2 Calls, war ${attemptCounter})`);
  const r = res as Parameters<typeof assertFullConcept>[0] & { selfCheck?: unknown };
  assertFullConcept(r, 'nach Regel-A-Retry');
  check(r.selfCheck !== undefined, 'selfCheck geparst');
  const p2 = promptOf(1);
  check(p2.includes('HINWEIS VOM QUALITÄTS-SELBSTTEST') || p2.includes('QUALITY SELF-CHECK NOTE'), 'Qualitäts-Retry-Hint im 2. Prompt');
});

// ── Image-Studio-Deep-Link (Routebene) ────────────────────────────────────────
await scenario('S10 studioDeepLink: URL trägt den encodierten studioPrompt', async () => {
  const prompt = 'Produktfoto, minimalistischer Stil, warmes Licht, Keramikbecher mit Dampf, Nahaufnahme, weicher Hintergrund';
  const url = studioDeepLink(prompt);
  check(url.startsWith('/app/image-studio?prompt='), 'Deep-Link-URL korrekt aufgebaut');
  const decoded = decodeURIComponent(url.replace('/app/image-studio?prompt=', ''));
  check(decoded === prompt, 'Hin-/Rückcodierung: studioPrompt bleibt erhalten');
  check(!url.includes(' '), 'keine Leerzeichen in der URL (encodiert)');
});

await scenario('S11 studioSearchPrefill: Image-Studio-Route übernimmt ?prompt= (Routebene)', async () => {
  const prompt = 'Titelbild mit warmem Licht für einen Tee-Ritual-TikTok';
  const pre = studioSearchPrefill(`?prompt=${encodeURIComponent(prompt)}`);
  check(pre.prompt === prompt, 'Prompt wird aus query übernommen');
  check(pre.idea === undefined && pre.fromStrategy === false, 'keine Nebenwirkungen auf andere Einstiege');
  const old = studioSearchPrefill('?idea=alte-idee');
  check(old.idea === 'alte-idee' && old.prompt === undefined, 'bestehender ?idea=-Einstieg unverändert');
  const strat = studioSearchPrefill('?fromStrategy=1&prompt=x');
  check(strat.fromStrategy === true, 'fromStrategy wird erkannt (hat Vorrang im Route-Code)');
  // Routebene: image-studio.tsx Initial-Effekt nutzt studioSearchPrefill (Import-Beleg)
  const routeSrc = await Bun.file('./src/routes/app/image-studio.tsx').text();
  check(routeSrc.includes('studioSearchPrefill(window.location.search)'), 'image-studio.tsx wendet studioSearchPrefill an (Routebene belegt)');
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