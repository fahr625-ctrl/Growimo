// ─────────────────────────────────────────────────────────────────────────────
// FIX-BLOCK 4 — DE-Projektseite + TikTok-Inhaltsregeln (2026-10-08)
// ─────────────────────────────────────────────────────────────────────────────
// Prüft die beiden Launch-Befunde (launch-test-teil2-2026-10-08.md, Z. 205–211
// und Z. 97–116 / Gesamtliste Punkte 9 + 10) als dauerhafte Regression:
//
// TEIL A — Projektseite sprachlich DE-konform
//   1. „Back to Dashboard" ist kein Literal mehr, sondern über den i18n-Key
//      proj_back_to_dashboard (de/en) angeschlossen.
//   2. Erstelldatum/-uhrzeit folgt der aktuellen Locale (de-DE vs. en-US) über
//      formatDateTime(project.createdAt, locale) + Key proj_created_at.
//   3. i18n-Parität de/en bleibt erhalten (kein Key einseitig).
//
// TEIL B — TikTok-Diagnose-Inhaltsregeln
//   4. Der Diagnose-Prompt (de/en) enthält das Inhaltsmandat: keine erfundenen
//      Anlass-/Zielgruppen-Behauptungen, kein erzwungener Kauf-/Download-CTA.
//   5. diagnoseOccasionViolations/diagnoseCtaViolations erkennen den Live-
//      Befund deterministisch (a: „Das perfekte Geschenk für jeden Anlass.",
//      b: „Bestelle jetzt …!") — inkl. Grounding (vom Nutzer genannt = erlaubt).
//   6. Engine-Verhalten: genau EIN Korrekturversuch mit gezieltem Hinweis,
//      danach harter Fehler (fail closed) — und keine Fehlalarme bei sauberem
//      Ergebnis (1 Call).
//
// Läuft OHNE DB; der Engine-Teil nutzt einen lokalen OpenAI-Mock (OPENAI_BASE_URL)
// wie die tiktok-*-Suiten:  bun fix-block4-de-tiktok-test.ts
// Exit 0 nur, wenn alle Checks grün sind.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
// Der OpenAI-Mock laeuft auf Bun.serve; die Bun-Typen sind in diesem tsconfig nicht
// geladen (wie in den bestehenden tiktok-*-Suiten) -> lokale Deklaration, damit die
// Suite keine neuen tsc-Fehler einfuehrt.
declare const Bun: any;
import {
  diagnoseCtaBlob,
  diagnoseCtaViolations,
  diagnoseOccasionViolations,
  generateTikTok,
  inventedGroundingBlob,
  pickSystemPrompt,
  COMPOUND_OCCASION_PATTERNS,
  FORCED_CTA_PATTERNS,
  GENERALIZED_OCCASION_PATTERNS,
  type TikTokDiagnoseResult,
  type TikTokDiagnoseSelfCheck,
  type TikTokInput,
} from './src/ai/tiktok';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';
import { formatDateTime } from './src/lib/date';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(cond: boolean, label: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

// ── OpenAI-Mock (wie tiktok-diagnose-v2-test.ts) ──────────────────────────────
type Responder = (attempt: number, userPrompt: string) => string;
let currentResponder: Responder | null = null;
let attemptCounter = 0;
const seenUserPrompts: string[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req: Request) {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const body = (await req.json()) as { messages?: Array<{ role?: string; content?: unknown }> };
    const userMsg = (body?.messages?.find((m) => m.role === 'user')?.content as string | undefined) ?? '';
    seenUserPrompts.push(userMsg);
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

const CLEAN_SELFCHECK: TikTokDiagnoseSelfCheck = {
  inventsMetrics: false,
  unprovenPromise: false,
  prescribedEnthusiasm: false,
  vagueNextTest: false,
  groundedInNumbers: true,
  lengthGrounded: true,
};
// Zahlen bewusst identisch zur v2-Suite (2500/42s/16 → 38,1 % Watch-Rate):
// damit ist jede genannte Zahl durch die Nutzereingaben belegt und die
// metric-guard löst KEINEN zusätzlichen LLM-Call aus (Call-Zahlen bleiben
// aussagekräftig für genau den geprüften Korrektur-Pfad).
const METRICS = { views: 2500, length: '42s', avgWatch: 16 };
const TOPIC_DE = 'personalisierte Duftkerze';
const TOPIC_EN = 'personalized scented candle';

/** DE-Fixture des LIVE-BEFUNDS (Launch-Test Teil 2b, Z. 104/105): verallgemeinerte
 *  Anlass-Behauptung im Voice-over + bestell-erzwingender CTA. */
function deDefectPayload(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    videoTopic: TOPIC_DE,
    biggestProblem: 'Die Wiedergabedauer bricht früh ein — wahrscheinlich, weil der Einstieg die Duftkerze erst zu spät zeigt.',
    whatWorks: ['Die 2500 Aufrufe deuten darauf hin, dass der Einstieg Interesse weckt'],
    whatToImprove: ['Der Einstieg könnte die Duftkerze schneller zeigen', 'Die Einblendung kommt möglicherweise zu spät'],
    newHook: 'Entdecke die Magie personalisierter Duftkerzen in Sekunden',
    optimized: 'Szene 1: Nahaufnahme der Duftkerze in Sekunde 0-2, Szene 2: Gravur-Detail, Szene 3: Abschluss',
    nextTest: 'Setze die Nahaufnahme der Duftkerze auf Sekunde 1 und beobachte die durchschnittliche Wiedergabedauer.',
    rebuilt: {
      hook: 'Entdecke die Magie personalisierter Duftkerzen in Sekunden',
      timedScenes: [
        { time: '0-2s', scene: 'Nahaufnahme einer personalisierten Duftkerze', text: 'Entdecke die Magie personalisierter Duftkerzen' },
        { time: '2-8s', scene: 'Die Gravur wird gedreht', text: 'Dein Name auf der Kerze' },
        { time: '8-18s', scene: 'Die Kerze brennt auf dem Tisch', text: 'So einfach geht es' },
      ],
      voiceover: 'Entdecke die Magie personalisierter Duftkerzen! So einfach geht es! Das perfekte Geschenk für jeden Anlass.',
      cta: 'Bestelle jetzt deine personalisierte Duftkerze!',
      seconds: 18,
    },
    lengthRecommendation: {
      seconds: 18,
      structure: '0-2s: Hook, 2-14s: Inhalt mit dem Fix, 14-18s: Abschluss',
      reason: 'Basierend auf deinen 2500 Views und 38,1% Watch-Rate bei 42s Länge (16s durchschnittliche Wiedergabedauer) bricht die Aufmerksamkeit früh ein — kürze auf 18 Sekunden und zeige die Duftkerze in den ersten Sekunden.',
    },
    selfCheck: CLEAN_SELFCHECK,
    ...over,
  });
}

/** Saubere DE-Variante: kein verallgemeinerter Anlass, natürlicher CTA. */
function deCleanPayload(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    videoTopic: TOPIC_DE,
    biggestProblem: 'Die Wiedergabedauer bricht früh ein — wahrscheinlich, weil der Einstieg die Duftkerze erst zu spät zeigt.',
    whatWorks: ['Die 2500 Aufrufe deuten darauf hin, dass der Einstieg Interesse weckt'],
    whatToImprove: ['Der Einstieg könnte die Duftkerze schneller zeigen'],
    newHook: 'Entdecke die Magie personalisierter Duftkerzen in Sekunden',
    optimized: 'Szene 1: Nahaufnahme der Duftkerze in Sekunde 0-2, Szene 2: Gravur-Detail, Szene 3: Frage an die Zuschauer',
    nextTest: 'Setze die Nahaufnahme der Duftkerze auf Sekunde 1 und beobachte die durchschnittliche Wiedergabedauer.',
    rebuilt: {
      hook: 'Entdecke die Magie personalisierter Duftkerzen in Sekunden',
      timedScenes: [
        { time: '0-2s', scene: 'Nahaufnahme einer personalisierten Duftkerze', text: 'Entdecke die Magie personalisierter Duftkerzen' },
        { time: '2-8s', scene: 'Die Gravur wird gedreht', text: 'Dein Name auf der Kerze' },
        { time: '8-18s', scene: 'Die Kerze brennt auf dem Tisch', text: 'So einfach geht es' },
      ],
      voiceover: 'Entdecke die Magie personalisierter Duftkerzen! So einfach geht es: erst die Gravur, dann die brennende Kerze.',
      cta: 'Was würdest du auf deine Kerze gravieren lassen?',
      seconds: 18,
    },
    lengthRecommendation: {
      seconds: 18,
      structure: '0-2s: Hook, 2-14s: Inhalt mit dem Fix, 14-18s: Frage',
      reason: 'Basierend auf deinen 2500 Views und 38,1% Watch-Rate bei 42s Länge (16s durchschnittliche Wiedergabedauer) bricht die Aufmerksamkeit früh ein — kürze auf 18 Sekunden und zeige die Duftkerze in den ersten Sekunden.',
    },
    selfCheck: CLEAN_SELFCHECK,
    ...over,
  });
}

/** EN-Fixture des LIVE-BEFUNDS (Übersetzung des Befund-Musters). */
function enDefectPayload() {
  return JSON.stringify({
    videoTopic: TOPIC_EN,
    biggestProblem: 'Watch time drops early — likely because the opening shows the candle too late.',
    whatWorks: ['2500 views suggest the opening creates interest'],
    whatToImprove: ['The opening could show the candle sooner'],
    newHook: 'Discover the magic of personalized scented candles',
    optimized: 'Scene 1: candle close-up in seconds 0-2, Scene 2: engraving detail, Scene 3: closing',
    nextTest: 'Show the candle close-up in second 1 and watch the average watch time.',
    rebuilt: {
      hook: 'Discover the magic of personalized scented candles',
      timedScenes: [
        { time: '0-2s', scene: 'Close-up of a personalized scented candle', text: 'Discover the magic of personalized scented candles' },
        { time: '2-8s', scene: 'The engraving is turned', text: 'Your name on the candle' },
        { time: '8-18s', scene: 'The candle burns on the table', text: 'That is how easy it is' },
      ],
      voiceover: 'Discover the magic of personalized scented candles! That is how easy it is. The perfect gift for every occasion.',
      cta: 'Order now!',
      seconds: 18,
    },
    lengthRecommendation: {
      seconds: 18,
      structure: '0-2s: hook, 2-14s: content with the fix, 14-18s: closing',
      reason: 'Based on your 2500 views and 38.1% watch rate at 42s length (16s average watch time), attention drops early — shorten to 18 seconds and show the candle within the first seconds.',
    },
    selfCheck: CLEAN_SELFCHECK,
  });
}

async function scenario(name: string, fn: () => Promise<void>) {
  attemptCounter = 0;
  seenUserPrompts.length = 0;
  console.log(`\n[${name}]`);
  try {
    await fn();
  } catch (e) {
    failed += 1;
    failures.push(`${name} threw: ${(e as Error).message}`);
    console.log(`  ✗ ${name} threw: ${(e as Error).message}`);
  }
  console.log(`  // ${attemptCounter} engine call(s)`);
}
const lastPrompt = () => seenUserPrompts[seenUserPrompts.length - 1] ?? '';
const diagInput = (over: Partial<TikTokInput> = {}): TikTokInput => ({
  mode: 'diagnose',
  biz: 'Handgemachte personalisierte Duftkerzen',
  metrics: METRICS,
  videoTopic: TOPIC_DE,
  ...over,
});

// ── TEIL A — Projektseite sprachlich DE-konform ──────────────────────────────
console.log('\n[A] Projektseite: hardkodierte englische Texte → i18n');
const PAGE_PATH = 'src/routes/app/projects/$projectId.tsx';
const pageSrc = readFileSync(new URL('./' + PAGE_PATH, import.meta.url), 'utf8');
check(pageSrc.includes('{t.proj_back_to_dashboard}'), 'Projektseite rendert den Zurück-Link über t.proj_back_to_dashboard');
check(!/Back to Dashboard/.test(pageSrc), 'kein hartkodiertes „Back to Dashboard" mehr in der Projektseite');
check(de.proj_back_to_dashboard === 'Zurück zum Dashboard', `de.proj_back_to_dashboard = „Zurück zum Dashboard"`);
check(en.proj_back_to_dashboard === 'Back to Dashboard', `en.proj_back_to_dashboard = „Back to Dashboard"`);
check(de.proj_created_at === 'Erstellt am' && en.proj_created_at === 'Created on', 'proj_created_at existiert in de („Erstellt am") und en („Created on")');
check(
  pageSrc.includes('{t.proj_created_at} {formatDateTime(project.createdAt, locale)}'),
  'Erstelldatum nutzt t.proj_created_at + formatDateTime(project.createdAt, locale)',
);
check(pageSrc.includes("import { formatDateTime } from '~/lib/date'"), 'locale-bewusster Helper formatDateTime wird importiert');
check(!pageSrc.includes("toLocaleDateString('en-US'"), 'kein hartkodiertes en-US mehr in der Projektseite');
check(!/Created \{/.test(pageSrc), 'kein hartkodiertes „Created {" mehr');
check((pageSrc.match(/\blocale\b/g) ?? []).length >= 5, 'die Seite nutzt durchgängig locale aus dem i18n-Kontext');

const probe = new Date(Date.UTC(2026, 9, 8, 12, 30));
const probeDe = formatDateTime(probe, 'de');
const probeEn = formatDateTime(probe, 'en');
check(probeDe !== probeEn, `Datum/Uhrzeit unterscheidet sich je Locale (de=„${probeDe}" / en=„${probeEn}")`);
check(probeDe.includes('Oktober') && probeDe.includes('2026'), 'DE-Ausgabe nutzt deutsche Monatsnamen und das Jahr');
check(probeEn.includes('October') && probeEn.includes('2026'), 'EN-Ausgabe nutzt englische Monatsnamen und das Jahr');
check(!/Oktober/.test(probeEn) && !/October/.test(probeDe), 'keine Sprachmischung im Datum');
check(/\d{2}:\d{2}/.test(probeDe) && /\d{1,2}:\d{2}/.test(probeEn), 'Uhrzeit wird in beiden Locales ausgegeben');

const deKeys = Object.keys(de);
const enKeys = Object.keys(en);
check(deKeys.length === enKeys.length, `i18n-Parität: de ${deKeys.length} = en ${enKeys.length} Keys`);
check(deKeys.every((k) => k in en) && enKeys.every((k) => k in de), 'kein Key einseitig (Parität beidseitig geprüft)');
check(deKeys.length >= 1646, `Key-Anzahl ${deKeys.length} ≥ Baseline 1646`);
check('proj_back_to_dashboard' in de && 'proj_back_to_dashboard' in en, 'proj_back_to_dashboard liegt in BEIDEN Sprachdateien');
check('proj_created_at' in de && 'proj_created_at' in en, 'proj_created_at liegt in BEIDEN Sprachdateien');

// ── TEIL B.1 — Prompt-Härtung des Diagnose-Zweigs ────────────────────────────
console.log('\n[B1] Diagnose-Prompt (de/en) enthält die beiden Inhaltsregeln');
const diagDe = pickSystemPrompt('diagnose', 'de');
const diagEn = pickSystemPrompt('diagnose', 'en');
check(diagDe.includes('KEINE ERFUNDENEN ANLASS-/ZIELGRUPPEN-BEHAUPTUNGEN'), 'DE: Anlass-/Zielgruppen-Verbot im Diagnose-Prompt');
check(diagDe.includes('Das perfekte Geschenk für jeden Anlass'), 'DE: verallgemeinerte Anlass-Behauptung wird als verbotenes Beispiel genannt');
check(diagDe.includes('HANDLUNGSAUFRUF NATÜRLICH, NIE ERZWUNGEN'), 'DE: CTA-Regel im Diagnose-Prompt');
check(diagDe.includes('Bestelle jetzt'), 'DE: kauf-/bestell-erzwingender CTA wird als verbotenes Beispiel genannt');
check(diagEn.includes('NO INVENTED OCCASION/TARGET-AUDIENCE CLAIMS'), 'EN: occasion/audience ban im Diagnose-Prompt');
check(diagEn.includes('The perfect gift for every occasion'), 'EN: generalisierte Anlass-Behauptung als verbotenes Beispiel');
check(diagEn.includes('CALL-TO-ACTION NATURAL, NEVER FORCED'), 'EN: CTA-Regel im Diagnose-Prompt');
check(diagEn.includes('Order now'), 'EN: erzwungener Kauf-CTA als verbotenes Beispiel');
check(diagDe.includes('TikTok-Diagnostiker') && diagEn.includes('diagnostician'), 'bestehender Diagnose-Prompt unverändert vorhanden (de/en)');
check(!diagDe.includes('Bedeutungs-Erhalt') && !diagEn.includes('MEANING PRESERVATION'), 'Diagnose-Prompt bleibt schlank (kein Idee-Mandat eingeblendet)');
// Idee-Modi unverändert: dieselben Regeln standen dort schon (Ursache des Bugs).
const ideaDe = pickSystemPrompt('concept', 'de');
const ideaEn = pickSystemPrompt('concept', 'en');
check(ideaDe.includes('ANLASS') && ideaDe.includes('Jetzt herunterladen/kaufen'), 'Idee-Prompt (concept de) behält Anlass-Verbot + CTA-Regel unverändert');
check(ideaEn.includes('OCCASION') && ideaEn.includes('Never force "download/buy now"'), 'Idee-Prompt (concept en) behält Anlass-Verbot + CTA-Regel unverändert');
const tiktokSrc = readFileSync(new URL('./src/ai/tiktok.ts', import.meta.url), 'utf8');
check((tiktokSrc.match(/diagnoseContentMandate\(/g) ?? []).length === 3, 'diagnoseContentMandate: 1 Definition + 2 Verwendungen (de/en, EINE Quelle)');

// ── TEIL B.2 — deterministische Prüfungen (Unit) ─────────────────────────────
console.log('\n[B2] diagnoseOccasionViolations / diagnoseCtaViolations (Unit)');
const defectDe = JSON.parse(deDefectPayload()) as TikTokDiagnoseResult;
const cleanDe = JSON.parse(deCleanPayload()) as TikTokDiagnoseResult;
const groundingLive = inventedGroundingBlob(diagInput({ videoTopic: TOPIC_DE, topic: 'Duftkerze als Geschenk' }));
const occDefect = diagnoseOccasionViolations(defectDe, groundingLive);
const ctaDefect = diagnoseCtaViolations(defectDe);
check(occDefect.length > 0, `Live-Befund (a) erkannt: ${occDefect.join(', ') || '—'}`);
check(occDefect.includes('INVENTED:fuer-jeden-anlass'), 'Muster „für jeden Anlass" greift (Live-String „Das perfekte Geschenk für jeden Anlass.")');
check(ctaDefect.length > 0, `Live-Befund (b) erkannt: ${ctaDefect.join(', ') || '—'}`);
check(ctaDefect.includes('FORCED-CTA:de-verb-jetzt'), 'Muster „Bestelle jetzt …" greift (Live-CTA)');
check(diagnoseOccasionViolations(cleanDe, groundingLive).length === 0, 'sauberes Ergebnis: KEINE Anlass-Behauptung gemeldet (kein Fehlalarm)');
check(diagnoseCtaViolations(cleanDe).length === 0, 'sauberes Ergebnis: KEIN erzwungener CTA gemeldet („Was würdest du testen?" ist erlaubt)');

const enDefect = JSON.parse(enDefectPayload()) as TikTokDiagnoseResult;
const occEn = diagnoseOccasionViolations(enDefect, inventedGroundingBlob(diagInput({ videoTopic: TOPIC_EN })));
const ctaEn = diagnoseCtaViolations(enDefect);
check(occEn.includes('INVENTED:for-every-occasion'), `EN: „for every occasion" erkannt (${occEn.join(', ')})`);
check(ctaEn.includes('FORCED-CTA:en-verb-now'), `EN: „Order now!" erkannt (${ctaEn.join(', ')})`);

// Grounding: was der Nutzer selbst genannt hat, ist KEINE Erfindung.
const occGrounded = diagnoseOccasionViolations(defectDe, 'Duftkerze für jeden Anlass als Geschenk');
check(occGrounded.length === 0, 'grounded: Nutzer sagte „für jeden Anlass" → kein Verstoß');
const holidayPayload = JSON.parse(
  deDefectPayload({
    rebuilt: {
      hook: 'Weihnachtsduft für dein Zuhause',
      timedScenes: [{ time: '0-2s', scene: 'Kerze', text: 'Weihnachtsduft' }],
      voiceover: 'Das perfekte Weihnachtsgeschenk für deine Liebsten.',
      cta: 'Was riechst du am liebsten?',
      seconds: 18,
    },
  }),
) as TikTokDiagnoseResult;
check(
  diagnoseOccasionViolations(holidayPayload, 'Duftkerze als Geschenk').includes('INVENTED:anlass-weihnachten'),
  'erfundener Anlass „Weihnachten" wird erkannt (Muster des Idee-Pfads + Komposita-Nachtrag „Weihnachtsgeschenk")',
);
check(
  COMPOUND_OCCASION_PATTERNS.some((p) => p.name === 'anlass-weihnachten') && COMPOUND_OCCASION_PATTERNS.length >= 8,
  `Komposita-Muster vorhanden (${COMPOUND_OCCASION_PATTERNS.length} Anlässe, deutsche Zusammensetzungen)`,
);
check(
  diagnoseOccasionViolations(holidayPayload, 'Weihnachtsgeschenk Idee').length === 0,
  'grounded: Nutzer nannte „Weihnachtsgeschenk" → kein Verstoß',
);
// Analyse-Felder sind ausgenommen: ein ZITAT des alten CTAs als Kritik ist legitim.
const critiquePayload = JSON.parse(
  deCleanPayload({
    whatToImprove: ['Der bisherige CTA „Bestelle jetzt!" wirkte wie Werbung — ersetze ihn durch eine Frage'],
  }),
) as TikTokDiagnoseResult;
check(diagnoseCtaViolations(critiquePayload).length === 0, 'Analyse-Feld darf den alten CTA als Kritik zitieren (kein Fehlalarm)');
check(diagnoseCtaBlob(critiquePayload).includes('was würdest du') && !diagnoseCtaBlob(critiquePayload).includes('bestelle jetzt'), 'diagnoseCtaBlob prüft nur newHook/optimized/rebuilt');
check(GENERALIZED_OCCASION_PATTERNS.length >= 6 && FORCED_CTA_PATTERNS.length >= 6, `Musterlisten vorhanden (${GENERALIZED_OCCASION_PATTERNS.length} Anlass-/${FORCED_CTA_PATTERNS.length} CTA-Muster)`);

// ── TEIL B.3 — Engine-Verhalten mit Mock-LLM ─────────────────────────────────
await scenario('E1 Live-Befund im 1. Versuch → 1 Korrekturversuch, 2. Versuch sauber → Ergebnis', async () => {
  currentResponder = (attempt) => (attempt === 1 ? deDefectPayload() : deCleanPayload());
  const res = (await generateTikTok(diagInput(), 'de')) as TikTokDiagnoseResult;
  check(res.mode === 'diagnose', 'Ergebnis wird ausgeliefert (kein harter Fehler nach der Korrektur)');
  check(attemptCounter === 2, 'genau 1 Korrekturversuch (2 Engine-Calls)');
  check(lastPrompt().includes('INHALTSREGELN'), 'Retry-Prompt enthält den gezielten Inhaltsregel-Hinweis');
  check(lastPrompt().includes('für jeden Anlass'), 'Retry-Hinweis benennt das verbotene Anlass-Muster');
  check(diagnoseOccasionViolations(res, inventedGroundingBlob(diagInput({ topic: 'Geschenk' }))).length === 0, 'ausgeliefertes Ergebnis ist anlass-frei');
  check(diagnoseCtaViolations(res).length === 0, 'ausgeliefertes Ergebnis hat keinen erzwungenen CTA');
  check(res.rebuilt?.cta === 'Was würdest du auf deine Kerze gravieren lassen?', 'ausgelieferter CTA ist der natürliche aus Versuch 2');
});

await scenario('E2 Live-Befund in JEDEM Versuch → harter Fehler nach genau 1 Korrekturversuch (fail closed)', async () => {
  currentResponder = () => deDefectPayload();
  let thrown: string | null = null;
  try {
    await generateTikTok(diagInput(), 'de');
  } catch (e) {
    thrown = (e as Error).message;
  }
  check(thrown !== null, 'Engine wirft einen Fehler statt ein regelwidriges Ergebnis auszugeben');
  check((thrown ?? '').includes('erfundene Anlass-/Zielgruppen-Behauptung'), `Fehlermeldung benennt die Ursache („${thrown ?? ''}")`);
  check((thrown ?? '').includes('Handlungsaufruf'), 'Fehlermeldung benennt auch den erzwungenen CTA');
  check(attemptCounter === 2, 'genau 2 Calls = 1 Diagnose + 1 Korrekturversuch (kein Endlos-Retry)');
});

await scenario('E3 EN: „The perfect gift for every occasion." + „Order now!" → ebenfalls abgelehnt', async () => {
  currentResponder = () => enDefectPayload();
  let thrown: string | null = null;
  try {
    await generateTikTok(diagInput({ videoTopic: TOPIC_EN }), 'en');
  } catch (e) {
    thrown = (e as Error).message;
  }
  check(thrown !== null && thrown.includes('invented occasion/audience claim'), `EN-Meldung benennt den Grund („${thrown ?? ''}")`);
  check(attemptCounter === 2, 'EN: ebenfalls genau 1 Korrekturversuch');
});

await scenario('E4 sauberes Ergebnis → 1 Call, KEINE Korrektur (Regression/kein Fehlalarm)', async () => {
  currentResponder = () => deCleanPayload();
  const res = (await generateTikTok(diagInput(), 'de')) as TikTokDiagnoseResult;
  check(res.mode === 'diagnose' && res.rebuilt !== undefined, 'Diagnose wird direkt ausgeliefert');
  check(attemptCounter === 1, 'genau 1 Engine-Call (keine Korrektur nötig)');
});

await scenario('E5 erfundener Einzel-Anlass („Weihnachtsgeschenk") ohne Nutzerangabe → Korrektur', async () => {
  const holiday = JSON.stringify(JSON.parse(deDefectPayload({
    rebuilt: {
      hook: 'Weihnachtsduft für dein Zuhause',
      timedScenes: [{ time: '0-2s', scene: 'Kerze', text: 'Weihnachtsduft' }],
      voiceover: 'Das perfekte Weihnachtsgeschenk für deine Liebsten.',
      cta: 'Was riechst du am liebsten?',
      seconds: 18,
    },
  })));
  currentResponder = (attempt) => (attempt === 1 ? holiday : deCleanPayload());
  const res = (await generateTikTok(diagInput(), 'de')) as TikTokDiagnoseResult;
  check(attemptCounter === 2, '1 Korrekturversuch wegen erfundenem Anlass');
  check(diagnoseOccasionViolations(res, inventedGroundingBlob(diagInput({ topic: 'Geschenk' }))).length === 0, 'nach der Korrektur kein erfundener Anlass mehr im Ergebnis');
});

server.stop(true);

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n=== fix-block4-de-tiktok-test: ${passed} PASS, ${failed} FAIL ===`);
console.log(`i18n de=${deKeys.length} en=${enKeys.length}`);
if (failed > 0) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}
process.exit(0);
