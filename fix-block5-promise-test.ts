// ─────────────────────────────────────────────────────────────────────────────
// FIX-BLOCK 5 — M4-Produktversprechen präzisieren (2026-10-08)
// ─────────────────────────────────────────────────────────────────────────────
// Hintergrund: Der Launch-Test (launch-test-teil2-2026-10-08.md, Z. 166 + Z. 224,
// Punkt 5) hat belegt, dass der REINE Kachel-/Einzellauf keinen Score 0–100
// liefert — Scores entstehen erst über die Entscheidungs-Ebene (A/B-Varianten /
// „Verbessern", live belegt 76/72/68). Der Owner hat entschieden: NICHT den
// Kachel-Flow erweitern, sondern die BESCHREIBUNG korrigieren.
//
// Diese Suite sichert die Textkorrektur dauerhaft ab:
//   A) Die korrigierten Formulierungen existieren in de UND en (exakt).
//   B) Keine irreführende „jedes Ergebnis/Asset ist gescort"-Behauptung mehr in
//      den Wörterbüchern bzw. in den Landing-/Kachel-Quellen (Grep-basiert).
//   C) Die Texte sind wirklich verdrahtet (Landing-Bullet, Kachel-Hinweis).
//   D) i18n-Parität bleibt gewahrt (de == en, kein Key einseitig).
//
// Läuft OHNE DB, ohne Netz, ohne Build:   bun fix-block5-promise-test.ts
// Exit 0 nur, wenn alle Checks grün sind.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';

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

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const deSrc = src('./src/i18n/de.ts');
const enSrc = src('./src/i18n/en.ts');
const landingSrc = src('./src/components/LandingPage.tsx');
const newProjectSrc = src('./src/routes/app/new-project.tsx');
const tilesSrc = src('./src/ai/strategy-tiles.ts');

const deDict = de as unknown as Record<string, unknown>;
const enDict = en as unknown as Record<string, unknown>;
const deStrings = Object.entries(deDict).filter(([, v]) => typeof v === 'string') as Array<[string, string]>;
const enStrings = Object.entries(enDict).filter(([, v]) => typeof v === 'string') as Array<[string, string]>;

// ── A) Korrigierte Formulierungen (de/en) ────────────────────────────────────
console.log('[A] Korrigierte Formulierungen liegen in beiden Sprachdateien');

// A1 — Landing (Vergleichs-Sektion): Score gehört sichtbar zur A/B-Bewertung.
check(
  deDict.diff_col2_item4 === 'KI-Analyse mit 0–100-Score und konkreten Verbesserungen (über die A/B-Bewertung)',
  `DE diff_col2_item4 präzisiert: „${deDict.diff_col2_item4}"`,
);
check(
  enDict.diff_col2_item4 === 'AI analysis with a 0–100 score and concrete improvements (via the A/B evaluation)',
  `EN diff_col2_item4 präzisiert: „${enDict.diff_col2_item4}"`,
);
check(
  typeof deDict.diff_col2_item6 === 'string' &&
    deDict.diff_col2_item6.includes('A/B-Varianten') &&
    deDict.diff_col2_item6.includes('0–100') &&
    deDict.diff_col2_item6.includes('empfehlen die beste'),
  `DE diff_col2_item6 (neu): „${deDict.diff_col2_item6}"`,
);
check(
  typeof enDict.diff_col2_item6 === 'string' &&
    enDict.diff_col2_item6.includes('A/B variants') &&
    enDict.diff_col2_item6.includes('0–100') &&
    enDict.diff_col2_item6.includes('recommend the best'),
  `EN diff_col2_item6 (neu): „${enDict.diff_col2_item6}"`,
);

// A2 — Kachel-Flow: expliziter Geltungsbereich (Inhalt + Aktionsplan vs. Score).
const scopeDe = String(deDict.strategy_score_scope_note ?? '');
const scopeEn = String(enDict.strategy_score_scope_note ?? '');
check(scopeDe.includes('Kachel-Ergebnis') && scopeDe.includes('Aktionsplan'), 'DE Geltungsbereich nennt Kachel-Ergebnis + Aktionsplan');
check(scopeDe.includes('0–100') && scopeDe.includes('A/B-Varianten'), 'DE Geltungsbereich nennt 0–100-Score + A/B-Varianten');
check(scopeEn.includes('tile result') && scopeEn.includes('action plan'), 'EN Geltungsbereich nennt tile result + action plan');
check(scopeEn.includes('0–100') && scopeEn.includes('A/B variants'), 'EN Geltungsbereich nennt 0–100 score + A/B variants');
check(
  scopeDe.includes('Entscheidungs-Ebene') && scopeEn.includes('decision layer'),
  'beide Sprachen benennen die Quelle des Scores (Entscheidungs-Ebene / decision layer)',
);

// A3 — Paket-Kanäle: kein „jeder Kanal hat einen Score"-Kurzschluss mehr.
const pkgDe = String(deDict.package_channels_subtitle ?? '');
const pkgEn = String(enDict.package_channels_subtitle ?? '');
check(
  pkgDe.includes('Alle Kanäle nutzen denselben Kern') && pkgDe.includes('Entscheidungs-Ebene'),
  `DE package_channels_subtitle präzisiert: „${pkgDe}"`,
);
check(
  pkgEn.includes('All channels use the same core') && pkgEn.includes('decision layer'),
  `EN package_channels_subtitle präzisiert: „${pkgEn}"`,
);
check(
  !/jeder Kanal[^.]*Qualitäts-Score/i.test(pkgDe) && !/every channel[^.]*quality score/i.test(pkgEn),
  'kein unqualifiziertes „jeder Kanal hat einen Qualitäts-Score" mehr',
);

// A4 — alte Formulierungen sind wirklich weg (kein Doppel-Text).
const oldStrings = [
  `diff_col2_item4: 'KI-Analyse und konkrete Empfehlungen'`,
  `diff_col2_item4: 'AI analysis and concrete recommendations'`,
  'mit eigenem F1-Qualitäts-Score und einem Klick',
  'with its own F1 quality score and a one-click',
];
for (const old of oldStrings) {
  check(!deSrc.includes(old) && !enSrc.includes(old), `Altfassung entfernt: „${old.slice(0, 46)}…"`);
}
check(!landingSrc.includes('landing_compare_manual'), 'Landing-Quelle unverändert lesbar (Sanity)');

// ── B) Grep-Beleg: keine irreführende „jedes Ergebnis ist gescort"-Behauptung ─
console.log('\n[B] Keine irreführende Score-Behauptung in Wörterbüchern/Landing/Kachel-Flow');

// Ein Satz darf „jedes/jede/alle/every/each/all" + Score NUR nennen, wenn er den
// Geltungsbereich mitliefert (Kachel / A-B / Entscheidungs-Ebene / tile / decision).
const SCOPE_MARKERS = /kachel|a\/b|entscheidungs|decision|tile/i;
const MISLEADING_DE = /\b(jede[srn]?|jedes|alle[nr]?)\b[^.\n]{0,60}\b(score|gescort|bewertet|bewertung)\b/i;
const MISLEADING_EN = /\b(every|each|all)\b[^.\n]{0,70}\b(score|scored|rated|rating)\b/i;

// Keys, in denen Scores LIVE BELEGT sind (A/B-Varianten 76/72/68, „Verbessern"-Delta,
// ScoreCard eines bereits bewerteten Assets). Dort ist „jede … Score" eine wahre
// Aussage über die Entscheidungs-Ebene, keine Pauschalaussage über jedes Ergebnis.
const SCORED_CONTEXT_KEYS = /^(variant_|improve_|autoimprove_|score_|perf_)/;

function flagsMisleading(value: string, pattern: RegExp): boolean {
  return value
    .split(/(?<=[.!?])\s+/)
    .some((sentence) => pattern.test(sentence) && !SCOPE_MARKERS.test(sentence));
}

function scan(strings: Array<[string, string]>, pattern: RegExp, label: string) {
  const hits = strings.filter(([key, v]) => !SCORED_CONTEXT_KEYS.test(key) && flagsMisleading(v, pattern));
  for (const [key, value] of hits) console.log(`      ⚠ ${key}: ${value.slice(0, 150)}`);
  check(
    hits.length === 0,
    `${label}: 0 Treffer (geprüft: ${strings.filter(([k]) => !SCORED_CONTEXT_KEYS.test(k)).length} Strings)`,
  );
}
scan(deStrings, MISLEADING_DE, 'DE-Wörterbuch ohne „jede(s|r|n) … Score"-Behauptung');
scan(enStrings, MISLEADING_EN, 'EN-Wörterbuch ohne „every/each/all … score"-Behauptung');

// Nicht-Vakuum-Beweis: die VOR der Korrektur ausgelieferte Paket-Formulierung wird
// vom Scanner als Pauschalaussage gemeldet (der Scanner hat also echte Zähne).
check(
  flagsMisleading(
    'Jeder Kanal nutzt denselben Kern — mit eigenem F1-Qualitäts-Score und einem Klick „Verbessern“.',
    MISLEADING_DE,
  ),
  'Nicht-Vakuum: die alte Paket-Formulierung („jeder Kanal … F1-Qualitäts-Score") wird gemeldet',
);
check(
  flagsMisleading(
    'Every channel uses the same core — with its own F1 quality score and a one-click “Improve”.',
    MISLEADING_EN,
  ),
  'Nicht-Vakuum: die alte EN-Paket-Formulierung wird gemeldet',
);

// Die Landing- und Kachel-Quellen dürfen die Pauschalaussage nicht hartkodiert führen.
for (const [file, text] of [
  ['LandingPage.tsx', landingSrc],
  ['new-project.tsx', newProjectSrc],
  ['strategy-tiles.ts', tilesSrc],
] as Array<[string, string]>) {
  const hardcoded = text
    .split('\n')
    .filter((line) => MISLEADING_DE.test(line) || MISLEADING_EN.test(line))
    .filter((line) => !SCOPE_MARKERS.test(line))
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'));
  for (const line of hardcoded) console.log(`      ⚠ ${file}: ${line.trim().slice(0, 150)}`);
  check(hardcoded.length === 0, `${file}: keine hartkodierte Pauschalaussage`);
}

// Gegenprobe (nicht vakuum): der Scanner erkennt die alte Behauptung wirklich.
const probe = 'Jedes Ergebnis wird mit einem Qualitäts-Score von 0–100 bewertet.';
check(
  MISLEADING_DE.test(probe.split(/(?<=[.!?])\s+/)[0]) && !SCOPE_MARKERS.test(probe),
  'Gegenprobe: alte Pauschalaussage würde vom Scanner erkannt',
);
check(
  !MISLEADING_DE.test('Ein einzelnes Kachel-Ergebnis liefert dir Inhalt + Aktionsplan.') ||
    SCOPE_MARKERS.test('Ein einzelnes Kachel-Ergebnis liefert dir Inhalt + Aktionsplan.'),
  'Gegenprobe: zulässige Kachel-Formulierung wird nicht fälschlich gemeldet',
);

// ── C) Verdrahtung: die Texte sind wirklich sichtbar ─────────────────────────
console.log('\n[C] Verdrahtung der korrigierten Texte');
check(landingSrc.includes('t.diff_col2_item6'), 'Landing-Bullet diff_col2_item6 wird gerendert (rightItems)');
check(landingSrc.indexOf('t.diff_col2_item6') > landingSrc.indexOf('t.diff_col2_item5'), 'Bullet steht nach diff_col2_item5 (Reihenfolge stabil)');
check(newProjectSrc.includes('t.strategy_score_scope_note'), 'Kachel-Flow rendert strategy_score_scope_note');
check(newProjectSrc.includes('data-testid="strategy-score-scope-note"'), 'Kachel-Hinweis trägt einen stabilen Testhook');
check(
  newProjectSrc.indexOf('t.strategy_score_scope_note') > newProjectSrc.indexOf('data-strategy-tiles={STRATEGY_TILES_MARKER}'),
  'Kachel-Hinweis steht unterhalb der Kachel-Auswahl',
);
check(
  !newProjectSrc.includes('ScoreCard') && !newProjectSrc.includes('VariantPicker'),
  'keine Funktionsänderung am Score-/A/B-Pfad durch diesen Block (new-project unverändert funktional)',
);

// ── D) i18n-Parität ─────────────────────────────────────────────────────────
console.log('\n[D] i18n-Parität de/en');
const deKeys = Object.keys(de);
const enKeys = Object.keys(en);
check(deKeys.length === enKeys.length, `Parität: de ${deKeys.length} = en ${enKeys.length} Keys`);
check(deKeys.every((k) => k in enDict) && enKeys.every((k) => k in deDict), 'kein Key einseitig (beidseitig geprüft)');
check(deKeys.length >= 1646, `Key-Anzahl ${deKeys.length} ≥ Baseline 1646`);
for (const key of ['diff_col2_item6', 'strategy_score_scope_note', 'diff_col2_item4', 'package_channels_subtitle']) {
  check(key in deDict && key in enDict, `Key ${key} liegt in BEIDEN Sprachdateien`);
}
check(
  Object.keys(deDict).filter((k) => k.startsWith('strategy_score_scope_note')).length === 1 &&
    Object.keys(enDict).filter((k) => k.startsWith('strategy_score_scope_note')).length === 1,
  'strategy_score_scope_note existiert je Sprache genau einmal',
);

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────────');
console.log(`FIX-BLOCK 5 M4-Produktversprechen: ${passed} PASS / ${failed} FAIL`);
if (failed > 0) {
  console.log('Fehlgeschlagen:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
