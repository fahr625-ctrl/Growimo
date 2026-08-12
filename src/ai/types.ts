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

// ── F7 A/B-Varianten (decision layer) ─────────────────────────────────────────

/**
 * One A/B variant of a generated asset: alternative title + FULL body in the
 * same parser-compatible structure as the original, scored with the F1
 * pipeline (scoreContent). The user picks the best variant — it replaces the
 * asset (title + body) and its score stays on the asset (same persistence
 * path as F2/F2.1 via updateChannel).
 */
export interface VariantAsset {
  /** Alternative title (≠ original title). */
  title: string;
  /** Alternative FULL body — same numbered-section structure as the original. */
  body: string;
  /** F1 Qualitäts-Score (0–100) of this variant; null when scoring failed. */
  score: ContentScore | null;
}

/** Result of generateVariants(): exactly the request language + 1–3 scored variants. */
export interface VariantsResult {
  variants: VariantAsset[];
  lang: 'de' | 'en';
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
// ── F8 Veröffentlichungs-Kalender (decision layer) ────────────────────────────
/** One checkable task inside a scheduled publish-plan item (persisted JSONB). */
export interface PublishTask {
  /** Stable task id inside the item (e.g. "t1"…"t5"). */
  id: string;
  /** Concrete instruction — embeds real asset data (title/keywords) where possible. */
  label: string;
  /** Checkbox state (persisted via updateTaskDoneServer). */
  done: boolean;
}
/** One scheduled publication: which asset, when, at what priority, with which tasks. */
export interface PublishPlanItem {
  /** Stable item id — equals the generated-content row id (assetId). */
  id: string;
  projectId: string;
  projectTitle: string;
  channel: ContentType;
  assetId: string;
  /** Asset title to publish (already channel-appropriate). */
  title: string;
  /** F1 Qualitäts-Score 0–100 (null when unknown). */
  qualityScore: number | null;
  /** F3 combined priority 0–100 (channel character + quality). */
  priorityScore: number;
  /** 1-based position in the project's ranked order (1 = publish first). */
  rank: number;
  /** Scheduled date, YYYY-MM-DD (local time). */
  scheduledDate: string;
  /** Best-time semantic key ("pinterest" | "etsy" | "blog" | "social" | "newsletter") — UI translates. */
  bestTime: string;
  /** Plain-language rationale — why this channel at this position. */
  rationale: string;
  /** 3–6 checkable tasks (publishTasks). */
  tasks: PublishTask[];
}
/** Full generated publish plan for one user (all projects). */
export interface PublishPlan {
  items: PublishPlanItem[];
  /** ISO timestamp of plan generation. */
  generatedAt: string;
  /** Rules version so scheduling can evolve without breaking clients. */
  ruleVersion: number;
}
// ── F9 Performance-Feedback-Loop (decision layer) ─────────────────────────────
/** Channel-specific metrics the user logs after publishing (numeric). */
export interface PerformanceMetrics {
  [key: string]: number;
}
/** One logged performance entry: real results for one published asset. */
export interface PerformanceEntry {
  id: string;
  userId: string;
  assetId: string;
  channel: ContentType;
  /** ISO timestamp of the publication. */
  publishedAt: string;
  /** Channel-specific metrics (see metrics.ts CHANNEL_METRICS). */
  metrics: PerformanceMetrics;
  /** Optional free-text note from the user. */
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
/** A detected correlation between an asset feature and real performance. */
export interface SuccessFactor {
  /** Channel the factor was measured on. */
  channel: ContentType;
  /** Machine-readable factor key (title_number | title_cta | title_length_short | keyword_present | score_tier_high | …). */
  factor: string;
  /** Short human label (de), e.g. 'Zahl oder Anlass im Titel'. */
  label: string;
  /** Plain-language evidence with REAL numbers, e.g. 'Pins mit Zahl erzielten 2.1× mehr Saves'. */
  evidence: string;
  /** Relative lift (≥1) — e.g. 2.1 means 2.1× better. */
  magnitude: number;
  /** positive = feature in top assets, negative = feature in bottom assets. */
  direction: 'positive' | 'negative';
  /** Number of channel assets the factor is based on (≥ 3 required). */
  sampleSize: number;
}
/** Concrete, actionable improvement suggestion for underperforming assets. */
export interface PerfSuggestion {
  channel: ContentType;
  /** Concrete action (de), e.g. 'Füge eine konkrete Zahl oder einen Anlass in den Titel ein'. */
  action: string;
  /** Why — the measured evidence (de), e.g. 'Pins mit Zahl erzielten 2.1× mehr Saves'. */
  reason: string;
  /** The factor key this suggestion is derived from. */
  factor: string;
  /** How many underperforming assets of this channel lack the feature. */
  affectedAssets: number;
}
/** One trend slice: average performance score over a period for a channel. */
export interface PerfTrend {
  channel: ContentType | 'overall';
  /** Period label ('week' | 'prev_week' | …). */
  period: string;
  count: number;
  avgScore: number;
  /** avgScore(current period) − avgScore(previous period); null when no baseline. */
  delta: number | null;
}
/** Per-channel summary for the dashboard channel cards/tabs. */
export interface PerfChannelSummary {
  channel: ContentType;
  /** Number of logged entries. */
  count: number;
  /** Average performance score 0–100. */
  avgScore: number;
  /** Best performing asset of the channel (null when no entries). */
  bestAsset: { id: string; title: string; score: number; metrics: PerformanceMetrics } | null;
  /** Latest week-vs-prev-week trend (null when no baseline). */
  trend: PerfTrend | null;
  /** One avg score per week (oldest → newest) for the mini CSS trend bars. */
  weeklyScores: { week: string; avg: number }[];
}
/** Honest data-sufficiency gate — never invent insights without enough data. */
export interface PerfDataSufficiency {
  enoughData: boolean;
  /** Additional entries still needed until reliable insights (across channels). */
  needed: number;
  /** Per-channel current entry counts. */
  perChannel: Record<string, number>;
}
/** Everything the performance dashboard + generation context needs. */
export interface PerformanceOverview {
  entries: PerformanceEntry[];
  channels: PerfChannelSummary[];
  successFactors: SuccessFactor[];
  suggestions: PerfSuggestion[];
  trends: PerfTrend[];
  dataSufficiency: PerfDataSufficiency;
  /** Overall last-week vs previous-week trend (motivating header). */
  overallTrend: PerfTrend | null;
  /** Consecutive weeks with rising overall avg score (0 when unsupported). */
  streakWeeks: number;
  /** Global best asset across channels (winner card). */
  topAsset: { channel: ContentType; title: string; score: number; metrics: PerformanceMetrics } | null;
  /** Rules version so the analysis can evolve without breaking clients. */
  ruleVersion: number;
}
/** Minimal asset info the analysis needs (joined from generated_content). */
export interface PerfAssetInfo {
  id: string;
  channel: ContentType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  /** F1 quality score 0–100 (from metadata.score.total), null when missing. */
  qualityScore?: number | null;
}
// ── F10 Persönliche Lernschleife (decision layer) ─────────────────────────────
/** The three tone dimensions the learning loop steers. */
export type PreferenceTone = 'emotional' | 'friendly' | 'professional';
/** The two format-length dimensions the learning loop steers. */
export type PreferenceFormat = 'concise' | 'detailed';
/**
 * Derived preference profile for one user — fully deterministic (no LLM):
 * aggregated from stored like/dislike signals. `enoughData` is the honest
 * Stichproben-Gate (>= MIN_FEEDBACK_SIGNALS signals): before that, no
 * preference is ever asserted and the generation context only warns.
 */
export interface UserPreferencesView {
  likes: number;
  dislikes: number;
  totalSignals: number;
  enoughData: boolean;
  /** Signals still missing until the gate (0 when enoughData). */
  needed: number;
  /** Dominant tone — only when the signal is clear (never invented). */
  preferredTone: PreferenceTone | null;
  /** Dominant format length — only when the signal is clear. */
  preferredFormat: PreferenceFormat | null;
  /** Dominant channel affinity — only when the signal is clear. */
  preferredChannel: string | null;
  /** Raw weight per tone dimension (sum of +/- signals). */
  toneProfile: Record<string, number>;
  /** Raw weight per format dimension. */
  formatProfile: Record<string, number>;
  /** Raw weight per channel. */
  channelAffinity: Record<string, number>;
  /** Rules version so the derivation can evolve without breaking clients. */
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
