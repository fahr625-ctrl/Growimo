// ── F2 Automatische Verbesserungsschleife ────────────────────────────────────
// One extra GPT-4o call per click: the original content + the score's
// machine-readable fix instructions (field/action/suggestion) are sent to the
// model with a strict "apply ONLY these fixes, keep everything that scored well
// unchanged, keep the exact same structure" prompt. The improved output is
// parsed with the SAME parser as generation (so the UI + scoring rules keep
// working) and then re-scored with scoreContent().
//
// Cost discipline: this is exactly one additional LLM call (plus the existing
// scoring judgment pass). The prompt lists only the failing fields — strong
// sections are listed as "keep verbatim", not regenerated.
//
// Never blocks: any failure returns the original content with a subtle
// error state instead of throwing.

import type {
  ContentRequest,
  ContentResult,
  ContentScore,
  ContentType,
  ImproveOutcome,
  ScoreIssue,
} from './types';
import { scoreContent } from './scoring';
import { parseResponse } from './providers/openai';

const CHANNEL_LABELS: Record<string, string> = {
  pinterest_pin: 'Pinterest-Pin',
  etsy_listing: 'Etsy-Listing',
  seo_blog: 'SEO-Blogartikel',
  social_post: 'Social-Media-Beitrag',
  email_newsletter: 'E-Mail-Newsletter',
  marketing_plan: 'Marketing-Plan',
  product_idea: 'Produktidee',
};

/** Dimensions at or above this score are treated as "strong — keep verbatim". */
const STRONG_THRESHOLD = 80;

/** A total score at or above this means the asset is already strong. */
const ALREADY_STRONG_TOTAL = 90;

function maxTokensFor(type: ContentType): number {
  return type === 'pinterest_pin' ? 4000
    : type === 'seo_blog' || type === 'etsy_listing' ? 8000
    : 4000;
}

function strongSectionLabels(score: ContentScore | null | undefined): string[] {
  if (!score) return [];
  return score.subScores.filter((s) => s.score >= STRONG_THRESHOLD).map((s) => s.label);
}

function buildPrompt(
  channelLabel: string,
  productIdea: string,
  original: ContentResult,
  fixes: ScoreIssue[],
  unchanged: string[],
): string {
  const fixLines = fixes
    .map(
      (f, i) =>
        `${i + 1}. [${f.category}] (Feld: ${f.fix.field}, Aktion: ${f.fix.action}) — ${f.message}\n   Fix: ${f.fix.suggestion}`,
    )
    .join('\n');

  const keepLines =
    unchanged.length > 0
      ? unchanged.join(', ')
      : 'keine (alle Dimensionen dürfen verbessert werden, wo nötig)';

  return `=== AUFGABE ===
Verbessere den folgenden ${channelLabel} gezielt. Wende AUSSCHLIESSLICH die unten gelisteten Fixes an — nichts anderes. Ändere KEINE Sektion, die nicht in der Fix-Liste steht, und erfinde KEINE neuen Produktdetails, die nicht in der Produktidee stehen.

=== PRODUKTIDEE (Kontext, bitte einhalten) ===
${(productIdea || 'Nicht angegeben — arbeite nur mit dem vorhandenen Inhalt.').slice(0, 800)}

=== AKTUELLER INHALT (Original) ===
${original.body.slice(0, 14000)}

=== ZU BEHEBENDE PUNKTE (NUR diese ändern) ===
${fixLines}

=== UNVERÄNDERT ÜBERNEHMEN (starke Bereiche) ===
${keepLines}

=== AUSGABE-FORMAT (WICHTIG — bitte exakt einhalten) ===
Gib den KOMPLETTEN überarbeiteten Inhalt zurück — mit exakt derselben Struktur, denselben nummerierten Überschriften und derselben Sektions-Reihenfolge wie im Original. Zwei harte Regeln:
1. Übernimm JEDE Sektion, die NICHT in der Fix-Liste steht, WORTWÖRTLICH unverändert — inklusive der Überschriften. Ändere daran nichts, nicht einmal kleine Formulierungen.
2. Die Fixes enthalten exakte Zielwerte (Zeichenzahlen, Mengen, Limits). Erreiche diese Zielwerte EXAKT — weder zu wenig noch zu viel (z. B. „maximal 100 Zeichen" bedeutet: 100 oder weniger, nicht 105; „250–400 Zeichen" bedeutet: in diesem Bereich, nicht darunter und nicht darüber).
Schreibe auf Deutsch. Keine Einleitung, kein Kommentar, kein Markdown-Rahmen — nur der Inhalt selbst.`;
}

/**
 * F2: apply the score's fixes to one asset and re-score it.
 * - issues[] empty or total >= 90 → deliberate "already strong" state, no call.
 * - The improved output is parsed with the generation parser (same structure
 *   contract) and re-scored via scoreContent().
 * - Never throws: on any error the original is returned with error: true.
 */
export async function improveByScore(
  request: Pick<ContentRequest, 'contentType' | 'productIdea'>,
  original: ContentResult,
  score: ContentScore | null | undefined,
): Promise<ImproveOutcome> {
  const unchanged = strongSectionLabels(score);

  const base: ImproveOutcome = {
    improved: false,
    oldScore: score ?? null,
    newScore: score ?? null,
    delta: 0,
    appliedFixes: [],
    unchangedSections: unchanged,
  };

  if (!score) {
    return { ...base, reason: 'no_score' };
  }

  const fixes = score.issues.filter((i) => i.fix.action !== 'keep');
  if (fixes.length === 0) {
    return { ...base, reason: 'no_issues' };
  }
  if (score.total >= ALREADY_STRONG_TOTAL) {
    return { ...base, reason: 'already_strong', appliedFixes: fixes };
  }

  const channelLabel = CHANNEL_LABELS[request.contentType] ?? request.contentType;

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey });

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Du bist Growimos Verbesserungs-Chef. Deine einzige Aufgabe: einen bereits generierten ${channelLabel} punktgenau verbessern, indem du AUSSCHLIESSLICH die gelisteten Schwächen behebst. Alles andere übernimmst du exakt wie im Original. Du antwortest ausschließlich mit dem überarbeiteten Inhalt — keine Einleitung, kein Kommentar.`,
        },
        { role: 'user', content: buildPrompt(channelLabel, request.productIdea, original, fixes, unchanged) },
      ],
      temperature: 0.3,
      max_tokens: maxTokensFor(request.contentType),
    });

    const text = response.choices[0]?.message?.content;
    if (!text || !text.trim()) throw new Error('empty improvement response');

    const parsed = parseResponse(request.contentType, text);
    const improvedResult: ContentResult = { ...parsed, score: null };
    const newScore = await scoreContent(request, improvedResult);
    improvedResult.score = newScore;

    console.log(
      '[improve]',
      request.contentType,
      '→',
      score.total,
      '->',
      newScore.total,
      `(${newScore.total - score.total >= 0 ? '+' : ''}${newScore.total - score.total})`,
    );

    return {
      improved: true,
      improvedContent: improvedResult,
      oldScore: score,
      newScore,
      delta: newScore.total - score.total,
      appliedFixes: fixes,
      unchangedSections: unchanged,
    };
  } catch (err) {
    console.error('[improve] failed — returning original unchanged:', err);
    return { ...base, reason: 'failed', error: true, appliedFixes: fixes };
  }
}

/**
 * F2 "Auf 80+ verbessern": repeatedly apply improveByScore until the total
 * score reaches `target` (default 80) or the score plateaus / a round produces
 * no improvement (or fails). Reuses the EXACT improveByScore engine — no new
 * system — just loops with the current improved asset as the next round's
 * original. Returns a single ImproveOutcome whose before/after spans the whole
 * run (oldScore = starting score, newScore = final score, appliedFixes accumulated).
 * Default target = 80 (weak assets are the ones below it); 0 rounds happen when
 * the asset is already at/above target or has no score.
 */
export const IMPROVE_TARGET_DEFAULT = 80;
export const IMPROVE_MAX_LOOPS = 3;

export async function improveToScore(
  request: Pick<ContentRequest, 'contentType' | 'productIdea'>,
  original: ContentResult,
  score: ContentScore | null | undefined,
  target: number = IMPROVE_TARGET_DEFAULT,
): Promise<ImproveOutcome> {
  const unchanged = strongSectionLabels(score);
  if (!score) {
    return {
      improved: false,
      oldScore: null,
      newScore: null,
      delta: 0,
      appliedFixes: [],
      unchangedSections: unchanged,
      reason: 'no_score',
    };
  }
  // Already at/above target → nothing to do (same UX as "already strong").
  if (score.total >= target) {
    return {
      improved: false,
      oldScore: score,
      newScore: score,
      delta: 0,
      appliedFixes: [],
      unchangedSections: unchanged,
      reason: 'already_strong',
    };
  }

  let current = original;
  let currentScore = score;
  const appliedFixes: ScoreIssue[] = [];
  let improvedEver = false;
  let lastReason: ImproveOutcome['reason'] | undefined;
  // Always keep the BEST round (highest re-scored total) — never let repeated
  // improveByScore rounds drag the result below where we started.
  let best: { result: ContentResult; bestScore: ContentScore } | null = null;
  let bestTotal = score.total;

  for (let i = 0; i < IMPROVE_MAX_LOOPS; i++) {
    const outcome = await improveByScore(request, current, currentScore);
    if (outcome.improved && outcome.improvedContent && outcome.newScore) {
      improvedEver = true;
      if (outcome.appliedFixes) appliedFixes.push(...outcome.appliedFixes);
      current = outcome.improvedContent;
      currentScore = outcome.newScore;
      if (currentScore.total > bestTotal) {
        bestTotal = currentScore.total;
        best = { result: current, bestScore: currentScore };
      }
      if (currentScore.total >= target) break; // reached the goal
      // else keep going one more round with the freshly improved asset
    } else {
      // No progress this round (failed / no_issues / already_strong) → stop.
      if (outcome.reason) lastReason = outcome.reason;
      if (outcome.appliedFixes) appliedFixes.push(...outcome.appliedFixes);
      break;
    }
  }

  // Best round is the one to keep; if the best is still not better than the
  // starting score we keep the original (never return something worse).
  if (!best || best.bestScore.total <= score.total) {
    const reason: ImproveOutcome['reason'] | undefined = !improvedEver
      ? (lastReason ?? 'no_issues')
      : 'no_issues';
    const outcome: ImproveOutcome = {
      improved: false,
      oldScore: score,
      newScore: score,
      delta: 0,
      appliedFixes,
      unchangedSections: unchanged,
      reason,
    };
    if (reason === 'failed') outcome.error = true;
    return outcome;
  }

  console.log(
    '[improveToScore]',
    request.contentType,
    score.total,
    '->',
    best.bestScore.total,
    `(target ${target}, best-möglich: ${best.bestScore.total >= target}, ${appliedFixes.length} fix(es) attempted)`,
  );

  return {
    improved: true,
    improvedContent: best.result,
    oldScore: score,
    newScore: best.bestScore,
    delta: best.bestScore.total - score.total,
    appliedFixes,
    unchangedSections: unchanged,
  };
}
