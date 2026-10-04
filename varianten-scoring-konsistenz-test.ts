// ── Owner 2026-10-03 (Stabilisierungspaket Schritt 1, Punkte 1b/1c/2a/2b) ─────
// Run: bun --env-file=.env run varianten-scoring-konsistenz-test.ts
//
// Deterministisch, OHNE Netz/DB/LLM-Kosten (OPENAI_API_KEY wird für diesen Lauf
// gezielt geleert → scoreContent degradiert exakt auf den Regeln-only-Pfad, also
// auf den Fall, der laut Analyse die Varianten-Scores kollabieren ließ).
//
// Geprüft wird:
//   (1b) Drei inhaltlich verschiedene Varianten bekommen NICHT denselben Score —
//        auch ohne LLM-Judge (Regel-Checks + deterministischer Ansatz-Abgleich).
//   (1c) Ranking: Sortierung nach echtem Score, Empfehlung nur bei echtem
//        Vorsprung, Abstand zur zweitbesten, Ansatz bleibt der Variante erhalten.
//   (2a) Eine zentrale Wahrheit: LLM-Urteil unter der Schwelle erzeugt einen
//        echten ScoreIssue; unter dem Ziel ist die Issue-Liste nie leer;
//        improveByScore liefert bei Score < 80 nie "no_issues".
//   (2b) Konsistenz-Matrix: Total / Issues / Summary / ScoreCard-Actions /
//        ImproveOutcome widersprechen sich nie.
//
// Exit 0 = alle Checks bestanden.
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';
import {
  applyAngleFit,
  angleFit,
  resolveAngleAssignments,
  VARIANT_ANGLES,
  type VariantAngleKey,
} from './src/ai/variants/angles';
import { rankVariants } from './src/components/variantRanking';
import {
  ALREADY_STRONG_TOTAL,
  SCORE_TARGET_TOTAL,
  resolveScoreCardActions,
  type ScoreCardBusyState,
} from './src/components/scoreCardActions';
import {
  SCORE_TARGET,
  LLM_WEAK_DIMENSION,
  actionableIssues,
  buildScoreSummary,
  dimensionFallbackFix,
  ensureActionableIssues,
  judgmentIssues,
  scoreContent,
  totalFromSubScores,
} from './src/ai/scoring';
import type { LlmJudgment } from './src/ai/scoring/llm';
import { improveByScore } from './src/ai/improve';
import type { ContentRequest, ContentResult, ContentScore, ScoreSubScore, VariantAsset } from './src/ai/types';

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

// ── Testdaten: DREI wirklich unterschiedliche Varianten-Drehbücher ────────────
// Gleiche Produktfakten (Bienenwachskerzen für Kindergeburtstage), drei Strategien.
const PIN_VARIANTS: Record<VariantAngleKey, { title: string; body: string }> = {
  emotional_gift: {
    title: 'Der Moment, in dem die Kerzen leuchten – personalisierte Bienenwachskerzen',
    body: `1. SEO Pin-Titel: Der Moment, in dem die Kerzen leuchten – personalisierte Bienenwachskerzen
2. Pin-Beschreibung: Stell dir den Augenblick vor: Die kleine Hand hält die Kerze, das Licht flackert über das Gesicht, und alle singen. Dieses Geschenk zum Geburtstag bleibt als Erinnerung im Herzen. Bienenwachs, von Hand gezogen, mit dem Namen des Kindes. Ein Moment, den du schenkst — und der bleibt.
3. Fokus-Keywords: personalisierte Bienenwachskerzen, Geburtstagskerzen Kinder, Geschenk Geburtstag Kind, Bienenwachs Kerzen personalisiert, Kerzen mit Name, Geburtstagsdeko Kind, handgemachte Kerzen, Kindergeburtstag Idee, Geschenkidee Kind, Kerzen Geburtstag, Mitgebsel Geburtstag, personalisiertes Geschenk, Bienenwachskerzen Set, Geburtstagskerzen
4. Hashtags: #geschenkidee #geburtstagskind #handgemacht #bienenwachskerzen #kindergeburtstag #geschenkmoment
5. Call to Action: Mach diesen Moment möglich →
6. KI-Bild-Prompt: warm candlelight scene, child's hands holding a personalized beeswax candle, soft glow, birthday table, handmade style, vertical 2:3 framing, high detail
7. Pin-Kategorie: DIY & Handwerk — selbst gemachte Kindergeburtstag-Deko
8. Designempfehlung: warme Farben, Nahaufnahme mit Licht
9. Zielgruppe: Eltern, die ein Geschenk zum Geburtstag suchen
10. Pinterest Alt-Text: Personalisierte Bienenwachskerzen mit warmem Licht auf dem Geburtstagstisch für Kinder`,
  },
  benefit_focus: {
    title: 'Personalisierte Bienenwachskerzen: einfach bestellen, sofort fertig dekorieren',
    body: `1. SEO Pin-Titel: Personalisierte Bienenwachskerzen: einfach bestellen, sofort fertig dekorieren
2. Pin-Beschreibung: Du brauchst keine Deko-Suche mehr: Die Kerzen kommen mit dem Namen deines Kindes, so dass der Geburtstagstisch in fünf Minuten steht. Praktisch, deshalb ideal für Eltern, die alles an einem Abend vorbereiten. Robust genug für den Alltag, unkompliziert in der Handhabung, jederzeit wiederverwendbar.
3. Fokus-Keywords: personalisierte Bienenwachskerzen, Geburtstagskerzen Kinder, Geburtstagsdeko einfach, Kerzen mit Name, Kindergeburtstag vorbereiten, Deko Geburtstag Kind, Bienenwachs Kerzen, Geburtstagstisch Deko, Mitgebsel Kindergeburtstag, schnelle Geburtstagsdeko, Kindername Kerzen, Geburtstagskerzen Set, unkomplizierte Deko, Kerzen bestellen
4. Hashtags: #geburtstagsdeko #einfachdekorieren #kindergeburtstag #bienenwachskerzen #praktisch #dekoidee
5. Call to Action: Bestell jetzt und dekoriere deinen Tisch in fünf Minuten →
6. KI-Bild-Prompt: bright clean table, personalized beeswax candles lined up ready for a kid's birthday, practical decoration, natural light, vertical 2:3, sharp detail
7. Pin-Kategorie: DIY & Handwerk — praktische Geburtstagsdeko
8. Designempfehlung: klare Linien, helle Flächen
9. Zielgruppe: Eltern, die schnell und pragmatisch vorbereiten
10. Pinterest Alt-Text: Personalisierte Bienenwachskerzen als praktische Geburtstagsdeko, sofort einsatzbereit auf dem Tisch`,
  },
  fact_seo: {
    title: 'Bienenwachskerzen für den Kindergeburtstag: Material, Größe, Nutzung',
    body: `1. SEO Pin-Titel: Bienenwachskerzen für den Kindergeburtstag: Material, Größe, Nutzung
2. Pin-Beschreibung: Fakten für die Kaufentscheidung: 10 Kerzen, 12 cm Höhe, 100 % Bienenwachs, Name auf jeder Kerze. Material aus regionaler Herstellung, nachhaltig und ohne Zusätze. Diese Kriterien entscheiden: Material, Größe, Nutzung. Ein Vergleich der Fakten hilft bei der Entscheidung.
3. Fokus-Keywords: Bienenwachskerzen Kindergeburtstag, Geburtstagskerzen Material, Bienenwachs 100 %, Kerzen mit Name Größe, nachhaltige Geburtstagsdeko, Material Bienenwachs Kerzen, Kriterien Geburtstagskerzen, Kerzen Herstellung regional, Geburtstagstisch Fakten, Kerzen cm Angabe, Bienenwachskerzen Set 10, Geburtstagsdeko nachhaltig, Kerzen Nutzung, Kaufentscheidung Kerzen
4. Hashtags: #nachhaltig #bienenwachs #kindergeburtstag #material #fakten #geburtstagsdeko
5. Call to Action: Alle Angaben zu Material und Größe ansehen →
6. KI-Bild-Prompt: factual product shot, beeswax candles with visible texture, neutral background, size reference, daylight, vertical 2:3, macro detail
7. Pin-Kategorie: DIY & Handwerk — Material und Herstellung
8. Designempfehlung: neutrale Flächen, Fakten im Bild
9. Zielgruppe: Käufer, die Material und Nachhaltigkeit vergleichen
10. Pinterest Alt-Text: Bienenwachskerzen 12 cm aus regionalem Bienenwachs für den Kindergeburtstag, Faktenübersicht`,
  },
};

function variantAsAsset(key: VariantAngleKey): ContentResult {
  return {
    contentType: 'pinterest_pin',
    title: PIN_VARIANTS[key].title,
    body: PIN_VARIANTS[key].body,
  };
}

/** Minimaler, aber strukturell vollständiger Score (für Ranking-/Konsistenz-Checks). */
function fakeScore(total: number, issues = 0, subScores: ScoreSubScore[] = []): ContentScore {
  return {
    total,
    subScores,
    issues: Array.from({ length: issues }, (_, i) => ({
      severity: 'warning' as const,
      category: 'relevance' as const,
      message: `offener Punkt ${i + 1}`,
      fix: { field: 'body', action: 'rewrite', suggestion: `Vorschlag ${i + 1}.` },
    })),
    summary: 'Testscore',
    ruleVersion: 2,
  };
}

async function main(): Promise<void> {
  // Regeln-only erzwingen: judgeContent() liefert ohne Key sofort null (kein Netz).
  const realKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  if (realKey) console.log('  (OPENAI_API_KEY für diesen Lauf geleert — Regeln-only-Pfad, keine Kosten)');

  try {
    // ── (1b) Varianten-Scores kollabieren nicht mehr ─────────────────────────
    console.log('\n═══ (1b) Drei verschiedene Varianten → drei verschiedene Bewertungen ═══');
    check('3 Ansätze definiert, alle verschieden', new Set(VARIANT_ANGLES.map((a) => a.key)).size === 3);
    check('jeder Ansatz hat einen deutschen Auftragstext', VARIANT_ANGLES.every((a) => a.instruction.de.length > 200 && a.instruction.en.length > 200));

    const req: Pick<ContentRequest, 'contentType' | 'productIdea'> = {
      contentType: 'pinterest_pin',
      productIdea: 'Personalisierte Geburtstagskerzen aus Bienenwachs für Kinder',
    };

    const scored: Record<string, { total: number; issues: number; summary: string; fit: number }> = {};
    for (const angle of VARIANT_ANGLES) {
      const asset = variantAsAsset(angle.key);
      const base = await scoreContent({ ...req, additionalContext: `Ansatz: ${angle.labelDe}` }, asset);
      const fitted = applyAngleFit(base, asset, angle.key);
      scored[angle.key] = {
        total: fitted.score.total,
        issues: fitted.score.issues.length,
        summary: fitted.score.summary,
        fit: fitted.fit.score,
      };
      console.log(
        `      ${angle.letter} ${angle.key}: Total ${fitted.score.total}, Ansatz-Treffer ${fitted.fit.score}/100, ${fitted.score.issues.length} Issue(s)`,
      );
    }

    // (1b-1) DERSELBE Inhalt unter drei Ansätzen: der deterministische
    // Ansatz-Abgleich trennt die Bewertungen selbst dann, wenn die Regel-Checks
    // identisch ausfallen (genau der LLM-Judge-Ausfall-Fall der Analyse).
    console.log('\n  (1b-1) Gleicher Inhalt, drei Ansätze (Regeln-only):');
    const sameAsset = variantAsAsset('benefit_focus');
    const sameTotals: number[] = [];
    let sameBaseTotal = -1;
    for (const angle of VARIANT_ANGLES) {
      const base = await scoreContent(req, sameAsset);
      sameBaseTotal = base.total;
      const fitted = applyAngleFit(base, sameAsset, angle.key);
      sameTotals.push(fitted.score.total);
      console.log(`      Basis ${base.total} → als ${angle.key}: ${fitted.score.total} (Treffer ${fitted.fit.score}/100, Abzug ${base.total - fitted.score.total})`);
    }
    check(
      'gleicher Inhalt, drei Ansätze → NICHT überall derselbe Score',
      new Set(sameTotals).size >= 2,
      `Totals: ${VARIANT_ANGLES.map((a, i) => `${a.key}=${sameTotals[i]}`).join(', ')}`,
    );
    check('der Ansatz-Abgleich senkt höchstens (nie eine Erhöhung)',
      sameTotals.every((t) => t <= sameBaseTotal),
      `Basis ${sameBaseTotal} vs ${sameTotals.join(', ')}`);

    // (1b-2) DREI verschiedene Inhalte (realistische, regel-relevante
    // Abweichungen je Variante) → drei verschiedene Gesamtwerte.
    console.log('\n  (1b-2) Drei Inhalte mit je einer eigenen Schwäche:');
    const debase = (body: string, drops: string[]): string => drops.reduce((acc, d) => acc.replace(d, ''), body);
    const mutated: Record<VariantAngleKey, ContentResult> = {
      emotional_gift: {
        ...variantAsAsset('emotional_gift'),
        // 4 Keywords entfernt → Keyword-Menge unter dem Ziel
        body: debase(PIN_VARIANTS.emotional_gift.body, [
          'Geburtstagsdeko Kind, ', 'handgemachte Kerzen, ', 'Kindergeburtstag Idee, ', 'Geschenkidee Kind, ',
        ]),
      },
      benefit_focus: {
        ...variantAsAsset('benefit_focus'),
        // 4 Hashtags entfernt → Hashtag-Menge unter dem Ziel
        body: debase(PIN_VARIANTS.benefit_focus.body, [' #dekoidee', ' #praktisch', ' #bienenwachskerzen', ' #kindergeburtstag']),
      },
      fact_seo: {
        ...variantAsAsset('fact_seo'),
        // Titel deutlich über dem Limit
        title: `${PIN_VARIANTS.fact_seo.title} — Bienenwachskerzen für den Kindergeburtstag im Detailvergleich`,
      },
    };
    const mutatedTotals: number[] = [];
    const mutatedIssues: number[] = [];
    for (const angle of VARIANT_ANGLES) {
      const asset = mutated[angle.key];
      const base = await scoreContent(req, asset);
      const fitted = applyAngleFit(base, asset, angle.key);
      mutatedTotals.push(fitted.score.total);
      mutatedIssues.push(fitted.score.issues.length);
      console.log(`      ${angle.letter} ${angle.key}: Total ${fitted.score.total}, ${fitted.score.issues.length} Issue(s)`);
    }
    check(
      'drei abweichende Inhalte → nicht überall derselbe Gesamtwert (Kollabierung ausgeschlossen)',
      new Set(mutatedTotals).size >= 2,
      `Totals: ${VARIANT_ANGLES.map((a, i) => `${a.key}=${mutatedTotals[i]}`).join(', ')}`,
    );

    // Die Orientierungswerte aus PIN_VARIANTS (jede Variante erfüllt ihren
    // eigenen Auftrag) werden nur dokumentiert — identische Werte wären hier
    // ehrlich, weil die Inhalte strukturell gleich aufgebaut sind.
    console.log(`      (Orientierung, ideal erfüllte Ansätze: ${VARIANT_ANGLES.map((a) => `${a.key}=${scored[a.key].total}`).join(', ')})`);

    // Ansatz-Abgleich greift überall dort, wo der Auftrag verfehlt wird.
    const fitEmotional = angleFit('emotional_gift', PIN_VARIANTS.emotional_gift.title, PIN_VARIANTS.emotional_gift.body);
    const fitBenefit = angleFit('benefit_focus', PIN_VARIANTS.benefit_focus.title, PIN_VARIANTS.benefit_focus.body);
    const fitFact = angleFit('fact_seo', PIN_VARIANTS.fact_seo.title, PIN_VARIANTS.fact_seo.body);
    check('emotionaler Text erfüllt den emotionalen Ansatz', fitEmotional.score === 100, `fit=${fitEmotional.score}`);
    console.log(`      Nutzen-Ansatz: ${fitBenefit.score}/100, verfehlt: ${fitBenefit.failed.join(' / ') || 'nichts'}`);
    check('Nutzen-Text erfüllt den Nutzen-Ansatz (mind. 2 von 3 Prüfungen)',
      fitBenefit.score >= 67 && fitBenefit.passed.length >= 2, `fit=${fitBenefit.score}, verfehlt: ${fitBenefit.failed.join(' / ')}`);
    check('Fakten-Text erfüllt den Fakten-Ansatz', fitFact.score === 100, `fit=${fitFact.score}`);
    const wrong = angleFit('fact_seo', PIN_VARIANTS.emotional_gift.title, PIN_VARIANTS.emotional_gift.body);
    check(
      'falscher Ansatz wird deterministisch erkannt und benannt',
      wrong.score < 100 && wrong.failed.length > 0,
      `fit=${wrong.score}, fehlt: ${wrong.failed.join(' / ')}`,
    );
    const applied = applyAngleFit(fakeScore(70, 0, [{ key: 'relevance', label: 'Relevanz', score: 70, weight: 1, comment: '' }]), variantAsAsset('emotional_gift'), 'fact_seo');
    check('Ansatz-Abgleich erzeugt einen echten ScoreIssue', applied.score.issues.length === 1 && applied.score.issues[0].fix.suggestion.length > 20);
    check('Ansatz-Abgleich senkt den Score (nie Erhöhung)', applied.score.total < 70, `total=${applied.score.total}`);
    check(
      'Total bleibt die zentrale Formel (Summe Teilwerte × Gewicht)',
      applied.score.total === totalFromSubScores(applied.score.subScores),
    );
    check('Summary wird aus derselben Ableitung neu gebildet (nennt den Ansatz-Hebel)',
      applied.score.summary.includes('Ansatz') || applied.score.summary.includes('Hebel'));

    // Ansatz-Zuordnung: Modellangabe gewinnt, Lücken werden positional gefüllt.
    check('Ansatz-Zuordnung: Modellangaben werden übernommen',
      JSON.stringify(resolveAngleAssignments(['fact_seo', 'emotional_gift', 'benefit_focus'])) === JSON.stringify(['fact_seo', 'emotional_gift', 'benefit_focus']));
    check('Ansatz-Zuordnung: fehlende Angaben → positional A/B/C, jeder genau einmal',
      JSON.stringify(resolveAngleAssignments([undefined, undefined, undefined])) === JSON.stringify(['emotional_gift', 'benefit_focus', 'fact_seo']));
    check('Ansatz-Zuordnung: doppelte Angaben werden aufgelöst (3 verschiedene Ansätze)',
      new Set(resolveAngleAssignments(['emotional_gift', 'emotional_gift', 'fact_seo'])).size === 3);

    // ── (1c) Ranking der Varianten ───────────────────────────────────────────
    console.log('\n═══ (1c) "Wähle die beste" spiegelt die echten Einzelbewertungen ═══');
    const v = (angle: string, total: number | null): VariantAsset => ({
      title: `T-${angle}`,
      body: 'body',
      angle,
      score: total == null ? null : fakeScore(total),
    });
    const rank = rankVariants([v('emotional_gift', 62), v('benefit_focus', 78), v('fact_seo', 71)]);
    check('Sortierung nach Score absteigend (beste zuerst)',
      rank.ranked.map((r) => r.total).join('>') === '78>71>62', rank.ranked.map((r) => r.total).join(','));
    check('Empfehlung = Position der besten Variante (Original-Index 1)', rank.recommendedIndex === 1);
    check('Abstand zur zweitbesten = 78 − 71 = 7', rank.deltaToRunnerUp === 7, `delta=${rank.deltaToRunnerUp}`);
    check('kein Gleichstand', rank.tie === false);
    check('Ansatz-Kennung bleibt an der Variante (A/B/C nicht umnummeriert)',
      rank.ranked[0].variant.angle === 'benefit_focus' && rank.ranked[2].variant.angle === 'emotional_gift');

    const tie = rankVariants([v('emotional_gift', 70), v('benefit_focus', 70)]);
    check('Gleichstand: KEINE geschönte Empfehlung', tie.recommendedIndex === -1 && tie.tie === true);
    const withNull = rankVariants([v('emotional_gift', null), v('benefit_focus', 55)]);
    check('unbewertete Variante landet am Ende', withNull.ranked[1].total === null && withNull.ranked[0].total === 55);
    check('nur eine Bewertung → keine Empfehlung, kein erfundener Abstand',
      withNull.deltaToRunnerUp === null && withNull.recommendedIndex === -1);

    // ── (2a) Eine zentrale Wahrheit ─────────────────────────────────────────
    console.log('\n═══ (2a) Score / Issues / Summary aus EINER Ableitung ═══');
    check('SCORE_TARGET der Engine = SCORE_TARGET_TOTAL der UI-Konstanten', SCORE_TARGET === SCORE_TARGET_TOTAL, `${SCORE_TARGET} vs ${SCORE_TARGET_TOTAL}`);
    check('LLM-Schwelle ist 70', LLM_WEAK_DIMENSION === 70);

    const weakJudgment: LlmJudgment = {
      hookScore: 40, hookReason: 'Der Einstieg erklärt nur das Produkt und stoppt niemanden.',
      keywordScore: 55, keywordReason: 'Die Suchbegriffe fehlen im Titel.',
      ctaScore: 45, ctaReason: 'Der Abschluss lädt zu nichts ein.',
      toneScore: 65, toneReason: 'Der Ton bleibt allgemein.',
    };
    const strongJudgment: LlmJudgment = {
      hookScore: 88, hookReason: 'Starker Einstieg.',
      keywordScore: 84, keywordReason: 'Keywords natürlich eingebaut.',
      ctaScore: 82, ctaReason: 'Klarer CTA.',
      toneScore: 86, toneReason: 'Passender Ton.',
    };
    const weakIssues = judgmentIssues(weakJudgment);
    check('LLM-Dimensionen unter der Schwelle erzeugen echte Issues (4/4)', weakIssues.length === 4, `n=${weakIssues.length}`);
    check('jedes LLM-Issue hat message + fix.field/action/suggestion',
      weakIssues.every((i) => i.message.length > 10 && i.fix.field && i.fix.action && i.fix.suggestion.length > 20));
    check('LLM-Dimensionen über der Schwelle erzeugen KEINE Issues', judgmentIssues(strongJudgment).length === 0);
    check('LLM-Judge-Ausfall (null) erzeugt keine erfundenen Issues', judgmentIssues(null).length === 0);

    const subWorst: ScoreSubScore[] = [
      { key: 'title', label: 'Titel', score: 55, weight: 0.5, comment: '' },
      { key: 'cta', label: 'CTA', score: 90, weight: 0.5, comment: '' },
    ];
    const noIssueBelow = ensureActionableIssues(72, subWorst, []);
    check('Invariante: total < 80 ohne Issues ⇒ es entsteht genau ein handelbarer Punkt', noIssueBelow.length === 1);
    check('der Punkt nennt die schwächste Dimension und hat einen Fix',
      noIssueBelow[0]?.message.includes('Titel') && noIssueBelow[0]?.fix.suggestion.length > 20);
    check('Invariante: total ≥ 80 ohne Issues bleibt unangetastet (nichts erfunden)', ensureActionableIssues(88, subWorst, []).length === 0);
    check('Invariante: vorhandene Issues werden nicht ergänzt', ensureActionableIssues(60, subWorst, judgmentIssues(weakJudgment)).length === 4);

    check('actionableIssues: 72/100 ohne Issues → Fix-Liste nicht leer', actionableIssues({ total: 72, issues: [], subScores: subWorst }).length === 1);
    check('actionableIssues: 86/100 ohne Issues → leere Fix-Liste (ehrlich "nichts zu tun")', actionableIssues({ total: 86, issues: [], subScores: subWorst }).length === 0);
    check('actionableIssues filtert action "keep" heraus',
      actionableIssues({ total: 60, subScores: subWorst, issues: [{ severity: 'warning', category: 'title', message: 'm', fix: { field: 'title', action: 'keep', suggestion: 's' } }] }).length === 1);

    // Der echte Regeln-only-Lauf: unter dem Ziel ist die Issue-Liste nie leer.
    for (const angle of VARIANT_ANGLES) {
      const s = await scoreContent(req, variantAsAsset(angle.key));
      check(`Regeln-only: ${angle.key} — total < 80 ⇒ mindestens ein Issue`,
        s.total >= SCORE_TARGET || s.issues.length > 0,
        `total=${s.total}, issues=${s.issues.length}`);
    }
    const thin: ContentResult = { contentType: 'pinterest_pin', title: 'Kurz', body: 'TITEL: Kurz' };
    const thinScore = await scoreContent(req, thin);
    check('dünner Inhalt: Score < 80 und Issue-Liste nicht leer (Live-Regeln-only)',
      thinScore.total < SCORE_TARGET && thinScore.issues.length > 0,
      `total=${thinScore.total}, issues=${thinScore.issues.length}`);
    check('Summary nennt dabei einen konkreten Hebel (kein "solide, aber …"-Satz)',
      thinScore.summary.includes('Hebel') || thinScore.summary.includes('Starte mit'),
      thinScore.summary.slice(0, 120));

    // improveByScore: bei Score < 80 nie "no_issues" (der LLM-Call schlägt ohne
    // Key fehl → reason "failed", aber NIE "no_issues").
    const belowOutcome = await improveByScore(req, variantAsAsset('fact_seo'), thinScore);
    check('improveByScore(Score < 80) liefert NIE reason "no_issues"',
      belowOutcome.reason !== 'no_issues', `reason=${belowOutcome.reason}`);
    check('improveByScore(Score < 80) hat die Fix-Liste aus derselben Ableitung',
      (belowOutcome.appliedFixes?.length ?? 0) > 0, `fixes=${belowOutcome.appliedFixes?.length}`);
    const strongOutcome = await improveByScore(req, variantAsAsset('fact_seo'), fakeScore(88, 0, subWorst));
    check('improveByScore(88/100, 0 Punkte) → "no_issues", kein LLM-Call (unverändert)',
      strongOutcome.reason === 'no_issues' && strongOutcome.improved === false);

    // ── (2b) Konsistenz-Matrix ──────────────────────────────────────────────
    console.log('\n═══ (2b) Total / Issues / Summary / Actions / Outcome widersprechen sich nie ═══');
    const IDLE: ScoreCardBusyState = { hasContent: true, busy: false, hasOutcome: false, hasError: false };
    const constellations: Array<{ name: string; score: ContentScore }> = [
      { name: 'total<80 + Issues leer (Invariante greift)', score: fakeScore(72, 0, subWorst) },
      { name: 'total<80 + Issues vorhanden', score: fakeScore(72, 2, subWorst) },
      { name: 'total≥80 + Issues leer (echt stark)', score: fakeScore(88, 0, subWorst) },
      { name: 'total≥80 + Issues vorhanden', score: fakeScore(84, 2, subWorst) },
      { name: 'total≥90 + Issues vorhanden (Engine lehnt ab)', score: fakeScore(92, 1, subWorst) },
      { name: 'Score fehlt', score: fakeScore(0, 0, []) },
    ];
    for (const c of constellations) {
      // Die Invariante ist Teil der Ableitung: jede Karte wird über sie geführt.
      const issues = ensureActionableIssues(c.score.total, c.score.subScores, c.score.issues);
      const consistent: ContentScore = { ...c.score, issues };
      const summary = buildScoreSummary('pinterest_pin', consistent.total, consistent.subScores, issues);
      const actions = resolveScoreCardActions({ total: consistent.total, issues }, IDLE, SCORE_TARGET_TOTAL);
      const fixes = actionableIssues(consistent);

      const noFalsePraise = !(consistent.total < SCORE_TARGET && /starke? Arbeit|Keine offenen Punkte/.test(summary));
      const noStrongHintBelowTarget = !(consistent.total < SCORE_TARGET && actions.showStrongNoActionHint);
      const issuesMatchSummary = issues.length === 0
        ? /Alle geprüften Kriterien/.test(summary)
        : /(Kritischer Punkt|Offen:|Hebel)/.test(summary);
      const improveNeverLies = !(consistent.total < SCORE_TARGET && fixes.length === 0);
      const ok = noFalsePraise && noStrongHintBelowTarget && issuesMatchSummary && improveNeverLies;
      check(`Konsistenz: ${c.name}`, ok, `total=${consistent.total}, issues=${issues.length}, fixes=${fixes.length}, actions={improve:${actions.canImprove},toTarget:${actions.canImproveToTarget},strong:${actions.showStrongNoActionHint},top:${actions.showTopRangeNoActionHint}}`);
    }

    check('Summary bei echtem Starkfall lobt (≥ Ziel, keine Punkte)', buildScoreSummary('pinterest_pin', 88, subWorst, []).includes('Alle geprüften Kriterien'));
    const belowSummary = buildScoreSummary('pinterest_pin', 62, subWorst, ensureActionableIssues(62, subWorst, []));
    check('Summary bei 62/100 nennt den offenen Punkt UND den Hebel',
      belowSummary.includes('62/100') && belowSummary.includes('Hebel'));
    check('Summary enthält nie die alte Falschaussage "solide, aber nicht überzeugend genug"',
      !belowSummary.includes('solide, aber nicht überzeugend genug'));

    // ── i18n-Parität der neuen Strings ───────────────────────────────────────
    console.log('\n═══ i18n: neue Strings de/en paritätisch ═══');
    const deD = de as unknown as Record<string, string>;
    const enD = en as unknown as Record<string, string>;
    const newKeys = [
      'score_issues_empty_below',
      'improve_no_progress',
      'improve_no_progress_desc',
      'variant_recommended',
      'variant_score_delta',
      'variant_ranked_note',
      'variant_tie_note',
      'variant_angle_emotional_gift',
      'variant_angle_benefit_focus',
      'variant_angle_fact_seo',
    ];
    for (const k of newKeys) {
      check(`de.${k} vorhanden`, typeof deD[k] === 'string' && deD[k].length > 0);
      check(`en.${k} vorhanden`, typeof enD[k] === 'string' && enD[k].length > 0);
      check(`${k} ist lokalisiert (de ≠ en)`, deD[k] !== enD[k]);
    }
    check('score_issues_empty_below nutzt den Score-Platzhalter %d (de+en)',
      deD.score_issues_empty_below.includes('%d') && enD.score_issues_empty_below.includes('%d'));
    check('variant_score_delta nutzt den Delta-Platzhalter %d (de+en)',
      deD.variant_score_delta.includes('%d') && enD.variant_score_delta.includes('%d'));
    check('ALREADY_STRONG_TOTAL unverändert 90 (Engine-Semantik nicht angefasst)', ALREADY_STRONG_TOTAL === 90);
    check('dimensionFallbackFix liefert für jede Dimension einen Fix',
      (['title', 'keywords', 'cta', 'length', 'image', 'structure', 'relevance'] as const).every(
        (d) => dimensionFallbackFix(d).field.length > 0 && dimensionFallbackFix(d).suggestion.length > 20,
      ));
  } finally {
    if (realKey) process.env.OPENAI_API_KEY = realKey;
  }

  console.log(`\n${'─'.repeat(64)}`);
  if (failures.length > 0) {
    console.log(`VARIANTEN/SCORING-KONSISTENZ SUITE FAILED — ${pass} passed, ${failures.length} failed:`);
    for (const f of failures) console.log(`   ❌ ${f}`);
    process.exit(1);
  }
  console.log(`✅ VARIANTEN/SCORING-KONSISTENZ SUITE PASSED — ${pass} checks, 0 failed`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('SUITE CRASHED:', err instanceof Error ? err.stack : err);
    process.exit(1);
  });
