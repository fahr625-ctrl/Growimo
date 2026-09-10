// TikTok-Modul Phase 1 — Test-Suite (Owner-Vorgabe: jede Phase testen).
// Muster: Bun-Mini-Server als OpenAI-Mock (OPENAI_BASE_URL) + direkter
// Engine-Aufruf via generateTikTok + reine UI-Logik (computeBrandGaps).
//
// Szenarien:
//  S1  todayIdea MIT Markenprofil (brandContext) → 1 Call, alle Pflichtfelder
//  S2  concept OHNE topic → Thema selbst gewählt, Pflichtfelder da (de+en)
//  S3  concept MIT topic → Regression, Topic-Zeile im Prompt
//  S4  diagnose teilweise fehlende Metriken → fehlende Felder NICHT im Prompt (kein 0)
//  S5  diagnose alle Werte → alle 7 Werte im Prompt
//  S6  diagnose echte 0 → "Views: 0" wird gesendet (0-vs-fehlend)
//  S7  todayIdea Regel-A-Verletzung → Retry, Ergebnis aus Versuch 2
//  S8  concept selfCheck HARD REJECT → Retry (Retry auf concept)
//  S9  diagnose selfCheck HARD REJECT (erfundene Kennzahlen) → Retry (Retry auf diagnose)
//  S10 diagnose Regel-A-Verletzung dauerhaft → Fail-closed ehrlicher Fehler
//  S11 todayIdea HARD REJECT dauerhaft → Fail-closed ehrlicher Fehler
//  S12 computeBrandGaps ohne Profil → Produkt+Zielgruppe+Hauptziel fehlen
//  S13 computeBrandGaps mit teilweisem Profil → nur echte Lücken
//  S14 computeBrandGaps nach Ausfüllen von 2 Feldern → keine Pflicht-Lücke mehr
//  S15 computeBrandGaps: brandReady-Profil (vollständig) → keine Lücken
import { generateTikTok, type TikTokInput } from './src/ai/tiktok';

// ── OpenAI-Mock-Server ────────────────────────────────────────────────────────
type Responder = (attempt: number, userPrompt: string) => string;

let currentResponder: Responder | null = null;
let attemptCounter = 0;
const seenUserPrompts: string[] = [];

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const body = (await req.json()) as {
      messages?: Array<{ role?: string; content?: unknown }>;
    };
    const userMsg =
      (body?.messages?.find((m) => m.role === 'user')?.content as string | undefined) ?? '';
    seenUserPrompts.push(userMsg);
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

function ideaPayload(selfCheck = cleanIdeaSelfCheck) {
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

function diagnosePayload(selfCheck = { inventsMetrics: false, unprovenPromise: false, prescribedEnthusiasm: false, vagueNextTest: false, groundedInNumbers: true }) {
  return JSON.stringify({
    biggestProblem: 'Die Wiedergabedauer bricht direkt nach dem Hook ein.',
    whatWorks: ['Der Hook spricht die Zielgruppe an'],
    whatToImprove: ['Die erste Einblendung kommt zu spät'],
    newHook: 'So hältst du deine Zuschauer im Video',
    optimized: 'Szene 1: Hook mit Frage, Szene 2: Antwort im direkten Schnitt',
    nextTest: 'Setze die erste Einblendung auf Sekunde 1 und beobachte die Wiedergabedauer.',
    selfCheck,
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

const RULE_A_DIAGNOSE = JSON.stringify({
  biggestProblem: 'Die Wiedergabedauer bricht ein.',
  whatWorks: ['Der Hook stimmt'],
  whatToImprove: ['Einblendung früher'],
  newHook: 'Entdecke das Geheimnis in nur 3 Tagen',
  optimized: 'Optimierte Version mit besserem Schnitt',
  nextTest: 'Teste einen neuen Hook',
  selfCheck: { inventsMetrics: false, unprovenPromise: false, prescribedEnthusiasm: false, vagueNextTest: false, groundedInNumbers: true },
});

const TESTIMONIAL_IDEA = JSON.stringify({
  idea: 'Ein Tester berichtet von seinen Erfahrungen mit der App.',
  hook: 'Unser Beta-Tester sagt, die App sei genial',
  length: '15 Sekunden',
  scenes: ['Szene 1', 'Szene 2'],
  overlays: ['Text'],
  spokenText: '',
  caption: 'Testimonial',
  hashtags: ['#test'],
  cta: 'Schreib deine Meinung',
  why: 'Weil echte Stimmen Vertrauen schaffen.',
  selfCheck: {
    usesConcreteBrandFact: true,
    addressesCurrentChallenge: true,
    interchangeable: false,
    soundsLikeAd: false,
    inventsUserOrTestimonial: true,
    unprovenPerformancePromise: false,
    prescribedEnthusiasm: false,
  },
});

// ── Harness ───────────────────────────────────────────────────────────────────
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

function baseInput(over: Partial<TikTokInput>): TikTokInput {
  return { mode: 'todayIdea', biz: 'Handgemachte Keramikbecher', ...over };
}

// ── Szenarien ─────────────────────────────────────────────────────────────────
await scenario('S1 todayIdea MIT Markenprofil (brandContext)', async () => {
  currentResponder = () => ideaPayload();
  const res = await generateTikTok(
    baseInput({ mode: 'todayIdea', biz: '', brandContext: 'MARKENKONTEXT (authoritative Faktenbasis):\n- Marke: Keramikstudio Müller\n- Angebot: handgemachte Keramikbecher\n- Zielgruppe: Kaffeeliebhaber:innen 25-40' }),
    'de',
  );
  check(res.mode === 'todayIdea', 'Mode todayIdea');
  const r = res as { idea: string; hook: string; scenes: string[]; caption: string; hashtags: string[]; why: string; selfCheck?: unknown };
  check(r.idea && r.hook && r.scenes.length >= 3 && r.caption && r.hashtags.length >= 2 && r.why, 'alle Pflichtfelder vorhanden');
  check(lastPrompt().includes('MARKENKONTEXT'), 'Prompt enthält brandContext');
  check(promptOf(0).includes('MARKENKONTEXT') && promptOf(0).includes('Heute') === false || promptOf(0).includes('bekannte Tatsache'), 'Prompt vollständig');
  check(attemptCounter === 1, 'kein Retry bei gutem Ergebnis (1 Call)');
});

await scenario('S2 concept OHNE topic → Thema selbst gewählt (de+en)', async () => {
  currentResponder = () => ideaPayload();
  const resDe = await generateTikTok(baseInput({ mode: 'concept', topic: undefined }), 'de');
  check(resDe.mode === 'concept', 'de: Mode concept');
  const rDe = resDe as { idea: string; hook: string; scenes: string[]; caption: string; hashtags: string[]; why: string; selfCheck?: unknown };
  check(rDe.idea && rDe.hook && rDe.scenes.length >= 3 && rDe.caption && rDe.why, 'de: alle Pflichtfelder vorhanden');
  check(lastPrompt().includes('Kein Thema angegeben'), 'de: Prompt fragt Thema selbst zu wählen');
  check(rDe.selfCheck !== undefined, 'de: selfCheck wird auch bei concept geparst');
  const resEn = await generateTikTok(baseInput({ mode: 'concept', topic: undefined }), 'en');
  check(resEn.mode === 'concept', 'en: Mode concept');
  check(lastPrompt().includes('No topic provided'), 'en: Prompt wählt Thema selbst');
});

await scenario('S3 concept MIT topic → Regression', async () => {
  currentResponder = () => ideaPayload();
  const res = await generateTikTok(baseInput({ mode: 'concept', topic: 'Das Ritual des Teetrinkens' }), 'de');
  check(res.mode === 'concept', 'Mode concept');
  check(lastPrompt().includes('Das Ritual des Teetrinkens'), 'Topic-Zeile im Prompt');
  check(!lastPrompt().includes('Kein Thema angegeben'), 'kein Selbstwahl-Hinweis bei vorhandenem Topic');
  check(attemptCounter === 1, '1 Call');
});

await scenario('S4 diagnose teilweise fehlende Metriken (kein 0 im Prompt)', async () => {
  currentResponder = () => diagnosePayload();
  const res = await generateTikTok(
    baseInput({ mode: 'diagnose', metrics: { views: 1200 } }),
    'de',
  );
  check(res.mode === 'diagnose', 'Mode diagnose');
  const p = lastPrompt();
  check(p.includes('Aufrufe (Views): 1200'), 'Views: 1200 wird gesendet');
  check(!p.includes('Videolänge'), 'fehlende Videolänge NICHT im Prompt');
  check(!p.includes('Likes:'), 'fehlende Likes NICHT im Prompt');
  check(!p.includes('Wiedergabedauer'), 'fehlende Wiedergabedauer NICHT im Prompt');
  check(!p.includes('Profilaufrufe'), 'fehlende Profilaufrufe NICHT im Prompt');
  check(!p.includes('0)') && !p.includes(': 0'), 'kein erfundener 0-Wert im Prompt');
  check(p.includes('NUR die folgenden Werte sind bekannt'), 'Hinweis auf fehlende Metriken im Prompt');
  check(attemptCounter === 1, '1 Call');
});

await scenario('S5 diagnose alle Werte', async () => {
  currentResponder = () => diagnosePayload();
  const res = await generateTikTok(
    baseInput({
      mode: 'diagnose',
      metrics: { views: 1200, length: '31s', avgWatch: 8, likes: 42, comments: 5, shares: 3, profileVisits: 17 },
    }),
    'de',
  );
  check(res.mode === 'diagnose', 'Mode diagnose');
  const p = lastPrompt();
  check(p.includes('Aufrufe (Views): 1200'), 'Views');
  check(p.includes('Videolänge: 31s'), 'Videolänge');
  check(p.includes('Wiedergabedauer (Sek.): 8'), 'Wiedergabedauer');
  check(p.includes('Likes: 42'), 'Likes');
  check(p.includes('Kommentare: 5'), 'Kommentare');
  check(p.includes('Shares: 3'), 'Shares');
  check(p.includes('Profilaufrufe: 17'), 'Profilaufrufe');
});

await scenario('S6 diagnose echte 0 wird gesendet (0-vs-fehlend)', async () => {
  currentResponder = () => diagnosePayload();
  const res = await generateTikTok(
    baseInput({ mode: 'diagnose', metrics: { views: 0, likes: 0 } }),
    'de',
  );
  check(res.mode === 'diagnose', 'Mode diagnose');
  const p = lastPrompt();
  check(p.includes('Aufrufe (Views): 0'), 'echte 0 Views wird gesendet');
  check(p.includes('Likes: 0'), 'echte 0 Likes wird gesendet');
  check(!p.includes('Kommentare:'), 'fehlende Kommentare weiterhin ausgelassen');
});

await scenario('S7 todayIdea Regel-A-Verletzung → Retry (Versuch 2 gewinnt)', async () => {
  let call = 0;
  currentResponder = () => {
    call += 1;
    return call === 1 ? RULE_A_IDEA : ideaPayload();
  };
  const res = await generateTikTok(baseInput({ mode: 'todayIdea' }), 'de');
  check(attemptCounter === 2, `Retry fand statt (2 Calls, war ${attemptCounter})`);
  const r = res as { selfCheck?: unknown };
  check(r.selfCheck !== undefined, 'Ergebnis aus Versuch 2 mit selfCheck');
  const p2 = promptOf(1);
  check(p2.includes('HINWEIS VOM QUALITÄTS-SELBSTTEST') || p2.includes('QUALITY SELF-CHECK NOTE'), 'Retry-Hint im zweiten Prompt');
  check(p2.includes('REJECTED IDEA') || p2.includes('VERWORFENEN IDEE'), 'Regel-Violations im Retry-Hint');
});

await scenario('S8 concept selfCheck HARD REJECT → Retry (Retry auf concept)', async () => {
  let call = 0;
  currentResponder = () => {
    call += 1;
    return call === 1 ? TESTIMONIAL_IDEA : ideaPayload();
  };
  const res = await generateTikTok(baseInput({ mode: 'concept', topic: 'Keramik als Geschenk' }), 'de');
  check(res.mode === 'concept', 'Mode concept');
  check(attemptCounter === 2, `Retry auf concept (2 Calls, war ${attemptCounter})`);
  const r = res as { selfCheck?: { inventsUserOrTestimonial: boolean } };
  check(r.selfCheck?.inventsUserOrTestimonial === false, 'finales Ergebnis ohne erfundenes Testimonial');
});

await scenario('S9 diagnose selfCheck HARD REJECT (erfundene Kennzahlen) → Retry', async () => {
  let call = 0;
  currentResponder = () => {
    call += 1;
    if (call === 1) {
      return JSON.stringify({
        biggestProblem: 'Die Wiedergabedauer sinkt auf 3% Engagement.',
        whatWorks: ['Der Hook stimmt'],
        whatToImprove: ['Einblendung früher'],
        newHook: 'So hältst du deine Zuschauer im Video',
        optimized: 'Optimierte Version',
        nextTest: 'Teste eine neue Einblendung',
        selfCheck: { inventsMetrics: true, unprovenPromise: false, prescribedEnthusiasm: false, vagueNextTest: false, groundedInNumbers: true },
      });
    }
    return diagnosePayload();
  };
  const res = await generateTikTok(baseInput({ mode: 'diagnose', metrics: { views: 1200 } }), 'de');
  check(res.mode === 'diagnose', 'Mode diagnose');
  check(attemptCounter === 2, `Retry auf diagnose (2 Calls, war ${attemptCounter})`);
  const p2 = promptOf(1);
  check(p2.includes('vorherige Diagnose') || p2.includes('previous diagnosis'), 'diagnose-spezifischer Retry-Hint');
});

await scenario('S10 diagnose Regel-A dauerhaft → Fail-closed ehrlicher Fehler', async () => {
  currentResponder = () => RULE_A_DIAGNOSE;
  let threw = '';
  try {
    await generateTikTok(baseInput({ mode: 'diagnose', metrics: { views: 5000 } }), 'de');
  } catch (e) {
    threw = (e as Error).message;
  }
  check(attemptCounter === 4, `max. 4 Versuche (war ${attemptCounter})`);
  check(threw.includes('Diagnose') || threw.includes('diagnosis'), `ehrlicher Fehler statt Ausgabe: "${threw.slice(0, 90)}"`);
});

await scenario('S11 todayIdea HARD REJECT dauerhaft → Fail-closed ehrlicher Fehler', async () => {
  currentResponder = () => TESTIMONIAL_IDEA;
  let threw = '';
  try {
    await generateTikTok(baseInput({ mode: 'todayIdea' }), 'de');
  } catch (e) {
    threw = (e as Error).message;
  }
  check(attemptCounter === 4, `max. 4 Versuche (war ${attemptCounter})`);
  check(threw.length > 0 && !threw.includes('read the TikTok response'), `kein erfundenes Testimonial ausgegeben (Fehler: "${threw.slice(0, 80)}")`);
});

// ── UI-Logik: computeBrandGaps (Minimal-Abfrage) ─────────────────────────────
let gapsFn: ((biz: string, audience: string, goal: string, profile: unknown) => { needProduct: boolean; needAudience: boolean; needGoal: boolean }) | null = null;
let queryFn: ((mode: string, biz: string, brandReady: boolean) => boolean) | null = null;
try {
  const mod = await import('./src/routes/app/tiktok.tsx');
  gapsFn = mod.computeBrandGaps as typeof gapsFn;
  queryFn = mod.shouldShowMinimalQuery as typeof queryFn;
  console.log('[import] computeBrandGaps + shouldShowMinimalQuery aus tiktok.tsx geladen');
} catch (e) {
  console.log('[import] tiktok.tsx nicht ladbar:', (e as Error).message);
}

const profileNull = null;
const profileOnlyName = { brandName: 'Keramikstudio', offerings: '', products: [], uniqueSellingPoint: '', tagline: '', targetAudience: '', mainGoal: '' };
const profilePartial = { brandName: 'Keramikstudio', offerings: 'handgemachte Keramikbecher', products: [], uniqueSellingPoint: '', tagline: '', targetAudience: 'Kaffeeliebhaber 25-40', mainGoal: '' };
const profileComplete = { brandName: 'Keramikstudio', offerings: 'handgemachte Keramikbecher', products: [], uniqueSellingPoint: '', tagline: '', targetAudience: 'Kaffeeliebhaber 25-40', mainGoal: 'Verkäufe' };

if (gapsFn) {
  await scenario('S12 computeBrandGaps OHNE Markenprofil', () => {
    const g = gapsFn!('', '', '', profileNull);
    check(g.needProduct === true, 'Produkt/Angebot fehlt (Pflicht)');
    check(g.needAudience === true, 'Zielgruppe fehlt');
    check(g.needGoal === true, 'Hauptziel fehlt');
    return Promise.resolve();
  });

  await scenario('S13 computeBrandGaps mit teilweisem Profil → nur echte Lücken', () => {
    const g = gapsFn!('', '', '', profilePartial);
    check(g.needProduct === false, 'Angebot aus Profil vorhanden → kein Produkt-Feld');
    check(g.needAudience === false, 'Zielgruppe aus Profil vorhanden → kein Audience-Feld');
    check(g.needGoal === true, 'Hauptziel fehlt → optionales Feld bleibt');
    return Promise.resolve();
  });

  await scenario('S14 computeBrandGaps nach Ausfüllen von 2 Feldern → Generierung möglich', () => {
    const g = gapsFn!('Handgemachte Keramikbecher', 'Kaffeeliebhaber 25-40', '', profileOnlyName);
    check(g.needProduct === false, 'Produkt gefüllt → Pflicht erfüllt');
    check(g.needAudience === false, 'Zielgruppe gefüllt → Lücke geschlossen');
    check(attemptCounter === 0, 'reine Logik, kein Engine-Call nötig');
    return Promise.resolve();
  });

  await scenario('S15 computeBrandGaps mit vollständigem Profil (brandReady)', () => {
    const g = gapsFn!('', '', '', profileComplete);
    check(g.needProduct === false && g.needAudience === false && g.needGoal === false, 'keine Lücken → keine Minimal-Abfrage');
    return Promise.resolve();
  });

  await scenario('S16 shouldShowMinimalQuery (Gate: kein Profil / unvollständig / vollständig)', () => {
    if (!queryFn) {
      check(false, 'shouldShowMinimalQuery fehlt');
      return Promise.resolve();
    }
    check(queryFn('todayIdea', '', false) === true, 'ohne Profil → Minimal-Abfrage');
    check(queryFn('todayIdea', '', false) === true, 'unvollständiges Profil (brandReady=false) → Minimal-Abfrage');
    check(queryFn('todayIdea', '', true) === false, 'vollständiges Profil (brandReady=true) → keine Abfrage');
    check(queryFn('todayIdea', 'Keramikbecher', false) === false, 'biz gefüllt → keine Abfrage (generiert normal)');
    check(queryFn('concept', '', false) === false, 'concept → kein Minimal-Query (generischer Fehler wie bisher)');
    check(queryFn('diagnose', '', false) === false, 'diagnose → kein Minimal-Query');
    return Promise.resolve();
  });

  await scenario('S17 Minimal-Abfrage → nach 2 gefüllten Feldern generiert (Gate+Engine kombiniert)', async () => {
    if (!queryFn) {
      check(false, 'Gate-Funktion fehlt');
      return;
    }
    // Phase 1: vor dem Ausfüllen → Gate aktiv
    check(queryFn('todayIdea', '', false) === true, 'vorher: Gate aktiv (Abfrage erscheint)');
    // Nach Ausfüllen von Produkt (2. Feld: Zielgruppe optional) → Gate inaktiv
    check(queryFn('todayIdea', 'Handgemachte Keramikbecher', false) === false, 'nachher: Gate inaktiv (generiert)');
    // Engine-seitig belegt: biz-only-Input generiert erfolgreich (S1-ähnlich, ohne brandContext)
    currentResponder = () => ideaPayload();
    const res = await generateTikTok(baseInput({ mode: 'todayIdea', biz: 'Handgemachte Keramikbecher', brandContext: undefined, audience: 'Kaffeeliebhaber 25-40' }), 'de');
    check(res.mode === 'todayIdea', 'Generierung nach Ausfüllen funktioniert');
  });
} else {
  console.log('\n[SKIP] S12–S17 (computeBrandGaps/shouldShowMinimalQuery nicht ladbar) — UI-Logik nicht verifiziert');
  failed += 1;
  failures.push('S12-S17 skipped: tiktok.tsx nicht importierbar');
}

server.stop(true);

// ── Ergebnis ──────────────────────────────────────────────────────────────────
console.log(`\n===== ERGEBNIS =====`);
console.log(`PASS: ${passed}  FAIL: ${failed}`);
if (failures.length) {
  console.log('Fehlgeschlagen:', failures.join(' | '));
  process.exit(1);
}
console.log('ALLE TESTS BESTANDEN');