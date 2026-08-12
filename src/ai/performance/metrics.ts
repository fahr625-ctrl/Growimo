// ── F9 Performance-Feedback-Loop: Kanal-Metriken + deterministischer Score ──
// Die Nutzerin trägt nach der Veröffentlichung echte Ergebnisse ein. Dieses
// Modul definiert, WELCHE Metriken je Kanal erfasst werden (de/en-Label, Icon,
// Gewichtung) und rechnet sie in einen Performance-Score 0–100 um.
//
// Score-Logik (deterministisch, kein LLM, nie divide-by-zero):
//   - Jeder Kanal hat eine "Reichweiten"-Basis-Metrik (impressions/views/sent).
//   - Engagement-Metriken werden als RATE zur Basis normalisiert und gegen
//     realistische Ziel-Raten skaliert (Rate/Ziel, gedeckelt bei 1).
//   - SEO-Ranking (Position) wird invertiert über Buckets bewertet.
//   - Gewichteter Mittelwert über die vorhandenen Metriken (Gewichte relativ).
export type PerfLang = 'de' | 'en';

export interface MetricDef {
  key: string;
  label: Record<PerfLang, string>;
  icon: string;
  /** Relative weight for the 0–100 score (normalized over present metrics). */
  weight: number;
  /** True for the reach metric (impressions/views/sent) — denominator. */
  base?: boolean;
  /** Rate target (metric/base) that maps to 100 points. */
  rateTarget?: number;
  /** True for SEO position — smaller is better, scored via buckets. */
  inverted?: boolean;
  /** Placeholder text for the input form. */
  placeholder: string;
}

/** Channels of the performance loop (the five publishable ones). */
export const PERF_CHANNELS: string[] = [
  'pinterest_pin',
  'etsy_listing',
  'seo_blog',
  'social_post',
  'email_newsletter',
];

export const CHANNEL_METRICS: Record<string, MetricDef[]> = {
  pinterest_pin: [
    { key: 'impressions', label: { de: 'Impressionen', en: 'Impressions' }, icon: '👁️', weight: 0, base: true, placeholder: 'z. B. 12500' },
    { key: 'saves', label: { de: 'Saves', en: 'Saves' }, icon: '📌', weight: 0.55, rateTarget: 0.05, placeholder: 'z. B. 620' },
    { key: 'outbound_clicks', label: { de: 'Klicks', en: 'Outbound clicks' }, icon: '🖱️', weight: 0.45, rateTarget: 0.015, placeholder: 'z. B. 180' },
  ],
  etsy_listing: [
    { key: 'views', label: { de: 'Aufrufe', en: 'Views' }, icon: '👁️', weight: 0, base: true, placeholder: 'z. B. 3400' },
    { key: 'favorites', label: { de: 'Favoriten', en: 'Favorites' }, icon: '⭐', weight: 0.45, rateTarget: 0.10, placeholder: 'z. B. 340' },
    { key: 'orders', label: { de: 'Bestellungen', en: 'Orders' }, icon: '🛒', weight: 0.55, rateTarget: 0.02, placeholder: 'z. B. 68' },
  ],
  seo_blog: [
    { key: 'impressions', label: { de: 'Impressionen (Google)', en: 'Impressions (Google)' }, icon: '🔍', weight: 0, base: true, placeholder: 'z. B. 8900' },
    { key: 'clicks', label: { de: 'Klicks', en: 'Clicks' }, icon: '🖱️', weight: 0.55, rateTarget: 0.10, placeholder: 'z. B. 890' },
    { key: 'position', label: { de: 'Ø Ranking-Position', en: 'Avg position' }, icon: '🏆', weight: 0.45, inverted: true, placeholder: 'z. B. 4' },
  ],
  social_post: [
    { key: 'impressions', label: { de: 'Impressionen', en: 'Impressions' }, icon: '👁️', weight: 0, base: true, placeholder: 'z. B. 5200' },
    { key: 'likes', label: { de: 'Likes', en: 'Likes' }, icon: '❤️', weight: 0.25, rateTarget: 0.05, placeholder: 'z. B. 260' },
    { key: 'clicks', label: { de: 'Klicks', en: 'Clicks' }, icon: '🖱️', weight: 0.45, rateTarget: 0.01, placeholder: 'z. B. 52' },
    { key: 'shares', label: { de: 'Shares', en: 'Shares' }, icon: '🔁', weight: 0.30, rateTarget: 0.005, placeholder: 'z. B. 26' },
  ],
  email_newsletter: [
    { key: 'sent', label: { de: 'Gesendet', en: 'Sent' }, icon: '📤', weight: 0, base: true, placeholder: 'z. B. 1500' },
    { key: 'opens', label: { de: 'Opens', en: 'Opens' }, icon: '📬', weight: 0.55, rateTarget: 0.40, placeholder: 'z. B. 600' },
    { key: 'clicks', label: { de: 'Klicks', en: 'Clicks' }, icon: '🖱️', weight: 0.45, rateTarget: 0.05, placeholder: 'z. B. 75' },
  ],
};

export function metricDefsFor(channel: string): MetricDef[] {
  return CHANNEL_METRICS[channel] ?? [];
}

/** SEO position → 0–100 (inverted: rank 1 is best). 0/missing → null (excluded). */
export function positionScore(position: number): number | null {
  if (!Number.isFinite(position) || position <= 0) return null;
  if (position <= 3) return 100;
  if (position <= 10) return 75;
  if (position <= 20) return 55;
  if (position <= 50) return 35;
  if (position <= 100) return 15;
  return 5;
}

/**
 * Deterministic performance score 0–100 for one logged entry.
 * 0 = keine verwertbaren Daten / null Engagement; 100 = Ziel-Raten erreicht.
 * Never throws, never divides by zero.
 */
export function performanceScore(
  metrics: Record<string, number> | undefined,
  channel: string,
): number {
  if (!metrics || typeof metrics !== 'object') return 0;
  const defs = CHANNEL_METRICS[channel];
  if (!defs || defs.length === 0) return 0;
  const baseDef = defs.find((d) => d.base);
  const baseVal = baseDef ? Number(metrics[baseDef.key]) : 0;
  const base = Number.isFinite(baseVal) && baseVal > 0 ? baseVal : 0;

  let total = 0;
  let weightSum = 0;
  for (const def of defs) {
    if (def.base) continue; // Reichweite ist Nenner, kein eigenes Gewicht
    const raw = Number(metrics[def.key]);
    if (!Number.isFinite(raw) || raw < 0) continue;
    let component: number;
    if (def.inverted) {
      const ps = positionScore(raw);
      if (ps == null) continue;
      component = ps;
    } else if (def.rateTarget && base > 0) {
      component = Math.min(100, (raw / base / def.rateTarget) * 100);
    } else {
      continue; // Rate ohne Basis → nicht verwertbar
    }
    total += def.weight * component;
    weightSum += def.weight;
  }
  if (weightSum <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(total / weightSum)));
}

/** The headline engagement metric per channel (used in factor evidence). */
export function primaryMetricKey(channel: string): string {
  switch (channel) {
    case 'pinterest_pin': return 'saves';
    case 'etsy_listing': return 'orders';
    case 'seo_blog': return 'clicks';
    case 'social_post': return 'clicks';
    case 'email_newsletter': return 'opens';
    default: return '';
  }
}

/** Human label for one metric in the current language. */
export function metricLabel(key: string, channel: string, lang: PerfLang): string {
  const def = CHANNEL_METRICS[channel]?.find((d) => d.key === key);
  return def ? def.label[lang] : key;
}
