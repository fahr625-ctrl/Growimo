import type { ContentType } from './types';

export interface ContentTypeConfig {
  type: ContentType;
  label: string;
  icon: string;
  description: string;
  category: 'social' | 'ecommerce' | 'content' | 'strategy' | 'analysis';
}

export const CONTENT_TYPE_REGISTRY: ContentTypeConfig[] = [
  {
    type: 'pinterest_pin',
    label: 'Pinterest-Pins',
    icon: '📌',
    description: 'SEO-Titel, Beschreibungen, Keywords & Bild-Prompts',
    category: 'social',
  },
  {
    type: 'seo_blog',
    label: 'SEO-Blogbeitrag',
    icon: '📝',
    description: '1.500–2.000 Wörter, H2/H3, FAQ, Meta-Daten',
    category: 'content',
  },
  {
    type: 'etsy_listing',
    label: 'Etsy-Eintrag',
    icon: '🛍️',
    description: 'Titel, Beschreibungen & alle 13 Tags',
    category: 'ecommerce',
  },
  {
    type: 'social_post',
    label: 'Social-Media-Beiträge',
    icon: '📱',
    description: 'Instagram, Facebook & TikTok',
    category: 'social',
  },
  {
    type: 'email_newsletter',
    label: 'E-Mail-Newsletter',
    icon: '📧',
    description: 'Betreffzeilen & versandfertige Kampagnen',
    category: 'content',
  },
  {
    type: 'marketing_plan',
    label: 'Marketing-Plan',
    icon: '📊',
    description: 'Komplette Strategie & Content-Kalender',
    category: 'strategy',
  },
  {
    type: 'product_idea',
    label: 'Produktideen',
    icon: '💡',
    description: 'Neue Digitalprodukt-Konzepte',
    category: 'strategy',
  },
  {
    type: 'trend_insight',
    label: 'Trend-Analyse',
    icon: '📈',
    description: 'Markttrends & Optimierungspotenziale',
    category: 'strategy',
  },
  {
    type: 'marketing_analysis',
    label: 'KI-Analyse & Empfehlungen',
    icon: '🔍',
    description: 'SEO-Score, Zielgruppe, Content-Ideen & nächste Schritte',
    category: 'strategy',
  },
  {
    type: 'market_intelligence',
    label: 'Market Intelligence',
    icon: '📊',
    description: 'Strategische Marktübersicht mit Nachfrage, Wettbewerb, SWOT und Empfehlungen',
    category: 'analysis',
  },
];

/** Look up a single content type config */
export function getContentTypeConfig(type: ContentType): ContentTypeConfig | undefined {
  return CONTENT_TYPE_REGISTRY.find((c) => c.type === type);
}
