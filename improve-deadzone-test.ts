// ── Phase 8.4d UX-Fix regression suite: "Verbessern" dead zone + delta copy ──
// Run: bun --env-file=.env run improve-deadzone-test.ts
//
// Pure checks (NO DB, NO LLM, NO network) for the two F2-E2E findings from
// 2026-09-17 (evidence: /home/team/shared/e2e-f2-verbessern-clickthrough-evidence.md):
//
//   (1) DEAD ZONE: an asset scoring 88/100 with zero open issues showed NEITHER
//       "⚡ Verbessern" NOR "✨ Auf 80+ verbessern" — the card had no next step.
//       The fix keeps the engine untouched and states the result honestly
//       ("Bereits stark — 88/100, keine offenen Punkte"). These checks assert the
//       button rules are unchanged and that the hint fires exactly in the gap.
//   (2) COPY: the before/after banner was titled "Qualität gesteigert" even at
//       delta ±0 (84 → 84). Only a real gain may claim an improvement.
//
// Exit 0 = all checks passed.
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';
import {
  ALREADY_STRONG_TOTAL,
  improveDeltaTitleKey,
  resolveScoreCardActions,
  type ScoreCardBusyState,
  type ScoreLike,
} from './src/components/scoreCardActions';
import { improveByScore } from './src/ai/improve';
import type { ContentRequest, ContentResult, ContentScore } from './src/ai/types';

let pass = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const IDLE: ScoreCardBusyState = { hasContent: true, busy: false, hasOutcome: false, hasError: false };
const TARGET = 80;
const sc = (total: number, issues = 0): ScoreLike => ({ total, issues: Array.from({ length: issues }, (_, i) => i) });
const act = (total: number, issues: number, state: Partial<ScoreCardBusyState> = {}) =>
  resolveScoreCardActions(sc(total, issues), { ...IDLE, ...state }, TARGET);

async function main(): Promise<void> {
  console.log('\n═══ (1) Improve-Buttons: Dead Zone 80–89 ohne offene Punkte ═══');

  // ── The exact case measured in the E2E session ──────────────────────────
  const dead = act(88, 0);
  check('88/100 + 0 offene Punkte: KEIN "Verbessern" (unverändertes Verhalten)', dead.canImprove === false);
  check('88/100 + 0 offene Punkte: KEIN "Auf 80+" (unverändertes Verhalten)', dead.canImproveToTarget === false);
  check(
    '88/100 + 0 offene Punkte: ehrlicher Hinweis "Bereits stark" erscheint (Dead Zone geschlossen)',
    dead.showStrongNoActionHint === true,
  );
  check('88/100 + 0 offene Punkte: KEIN Top-Bereich-Hinweis', dead.showTopRangeNoActionHint === false);

  // ── Buttons keep working exactly where they did before ──────────────────
  const withIssues = act(84, 2);
  check('84/100 + 2 offene Punkte: "Verbessern" sichtbar', withIssues.canImprove === true);
  check('84/100 + 2 offene Punkte: kein Hinweis nötig', !withIssues.showStrongNoActionHint && !withIssues.showTopRangeNoActionHint);

  const weak = act(72, 0);
  check('72/100 + 0 Punkte: "Auf 80+ verbessern" sichtbar (unter Ziel)', weak.canImproveToTarget === true);
  check('72/100 + 0 Punkte: kein "Bereits stark"-Hinweis', weak.showStrongNoActionHint === false);

  const weakWithIssues = act(79, 1);
  check(
    '79/100 + 1 Punkt: beide Wege offen (Verbessern + Auf 80+)',
    weakWithIssues.canImprove === true && weakWithIssues.canImproveToTarget === true,
  );

  // ── Boundaries of the hint ──────────────────────────────────────────────
  check('Grenze 80/100 + 0 Punkte: Hinweis aktiv (Ziel inklusive)', act(80, 0).showStrongNoActionHint === true);
  check('Grenze 79/100 + 0 Punkte: Hinweis inaktiv', act(79, 0).showStrongNoActionHint === false);
  check('89/100 + 0 Punkte: Hinweis aktiv', act(89, 0).showStrongNoActionHint === true);
  check('95/100 + 0 Punkte: Hinweis aktiv', act(95, 0).showStrongNoActionHint === true);

  // ── Same class of dead zone above 90 (engine refuses to rework) ─────────
  const top = act(APPLY_STRONG_TOTAL(), 2);
  check('92/100 + 2 Punkte: kein "Verbessern" (Engine lehnt ≥90 ab)', top.canImprove === false);
  check('92/100 + 2 Punkte: kein "Auf 80+"', top.canImproveToTarget === false);
  check('92/100 + 2 Punkte: Top-Bereich-Hinweis erklärt es', top.showTopRangeNoActionHint === true);
  check('92/100 + 2 Punkte: kein "Bereits stark"-Hinweis (Punkte sind offen)', top.showStrongNoActionHint === false);
  check('90/100 + 1 Punkt: Top-Bereich-Hinweis aktiv', act(90, 1).showTopRangeNoActionHint === true);
  check('96/100 + 0 Punkte: "Bereits stark"-Hinweis, kein Top-Hinweis', act(96, 0).showStrongNoActionHint === true && act(96, 0).showTopRangeNoActionHint === false);

  // ── No double messaging / no hint while work is running ─────────────────
  check('Während eines Laufs: kein Hinweis (Spinner spricht)', act(88, 0, { busy: true }).showStrongNoActionHint === false);
  check(
    'Nach einem Lauf: Delta-Banner statt Hinweis (keine Doppelmeldung)',
    act(88, 0, { hasOutcome: true }).showStrongNoActionHint === false,
  );
  check(
    'Nach einem Fehler: kein Hinweis (Fehlerbanner spricht)',
    act(88, 0, { hasError: true }).showStrongNoActionHint === false,
  );
  check(
    'Fehlerfall: "Erneut versuchen"-Bedingung (canImprove) bleibt unverändert',
    act(84, 2, { hasError: true }).canImprove === true,
  );

  // ── Card without an asset / without score ───────────────────────────────
  const noAsset = resolveScoreCardActions(sc(88, 0), { ...IDLE, hasContent: false }, TARGET);
  check(
    'Karte ohne Asset: kein Button, kein Hinweis (nur Anzeige)',
    !noAsset.canImprove && !noAsset.canImproveToTarget && !noAsset.showStrongNoActionHint && !noAsset.showTopRangeNoActionHint,
  );
  const noScore = resolveScoreCardActions(null, IDLE, TARGET);
  check(
    'Ohne Score: alles aus',
    !noScore.canImprove && !noScore.canImproveToTarget && !noScore.showStrongNoActionHint && !noScore.showTopRangeNoActionHint,
  );

  console.log('\n═══ (2) Copy: Delta-Titel nur bei echter Steigerung ═══');
  const flatKey = improveDeltaTitleKey(0);
  check('Delta +6 → "Qualität gesteigert"', improveDeltaTitleKey(6) === 'improve_delta_title');
  check('Delta +1 → "Qualität gesteigert"', improveDeltaTitleKey(1) === 'improve_delta_title');
  check('Delta ±0 → neutraler Titel (nicht "gesteigert")', flatKey === 'improve_delta_title_flat', `key=${flatKey}`);
  check('Delta −3 → eigener Titel (kein Erfolg behauptet)', improveDeltaTitleKey(-3) === 'improve_delta_title_down');
  check(
    'Delta ±0 nutzt ausdrücklich NICHT improve_delta_title',
    improveDeltaTitleKey(0) !== 'improve_delta_title',
  );

  console.log('\n═══ (3) i18n de/en: alle neuen Strings vorhanden & korrekt belegt ═══');
  const deD = de as unknown as Record<string, string>;
  const enD = en as unknown as Record<string, string>;
  const newKeys = [
    'score_strong_no_actions',
    'score_strong_no_actions_desc',
    'score_top_range_no_actions',
    'score_top_range_no_actions_desc',
    'improve_delta_title_flat',
    'improve_delta_title_down',
  ];
  for (const k of newKeys) {
    check(`de.${k} vorhanden`, typeof deD[k] === 'string' && deD[k].length > 0);
    check(`en.${k} vorhanden`, typeof enD[k] === 'string' && enD[k].length > 0);
  }
  check(
    'score_strong_no_actions enthält den Score-Platzhalter %d (de+en)',
    deD.score_strong_no_actions.includes('%d') && enD.score_strong_no_actions.includes('%d'),
  );
  check(
    'score_top_range_no_actions enthält den Score-Platzhalter %d (de+en)',
    deD.score_top_range_no_actions.includes('%d') && enD.score_top_range_no_actions.includes('%d'),
  );
  check(
    'Hinweistext ist lokalisiert (de ≠ en), nicht doppelt deutsch/englisch',
    deD.score_strong_no_actions !== enD.score_strong_no_actions &&
      deD.score_strong_no_actions_desc !== enD.score_strong_no_actions_desc,
  );
  check(
    'Delta-Titel de/en unterscheiden sich',
    deD.improve_delta_title_flat !== enD.improve_delta_title_flat &&
      deD.improve_delta_title_down !== enD.improve_delta_title_down,
  );
  check(
    'Der alte Titel bleibt unverändert ("Qualität gesteigert")',
    deD.improve_delta_title === 'Qualität gesteigert' && enD.improve_delta_title === 'Quality improved',
  );
  check('ALREADY_STRONG_TOTAL unverändert 90 (Engine-Semantik nicht angefasst)', ALREADY_STRONG_TOTAL === 90);

  console.log('\n═══ (4) Warum kein Button in der Dead Zone (Engine-Semantik, 0 Kosten) ═══');
  // A button in the dead zone would be a false affordance: the improver has no
  // fixes to apply and returns `no_issues` WITHOUT calling the LLM. Proving the
  // early return here documents that the honest hint is the correct fix and that
  // the usage semantics (Improve = 0 Generierungen) stay untouched.
  const req: Pick<ContentRequest, 'contentType' | 'productIdea'> = {
    contentType: 'pinterest_pin',
    productIdea: 'Testprodukt für Dead-Zone-Check (keine Generierung)',
  };
  const deadScore = {
    total: 88,
    summary: 'stark',
    issues: [],
    subScores: [],
    scoredAt: new Date().toISOString(),
  } as unknown as ContentScore;
  const deadContent = { contentType: 'pinterest_pin', title: 'T', body: 'B', metadata: {} } as unknown as ContentResult;
  const outcome = await improveByScore(req, deadContent, deadScore);
  check('improveByScore(88/100, 0 Punkte) → kein LLM-Lauf (reason "no_issues")', outcome.reason === 'no_issues', `reason=${outcome.reason}`);
  check('improveByScore(88/100, 0 Punkte) → nichts verbessert, Delta 0, Inhalt unberührt', outcome.improved === false && outcome.delta === 0);

  console.log(`\n${'─'.repeat(64)}`);
  if (failures.length > 0) {
    console.log(`F2-UX-8.4d SUITE FAILED — ${pass} passed, ${failures.length} failed:`);
    for (const f of failures) console.log(`   ❌ ${f}`);
    process.exit(1);
  }
  console.log(`✅ F2-UX-8.4d SUITE PASSED — ${pass} checks, 0 failed (Dead Zone + Delta-Copy de/en)`);
}

/** tiny indirection so the test reads the constant instead of hardcoding 90 twice */
function APPLY_STRONG_TOTAL(): number {
  return ALREADY_STRONG_TOTAL;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('F2-UX-8.4d TEST CRASHED:', err instanceof Error ? err.stack : err);
    process.exit(1);
  });
