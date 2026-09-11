// ── TikTok-Modul Phase 4 — Test-Suite („Kontext-Vertiefung") ─────────────────
// Muster Phase 1–3: Bun-Mini-Server (OpenAI-Mock) + Canned Payloads + reine
// Funktionen. KEINE echte DB — das Mock-Projekt wird direkt an
// buildTikTokProjectContext()/generateTikTok() übergeben.
//
// Abgedeckt:
//   T1  projectContext: todayIdea MIT Projektauswahl → PROJEKT-KONTEXT im Prompt
//       (Titel, Produktidee, Brief-Extrakt) — Konzept nutzt Projekt-Fakten (de)
//   T2  projectContext: concept OHNE Topic + MIT Projekt → Thema aus Projekt (de)
//   T3  projectContext: concept MIT Topic + MIT Projekt → Projekt als Faktenanker (de)
//   T4  projectContext: ohne Projekt → Flow unverändert (kein Block, de + en)
//   T5  buildTikTokProjectContext: reine Funktion — nur vorhandene Felder (de/en)
//   T6  Aufnahme-Checkliste: aus vollem TikTok-Ergebnis → Set-up/Zubehör,
//       Szenen-Reihenfolge, Zeitangaben, Text, Bild-Assets, Posting-Liste (de/en)
//   T7  Aufnahme-Checkliste: Fallback (altes Ergebnis ohne timedScenes/imageIdeas)
//       und Diagnose → null
//   T8  metric-guard: TikTok-Output mit „50% häufiger" + „10k Follower gewachsen"
//       → Zahlen entfernt/neutralisiert (de + en)
//   T9  metric-guard auf Diagnose-Output (de + en)
//   T10 i18n-Parität de/en für alle neuen Texte
//   T11 Regression Phase 1–3: siehe tiktok-phase{1,2,3}-test.ts (separat ausgeführt)
//
// Usage: bun run tiktok-phase4-test.ts (aus Repo-Wurzel; kein .env nötig — Mock)

import { generateTikTok, type TikTokInput, type TikTokResult, type TikTokIdeaResult, type TikTokDiagnoseResult } from './src/ai/tiktok';
import { buildTikTokRecordingPlan } from './src/ai/action-plans/tiktok-recording';
import { buildTikTokProjectContext, extractBriefText } from './src/lib/tiktok-project-context';

// ── OpenAI-Mock-Server ───────────────────────────────────────────────────────
// Antwortet auf Generierungs-Calls mit dem aktuellen canned Payload; auf
// Guard-Calls (System-Prompt enthält „neutralisierst") mit dem bereinigten Text.
type Responder = (attempt: number, userPrompt: string) => string;
let currentResponder: Responder | null = null;
let attemptCounter = 0;
let guardCalls = 0;
const seenUserPrompts: string[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const body = (await req.json()) as { messages?: Array<{ role?: string; content?: unknown }> };
    const systemMsg = (body?.messages?.find((m) => m.role === 'system')?.content as string | undefined) ?? '';
    const userMsg = (body?.messages?.find((m) => m.role === 'user')?.content as string | undefined) ?? '';
    seenUserPrompts.push(userMsg);
    attemptCounter += 1;
    let content: string;
    if (systemMsg.includes('neutralisierst')) {
      // metric-guard / TikTok-Naked-Claim-Neutralisierung: Mock entfernt die
      // Kennzahl-Tokens aus dem zu bereinigenden Text (wie die echte Guard).
      guardCalls += 1;
      content = guardMockClean(extractTextToClean(userMsg));
    } else {
      content = currentResponder ? currentResponder(attemptCounter, userMsg) : '{}';
    }
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

/** Holt den zu bereinigenden Text aus dem Guard-User-Prompt. */
function extractTextToClean(userMsg: string): string {
  const marker = 'Zu bereinigender Text';
  const idx = userMsg.lastIndexOf(marker);
  if (idx === -1) return userMsg;
  const after = userMsg.slice(idx + marker.length);
  const m = after.match(/:\s*\n?([\s\S]*)$/);
  return (m ? m[1] : after).trim();
}

/** Deterministische Mock-Bereinigung: entfernt %-Claims und nackte
 *  Kennzahlen vor Performance-Nomen (de+en) — bildet die Guard-Absicht ab. */
function guardMockClean(text: string): string {
  return text
    .replace(/[+−]?\s*\d+(?:[.,]\d+)?\s*%/g, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*[kK]?\s*(follower|followers|reichweite|views|klicks|saves|engagement|aufrufe)\b/gi, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ── Canned Payloads ──────────────────────────────────────────────────────────
const CLEAN_SELFCHECK = {
  usesConcreteBrandFact: true,
  addressesCurrentChallenge: false,
  interchangeable: false,
  soundsLikeAd: false,
  inventsUserOrTestimonial: false,
  unprovenPerformancePromise: false,
  prescribedEnthusiasm: false,
};

function cleanIdeaPayload(): string {
  return JSON.stringify({
    idea: 'Zeig den Herstellungsprozess der handgemachten Keramikbecher',
    hook: 'So entsteht dein Lieblingsbecher in einem Tag',
    length: '30 Sekunden',
    format: 'Behind the Scenes – Herstellungsprozess (passt zum Ziel: Community)',
    title: 'So entsteht dein Lieblingsbecher',
    timedScenes: [
      { time: '0-2s', scene: 'Der Rohling auf der Drehscheibe', text: 'So entsteht dein Lieblingsbecher' },
      { time: '2-12s', scene: 'Die Tasse wird geformt und glasiert', text: '' },
      { time: '12-30s', scene: 'Das fertige Produkt mit Duftkerze', text: 'Handarbeit in jeder Faser' },
    ],
    scenes: ['Rohling auf der Drehscheibe', 'Tasse formen und glasieren', 'Fertiges Produkt zeigen'],
    overlays: ['So entsteht dein Lieblingsbecher'],
    spokenText: 'Heute zeige ich dir, wie aus einem Klumpen Ton dein Lieblingsbecher wird.',
    caption: 'Handarbeit vom Rohling bis zum fertigen Becher mit Duftkerze',
    hashtags: ['#keramik', '#handmade', '#becher', '#werkstatt'],
    cta: 'Was möchtest du als Nächstes sehen?',
    why: 'Zuschauer lieben echte Einblicke hinter die Kulissen.',
    imageIdeas: [
      { description: 'Becher im Morgenlicht', studioPrompt: 'Produktfoto, warmes Licht, Keramikbecher mit Dampf, Nahaufnahme, weicher Hintergrund' },
      { description: 'Duftkerze neben dem Becher', studioPrompt: 'Stillleben, Keramikbecher und Duftkerze, weiches Licht, minimaler Stil' },
    ],
    selfCheck: CLEAN_SELFCHECK,
  });
}

function fakeMetricIdeaPayload(de: boolean): string {
  const caption = de
    ? 'Kunden speichern den Pin 50% häufiger – wir wuchsen auf 10k Follower.'
    : 'Customers save the pin 50% more often – we grew to 10k followers.';
  const idea = de
    ? 'Wir zeigen unseren Herstellungsprozess – das brachte uns 10k Follower.'
    : 'We show our production process – that got us 10k followers.';
  return JSON.stringify({
    idea,
    hook: 'So entsteht dein Lieblingsbecher',
    length: '30 Sekunden',
    format: 'Behind the Scenes',
    title: 'Handarbeit',
    timedScenes: [{ time: '0-2s', scene: 'Rohling', text: 'So entsteht dein Becher' }, { time: '2-30s', scene: 'Formen', text: '' }],
    scenes: ['Rohling', 'Formen'],
    overlays: ['Handarbeit'],
    spokenText: '',
    caption,
    hashtags: ['#keramik'],
    cta: 'Folgt für mehr',
    why: 'Echte Einblicke bauen Vertrauen auf.',
    imageIdeas: [{ description: 'Becher', studioPrompt: 'Produktfoto Keramikbecher' }],
    selfCheck: CLEAN_SELFCHECK,
  });
}

function cleanDiagnosePayload(de: boolean): string {
  return JSON.stringify({
    biggestProblem: de
      ? 'Die Bindung bricht nach dem Hook ein: Die Saves heben sich 50% häufiger als sonst ab.'
      : 'Retention drops after the hook: Saves stand out 50% more often than usual.',
    whatWorks: ['Der Hook zieht Klicks an'],
    whatToImprove: ['Einblendung früher setzen'],
    newHook: 'So hältst du deine Zuschauer im Video',
    optimized: 'Szene 1: Hook, Szene 2: Antwort, Szene 3: CTA',
    nextTest: 'Setze die erste Einblendung auf Sekunde 1 und beobachte die Wiedergabedauer.',
    lengthRecommendation: {
      seconds: 25,
      structure: '0-2s: Hook, 2-18s: Inhalt, 18-25s: CTA',
      reason: de
        ? 'Basierend auf deinen 1200 Views: verkürze auf 25 Sekunden.'
        : 'Based on your 1200 views: shorten to 25 seconds.',
    },
    selfCheck: {
      inventsMetrics: false,
      unprovenPromise: false,
      prescribedEnthusiasm: false,
      vagueNextTest: false,
      groundedInNumbers: true,
      lengthGrounded: true,
    },
  });
}

// ── Mock-Projekt (KEINE echte DB) ───────────────────────────────────────────
const MOCK_PROJECT = {
  id: 'proj_mock_1',
  title: 'Keramik-Start-up',
  productIdea: 'Handgemachte Keramikbecher mit Duftkerzen',
  metadata: {
    brief: {
      audience: 'young_parents',
      price: 'mid',
      usp: 'handmade',
      audience_note: 'Kreative ab 25',
    },
  },
};

// ── Harness ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(cond: boolean, label: string) {
  if (cond) { passed += 1; console.log(`  PASS ${label}`); }
  else { failed += 1; failures.push(label); console.log(`  FAIL ${label}`); }
}
async function scenario(name: string, fn: () => Promise<void>) {
  attemptCounter = 0;
  guardCalls = 0;
  seenUserPrompts.length = 0;
  console.log(`\n[${name}]`);
  try { await fn(); }
  catch (e) { failed += 1; failures.push(`${name} threw: ${(e as Error).message}`); console.log(`  FAIL ${name} threw: ${(e as Error).message}`); }
  console.log(`  // ${attemptCounter} api call(s), ${guardCalls} guard call(s)`);
}
const lastPrompt = () => seenUserPrompts[seenUserPrompts.length - 1] ?? '';
const firstPrompt = () => seenUserPrompts[0] ?? '';
const hasBits = (s: string, bits: string[]) => bits.every((b) => s.includes(b));

// ── T1: todayIdea MIT Projekt → Projektkontext im Prompt ────────────────────
await scenario('T1 todayIdea + Projektauswahl → PROJEKT-KONTEXT im Prompt, Konzept nutzt Projekt-Fakten (de)', async () => {
  currentResponder = () => cleanIdeaPayload();
  const res = await generateTikTok({
    mode: 'todayIdea',
    biz: '',
    projectContext: buildTikTokProjectContext(MOCK_PROJECT, 'de'),
    goal: 'Community',
  }, 'de');
  check(res.mode === 'todayIdea', 'Mode todayIdea');
  const p = lastPrompt();
  check(p.includes('PROJEKT-KONTEXT'), 'de: PROJEKT-KONTEXT-Block vorhanden');
  check(p.includes('Projekttitel: Keramik-Start-up'), 'Projekttitel aus dem Projekt übernommen');
  check(p.includes('Produktidee: Handgemachte Keramikbecher mit Duftkerzen'), 'Produktidee aus dem Projekt übernommen');
  check(p.includes('Strategie-Brief:'), 'Brief-Extrakt (F6) im Projekt-Block');
  check(p.includes('Zielgruppe=Junge Eltern'), 'Brief-Feld übersetzt (audience=young_parents → Junge Eltern)');
  check(p.includes('(Zusatz: Kreative ab 25)'), 'Brief-Freitext-Ergänzung vorhanden');
  check(hasBits(p, ['USP=Handgemacht', 'Preis=Mittel 20–60 €']), 'Weitere Brief-Felder übersetzt');
  check(p.includes('Das gewählte PROJEKT ist die Faktenbasis'), 'todayIdea-Projekt-Anweisung im Prompt');
  check((res as TikTokIdeaResult).idea.includes('Keramikbecher'), 'Ergebnis nutzt Projekt-Fakten (canned payload referenziert Keramikbecher)');
  check(attemptCounter === 1, 'genau 1 Generierungs-Call (kein Guard-Call bei sauberem Text)');
});

// ── T2: concept OHNE Topic + MIT Projekt → Thema aus Projekt (de) ────────────
await scenario('T2 concept ohne Topic + Projekt → Themenwahl basierend auf PROJEKT-KONTEXT (de)', async () => {
  currentResponder = () => cleanIdeaPayload();
  const res = await generateTikTok({
    mode: 'concept',
    biz: 'Handgemachte Keramikbecher',
    projectContext: buildTikTokProjectContext(MOCK_PROJECT, 'de'),
  }, 'de');
  check(res.mode === 'concept', 'Mode concept');
  const p = lastPrompt();
  check(p.includes('PROJEKT-KONTEXT'), 'Projekt-Block vorhanden');
  check(p.includes('wähle ein passendes Thema basierend auf dem PROJEKT-KONTEXT'), 'concept-ohne-Topic: Thema aus Projekt wählen');
  check(!p.includes('Kein Thema angegeben — wähle selbst'), 'generische Themenwahl-Formulierung wird NICHT verwendet');
});

// ── T3: concept MIT Topic + MIT Projekt → Projekt als Faktenanker (de) ───────
await scenario('T3 concept mit Topic + Projekt → Topic ist Gegenstand, Projekt als Faktenanker (de)', async () => {
  currentResponder = () => cleanIdeaPayload();
  const res = await generateTikTok({
    mode: 'concept',
    biz: 'Handgemachte Keramikbecher',
    topic: 'Keramik als Geschenk',
    projectContext: buildTikTokProjectContext(MOCK_PROJECT, 'de'),
  }, 'de');
  check(res.mode === 'concept', 'Mode concept');
  const p = lastPrompt();
  check(p.includes('Thema / Produkt / grobe Idee:'), 'Topic-Block vorhanden');
  check(p.includes('Keramik als Geschenk'), 'Topic-Inhalt vorhanden');
  check(p.includes('PROJEKT-KONTEXT'), 'Projekt-Block vorhanden');
  check(p.includes('Stil-/Faktenanker'), 'concept-mit-Topic: Projekt als Stil-/Faktenanker');
});

// ── T4: ohne Projekt → Flow unverändert (de + en) ────────────────────────────
await scenario('T4 ohne Projekt → KEIN Projekt-Block, Flow wie bisher (de + en)', async () => {
  currentResponder = () => cleanIdeaPayload();
  const resDe = await generateTikTok({ mode: 'todayIdea', biz: 'Handgemachte Keramikbecher', goal: 'Verkäufe' }, 'de');
  check(resDe.mode === 'todayIdea', 'de: Ergebnis normal');
  check(!firstPrompt().includes('PROJEKT-KONTEXT'), 'de: kein PROJEKT-KONTEXT');
  check(!firstPrompt().includes('PROJECT CONTEXT'), 'de: kein PROJECT CONTEXT');
  currentResponder = () => cleanIdeaPayload();
  const resEn = await generateTikTok({ mode: 'todayIdea', biz: 'Handmade ceramic mugs with scented candles', goal: 'Sales' }, 'en');
  check(resEn.mode === 'todayIdea', 'en: Ergebnis normal');
  check(!firstPrompt().includes('PROJECT CONTEXT'), 'en: kein PROJECT CONTEXT');
  check(!firstPrompt().includes('PROJEKT-KONTEXT'), 'en: kein PROJEKT-KONTEXT');
});

// ── T5: buildTikTokProjectContext — reine Funktion (nur vorhandene Felder) ──
await scenario('T5 buildTikTokProjectContext: nur vorhandene Felder, de/en, leere Projekte', async () => {
  const de = buildTikTokProjectContext(MOCK_PROJECT, 'de');
  check(de !== undefined, 'de: Payload vorhanden');
  check(de?.title === 'Keramik-Start-up', 'title übernommen');
  check(de?.productIdea === 'Handgemachte Keramikbecher mit Duftkerzen', 'productIdea übernommen');
  check(de?.brief?.includes('Strategie-Brief:'), 'de: Brief-Extrakt gerendert');
  const en = buildTikTokProjectContext(MOCK_PROJECT, 'en');
  check(en?.brief?.includes('Target audience=Young parents'), 'en: Brief-Extrakt englisch');
  check(en?.brief?.includes('Price=Mid €20–60'), 'en: Preis-Label englisch');
  const empty = buildTikTokProjectContext({ id: 'x', title: '', productIdea: '  ', metadata: {} }, 'de');
  check(empty === undefined, 'leeres Projekt → undefined (Flow unverändert)');
  const none = buildTikTokProjectContext(null, 'de');
  check(none === undefined, 'null → undefined');
  const noBrief = buildTikTokProjectContext({ id: 'y', title: 'T', productIdea: 'P', metadata: { brief: 42 } }, 'de');
  check(noBrief?.title === 'T' && noBrief?.productIdea === 'P' && noBrief?.brief === undefined, 'kein Brief → nur title/productIdea');
  const briefText = extractBriefText({ audience: 'business', usp: 'durable' }, 'en');
  check(briefText?.includes('Target audience=Business/Professionals'), 'extractBriefText: de/en Übersetzung');
  check(extractBriefText(null, 'de') === undefined, 'extractBriefText(null) → undefined');
});

// ── T6: Aufnahme-Checkliste aus vollem Ergebnis (de/en) ──────────────────────
await scenario('T6 Aufnahme-Anleitung: Set-up, Szenen+Zeiten, Text, Bild-Assets, Posting, Qualität (de/en)', async () => {
  const idea = JSON.parse(cleanIdeaPayload()) as TikTokIdeaResult;
  const planDe = buildTikTokRecordingPlan(idea, 'de');
  check(planDe !== null, 'de: Plan gebaut');
  const stepsDe = planDe!.plan.map((s) => s.action + ' ' + s.detail).join('\n');
  check(hasBits(stepsDe, ['Zubehör', 'Stativ', 'Requisiten']), 'de: Set-up/Zubehör enthalten');
  check(hasBits(stepsDe, ['Szene 1 aufnehmen', 'Szene 2 aufnehmen', 'Szene 3 aufnehmen']), 'de: Szenen-Reihenfolge');
  check(hasBits(stepsDe, ['0-2s', '2-12s', '12-30s']), 'de: Zeitangaben je Szene');
  check(stepsDe.includes('Sprich/blende in dieser Szene ein'), 'de: Text-Einsprüche je Szene');
  check(stepsDe.includes('Sprechtext & Einblendungen'), 'de: Sprechtext-Schritt');
  check(stepsDe.includes('Image-Studio'), 'de: Bild-Assets via Image-Studio');
  check(stepsDe.includes('Produktfoto, warmes Licht, Keramikbecher mit Dampf'), 'de: konkreter studioPrompt interpoliert');
  check(hasBits(stepsDe, ['Titel:', 'Caption:', 'Hashtags:', 'CTA:']), 'de: Posting-Liste (Titel/Caption/Hashtags/CTA)');
  check(stepsDe.includes('Qualitäts-Check'), 'de: Qualitäts-Checkliste');
  check(stepsDe.toLowerCase().includes('erfundenen kennzahlen') && stepsDe.includes('Hook'), 'de: Qualitäts-Check nennt Ehrlichkeits-Punkte');
  check(planDe!.assetRef === idea.hook.slice(0, 120), 'assetRef = Hook');
  check(planDe!.ruleVersion === 1, 'ruleVersion 1');

  const planEn = buildTikTokRecordingPlan(idea, 'en');
  const stepsEn = planEn!.plan.map((s) => s.action + ' ' + s.detail).join('\n');
  check(planEn !== null && planEn!.plan.length >= 8, 'en: Plan gebaut');
  check(hasBits(stepsEn, ['Prepare gear', 'Record scene 1 (0-2s)', 'overlay', 'Image Studio', 'Title:', 'Caption:', 'Hashtags:', 'Quality check']), 'en: alle Kategorien in englischer Form');
  check(!stepsEn.includes('Zubehör'), 'en: keine deutschen Texte');
});

// ── T7: Fallback + Diagnose → null ───────────────────────────────────────────
await scenario('T7 Aufnahme-Anleitung: Fallback (altes Ergebnis) + Diagnose → null', async () => {
  const old = JSON.parse(cleanIdeaPayload()) as TikTokIdeaResult;
  delete (old as Partial<TikTokIdeaResult>).timedScenes;
  delete (old as Partial<TikTokIdeaResult>).imageIdeas;
  const plan = buildTikTokRecordingPlan(old, 'de');
  check(plan !== null, 'altes Ergebnis (ohne timedScenes/imageIdeas) → Plan gebaut (Fallback)');
  check(plan!.plan.some((s) => s.action.includes('Szene 3 aufnehmen')), 'Fallback: Szenenliste als Reihenfolge');
  const nullPlan = buildTikTokRecordingPlan(null, 'de');
  check(nullPlan === null, 'null → null');
  const diag = JSON.parse(cleanDiagnosePayload(true)) as TikTokDiagnoseResult;
  const diagPlan = buildTikTokRecordingPlan(diag as unknown as TikTokIdeaResult, 'de');
  check(diagPlan === null, 'Diagnose-Ergebnis → null (nur Idee-Ergebnisse)');
});

// ── T8: metric-guard auf Idee-Output, de + en ────────────────────────────────
await scenario('T8 metric-guard: „50% häufiger" + „10k Follower gewachsen" → entfernt/neutralisiert (de + en)', async () => {
  currentResponder = () => fakeMetricIdeaPayload(true);
  const resDe = await generateTikTok({ mode: 'todayIdea', biz: 'Handgemachte Keramikbecher', goal: 'Community', audience: 'kreative ab 25' }, 'de');
  const rDe = resDe as TikTokIdeaResult;
  const blobDe = [rDe.idea, rDe.caption, rDe.why].join(' ');
  check(!blobDe.includes('50%'), 'de: „50%" entfernt');
  check(!blobDe.includes('10k'), 'de: „10k" entfernt');
  check(!blobDe.includes('10k Follower'), 'de: „10k Follower" nicht mehr vorhanden');
  check(guardCalls >= 1, `de: Guard wurde aufgerufen (${guardCalls} guard call(s))`);
  check(attemptCounter >= 2, `de: LLM-Calls = Generierung + Guard (${attemptCounter} total)`);

  currentResponder = () => fakeMetricIdeaPayload(false);
  const resEn = await generateTikTok({ mode: 'todayIdea', biz: 'Handmade ceramic mugs with scented candles', goal: 'Community', audience: 'creative women 25+' }, 'en');
  const rEn = resEn as TikTokIdeaResult;
  const blobEn = [rEn.idea, rEn.caption, rEn.why].join(' ');
  check(!blobEn.includes('50%'), 'en: „50%" entfernt');
  check(/10k\s*followers/i.test(blobEn) === false, 'en: „10k followers" nicht mehr vorhanden');
  check(guardCalls >= 1, `en: Guard wurde aufgerufen (${guardCalls} guard call(s))`);
});

// ── T9: metric-guard auf Diagnose-Output, de + en ────────────────────────────
await scenario('T9 metric-guard auf Diagnose: „50% häufiger" neutralisiert (de + en)', async () => {
  currentResponder = () => cleanDiagnosePayload(true);
  const metrics = { views: 1200, length: '31s', avgWatch: 8, likes: 55, comments: 3, shares: 9, profileVisits: 40 };
  const resDe = await generateTikTok({ mode: 'diagnose', biz: 'Handgemachte Keramikbecher', metrics }, 'de');
  const rDe = resDe as TikTokDiagnoseResult;
  check(!rDe.biggestProblem.includes('50%'), 'de: „50%" aus biggestProblem entfernt');
  check(rDe.biggestProblem.length > 10, 'de: Text daneben erhalten (nur die Zahl weg)');
  check(guardCalls >= 1, `de: Guard aufgerufen (${guardCalls})`);
  check(rDe.lengthRecommendation !== undefined, 'de: lengthRecommendation intakt');

  currentResponder = () => cleanDiagnosePayload(false);
  const resEn = await generateTikTok({ mode: 'diagnose', biz: 'Handmade ceramic mugs', metrics }, 'en');
  const rEn = resEn as TikTokDiagnoseResult;
  check(!rEn.biggestProblem.includes('50%'), 'en: „50%" aus biggestProblem entfernt');
});

// ── T10: i18n-Parität ────────────────────────────────────────────────────────
await scenario('T10 i18n-Parität de/en (alle tiktok_*-Keys) + neue Phase-4-Keys vorhanden', async () => {
  const de = (await import('./src/i18n/de')).de;
  const en = (await import('./src/i18n/en')).en;
  const dk = Object.keys(de);
  const ek = Object.keys(en);
  check(dk.length === ek.length, `gleiche Key-Anzahl (${dk.length})`);
  const onlyDe = dk.filter((k) => !ek.includes(k));
  const onlyEn = ek.filter((k) => !dk.includes(k));
  check(onlyDe.length === 0, `keine nur-de Keys: ${onlyDe.join(',') || '-'}`);
  check(onlyEn.length === 0, `keine nur-en Keys: ${onlyEn.join(',') || '-'}`);
  const newKeys = ['tiktok_project_label', 'tiktok_project_none', 'tiktok_project_hint', 'tiktok_project_loading', 'tiktok_result_recording', 'tiktok_result_recording_hint', 'tiktok_result_recording_done'];
  check(newKeys.every((k) => k in de && k in en), 'alle 7 neuen Phase-4-Keys in de UND en');
  check(typeof de.tiktok_result_recording === 'string' && typeof en.tiktok_result_recording === 'string', 'Phase-4-Keys sind Strings');
});

// ── Zusammenfassung ──────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`Phase 4: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log('  - ' + f));
  server.stop();
  process.exit(1);
}
console.log('ALL PHASE 4 TESTS PASSED');
server.stop();
process.exit(0);