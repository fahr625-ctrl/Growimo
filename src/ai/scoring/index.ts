// ── F1 Qualitäts-Score: combine deterministic rules + LLM judgment ────────────
// scoreContent() is the public entry point. It is called server-side right
// after generation and NEVER throws: the deterministic rules always produce a
// score; the LLM judgment pass is optional and its absence only shifts the
// weights toward the rules. If even the rules cannot run for an unsupported
// content type, the caller still gets a valid structure via scoreContentSafe.

import type {
  ContentResult,
  ContentRequest,
  ContentScore,
  ScoreDimension,
  ScoreIssue,
  ScoreIssueFix,
  ScoreSubScore,
} from '../types';
import { dimensionLabel, ruleDimensionScores, runRules } from './rules';
import { judgeContent, type LlmJudgment } from './llm';
import { sanitizeFactText } from '../fact-guard';

export const RULE_VERSION = 2;

/**
 * Owner-Auftrag 2026-10-03 (Schritt 1, Punkt 2) — EINE zentrale Wahrheit:
 * Score, Teilwerte, Kritikpunkte, Verbesserungsvorschläge und Abschlussmeldung
 * werden aus derselben Ableitung gebildet (Issue-Liste + Teilwerte). Alle
 * Schwellen stehen genau hier, damit UI (ScoreCard/scoreCardActions) und
 * Engine (improve) nicht auseinanderlaufen können.
 */

/** Ziel-Score: darunter trägt jedes Asset mindestens einen handelbaren Punkt. */
export const SCORE_TARGET = 80;

/** LLM-Urteil unter dieser Marke = echte Schwäche → eigener ScoreIssue. */
export const LLM_WEAK_DIMENSION = 70;

// ── Dimension weights per content type (sums to 1) ────────────────────────────

type DimWeights = Partial<Record<ScoreDimension, number>>;

const DIMENSION_WEIGHTS: Partial<Record<ContentResult['contentType'], DimWeights>> = {
  pinterest_pin: { title: 0.22, keywords: 0.22, cta: 0.16, length: 0.14, image: 0.16, relevance: 0.1 },
  etsy_listing: { title: 0.2, keywords: 0.2, cta: 0.15, length: 0.15, structure: 0.2, relevance: 0.1 },
  seo_blog: { title: 0.16, keywords: 0.22, cta: 0.12, length: 0.22, structure: 0.18, relevance: 0.1 },
  social_post: { title: 0.24, keywords: 0.18, cta: 0.2, length: 0.18, relevance: 0.2 },
  email_newsletter: { title: 0.24, keywords: 0.12, cta: 0.22, length: 0.22, structure: 0.12, relevance: 0.1 },
};

/** Which LLM judgment score feeds which dimension. */
const LLM_TO_DIMENSION: Array<{ dim: ScoreDimension; score: (j: LlmJudgment) => number; reason: (j: LlmJudgment) => string }> = [
  { dim: 'title', score: (j) => j.hookScore, reason: (j) => j.hookReason },
  { dim: 'keywords', score: (j) => j.keywordScore, reason: (j) => j.keywordReason },
  { dim: 'cta', score: (j) => j.ctaScore, reason: (j) => j.ctaReason },
  { dim: 'relevance', score: (j) => j.toneScore, reason: (j) => j.toneReason },
];

/** Weight of the LLM judgment within a dimension that has both signals. */
const LLM_WEIGHT = 0.4;

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * DIE zentrale Fix-Ableitung je Dimension (2a). Genau eine Quelle für
 * „Was ist der konkrete Hebel?" — benutzt von den LLM-Urteils-Issues, von der
 * Invariante „Score < 80 ⇒ mindestens ein handelbarer Punkt" und (via
 * actionableIssues) von der Verbesserungsschleife (improve.ts).
 * Alle Vorschläge sind faktenfrei formuliert (keine erfundenen Produktangaben);
 * der Fakten-Schutz läuft zusätzlich über factSafeIssues().
 */
const DIMENSION_FIX: Record<ScoreDimension, ScoreIssueFix> = {
  title: {
    field: 'title',
    action: 'rewrite',
    suggestion:
      'Schreibe den Titel neu: stärkster Suchbegriff oder konkreter Nutzen aus deiner Produktidee am Anfang, keine Füllwörter, unter dem Zeichenlimit des Kanals.',
  },
  keywords: {
    field: 'keywords',
    action: 'insert_keyword',
    suggestion:
      'Baue die wichtigsten Suchbegriffe deiner Produktidee natürlich in den Fließtext ein und ergänze passende Longtail-Varianten statt Wiederholungen.',
  },
  cta: {
    field: 'cta',
    action: 'rewrite',
    suggestion:
      'Formuliere einen klaren, kanaltypischen Call-to-Action: genau eine Handlung plus Grund — ohne erfundene Lieferzeit-, Preis- oder Trendversprechen.',
  },
  length: {
    field: 'body',
    action: 'expand',
    suggestion:
      'Bringe den Text auf die kanaltypische Länge: konkrete Details aus deiner Produktidee statt Allgemeinplätze, Zielumfang laut Kanalvorgabe einhalten.',
  },
  image: {
    field: 'imagePrompt',
    action: 'add',
    suggestion:
      'Ergänze Motiv, Farbe, Material und Nutzungskontext (Bild-Prompt bzw. Alt-Text) ausschließlich mit Angaben aus deiner Produktidee.',
  },
  structure: {
    field: 'body',
    action: 'add',
    suggestion:
      'Bringe die Abschnitte in die kanaltypische Reihenfolge und fülle fehlende Abschnitte mit Inhalten aus deiner Produktidee.',
  },
  relevance: {
    field: 'body',
    action: 'rewrite',
    suggestion:
      'Schärfe den Text auf Zielgruppe und Anlass deiner Produktidee: weniger Allgemeinplätze, mehr Bezug zum konkreten Produkt und zur konkreten Situation.',
  },
};

/** Der konkrete Hebel einer Dimension (eine Quelle, s. o.). */
export function dimensionFallbackFix(dim: ScoreDimension): ScoreIssueFix {
  return { ...DIMENSION_FIX[dim] };
}

/** Gewichteter Gesamtwert aus den Teilwerten — die einzige Total-Formel. */
export function totalFromSubScores(subScores: ScoreSubScore[]): number {
  return clamp100(subScores.reduce((sum, s) => sum + s.score * s.weight, 0));
}

/** Schwächster Teilwert (stabil: erster bei Gleichstand). */
function weakestSubScore(subScores: ScoreSubScore[]): ScoreSubScore | null {
  if (!subScores || subScores.length === 0) return null;
  return subScores.reduce((worst, cur) => (cur.score < worst.score ? cur : worst), subScores[0]);
}

/**
 * Der eine handelbare Punkt, den ein Asset unterhalb des Ziels IMMER hat.
 * Wird von der Invariante in scoreContent() und von actionableIssues() genutzt,
 * damit „Score < 80 ohne offenen Punkt" strukturell unmöglich ist — auch dann,
 * wenn ein (Alt-)Score gar keine Teilwerte mitbringt.
 */
function weakestDimensionIssue(total: number, subScores: ScoreSubScore[]): ScoreIssue {
  const weakest = weakestSubScore(subScores);
  if (weakest) {
    return {
      severity: 'warning',
      category: weakest.key,
      message: `Der Inhalt erreicht ${total}/100, ohne dass ein einzelner Check eindeutig anschlägt — ${weakest.label} ist mit ${weakest.score}/100 die schwächste Dimension.`,
      fix: dimensionFallbackFix(weakest.key),
    };
  }
  return {
    severity: 'warning',
    category: 'relevance',
    message: `Der Inhalt erreicht ${total}/100, ohne dass ein einzelner Check eindeutig anschlägt — der Text braucht insgesamt mehr Substanz.`,
    fix: dimensionFallbackFix('relevance'),
  };
}

function buildSubScores(
  contentType: ContentResult['contentType'],
  ruleScores: Record<ScoreDimension, { score: number; passed: number; total: number }>,
  llm: LlmJudgment | null,
): ScoreSubScore[] {
  const weights = DIMENSION_WEIGHTS[contentType] ?? { title: 0.5, relevance: 0.5 };
  const dims = Object.keys(weights) as ScoreDimension[];

  return dims.map((dim) => {
    const weight = weights[dim] ?? 0;
    const rule = ruleScores[dim];
    const llmEntry = LLM_TO_DIMENSION.find((e) => e.dim === dim);

    let score: number;
    let comment: string;

    if (llm && llmEntry) {
      const llmScore = llmEntry.score(llm);
      if (rule && rule.total > 0) {
        score = clamp100(rule.score * (1 - LLM_WEIGHT) + llmScore * LLM_WEIGHT);
      } else {
        score = clamp100(llmScore);
      }
      comment = llmEntry.reason(llm);
      if (rule && rule.total > 0 && rule.passed < rule.total) {
        comment += ` (${rule.passed}/${rule.total} Regeln bestanden)`;
      }
    } else if (rule && rule.total > 0) {
      score = clamp100(rule.score);
      comment = `${rule.passed} von ${rule.total} Checks bestanden`;
    } else {
      score = 60;
      comment = 'Keine prüfbaren Kriterien für diese Dimension';
    }

    return { key: dim, label: dimensionLabel(dim), score, weight, comment };
  });
}

function channelLabel(contentType: ContentResult['contentType']): string {
  return contentType === 'pinterest_pin' ? 'Pin'
    : contentType === 'etsy_listing' ? 'Etsy-Listing'
    : contentType === 'seo_blog' ? 'Blogartikel'
    : contentType === 'social_post' ? 'Social-Media-Beitrag'
    : contentType === 'email_newsletter' ? 'Newsletter'
    : 'Inhalt';
}

/**
 * 2b-Eigenschaft (getestet): Es gibt keinen Satz, der „starke Arbeit / keine
 * offenen Punkte" behauptet, während Punkte offen sind — und umgekehrt.
 *
 * Aufbau:
 *  - issues.length === 0  ⇒ nur bei total >= SCORE_TARGET wird gelobt (Invariante
 *    ensureActionableIssues garantiert, dass darunter immer ein Issue existiert).
 *  - issues.length > 0    ⇒ der Satz nennt IMMER den ersten offenen Punkt und
 *    dessen konkreten Hebel aus derselben Ableitung (Issue.fix.suggestion);
 *    „Stärke" wird nur behauptet, wenn die beste Dimension das auch hergibt
 *    (>= 70/100), sonst heißt es ehrlich, dass noch nichts überzeugt.
 */
export function buildScoreSummary(
  contentType: ContentResult['contentType'],
  total: number,
  subScores: ScoreSubScore[],
  issues: ContentScore['issues'],
): string {
  const label = channelLabel(contentType);
  const sorted = [...subScores].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const bestLine =
    best == null
      ? ''
      : best.score >= 70
        ? `Stärke: ${best.label} (${best.score}/100). `
        : `Noch überzeugt keine Dimension (beste: ${best.label} ${best.score}/100). `;

  if (issues.length === 0) {
    // Only reachable at/above the target — see the invariant in scoreContent().
    return `Starker ${label}: ${total}/100. Alle geprüften Kriterien sind erfüllt${best ? ` — ${best.label} glänzt mit ${best.score}/100` : ''}. Bereit für den nächsten Schritt.`;
  }

  const criticals = issues.filter((i) => i.severity === 'critical');
  const leadIssue = criticals[0] ?? issues[0];
  const lever = leadIssue.fix.suggestion.split('.')[0];

  if (criticals.length > 0) {
    return `Dein ${label} erreicht ${total}/100. ${bestLine}Kritischer Punkt: ${criticals[0].message} Starte mit: ${lever}.`;
  }
  const weakLine = !worst
    ? `${issues.length} offene Punkte`
    : issues.length === 1
      ? `${worst.label} (${worst.score}/100) ist die größte Schwäche`
      : `${worst.label} (${worst.score}/100) und ${issues.length - 1} weitere Punkte bieten Luft nach oben`;
  return `Dein ${label} erreicht ${total}/100. ${bestLine}Offen: ${weakLine}. Der konkrete Hebel: ${lever}.`;
}

/**
 * 2a: LLM-Urteils-Dimensionen unter LLM_WEAK_DIMENSION erzeugen einen echten
 * ScoreIssue (message + fix.field/action/suggestion) — analog zu den
 * Regel-Issues. Damit ist „Schwäche ohne offenen Punkt" strukturell unmöglich,
 * und „Auf 80+ verbessern" bekommt bei Score < 80 immer eine Fix-Liste.
 */
export function judgmentIssues(llm: LlmJudgment | null): ScoreIssue[] {
  if (!llm) return [];
  return LLM_TO_DIMENSION.flatMap((entry) => {
    const score = entry.score(llm);
    if (score >= LLM_WEAK_DIMENSION) return [];
    const reason = entry.reason(llm);
    return [{
      severity: (score < 50 ? 'critical' : 'warning') as ScoreIssue['severity'],
      category: entry.dim,
      message: `${dimensionLabel(entry.dim)} wirkt noch schwach (${score}/100): ${reason}`,
      fix: dimensionFallbackFix(entry.dim),
    }];
  });
}

/** Kritische Punkte zuerst, Reihenfolge sonst stabil. */
function criticalsFirst(issues: ScoreIssue[]): ScoreIssue[] {
  const criticals = issues.filter((i) => i.severity === 'critical');
  const rest = issues.filter((i) => i.severity !== 'critical');
  return [...criticals, ...rest];
}

/**
 * Die Invariante der zentralen Wahrheit: unterhalb des Ziels gibt es IMMER
 * mindestens einen handelbaren Punkt. Ist die Issue-Liste (Regeln + LLM-Urteil)
 * leer, wird der schwächste Teilwert selbst zum Issue — mit Fix aus der einen
 * Ableitung (DIMENSION_FIX).
 */
export function ensureActionableIssues(
  total: number,
  subScores: ScoreSubScore[],
  issues: ScoreIssue[],
): ScoreIssue[] {
  if (issues.length > 0 || total >= SCORE_TARGET) return issues;
  return [weakestDimensionIssue(total, subScores)];
}

/**
 * Das öffentliche „Was muss ich tun?"-Kontrakt eines Scores. Genau diese Liste
 * speist die Verbesserungsschleife (improve.ts) und die UI. Bei Score < 80 ist
 * sie niemals leer — der Grund steht als Issue drin, nicht als Floskel.
 */
export function actionableIssues(
  score: Pick<ContentScore, 'total' | 'issues' | 'subScores'>,
): ScoreIssue[] {
  const usable = score.issues.filter((i) => i.fix.action !== 'keep');
  if (usable.length > 0) return usable;
  if (score.total >= SCORE_TARGET) return [];
  return [weakestDimensionIssue(score.total, score.subScores ?? [])];
}

/**
 * Owner-Entscheid 2026-10-01 (Teil 2) — FAKTEN-SCHUTZ für Hinweis-Texte.
 * Verbesserungshinweise (Score-Issues) sind der Pfad, über den der Fremd-Slug
 * „/trauerkarten-gestalten-persoenlich" sichtbar wurde: Jeder Hinweistext läuft
 * deshalb durch den deterministischen Fakten-Check (ai/fact-guard.ts). Sätze mit
 * erfundenen Fakten (Lieferzeit, Preis, Trend, fremder Slug/Link …) werden
 * entfernt; bleibt nichts übrig, steht ein neutraler, faktenfreier Hinweis.
 */
const FACT_SAFE_HINT_FALLBACK =
  'Formuliere diesen Punkt ausschließlich mit Angaben aus deiner Produktidee bzw. deinem Markenprofil (keine erfundenen Fakten wie Lieferzeit, Preis, Trend oder fremde Beispiel-Links).';

function sanitizeHintText(text: string, grounding: string): string {
  if (typeof text !== 'string' || text.trim() === '') return text;
  const cleaned = sanitizeFactText(text, grounding).trim();
  return cleaned === '' ? FACT_SAFE_HINT_FALLBACK : cleaned;
}

/** Hinweis-Pfad des Fakten-Schutzes (Meldung + Fix-Vorschlag). */
function factSafeIssues(issues: ContentScore['issues'], grounding: string): ContentScore['issues'] {
  return issues.map((issue) => ({
    ...issue,
    message: sanitizeHintText(issue.message, grounding),
    fix: { ...issue.fix, suggestion: sanitizeHintText(issue.fix.suggestion, grounding) },
  }));
}

/**
 * Score one generated asset: deterministic rules (always) + one LLM judgment
 * pass (optional). Never throws — on any error the rules-only score is returned.
 * Die Issue-Liste ist die zentrale Wahrheit: Regel-Fehler + LLM-Urteile unter
 * LLM_WEAK_DIMENSION; unterhalb von SCORE_TARGET ist sie nie leer.
 */
export async function scoreContent(
  request: Pick<ContentRequest, 'contentType' | 'productIdea'> & { additionalContext?: string },
  result: ContentResult,
): Promise<ContentScore> {
  let rules;
  try {
    rules = runRules(result);
  } catch (err) {
    console.error('[scoring] rules failed:', err);
    rules = { outcomes: [], issues: [] };
  }

  // LLM judgment — non-blocking: failure degrades to rules-only scoring.
  let llm: LlmJudgment | null = null;
  try {
    llm = await judgeContent(request.contentType, request.productIdea, result.body);
  } catch (err) {
    console.error('[scoring] LLM judgment failed (using rules only):', err);
    llm = null;
  }

  const ruleScores = ruleDimensionScores(rules.outcomes);
  const subScores = buildSubScores(result.contentType, ruleScores, llm);
  const total = totalFromSubScores(subScores);
  // 2a: Regeln + LLM-Urteil ergeben EINE Issue-Liste; darunter die Invariante
  // „Score < 80 ⇒ mindestens ein handelbarer Punkt".
  const merged = criticalsFirst([...rules.issues, ...judgmentIssues(llm)]);
  // Fakten-Schutz der Hinweise: Grounding = Nutzerangaben (Idee + Zusatzkontext).
  const grounding = [request.productIdea ?? '', request.additionalContext ?? ''].filter(Boolean).join('\n');
  const issues = factSafeIssues(ensureActionableIssues(total, subScores, merged), grounding);
  const summary = buildScoreSummary(result.contentType, total, subScores, issues);

  return {
    total,
    subScores,
    issues,
    summary,
    ruleVersion: RULE_VERSION,
  };
}

/**
 * Synchronous-safe wrapper for callers that must never throw (returns null on
 * unsupported content types that have no rule set and no weight config).
 */
export function scoreConfigFor(contentType: ContentResult['contentType']): { weights: DimWeights } | null {
  const weights = DIMENSION_WEIGHTS[contentType];
  return weights ? { weights } : null;
}
