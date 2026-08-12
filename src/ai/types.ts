export type ContentType =
  | 'pinterest_pin'
  | 'etsy_listing'
  | 'seo_blog'
  | 'social_post'
  | 'email_newsletter'
  | 'marketing_plan'
  | 'product_idea'
  | 'trend_insight'
  | 'marketing_analysis'
  | 'market_intelligence';

export interface ContentRequest {
  contentType: ContentType;
  productIdea: string;
  tone?: string;
  additionalContext?: string;
}

export interface ContentResult {
  contentType: ContentType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  /**
   * F1 Qualitäts-Score (0–100). Set server-side right after generation.
   * `null` means scoring failed — the content itself is still valid.
   * `undefined` means no score was computed (legacy/unsupported flow).
   */
  score?: ContentScore | null;
}

// ── F1 Qualitäts-Score (decision layer) ────────────────────────────────────────

export type ScoreSeverity = 'critical' | 'warning';

/** Dimension keys used in sub-scores. Not every type uses all of them. */
export type ScoreDimension =
  | 'title'
  | 'keywords'
  | 'cta'
  | 'length'
  | 'image'
  | 'structure'
  | 'relevance';

/**
 * Machine-readable fix instruction — the contract for the future auto-improve
 * loop (F2): `field` + `action` tell the machine WHAT to touch, `suggestion`
 * is the concrete German instruction shown to the user.
 */
export interface ScoreIssueFix {
  /** Target field, e.g. 'title' | 'description' | 'tags' | 'cta' | 'metaDescription' | 'imagePrompt' */
  field: string;
  /** Action, e.g. 'shorten' | 'rewrite' | 'add' | 'insert_keyword' | 'remove' */
  action: string;
  /** Concrete, actionable German instruction (human text). */
  suggestion: string;
}

export interface ScoreIssue {
  severity: ScoreSeverity;
  /** Dimension this issue belongs to (title/keywords/cta/length/image/structure/relevance). */
  category: ScoreDimension;
  /** What is wrong (German, human-readable). */
  message: string;
  /** Machine-readable fix contract + German instruction. */
  fix: ScoreIssueFix;
}

export interface ScoreSubScore {
  /** Machine-readable dimension key (title/keywords/cta/length/image/structure/relevance). */
  key: ScoreDimension;
  /** German label, e.g. 'Titel' (UI may re-label via i18n). */
  label: string;
  /** 0–100 */
  score: number;
  /** Share of the total score (0–1). Sum of all weights = 1. */
  weight: number;
  /** One-line German reason for this dimension score. */
  comment: string;
}

export interface ContentScore {
  /** Overall quality score 0–100. */
  total: number;
  subScores: ScoreSubScore[];
  issues: ScoreIssue[];
  /** 1–2 sentence German explanation — the "Warum 62?". */
  summary: string;
  /** Rules version so the scoring can evolve without breaking clients. */
  ruleVersion: number;
}

// ── F2 Automatische Verbesserungsschleife (decision layer) ────────────────────

/**
 * Result of the one-click auto-improve loop. `improved === true` means a
 * regenerated version was produced and re-scored; `false` means Growimo
 * deliberately did nothing (asset already strong / no issues / scoring missing
 * / the improvement call failed — distinguished by `reason`).
 */
export interface ImproveOutcome {
  /** true when a regenerated, re-scored version was produced. */
  improved: boolean;
  /** Machine-readable reason when improved === false. */
  reason?: 'already_strong' | 'no_issues' | 'no_score' | 'failed';
  /** The regenerated content with its fresh score (improved === true). */
  improvedContent?: ContentResult;
  /** Score of the original asset. */
  oldScore: ContentScore | null;
  /** Freshly computed score of the improved content. */
  newScore: ContentScore | null;
  /** newScore.total - oldScore.total (can be negative in rare regressions). */
  delta: number;
  /** The issues/fixes that were handed to the model as instructions. */
  appliedFixes: ScoreIssue[];
  /** German labels of the dimensions that scored well and were kept unchanged. */
  unchangedSections: string[];
  /** true when the improvement call failed — content returned unchanged. */
  error?: boolean;
}

// ── F2.1 Bereichsgenaue Auto-Verbesserung (decision layer) ────────────────────

/**
 * Result of ONE "✨ Automatisch verbessern" click (F2.1). Unlike F2 (whole
 * asset), F2.1 regenerates ONLY the affected field/section: the model's output
 * is parsed with the generation parser, the target field value is determinis-
 * tically SPLICED back into the original (all other model deviations are
 * discarded), and the spliced asset is re-scored with the F1 pipeline.
 */
export interface AutoImproveSectionOutcome {
  /** The field that was improved ('title' | 'description' | …). */
  field: string;
  /** Value of the field BEFORE the improvement (from the original asset). */
  oldValue: string;
  /** Value of the field AFTER the improvement (from the model, spliced in). */
  newValue: string;
  /** Score of the original asset (passed F1 score, or freshly computed). */
  oldScore: ContentScore | null;
  /** Freshly computed score of the spliced asset (F1 pipeline). */
  newScore: ContentScore | null;
  /** true when a re-generated, re-scored version was produced. */
  improved: boolean;
  /** Machine-readable reason when improved === false. */
  reason?:
    | 'unsupported' // field/contentType combo not supported yet
    | 'not_found' // target field could not be located in the asset
    | 'unchanged' // the model produced the identical value
    | 'failed' // the improvement call failed — original untouched
    | 'no_score'; // scoring unavailable
  /** The spliced asset with its fresh score — parent persists via onImproved. */
  improvedContent?: ContentResult;
  /** true when the LLM call failed — original returned untouched. */
  error?: boolean;
}

// ── F3 Veröffentlichungs-Priorisierung (decision layer) ───────────────────────

/** Machine-readable tags that explain WHY a channel ranks where it does. */
export type PriorityTag =
  | 'fast-feedback'
  | 'low-effort'
  | 'visual'
  | 'discovery'
  | 'direct-sales'
  | 'buyer-intent'
  | 'existing-audience'
  | 'engagement'
  | 'compound'
  | 'slow-burn'
  | 'strong-score'
  | 'weak-score'
  | 'improve-first';

/** One ranked position in the "what to publish first" list. */
export interface PriorityItem {
  /** Publication channel (pinterest_pin / etsy_listing / seo_blog / social_post / email_newsletter). */
  channel: ContentType;
  /** Content row id of the scored asset, when known. */
  assetId?: string;
  /** F1 Qualitäts-Score of the generated asset (null when missing/unsupported). */
  qualityScore: number | null;
  /** Combined priority 0–100: channel character (base) + quality adjustment. */
  priorityScore: number;
  /** 1-based position in the ordered list. */
  rank: number;
  /** Plain-language rationale — "Warum dieser Kanal zuerst/zweitens/…?". */
  rationale: string;
  /** Machine-readable reason tags (UI translates them). */
  reasonTags: PriorityTag[];
}

/** Result of prioritizeChannels(): ranked list + one-sentence summary. */
export interface PrioritizeOutcome {
  /** Ranked list — first item is "publish first". */
  ordered: PriorityItem[];
  /** One-sentence plain-language summary (German or English per request). */
  summary: string;
  /** Rules version so the ranking can evolve without breaking clients. */
  ruleVersion: number;
  /** true when the LLM phrasing pass produced the texts (false = templates). */
  llmUsed: boolean;
}

/** Input asset for prioritization (UI already read the score from metadata). */
export interface PrioritizeAsset {
  channel: ContentType;
  assetId?: string;
  qualityScore: number | null;
  title?: string;
}

export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'gemini';
  model?: string;
}

export interface AIProvider {
  name: string;
  generate(req: ContentRequest, config: AIConfig): Promise<ContentResult>;
  isConfigured(): boolean;
}
