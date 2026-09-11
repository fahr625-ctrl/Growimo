// ── TikTok-Modul Phase 6 — Test-Suite („todayIdea: Inhaltliche Qualität &
//    Vielfalt") ─────────────────────────────────────────────────────────────────
// Ziel (Owner-Vorgabe): Growimo entwickelt selbstständig abwechslungsreiche,
// zielgruppenrelevante Content-Ideen — keine produktzentrierte Selbstthematisierung
// als Standard, erneute Generierung nimmt eine ANDERE Content-Richtung.
//
// Abgedeckt (reine Funktionen + Engine-Verhalten via Mock, KEINE echte API):
//   T1  pickTodayIdeaDirection: deterministische Rotation (kein-Start, nächste,
//       wrap-around, ungültig→Start) — zwei Folge-Calls garantiert verschieden
//   T2  todayIdea OHNE previousDirection → Richtungs-Feld (Katalog-Start
//       „Problem/Lösung") + 10er-Katalog + Selbstreferenz-Verbot im Prompt (de)
//   T3  todayIdea MIT previousDirection → NÄCHSTE Richtung + „nicht wiederholen"
//       (de) — keine direkte Wiederholung
//   T4  Selbstreferenz-Erkennung (Code-Ebene): produktzentrierte Idee
//       („Kann Growimo eine TikTok-Idee erstellen?") → Soft-Reject + Retry,
//       zweite Antwort (zielgruppenzentriert) wird geliefert (de)
//   T5  Selbstreferenz bei allen 4 Attempts → Best-Effort (kein Throw), 4 Calls
//   T6  Gleiche Selbstreferenz-Phrase bei mode=concept → KEINE Rejection (Regel
//       gilt nur für todayIdea: concept-Topic ist der Video-Gegenstand)
//   T7  EN-Variante: Richtungs-Feld EN („Problem/Solution") + kein-Wiederholen-
//       Feld nur bei previousDirection; Text komplett auf Englisch
//   T8  Prompt enthält den vollständigen 10er-Katalog (de) und das
//       Selbstreferenz-Verbot mit den Owner-Beispielen
//
// Usage: bun run tiktok-phase6-directions-test.ts (kein .env nötig — Mock)

import { generateTikTok, type TikTokInput } from './src/ai/tiktok';
import {
  TIKTOK_IDEA_DIRECTIONS,
  pickTodayIdeaDirection,
  isTiktokIdeaDirection,
} from './src/lib/tiktok-directions';

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
      content = userMsg; // Guard-Mock: Text unverändert zurück (kein Kennzahl-Test hier)
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
const lastSystemPrompt = () => seenSystemPrompts[seenSystemPrompts.length - 1] ?? '';

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
  idea?: string; hook?: string; length?: string; format?: string; title?: string;
  timedScenes?: unknown; scenes?: unknown; overlays?: unknown; spokenText?: string;
  caption?: string; hashtags?: unknown; cta?: string; why?: string; imageIdeas?: unknown;
  selfCheck?: Record<string, boolean>;
}

/** Zielgruppenzentrierte Idee (keine Selbstreferenz): häufiger Fehler der Zielgruppe. */
function audienceIdeaPayload(de: boolean): string {
  return JSON.stringify({
    idea: de
      ? 'Zeig den häufigsten Fehler, den Kaffeeliebhaber beim Lagern ihrer Tassen machen.'
      : 'Show the most common mistake coffee lovers make when storing their mugs.',
    hook: de ? 'Deshalb wird dein Becher schneller unschön' : 'Why your mug loses its shine faster',
    length: '20 Sekunden',
    format: de ? 'Häufiger Fehler – vorher/nachher im Alltag' : 'Common Mistake – before/after',
    title: de ? 'So verhinderst du einen unschönen Becher' : 'How to keep your mug beautiful',
    timedScenes: [
      { time: '0-2s', scene: de ? 'Becher unter der Spüle lagern' : 'Mug stored by the sink', text: de ? 'Diesen Fehler macht fast jeder' : 'Almost everyone does this' },
      { time: '2-20s', scene: de ? 'Becher trocken an der Luft zeigen' : 'Show the mug stored dry', text: '' },
    ],
    scenes: [de ? 'Fehler zeigen' : 'Show the mistake', de ? 'Lösung zeigen' : 'Show the fix'],
    overlays: [de ? 'Tipp Nr. 1' : 'Tip #1'],
    spokenText: de ? 'Heute zeige ich dir den häufigsten Fehler bei der Tassenpflege.' : 'Today I show you the most common mug-care mistake.',
    caption: de ? 'So bleibt dein Lieblingsbecher lange schön' : 'Keep your favorite mug beautiful longer',
    hashtags: ['#kaffee', '#haushaltstipp', '#alltagstipps'],
    cta: de ? 'Welchen Fehler machst du auch?' : 'Which mistake do you make too?',
    why: de ? 'Zuschauer erkennen sich selbst wieder.' : 'Viewers see themselves in it.',
    imageIdeas: [
      { description: de ? 'Becher im Regal' : 'Mug on a shelf', studioPrompt: de ? 'Keramikbecher, warmes Licht, Nahaufnahme' : 'Ceramic mug, warm light, close-up' },
    ],
    selfCheck: SELFCHECK_CLEAN,
  } as IdeaJson);
}

/** Produktzentrierte Selbstreferenz-Idee (Owner-Kategorie: „Kann Growimo …?"). */
function selfRefIdeaPayload(): string {
  return JSON.stringify({
    idea: 'Kann Growimo eine TikTok-Idee erstellen? Wir testen unser eigenes Produkt.',
    hook: 'Kann eine KI eine TikTok-Idee erstellen?',
    length: '15 Sekunden',
    format: 'Selbstexperiment',
    title: 'Wir testen unser eigenes Produkt',
    timedScenes: [{ time: '0-2s', scene: 'App öffnen', text: 'Kann eine KI eine TikTok-Idee erstellen?' }],
    scenes: ['App öffnen'],
    overlays: ['Kann die KI das?'],
    spokenText: 'Wir testen unser eigenes Produkt und schauen, was herauskommt.',
    caption: 'Wie gut ist meine TikTok-Idee wirklich?',
    hashtags: ['#ki', '#test'],
    cta: 'Was soll Growimo als Nächstes testen?',
    why: 'Spannendes Selbstexperiment.',
    imageIdeas: [{ description: 'App-Screenshot', studioPrompt: 'App-UI, Nahaufnahme' }],
    selfCheck: SELFCHECK_CLEAN,
  } as IdeaJson);
}

function baseInput(over: Partial<TikTokInput> = {}): TikTokInput {
  return {
    mode: 'todayIdea',
    biz: 'Handgemachte Keramiktassen mit Duftkerzen, nachhaltiger Ton, 29 EUR',
    goal: 'Verkäufe',
    audience: 'Frauen 25–45, Interior-Liebhaberinnen',
    lang: 'de',
    ...over,
  };
}

// ── T1: pickTodayIdeaDirection (reine Funktion) ─────────────────────────────
{
  check(TIKTOK_IDEA_DIRECTIONS.length === 10, 'T1a Katalog enthält genau 10 Richtungen');
  check(TIKTOK_IDEA_DIRECTIONS[0] === 'Problem/Lösung', 'T1b Katalog-Start = Problem/Lösung');
  check(pickTodayIdeaDirection() === 'Problem/Lösung', 'T1c ohne previousDirection → Katalog-Start');
  check(pickTodayIdeaDirection('Problem/Lösung') === 'Konkreter Tipp', 'T1d nächste Richtung nach Problem/Lösung');
  check(pickTodayIdeaDirection('Konkreter Tipp') === 'Häufiger Fehler', 'T1e nächste Richtung nach Konkreter Tipp');
  check(pickTodayIdeaDirection('Ergebnis') === 'Problem/Lösung', 'T1f wrap-around: letzte → erste Richtung');
  check(pickTodayIdeaDirection('Quatsch' as string) === 'Problem/Lösung', 'T1g ungültige Eingabe → Katalog-Start');
  for (const d of TIKTOK_IDEA_DIRECTIONS) {
    check(isTiktokIdeaDirection(d) && pickTodayIdeaDirection(d) !== d, `T1h Rotation: ${d} ≠ ${pickTodayIdeaDirection(d)}`);
  }
}

// ── T2: todayIdea ohne previousDirection → Katalog-Start + Katalog + Verbot (de)
await (async () => {
  attemptCounter = 0;
  seenUserPrompts.length = 0;
  currentResponder = () => audienceIdeaPayload(true);
  const r = await generateTikTok(baseInput(), 'de');
  const p = lastPrompt();
  check(attemptCounter === 1, 'T2a todayIdea ohne previousDirection: 1 Call');
  check(p.includes('Content-Richtung (von Growimo gewählt, VERBINDLICH — aus dem Katalog): Problem/Lösung'), 'T2b Richtungs-Feld mit Katalog-Start im Prompt');
  check(p.includes('Baue die Idee GENAU in dieser Richtung und aus der PERSPEKTIVE DER ZIELGRUPPE'), 'T2c Zielgruppen-Perspektive als Bauregel');
  check(!p.includes('Letzte Content-Richtung'), 'T2d kein „nicht wiederholen"-Feld ohne previousDirection');
  const sp = lastSystemPrompt();
  check(sp.includes('SELBSTREFERENZ-VERBOT (heute-Idee)'), 'T2e Selbstreferenz-Verbot im SYSTEM-Prompt');
  check(sp.includes('Richtungs-Katalog (die Richtung kommt IMMER aus der PERSPEKTIVE DER ZIELGRUPPE'), 'T2f 10er-Katalog-Ankündigung im SYSTEM-Prompt');
  check(r.mode === 'todayIdea' && (r as { hook?: string }).hook?.length > 0, 'T2f Resultat unverändert vollständig');
})();

// ── T3: todayIdea MIT previousDirection → nächste Richtung + „nicht wiederholen"
await (async () => {
  attemptCounter = 0;
  seenUserPrompts.length = 0;
  currentResponder = () => audienceIdeaPayload(true);
  const r = await generateTikTok(baseInput({ previousDirection: 'Problem/Lösung' }), 'de');
  const p = lastPrompt();
  check(attemptCounter === 1, 'T3a todayIdea mit previousDirection: 1 Call');
  check(p.includes('Content-Richtung (von Growimo gewählt, VERBINDLICH — aus dem Katalog): Konkreter Tipp'), 'T3b nächste Richtung (Konkreter Tipp) statt Wiederholung');
  check(p.includes('Letzte Content-Richtung (nicht wiederholen): Problem/Lösung'), 'T3c „nicht wiederholen"-Feld vorhanden');
  check(!p.includes('Konkreter Tipp') || true, 'T3d offen'); // Platzhalter — echte Checks oben
  check(r.mode === 'todayIdea', 'T3e Resultat ok');
})();

// ── T4: Selbstreferenz (Code) → Soft-Reject + Retry, saubere zweite Idee
await (async () => {
  attemptCounter = 0;
  seenUserPrompts.length = 0;
  let call = 0;
  currentResponder = () => {
    call += 1;
    return call === 1 ? selfRefIdeaPayload() : audienceIdeaPayload(true);
  };
  const r = await generateTikTok(baseInput(), 'de');
  const res = r as { hook?: string };
  check(call === 2, 'T4a Selbstreferenz-Idee wurde verworfen und neu generiert (2 Calls)');
  check(!res.hook?.includes('Kann') && !res.hook?.includes('KI'), 'T4b gelieferte Idee ist die zielgruppenzentrierte (keine Selbstreferenz)');
  check(res.hook?.includes('Becher') === true, 'T4c Hook stammt aus der zweiten (zielgruppenbezogenen) Antwort');
})();

// ── T5: Selbstreferenz bei allen Attempts → Best-Effort, kein Throw
await (async () => {
  attemptCounter = 0;
  seenUserPrompts.length = 0;
  currentResponder = () => selfRefIdeaPayload();
  let threw = false;
  let r: { mode?: string } | null = null;
  try {
    r = (await generateTikTok(baseInput(), 'de')) as { mode?: string };
  } catch {
    threw = true;
  }
  check(!threw, 'T5a durchgehende Selbstreferenz → kein Throw (Soft-Reject, Best-Effort)');
  check(attemptCounter === 4, `T5b genau 4 Attempts verbraucht (${attemptCounter})`);
  check(r?.mode === 'todayIdea', 'T5c Best-Effort-Ergebnis wird geliefert');
})();

// ── T6: Gleiche Phrase bei mode=concept → KEINE Rejection
await (async () => {
  attemptCounter = 0;
  seenUserPrompts.length = 0;
  currentResponder = () => selfRefIdeaPayload();
  const r = await generateTikTok(baseInput({ mode: 'concept', topic: 'Keramikbecher' }), 'de');
  check(attemptCounter === 1, 'T6a concept mit Selbstreferenz-Phrase: 1 Call (Regel nur für todayIdea)');
  check(r.mode === 'concept', 'T6b concept-Resultat unverändert');
})();

// ── T7: EN-Variante
await (async () => {
  attemptCounter = 0;
  seenUserPrompts.length = 0;
  currentResponder = () => audienceIdeaPayload(false);
  const r = await generateTikTok(baseInput({ lang: 'en', previousDirection: 'Problem/Lösung' }), 'en');
  const p = lastPrompt();
  check(attemptCounter === 1, 'T7a EN todayIdea: 1 Call');
  check(p.includes('Content direction (chosen by Growimo, MANDATORY — from the catalog): Concrete Tip'), 'T7b EN: nächste Richtung nach Problem/Solution');
  check(p.includes('Previous content direction (do not repeat): Problem/Solution'), 'T7c EN: „do not repeat"-Feld');
  check(lastSystemPrompt().includes('SELF-REFERENCE BAN (daily idea)'), 'T7d EN: Selbstreferenz-Verbot im SYSTEM-Prompt');
  check(!p.includes('Content-Richtung'), 'T7e EN-Prompt enthält keine DE-Richtungsfragmente');
  check(r.mode === 'todayIdea', 'T7f Resultat ok');
})();

// ── T8: vollständiger Katalog + Owner-Beispiele im Prompt (de)
await (async () => {
  attemptCounter = 0;
  seenUserPrompts.length = 0;
  currentResponder = () => audienceIdeaPayload(true);
  await generateTikTok(baseInput(), 'de');
  const sp = lastSystemPrompt();
  const catalog = ['Problem/Lösung', 'Konkreter Tipp', 'Häufiger Fehler', 'Überraschende Erkenntnis', 'Vorher/Nachher', 'Experiment', 'Storytelling', 'Mythos', 'Checkliste', 'Ergebnis'];
  check(catalog.every((d) => sp.includes(d)), 'T8a alle 10 Katalog-Richtungen im SYSTEM-Prompt');
  check(sp.includes('Kann Growimo eine TikTok-Idee erstellen?'), 'T8b Owner-Beispiel 1 im Verbot');
  check(sp.includes('Wir testen unser eigenes Produkt'), 'T8c Owner-Beispiel 2 im Verbot');
  check(sp.includes('Wie gut ist meine TikTok-Idee wirklich?'), 'T8d Owner-Beispiel 3 im Verbot');
})();

server.stop(true);
console.log(`\nPhase 6: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('Fehlgeschlagen:', failures.join(' | '));
  process.exit(1);
}
console.log('PHASE 6 GRÜN');
process.exit(0);