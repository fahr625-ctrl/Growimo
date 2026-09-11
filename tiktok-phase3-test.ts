// TikTok-Modul Phase 3 — „Diagnose-Schärfung" (lengthRecommendation mit
// Zahlenbegründung, deterministische Retention-Rechnung, Pflichtfelder
// views+length+avgWatch, ehrlicher „zu wenig Daten"-Zustand).
// Muster wie Phase 1/2: Bun-Mini-Server als OpenAI-Mock (OPENAI_BASE_URL) +
// generateTikTok + reine Retention-Funktionen + UI-Validierungs-Helfer.
import {
  generateTikTok,
  computeRetention,
  diagnoseRetentionGaps,
  parseLengthSeconds,
  type TikTokInput,
  type TikTokDiagnoseSelfCheck,
} from './src/ai/tiktok';
import { missingDiagnoseMetrics } from './src/routes/app/tiktok.tsx';

// ── OpenAI-Mock-Server (wie Phase 1/2) ────────────────────────────────────────
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

/** Vollständige Phase-3-Diagnose inkl. lengthRecommendation (Reason referenziert
 *  die berechnete Retention: 16s / 42s = 38,1 %). */
function fullDiagnosePayload(sc: TikTokDiagnoseSelfCheck = cleanDiagSelfCheck, reasonOverride?: string) {
  return JSON.stringify({
    biggestProblem: 'Die Bindung bricht nach dem Hook ein: Durchschnittlich werden nur 16s von 42s gesehen (38,1% Watch-Rate).',
    whatWorks: ['2500 Aufrufe zeigen, dass der Hook Klicks anzieht'],
    whatToImprove: ['Die erste Einblendung kommt zu spät', 'Der Mittelteil verliert Tempo'],
    newHook: 'So hältst du deine Zuschauer ab Sekunde 1 im Video',
    optimized: 'Szene 1: Hook-Frage in Sekunde 0-1, Szene 2: Antwort im direkten Schnitt, Szene 3: Call-to-Action',
    nextTest: 'Setze die erste Einblendung auf Sekunde 1 und beobachte die Watch-Rate.',
    lengthRecommendation: {
      seconds: 25,
      structure: '0-2s: Hook-Frage, 2-18s: Kern-Inhalt mit dem Fix, 18-25s: Call-to-Action',
      reason:
        reasonOverride ??
        'Basierend auf deinen 2500 Views und 38,1% Watch-Rate bei 42s Länge (16s durchschnittliche Wiedergabedauer) bricht die Aufmerksamkeit früh ein — kürze auf 25 Sekunden und setze die Kern-Szene in die ersten 10 Sekunden.',
    },
    selfCheck: sc,
  });
}

/** T4-Variante: Diagnose-Payload konsistent zu 0-Views-Eingabe (alle Zahlen sind
 *  Nutzer-Metriken views=0/length=42s/avgWatch=0 → metric-guard Fast-Path). */
function zeroDiagnosePayload() {
  return JSON.stringify({
    biggestProblem: 'Die Bindung bricht nach dem Hook ein: Durchschnittlich werden nur 0s von 42s gesehen (0,0% Watch-Rate).',
    whatWorks: ['0 Aufrufe sind die Ausgangsbasis'],
    whatToImprove: ['Die erste Einblendung kommt zu spät'],
    newHook: 'So hältst du deine Zuschauer ab Sekunde 1 im Video',
    optimized: 'Szene 1: Hook, Szene 2: Antwort, Szene 3: CTA',
    nextTest: 'Setze die erste Einblendung auf Sekunde 1 und beobachte die Watch-Rate.',
    lengthRecommendation: {
      seconds: 20,
      structure: '0-2s: Hook, 2-16s: Inhalt, 16-20s: CTA',
      reason: 'Basierend auf deinen 0 Views und 0,0% Watch-Rate bei 42s Länge — kürze auf 20 Sekunden.',
    },
    selfCheck: cleanDiagSelfCheck,
  });
}

/** Alte Diagnose OHNE lengthRecommendation (Parser-Fallback / Regression). */
function oldDiagnosePayload() {
  return JSON.stringify({
    biggestProblem: 'Die Wiedergabedauer bricht direkt nach dem Hook ein.',
    whatWorks: ['Der Hook spricht die Zielgruppe an'],
    whatToImprove: ['Die erste Einblendung kommt zu spät', 'Der Mittelteil verliert an Tempo'],
    newHook: 'So hältst du deine Zuschauer im Video',
    optimized: 'Szene 1: Hook mit Frage, Szene 2: Antwort im direkten Schnitt',
    nextTest: 'Setze die erste Einblendung auf Sekunde 1 und beobachte die Wiedergabedauer.',
    selfCheck: { inventsMetrics: false, unprovenPromise: false, prescribedEnthusiasm: false, vagueNextTest: false, groundedInNumbers: true, lengthGrounded: true },
  });
}

function baseInput(over: Partial<TikTokInput>): TikTokInput {
  return { mode: 'todayIdea', biz: 'Handgemachte Keramikbecher', ...over };
}
const fullMetrics = { views: 2500, length: '42s', avgWatch: 16 };

// ── Harness ───────────────────────────────────────────────────────────────────
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
const promptOf = (i: number) => seenUserPrompts[i] ?? '';

// ── T1: diagnose mit allen Retentions-Werten → lengthRecommendation + Retention im Prompt (de)
await scenario('T1 diagnose mit views+length+avgWatch (de) → lengthRecommendation mit Zahlenbegründung', async () => {
  currentResponder = () => fullDiagnosePayload();
  const res = await generateTikTok(baseInput({ mode: 'diagnose', metrics: fullMetrics }), 'de');
  check(res.mode === 'diagnose', 'Mode diagnose');
  const r = res as { lengthRecommendation?: { seconds: number; structure: string; reason: string }; biggestProblem: string };
  check(r.biggestProblem.length > 0, 'vorge Diagnose-Felder vorhanden');
  check(r.lengthRecommendation !== undefined, 'lengthRecommendation vorhanden');
  check(r.lengthRecommendation?.seconds === 25, 'seconds geparst (25)');
  check(typeof r.lengthRecommendation?.structure === 'string' && r.lengthRecommendation.structure.includes('0-2s'), 'structure mit Zeitangaben (Hook-Phase)');
  check(typeof r.lengthRecommendation?.reason === 'string' && r.lengthRecommendation.reason.includes('38,1%'), 'reason referenziert die berechnete Watch-Rate');
  check(r.lengthRecommendation.reason.includes('2500 Views'), 'reason referenziert die Nutzer-Views');
  const p = lastPrompt();
  check(p.includes('Berechnete Retention'), 'Prompt enthält den deterministischen Retention-Block');
  check(p.includes('Watch-Rate: 16 / 42 = 38,1 %'), 'Prompt enthält die berechnete Watch-Rate (38,1 %)');
  check(p.includes('Gesamte Watch-Sekunden: 2.500 × 16 = 40.000'), 'Prompt enthält die totale Watch-Sekunden (2.500 × 16 = 40.000)');
  check(p.includes('Durchschnittliche Wiedergabedauer: 16 Sekunden'), 'Prompt enthält die Nutzer-Wiedergabedauer');
  check(attemptCounter === 1, '1 Call (kein Retry)');
});

// ── T2: diagnose OHNE avgWatch → ehrlicher „zu wenig Daten"-Zustand, KEIN LLM
await scenario('T2 diagnose OHNE avgWatch → ehrlicher dataGap-Zustand statt geratener Länge', async () => {
  currentResponder = () => fullDiagnosePayload();
  const res = await generateTikTok(
    baseInput({ mode: 'diagnose', metrics: { views: 2500, length: '42s' } }),
    'de',
  );
  check(res.mode === 'diagnose', 'Mode diagnose');
  check('dataGap' in res && (res as { dataGap?: boolean }).dataGap === true, 'dataGap === true (kein geratener Länge-Wert)');
  const g = res as { missingMetrics: string[]; note: string; cta: string };
  check(Array.isArray(g.missingMetrics) && g.missingMetrics.includes('avgWatch'), 'missingMetrics nennt avgWatch');
  check(g.note.includes('durchschnittliche Wiedergabedauer'), 'note nennt die fehlende Wiedergabedauer');
  check(g.note.includes('bewusst nicht'), 'note: Growimo rät bewusst nicht (keine erfundene Zahl)');
  check(g.cta.includes('durchschnittliche Wiedergabedauer'), 'cta sagt, welches Feld zu ergänzen ist');
  check(!('lengthRecommendation' in g), 'kein lengthRecommendation (keine erfundene Länge)');
  check(attemptCounter === 0, 'KEIN LLM-Call (deterministisch, ohne OpenAI)');
});

// ── T3: diagnose OHNE length → ebenso; auch ungültige Länge ('abc') zählt als fehlend
await scenario('T3 diagnose OHNE length → dataGap (auch bei unparsbarer Länge)', async () => {
  const r1 = (await generateTikTok(
    baseInput({ mode: 'diagnose', metrics: { views: 2500, avgWatch: 16 } }),
    'de',
  )) as { dataGap?: boolean; missingMetrics?: string[]; note?: string };
  check(r1.dataGap === true && r1.missingMetrics?.includes('length'), 'fehlende Videolänge → dataGap mit length');
  check(r1.note?.includes('Videolänge') === true, 'note nennt Videolänge');
  const r2 = (await generateTikTok(
    baseInput({ mode: 'diagnose', metrics: { views: 2500, length: 'abc', avgWatch: 16 } }),
    'de',
  )) as { dataGap?: boolean; missingMetrics?: string[] };
  check(r2.dataGap === true && r2.missingMetrics?.includes('length'), 'unparsbare Länge ("abc") zählt als fehlend (kein Raten)');
  check(attemptCounter === 0, 'KEIN LLM-Call');
});

// ── T4: diagnose mit echten 0-Werten → volle Diagnose, Retention kommt mit 0 klar
await scenario('T4 diagnose mit echten 0-Werten (views=0, avgWatch=0) → volle Diagnose, kein Div-by-0', async () => {
  currentResponder = () => zeroDiagnosePayload();
  const res = await generateTikTok(
    baseInput({ mode: 'diagnose', metrics: { views: 0, length: '42s', avgWatch: 0 } }),
    'de',
  );
  const r = res as { dataGap?: boolean; lengthRecommendation?: unknown; biggestProblem: string };
  check(res.mode === 'diagnose' && r.dataGap === undefined, '0-Werte gelten nicht als fehlend (kein dataGap)');
  check(r.lengthRecommendation !== undefined, 'lengthRecommendation vorhanden');
  const p = lastPrompt();
  check(p.includes('Aufrufe (Views): 0'), 'echte 0 Views im Prompt');
  check(p.includes('0 / 42 = 0,0 %'), 'Watch-Rate 0% korrekt berechnet (keine Division durch 0)');
  check(p.includes('Gesamte Watch-Sekunden: 0 × 0 = 0'), 'totale Watch-Sekunden 0 (reine Multiplikation)');
  check(attemptCounter === 1, '1 Call');
  // Unit-Ebene: computeRetention mit 0-Werten
  const rUnit = computeRetention({ views: 0, length: '42s', avgWatch: 0 });
  check(rUnit !== null && rUnit.watchRatePct === 0 && rUnit.totalWatchSeconds === 0, 'computeRetention: views/avgWatch 0 → 0% und 0 Watch-Sekunden (kein NaN)');
});

// ── T5: Retention-Funktionen (Unit-Tests: parsen, Div-by-0-Guard, korrekte Rechnung)
await scenario('T5 Retention-Funktionen: parseLengthSeconds / computeRetention / diagnoseRetentionGaps', async () => {
  check(parseLengthSeconds('42s') === 42, "parseLengthSeconds('42s') = 42");
  check(parseLengthSeconds('42 Sekunden') === 42, "parseLengthSeconds('42 Sekunden') = 42");
  check(parseLengthSeconds('0:42') === 42, "parseLengthSeconds('0:42') = 42");
  check(parseLengthSeconds('1:05') === 65, "parseLengthSeconds('1:05') = 65");
  check(parseLengthSeconds('42') === 42, "parseLengthSeconds('42') = 42");
  check(parseLengthSeconds('abc') === undefined, "parseLengthSeconds('abc') = undefined (kein Raten)");
  check(parseLengthSeconds('0s') === undefined, "parseLengthSeconds('0s') = undefined (Division durch 0 vermeiden)");
  check(parseLengthSeconds('') === undefined && parseLengthSeconds(undefined) === undefined, 'leere/fehlende Länge = undefined');

  check(computeRetention({ views: 2500, length: '42s', avgWatch: 16 })?.watchRatePct === 38.1, 'computeRetention: 16/42 = 38,1 %');
  check(computeRetention({ views: 2500, length: '42s', avgWatch: 16 })?.totalWatchSeconds === 40000, 'computeRetention: 2500 × 16 = 40.000 Watch-Sekunden');
  const zero = computeRetention({ views: 0, length: '42s', avgWatch: 0 });
  check(zero !== null && zero.watchRatePct === 0 && zero.totalWatchSeconds === 0 && Number.isFinite(zero.watchRatePct), 'computeRetention: 0-Werte → 0/0%-Zustand, kein NaN/Infinity');
  check(computeRetention({ views: 5, length: '0s', avgWatch: 1 }) === null, 'Division-durch-0-Guard: length 0s → null');
  check(computeRetention({ views: 5, avgWatch: 1 }) === null, 'Division-durch-0-Guard: fehlende Länge → null');
  check(computeRetention({ views: undefined, length: '42s', avgWatch: 1 }) === null, 'fehlende views → null');
  check(computeRetention(undefined) === null, 'keine Metriken → null');

  check(JSON.stringify(diagnoseRetentionGaps(undefined)) === '["views","length","avgWatch"]', 'diagnoseRetentionGaps(undefined) = alle 3');
  check(JSON.stringify(diagnoseRetentionGaps({ views: 0, length: '42s', avgWatch: 0 })) === '[]', 'diagnoseRetentionGaps(0-Werte) = leer (0 ist echte 0)');
  check(JSON.stringify(diagnoseRetentionGaps({ views: 2500, length: '42s' })) === '["avgWatch"]', 'diagnoseRetentionGaps(ohne avgWatch) = ["avgWatch"]');
  check(JSON.stringify(diagnoseRetentionGaps({ views: 2500, length: 'abc', avgWatch: 16 })) === '["length"]', 'diagnoseRetentionGaps(unparsbare Länge) = ["length"]');
});

// ── T6: UI-Validierung (tiktok.tsx Helfer) + Server-Validator (Quelle + geteilte Logik)
await scenario('T6 Pflichtfeld-Validierung: UI-Helfer + Server-Validator', async () => {
  check(JSON.stringify(missingDiagnoseMetrics({ views: '', length: '', avgWatch: '' })) === '["views","length","avgWatch"]', 'UI: alle drei fehlen → alle 3 gemeldet');
  check(JSON.stringify(missingDiagnoseMetrics({ views: '1200', length: '42s', avgWatch: '' })) === '["avgWatch"]', 'UI: nur avgWatch fehlt → exakt avgWatch gemeldet');
  check(JSON.stringify(missingDiagnoseMetrics({ views: '1200', length: '42s', avgWatch: '16' })) === '[]', 'UI: vollständig → keine Meldung');
  check(JSON.stringify(missingDiagnoseMetrics({ views: '0', length: '42s', avgWatch: '0' })) === '[]', 'UI: echte 0-Werte gelten als angegeben');
  // Server-Validator: nutzt diagnoseRetentionGaps (getestet oben) + wirft klare
  // Fehlermeldung mit den exakten Feldern — Quell-Nachweis der verankerten Logik:
  const serverSrc = await Bun.file('./src/ai/server.ts').text();
  check(serverSrc.includes("import { diagnoseRetentionGaps } from './tiktok';"), 'Server: nutzt die getestete diagnoseRetentionGaps-Funktion');
  check(serverSrc.includes('Für eine fundierte TikTok-Diagnose fehlen:') && serverSrc.includes('A grounded TikTok diagnosis needs:'), 'Server: Fehlermeldung nennt die fehlenden Felder (de+en)');
  // UI bindet den Helfer in die run()-Validierung ein (Quell-Nachweis):
  const uiSrc = await Bun.file('./src/routes/app/tiktok.tsx').text();
  check(uiSrc.includes('missingDiagnoseMetrics(metrics)') && uiSrc.includes('tiktok_error_metrics.replace'), 'UI: run()-Validierung nutzt den Helfer + i18n-Join der fehlenden Felder');
});

// ── T7: Regression — diagnose mit allen Werten weiterhin voll funktional (en) + alte Outputs
await scenario('T7 Regression: diagnose mit allen Werten (en) + alter Output ohne lengthRecommendation', async () => {
  currentResponder = () => fullDiagnosePayload(cleanDiagSelfCheck, 'Based on your 2500 views and 38.1% watch rate at 42s length (16s average watch time), attention drops early — shorten to 25 seconds and put the key scene in the first 10 seconds.');
  const res = await generateTikTok(baseInput({ mode: 'diagnose', metrics: fullMetrics }), 'en');
  const r = res as { lengthRecommendation?: { reason: string }; dataGap?: boolean };
  check(r.dataGap === undefined && r.lengthRecommendation !== undefined, 'EN-Diagnose voll funktional mit lengthRecommendation');
  const p = lastPrompt();
  check(p.includes('Calculated retention') && p.includes('Watch rate: 16 / 42 = 38.1%'), 'EN-Prompt: Retention-Block mit 38.1%');
  check(r.lengthRecommendation.reason.includes('38.1%'), 'EN-Output-Begründung (belegt an den Zahlen)');
  // Alter Output ohne lengthRecommendation: Parser-Fallback, kein Crash
  attemptCounter = 0;
  currentResponder = () => oldDiagnosePayload();
  const old = (await generateTikTok(baseInput({ mode: 'diagnose', metrics: fullMetrics }), 'de')) as {
    dataGap?: boolean; lengthRecommendation?: unknown; biggestProblem: string;
  };
  check(old.biggestProblem.length > 0 && old.lengthRecommendation === undefined && old.dataGap === undefined, 'alter Diagnose-Output: Parser-Fallback (kein lengthRecommendation, kein Crash)');
  // concept/todayIdea bleiben unberührt (Regressions-Smoke)
  attemptCounter = 0;
  currentResponder = () => JSON.stringify({
    idea: 'Wir zeigen Schritt für Schritt, wie ein kompletter Plan aus der App entsteht.',
    hook: 'Eine Idee. Ein kompletter Plan.',
    length: '15 Sekunden',
    format: 'Tutorial/How-to – Schritt für Schritt',
    title: 'So wird aus einer Idee ein Plan',
    timedScenes: [{ time: '0-2s', scene: 'App öffnen', text: 'Eine Idee' }, { time: '2-15s', scene: 'Ergebnis zeigen', text: '' }],
    scenes: ['Szene 1', 'Szene 2'],
    overlays: ['Eine Idee'],
    spokenText: 'Ich teste meine eigene Marketing-App.',
    caption: 'Ich habe meine eigene Marketing-App getestet.',
    hashtags: ['#marketing', '#contentplan'],
    cta: 'Was würdest du zuerst testen?',
    why: 'Weil die Szene eine echte Demonstration zeigt.',
    imageIdeas: [{ description: 'Cover', studioPrompt: 'Smartphone mit Marketing-App, Nahaufnahme, weicher Hintergrund' }],
    selfCheck: { usesConcreteBrandFact: true, addressesCurrentChallenge: true, interchangeable: false, soundsLikeAd: false, inventsUserOrTestimonial: false, unprovenPerformancePromise: false, prescribedEnthusiasm: false },
  });
  const concept = await generateTikTok(baseInput({ mode: 'concept' }), 'de');
  check(concept.mode === 'concept' && attemptCounter === 1, 'concept (Phase-2-Schema) unverändert: 1 Call');
  attemptCounter = 0;
  const today = await generateTikTok(baseInput({ mode: 'todayIdea' }), 'de');
  check(today.mode === 'todayIdea' && attemptCounter === 1, 'todayIdea unverändert: 1 Call');
});

// ── T8: Rules — erfundene Kennzahl in lengthRecommendation.reason → deterministischer Reject + Retry
await scenario('T8 Regel-A auf lengthRecommendation: "+50 % mehr Engagement" in reason → Reject + Retry', async () => {
  let call = 0;
  currentResponder = () => {
    call += 1;
    if (call === 1) {
      return fullDiagnosePayload(cleanDiagSelfCheck, 'Kürze auf 20 Sekunden: das bringt +50 % mehr Engagement.');
    }
    return fullDiagnosePayload();
  };
  const res = await generateTikTok(baseInput({ mode: 'diagnose', metrics: fullMetrics }), 'de');
  check(attemptCounter === 2, `Retry nach Regel-A-Treffer in lengthRecommendation.reason (2 Calls, war ${attemptCounter})`);
  const r = res as { lengthRecommendation?: { reason: string } };
  check(!r.lengthRecommendation?.reason.includes('+50 %'), 'finale Begründung ohne erfundene Kennzahl');
  check(promptOf(1).includes('REJECTED DIAGNOSIS') || promptOf(1).includes('VERWORFENEN DIAGNOSE'), 'Retry-Hint nennt die verworfenen Regeln');
});

// ── T9: selfCheck lengthGrounded=false → HARD-REJECT-Kriterium → Retry
await scenario('T9 selfCheck Q6 lengthGrounded=false → Reject + Retry (nur Zahlen-basierte Längenempfehlung)', async () => {
  let call = 0;
  currentResponder = () => {
    call += 1;
    if (call === 1) {
      return fullDiagnosePayload({ ...cleanDiagSelfCheck, lengthGrounded: false });
    }
    return fullDiagnosePayload();
  };
  const res = await generateTikTok(baseInput({ mode: 'diagnose', metrics: fullMetrics }), 'de');
  check(attemptCounter === 2, `Retry nach lengthGrounded=false (2 Calls, war ${attemptCounter})`);
  const r = res as { lengthRecommendation?: { reason: string }; selfCheck?: { lengthGrounded: boolean } };
  check(r.lengthRecommendation !== undefined, 'finale Diagnose mit lengthRecommendation');
  check(promptOf(1).includes('lengthRecommendation'), 'Retry-Hint verlangt die Längenempfehlung (lengthRecommendation) explizit');
});

// ── T10: diagnose OHNE views → dataGap (de+en zweisprachig)
await scenario('T10 diagnose OHNE views → dataGap; de+en für alle neuen Texte', async () => {
  const de = (await generateTikTok(baseInput({ mode: 'diagnose', metrics: { length: '42s', avgWatch: 16 } }), 'de')) as { dataGap?: boolean; note: string; cta: string };
  const en = (await generateTikTok(baseInput({ mode: 'diagnose', metrics: { length: '42s', avgWatch: 16 } }), 'en')) as { dataGap?: boolean; note: string; cta: string };
  check(de.dataGap === true && de.note.includes('Aufrufe (Views)') && de.cta.includes('Aufrufe (Views)'), 'DE: dataGap nennt Views als fehlend');
  check(en.dataGap === true && en.note.includes('Views') && en.cta.includes('Views'), 'EN: dataGap nennt Views als fehlend');
  check(!de.note.includes('42') && !en.note.includes('42'), 'keine erfundene Zahl in der Teil-Diagnose (auch keine Längenangabe)');
  // i18n-Parität der neuen UI-Texte (de/en je 1x vorhanden)
  const keys = ['tiktok_result_length_recommendation', 'tiktok_result_length_seconds', 'tiktok_result_length_structure', 'tiktok_result_length_reason', 'tiktok_data_gap_title', 'tiktok_data_gap_missing'];
  const deSrc = await Bun.file('./src/i18n/de.ts').text();
  const enSrc = await Bun.file('./src/i18n/en.ts').text();
  check(keys.every((k) => deSrc.includes(k) && enSrc.includes(k)), 'alle 6 neuen i18n-Keys in de.ts UND en.ts');
  // System-Prompt erwähnt das neue Feld + Q6 in beiden Sprachen (Quell-Nachweis)
  const tiktokSrc = await Bun.file('./src/ai/tiktok.ts').text();
  check(tiktokSrc.includes('lengthRecommendation (REQUIRED') && tiktokSrc.includes('lengthRecommendation (PFLICHT'), 'System-Prompt: lengthRecommendation Pflicht (de+en)');
  check(tiktokSrc.includes('Q6 - lengthGrounded') && tiktokSrc.includes('Q6 - lengthGrounded'), 'System-Prompt: SelfCheck Q6 lengthGrounded (de+en)');
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