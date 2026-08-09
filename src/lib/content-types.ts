import type { ContentType } from '~/ai/types';
import type { Translations } from '~/i18n';

/** Maps each content type to its i18n label key (ct_*). */
const CONTENT_TYPE_KEYS: Record<ContentType, keyof Translations> = {
  pinterest_pin: 'ct_pinterest_pins',
  seo_blog: 'ct_seo_blog',
  etsy_listing: 'ct_etsy_listing',
  social_post: 'ct_social_media',
  email_newsletter: 'ct_email_newsletter',
  marketing_plan: 'ct_marketing_plan',
  product_idea: 'ct_product_ideas',
  trend_insight: 'ct_trend_insight',
  marketing_analysis: 'ct_marketing_analysis',
  market_intelligence: 'ct_market_intelligence',
};

/** Localized display label for a content type value. */
export function contentTypeLabel(t: Translations, contentType: string): string {
  const key = CONTENT_TYPE_KEYS[contentType as ContentType];
  return key ? t[key] : contentType;
}
