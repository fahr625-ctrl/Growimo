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

export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'gemini';
  model?: string;
}

export interface AIProvider {
  name: string;
  generate(req: ContentRequest, config: AIConfig): Promise<ContentResult>;
  isConfigured(): boolean;
}
