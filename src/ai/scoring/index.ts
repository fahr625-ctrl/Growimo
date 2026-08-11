// ── F1 Qualitäts-Score: combine deterministic rules + LLM judgment ────────────
// scoreContent() is the public entry point. It is called server-side right
// after generation and NEVER throws: the deterministic rules always produce a
// score; the LLM judgment pass is optional and its absence only shifts the
// weights toward the rules. If even the rules cannot run for an unsupported
// content type, the caller still gets a valid structure via scoreContentSafe.

import type { ContentResult, ContentRequest, ContentScore, ScoreDimension, ScoreSubScore } from '../types';
import { dimensionLabel, ruleDimensionScores, runRules } from './rules';
import { judgeContent, type LlmJudgment } from './llm';

export const RULE_VERSION = 1;

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

function buildSummary(
  contentType: ContentResult['contentType'],
  subScores: ScoreSubScore[],
  issues: ContentScore['issues'],
  productIdea: string,
): string {
  const label =
    contentType === 'pinterest_pin' ? 'Pin'
    : contentType === 'etsy_listing' ? 'Etsy-Listing'
    : contentType === 'seo_blog' ? 'Blogartikel'
    : contentType === 'social_post' ? 'Social-Media-Beitrag'
    : contentType === 'email_newsletter' ? 'Newsletter'
    : 'Inhalt';
  const total = Math.round(subScores.reduce((sum, s) => sum + s.score * s.weight, 0));

  const sorted = [...subScores].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const criticals = issues.filter((i) => i.severity === 'critical');

  if (criticals.length > 0) {
    const first = criticals[0].fix.suggestion.split('.')[0];
    return `Dein ${label} erreicht ${total}/100. Stärke: ${best.label} (${best.score}/100). Kritischer Punkt: ${criticals[0].message} Starte mit: ${first}.`;
  }
  if (issues.length > 0) {
    const weakLine = issues.length === 1
      ? `${worst.label} (${worst.score}/100) ist die größte Schwäche`
      : `${worst.label} (${worst.score}/100) und ${issues.length - 1} weitere Punkte bieten Luft nach oben`;
    return `Dein ${label} erreicht ${total}/100. ${best.label} überzeugt (${best.score}/100), aber ${weakLine}. Die größte Stellschraube: ${issues[0].fix.suggestion}`;
  }
  if (total >= 80) {
    return `Starker ${label}: ${total}/100. Alle geprüften Kriterien sind erfüllt — ${best.label} glänzt mit ${best.score}/100. Bereit für den nächsten Schritt.`;
  }
  return `Dein ${label} erreicht ${total}/100 — solide, aber nicht überzeugend genug. Konzentriere dich auf ${worst.label} (${worst.score}/100), um den Score deutlich zu steigern.`;
}

/**
 * Score one generated asset: deterministic rules (always) + one LLM judgment
 * pass (optional). Never throws — on any error the rules-only score is returned
 * and the issue list carries a single warning.
 */
export async function scoreContent(
  request: Pick<ContentRequest, 'contentType' | 'productIdea'>,
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
  const total = clamp100(subScores.reduce((sum, s) => sum + s.score * s.weight, 0));
  const summary = buildSummary(result.contentType, subScores, rules.issues, request.productIdea);

  return {
    total,
    subScores,
    issues: rules.issues,
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
