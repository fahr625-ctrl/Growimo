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
