// ── TikTok-Modul Phase 2 (Stabilisierung C8) — Test-Suite
//    „TikTok erstellen (concept) auf todayIdea-Niveau + Ergebnisstruktur +
//     keine Platzhalter" ───────────────────────────────────────────────────────
// Owner-Vorgaben Phase 2:
//   * „TikTok erstellen" muss dieselben Qualitätsregeln erben wie
//     „Was soll ich heute posten?" (Zielgruppen-Perspektive, Produkt nicht Thema,
//     Selbstreferenz-Verbot, Anti-Werbe-Mandat).
//   * Jedes Ergebnis enthält: Hook (1–2 s), Scroll-Stop-Moment, TikTok-native
//     Idee, Szenenplan mit Sekunden, Texteinblendungen, Sprechtext wenn sinnvoll,
//     Spannungsbogen, Caption, maximal 5 Hashtags, CTA wenn sinnvoll,
//     Bild-/Videoideen.
//   * KEINE Platzhalter („[Trendigen Sound hier einfügen]") — konkrete Angabe
//     oder den Punkt weglassen.
//
// Muster wie Phase 1/2/6: Bun-Mini-Server als OpenAI-Mock (OPENAI_BASE_URL),
// keine echte API, kein .env nötig. Usage: bun tiktok-concept-quality-test.ts
import {
  generateTikTok,
  buildUserPrompt,
  pickSystemPrompt,
  conceptCompleteness,
  timedSceneStartsAtZero,
  placeholderViolations,
  placeholderFreeResult,
  ideaPlaceholderBlob,
  MAX_TIKTOK_HASHTAGS,
  type TikTokInput,
  type TikTokIdeaResult,
} from './src/ai/tiktok';

// ── OpenAI-Mock-Server ───────────────────────────────────────────────────────
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
    const systemMsg = (body?.messages?.find((m) => m.role === 'system')?.content as string | undefined) ?? '';
    const userMsg = (body?.messages?.find((m) => m.role === 'user')?.content as string | undefined) ?? '';
    seenUserPrompts.push(userMsg);
    seenSystemPrompts.push(systemMsg);
    attemptCounter += 1;
    let content: string;
    if (systemMsg.includes('neutralisierst')) {
      content = userMsg; // metric-guard-Mock: Text unverändert (kein Kennzahl-Test hier)
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
  else { failed += 1; failures.push(label); console.log(`  ✗ FAIL: ${label}`); }
};
const lastPrompt = () => seenUserPrompts[seenUserPrompts.length - 1] ?? '';
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

interface IdeaJson {
  idea?: string; hook?: string; scrollStop?: string; tension?: string; length?: string;
  format?: string; title?: string; timedScenes?: unknown; scenes?: unknown; overlays?: unknown;
  spokenText?: string; caption?: string; hashtags?: unknown; cta?: string; why?: string;
  imageIdeas?: unknown; selfCheck?: Record<string, boolean>;
}

/** Vollständiges, hochwertiges Konzept MIT Scroll-Stop + Spannungsbogen. */
function fullConceptPayload(de: boolean, hashtags: string[] = ['#keramik', '#handmade', '#geschenkidee']): string {
  return JSON.stringify({
    idea: de
      ? 'Zeig aus Sicht der Beschenkten, wie sich eine personalisierte Tasse als Geschenk anfühlt.'
      : 'Show from the gift-receiver side how a personalized mug feels as a gift.',
    hook: de ? 'Diese Tasse kennt ihren Namen — und das ändert das Geschenk' : 'This mug knows her name — and that changes the gift',
    scrollStop: de
      ? 'Erste Sekunde: die Tasse wird umgedreht, der eingravierte Name erscheint mit einem leisen Kratzgeräusch — der Auslöser ist der Moment des Erkennens, weil Geschenk-Suchende genau diesen Überraschungsmoment suchen.'
      : 'First second: the mug is turned around, the engraved name appears with a soft scratching sound — the trigger is the moment of recognition, because gift hunters look for exactly that surprise.',
    tension: de
      ? 'Offene Schleife: „Wer bekommt sie?" (0-3s) → Entwicklung: Gravur wird gezeigt und die Reaktion beschrieben, ohne Fake-Reaktion (3-12s) → Payoff: die Tasse steht fertig verpackt auf dem Tisch, Auflösung in Sekunde 15.'
      : 'Open loop: "Who gets it?" (0-3s) → development: the engraving is shown (3-12s) → payoff: the packed mug on the table, resolution at second 15.',
    length: de ? '15 Sekunden' : '15 seconds',
    format: de ? 'Storytelling – Aufbau einer echten Geschenk-Geschichte (passt zum Ziel: Verkäufe)' : 'Storytelling (fits the goal: sales)',
    title: de ? 'Geschenk mit Namen' : 'A gift with a name',
    timedScenes: [
      { time: '0-3s', scene: de ? 'Tasse wird umgedreht, Gravur erscheint' : 'Mug is turned, engraving appears', text: de ? 'Wer bekommt sie?' : 'Who gets it?' },
      { time: '3-12s', scene: de ? 'Nahaufnahme der Gravur, Verpackung wird vorbereitet' : 'Close-up of engraving, packing', text: de ? 'Der Name macht es persönlich' : 'The name makes it personal' },
      { time: '12-15s', scene: de ? 'Fertige Tasse auf dem Tisch' : 'Finished mug on the table', text: '' },
    ],
    scenes: [
      de ? 'Tasse umdrehen und Gravur zeigen' : 'Turn the mug, show the engraving',
      de ? 'Verpackung vorbereiten' : 'Prepare the packaging',
      de ? 'Ergebnis zeigen' : 'Show the result',
    ],
    overlays: [de ? 'Mit Namen' : 'With her name', de ? 'In 3 Schritten' : 'In 3 steps'],
    spokenText: de ? 'Ich zeige dir, wie eine personalisierte Tasse ankommt — ohne es zu übertreiben.' : 'I show you how a personalized mug lands — without overselling.',
    caption: de ? 'Personalisierte Tasse als Geschenk: worauf es wirklich ankommt' : 'Personalized mug as a gift: what really matters',
    hashtags,
    cta: de ? 'Welchen Namen würdest du eingravieren lassen?' : 'Which name would you engrave?',
    why: de ? 'Der Erkennungsmoment in Sekunde 1 trifft die Zielgruppe mitten in ihrer Geschenk-Suche.' : 'The recognition moment hits the audience while they search for a gift.',
    imageIdeas: [
      { description: de ? 'Cover: Tasse mit Gravur im Morgenlicht' : 'Cover: engraved mug in morning light', studioPrompt: de ? 'Keramiktasse mit Gravur, warmes Morgenlicht, Nahaufnahme, weicher Hintergrund' : 'Ceramic mug with engraving, warm morning light, close-up' },
      { description: de ? 'Requisit: Geschenkpapier und Band' : 'Prop: wrapping paper and ribbon', studioPrompt: de ? 'Geschenkpapier, Jute-Band, Holztisch, flache Perspektive' : 'Wrapping paper, jute ribbon, wooden table' },
    ],
    selfCheck: SELFCHECK_CLEAN,
  } as IdeaJson);
}

/** Konzept MIT generischen Platzhaltern (Owner-Beispiel). */
function placeholderConceptPayload(de: boolean): string {
  const o = JSON.parse(fullConceptPayload(de)) as IdeaJson;
  o.hook = de ? 'Persönliche Tasse mit Namen [Trendigen Sound hier einfügen]' : 'Personal mug with name [insert trending sound here]';
  o.scenes = [de ? 'Szene 1: Tasse zeigen — Sound: <beliebig wählen>' : 'Scene 1: show mug — Sound: <pick one>', de ? 'Szene 2: Gravur zeigen' : 'Scene 2: show engraving'];
  o.overlays = [de ? 'Sound: beliebiger Trend-Sound' : 'Sound: any trending sound', de ? 'Mit Namen' : 'With her name'];
  o.caption = de ? 'Personalisierte Tasse (deinen Text hier einfügen)' : 'Personalized mug (insert your text here)';
  return JSON.stringify(o);
}

/** Produktzentrierte Selbstreferenz-Idee (wie Phase-6-Muster). */
function selfRefConceptPayload(): string {
  return JSON.stringify({
    idea: 'Kann Growimo eine TikTok-Idee erstellen? Wir testen unser eigenes Produkt.',
    hook: 'Kann eine KI eine TikTok-Idee erstellen?',
    scrollStop: 'Die Frage steht in Sekunde 1 im Bild.',
    tension: 'Offene Frage bis zum Ende.',
    length: '15 Sekunden',
    format: 'Selbstexperiment',
    title: 'Wir testen unser eigenes Produkt',
    timedScenes: [{ time: '0-2s', scene: 'App öffnen', text: 'Kann eine KI eine TikTok-Idee erstellen?' }],
    scenes: ['App öffnen'],
    overlays: ['Kann die KI das?'],
    spokenText: 'Wir testen unser eigenes Produkt.',
    caption: 'Wie gut ist meine TikTok-Idee wirklich?',
    hashtags: ['#ki', '#test'],
    cta: 'Was soll Growimo als Nächstes testen?',
    why: 'Selbstexperiment.',
    imageIdeas: [{ description: 'App-Screenshot', studioPrompt: 'App-UI, Nahaufnahme' }],
    selfCheck: SELFCHECK_CLEAN,
  } as IdeaJson);
}

function baseInput(over: Partial<TikTokInput> = {}): TikTokInput {
  return {
    mode: 'concept',
    biz: 'Handgemachte Keramiktassen mit Gravur, nachhaltiger Ton, 29 EUR',
    goal: 'Verkäufe',
    audience: 'Frauen 25–45, Geschenk-Suchende',
    lang: 'de',
    ...over,
  };
}

// ── C1/C2: Prompt-Parität — concept erbt die todayIdea-Qualitätsregeln ───────
section('C1/C2 Prompt-Parität concept == todayIdea (de + en)');
{
  const conceptDe = pickSystemPrompt('concept', 'de');
  const todayDe = pickSystemPrompt('todayIdea', 'de');
  const conceptEn = pickSystemPrompt('concept', 'en');
  const todayEn = pickSystemPrompt('todayIdea', 'en');
  const sharedDe = [
    'ZIELGRUPPEN-PERSPEKTIVE (harte Regel)',
    'PRODUKT IST NICHT DAS THEMA (harte Regel)',
    'ANTI-WERBE-MANDAT (Mensch zuerst)',
    'QUALITÄTS-MANDAT',
  ];
  const sharedEn = [
    'TARGET-AUDIENCE PERSPECTIVE (hard rule)',
    'PRODUCT IS NOT THE TOPIC (hard rule)',
    'ANTI-AD MANDATE (human first)',
    'QUALITY MANDATE',
  ];
  for (const s of sharedDe) check(conceptDe.includes(s), `C1 concept(de) enthält „${s}"`);
  for (const s of sharedDe) check(todayDe.includes(s), `C1 todayIdea(de) enthält „${s}"`);
  for (const s of sharedEn) check(conceptEn.includes(s), `C2 concept(en) enthält „${s}"`);
  for (const s of sharedEn) check(todayEn.includes(s), `C2 todayIdea(en) enthält „${s}"`);
  // Selbstreferenz-Verbot: identischer Regeltext, mode-spezifisches Label.
  check(conceptDe.includes('SELBSTREFERENZ-VERBOT:'), 'C1 concept(de) Selbstreferenz-Verbot');
  check(todayDe.includes('SELBSTREFERENZ-VERBOT (heute-Idee)'), 'C1 todayIdea(de) behält etabliertes Label');
  check(conceptDe.includes('Kann Growimo eine TikTok-Idee erstellen?'), 'C1 concept(de): Anti-Werbe/Selbstreferenz-Beispiele vorhanden');
  check(conceptEn.includes('SELF-REFERENCE BAN:'), 'C2 concept(en) SELF-REFERENCE BAN');
  check(todayEn.includes('SELF-REFERENCE BAN (daily idea)'), 'C2 todayIdea(en) Label unverändert');
}

// ── C3: Ergebnisstruktur + Platzhalter-Verbot im Prompt (de + en) ────────────
section('C3 Ergebnisstruktur + Platzhalter-Verbot im Prompt');
{
  const conceptDe = pickSystemPrompt('concept', 'de');
  const conceptEn = pickSystemPrompt('concept', 'en');
  const parts: Array<[string, string[]]> = [
    ['de', ['SCROLL-STOP-MOMENT (PFLICHTFELD', 'SPANNUNGSBOGEN (PFLICHTFELD', 'SZENENPLAN MIT SEKUNDEN (PFLICHT)', 'SPRECHTEXT:', 'Texteinblendungen (PFLICHT)', 'Caption (PFLICHT)', 'NIEMALS mehr als 5', 'KEINE PLATZHALTER (harte Regel)', 'Trendigen Sound hier einfügen', '"scrollStop"', '"tension"']],
    ['en', ['SCROLL-STOP MOMENT (MANDATORY FIELD', 'TENSION ARC (MANDATORY FIELD', 'SCENE PLAN WITH SECONDS (MANDATORY)', 'SPOKEN TEXT:', 'Text overlays (MANDATORY)', 'Caption (MANDATORY)', 'NEVER more than 5', 'NO PLACEHOLDERS (HARD RULE)', 'insert trending sound here', '"scrollStop"', '"tension"']],
  ];
  for (const [lang, keys] of parts) {
    const sp = lang === 'de' ? conceptDe : conceptEn;
    for (const k of keys) check(sp.includes(k), `C3 ${lang}: Prompt enthält „${k}"`);
  }
  // Parität: todayIdea verlangt dieselbe Struktur (Hook/Scroll-Stop/Szenenplan/…).
  check(pickSystemPrompt('todayIdea', 'de').includes('SCROLL-STOP-MOMENT (PFLICHTFELD'), 'C3 todayIdea(de) verlangt Scroll-Stop ebenfalls');
  check(pickSystemPrompt('todayIdea', 'de').includes('KEINE PLATZHALTER (harte Regel)'), 'C3 todayIdea(de) verbietet Platzhalter ebenfalls');
  check(MAX_TIKTOK_HASHTAGS === 5, 'C3 MAX_TIKTOK_HASHTAGS = 5');
}

// ── C4/C5: User-Prompt — Thema bleibt Gegenstand, ohne Thema Katalog-Richtung ─
section('C4/C5 concept-User-Prompt: Thema vs. Katalog-Richtung');
{
  const withTopic = buildUserPrompt(baseInput({ topic: 'Personalisierte Tasse' }), 'de');
  check(withTopic.includes('Thema / Produkt / grobe Idee:'), 'C4a Topic-Block vorhanden');
  check(withTopic.includes('Personalisierte Tasse'), 'C4b Topic-Inhalt vorhanden');
  check(withTopic.includes('PERSPEKTIVE DER ZIELGRUPPE'), 'C4c Zielgruppen-Perspektive als Bauregel');
  check(withTopic.includes('NICHT als Thema'), 'C4d Produkt nicht als Thema');
  check(!withTopic.includes('Content-Richtung'), 'C4e KEINE Richtung bei vorhandenem Nutzerthema (keine Kollision)');

  const noTopic = buildUserPrompt(baseInput({ topic: undefined }), 'de');
  check(
    noTopic.includes('Content-Richtung (von Growimo gewählt, VERBINDLICH — aus dem Katalog): Problem/Lösung'),
    'C5a ohne Thema: Katalog-Start als verbindliche Richtung',
  );
  check(!noTopic.includes('Letzte Content-Richtung'), 'C5b ohne previousDirection kein „nicht wiederholen"-Feld');
  check(noTopic.includes('PERSPEKTIVE DER ZIELGRUPPE'), 'C5c Perspektiv-Regel auch ohne Thema');

  const rotated = buildUserPrompt(baseInput({ topic: undefined, previousDirection: 'Problem/Lösung' }), 'de');
  check(rotated.includes('aus dem Katalog): Konkreter Tipp'), 'C5d Rotation: nächste Katalog-Richtung');
  check(rotated.includes('Letzte Content-Richtung (nicht wiederholen): Problem/Lösung'), 'C5e „nicht wiederholen"-Feld');

  const enNoTopic = buildUserPrompt(baseInput({ topic: undefined, lang: 'en' }), 'en');
  check(enNoTopic.includes('Content direction (chosen by Growimo, MANDATORY — from the catalog): Problem/Solution'), 'C5f EN: Richtungs-Feld');
  check(!enNoTopic.includes('Content-Richtung'), 'C5g EN: keine DE-Fragmente');
  const enWithTopic = buildUserPrompt(baseInput({ topic: 'Personalized mug', lang: 'en' }), 'en');
  check(enWithTopic.includes("TARGET AUDIENCE's perspective"), 'C5h EN: Zielgruppen-Perspektive bei Thema');
  check(!enWithTopic.includes('Content direction'), 'C5i EN: keine Richtung bei Nutzerthema');
}

// ── C6: Ergebnisstruktur der Engine-Ausgabe (alle geforderten Felder) ────────
section('C6 Ausgabestruktur: alle Owner-Felder vorhanden');
await (async () => {
  attemptCounter = 0;
  seenUserPrompts.length = 0;
  currentResponder = () => fullConceptPayload(true);
  const res = await generateTikTok(baseInput({ topic: 'Personalisierte Tasse' }), 'de');
  check(attemptCounter === 1, 'C6a vollständiges Konzept → 1 Call (kein unnötiger Retry)');
  check(res.mode === 'concept', 'C6b Mode concept');
  const r = res as TikTokIdeaResult;
  check(r.idea.length > 0, 'C6c TikTok-native Idee vorhanden');
  check(r.hook.length > 0, 'C6d Hook vorhanden');
  check((r.scrollStop ?? '').length > 0, 'C6e Scroll-Stop-Moment vorhanden');
  check((r.tension ?? '').length > 0, 'C6f Spannungsbogen vorhanden');
  check(Boolean(r.format), 'C6g Videoformat vorhanden');
  check(Boolean(r.title), 'C6h Titel vorhanden');
  check((r.timedScenes?.length ?? 0) >= 3, 'C6i Szenenplan mit mindestens 3 Schritten');
  check(timedSceneStartsAtZero(r.timedScenes?.[0]?.time ?? ''), 'C6j Szenenplan beginnt bei 0s');
  check((r.timedScenes ?? []).every((s) => s.time.length > 0 && s.scene.length > 0), 'C6k Zeitangaben + Szenen befüllt');
  check((r.timedScenes ?? []).some((s) => s.text.trim() !== ''), 'C6l Texteinblendungen im Szenenplan');
  check(r.overlays.length >= 2, 'C6m Texteinblendungen (überlays) vorhanden');
  check(r.spokenText.trim() !== '', 'C6n Sprechtext vorhanden (sinnvoll für Storytelling)');
  check(r.caption.trim() !== '', 'C6o Caption vorhanden');
  check(r.hashtags.length > 0 && r.hashtags.length <= 5, 'C6p max. 5 Hashtags');
  check(r.cta.trim() !== '', 'C6q CTA vorhanden (wenn sinnvoll)');
  check((r.imageIdeas?.length ?? 0) >= 2, 'C6r Bild-/Videoideen vorhanden');
  check((r.imageIdeas ?? []).every((i) => i.studioPrompt.trim() !== ''), 'C6s jede Bildidee mit Studio-Prompt');
  check(conceptCompleteness(r).length === 0, 'C6t Vollständigkeitsprüfung: keine fehlenden Felder');
  check(placeholderViolations(ideaPlaceholderBlob(r)).length === 0, 'C6u keine Platzhalter im Ergebnis');
})();

// ── C7: Hashtag-Obergrenze hart im Parser (deterministisch) ──────────────────
section('C7 maximal 5 Hashtags (Parser-Deckel)');
await (async () => {
  attemptCounter = 0;
  currentResponder = () => fullConceptPayload(true, ['#a', '#b', '#c', '#d', '#e', '#f', '#g', '#h']);
  const res = await generateTikTok(baseInput({ topic: 'Personalisierte Tasse' }), 'de');
  const r = res as TikTokIdeaResult;
  check(r.hashtags.length === 5, `C7a 8 gelieferte Hashtags → 5 im Ergebnis (war ${r.hashtags.length})`);
  check(r.hashtags.join(' ') === '#a #b #c #d #e', 'C7b die ersten fünf bleiben erhalten');
})();

// ── C8: Platzhalter → Soft-Reject + Retry, zweite Antwort ist sauber ─────────
section('C8 Platzhalter-Erkennung (deterministisch + Retry)');
{
  const deBlob = ideaPlaceholderBlob(JSON.parse(placeholderConceptPayload(true)) as TikTokIdeaResult);
  const hits = placeholderViolations(deBlob);
  check(hits.length > 0, `C8a Platzhalter werden erkannt (${hits.join(', ')})`);
  check(hits.some((h) => h.includes('klammer-anweisung')), 'C8b Klammer-Anweisung erkannt');
  check(hits.some((h) => h.includes('beliebiger-sound')), 'C8c „beliebiger Sound" erkannt');
  check(hits.some((h) => h.includes('hier-einfuegen') || h.includes('dein-x-hier')), 'C8d „hier einfügen" erkannt');
  // Kein False Positive bei konkretem Inhalt.
  const clean = ideaPlaceholderBlob(JSON.parse(fullConceptPayload(true)) as TikTokIdeaResult);
  check(placeholderViolations(clean).length === 0, 'C8e konkreter Inhalt → keine Platzhalter-Meldung');
  check(
    placeholderViolations('sound: leiser klavier-loop mit ca. 70 bpm, payoff auf dem takt'.toLowerCase()).length === 0,
    'C8f konkrete Sound-Empfehlung ist KEIN Platzhalter',
  );
}
await (async () => {
  attemptCounter = 0;
  seenUserPrompts.length = 0;
  let call = 0;
  currentResponder = () => { call += 1; return call === 1 ? placeholderConceptPayload(true) : fullConceptPayload(true); };
  const res = await generateTikTok(baseInput({ topic: 'Personalisierte Tasse' }), 'de');
  check(call === 2, `C8g Platzhalter-Idee verworfen + neu generiert (2 Calls, war ${call})`);
  const r = res as TikTokIdeaResult;
  check(placeholderViolations(ideaPlaceholderBlob(r)).length === 0, 'C8h geliefertes Ergebnis ist platzhalterfrei');
  check(!JSON.stringify(r).includes('Trendigen Sound'), 'C8i Owner-Beispiel-Platzhalter fehlt');
})();

// ── C9: Platzhalter bei ALLEN Versuchen → Ergebnis wird hart gereinigt ───────
section('C9 Platzhalter-Endreinigung (letzter Versuch)');
await (async () => {
  attemptCounter = 0;
  currentResponder = () => placeholderConceptPayload(true);
  const res = await generateTikTok(baseInput({ topic: 'Personalisierte Tasse' }), 'de');
  check(attemptCounter === 4, `C9a max. 4 Versuche (war ${attemptCounter})`);
  const r = res as TikTokIdeaResult;
  const blob = JSON.stringify(r);
  check(!blob.includes('Trendigen Sound'), 'C9b Klammer-Platzhalter entfernt');
  check(!blob.includes('<beliebig wählen>'), 'C9c Spitzklammer-Platzhalter entfernt');
  check(!/\bbeliebiger Trend-Sound\b/i.test(blob), 'C9d „beliebiger Sound" entfernt');
  check(!/hier einfügen/i.test(blob), 'C9e „hier einfügen" entfernt');
  check(placeholderViolations(ideaPlaceholderBlob(r)).length === 0, 'C9f Endergebnis platzhalterfrei');
  check(r.idea.length > 0 && r.hook.length > 0, 'C9g Kern-Felder bleiben erhalten');
})();

// ── C10/C11: Selbstreferenz-Prüfung im concept-Pfad ─────────────────────────
section('C10/C11 Selbstreferenz: concept ohne Thema ja, mit Nutzerthema nein');
await (async () => {
  attemptCounter = 0;
  seenUserPrompts.length = 0;
  let call = 0;
  currentResponder = () => { call += 1; return call === 1 ? selfRefConceptPayload() : fullConceptPayload(true); };
  const res = await generateTikTok(baseInput({ topic: undefined }), 'de');
  check(call === 2, `C10a concept OHNE Thema: Selbstreferenz wird verworfen (2 Calls, war ${call})`);
  const r = res as TikTokIdeaResult;
  check(!r.hook.includes('Kann eine KI'), 'C10b gelieferte Idee ist die zielgruppennahe');
})();
await (async () => {
  attemptCounter = 0;
  currentResponder = () => selfRefConceptPayload();
  const res = await generateTikTok(baseInput({ topic: 'Keramikbecher' }), 'de');
  check(attemptCounter === 1, `C11a concept MIT Nutzerthema: 1 Call — Thema-Vorrang bleibt (war ${attemptCounter})`);
  check(res.mode === 'concept', 'C11b Ergebnis unverändert');
})();

// ── C12: Vollständigkeitsprüfung (Hook / 0s-Start / Hashtags) ────────────────
section('C12 Vollständigkeitsprüfung');
{
  const full = JSON.parse(fullConceptPayload(true)) as TikTokIdeaResult;
  const parsed = { ...full, mode: 'concept' as const, selfCheck: undefined } as TikTokIdeaResult;
  check(conceptCompleteness(parsed).length === 0, 'C12a vollständiges Konzept → keine fehlenden Felder');
  check(conceptCompleteness({ ...parsed, hook: '' }).includes('hook'), 'C12b fehlender Hook wird erkannt');
  check(
    conceptCompleteness({ ...parsed, timedScenes: [{ time: '2-6s', scene: 'x', text: '' }] })
      .some((m) => m.includes('Start bei 0s')),
    'C12c Szenenplan ohne 0s-Start wird erkannt',
  );
  check(conceptCompleteness({ ...parsed, hashtags: [] }).includes('hashtags'), 'C12d leere Hashtags werden erkannt');
  check(conceptCompleteness({ ...parsed, imageIdeas: [] }).includes('imageIdeas'), 'C12e fehlende Bildideen werden erkannt');
  check(timedSceneStartsAtZero('0-2s') && timedSceneStartsAtZero('0–3s') && timedSceneStartsAtZero('0s'), 'C12f 0s-Varianten erkannt');
  check(!timedSceneStartsAtZero('1-3s') && !timedSceneStartsAtZero(''), 'C12g Nicht-0s abgelehnt');
}

// ── C13: placeholderFreeResult (reine Funktion, idempotent) ─────────────────
section('C13 placeholderFreeResult');
{
  const parsed = JSON.parse(placeholderConceptPayload(true)) as TikTokIdeaResult;
  const cleaned = placeholderFreeResult({ ...parsed, mode: 'concept' });
  check(placeholderViolations(ideaPlaceholderBlob(cleaned)).length === 0, 'C13a Reinigung entfernt alle Platzhalter');
  check(placeholderFreeResult(cleaned) === cleaned, 'C13b idempotent/selbe Objektidentität');
  const cleanParsed = JSON.parse(fullConceptPayload(true)) as TikTokIdeaResult;
  const untouched = { ...cleanParsed, mode: 'concept' as const };
  check(placeholderFreeResult(untouched) === untouched, 'C13c sauberes Ergebnis bleibt identisch (kein Rewrite)');
}

// ── C14: i18n — neue Keys in de UND en (Parität additiv) ────────────────────
section('C14 i18n de/en');
await (async () => {
  const de = (await import('./src/i18n/de')).de;
  const en = (await import('./src/i18n/en')).en;
  const dk = Object.keys(de);
  const ek = Object.keys(en);
  check(dk.length === ek.length, `C14a gleiche Key-Anzahl (de=${dk.length}, en=${ek.length})`);
  check(dk.every((k) => ek.includes(k)) && ek.every((k) => dk.includes(k)), 'C14b keine einseitigen Keys');
  for (const k of ['tiktok_result_scroll_stop', 'tiktok_result_tension']) {
    check(k in de && k in en, `C14c ${k} in de UND en`);
  }
  check(
    (de as Record<string, string>).tiktok_result_hashtags.includes('5') &&
      (en as Record<string, string>).tiktok_result_hashtags.includes('5'),
    'C14d Hashtag-Label nennt die Obergrenze 5',
  );
})();

// ── C15: UI rendert die neuen Abschnitte (Verdrahtung) ──────────────────────
section('C15 UI-Verdrahtung (tiktok.tsx)');
await (async () => {
  const src = await Bun.file('src/routes/app/tiktok.tsx').text();
  check(src.includes('t.tiktok_result_scroll_stop'), 'C15a UI rendert Scroll-Stop-Moment');
  check(src.includes('t.tiktok_result_tension'), 'C15b UI rendert Spannungsbogen');
  check(src.includes('{r.scrollStop !== undefined && r.scrollStop.trim() !== '), 'C15c Scroll-Stop nur wenn vorhanden');
  check(src.includes('{r.tension !== undefined && r.tension.trim() !== '), 'C15d Spannungsbogen nur wenn vorhanden');
  check(src.includes('{r.cta.trim() !== '), 'C15e leerer CTA rendert keinen leeren Block');
  check(src.includes('t.tiktok_result_timed_scenes'), 'C15f Szenenplan mit Zeitangaben wird gerendert');
  check(src.includes('t.tiktok_result_image_ideas'), 'C15g Bild-/Videoideen werden gerendert');
  check(!/["'>]Scroll-Stop/.test(src), 'C15h keine hardcodierten UI-Texte (i18n-Keys)');
})();

// ── Ergebnis ─────────────────────────────────────────────────────────────────
console.log(`\nPhase 2 (TikTok concept-Qualität): ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('PHASE 2 CONCEPT-QUALITY GRÜN');
server.stop(true);
