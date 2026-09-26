// ─────────────────────────────────────────────────────────────────────────────
// Stabilisierung Phase 5g (Owner-Auftrag 2026-09-23) — Test C NACHGESCHÄRFT.
// ─────────────────────────────────────────────────────────────────────────────
// Test C (TikTok-Struktur) war strukturell GRÜN, inhaltlich aber vom Owner
// beanstandet: „personalisierte Tasse" wurde zur Tassenform/Kaffeegeschmack
// umgedeutet und „minimalistischer Schmuck" blieb generisch („Finde deinen
// Stil"). Diese Suite prüft die Nachschärfung (NUR Generierungslogik, kein
// Umbau, Stabilitäts-/Navigations-Fixes unberührt):
//
//   P1  INHALTS-MANDAT in de UND en, in BEIDEN Idee-Modi (todayIdea + concept)
//   P2  Pflicht-Katalog der Scroll-Stop-Mechaniken + Pflicht-Präfix
//       „Mechanik: <Name> — " (de) / „Mechanic: <name> — " (en), inkl. Schema
//   P3  Bedeutungserhalt im Nutzer-Prompt: Thema „personalisierte Tasse"
//       verankert Name/Foto/Text/Design und verbietet die Umdeutung
//       („Tassenform beeinflusst den Kaffeegeschmack") — de UND en
//   P4  Diagnose-Prompt bleibt unberührt (kein Mandat dort — kein Umbau)
//   G1  GENERIC_PATTERNS erkennen die 4+ Owner-Sätze (de/en) → Ablehnen
//   G2  Keine False Positives bei produktspezifischen Sätzen
//   G3  Post-Check deckt ALLE Textfelder ab (Hook, Caption, Overlays,
//       timedScenes, imageIdeas …)
//   G4  genericFreeResult entfernt die Sätze deterministisch, idempotent,
//       ohne Rückfall auf den verbotenen Satz (Ganzfeld-Füllung)
//   E1  Engine-E2E de: generische Idee → Soft-Reject + Retry mit
//       Anti-Generik-Hinweis, saubere Idee wird ausgegeben
//   E2  Engine-E2E de concept „personalisierte Tasse": Bedeutungserhalt steht
//       im Prompt, generische Idee wird verworfen
//   E3  Engine-E2E en concept: Anti-Generic-Hinweis + Meaning-Preservation
//   E4  Dauerhaft generisch (4 Versuche) → bestmögliche Idee OHNE den
//       verbotenen Satz (kein Blanko-Fail, kein Slogan im Ergebnis)
//   E5  Regression: saubere Idee läuft OHNE Retry durch (genau 1 Versuch) —
//       die Nachschärfung erzeugt keine falschen Ablehnungen
//   R1  Regression Phase 2: Struktur-Pflichten (Hook, scrollStop, timedScenes
//       mit Sekunden, Texteinblendungen, Sprechtext, Spannungsbogen, Caption,
//       ≤5 Hashtags, CTA nur wenn sinnvoll, Bildideen, keine Platzhalter) sind
//       unverändert vorhanden (de + en)
//   R2  Regression: Platzhalter-Pfad unverändert (Soft-Reject + Retry),
//       Anti-Generik ist reine ZUSATZ-Prüfung (beide Meldungen gleichzeitig)
//   R3  Regression: todayIdea-Prompt unverändert in seinen Kernanweisungen
//       (Richtungs-Katalog, Selbstreferenz-Verbot, Qualitäts-Mandat)
//   R4  i18n de/en Parität (keine einseitigen Keys)
//
// Usage (aus der Repo-Wurzel):  bun stabilisierung-phase5c-test.ts
// Kein Netz, keine DB: Bun-Mock als OpenAI-Endpoint (OPENAI_BASE_URL).
// Exit-Code 0 nur, wenn alle Checks grün sind.
// ─────────────────────────────────────────────────────────────────────────────
import {
  generateTikTok,
  pickSystemPrompt,
  buildUserPrompt,
  GENERIC_PATTERNS,
  genericViolations,
  genericFreeResult,
  placeholderFreeResult,
  placeholderViolations,
  ideaPlaceholderBlob,
  type TikTokInput,
  type TikTokIdeaResult,
} from './src/ai/tiktok';

// ── OpenAI-Mock ──────────────────────────────────────────────────────────────
// Bun-Typen sind im Repo nicht installiert (@types/bun fehlt) — die Test-Suiten
// deklarieren Bun deshalb lokal, sonst erzeugt jede neue Suite tsc-Fehler.
declare const Bun: { serve(opts: { port: number; fetch: (req: Request) => Promise<Response> }): { port: number; stop(closeActive?: boolean): void } };
type Responder = (attempt: number, userPrompt: string) => string;
let currentResponder: Responder | null = null;
let attemptCounter = 0;
const seenUserPrompts: string[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req: Request) {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const body = (await req.json()) as { messages?: Array<{ role?: string; content?: unknown }> };
    const systemMsg =
      (body?.messages?.find((m) => m.role === 'system')?.content as string | undefined) ?? '';
    const userMsg =
      (body?.messages?.find((m) => m.role === 'user')?.content as string | undefined) ?? '';
    seenUserPrompts.push(userMsg);
    attemptCounter += 1;
    let content: string;
    if (systemMsg.includes('neutralisierst')) {
      // metric-guard-Mock: Text unverändert (hier werden keine Kennzahlen geprüft)
      content = userMsg;
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

// ── Harness ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  if (cond) passed += 1;
  else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ FAIL: ${label}`);
  }
};
const section = (t: string) => console.log(`\n── ${t}`);
const SELFCHECK_CLEAN = {
  usesConcreteBrandFact: true,
  addressesCurrentChallenge: false,
  interchangeable: false,
  soundsLikeAd: false,
  inventsUserOrTestimonial: false,
  unprovenPerformancePromise: false,
  prescribedEnthusiasm: false,
};
const blob = (r: TikTokIdeaResult) => ideaPlaceholderBlob(r);

/** Vollständige, saubere Idee (de/en) — KEINE generischen Sätze, keine
 *  Platzhalter, keine Regel-A/B-Verstöße, keine Selbstreferenz. */
function cleanIdea(de: boolean): Record<string, unknown> {
  return {
    idea: de
      ? 'Zeig in Nahaufnahme, wie der eingravierte Name auf der Keramiktasse in Sekunde 1 sichtbar wird.'
      : 'Show in a close-up how the engraved name on the ceramic mug becomes visible in second one.',
    hook: de
      ? 'Diese Tasse kennt ihren Namen — sieh die Gravur.'
      : 'This mug knows her name — watch the engraving.',
    scrollStop: de
      ? 'Mechanik: Reveal — die Tasse wird gedreht, die Namensgravur erscheint; Geschenk-Suchende erkennen genau diesen Moment.'
      : 'Mechanic: Reveal — the mug is turned, the engraved name appears; gift hunters recognise exactly that moment.',
    tension: de
      ? 'Offene Schleife in Sekunde 0 („Wer bekommt sie?"), Steigerung beim Verpacken, Payoff in Sekunde 12.'
      : 'Open loop at second 0 ("who gets it?"), escalation while packing, payoff at second 12.',
    length: de ? '12 Sekunden' : '12 seconds',
    format: de
      ? 'Demonstration in Nahaufnahme (passt zum Ziel: Verkäufe)'
      : 'Close-up demonstration (fits the goal: sales)',
    title: de ? 'Name in Keramik graviert' : 'Name engraved in ceramic',
    timedScenes: [
      {
        time: '0-3s',
        scene: de ? 'Tasse wird gedreht, Gravur erscheint' : 'Mug is turned, engraving appears',
        text: de ? 'Wer bekommt sie?' : 'Who gets it?',
      },
      {
        time: '3-9s',
        scene: de ? 'Verpackung mit Jute-Band' : 'Wrapping with a jute ribbon',
        text: '',
      },
      {
        time: '9-12s',
        scene: de ? 'Fertige Tasse auf dem Holztisch' : 'Finished mug on the wooden table',
        text: '',
      },
    ],
    scenes: [
      de ? 'Tasse drehen und Gravur zeigen' : 'Turn the mug and show the engraving',
      de ? 'Verpackung vorbereiten' : 'Prepare the wrapping',
      de ? 'Ergebnis auf den Tisch stellen' : 'Place the result on the table',
    ],
    overlays: [de ? 'Name graviert' : 'Name engraved', de ? 'Handarbeit aus Ton' : 'Handmade from clay'],
    spokenText: de
      ? 'Ich zeige dir, wie eine handgemachte Gravur entsteht.'
      : 'I show you how a handmade engraving is made.',
    caption: de
      ? 'Namensgravur auf Keramik: so entsteht sie'
      : 'Name engraving on ceramic: how it is made',
    hashtags: ['#keramik', '#gravur', '#geschenk'],
    cta: de ? 'Welchen Namen würdest du gravieren lassen?' : 'Which name would you engrave?',
    why: de
      ? 'Der Erkennungsmoment in Sekunde 1 trifft Geschenk-Suchende konkret.'
      : 'The recognition moment in second one hits gift hunters concretely.',
    imageIdeas: [
      {
        description: de ? 'Cover: Gravur in Nahaufnahme' : 'Cover: engraving close-up',
        studioPrompt: de
          ? 'Keramiktasse mit Namensgravur, warmes Licht, Nahaufnahme, Holztisch'
          : 'Ceramic mug with name engraving, warm light, close-up, wooden table',
      },
    ],
    selfCheck: SELFCHECK_CLEAN,
  };
}
/** Dieselbe Idee, aber mit den vom Owner beanstandeten generischen Sätzen
 *  (Hook = „Finde deinen Stil" u. a.) — muss deterministisch verworfen werden. */
function genericIdea(de: boolean): Record<string, unknown> {
  const o = cleanIdea(de);
  o.hook = de ? 'Finde deinen Stil' : 'Find your own style';
  o.cta = de ? 'Entdecke dein volles Potenzial' : 'Discover your full potential';
  o.overlays = [
    de ? 'Der Unterschied ist sofort sichtbar' : 'The difference is immediately visible',
    de ? 'Das Beste für dich' : 'The best for you',
  ];
  return o;
}
function baseInput(over: Partial<TikTokInput> = {}): TikTokInput {
  return {
    mode: 'todayIdea',
    biz: 'Handgemachte Keramiktassen mit Namensgravur, nachhaltiger Ton, 29 EUR',
    goal: 'Verkäufe',
    audience: 'Frauen 25–45, Geschenk-Suchende',
    brandContext:
      'Keramikwerkstatt, handgemachte Tassen mit Namensgravur, nachhaltiger Ton, 29 EUR pro Tasse.',
    ...over,
  };
}
// WICHTIG (Fund dieser Suite): Die Sprache ist KEIN Feld von TikTokInput —
// generateTikTok(input, lang) nimmt sie als ZWEITES Argument (Default 'de').
// Ein input-Feld `lang` wird ignoriert; en-Tests müssen den Parameter nutzen.
const reset = (responder: Responder) => {
  currentResponder = responder;
  attemptCounter = 0;
  seenUserPrompts.length = 0;
};

// ── P1: Inhalts-Mandat in de + en, in beiden Idee-Modi ──────────────────────
section('P1 INHALTS-MANDAT in beiden Idee-Modi (de + en)');
{
  const mandateDe = [
    'INHALTS-MANDAT (VERBINDLICH',
    'BEDEUTUNGS-ERHALT (harte Regel)',
    'personalisierte Tasse',
    'Tassenform beeinflusst den Kaffeegeschmack',
    'ECHTER VISUELLER SCROLL-STOP (harte Regel)',
    'ANTI-GENERIK (harte Regel)',
    'SPEZIFITÄT (Pflicht-Assertion)',
    'KEINE UNBELEGTEN FAKTEN (harte Regel)',
    'Finde deinen Stil',
    'Der Unterschied ist sofort sichtbar',
    'Entdecke dein Potenzial',
    'Das Beste für dich',
  ];
  const mandateEn = [
    'CONTENT MANDATE (MANDATORY',
    'MEANING PRESERVATION (hard rule)',
    'personalized mug',
    'the shape of the mug influences the taste of the coffee',
    'REAL VISUAL SCROLL-STOP (hard rule)',
    'ANTI-GENERIC (hard rule)',
    'SPECIFICITY (mandatory assertion)',
    'NO UNBACKED FACTS (hard rule)',
    'Find your style',
    'The difference is immediately visible',
    'Discover your potential',
    'The best for you',
  ];
  for (const mode of ['todayIdea', 'concept'] as const) {
    const deP = pickSystemPrompt(mode, 'de');
    const enP = pickSystemPrompt(mode, 'en');
    for (const s of mandateDe) check(deP.includes(s), `P1 ${mode}(de) enthält „${s}“`);
    for (const s of mandateEn) check(enP.includes(s), `P1 ${mode}(en) enthält „${s}“`);
  }
  // Owner-Kriterien 1–5 müssen als nummerierte Regeln erkennbar sein
  const deP = pickSystemPrompt('todayIdea', 'de');
  const enP = pickSystemPrompt('todayIdea', 'en');
  for (const n of ['1. BEDEUTUNGS-ERHALT', '2. ECHTER VISUELLER SCROLL-STOP', '3. ANTI-GENERIK', '4. SPEZIFITÄT', '5. KEINE UNBELEGTEN FAKTEN']) {
    check(deP.includes(n), `P1 de Regel „${n}“`);
  }
  for (const n of ['1. MEANING PRESERVATION', '2. REAL VISUAL SCROLL-STOP', '3. ANTI-GENERIC', '4. SPECIFICITY', '5. NO UNBACKED FACTS']) {
    check(enP.includes(n), `P1 en Regel „${n}“`);
  }
  // Q3 (interchangeable) nennt die verbotenen Sätze ebenfalls explizit
  check(deP.includes('Melde außerdem true, wenn ein VERBOTENER generischer Satz'), 'P1 de Q3 nennt generische Sätze');
  check(enP.includes('Also report true if any FORBIDDEN generic line appears'), 'P1 en Q3 nennt generische Sätze');
}

// ── P2: Pflicht-Katalog der Scroll-Stop-Mechaniken ──────────────────────────
section('P2 Mechanik-Katalog + Pflicht-Präfix (de + en)');
{
  const deP = pickSystemPrompt('todayIdea', 'de');
  const enP = pickSystemPrompt('todayIdea', 'en');
  const mechDe = ['Transformation', 'Reveal', 'unerwartetes Ergebnis', 'Problem/Payoff', 'Neugierlücke'];
  const mechEn = ['Transformation', 'Reveal', 'unexpected result', 'Problem/Payoff', 'curiosity gap'];
  for (const m of mechDe) check(deP.includes(m), `P2 de Katalog enthält „${m}“`);
  for (const m of mechEn) check(enP.includes(m), `P2 en Katalog enthält „${m}“`);
  check(deP.includes('Du MUSST GENAU EINE Mechanik'), 'P2 de: genau eine Mechanik ist Pflicht');
  check(enP.includes('Choose EXACTLY ONE TikTok-native mechanic'), 'P2 en: genau eine Mechanik ist Pflicht');
  check(deP.includes('„Mechanik: Reveal — …"'), 'P2 de: Pflicht-Format „Mechanik: <Name> — …“');
  check(enP.includes('"Mechanic: Reveal — …"'), 'P2 en: Pflicht-Format "Mechanic: <name> — …"');
  // Schema-Feld scrollStop verlangt das Präfix ebenfalls (sonst kennt das Modell
  // das Format nicht zwingend im Ausgabe-Schema)
  check(deP.includes('„Mechanik: <Name> — "'), 'P2 de: scrollStop-Schema verlangt Präfix');
  check(enP.includes('"Mechanic: <name> — "'), 'P2 en: scrollStop-Schema verlangt Präfix');
  // „Mechanik muss tatsächlich sichtbar sein" — keine reine Erklärung
  check(deP.includes('muss im ersten Bild/Film-Moment TATSÄCHLICH sichtbar sein'), 'P2 de: Mechanik muss sichtbar sein');
  check(enP.includes('must ACTUALLY be visible in the first image/filmed moment'), 'P2 en: Mechanik muss sichtbar sein');
}

// ── P3: Bedeutungserhalt im Nutzer-Prompt (Owner-Kriterium 1) ───────────────
section('P3 Bedeutungserhalt im Prompt-Material („personalisierte Tasse“)');
{
  const deP = buildUserPrompt(baseInput({ mode: 'concept', topic: 'personalisierte Tasse' }), 'de');
  check(deP.includes('personalisierte Tasse'), 'P3 de: Nutzerthema wörtlich im Prompt');
  check(deP.includes('Bedeutungserhalt (PFLICHT)'), 'P3 de: Bedeutungserhalt-Pflichtzeile steht im Prompt');
  for (const attr of ['Name', 'Foto', 'Text', 'Design']) {
    check(deP.includes(attr), `P3 de: Merkmal „${attr}“ ist verankert`);
  }
  check(deP.includes('Deute das Thema NIEMALS um'), 'P3 de: Umdeutungs-Verbot im Prompt');
  check(
    deP.includes('die Tassenform beeinflusst den Kaffeegeschmack'),
    'P3 de: verbotenes Umdeutungs-Beispiel wörtlich benannt',
  );
  check(
    deP.includes('als sichtbares Element UND als Payoff'),
    'P3 de: Merkmal muss sichtbar UND Payoff sein',
  );
  const enP = buildUserPrompt(baseInput({ mode: 'concept', topic: 'personalized mug' }), 'en');
  check(enP.includes('personalized mug'), 'P3 en: topic literally in prompt');
  check(enP.includes('Meaning preservation (MANDATORY)'), 'P3 en: meaning-preservation line present');
  for (const attr of ['name', 'photo', 'text', 'design']) {
    check(new RegExp(attr, 'i').test(enP), `P3 en: attribute "${attr}" anchored`);
  }
  check(enP.includes('NEVER reinterpret the topic'), 'P3 en: reinterpretation ban in prompt');
  check(
    enP.includes('the shape of the mug influences the taste of the coffee'),
    'P3 en: forbidden reinterpretation example named',
  );
  // Ohne Nutzerthema darf der Block NICHT auftauchen (kein Rauschen im Prompt)
  const noTopic = buildUserPrompt(baseInput({ mode: 'concept' }), 'de');
  check(!noTopic.includes('Bedeutungserhalt (PFLICHT)'), 'P3 de: ohne Thema kein Bedeutungserhalt-Block');
  // Die Merkmale des Nutzerthemas werden NICHT umgeschrieben (Wortlaut bleibt)
  check(
    buildUserPrompt(baseInput({ mode: 'concept', topic: 'minimalistischer Schmuck' }), 'de').includes(
      'minimalistischer Schmuck',
    ),
    'P3 de: Thema „minimalistischer Schmuck“ bleibt unverändert im Prompt',
  );
}

// ── P4: Diagnose bleibt unangetastet (kein Umbau) ───────────────────────────
section('P4 Diagnose-Prompt ohne Inhalts-Mandat (Regressionsschutz)');
{
  const dDe = pickSystemPrompt('diagnose', 'de');
  const dEn = pickSystemPrompt('diagnose', 'en');
  check(!dDe.includes('INHALTS-MANDAT'), 'P4 de: Diagnose-Prompt unverändert (kein Idee-Mandat)');
  check(!dEn.includes('CONTENT MANDATE'), 'P4 en: Diagnose-Prompt unverändert (kein Idee-Mandat)');
  check(dDe.includes('TikTok-Diagnostiker'), 'P4 de: Diagnose-Prompt weiterhin vorhanden');
}

// ── G1: GENERIC_PATTERNS erkennen die Owner-Sätze (Ablehnen) ────────────────
section('G1 GENERIC_PATTERNS lehnen die generischen Sätze ab');
{
  const deHits: Array<[string, string]> = [
    ['Finde deinen Stil', 'GENERIC:finde-deinen-stil'],
    ['Finde deinen Stil — mit deiner Tasse', 'GENERIC:finde-deinen-stil'],
    ['Der Unterschied ist sofort sichtbar', 'GENERIC:unterschied-sofort-sichtbar'],
    ['Der Unterschied ist direkt sichtbar', 'GENERIC:unterschied-sofort-sichtbar'],
    ['Entdecke dein volles Potenzial', 'GENERIC:entdecke-dein-potenzial'],
    ['Das Beste für dich', 'GENERIC:das-beste-fuer-dich'],
    ['Heb dich von der Masse ab', 'GENERIC:hebe-dich-ab'],
  ];
  for (const [text, expect] of deHits) {
    const hits = genericViolations(text.toLowerCase());
    check(hits.includes(expect), `G1 de „${text}“ → ${expect}`);
  }
  const enHits: Array<[string, string]> = [
    ['Find your own style', 'GENERIC:find-your-style'],
    ['The difference is immediately visible', 'GENERIC:difference-immediately-visible'],
    ['Discover your full potential', 'GENERIC:discover-your-potential'],
    ['The best for you', 'GENERIC:the-best-for-you'],
    ['Stand out from the crowd', 'GENERIC:stand-out-from-the-crowd'],
  ];
  for (const [text, expect] of enHits) {
    const hits = genericViolations(text.toLowerCase());
    check(hits.includes(expect), `G1 en "${text}" → ${expect}`);
  }
  // 4 Sätze gleichzeitig → 4 Treffer (Owner-Beispiele „Finde deinen Stil" +
  // „Der Unterschied ist sofort sichtbar" + „Entdecke dein Potenzial" +
  // „Das Beste für dich")
  const ownerFour = 'Finde deinen Stil Der Unterschied ist sofort sichtbar Entdecke dein Potenzial Das Beste für dich';
  check(genericViolations(ownerFour.toLowerCase()).length >= 4, 'G1 Owner-Sätze: 4 Treffer gleichzeitig');
  // Musterliste enthält beide beanstandeten Sätze des Owners (Determinismus)
  check(
    GENERIC_PATTERNS.some((p) => p.re.test('finde deinen stil')) &&
      GENERIC_PATTERNS.some((p) => p.re.test('der unterschied ist sofort sichtbar')),
    'G1 GENERIC_PATTERNS enthält beide Owner-Sätze',
  );
  // Groß-/Kleinschreibung egal
  check(genericViolations('FINDE DEINEN STIL').length > 0, 'G1 Großschreibung wird erkannt');
}

// ── G2: Keine False Positives (produktspezifische Sätze bleiben erlaubt) ────
section('G2 produkt-/detail-spezifische Sätze werden NICHT verworfen');
{
  const clean = [
    'Diese Tasse kennt ihren Namen — die Gravur erscheint in Sekunde 1.',
    'Auf der Tasse steht der Vorname deiner Mutter, in Schreibschrift graviert.',
    'Handgemachte Keramik aus nachhaltigem Ton, 29 EUR pro Stück.',
    'Das Beste aus drei Design-Varianten zeigen',
    'Der Unterschied zwischen zwei Gravur-Schriften im direkten Vergleich',
    'Minimalistischer Schmuck: eine Kette, ein Anhänger, ein Name.',
    'Ich finde deinen Ansatz spannend — hier ist meine Variante.',
  ];
  for (const t of clean) {
    check(genericViolations(t.toLowerCase()).length === 0, `G2 kein False Positive: „${t.slice(0, 42)}…“`);
  }
  check(genericViolations('').length === 0, 'G2 leere Eingabe → keine Treffer');
}

// ── G3: Post-Check deckt ALLE Textfelder ab ────────────────────────────────
section('G3 Post-Check prüft jedes Textfeld (Blob-Abdeckung)');
{
  const slogan = 'Finde deinen Stil';
  const base = cleanIdea(true);
  const fields: Array<[string, (o: Record<string, unknown>) => void]> = [
    ['hook', (o) => (o.hook = slogan)],
    ['idea', (o) => (o.idea = slogan)],
    ['scrollStop', (o) => (o.scrollStop = slogan)],
    ['tension', (o) => (o.tension = slogan)],
    ['caption', (o) => (o.caption = slogan)],
    ['cta', (o) => (o.cta = slogan)],
    ['why', (o) => (o.why = slogan)],
    ['title', (o) => (o.title = slogan)],
    ['format', (o) => (o.format = slogan)],
    ['spokenText', (o) => (o.spokenText = slogan)],
    ['overlays', (o) => (o.overlays = [slogan])],
    ['scenes', (o) => (o.scenes = [slogan])],
    ['timedScenes.scene', (o) => (o.timedScenes = [{ time: '0-3s', scene: slogan, text: '' }])],
    ['timedScenes.text', (o) => (o.timedScenes = [{ time: '0-3s', scene: 'Tasse drehen', text: slogan }])],
    ['imageIdeas.description', (o) => (o.imageIdeas = [{ description: slogan, studioPrompt: 'Keramik' }])],
    ['imageIdeas.studioPrompt', (o) => (o.imageIdeas = [{ description: 'Cover', studioPrompt: slogan }])],
  ];
  for (const [name, mutate] of fields) {
    const o = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    mutate(o);
    check(
      genericViolations(blob(o as unknown as TikTokIdeaResult)).length > 0,
      `G3 generischer Satz in „${name}“ wird erkannt`,
    );
  }
  // Saubere Idee → keine Treffer (Regressionsschutz gegen Überprüfung)
  check(genericViolations(blob(base as unknown as TikTokIdeaResult)).length === 0, 'G3 saubere Idee → keine Treffer');
}

// ── G4: genericFreeResult (Entfernen, idempotent, kein Rückfall) ────────────
section('G4 genericFreeResult entfernt die Sätze deterministisch');
{
  const dirty = JSON.parse(JSON.stringify(genericIdea(true))) as TikTokIdeaResult;
  check(genericViolations(blob(dirty)).length >= 4, 'G4 Ausgangslage: 4 Treffer');
  const cleaned = genericFreeResult(dirty);
  check(genericViolations(blob(cleaned)).length === 0, 'G4 Ergebnis ist generik-frei');
  check(!/finde deinen stil/i.test(blob(cleaned)), 'G4 „Finde deinen Stil“ entfernt (Hook war der Satz selbst)');
  check(
    !cleaned.overlays.some((o) => /unterschied ist sofort sichtbar|das beste für dich/i.test(o)),
    'G4 Overlays bereinigt',
  );
  check(cleaned.hook.trim() === '', 'G4 Ganzfeld-Füllung wird NICHT als Original zurückgeholt (ehrlich leer)');
  check(cleaned.idea.includes('eingravierte Name'), 'G4 produktspezifischer Inhalt bleibt erhalten');
  check(cleaned.caption.includes('Namensgravur'), 'G4 Caption bleibt erhalten');
  // Idempotenz + Identität bei sauberem Ergebnis
  check(JSON.stringify(genericFreeResult(cleaned)) === JSON.stringify(cleaned), 'G4 idempotent');
  const cleanResult = JSON.parse(JSON.stringify(cleanIdea(true))) as TikTokIdeaResult;
  check(genericFreeResult(cleanResult) === cleanResult, 'G4 saubere Idee: identisches Objekt (kein Kopieren)');
  // Satz MIT Rest: nur der Slogan verschwindet, der Rest bleibt
  const mixed = JSON.parse(JSON.stringify(cleanIdea(true))) as TikTokIdeaResult;
  mixed.hook = 'Finde deinen Stil: der Name auf der Tasse zählt';
  const mixedOut = genericFreeResult(mixed);
  check(!/finde deinen stil/i.test(mixedOut.hook), 'G4 eingebetteter Slogan entfernt');
  check(/der name auf der tasse/i.test(mixedOut.hook), 'G4 Resttext bleibt erhalten');
  check(!/^[:\s]/.test(mixedOut.hook), 'G4 kein verwaistes Satzzeichen am Feldanfang');
  // Kette wie in der Engine: Platzhalter-Entfernung → Anti-Generik
  const chain = JSON.parse(JSON.stringify(genericIdea(true))) as TikTokIdeaResult;
  (chain as unknown as Record<string, unknown>).overlays = [
    'Sound: <beliebig wählen>',
    'Finde deinen Stil',
  ];
  const chainOut = genericFreeResult(placeholderFreeResult(chain));
  check(genericViolations(blob(chainOut)).length === 0, 'G4 Kette: Ergebnis generik-frei');
  check(placeholderViolations(blob(chainOut)).length === 0, 'G4 Kette: Ergebnis platzhalterfrei');
}

// ── E1/E2/E5: Engine-E2E (todayIdea + concept, de) ─────────────────────────
section('E1 Engine: generische Idee → Soft-Reject + Retry (todayIdea, de)');
{
  reset((attempt) => {
    if (attempt === 1) return JSON.stringify(genericIdea(true));
    return JSON.stringify(cleanIdea(true));
  });
  const r = await generateTikTok(baseInput({ mode: 'todayIdea' }), 'de');
  check(attemptCounter === 2, `E1a genau 2 Versuche (ist ${attemptCounter})`);
  check(genericViolations(blob(r as TikTokIdeaResult)).length === 0, 'E1b Ergebnis ohne generische Sätze');
  check(seenUserPrompts[1].includes('ANTI-GENERIK'), 'E1c Retry-Prompt enthält Anti-Generik-Hinweis (de)');
  check(
    seenUserPrompts[1].includes('GENERIC:finde-deinen-stil'),
    'E1d Retry-Prompt nennt den erkannten Verstoß beim Namen (transparent, wie PLACEHOLDER:)',
  );
  check((r as TikTokIdeaResult).hook.includes('Diese Tasse kennt ihren Namen'), 'E1e Retry-Ergebnis wird ausgegeben');
}
section('E2 Engine: concept „personalisierte Tasse“ — Bedeutungserhalt + Anti-Generik (de)');
{
  reset((attempt) => (attempt === 1 ? JSON.stringify(genericIdea(true)) : JSON.stringify(cleanIdea(true))));
  const r = await generateTikTok(
    baseInput({ mode: 'concept', topic: 'personalisierte Tasse' }),
    'de',
  );
  check(attemptCounter === 2, `E2a genau 2 Versuche (ist ${attemptCounter})`);
  check(seenUserPrompts[0].includes('Bedeutungserhalt (PFLICHT)'), 'E2b Versuch 1 enthält Bedeutungserhalt-Pflicht');
  check(seenUserPrompts[0].includes('personalisierte Tasse'), 'E2c Nutzerthema im Prompt');
  check(seenUserPrompts[0].includes('Tassenform beeinflusst den Kaffeegeschmack'), 'E2d Umdeutungs-Verbot benannt');
  check(seenUserPrompts[1].includes('ANTI-GENERIK'), 'E2e Retry-Prompt enthält Anti-Generik-Hinweis');
  check(genericViolations(blob(r as TikTokIdeaResult)).length === 0, 'E2f Ergebnis generik-frei');
}
section('E3 Engine: concept (en) — Anti-Generic + Meaning-Preservation');
{
  reset((attempt) => (attempt === 1 ? JSON.stringify(genericIdea(false)) : JSON.stringify(cleanIdea(false))));
  const r = await generateTikTok(
    baseInput({ mode: 'concept', topic: 'personalized mug' }),
    'en',
  );
  check(attemptCounter === 2, `E3a exactly 2 attempts (is ${attemptCounter})`);
  check(seenUserPrompts[0].includes('Meaning preservation (MANDATORY)'), 'E3b attempt 1 has meaning preservation');
  check(seenUserPrompts[1].includes('ANTI-GENERIC'), 'E3c retry prompt has anti-generic note');
  check(genericViolations(blob(r as TikTokIdeaResult)).length === 0, 'E3d result free of generic lines');
}
section('E4 Engine: dauerhaft generisch → bestmögliche Idee OHNE Slogan');
{
  reset(() => JSON.stringify(genericIdea(true)));
  const r = (await generateTikTok(baseInput({ mode: 'todayIdea' }), 'de')) as TikTokIdeaResult;
  check(attemptCounter === 4, `E4a 4 Versuche ausgeschöpft (ist ${attemptCounter})`);
  check(genericViolations(blob(r)).length === 0, 'E4b Ergebnis enthält KEINEN verbotenen Satz');
  check(r.idea.includes('eingravierte Name'), 'E4c produktspezifische Inhalte bleiben erhalten');
  check(r.hook === '', 'E4d reine Slogan-Hook bleibt leer statt generisch (ehrlich)');
}
section('E5 Regression: saubere Idee läuft ohne Retry durch (keine falschen Ablehnungen)');
{
  reset(() => JSON.stringify(cleanIdea(true)));
  const r = (await generateTikTok(baseInput({ mode: 'todayIdea' }), 'de')) as TikTokIdeaResult;
  check(attemptCounter === 1, `E5a genau 1 Versuch (ist ${attemptCounter})`);
  check(r.hook.includes('Diese Tasse kennt ihren Namen'), 'E5b Hook unverändert');
  check(r.scrollStop !== undefined && r.scrollStop.startsWith('Mechanik: Reveal'), 'E5c Scroll-Stop unverändert');
  check((r.hashtags ?? []).length <= 5, 'E5d Hashtag-Grenze eingehalten');
  reset(() => JSON.stringify(cleanIdea(false)));
  const rEn = (await generateTikTok(baseInput({ mode: 'concept', topic: 'minimalist jewelry' }), 'en')) as TikTokIdeaResult;
  check(attemptCounter === 1, `E5e en: genau 1 Versuch (ist ${attemptCounter})`);
  check(rEn.hook.length > 0, 'E5f en: Hook vorhanden');
}

// ── R1/R2/R3: unveränderte Phase-1/2/6-Pflichten ───────────────────────────
section('R1 Regression: Phase-2-Strukturpflichten unverändert (de + en)');
{
  const deP = pickSystemPrompt('concept', 'de');
  const enP = pickSystemPrompt('concept', 'en');
  const deReq = [
    'SCROLL-STOP-MOMENT (PFLICHTFELD „scrollStop")',
    'SPANNUNGSBOGEN (PFLICHTFELD „tension")',
    'SZENENPLAN MIT SEKUNDEN (PFLICHT)',
    'SPRECHTEXT:',
    'Texteinblendungen (PFLICHT)',
    'Caption (PFLICHT)',
    'NIEMALS mehr als 5',
    'KEINE PLATZHALTER (harte Regel)',
    'CTAs natürlich',
    'KOMPLETTES KONZEPT (PFLICHTFELDER',
  ];
  const enReq = [
    'SCROLL-STOP MOMENT (MANDATORY FIELD "scrollStop")',
    'TENSION ARC (MANDATORY FIELD "tension")',
    'SCENE PLAN WITH SECONDS (MANDATORY)',
    'SPOKEN TEXT:',
    'Text overlays (MANDATORY)',
    'Caption (MANDATORY)',
    'NEVER more than 5',
    'NO PLACEHOLDERS (HARD RULE)',
    'CTAs must be natural',
    'COMPLETE CONCEPT',
  ];
  for (const s of deReq) check(deP.includes(s), `R1 concept(de) enthält „${s}“`);
  for (const s of enReq) check(enP.includes(s), `R1 concept(en) enthält "${s}"`);
}
section('R2 Regression: Platzhalter-Pfad unverändert (zusätzliche Prüfung)');
{
  const dirty = JSON.parse(JSON.stringify(cleanIdea(true))) as TikTokIdeaResult;
  dirty.overlays = ['Sound: <beliebig wählen>'];
  (dirty as unknown as Record<string, unknown>).hook = 'Finde deinen Stil';
  const found = [
    ...placeholderViolations(blob(dirty)),
    ...genericViolations(blob(dirty)),
  ];
  check(found.some((v) => v.startsWith('PLACEHOLDER:')), 'R2a Platzhalter wird weiterhin gemeldet');
  check(found.some((v) => v.startsWith('GENERIC:')), 'R2b Anti-Generik kommt zusätzlich dazu');
  reset(() => JSON.stringify(dirty));
  const r = (await generateTikTok(baseInput({ mode: 'todayIdea' }), 'de')) as TikTokIdeaResult;
  check(attemptCounter === 4, `R2c beide Verstöße lösen Retries aus (4 Versuche: ${attemptCounter})`);
  check(placeholderViolations(blob(r)).length === 0, 'R2d Ergebnis platzhalterfrei');
  check(genericViolations(blob(r)).length === 0, 'R2e Ergebnis generik-frei');
}
section('R3 Regression: todayIdea-Kernanweisungen unverändert');
{
  const deP = pickSystemPrompt('todayIdea', 'de');
  const enP = pickSystemPrompt('todayIdea', 'en');
  const deReq = [
    'ZIELGRUPPEN-PERSPEKTIVE (harte Regel)',
    'PRODUKT IST NICHT DAS THEMA (harte Regel)',
    'ANTI-WERBE-MANDAT (Mensch zuerst)',
    'QUALITÄTS-MANDAT',
    'SELBSTREFERENZ-VERBOT (heute-Idee)',
    'Richtungs-Katalog',
  ];
  const enReq = [
    'TARGET-AUDIENCE PERSPECTIVE (hard rule)',
    'PRODUCT IS NOT THE TOPIC (hard rule)',
    'ANTI-AD MANDATE (human first)',
    'QUALITY MANDATE',
    'SELF-REFERENCE BAN (daily idea)',
    'Direction catalog',
  ];
  for (const s of deReq) check(deP.includes(s), `R3 todayIdea(de) enthält „${s}“`);
  for (const s of enReq) check(enP.includes(s), `R3 todayIdea(en) enthält "${s}"`);
  // Die Richtungsvorgabe kommt weiterhin aus dem Nutzer-Prompt (Growimo entscheidet)
  const up = buildUserPrompt(baseInput({ mode: 'todayIdea' }), 'de');
  check(up.includes('Content-Richtung'), 'R3 Richtungs-Block im Nutzer-Prompt vorhanden');
}
section('R4 i18n de/en Parität');
{
  const deKeys = Object.keys((await import('./src/i18n/de')).de);
  const enKeys = Object.keys((await import('./src/i18n/en')).en);
  check(deKeys.length === enKeys.length, `R4a gleiche Key-Anzahl (de=${deKeys.length}, en=${enKeys.length})`);
  check(
    deKeys.every((k) => enKeys.includes(k)) && enKeys.every((k) => deKeys.includes(k)),
    'R4b keine einseitigen Keys',
  );
}

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\nStabilisierung Phase 5g (Test C Nachschärfung): ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('PHASE 5g TEST-C-NACHSCHÄRFUNG GRÜN');
server.stop(true);
