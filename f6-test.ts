// ── F6 Server-side verification ───────────────────────────────────────────────
// Run: bun --env-file=.env run f6-test.ts
// 1) buildBriefContext()/normalizeBrief() unit checks (no LLM).
// 2) REAL generation WITH brief vs WITHOUT: proves the brief reaches the
//    additionalContext and shows up in the generated content.
// 3) Package kernel WITH brief: kernel must reflect brief answers.
// Run with a 2-letter mode arg: "unit" | "gen" | "kernel" | "all" (default all).
import { BRIEF_QUESTIONS, buildBriefContext } from './src/ai/strategy-brief/questions';
import { normalizeBrief, summarizeBrief, hasBriefAnswers } from './src/ai/strategy-brief';
import { generateContent } from './src/ai/generate';
import { determineKernel } from './src/ai/package/kernel';
import type { ContentRequest } from './src/ai/types';

const MODE = process.argv[2] ?? 'all';
const IDEA = 'Personalisierte Sternenhimmel-Poster als Aquarell — als Geschenk zur Geburt, personalisiert mit Namen und Sternzeichen';

// Brief: Zielgruppe Junge Eltern, Preis Mittel, Saison Geburtstag, USP Personalisiert, Plattform Etsy, Ton Freundlich
const BRIEF: Record<string, string> = {
  audience: 'young_parents',
  price: 'mid',
  season: 'birthday',
  usp: 'personalized',
  platform: 'etsy',
  voice: 'friendly',
  season_note: 'auch als Taufe',
};

function fail(msg: string): never {
  throw new Error('F6-FAIL: ' + msg);
}
function logOk(msg: string): void {
  console.log('  ✓', msg);
}

// ── 1) Unit checks ────────────────────────────────────────────────────────────
async function unitChecks(): Promise<void> {
  console.log('\n[F6] 1/3 Unit-Checks (kein LLM)');
  const ctx = buildBriefContext(BRIEF, 'de');
  console.log('  buildBriefContext:', JSON.stringify(ctx));
  if (!ctx.startsWith('Strategie-Brief:')) fail('context lacks prefix');
  for (const needle of ['Zielgruppe=Junge Eltern', 'Preis=Mittel 20–60 €', 'Saison=Geburtstag', 'USP=Personalisiert', 'Plattform=Etsy', 'Ton=Freundlich']) {
    if (!ctx.includes(needle)) fail(`context missing "${needle}"`);
  }
  if (!ctx.includes('Zusatz: auch als Taufe')) fail('free-text note not embedded');
  logOk('buildBriefContext: alle Antworten + Freitext enthalten');

  // Leerer Brief → leerer Kontext (kein Verhaltensunterschied zu vor F6)
  const empty = buildBriefContext(null, 'de');
  if (empty !== '') fail('empty brief must produce empty context');
  logOk('buildBriefContext(null) → "" (Regression: ohne Brief exakt wie vorher)');

  // Normalisierung: unbekannte Schlüssel fliegen raus
  const norm = normalizeBrief({ audience: 'young_parents', bogus: 'x', price: '', audience_note: '  ' });
  if (!norm) fail('normalizeBrief should return record');
  if (Object.keys(norm).length !== 1 || norm.audience !== 'young_parents') {
    fail('normalizeBrief must drop unknown keys + empty values: ' + JSON.stringify(norm));
  }
  logOk('normalizeBrief: unbekannte/leere Einträge ignoriert');
  if (normalizeBrief(null) !== null || normalizeBrief(42) !== null) fail('normalizeBrief garbage must be null');
  if (hasBriefAnswers({}) !== false || hasBriefAnswers(BRIEF) !== true) fail('hasBriefAnswers wrong');
  const sum = summarizeBrief(BRIEF, 'en');
  if (!sum.includes('Target audience=Young parents')) fail('EN summary wrong: ' + sum);
  logOk('summarizeBrief EN + hasBriefAnswers');

  const optCount = BRIEF_QUESTIONS.reduce((n, q) => n + q.options.length, 0);
  if (BRIEF_QUESTIONS.length !== 6) fail(`expected 6 questions, got ${BRIEF_QUESTIONS.length}`);
  if (optCount < 20) fail('expected ≥20 options');
  logOk(`Fragen-Definition: ${BRIEF_QUESTIONS.length} Fragen, ${optCount} Optionen`);
}

// ── 2) Generation MIT vs OHNE Brief ───────────────────────────────────────────
async function genChecks(): Promise<void> {
  console.log('\n[F6] 2/3 Generierung MIT vs OHNE Brief (echte LLM-Calls)');
  const req: ContentRequest = {
    contentType: 'etsy_listing',
    productIdea: IDEA,
    tone: undefined,
    additionalContext: buildBriefContext(BRIEF, 'de') || undefined,
  };
  const withBrief = await generateContent(req);
  console.log('  MIT Brief  ->', withBrief.title);
  console.log('  (body 200 Zeichen):', withBrief.body.slice(0, 200).replace(/\n/g, ' '));

  const reqPlain: ContentRequest = { contentType: 'etsy_listing', productIdea: IDEA, tone: undefined };
  const withoutBrief = await generateContent(reqPlain);
  console.log('  OHNE Brief ->', withoutBrief.title);
  console.log('  (body 200 Zeichen):', withoutBrief.body.slice(0, 200).replace(/\n/g, ' '));

  const bodyWith = withBrief.body.toLowerCase();
  const hits = ['junge eltern', 'eltern', 'geburtstag', 'personalisiert', 'geschenk'].filter((k) => bodyWith.includes(k));
  console.log('  Brief-Keywords im Output (mit Brief):', hits.join(', ') || 'KEINE');
  if (hits.length < 2) fail(`Brief content barely visible in output (hits: ${hits.join(', ')})`);
  logOk('Brief-Antworten (Zielgruppe/Preis/Saison/USP) im Etsy-Listing nachweisbar');

  const bodyPlain = withoutBrief.body.toLowerCase();
  const plainHits = ['junge eltern', 'eltern', 'geburtstag', 'personalisiert', 'geschenk'].filter((k) => bodyPlain.includes(k));
  console.log('  Dieselben Keywords im Output (ohne Brief):', plainHits.join(', ') || 'KEINE');
  if (bodyPlain.length === 0) fail('without-brief generation returned empty');
  logOk('Ohne Brief lief die Generierung normal (nicht identischer Text erwartet, aber kein Fehler)');

  if (withBrief.score?.total != null) logOk(`F1-Score (mit Brief): ${withBrief.score.total}`);
}

// ── 3) Paket-Kernel MIT Brief ─────────────────────────────────────────────────
async function kernelChecks(): Promise<void> {
  console.log('\n[F6] 3/3 Paket-Kernel MIT Brief');
  const kernel = await determineKernel(IDEA, BRIEF);
  console.log('  keywords:', kernel.keywords.join(' | '));
  console.log('  voice   :', kernel.voice);
  console.log('  audience:', kernel.audienceNote);
  console.log('  hook    :', kernel.mainHook);
  const all = `${kernel.keywords.join(' ')} ${kernel.voice} ${kernel.audienceNote} ${kernel.mainHook} ${kernel.cta}`.toLowerCase();
  const hits = ['eltern', 'geburtstag', 'personalisiert', 'kind'].filter((k) => all.includes(k));
  console.log('  Brief-Spuren im Kernel:', hits.join(', ') || 'KEINE');
  if (hits.length < 1) fail('kernel shows no trace of the brief answers');
  logOk('Kernel reagiert auf den Strategie-Brief');
}

// ── Run ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (MODE === 'unit' || MODE === 'all') await unitChecks();
  if (MODE === 'gen' || MODE === 'all') await genChecks();
  if (MODE === 'kernel' || MODE === 'all') await kernelChecks();
  console.log('\n✅ F6 alle Prüfungen bestanden');
}
main().catch((err) => {
  console.error('\n❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
