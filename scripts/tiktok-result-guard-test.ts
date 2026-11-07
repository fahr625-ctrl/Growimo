// ── Suite: TikTok-Ergebnis-Guard (Härtung 2026-11-06) ────────────────────────
// Prüft, dass unvollständige/falsch typisierte GESPEICHERTE TikTok-Ergebnisse
// die Werkstatt nicht mehr sprengen: sie werden ignoriert (wie „kein Ergebnis"),
// gültige Ergebnisse gehen UNVERÄNDERT (Feld für Feld) an die Anzeige, und ein
// kaputter Eintrag macht die Liste „Zuletzt erstellt" nicht unbenutzbar.
//
// KEINE Netzwerk-, KI-, Stripe- oder DB-Zugriffe. Nur reine Funktionen +
// ein sessionStorage-Stub im Speicher.
//
// Usage: bun scripts/tiktok-result-guard-test.ts
/* eslint-disable no-console */

let PASS = 0;
let FAIL = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    PASS += 1;
    console.log(`  PASS  ${name}`);
  } else {
    FAIL += 1;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `erwartet ${e} / bekommen ${a}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────
/** Vollständiges Idee-Ergebnis (todayIdea/concept) — ALLE Felder inkl. der
 *  optionalen Phase-2-Felder. Dient als „gültig"-Referenz. */
function fullIdea() {
  return {
    mode: 'concept' as const,
    idea: 'Zeig, wie die Tasse in 3 Schritten entsteht — vom Tonklumpen bis zum Henkel.',
    hook: 'Diese Tasse war vor 20 Minuten noch ein Klumpen Ton.',
    length: '25-30 Sekunden',
    scenes: ['Ton kneten', 'Auf der Scheibe drehen', 'Henkel ansetzen', 'Brennen und glasieren'],
    overlays: ['Vorher: Tonklumpen', 'Jetzt: Tasse', 'Henkel in 8 Sekunden'],
    spokenText: 'Ich zeige dir in 25 Sekunden, wie aus Ton eine Tasse wird.',
    caption: 'Handgemacht in meiner Werkstatt. Jede Tasse ein Unikat.',
    hashtags: ['#keramik', '#handmade', '#toepfern', '#unikat'],
    cta: 'Schreib „TASSE" in die Kommentare, wenn du eine willst.',
    why: 'Der Vorher-Nachher-Kontrast in der ersten Sekunde stoppt den Scroll.',
    format: 'Prozess-Timelapse mit Hook in Sekunde 1',
    scrollStop: 'Ein Klumpen Ton fällt auf die Scheibe — Geräusch plus Nahaufnahme.',
    tension: 'Vom Klumpen zur fertigen Tasse, ohne Schnitt, mit Zeitraffer.',
    timedScenes: [
      { time: '0-2s', scene: 'Tonklumpen fällt auf die Drehscheibe', text: 'Das war vor 20 Minuten ein Klumpen Ton' },
      { time: '2-12s', scene: 'Hände formen die Tasse im Zeitraffer', text: '' },
      { time: '12-22s', scene: 'Henkel wird angesetzt', text: 'Henkel in 8 Sekunden' },
      { time: '22-30s', scene: 'Fertige Tasse auf dem Regal', text: '' },
    ],
    title: 'Tasse in 25 Sekunden? So entsteht sie wirklich',
    imageIdeas: [
      { description: 'Nahaufnahme Tonklumpen auf der Scheibe', studioPrompt: 'close-up of wet clay on a pottery wheel, warm window light, 9:16' },
      { description: 'Fertige Keramiktasse mit Duftkerze', studioPrompt: 'handmade ceramic mug with scented candle on wooden table, soft light, 9:16' },
    ],
    selfCheck: {
      usesConcreteBrandFact: true,
      addressesCurrentChallenge: false,
      interchangeable: false,
      soundsLikeAd: false,
      inventsUserOrTestimonial: false,
      unprovenPerformancePromise: false,
      prescribedEnthusiasm: false,
    },
  };
}

/** ALTFORMAT: Idee-Ergebnis OHNE die optionalen Phase-2-Felder (so sehen
 *  gespeicherte Ergebnisse aus früheren Versionen aus — sie MÜSSEN weiter
 *  rendern). */
function oldIdea() {
  const r = fullIdea() as Record<string, unknown>;
  // Eigener Idee-Text, damit der Listeneintrag NICHT mit dem vollständigen
  // Ergebnis dedupliziert wird (Eintrags-ID = Modus + Beschriftung).
  r.idea = 'Alte Idee aus einer früheren Version — ohne Zeitplan und Bildideen.';
  delete r.format;
  delete r.scrollStop;
  delete r.tension;
  delete r.timedScenes;
  delete r.title;
  delete r.imageIdeas;
  delete r.selfCheck;
  return r;
}

/** Vollständige Diagnose (inkl. rebuilt + lengthRecommendation). */
function fullDiagnose() {
  return {
    mode: 'diagnose' as const,
    videoTopic: 'Keramiktasse als Geschenk verpacken',
    biggestProblem: 'Der Hook startet erst bei Sekunde 4 — davor ist nur der Vorspann zu sehen.',
    whatWorks: ['Ruhiges Licht', 'Klares Produkt in der Mitte'],
    whatToImprove: ['Hook in Sekunde 1', 'Länge kürzen', 'CTA früher setzen'],
    newHook: 'Ich packe diese Tasse in 10 Sekunden geschenkfertig ein.',
    optimized: 'Starte mit der fertigen Schleife, schneide dann auf die Hände zurück und halte die 24 Sekunden.',
    nextTest: 'Teste Hook A gegen Hook B über 7 Tage und beobachte die 3-Sekunden-Watch-Rate.',
    rebuilt: {
      hook: 'Geschenkfertig in 10 Sekunden — ohne Klebeband.',
      timedScenes: [
        { time: '0-2s', scene: 'Fertige Schleife wird gedreht', text: 'Geschenkfertig in 10 Sekunden' },
        { time: '2-10s', scene: 'Tasse wird eingewickelt', text: '' },
      ],
      voiceover: 'Du brauchst nur Papier, Band und zehn Sekunden.',
      cta: 'Speichere das Video für dein nächstes Geschenk.',
      seconds: 10,
    },
    lengthRecommendation: {
      seconds: 10,
      structure: 'Hook 0-2s, Einpacken 2-8s, CTA 8-10s',
      reason: 'Bei 2500 Views und 38,1 % Watch-Rate auf 42 s Länge liegt die Retention unter 50 % — kürzer halten.',
    },
  };
}

/** Diagnose im „zu wenig Daten"-Zustand (kein LLM-Call, deterministisch). */
function fullDataGap() {
  return {
    mode: 'diagnose' as const,
    dataGap: true as const,
    missingMetrics: ['views', 'avgWatch'],
    note: 'Ohne Views und durchschnittliche Wiedergabedauer kann ich die Retention nicht beurteilen.',
    cta: 'Trage Views und durchschnittliche Wiedergabedauer ein und starte die Analyse erneut.',
  };
}

// ── Kontrollprobe: was hätte der ALTE Code getan? ───────────────────────────
/**
 * React wirft, wenn ein Objekt/Array als Kind gerendert wird
 * („Objects are not valid as a React child") — hier nachgebildet, damit die
 * Kontrollprobe auch falsch typisierte Textfelder abdeckt.
 */
function reactChild(v: unknown): void {
  if (v !== null && typeof v === 'object') {
    throw new TypeError('Objects are not valid as a React child');
  }
}

/**
 * Getreue Mini-Nachbildung NUR der ungeschützten Lesestellen der Route
 * (`src/routes/app/tiktok.tsx`, ResultView Zeilen 224–439). Keine Operation,
 * die dort nicht steht — Zweck: belegen, welche Fixture den ALTEN Code
 * wirklich zum Absturz bringt (`crash`) und welche er nur unvollständig/falsch
 * angezeigt hätte (`noCrash`).
 */
function legacyRender(result: any): void {
  if (result.mode === 'diagnose' && result.dataGap) {
    reactChild(result.note); // :234
    result.missingMetrics.map((k: unknown) => String(k)); // :238  ← Absturz
    reactChild(result.cta); // :241
    return;
  }
  if (result.mode === 'diagnose') {
    reactChild(result.biggestProblem); // :250
    result.whatWorks.map((w: unknown) => String(w)); // :254  ← Absturz
    result.whatToImprove.map((w: unknown) => String(w)); // :259  ← Absturz
    reactChild(result.newHook); // :263
    reactChild(result.optimized); // :266
    if (result.rebuilt) {
      reactChild(result.rebuilt.hook); // :277
      result.rebuilt.timedScenes.length; // :279  ← Absturz
      result.rebuilt.timedScenes.map((s: any) => { reactChild(s.time); reactChild(s.scene); s.text.trim(); }); // :283-288  ← Absturz
      reactChild(result.rebuilt.voiceover); // :299
      reactChild(result.rebuilt.cta); // :305
    }
    if (result.lengthRecommendation) {
      String(result.lengthRecommendation.seconds); // :318
      reactChild(result.lengthRecommendation.structure); // :320
      reactChild(result.lengthRecommendation.reason); // :323
    }
    reactChild(result.nextTest); // :329
    return;
  }
  reactChild(result.idea); // :338
  reactChild(result.hook); // :341
  if (result.scrollStop !== undefined) result.scrollStop.trim(); // :345  ← Absturz bei null
  reactChild(result.length); // :351
  if (result.format) reactChild(result.format); // :355  ← Objekt = React-Fehler
  if (result.title) reactChild(result.title); // :362
  if (result.timedScenes && result.timedScenes.length > 0) {
    result.timedScenes.map((s: any) => { reactChild(s.time); reactChild(s.scene); s.text.trim(); }); // :368-380  ← Absturz
  }
  result.scenes.map((s: unknown) => reactChild(s)); // :388  ← Absturz
  result.overlays.length; // :391  ← Absturz
  result.overlays.map((o: unknown) => reactChild(o)); // :394
  result.spokenText.trim(); // :399  ← Absturz
  if (result.tension !== undefined) result.tension.trim(); // :404  ← Absturz bei null
  reactChild(result.caption); // :410
  result.hashtags.join(' '); // :413  ← Absturz
  result.cta.trim(); // :417  ← Absturz
  reactChild(result.cta); // :419
  reactChild(result.why); // :423
  if (result.imageIdeas && result.imageIdeas.length > 0) {
    result.imageIdeas.map((i: any) => { reactChild(i.description); reactChild(i.studioPrompt); }); // :428-435
  }
}

function legacyWouldThrow(result: unknown): boolean {
  try {
    legacyRender(result);
    return false;
  } catch {
    return true;
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// ── sessionStorage-Stub (nur im Speicher, nichts verlässt den Prozess) ──────
const store = new Map<string, string>();
(globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

async function main() {
  // Dynamischer Import NACH dem sessionStorage-Stub.
  const guardMod = await import('../src/lib/tiktok-result-guard');
  const lastResult = await import('../src/lib/last-result');
  const recent = await import('../src/lib/tiktok-recent');
  const recordingMod = await import('../src/ai/action-plans/tiktok-recording');
  const { guardTikTokResult, isRenderableTikTokResult } = guardMod;

  const NOW = 1_700_000_000_000;
  const wrap = (mode: string, result: unknown, version = 1) =>
    JSON.stringify({ version, mode, result, savedAt: NOW });

  // ═══ A) Guard: gültige Ergebnisse ═════════════════════════════════════════
  console.log('\n=== A) Guard — gültige Ergebnisse werden akzeptiert ===');
  ok('A1 vollständiges Idee-Ergebnis → gültig', guardTikTokResult(fullIdea()).ok);
  ok('A2 vollständige Diagnose → gültig', guardTikTokResult(fullDiagnose()).ok);
  ok('A3 Daten-Lücken-Diagnose → gültig', guardTikTokResult(fullDataGap()).ok);
  ok('A4 Altformat ohne Phase-2-Felder → gültig', guardTikTokResult(oldIdea()).ok);
  ok('A5 unbekanntes Zusatzfeld → gültig (nicht bestraft)', guardTikTokResult({ ...fullIdea(), futureField: { anything: [1, 2, 3] } }).ok);
  ok('A6 optionale Felder explizit undefined → gültig', guardTikTokResult({ ...fullIdea(), format: undefined, timedScenes: undefined, imageIdeas: undefined }).ok);
  ok('A7 optionale Listen/Strings falsy (null/leer) → gültig (Renderer überspringt sie)', guardTikTokResult({ ...fullIdea(), timedScenes: null, imageIdeas: null, title: null, format: '' }).ok);
  ok('A8 Kontrollprobe: gültiges Ergebnis bringt auch den ALTEN Code nicht zum Absturz', !legacyWouldThrow(fullIdea()) && !legacyWouldThrow(fullDiagnose()) && !legacyWouldThrow(fullDataGap()) && !legacyWouldThrow(oldIdea()));

  // ═══ B) Guard: unvollständige/falsch typisierte Ergebnisse ═══════════════
  console.log('\n=== B) Guard — unvollständige/falsch typisierte Ergebnisse ===');
  type OldBehavior = 'crash' | 'noCrash';
  type Case = { name: string; value: unknown; reason: string; old: OldBehavior };
  const withPatch = (base: Record<string, unknown>, patch: Record<string, unknown>) => {
    const r = { ...base, ...patch };
    Object.keys(patch).forEach((k) => {
      if (patch[k] === '__DELETE__') delete r[k];
    });
    return r;
  };
  const ideaBase = fullIdea() as unknown as Record<string, unknown>;
  const diagBase = fullDiagnose() as unknown as Record<string, unknown>;
  const gapBase = fullDataGap() as unknown as Record<string, unknown>;

  const cases: Case[] = [
    // Der gemeldete Absturz (Beleg-Screenshot 2026-11-06):
    { name: 'B1 scenes fehlt (der gemeldete Absturz)', value: withPatch(ideaBase, { scenes: '__DELETE__' }), reason: 'scenes fehlt', old: 'crash' },
    { name: 'B2 overlays fehlt', value: withPatch(ideaBase, { overlays: '__DELETE__' }), reason: 'overlays fehlt', old: 'crash' },
    { name: 'B3 spokenText fehlt', value: withPatch(ideaBase, { spokenText: '__DELETE__' }), reason: 'spokenText fehlt', old: 'crash' },
    { name: 'B4 hashtags fehlt', value: withPatch(ideaBase, { hashtags: '__DELETE__' }), reason: 'hashtags fehlt', old: 'crash' },
    { name: 'B5 cta fehlt', value: withPatch(ideaBase, { cta: '__DELETE__' }), reason: 'cta fehlt', old: 'crash' },
    { name: 'B6 scenes ist ein String statt Array', value: withPatch(ideaBase, { scenes: 'Ton kneten, drehen, brennen' }), reason: 'scenes fehlt', old: 'crash' },
    { name: 'B7 scenes enthält Zahlen', value: withPatch(ideaBase, { scenes: [1, 2, 3] }), reason: 'scenes fehlt', old: 'noCrash' },
    { name: 'B8 overlays ist ein Objekt', value: withPatch(ideaBase, { overlays: {} }), reason: 'overlays fehlt', old: 'crash' },
    { name: 'B9 spokenText ist eine Zahl', value: withPatch(ideaBase, { spokenText: 42 }), reason: 'spokenText fehlt', old: 'crash' },
    { name: 'B10 hashtags ist ein String', value: withPatch(ideaBase, { hashtags: '#keramik #handmade' }), reason: 'hashtags fehlt', old: 'crash' },
    { name: 'B11 scrollStop ist null (null.trim)', value: withPatch(ideaBase, { scrollStop: null }), reason: 'scrollStop ungültig', old: 'crash' },
    { name: 'B12 tension ist eine Zahl', value: withPatch(ideaBase, { tension: 7 }), reason: 'tension ungültig', old: 'crash' },
    { name: 'B13 format ist ein Objekt (React-Child-Fehler)', value: withPatch(ideaBase, { format: { a: 1 } }), reason: 'format ungültig', old: 'crash' },
    { name: 'B14 timedScenes ist ein String (truthy, kein Array)', value: withPatch(ideaBase, { timedScenes: 'Zeitplan' }), reason: 'timedScenes ungültig', old: 'crash' },
    { name: 'B15 timedScenes[0].text fehlt (text.trim)', value: withPatch(ideaBase, { timedScenes: [{ time: '0-2s', scene: 'Ton' }] }), reason: 'timedScenes ungültig', old: 'crash' },
    { name: 'B16 imageIdeas ist ein String', value: withPatch(ideaBase, { imageIdeas: 'Bild' }), reason: 'imageIdeas ungültig', old: 'crash' },
    { name: 'B17 imageIdeas[0] ohne studioPrompt', value: withPatch(ideaBase, { imageIdeas: [{ description: 'x' }] }), reason: 'imageIdeas ungültig', old: 'noCrash' },
    { name: 'B18 idea fehlt', value: withPatch(ideaBase, { idea: '__DELETE__' }), reason: 'idea fehlt', old: 'noCrash' },
    { name: 'B19 hook fehlt', value: withPatch(ideaBase, { hook: '__DELETE__' }), reason: 'hook fehlt', old: 'noCrash' },
    { name: 'B20 length fehlt', value: withPatch(ideaBase, { length: '__DELETE__' }), reason: 'length fehlt', old: 'noCrash' },
    { name: 'B21 caption fehlt', value: withPatch(ideaBase, { caption: '__DELETE__' }), reason: 'caption fehlt', old: 'noCrash' },
    { name: 'B22 why fehlt', value: withPatch(ideaBase, { why: '__DELETE__' }), reason: 'why fehlt', old: 'noCrash' },
    { name: 'B23 idea ist ein Objekt (React-Child-Fehler)', value: withPatch(ideaBase, { idea: { text: 'x' } }), reason: 'idea fehlt', old: 'crash' },
    { name: 'B24 title ist eine Zahl (falsche Anzeige)', value: withPatch(ideaBase, { title: 99 }), reason: 'title ungültig', old: 'noCrash' },
    { name: 'B25 Diagnose: whatWorks fehlt', value: withPatch(diagBase, { whatWorks: '__DELETE__' }), reason: 'whatWorks fehlt', old: 'crash' },
    { name: 'B26 Diagnose: whatToImprove ist ein String', value: withPatch(diagBase, { whatToImprove: 'nichts' }), reason: 'whatToImprove fehlt', old: 'crash' },
    { name: 'B27 Diagnose: rebuilt ohne timedScenes', value: withPatch(diagBase, { rebuilt: { hook: 'neu', voiceover: 'x', cta: 'y', seconds: 10 } }), reason: 'rebuilt unvollständig', old: 'crash' },
    { name: 'B28 Diagnose: rebuilt.timedScenes[0].text ist eine Zahl', value: withPatch(diagBase, { rebuilt: { hook: 'neu', timedScenes: [{ time: '0-2s', scene: 'a', text: 5 }], voiceover: 'x', cta: 'y', seconds: 10 } }), reason: 'rebuilt unvollständig', old: 'crash' },
    { name: 'B29 Diagnose: lengthRecommendation ist ein String', value: withPatch(diagBase, { lengthRecommendation: 'ca. 10 Sekunden' }), reason: 'lengthRecommendation unvollständig', old: 'noCrash' },
    { name: 'B30 Diagnose: lengthRecommendation ohne reason', value: withPatch(diagBase, { lengthRecommendation: { seconds: 10, structure: 'Hook 0-2s' } }), reason: 'lengthRecommendation unvollständig', old: 'noCrash' },
    { name: 'B31 Diagnose: biggestProblem fehlt', value: withPatch(diagBase, { biggestProblem: '__DELETE__' }), reason: 'biggestProblem fehlt', old: 'noCrash' },
    { name: 'B32 Diagnose: newHook fehlt', value: withPatch(diagBase, { newHook: '__DELETE__' }), reason: 'newHook fehlt', old: 'noCrash' },
    { name: 'B33 Diagnose: optimized fehlt', value: withPatch(diagBase, { optimized: '__DELETE__' }), reason: 'optimized fehlt', old: 'noCrash' },
    { name: 'B34 Diagnose: nextTest fehlt', value: withPatch(diagBase, { nextTest: '__DELETE__' }), reason: 'nextTest fehlt', old: 'noCrash' },
    { name: 'B35 Daten-Lücke: missingMetrics fehlt', value: withPatch(gapBase, { missingMetrics: undefined }), reason: 'dataGap.missingMetrics fehlt', old: 'crash' },
    { name: 'B36 Daten-Lücke: note fehlt', value: withPatch(gapBase, { note: undefined }), reason: 'dataGap.note fehlt', old: 'noCrash' },
    { name: 'B37 Daten-Lücke: cta fehlt', value: withPatch(gapBase, { cta: undefined }), reason: 'dataGap.cta fehlt', old: 'noCrash' },
  ];

  let crashCount = 0;
  for (const c of cases) {
    const verdict = guardTikTokResult(c.value);
    ok(`${c.name} → ungültig (${verdict.reason ?? 'ohne Grund'})`, !verdict.ok && verdict.reason === c.reason, verdict.reason);
    const oldThrew = legacyWouldThrow(c.value);
    ok(
      `${c.name} → Kontrollprobe alter Code: ${c.old === 'crash' ? 'Absturz' : 'kein Absturz, aber unvollständige Anzeige'}`,
      oldThrew === (c.old === 'crash'),
      `alter Code warf: ${oldThrew}`,
    );
    if (c.old === 'crash') crashCount += 1;
  }
  console.log(`  → ${cases.length} Fälle geprüft, davon ${crashCount} echte Abstürze im alten Code`);

  // ═══ C) Guard: leere/fremde Werte ═════════════════════════════════════════
  console.log('\n=== C) Guard — leere/fremde Werte ===');
  for (const [name, value] of [
    ['C1 result = null', null],
    ['C2 result = undefined', undefined],
    ['C3 result = {} (leeres Objekt)', {}],
    ['C4 result = "Text"', 'Text'],
    ['C5 result = [] (Array)', []],
    ['C6 result ohne mode', { idea: 'x', hook: 'y' }],
    ['C7 result.mode = 42', { mode: 42, idea: 'x' }],
  ] as Array<[string, unknown]>) {
    const v = guardTikTokResult(value);
    ok(`${name} → ungültig`, !v.ok, v.reason);
  }
  ok('C8 isRenderableTikTokResult = Fassade des Guards', isRenderableTikTokResult(fullIdea()) === true && isRenderableTikTokResult({}) === false);

  // ═══ D) parseTikTokResult (Einzelergebnis „growimo_tiktok_last_result") ═══
  console.log('\n=== D) parseTikTokResult ===');
  ok('D1 vollständiges Ergebnis → wird zurückgegeben', lastResult.parseTikTokResult(wrap('concept', fullIdea()), NOW) !== null);
  ok('D2 overlays fehlt → null (wie „kein Ergebnis")', lastResult.parseTikTokResult(wrap('concept', withPatch(ideaBase, { overlays: '__DELETE__' })), NOW) === null);
  ok('D3 scenes fehlt → null (der gemeldete Absturz)', lastResult.parseTikTokResult(wrap('todayIdea', withPatch(ideaBase, { scenes: '__DELETE__' })), NOW) === null);
  ok('D4 result = null → null', lastResult.parseTikTokResult(wrap('concept', null), NOW) === null);
  ok('D5 falsche Version (2) → null', lastResult.parseTikTokResult(wrap('concept', fullIdea(), 2), NOW) === null);
  ok('D6 leeres Objekt → null', lastResult.parseTikTokResult(wrap('concept', {}), NOW) === null);
  ok('D7 Altformat ohne Phase-2-Felder → wird zurückgegeben', lastResult.parseTikTokResult(wrap('todayIdea', oldIdea()), NOW) !== null);
  ok('D8 Diagnose gültig → wird zurückgegeben', lastResult.parseTikTokResult(wrap('diagnose', fullDiagnose()), NOW) !== null);
  ok('D9 Diagnose unvollständig → null', lastResult.parseTikTokResult(wrap('diagnose', withPatch(diagBase, { whatWorks: '__DELETE__' })), NOW) === null);
  ok('D10 Daten-Lücken-Diagnose gültig → wird zurückgegeben', lastResult.parseTikTokResult(wrap('diagnose', fullDataGap()), NOW) !== null);
  ok('D11 kaputtes JSON → null (kein Throw)', lastResult.parseTikTokResult('{kaputt', NOW) === null);
  ok('D12 leerer String → null', lastResult.parseTikTokResult('', NOW) === null);
  ok('D13 abgelaufene TTL → null (Verhalten unverändert)', lastResult.parseTikTokResult(wrap('concept', fullIdea()), NOW + 13 * 60 * 60 * 1000) === null);

  // ═══ E) Regression: gültiges Ergebnis UNVERÄNDERT, Feld für Feld ═════════
  console.log('\n=== E) Regression — gültiges Ergebnis kommt Feld für Feld unverändert an ===');
  {
    const original = fullIdea();
    const parsed = lastResult.parseTikTokResult(wrap('concept', original), NOW);
    ok('E1 Ergebnis wird zurückgegeben', parsed !== null);
    const shown = parsed!.result as unknown as Record<string, unknown>;
    const expected = original as unknown as Record<string, unknown>;
    // Feldliste = ALLES, was ResultView liest (tiktok.tsx:338–439) + Modus.
    const fields = [
      'mode', 'idea', 'hook', 'length', 'scenes', 'overlays', 'spokenText', 'caption',
      'hashtags', 'cta', 'why', 'format', 'scrollStop', 'tension', 'timedScenes',
      'title', 'imageIdeas', 'selfCheck',
    ];
    let diff = 0;
    for (const f of fields) {
      if (JSON.stringify(shown[f]) !== JSON.stringify(expected[f])) {
        diff += 1;
        console.log(`        Unterschied bei "${f}": ${JSON.stringify(expected[f])} → ${JSON.stringify(shown[f])}`);
      }
    }
    ok(`E2 alle ${fields.length} gelesenen Felder identisch (Wert für Wert)`, diff === 0, `${diff} Abweichung(en)`);
    eq('E3 Schlüsselmenge unverändert (kein Feld hinzugefügt/entfernt)', Object.keys(shown).sort(), Object.keys(expected).sort());
    ok('E4 Modus des Wrappers unverändert', parsed!.mode === 'concept');
    const frozen = deepFreeze(fullIdea());
    let threw = false;
    try {
      guardTikTokResult(frozen);
    } catch {
      threw = true;
    }
    ok('E5 Guard verändert das Ergebnis nicht (eingefrorenes Objekt überlebt)', !threw);
    eq('E6 eingefrorenes Ergebnis bleibt inhaltlich gleich', frozen, fullIdea());
    const dOrig = fullDiagnose();
    const dParsed = lastResult.parseTikTokResult(wrap('diagnose', dOrig), NOW);
    ok('E7 Diagnose wird zurückgegeben', dParsed !== null);
    const dShown = dParsed!.result as unknown as Record<string, unknown>;
    let dDiff = 0;
    for (const f of Object.keys(dOrig)) {
      if (JSON.stringify(dShown[f]) !== JSON.stringify((dOrig as any)[f])) dDiff += 1;
    }
    ok(`E8 Diagnose: alle ${Object.keys(dOrig).length} Felder identisch`, dDiff === 0, `${dDiff} Abweichung(en)`);
    ok('E9 Altformat: alle Felder identisch', (() => {
      const o = oldIdea();
      const p = lastResult.parseTikTokResult(wrap('todayIdea', o), NOW);
      if (!p) return false;
      const s = p.result as unknown as Record<string, unknown>;
      return Object.keys(o).length === Object.keys(s).length
        && Object.keys(o).every((k) => JSON.stringify(s[k]) === JSON.stringify((o as any)[k]));
    })());
    ok('E10 Ergebnis-Objekt wird 1:1 durchgereicht (identischer JSON-Text)', JSON.stringify(shown) === JSON.stringify(expected));
  }

  // ═══ F) „Zuletzt erstellt" — gemischt gültige/ungültige Einträge ═════════
  console.log('\n=== F) parseRecentList — gemischte Liste ===');
  {
    const entry = (result: unknown, label = '') => ({
      version: 1,
      id: '',
      mode: (result as any)?.mode ?? 'concept',
      result,
      savedAt: NOW,
      label,
      productIdea: 'Keramiktassen',
    });
    const brokenScenes = withPatch(ideaBase, { scenes: '__DELETE__' });
    const brokenOverlays = withPatch(ideaBase, { overlays: undefined });
    const raw = JSON.stringify([
      entry(fullIdea(), 'Erste gültige Idee'),
      entry(brokenScenes), // kaputt → muss übersprungen werden
      entry(oldIdea(), 'Altes Format, gültig'),
      entry(brokenOverlays), // kaputt → überspringen
      entry(fullDiagnose(), 'Gültige Diagnose'),
    ]);
    let list: Awaited<ReturnType<typeof recent.parseRecentList>> = [];
    let threw = false;
    try {
      list = recent.parseRecentList(raw, NOW);
    } catch (e) {
      threw = true;
      console.log('        Throw:', e instanceof Error ? e.message : e);
    }
    ok('F1 Liste wirft nicht', !threw);
    eq('F2 genau die 3 gültigen Einträge bleiben (Reihenfolge erhalten)', list.map((x) => x.label), [
      'Erste gültige Idee',
      'Altes Format, gültig',
      'Gültige Diagnose',
    ]);
    ok('F3 kaputte Einträge sind nicht in der Liste', !list.some((x) => (x.result as unknown) === (brokenScenes as unknown)) && !list.some((x) => (x.result as unknown) === (brokenOverlays as unknown)));
    ok('F4 gültiger Eintrag bleibt vollständig öffenbar', (() => {
      const first = list[0].result as any;
      return Array.isArray(first.scenes) && first.scenes.length === 4 && typeof first.spokenText === 'string' && first.overlays.length === 3;
    })());
    ok('F5 gültiges Ergebnis in der Liste ist Feld für Feld unverändert', (() => {
      const shown = list[0].result as unknown as Record<string, unknown>;
      const expected = fullIdea() as unknown as Record<string, unknown>;
      return Object.keys(expected).length === Object.keys(shown).length
        && Object.keys(expected).every((k) => JSON.stringify(shown[k]) === JSON.stringify(expected[k]));
    })());
    ok('F6 Diagnose-Eintrag in der Liste unverändert', (() => {
      const shown = list[2].result as unknown as Record<string, unknown>;
      const expected = fullDiagnose() as unknown as Record<string, unknown>;
      return Object.keys(expected).every((k) => JSON.stringify(shown[k]) === JSON.stringify(expected[k]));
    })());
    let onlyBroken: unknown[] = [];
    let threw2 = false;
    try {
      onlyBroken = recent.parseRecentList(JSON.stringify([entry(brokenScenes), entry(brokenOverlays)]), NOW);
    } catch {
      threw2 = true;
    }
    ok('F7 nur kaputte Einträge → leere Liste, kein Throw', !threw2 && onlyBroken.length === 0);
    ok('F8 kaputtes JSON → leere Liste', recent.parseRecentList('{kaputt', NOW).length === 0);
    ok('F9 falsche Eintrags-Version → ignoriert', recent.parseRecentList(JSON.stringify([{ ...entry(fullIdea()), version: 2 }]), NOW).length === 0);
    // Beschriftungs-Ableitung (recentEntryLabel) liest idea/note/biggestProblem —
    // der Wächter steht im Parser VOR dieser Ableitung.
    let labelCase: unknown[] = [];
    let labelThrew = false;
    try {
      labelCase = recent.parseRecentList(
        JSON.stringify([entry(withPatch(ideaBase, { idea: { text: 'x' } }))]),
        NOW,
      );
    } catch {
      labelThrew = true;
    }
    ok('F10 Eintrag mit falsch typisiertem idea → übersprungen, kein Throw in der Beschriftung', !labelThrew && labelCase.length === 0);
  }

  // ═══ G) sessionStorage-Pfade (readTikTokResult / readRecentList) ══════════
  console.log('\n=== G) Lesepfade über sessionStorage ===');
  {
    store.clear();
    store.set(lastResult.TIKTOK_RESULT_KEY, wrap('concept', withPatch(ideaBase, { overlays: '__DELETE__' })));
    let v: unknown = 'init';
    let threw = false;
    try {
      v = lastResult.readTikTokResult(NOW);
    } catch {
      threw = true;
    }
    ok('G1 kaputtes Einzelergebnis im Storage → null statt Throw', !threw && v === null);
    ok('G2 der gespeicherte Eintrag bleibt UNANGETASTET (nichts gelöscht/umgeschrieben)', store.has(lastResult.TIKTOK_RESULT_KEY));
    store.clear();
    store.set(lastResult.TIKTOK_RESULT_KEY, wrap('concept', fullIdea()));
    const good = lastResult.readTikTokResult(NOW);
    ok('G3 gültiges Einzelergebnis im Storage → wird geliefert', good !== null && (good.result as any).scenes.length === 4);
    ok('G4 gespeicherter Eintrag unverändert (kein Rückschreiben)', store.get(lastResult.TIKTOK_RESULT_KEY) === wrap('concept', fullIdea()));
    store.clear();
    store.set(lastResult.TIKTOK_RESULT_KEY, wrap('todayIdea', withPatch(ideaBase, { scenes: '__DELETE__' })));
    let migrated: unknown[] = [];
    let mThrew = false;
    try {
      migrated = recent.readRecentList(NOW);
    } catch {
      mThrew = true;
    }
    ok('G5 readRecentList mit kaputtem Alt-Ergebnis → [] statt Throw', !mThrew && migrated.length === 0);
    ok('G6 dabei wird die Liste NICHT geschrieben (kein Aufräumen)', !store.has(recent.TIKTOK_RECENT_KEY));
    ok('G7 der alte Einzelergebnis-Schlüssel bleibt liegen', store.has(lastResult.TIKTOK_RESULT_KEY));
    store.clear();
    store.set(lastResult.TIKTOK_RESULT_KEY, wrap('concept', fullIdea()));
    const migratedOk = recent.readRecentList(NOW);
    ok('G8 gültiges Alt-Ergebnis wird weiterhin in die Liste migriert (Bestandsfunktion erhalten)',
      migratedOk.length === 1 && Array.isArray((migratedOk[0].result as any).scenes) && (migratedOk[0].result as any).scenes.length === 4);
    ok('G9 Speicher-Schlüssel unverändert', lastResult.TIKTOK_RESULT_KEY === 'growimo_tiktok_last_result' && recent.TIKTOK_RECENT_KEY === 'growimo_tiktok_recent_results');
    ok('G10 Format-Version unverändert (1)', lastResult.TIKTOK_RESULT_VERSION === 1 && recent.TIKTOK_RECENT_VERSION === 1);
  }

  // ═══ H) Bestandsfunktionen unberührt ═════════════════════════════════════
  console.log('\n=== H) Bestandsverhalten unverändert ===');
  {
    store.clear();
    const raw = lastResult.serializeTikTokResult('concept', fullIdea() as any, NOW);
    const back = lastResult.parseTikTokResult(raw, NOW);
    ok('H1 serializeTikTokResult → parseTikTokResult ergibt dasselbe Ergebnis', back !== null && JSON.stringify(back.result) === JSON.stringify(fullIdea()));
    store.clear();
    recent.pushRecentResult('concept', { ...fullIdea(), idea: 'Idee A' } as any, 'p', NOW);
    recent.pushRecentResult('concept', { ...fullIdea(), idea: 'Idee B' } as any, 'p', NOW + 1);
    const list3 = recent.pushRecentResult('diagnose', fullDiagnose() as any, 'p', NOW + 2);
    eq('H2 pushRecentResult kappt auf 3 und sortiert neueste zuerst', list3.map((e) => e.mode), ['diagnose', 'concept', 'concept']);
    ok('H3 gespeicherte Liste ist lesbar und vollständig', recent.readRecentList(NOW + 3).length === 3);
    const t = new Proxy({}, { get: (_o, prop) => String(prop) }) as any;
    const body = recent.formatTikTokResultText(fullIdea() as any, t);
    ok('H4 formatTikTokResultText enthält Szenen + Overlays + Sprechtext', body.includes('Ton kneten') && body.includes('Vorher: Tonklumpen') && body.includes('Ich zeige dir'));
    const args = recent.buildTikTokSaveArgs(list3[1], 'user_test', t);
    ok('H5 buildTikTokSaveArgs liefert Projekt + 1 Asset', args.project.userId === 'user_test' && args.contents.length === 1 && args.contents[0].metadata.source === 'tiktok');
    ok('H6 buildTikTokRecordingPlan (Aufnahme-Anleitung) bleibt intakt', (() => {
      const plan = recordingMod.buildTikTokRecordingPlan(fullIdea() as any, 'de');
      return plan !== null && plan.plan.length > 3;
    })());
  }

  // ── Ergebnis ──────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Summe: PASS ${PASS}  FAIL ${FAIL}`);
  if (FAIL > 0) {
    console.log('Fehlgeschlagen:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('EXIT 0 — alle Prüfungen grün');
}

void main();

// Modul-Marker: ohne Import/Export waere diese Datei ein globales Skript und
// ihre Funktionsnamen (main, ok, eq …) kollidierten mit anderen Skripten.
export {};
