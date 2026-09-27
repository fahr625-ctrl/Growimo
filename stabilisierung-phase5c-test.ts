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
  inventedContextViolations,
  inventedContextFreeResult,
  inventedGroundingBlob,
  categoryFormatViolations,
  concreteFormatNames,
  personalStoryViolations,
  personalStoryFreeResult,
  PERSONAL_STORY_PATTERNS,
  OPEN_CATEGORY_PATTERNS,
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

// ── P5: RUNDE 2 — konkretes Format/Material + Verbot erfundener Anlässe ─────
section('P5 Runde 2: konkretes Produktformat + Verbot erfundener Anlässe/Zielgruppen (de + en)');
{
  for (const mode of ['todayIdea', 'concept'] as const) {
    const deP = pickSystemPrompt(mode, 'de');
    const enP = pickSystemPrompt(mode, 'en');
    // (a) konkretes Format/Material/Detail als Pflicht (Owner-Kriterien 1+4)
    check(deP.includes('6. KONKRETES PRODUKTFORMAT (harte Regel)'), `P5 ${mode}(de): Regel „konkretes Produktformat"`);
    check(enP.includes('6. CONCRETE PRODUCT FORMAT (hard rule)'), `P5 ${mode}(en): "concrete product format" rule`);
    check(deP.includes('MIT Material/Finish und einem Trage-/Nutzungsdetail'), `P5 ${mode}(de): Material/Finish + Tragedetail sind Pflicht`);
    check(enP.includes('WITH material/finish and a wearing/usage detail'), `P5 ${mode}(en): material/finish + wearing detail mandatory`);
    check(deP.includes('„eine zarte Goldkette mit einem einzelnen Kreis-Anhänger"'), `P5 ${mode}(de): konkretes Format/Material als Beispiel`);
    check(enP.includes('"a delicate gold chain with a single circular pendant"'), `P5 ${mode}(en): concrete format/material example`);
    check(deP.includes('statt „ein Schmuckstück"/„ein Accessoire"'), `P5 ${mode}(de): bloße Kategorie ist verboten (wörtlich)`);
    check(enP.includes('instead of "a piece of jewelry"/"an accessory"'), `P5 ${mode}(en): bare category is banned (literally)`);
    check(deP.includes('Idee UNGÜLTIG: verwirf sie und generiere neu'), `P5 ${mode}(de): Selbstprüfung mit Verwerfen`);
    check(enP.includes('the idea is INVALID: discard it and regenerate'), `P5 ${mode}(en): self-check with discard`);
    // (b) erfundene Anlässe/Zielgruppen/Nutzungskontexte (Owner-Kriterium 5)
    check(deP.includes('ANLASS (z. B. „perfekt für dein Vorstellungsgespräch"'), `P5 ${mode}(de): Anlass-Verbot benannt`);
    check(deP.includes('ZIELGRUPPE (z. B. „stilbewusste Zuschauer"'), `P5 ${mode}(de): Zielgruppen-Verbot benannt`);
    check(deP.includes('NUTZUNGSKONTEXT ALS EMPFEHLUNG'), `P5 ${mode}(de): Nutzungskontext-Verbot benannt`);
    check(deP.includes('wenn der Nutzer ihn selbst genannt hat'), `P5 ${mode}(de): Anlass nur bei Nutzerangabe`);
    check(deP.includes('wenn der Nutzer sie genannt hat'), `P5 ${mode}(de): Zielgruppe nur bei Nutzerangabe`);
    check(deP.includes('erfundene Anlass-, Zielgruppen- oder Kontext-Behauptung ist ein HARTES VERFEHLEN'), `P5 ${mode}(de): erfundene Behauptung = hartes Verfehlen`);
    check(enP.includes('OCCASION (e.g. "perfect for your job interview"'), `P5 ${mode}(en): occasion ban named`);
    check(enP.includes('TARGET AUDIENCE (e.g. "style-conscious viewers"'), `P5 ${mode}(en): audience ban named`);
    check(enP.includes('USAGE CONTEXT AS A RECOMMENDATION'), `P5 ${mode}(en): usage-context ban named`);
    check(enP.includes('ONLY if the user named it'), `P5 ${mode}(en): only-if-user-named condition`);
    check(enP.includes('is a HARD FAIL (owner criteria 4 and 5)'), `P5 ${mode}(en): invented claim = hard fail`);
  }
}

// ── I1: deterministischer Post-Check — erfundene Anlässe/Zielgruppen ────────
section('I1 erfundene Anlässe/Zielgruppen werden deterministisch erkannt');
{
  const owner = 'Perfekt für dein nächstes Vorstellungsgespräch! Was bei stilbewussten Zuschauern den Scroll stoppt.';
  const hits = inventedContextViolations(owner.toLowerCase(), '');
  check(hits.includes('INVENTED:anlass-vorstellungsgespraech'), 'I1a Anlass „Vorstellungsgespräch" erkannt');
  check(hits.includes('INVENTED:zielgruppe-stilbewusst'), 'I1b Zielgruppe „stilbewusste Zuschauer" erkannt');
  check(hits.length === 2, `I1c genau 2 Treffer (ist ${hits.length})`);
  // (Runde 3: „perfect for …" erzeugt zusätzlich einen Nutzungskontext-Treffer
  // („job") — die Erkennung des Anlasses bleibt davon unberührt.)
  check(
    inventedContextViolations('perfect for your job interview', '').includes('INVENTED:anlass-vorstellungsgespraech'),
    'I1d en: „job interview" erkannt',
  );
  check(
    inventedContextViolations('the perfect christmas gift for style-conscious viewers', '').length === 2,
    'I1e en: Weihnachten + "style-conscious viewers" erkannt (=2)',
  );
  check(inventedContextViolations('ideal zum valentinstag für fashionistas', '').length === 2, 'I1f Valentinstag + Fashionistas erkannt');
  // Grounding: nennt der Nutzer den Anlass, ist es KEIN Verstoß
  check(
    inventedContextViolations('perfekt für deine hochzeit', 'hochzeitsdeko aus ton').length === 0,
    'I1g vom Nutzer genannter Anlass bleibt erlaubt',
  );
  check(
    inventedContextViolations('for style-conscious viewers', 'zielgruppe: style-conscious designers').length === 0,
    'I1h vom Nutzer genannte Zielgruppe bleibt erlaubt',
  );
  // Keine False Positives für die GRÜNE Idee 1 (Tasse) inkl. Szenen-Schauplatz
  const idea1 =
    'nie wieder tassenverwechslung im büro! eine person am schreibtisch greift zur tasse mit namensgravur. '
    + 'der name auf der tasse ist der payoff. viele im team greifen sonst zur falschen tasse.';
  check(inventedContextViolations(idea1, 'personalisierte tasse').length === 0, 'I1i Idee 1 (Tasse) löst keinen Treffer aus');
  check(inventedContextViolations('', '').length === 0, 'I1j leere Eingabe → keine Treffer');
}

// ── I2: Endreinigung entfernt nur die betroffenen Sätze ─────────────────────
section('I2 inventedContextFreeResult entfernt die erfundenen Sätze (satzweise)');
{
  const dirty = JSON.parse(JSON.stringify(cleanIdea(true))) as unknown as TikTokIdeaResult;
  dirty.hook = 'Perfekt für dein nächstes Vorstellungsgespräch!';
  dirty.overlays = [
    'Diese schmale Goldkette mit Kreis-Anhänger bleibt im Alltag sichtbar.',
    'Was bei stilbewussten Zuschauern den Scroll stoppt.',
  ];
  dirty.caption = 'Schmale Goldkette mit Kreis-Anhänger: so trägst du sie.';
  const out = inventedContextFreeResult(dirty, '');
  check(out.hook.trim() === '', 'I2a Ganzfeld-Behauptung → ehrlich leeres Feld');
  check(out.caption.includes('Schmale Goldkette'), 'I2b saubere Sätze bleiben erhalten');
  check(out.overlays.length === 1 && out.overlays[0].includes('Kreis-Anhänger'), 'I2c nur der betroffene Satz fliegt raus');
  check(inventedContextViolations(ideaPlaceholderBlob(out), '').length === 0, 'I2d Ergebnis ohne erfundene Anlässe/Zielgruppen');
  check(
    JSON.stringify(inventedContextFreeResult(out, '')) === JSON.stringify(out),
    'I2e idempotent',
  );
  const clean = cleanIdea(true) as unknown as TikTokIdeaResult;
  check(inventedContextFreeResult(clean, '') === clean, 'I2f saubere Idee: identisches Objekt (kein Kopieren)');
  const wed = JSON.parse(JSON.stringify(cleanIdea(true))) as unknown as TikTokIdeaResult;
  wed.hook = 'Perfekt für deine Hochzeit!';
  check(
    inventedContextFreeResult(wed, 'hochzeitsdeko aus ton').hook.includes('Hochzeit'),
    'I2g vom Nutzer genannter Anlass wird NICHT entfernt',
  );
}

// ── I3: Engine — erfundener Anlass → Soft-Reject + Retry-Hinweis ────────────
section('I3 Engine: erfundener Anlass/Zielgruppe → Retry mit gezieltem Hinweis');
{
  const attempt1 = JSON.parse(JSON.stringify(cleanIdea(true))) as unknown as TikTokIdeaResult;
  attempt1.hook = 'Perfekt für dein nächstes Vorstellungsgespräch! Diese zarte Goldkette fällt sofort auf.';
  attempt1.cta = 'Was bei stilbewussten Zuschauern den Scroll stoppt.';
  const attempt2 = JSON.parse(JSON.stringify(cleanIdea(true))) as unknown as TikTokIdeaResult;
  attempt2.hook = 'Diese zarte Goldkette mit Kreis-Anhänger dreht sich in Sekunde 1 ins Licht.';
  reset((a) => JSON.stringify(a === 1 ? attempt1 : attempt2));
  const input = baseInput({ mode: 'concept', topic: 'minimalistischer Schmuck' });
  const r = (await generateTikTok(input, 'de')) as TikTokIdeaResult;
  check(attemptCounter === 2, `I3a genau 2 Versuche (ist ${attemptCounter})`);
  check(seenUserPrompts[1].includes('ERFUNDENER ANLASS'), 'I3b Retry-Prompt nennt das Verbot erfundener Anlässe');
  check(
    seenUserPrompts[1].includes('INVENTED:anlass-vorstellungsgespraech'),
    'I3c Retry-Prompt listet den erkannten Verstoß namentlich',
  );
  check(inventedContextViolations(ideaPlaceholderBlob(r), inventedGroundingBlob(input)).length === 0, 'I3d Ergebnis ohne erfundene Anlässe/Zielgruppen');
  check(r.hook.includes('Kreis-Anhänger'), 'I3e Retry-Ergebnis wird ausgegeben');
}

// ── I4: Engine — dauerhaft erfundene Anlässe → Satz wird entfernt ───────────
section('I4 Engine: dauerhaft erfundene Behauptung → letzte Idee OHNE den Satz');
{
  const dirty = JSON.parse(JSON.stringify(cleanIdea(true))) as unknown as TikTokIdeaResult;
  dirty.hook = 'Perfekt für dein nächstes Vorstellungsgespräch!';
  dirty.cta = 'Was bei stilbewussten Zuschauern den Scroll stoppt.';
  dirty.why = 'Das überzeugt modebewusste Zuschauer sofort.';
  reset(() => JSON.stringify(dirty));
  const input = baseInput({ mode: 'concept', topic: 'minimalistischer Schmuck' });
  const r = (await generateTikTok(input, 'de')) as TikTokIdeaResult;
  check(attemptCounter === 4, `I4a 4 Versuche ausgeschöpft (ist ${attemptCounter})`);
  check(inventedContextViolations(ideaPlaceholderBlob(r), inventedGroundingBlob(input)).length === 0, 'I4b Ergebnis enthält KEINE erfundene Anlass-/Zielgruppen-Behauptung');
  check(r.hook === '', 'I4c reine Behauptungs-Hook bleibt leer statt erfunden');
  check(r.idea.includes('eingravierte Name'), 'I4d produktspezifischer Inhalt bleibt erhalten');
}


// ── J1: RUNDE 3 — erfundener NUTZUNGSKONTEXT als Empfehlung (deterministisch) ─
// Owner-Beispiel aus dem Runde-2-Befund (Lauf 3): „Von Büro zu Abendessen: Ein
// Accessoire macht den Unterschied!". Erkannt werden nur Empfehlungs-/Label-
// Konstruktionen — neutrale Schauplätze („eine Person an einem Schreibtisch")
// bleiben erlaubt (deshalb bleibt die grüne Tassen-Idee trefferfrei, s. J3).
section('J1 Runde 3: erfundener Nutzungskontext wird deterministisch erkannt');
{
  const owner = 'Von Büro zu Abendessen: Ein Accessoire macht den Unterschied!';
  const hits = inventedContextViolations(owner, '');
  check(
    hits.includes('INVENTED:kontext-von-zu(buro/abendessen)') ||
      hits.includes('INVENTED:kontext-von-zu(abendessen/buro)'),
    `J1a Owner-Beispiel „Von Büro zu Abendessen" erkannt (ist ${hits.join('|')})`,
  );
  check(hits.length === 1, `J1b genau 1 Treffer für das Owner-Beispiel (ist ${hits.length})`);

  const ready = inventedContextViolations('Du bist bereit für ein Abendessen.', '');
  check(
    ready.includes('INVENTED:kontext-bereit-fuer(abendessen)'),
    `J1c „bereit für ein Abendessen" erkannt (ist ${ready.join('|')})`,
  );
  const perf = inventedContextViolations('Perfekt für dein Büro!', '');
  check(
    perf.includes('INVENTED:kontext-perfekt-fuer(buro)'),
    `J1d „Perfekt für dein Büro" erkannt (ist ${perf.join('|')})`,
  );
  const next = inventedContextViolations('Das richtige Format für dein nächstes Meeting.', '');
  check(
    next.some((h) => h.startsWith('INVENTED:kontext-fuer-naechstes')),
    `J1e „für dein nächstes Meeting" erkannt (ist ${next.join('|')})`,
  );
  check(
    inventedContextViolations('Ein Büro-Look für jeden Tag.', '').includes('INVENTED:kontext-look(buro)'),
    'J1f „Büro-Look" erkannt',
  );
  check(
    inventedContextViolations('Ein Alltagslook, der bleibt.', '').includes('INVENTED:kontext-look(alltags)'),
    'J1g „Alltagslook" erkannt',
  );
  check(
    inventedContextViolations('Der Abendlook für dich.', '').includes('INVENTED:kontext-look(abend)'),
    'J1h „Abendlook" erkannt',
  );
  check(
    inventedContextViolations('Ein Video, das von Arbeit zu Wochenende führt.', '').some((h) =>
      h.startsWith('INVENTED:kontext-von-zu'),
    ),
    'J1i zweites von-zu-Beispiel erkannt',
  );
  // en
  check(
    inventedContextViolations('from office to dinner', '').some((h) => h.startsWith('INVENTED:context-from-to')),
    'J1j en: "from office to dinner" erkannt',
  );
  check(
    inventedContextViolations('you are ready for the gym', '').some((h) => h.startsWith('INVENTED:context-ready-for')),
    'J1k en: "ready for the gym" erkannt',
  );
  check(
    inventedContextViolations('perfect for your vacation', '').some((h) => h.startsWith('INVENTED:context-perfect-for')),
    'J1l en: "perfect for your vacation" erkannt',
  );
  check(
    inventedContextViolations('made for your next workout', '').some((h) =>
      h.startsWith('INVENTED:context-for-your-next'),
    ),
    'J1m en: "for your next workout" erkannt',
  );
  check(
    inventedContextViolations('an office look that lasts', '').includes('INVENTED:kontext-look(office)'),
    'J1n en: "office look" erkannt',
  );
}

// ── J2: Grounding — vom Nutzer genannter Kontext ist KEIN Verstoß ───────────
section('J2 Runde 3: Grounding — vom Nutzer genannter Nutzungskontext bleibt erlaubt');
{
  check(
    inventedContextViolations('Bereit für ein Abendessen.', 'schmuck fürs abendessen').length === 0,
    'J2a Nutzer nannte „Abendessen" → kein Verstoß',
  );
  check(
    inventedContextViolations('Perfekt für dein Büro!', 'schmuck fürs büro').length === 0,
    'J2b Nutzer nannte „Büro" → kein Verstoß',
  );
  check(
    inventedContextViolations('Perfekt für dein Büro!', 'schmuck fürs buero').length === 0,
    'J2c Schreibweise „buero" belegt dieselbe Wortgruppe',
  );
  const mixed = inventedContextViolations('Von Büro zu Abendessen', 'schmuck fürs büro');
  check(
    mixed.some((h) => h.includes('abendessen')),
    `J2d halb-belegter Kontext: erfundenes „Abendessen" bleibt Verstoß (ist ${mixed.join('|')})`,
  );
  check(
    !mixed.some((h) => h.includes('buro')),
    `J2e belegtes „Büro" wird nicht mitgemeldet (ist ${mixed.join('|')})`,
  );
  check(
    inventedContextViolations('Ein Büroalltag mit Namen.', 'schmuck fürs büroalltag').length === 0,
    'J2f Kompositum „Büroalltag" belegt die Gruppe (Wortanfang-Grenze)',
  );
  check(
    inventedContextViolations('Ein Abendessen zu zweit.', 'idee: abendessen für paare').length === 0,
    'J2g identischer Begriff belegt',
  );
}

// ── J3: KEINE False Positives auf den echten Outputs aus Runde 1/2 ──────────
// Wörtliche Auszüge der LIVE-Outputs (Tasse = grün mit Büro-Setting; Schmuck
// Lauf 1 = grün) — die neuen Muster dürfen sie NICHT ablehnen. Zusätzlich darf
// bei „personalisierte Tasse" kein Format-Zwang greifen (kein Kategorie-Wort).
const MUG_L1_BLOB = [
  'ein humorvolles tiktok-video, das zeigt, wie eine personalisierte tasse im alltag ein problem lösen kann, z.b. verwechslungen im büro.',
  'wer hat schon wieder meine tasse genommen?!',
  'mechnik: problem/payoff — der frust über eine verwechslungsanfällige tasse zieht die aufmerksamkeit der zuschauer an, die das problem im büroalltag kennen.',
  'nie wieder tassenverwechslung im büro!',
  'ein mitarbeiter schaut verwirrt in die kamera mit einer tasse in der hand.',
  'szenenwechsel: verschiedene mitarbeiter greifen nach der gleichen tasse.',
  'nahaufnahme von mehreren identischen tassen im schrank.',
  'der mitarbeiter lächelt zufrieden, während er aus seiner personalisierten tasse trinkt.',
  'kennst du das auch? #tassenchaos #büroalltag',
  'teile das mit deinem bürofreund, der auch immer seine tasse sucht!',
  'dieses tiktok-video trifft den nerv vieler büroangestellter, die das problem der tassenverwechslung kennen.',
  'nahaufnahme, persönliche tasse mit namen, helles bürolicht, fokus auf den namen, unscharfer hintergrund',
  'büroschrank, viele identische tassen, tageslicht, leichte unordnung',
].join(' ');
const JEWEL_L1_BLOB = [
  'wie du deinen minimalistischen schmuck sauber und glänzend hältst',
  'warum dein schmuck schneller anläuft, als du denkst!',
  'mechnik: problem/payoff — das video beginnt mit einer nahaufnahme eines angelaufenen schmuckstücks, was die zuschauer neugierig macht.',
  'tutorial/how-to – schritt für schritt (passt zum ziel: reichweite durch nützliche tipps)',
  'nahaufnahme eines angelaufenen silberrings',
  'mit einer weichen bürste wird der ring sanft gereinigt',
  'der ring wird mit klarem wasser abgespült',
  'vergleich: der ring glänzt wieder neben einem angelaufenen schmuckstück',
  'so bleibt dein schmuck immer glänzend',
  'mit diesem einfachen trick bleibt dein schmuck immer glänzend!',
  '#schmuckpflege #minimalismus #diy #glänzenderschmuck',
  'teile diesen tipp mit jemandem, dessen schmuck immer glänzen soll!',
].join(' ');
section('J3 Runde 3: keine False Positives auf den echten Runde-1/2-Outputs + kein Format-Zwang bei der Tasse');
{
  check(
    inventedContextViolations(MUG_L1_BLOB, 'personalisierte tasse').length === 0,
    `J3a Tasse L1 (Büro-Setting) → 0 Treffer (ist ${inventedContextViolations(MUG_L1_BLOB, 'personalisierte tasse').join('|')})`,
  );
  check(
    inventedContextViolations(MUG_L1_BLOB, '').length === 0,
    `J3b Tasse L1 auch ohne Grounding-Blob → 0 Treffer (ist ${inventedContextViolations(MUG_L1_BLOB, '').join('|')})`,
  );
  check(
    inventedContextViolations(JEWEL_L1_BLOB, 'minimalistischer schmuck').length === 0,
    `J3c Schmuck Lauf 1 (Silberring) → 0 Treffer (ist ${inventedContextViolations(JEWEL_L1_BLOB, 'minimalistischer schmuck').join('|')})`,
  );
  check(
    !/INVENTED:/.test(ideaPlaceholderBlob(cleanIdea(true) as unknown as TikTokIdeaResult)),
    'J3d saubere Tassen-Idee (Fixture) → 0 Treffer',
  );
  check(
    OPEN_CATEGORY_PATTERNS.filter((p) => p.re.test('personalisierte tasse')).length === 0,
    'J3e Eingabe „personalisierte Tasse" nennt keine offene Produktkategorie',
  );
  check(
    categoryFormatViolations(baseInput({ mode: 'concept', topic: 'personalisierte Tasse' }), {
      idea: 'Zeig die Gravur in Nahaufnahme',
      hook: 'Wer hat meine Tasse genommen?',
      title: 'Tassenverwechslung im Büro',
    }).length === 0,
    'J3f Tassen-Idee: kein Kategorie-Wort → kein Format-Zwang',
  );
  check(
    categoryFormatViolations(baseInput({ mode: 'todayIdea' }), {
      idea: 'Zeig die Gravur in Nahaufnahme',
      hook: 'Wer hat meine Tasse genommen?',
      title: 'Tassenverwechslung',
    }).length === 0,
    'J3g todayIdea (Keramiktassen-Produkt) → kein Format-Zwang',
  );
  check(
    categoryFormatViolations(baseInput({ mode: 'concept', topic: 'personalisierte Tasse' }), {
      idea: 'Eine Person am Schreibtisch greift zur Tasse mit Namensgravur.',
      hook: 'Nie wieder Tassenverwechslung im Büro!',
      title: 'Büroalltag mit Namen',
    }).length === 0,
    'J3h neutrale Büro-Kulisse in der Tassen-Idee bleibt erlaubt',
  );
}

// ── J4: Satzweise Entfernung erfundener Nutzungskontext-Behauptungen ───────
section('J4 Runde 3: inventedContextFreeResult entfernt nur den betroffenen Satz');
{
  const dirty = JSON.parse(JSON.stringify(cleanIdea(true))) as unknown as TikTokIdeaResult;
  dirty.idea =
    'Zeig, wie die Namensgravur entsteht. Von Büro zu Abendessen: ein Accessoire macht den Unterschied!';
  dirty.hook = 'Bereit für ein Abendessen!';
  dirty.caption = 'Deine Keramiktasse bleibt schön. Perfekt für dein Büro!';
  const out = inventedContextFreeResult(dirty, 'personalisierte tasse');
  check(
    out.idea.includes('Namensgravur') && !out.idea.includes('Büro'),
    `J4a Idee: erfundener Satz weg, produktspezifischer Satz bleibt (ist „${out.idea}")`,
  );
  check(out.hook.trim() === '', `J4b Ganzfeld-Behauptung → ehrlich leeres Feld (ist „${out.hook}")`);
  check(
    out.caption.includes('Keramiktasse') && !out.caption.includes('Büro'),
    `J4c Caption: nur der betroffene Satz fliegt (ist „${out.caption}")`,
  );
  check(
    inventedContextViolations(ideaPlaceholderBlob(out), 'personalisierte tasse').length === 0,
    'J4d Ergebnis trefferfrei',
  );
  check(
    JSON.stringify(inventedContextFreeResult(out, 'personalisierte tasse')) === JSON.stringify(out),
    'J4e idempotent',
  );
  const clean = cleanIdea(true) as unknown as TikTokIdeaResult;
  check(inventedContextFreeResult(clean, '') === clean, 'J4f saubere Idee: identisches Objekt (kein Kopieren)');
}

// ── J5: Engine — erfundener Nutzungskontext → Soft-Reject + Retry (de/en) ───
section('J5 Runde 3: erfundener Nutzungskontext → Retry mit namentlicher Verstoßliste (de)');
{
  const attempt1 = JSON.parse(JSON.stringify(cleanIdea(true))) as unknown as TikTokIdeaResult;
  attempt1.idea = 'Zeig die schmale Goldkette mit Kreis-Anhänger im Detail.';
  attempt1.hook = 'Von Büro zu Abendessen: Deine Goldkette macht den Unterschied!';
  attempt1.title = 'Goldkette mit Kreis-Anhänger';
  const attempt2 = JSON.parse(JSON.stringify(attempt1)) as unknown as TikTokIdeaResult;
  attempt2.hook = 'Deine schmale Goldkette dreht sich in Sekunde 1 ins Licht.';
  reset((a) => JSON.stringify(a === 1 ? attempt1 : attempt2));
  const input = baseInput({ mode: 'concept', topic: 'minimalistischer Schmuck' });
  const r = (await generateTikTok(input, 'de')) as TikTokIdeaResult;
  check(attemptCounter === 2, `J5a genau 2 Versuche (ist ${attemptCounter})`);
  check(seenUserPrompts[1].includes('ERFUNDENER ANLASS'), 'J5b Retry-Prompt nennt das Verbot erfundener Behauptungen');
  check(
    seenUserPrompts[1].includes('INVENTED:kontext-von-zu'),
    'J5c Retry-Prompt listet den erkannten Nutzungskontext namentlich',
  );
  check(
    inventedContextViolations(ideaPlaceholderBlob(r), inventedGroundingBlob(input)).length === 0,
    'J5d Ergebnis ohne erfundenen Nutzungskontext',
  );
  check(r.hook.includes('schmale Goldkette'), 'J5e Retry-Ergebnis wird ausgegeben');
}
section('J6 Runde 3: erfundener Nutzungskontext → Retry (en)');
{
  const attempt1 = JSON.parse(JSON.stringify(cleanIdea(false))) as unknown as TikTokIdeaResult;
  attempt1.hook = 'From office to dinner: your gold chain makes the difference!';
  attempt1.title = 'Gold chain with circular pendant';
  const attempt2 = JSON.parse(JSON.stringify(attempt1)) as unknown as TikTokIdeaResult;
  attempt2.hook = 'Your slim gold chain catches the light in second one.';
  reset((a) => JSON.stringify(a === 1 ? attempt1 : attempt2));
  const input = baseInput({ mode: 'concept', topic: 'minimalist jewelry' });
  const r = (await generateTikTok(input, 'en')) as TikTokIdeaResult;
  check(attemptCounter === 2, `J6a exactly 2 attempts (is ${attemptCounter})`);
  check(seenUserPrompts[1].includes('INVENTED OCCASION'), 'J6b retry prompt names the invented-claim ban');
  check(
    seenUserPrompts[1].includes('INVENTED:context-from-to'),
    'J6c retry prompt lists the detected usage context by name',
  );
  check(
    inventedContextViolations(ideaPlaceholderBlob(r), inventedGroundingBlob(input)).length === 0,
    'J6d result free of invented usage context',
  );
}

// ── J7: KONKRETES PRODUKTFORMAT deterministisch (Einheitstests) ─────────────
section('J7 Runde 3: konkretes Format in Idee UND Hook/Titel wird erzwungen');
{
  const jewelryInput = baseInput({ mode: 'concept', topic: 'minimalistischer Schmuck' });
  const bare = categoryFormatViolations(jewelryInput, {
    idea: 'So hältst du deinen minimalistischen Schmuck sauber',
    hook: 'Wie ein einfacher Trick deinen Look sofort eleganter macht',
    title: 'Schneller Eleganz-Boost',
  });
  check(bare.length === 2, `J7a Runde-2-Fehlerbild: Idee UND Hook ohne Format = 2 Verstöße (ist ${bare.length})`);
  check(
    bare.some((v) => v.startsWith('FORMAT:kategorie-ohne-format-idee')),
    `J7b Verstoß nennt das Feld „idee" (ist ${bare.join('|')})`,
  );
  check(
    bare.some((v) => v.startsWith('FORMAT:kategorie-ohne-format-hook')),
    'J7c Verstoß nennt das Feld „hook"',
  );
  check(
    bare.some((v) => v.includes('kategorie:schmuck')),
    'J7d erkannte Kategorie wird benannt',
  );
  const bareCat = categoryFormatViolations(jewelryInput, {
    idea: 'Zeig dein Schmuckstück im Alltag',
    hook: 'Ein Accessoire macht den Unterschied',
    title: 'Dein Teil für jeden Tag',
  });
  check(bareCat.length === 2, `J7e „Schmuckstück"/„Accessoire"/„Teil" = Verstoß (ist ${bareCat.length})`);
  check(
    bareCat.some((v) => v.includes('nur-kategorie:schmuckstueck')),
    `J7f bloße Kategorie wird namentlich benannt (ist ${bareCat.join('|')})`,
  );
  check(
    bareCat.some((v) => v.includes('nur-kategorie:accessoire')),
    'J7g „Accessoire" wird namentlich benannt',
  );
  // Konkretes Format in Idee UND Hook → grün
  const ok = categoryFormatViolations(jewelryInput, {
    idea: 'Eine zarte Goldkette mit einzelnem Kreis-Anhänger wird in Sekunde 1 sichtbar.',
    hook: 'Diese Goldkette mit Kreis-Anhänger dreht sich ins Licht.',
    title: 'Goldkette mit Kreis-Anhänger',
  });
  check(ok.length === 0, `J7h konkretes Format in Idee + Hook = 0 Verstöße (ist ${ok.join('|')})`);
  const okMaterial = categoryFormatViolations(jewelryInput, {
    idea: 'Schmale Silber-Ohrstecker mit mattem Finish werden gezeigt.',
    hook: 'Silber-Ohrstecker, die nicht verrutschen.',
    title: 'Silber-Ohrstecker matt',
  });
  check(okMaterial.length === 0, 'J7i Material/Finish genügt als konkretes Format');
  const okHookOnlyInTitle = categoryFormatViolations(jewelryInput, {
    idea: 'Eine Perlenkette wird um den Hals gelegt.',
    hook: 'Der Trick mit der Perlenkette.',
    title: 'Perlenkette richtig tragen',
  });
  check(okHookOnlyInTitle.length === 0, 'J7j Titel zählt als Hook-Feld');
  // Formate/Materialien werden erkannt (Stichproben de)
  for (const [w, label] of [
    ['Eine schmale Lederarmband-Variante', 'material-leder'],
    ['Edelstahl-Finish', 'material-edelstahl'],
    ['Perlenkette', 'perlen'],
    ['Ohrstecker aus Gold', 'ohrring'],
    ['Anhänger in Kreisform', 'anhaenger'],
    ['Armband mit Gliedern', 'armband'],
    ['Brosche für den Mantel', 'brosche'],
  ] as Array<[string, string]>) {
    const names = concreteFormatNames(w);
    check(
      names.length > 0,
      `J7k „${w}" zählt als konkretes Format (erkannt: ${names.join(',') || '—'} / erwartet u. a. ${label})`,
    );
  }
  check(concreteFormatNames('deinen minimalistischen Schmuck').length === 0, 'J7l bloße Kategorie = kein Format');
  // en
  const jewelryEn = baseInput({ mode: 'concept', topic: 'minimalist jewelry' });
  const bareEn = categoryFormatViolations(jewelryEn, {
    idea: 'How to keep your minimalist jewelry clean',
    hook: 'A simple trick that makes your look more elegant',
    title: 'Instant elegance boost',
  });
  check(bareEn.length === 2, `J7m en: Idee + Hook ohne Format = 2 Verstöße (ist ${bareEn.length})`);
  const okEn = categoryFormatViolations(jewelryEn, {
    idea: 'A delicate gold chain with a single circular pendant.',
    hook: 'This gold chain with a pendant catches the light.',
    title: 'Gold chain with circular pendant',
  });
  check(okEn.length === 0, `J7n en: konkretes Format = 0 Verstöße (ist ${okEn.join('|')})`);
  check(
    categoryFormatViolations(jewelryEn, {
      idea: 'A piece of jewelry you will love',
      hook: 'This accessory changes everything',
      title: 'Your accessory',
    }).some((v) => v.includes('nur-kategorie:schmuckstueck') || v.includes('nur-kategorie:accessoire')),
    'J7o en: "a piece of jewelry"/"an accessory" wird namentlich benannt',
  );
  check(
    categoryFormatViolations(baseInput({ mode: 'concept', topic: 'personalized mug' }), {
      idea: 'Show the engraving',
      hook: 'Who took my mug?',
      title: 'Mug mix-up',
    }).length === 0,
    'J7p en: „personalized mug" → kein Kategorie-Wort, kein Zwang',
  );
}

// ── J8: Engine — fehlendes konkretes Format → Soft-Reject + Retry ──────────
section('J8 Runde 3: fehlendes konkretes Format → Retry mit namentlicher Verstoßliste');
{
  const without = JSON.parse(JSON.stringify(cleanIdea(true))) as unknown as TikTokIdeaResult;
  without.idea = 'So hältst du deinen minimalistischen Schmuck sauber und glänzend.';
  without.hook = 'Wie ein einfacher Trick deinen Look sofort eleganter macht.';
  without.title = 'Schneller Eleganz-Boost für deinen Look';
  without.scrollStop = 'Mechanik: Problem/Payoff — ein angelaufenes Schmuckstück wird gezeigt.';
  const with_ = JSON.parse(JSON.stringify(without)) as unknown as TikTokIdeaResult;
  with_.idea = 'Eine zarte Goldkette mit Kreis-Anhänger wird in Sekunde 1 ins Licht gedreht.';
  with_.hook = 'Diese Goldkette mit Kreis-Anhänger dreht sich ins Licht.';
  with_.title = 'Goldkette mit Kreis-Anhänger';
  with_.scrollStop = 'Mechanik: Reveal — die Goldkette mit Kreis-Anhänger wird gedreht.';
  reset((a) => JSON.stringify(a === 1 ? without : with_));
  const input = baseInput({ mode: 'concept', topic: 'minimalistischer Schmuck' });
  const r = (await generateTikTok(input, 'de')) as TikTokIdeaResult;
  check(attemptCounter === 2, `J8a genau 2 Versuche (ist ${attemptCounter})`);
  check(
    seenUserPrompts[1].includes('KONKRETES PRODUKTFORMAT'),
    'J8b Retry-Prompt nennt die Format-Pflicht wörtlich',
  );
  check(
    seenUserPrompts[1].includes('FORMAT:kategorie-ohne-format-idee'),
    'J8c Retry-Prompt listet den erkannten Verstoß namentlich (Idee)',
  );
  check(
    seenUserPrompts[1].includes('FORMAT:kategorie-ohne-format-hook'),
    'J8d Retry-Prompt listet den erkannten Verstoß namentlich (Hook)',
  );
  check(
    categoryFormatViolations(input, r).length === 0,
    `J8e ausgeliefertes Ergebnis nennt das Format in Idee UND Hook (ist „${r.idea}" / „${r.hook}")`,
  );
  check(concreteFormatNames(r.idea).includes('material-gold'), 'J8f Idee nennt das Material konkret');
  // en
  const withoutEn = JSON.parse(JSON.stringify(cleanIdea(false))) as unknown as TikTokIdeaResult;
  withoutEn.idea = 'How to keep your minimalist jewelry clean and shiny.';
  withoutEn.hook = 'A simple trick that makes your look more elegant.';
  withoutEn.title = 'Instant elegance boost';
  const withEn = JSON.parse(JSON.stringify(withoutEn)) as unknown as TikTokIdeaResult;
  withEn.idea = 'A delicate gold chain with a single circular pendant turns into the light.';
  withEn.hook = 'This gold chain with a pendant catches the light.';
  withEn.title = 'Gold chain with circular pendant';
  reset((a) => JSON.stringify(a === 1 ? withoutEn : withEn));
  const inputEn = baseInput({ mode: 'concept', topic: 'minimalist jewelry' });
  const rEn = (await generateTikTok(inputEn, 'en')) as TikTokIdeaResult;
  check(attemptCounter === 2, `J8g en: exactly 2 attempts (is ${attemptCounter})`);
  check(
    seenUserPrompts[1].includes('CONCRETE PRODUCT FORMAT'),
    'J8h en: retry prompt names the format duty',
  );
  check(
    seenUserPrompts[1].includes('FORMAT:kategorie-ohne-format-idee'),
    'J8i en: retry prompt lists the detected violation by name',
  );
  check(categoryFormatViolations(inputEn, rEn).length === 0, 'J8j en: delivered result names a concrete format');
  // Dauerhaft ohne Format: 4 Versuche, dann ehrliche bestmögliche Idee (Soft-Reject)
  reset(() => JSON.stringify(without));
  const rSoft = (await generateTikTok(input, 'de')) as TikTokIdeaResult;
  check(attemptCounter === 4, `J8k dauerhaft ohne Format → 4 Versuche (ist ${attemptCounter})`);
  check(rSoft.idea.length > 0, 'J8l trotzdem wird eine Idee ausgeliefert (kein Hard-Fail für weiche Pflicht)');
  check(
    !rSoft.idea.includes('Von Büro') && !rSoft.hook.includes('Von Büro'),
    'J8m ausgelieferte Idee bleibt frei von erfundenen Nutzungskontexten',
  );
}

// ── J9: RUNDE 4 — erfundene PERSÖNLICHE GESCHICHTE / PRODUKTEIGENSCHAFT / ────
// ERFAHRUNG ALS TATSACHE (deterministisch; Owner-Auftrag 2026-09-26). Rein
// additive Prüfung zur Runde-3-Logik (CONTEXT_*/FORMAT-Prüfungen unverändert).
section('J9 Runde 4: erfundene persönliche Geschichte als Tatsache wird erkannt (de/en)');
{
  const hit = (s: string, g = '') => personalStoryViolations(s, g);
  // Owner-Beispiel (wörtlich): Geschenk + Glücksbringer + Begleiter durch schwierige Zeiten
  const owner = hit('Das Silberarmband ist ein Geschenk, ein Glücksbringer und ein Begleiter durch schwierige Zeiten.');
  check(owner.length >= 2, `J9a Owner-Beispiel Armband erkannt (ist ${owner.join('|')})`);
  check(hit('Das Armband ist ein Glücksbringer.').includes('STORY:gluecksbringer'), 'J9b „Glücksbringer" als Tatsache');
  check(hit('Sie begleitet mich durch schwierige Zeiten.').includes('STORY:begleiter-schwierige-zeiten'), 'J9c „Begleiter durch schwierige Zeiten"');
  check(hit('Das Armband wurde von meiner Oma geschenkt.').includes('STORY:geschenk-von-person'), 'J9d Geschenk von meiner Oma');
  check(hit('Es eignet sich als Geschenk.').includes('STORY:geschenk-als-geschenk'), 'J9e „als Geschenk"');
  check(hit('Ein Erbstück, das seit Generationen in meiner Familie weitergegeben wird.').includes('STORY:erbstueck'), 'J9f Erbstück + seit Generationen');
  check(hit('Er hat das Armband geerbt.').includes('STORY:geerbt'), 'J9g „geerbt"');
  check(hit('Der Anhänger steht für unsere Freundschaft.').includes('STORY:symbol-fuer-beziehung-2'), 'J9h symbolische Bedeutung als Fakt');
  check(hit('Es erinnert mich an den Urlaub.').includes('STORY:erinnert-mich-an'), 'J9i „erinnert mich an"');
  check(hit('Ich trage es seit Jahren.').includes('STORY:ich-trage'), 'J9j Ich-Erfahrung (1. Person)');
  check(hit('Ich trage es seit Jahren.').includes('STORY:seit-jahren'), 'J9k „seit Jahren"');
  check(hit('Handgefertigt in Italien aus Echtleder.').includes('STORY:herkunft-ort'), 'J9l Provenienz „handgefertigt in Italien"');
  check(hit('Ein Armband aus echtem Silber mit 925er Stempel.').includes('STORY:echtes-material'), 'J9m „echtes Silber"');
  check(hit('Ein Armband aus echtem Silber mit 925er Stempel.').includes('STORY:material-feinheit'), 'J9n „925er"');
  // en
  check(hit('This bracelet was a gift from my grandmother.').includes('STORY:gift-from-relative'), 'J9o en: gift from my grandmother');
  check(hit('It is a lucky charm.').includes('STORY:gluecksbringer'), 'J9p en: lucky charm');
  check(hit('A companion through hard times.').includes('STORY:companion-through-times'), 'J9q en: companion through hard times');
  check(hit('Handmade in Italy from real silver.').includes('STORY:herkunft-ort'), 'J9r en: handmade in Italy');
  check(hit('Handmade in Italy from real silver.').includes('STORY:echtes-material'), 'J9s en: real silver');
  check(hit('I have worn it for years.').length > 0, `J9t en: I have worn it for years (ist ${hit('I have worn it for years.').join('|')})`);
  check(hit('It was inherited and passed down for generations.').includes('STORY:geerbt'), 'J9u en: inherited / passed down');
}

// ── J10: GROUNDING — vom Nutzer Genanntes wird NIE geflaggt ─────────────────
section('J10 Runde 4: Grounding — vom Nutzer genannter Kontext bleibt erlaubt');
{
  check(
    personalStoryViolations('Ein Glücksbringer für die Schwangere.', 'glücksbringer für schwangere freundin').length === 0,
    'J10a Nutzer nannte „Glücksbringer" → erlaubt',
  );
  check(
    personalStoryViolations('Perfekt als Geschenk.', 'geschenk-suchende frauen').length === 0,
    'J10b Nutzer nannte Geschenk-Kontext → erlaubt',
  );
  check(
    personalStoryViolations('Handgefertigt in Italien.', 'manufaktur in italien').length === 0,
    'J10c Nutzer nannte „Italien" → erlaubt',
  );
  check(
    personalStoryViolations('Das Armband von meiner Oma.', 'armband für meine oma').length === 0,
    'J10d Nutzer nannte „Oma" → erlaubt',
  );
  check(
    personalStoryViolations('Seit Jahren bewährt.', 'ein produkt seit jahren').length === 0,
    'J10e Nutzer nannte „seit Jahren" → erlaubt',
  );
  check(
    personalStoryViolations('Ein Glücksbringer.', '').includes('STORY:gluecksbringer'),
    'J10f ohne Grounding bleibt dieselbe Aussage ein Verstoß',
  );
  check(
    personalStoryViolations('Als Geschenk verpackt.', '').includes('STORY:geschenk-als-geschenk'),
    'J10g ohne Grounding „als Geschenk" = Verstoß',
  );
}

// ── J11: KEINE False Positives auf den ECHTEN Runde-3-Produktions-Outputs ───
// Wörtliche Auszüge aus /home/team/shared/tiktok-testC-outputs.md (Runde 3:
// L1 Goldkette, L2 Silberring, L3 Silberanhänger, KONTROLLE-TASSE) — die neuen
// Muster dürfen dort NICHTS neu flaggen (dieselbe Gegenprobe wie Runde 3 J3).
const STORY_L1_BLOB = [
  'schnelle lösung: so entwirrst du zarte goldketten in sekunden.',
  'kennst du das problem mit verknoteten goldketten?',
  'mechnik: problem/payoff — ein knoten in einer zarten goldkette wird in der nahaufnahme gezeigt, was sofort das problem sichtbar macht und neugier auf die lösung weckt.',
  'tutorial/how-to – schritt für schritt (passt zum ziel: reichweite, da es ein häufiges problem anspricht und eine praktische lösung bietet)',
  'das video startet mit der nahaufnahme einer verknoteten goldkette, was das problem sofort sichtbar macht. dann wird der schnelle und einfache trick zur lösung gezeigt. der payoff kommt in sekunde 10, wenn die kette vollständig entwirrt ist.',
  'eine person zeigt die verknotete kette und legt sie auf ein weißes blatt papier.',
  'die person verwendet zwei stecknadeln, um den knoten vorsichtig zu lösen.',
  'die kette ist nun vollständig entwirrt und wird in die kamera gehalten. fertig! genieße deine kette.',
  'goldketten entwirren: der einfache trick',
  'verknotete ketten? mit diesem trick löst du das problem im handumdrehen! #schmucktrick #goldkette',
  'hast du schon mal diesen trick ausprobiert?',
  'diese idee spricht ein häufiges problem bei schmuckträgern an und bietet eine schnelle, praktische lösung, was die zuschauerbindung erhöht und die reichweite steigern kann.',
  'nahaufnahme, minimalistischer stil, goldene kette mit knoten auf weißem papier, weiches licht, fokus auf den knoten',
  'porträt, natürlicher stil, person legt goldene kette um den hals, warmes licht, freundlicher ausdruck',
].join(' ');
const STORY_L2_BLOB = [
  'wie du verfärbungen auf deinem minimalistischen silberring mit einem einfachen trick loswirst.',
  '„dein silberring sieht matt aus? probier das!"',
  'mechanik: problem/payoff — ein angelaufener silberring wird gezeigt, was sofort das problem sichtbar macht und die zuschauer neugierig auf die lösung für dieses alltägliche problem macht.',
  'tutorial/how-to – schritt für schritt (passt zum ziel: reichweite durch nützliche tipps)',
  'eine person zeigt den silberring neben eine schale mit einer einfachen reinigungslösung.',
  'der ring wird in die reinigungslösung getaucht.',
  '… und schon glänzt er wieder!',
  'silberring glänzt wieder mit diesem einfachen trick!',
  'verabschiede dich von mattem silber! ✨💍 #silberttipps #schmuckpflege',
].join(' ');
const STORY_L3_BLOB = [
  'entdecke die wirkung eines minimalistischen silberanhängers!',
  'mechanik: reveal — ein zarter silberanhänger wird enthüllt, der sofort das interesse der zuschauer weckt, weil sie wissen wollen, wie dieser kleine schmuck ihr outfit verändern kann.',
  'before/after – die wirkung eines accessoires auf verschiedene outfits zeigen (passt zum thema: problem/lösung).',
  'das video beginnt mit der enthüllung eines minimalistischen silberanhängers, gefolgt von der kombination mit verschiedenen outfits, um seine vielseitigkeit zu zeigen.',
  'ein schlichtes outfit ohne schmuck wird präsentiert.',
  'der silberanhänger wird angelegt und das outfit wird erneut gezeigt, diesmal mit schmuck.',
  'ein kleiner anhänger, ein großer unterschied.',
  'minimalistisch & elegant',
  'silberanhänger: der kleine unterschied für dein outfit',
  'ein zarter silberanhänger kann dein outfit im handumdrehen aufwerten. #minimalismus #schmuckliebe',
  'wie kombinierst du deinen lieblingsschmuck?',
  'diese idee zeigt, wie ein minimalistischer silberanhänger das potenzial hat, jedes outfit aufzuwerten.',
  'produktfoto, minimalistischer stil, kühles licht, silberanhänger, nahaufnahme, weicher hintergrund',
].join(' ');
const STORY_MUG_CTRL_BLOB = [
  'zeige, wie kleine persönliche details den morgenkaffee zu einem besonderen moment machen können.',
  'verwandelt dein morgenkaffee deinen tag?',
  'mechanik: problem/payoff — sofortiger zusammenhang zwischen einer gewöhnlichen tasse kaffee und der möglichkeit, den tag positiv zu beeinflussen.',
  'storytelling – erzeugt eine emotionale verbindung und zeigt eine alltägliche herausforderung (der langweilige morgenkaffee) und eine kreative lösung (personalisierte tasse).',
  'eine person hält eine schlichte, weiße tasse morgens am frühstückstisch.',
  'nahaufnahme des dampfenden kaffees in der schlichten tasse.',
  'die tasse wird zur seite gestellt, eine personalisierte tasse mit einem inspirierenden zitat oder bild wird in die kamera gehalten.',
  'die person lächelt und nimmt einen schluck aus der personalisierten tasse, das zitat ist gut sichtbar.',
  'mach es besonders!',
  'wie eine tasse deinen morgen verändern kann',
  'manchmal macht ein kleines detail den unterschied. ☕️✨',
  'teile, wie du deinen morgen besonders machst!',
  'dieses video spricht kaffeeliebhaber an, die nach einer möglichkeit suchen, ihre morgendliche routine zu verbessern.',
  'produktfoto, heller stil, personalisierte tasse mit zitat, nahaufnahme, gemütlicher hintergrund',
].join(' ');
section('J11 Runde 4: keine False Positives auf den echten Runde-3-Produktions-Outputs');
{
  check(
    personalStoryViolations(STORY_L1_BLOB, 'minimalistischer schmuck').length === 0,
    `J11a Runde-3 L1 (Goldkette) → 0 Treffer (ist ${personalStoryViolations(STORY_L1_BLOB, 'minimalistischer schmuck').join('|')})`,
  );
  check(
    personalStoryViolations(STORY_L2_BLOB, 'minimalistischer schmuck').length === 0,
    `J11b Runde-3 L2 (Silberring) → 0 Treffer (ist ${personalStoryViolations(STORY_L2_BLOB, 'minimalistischer schmuck').join('|')})`,
  );
  check(
    personalStoryViolations(STORY_L3_BLOB, 'minimalistischer schmuck').length === 0,
    `J11c Runde-3 L3 (Silberanhänger) → 0 Treffer (ist ${personalStoryViolations(STORY_L3_BLOB, 'minimalistischer schmuck').join('|')})`,
  );
  check(
    personalStoryViolations(STORY_MUG_CTRL_BLOB, 'personalisierte tasse').length === 0,
    `J11d Runde-3 KONTROLLE-Tasse → 0 Treffer (ist ${personalStoryViolations(STORY_MUG_CTRL_BLOB, 'personalisierte tasse').join('|')})`,
  );
  check(
    personalStoryViolations(MUG_L1_BLOB, 'personalisierte tasse').length === 0,
    'J11e Tasse Lauf 1 (Büro-Setting) → 0 Treffer',
  );
  check(
    personalStoryViolations(JEWEL_L1_BLOB, 'minimalistischer schmuck').length === 0,
    'J11f Schmuck Lauf 1 (Silberring-Reinigung) → 0 Treffer',
  );
  check(
    personalStoryViolations(blob(cleanIdea(true) as unknown as TikTokIdeaResult), '').length === 0,
    'J11g saubere Tassen-Idee (Fixture) → 0 Treffer',
  );
  check(
    personalStoryViolations('Zeige einen Silberring mit mattem Finish. Genieße deine Kette. Dein Silberring sieht matt aus?', '').length === 0,
    'J11h Materialwahl/Anrede („Silberring", „dein Ring") bleibt erlaubt',
  );
}

// ── J12: ERLAUBTER FALL — „Story-Idee:"-Konzept + satzweise Entfernung ──────
section('J12 Runde 4: explizit gekennzeichnete Story-Idee ist erlaubt, Tatsache nicht');
{
  check(
    personalStoryViolations('Story-Idee: Inszeniere das Armband als symbolischen Glücksbringer.', '').length === 0,
    'J12a „Story-Idee:" + Inszenierungs-Anweisung → erlaubt',
  );
  check(
    personalStoryViolations('Konzept: Zeige die Kette als Erbstück der Großmutter.', '').length === 0,
    'J12b „Konzept:" + „als"-Anweisung → erlaubt',
  );
  check(
    personalStoryViolations('Story idea: Stage the bracelet as a symbolic lucky charm.', '').length === 0,
    'J12c en: „Story idea:" + stage … as → erlaubt',
  );
  check(
    personalStoryViolations('Story-Idee: Das Armband ist ein Glücksbringer.', '').includes('STORY:gluecksbringer'),
    'J12d „Story-Idee:" + Indikativ („ist") bleibt ein Verstoß',
  );
  check(
    personalStoryViolations('Das Armband ist ein Glücksbringer. Story-Idee: Inszeniere es als Glücksbringer.', '').includes(
      'STORY:gluecksbringer',
    ),
    'J12e Tatsachen-Satz ohne Marker bleibt Verstoß (nur der markierte Satz ist erlaubt)',
  );
  // Satzweise Entfernung (letzter Versuch)
  const dirty = JSON.parse(JSON.stringify(cleanIdea(true))) as unknown as TikTokIdeaResult;
  dirty.idea = 'Zeig die Gravur in Nahaufnahme. Das Armband ist ein Glücksbringer von meiner Oma.';
  dirty.hook = 'Ein Glücksbringer für schwierige Zeiten.';
  dirty.caption = 'Gravur in Keramik #geschenk';
  const out = personalStoryFreeResult(dirty, '');
  check(out.idea === 'Zeig die Gravur in Nahaufnahme.', `J12f Idee: erfundener Satz weg, Rest bleibt (ist „${out.idea}")`);
  check(out.hook.trim() === '', `J12g Ganzfeld-Behauptung → ehrlich leeres Feld (ist „${out.hook}")`);
  check(out.caption === 'Gravur in Keramik #geschenk', 'J12h unschuldige Felder bleiben unangetastet');
  check(personalStoryViolations(blob(out), '').length === 0, 'J12i Ergebnis trefferfrei');
  check(personalStoryViolations(blob(personalStoryFreeResult(out, '')), '').length === 0, 'J12j idempotent');
  const clean = JSON.parse(JSON.stringify(cleanIdea(true))) as unknown as TikTokIdeaResult;
  check(personalStoryFreeResult(clean, '') === clean, 'J12k saubere Idee: identisches Objekt (kein Kopieren)');
}

// ── J13: Engine — erfundene Geschichte → Soft-Reject + Retry (de), kein Hard-Fail
section('J13 Runde 4: erfundene persönliche Geschichte → Retry mit namentlicher Verstoßliste (de)');
{
  const attempt1 = JSON.parse(JSON.stringify(cleanIdea(true))) as unknown as TikTokIdeaResult;
  attempt1.idea =
    'Zeig die schmale Goldkette mit Kreis-Anhänger in Nahaufnahme. Das Armband ist ein Glücksbringer von meiner Oma und begleitet sie durch schwierige Zeiten.';
  attempt1.hook = 'Deine Goldkette — ein Glücksbringer!';
  attempt1.title = 'Goldkette mit Kreis-Anhänger';
  const attempt2 = JSON.parse(JSON.stringify(attempt1)) as unknown as TikTokIdeaResult;
  attempt2.idea = 'Zeig die schmale Goldkette mit Kreis-Anhänger in Nahaufnahme — sie dreht sich in Sekunde 1 ins Licht.';
  attempt2.hook = 'Deine schmale Goldkette dreht sich in Sekunde 1 ins Licht.';
  reset((a) => JSON.stringify(a === 1 ? attempt1 : attempt2));
  const input = baseInput({ mode: 'concept', topic: 'minimalistischer Schmuck' });
  const r = (await generateTikTok(input, 'de')) as TikTokIdeaResult;
  check(attemptCounter === 2, `J13a genau 2 Versuche (ist ${attemptCounter})`);
  check(
    seenUserPrompts[1].includes('ERFUNDENE PERSÖNLICHE GESCHICHTE'),
    'J13b Retry-Prompt benennt das Verbot erfundener persönlicher Geschichten',
  );
  check(seenUserPrompts[1].includes('STORY:gluecksbringer'), 'J13c Retry-Prompt listet den Verstoß namentlich');
  check(seenUserPrompts[1].includes('STORY:begleiter-schwierige-zeiten'), 'J13d Retry-Prompt listet alle Verstöße');
  check(
    personalStoryViolations(ideaPlaceholderBlob(r), inventedGroundingBlob(input)).length === 0,
    'J13e ausgeliefertes Ergebnis ohne erfundene persönliche Geschichte',
  );
  check(r.idea.includes('schmale Goldkette'), 'J13f Retry-Ergebnis wird ausgegeben');
}

// ── J14: Engine — derselbe Fall auf Englisch ────────────────────────────────
section('J14 Runde 4: erfundene persönliche Geschichte → Retry (en)');
{
  const attempt1 = JSON.parse(JSON.stringify(cleanIdea(false))) as unknown as TikTokIdeaResult;
  attempt1.idea = 'A lucky charm from my grandmother. Show the slim gold chain with the circular pendant.';
  attempt1.hook = 'Your gold chain — a lucky charm!';
  attempt1.title = 'Gold chain with circular pendant';
  const attempt2 = JSON.parse(JSON.stringify(attempt1)) as unknown as TikTokIdeaResult;
  attempt2.idea = 'Show the slim gold chain with the circular pendant — it turns into the light in second one.';
  attempt2.hook = 'Your slim gold chain turns into the light in second one.';
  reset((a) => JSON.stringify(a === 1 ? attempt1 : attempt2));
  const input = baseInput({ mode: 'concept', topic: 'minimalist jewelry' });
  const r = (await generateTikTok(input, 'en')) as TikTokIdeaResult;
  check(attemptCounter === 2, `J14a exactly 2 attempts (is ${attemptCounter})`);
  check(seenUserPrompts[1].includes('INVENTED PERSONAL STORY'), 'J14b retry prompt names the invented-personal-story ban');
  check(seenUserPrompts[1].includes('STORY:gluecksbringer'), 'J14c retry prompt lists the violation by name');
  check(
    personalStoryViolations(ideaPlaceholderBlob(r), inventedGroundingBlob(input)).length === 0,
    'J14d delivered result free of invented personal stories',
  );
}

// ── J15: dauerhaft erfundene Geschichten → kein Hard-Fail, Satz wird entfernt ─
section('J15 Runde 4: dauerhaft erfundene Geschichte → bestmögliche Idee OHNE die Behauptung');
{
  const dirty = JSON.parse(JSON.stringify(cleanIdea(true))) as unknown as TikTokIdeaResult;
  dirty.idea =
    'Zeig die schmale Goldkette mit Kreis-Anhänger in Nahaufnahme. Das Armband ist ein Glücksbringer von meiner Oma.';
  dirty.hook = 'Deine Goldkette mit Kreis-Anhänger — ein Glücksbringer!';
  dirty.title = 'Goldkette mit Kreis-Anhänger';
  dirty.cta = 'Ich trage es seit Jahren.';
  reset(() => JSON.stringify(dirty));
  const input = baseInput({ mode: 'concept', topic: 'minimalistischer Schmuck' });
  const r = (await generateTikTok(input, 'de')) as TikTokIdeaResult;
  check(attemptCounter === 4, `J15a dauerhaft erfunden → 4 Versuche (ist ${attemptCounter})`);
  check(
    personalStoryViolations(ideaPlaceholderBlob(r), inventedGroundingBlob(input)).length === 0,
    `J15b ausgeliefertes Ergebnis frei von erfundenen Geschichten (ist ${personalStoryViolations(ideaPlaceholderBlob(r), inventedGroundingBlob(input)).join('|')})`,
  );
  check(r.idea.includes('schmale Goldkette'), 'J15c produktspezifischer Satz bleibt erhalten (kein Blanko-Feld)');
  check(!r.hook.includes('Glücksbringer') && !r.cta.includes('seit Jahren'), `J15d Hook/CTA ohne die Behauptung (Hook „${r.hook}" / CTA „${r.cta}")`);
  check(
    PERSONAL_STORY_PATTERNS.length >= 20,
    `J15e Musterliste vollständig vorhanden (ist ${PERSONAL_STORY_PATTERNS.length})`,
  );
}

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\nStabilisierung Phase 5g (Test C Nachschärfung, Runde 3): ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('PHASE 5g TEST-C-NACHSCHÄRFUNG GRÜN');
server.stop(true);
