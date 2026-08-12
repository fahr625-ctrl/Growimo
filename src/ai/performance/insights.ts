// ── F9 Performance-Feedback-Loop: deterministische Analyse ──────────────────
// analyze() korreliert die vom Nutzer erfassten echten Ergebnisse mit den
// Merkmalen der Assets (Titel-Eigenschaften, Keywords, F1-Score-Tier) —
// REGEL-basiert, kein LLM, null Kosten, immer ehrlich:
//   - Faktor nur ausweisen, wenn der Kanal ≥ 3 Assets mit Daten hat UND der
//     Unterschied zwischen Top- und Bottom-Terzil ≥ 20 % (relativ) ist.
//   - Magnitude = Verhältnis der Median-Raten (primäre Metrik / Reichweite)
//     zwischen Assets MIT und OHNE das Merkmal — echte Zahl aus den Daten.
//   - Trends: Ø Performance-Score letzte 7 Tage vs. die 7 Tage davor.
//   - Bei zu wenig Daten: keine erfundenen Erkenntnisse (dataSufficiency-Gate).

import type {
  ContentType,
  PerfAssetInfo,
  PerfChannelSummary,
  PerfDataSufficiency,
  PerformanceEntry,
  PerformanceMetrics,
  PerformanceOverview,
  PerfSuggestion,
  PerfTrend,
  SuccessFactor,
} from '../types';
import { performanceScore, primaryMetricKey, PERF_CHANNELS } from './metrics';
import type { PerfLang } from './metrics';
import { CHANNEL_LABEL, fmtMag } from './wording';

export const PERFORMANCE_RULE_VERSION = 1;
/** Mindest-Stichprobe je Kanal, bevor Faktoren ausgewiesen werden. */
export const MIN_SAMPLE_PER_CHANNEL = 3;
/** Mindest-Unterschied (relativ) zwischen Merkmal-Gruppen für einen Faktor. */
export const MIN_RELATIVE_DIFF = 0.2;

// ── Feature-Fingerprint eines Assets ─────────────────────────────────────────

interface Features {
  title_number: boolean;
  title_cta: boolean;
  title_short: boolean;
  title_long: boolean;
  keyword_present: boolean;
  score_high: boolean;
}

const CTA_WORDS_DE = ['jetzt', 'heute', 'gratis', 'kostenlos', 'kaufen', 'entdecken', 'sparen', 'sichern', 'anleitung', 'guide', 'tipps', 'lernen', 'neu', 'exklusiv', 'sale', 'angebot'];
const CTA_WORDS_EN = ['now', 'today', 'free', 'buy', 'discover', 'save', 'get', 'download', 'how to', 'guide', 'tips', 'learn', 'new', 'exclusive', 'sale', 'deal'];

function extractFeatures(asset: PerfAssetInfo): Features {
  const title = (asset.title ?? '').toLowerCase();
  const len = title.length;
  const ctaWords = [...CTA_WORDS_DE, ...CTA_WORDS_EN];
  const hasNumber = /\d/.test(asset.title ?? '');
  const hasEmojiLikeCta = ctaWords.some((w) => title.includes(w));
  const meta = asset.metadata ?? {};
  // Keyword-Präsenz: metadata.keywords / metadata.tags — irgendein Keyword im Titel?
  const keywords: string[] = [
    ...(Array.isArray(meta.keywords) ? meta.keywords.map(String) : []),
    ...(Array.isArray(meta.tags) ? meta.tags.map(String) : []),
  ];
  const body = (asset.body ?? '').toLowerCase();
  const keywordPresent = keywords.length > 0 && keywords.some((k) => k.trim().length >= 3 && (title.includes(k.toLowerCase()) || body.includes(k.toLowerCase())));
  const q = typeof asset.qualityScore === 'number' ? asset.qualityScore : null;
  return {
    title_number: hasNumber,
    title_cta: hasEmojiLikeCta,
    title_short: len > 0 && len <= 40,
    title_long: len > 70,
    keyword_present: keywordPresent,
    score_high: q != null && q >= 80,
  };
}

interface FeatureDef {
  key: keyof Features;
  label: Record<PerfLang, string>;
  action: Record<PerfLang, string>;
  /** Nur wenn die Merkmals-Gruppen wirklich gesplittet sind (mind. 1 mit, 1 ohne). */
}

const FEATURE_DEFS: Record<keyof Features, { label: Record<PerfLang, string>; action: Record<PerfLang, string> }> = {
  title_number: {
    label: { de: 'einer konkreten Zahl oder einem Anlass im Titel', en: 'a concrete number or occasion in the title' },
    action: { de: 'Füge eine konkrete Zahl oder einen Anlass in den Titel ein', en: 'Add a concrete number or occasion to the title' },
  },
  title_cta: {
    label: { de: 'einer Handlungsaufforderung (CTA) im Titel', en: 'a call-to-action (CTA) in the title' },
    action: { de: 'Formuliere den Titel als klare Handlungsaufforderung (z. B. „Jetzt entdecken“)', en: 'Make the title a clear call-to-action (e.g. “Discover now”)' },
  },
  title_short: {
    label: { de: 'einem kurzen Titel (max. 40 Zeichen)', en: 'a short title (max 40 characters)' },
    action: { de: 'Kürze den Titel auf max. 40 Zeichen', en: 'Shorten the title to max 40 characters' },
  },
  title_long: {
    label: { de: 'einem langen, detaillierten Titel (über 70 Zeichen)', en: 'a long, detailed title (over 70 characters)' },
    action: { de: 'Verwende einen längeren, detaillierteren Titel', en: 'Use a longer, more detailed title' },
  },
  keyword_present: {
    label: { de: 'einem Ziel-Keyword im Titel oder Text', en: 'a target keyword in the title or text' },
    action: { de: 'Bringe ein konkretes Ziel-Keyword in Titel und Text unter', en: 'Place a specific target keyword in the title and text' },
  },
  score_high: {
    label: { de: 'einem hohen F1-Qualitäts-Score (≥ 80)', en: 'a high F1 quality score (≥ 80)' },
    action: { de: 'Verbessere vor dem Veröffentlichen den F1-Qualitäts-Score auf ≥ 80', en: 'Improve the F1 quality score to ≥ 80 before publishing' },
  },
};

// ── Kanal-Labels (für Klartext-Evidence mit echten Zahlen) ───────────────────

const METRIC_LABEL: Record<string, Record<PerfLang, string>> = {
  saves: { de: 'Saves', en: 'saves' },
  orders: { de: 'Bestellungen', en: 'orders' },
  clicks: { de: 'Klicks', en: 'clicks' },
  opens: { de: 'Opens', en: 'opens' },
};

// ── Helfer: Median, Wochen-Buckets ───────────────────────────────────────────

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Montag der ISO-Woche als YYYY-MM-DD. */
function weekKey(iso: string): string {
  const d = new Date(iso);
  const day = (d.getDay() + 6) % 7; // 0=Montag
  d.setDate(d.getDate() - day);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

interface ScoredEntry {
  entry: PerformanceEntry;
  asset: PerfAssetInfo;
  score: number;
  /** Rate der primären Metrik (metrik / reichweite) — Basis für Magnitudes. */
  primaryRate: number;
  features: Features;
}

function primaryRateOf(entry: PerformanceEntry, channel: ContentType): number {
  const key = primaryMetricKey(channel);
  if (!key) return 0;
  const baseKey = channel === 'email_newsletter' ? 'sent' : channel === 'etsy_listing' ? 'views' : 'impressions';
  const base = Number(entry.metrics[baseKey]);
  const val = Number(entry.metrics[key]);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(val) || val <= 0) return 0;
  return val / base;
}

function trendBetween(a: ScoredEntry[], b: ScoredEntry[], channel: ContentType | 'overall'): PerfTrend | null {
  if (a.length === 0) return null;
  const cur = Math.round((a.reduce((s, e) => s + e.score, 0) / a.length) * 10) / 10;
  if (b.length === 0) {
    return { channel, period: 'week', count: a.length, avgScore: cur, delta: null };
  }
  const prev = b.reduce((s, e) => s + e.score, 0) / b.length;
  const delta = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
  return { channel, period: 'week', count: a.length, avgScore: cur, delta };
}

// ── Öffentliche Analyse ───────────────────────────────────────────────────────

/**
 * Deterministic performance analysis for one user. Pure function — the server
 * functions feed it with stored entries + assets. Never throws.
 */
export function analyze(
  entries: PerformanceEntry[],
  assets: PerfAssetInfo[],
  lang: PerfLang = 'de',
): PerformanceOverview {
  const assetById = new Map<string, PerfAssetInfo>();
  for (const a of assets) assetById.set(a.id, a);

  const now = Date.now();

  // 1. Entries mit Asset verbinden + scoren (nur publishbare Kanäle).
  const scored: ScoredEntry[] = [];
  for (const entry of entries) {
    if (!PERF_CHANNELS.includes(entry.channel)) continue;
    const asset = assetById.get(entry.assetId);
    if (!asset) continue; // Asset nicht mehr vorhanden → nicht auswertbar
    const channel = asset.channel as ContentType;
    scored.push({
      entry,
      asset,
      score: performanceScore(entry.metrics, channel),
      primaryRate: primaryRateOf(entry, channel),
      features: extractFeatures(asset),
    });
  }

  // 2. Pro Kanal gruppieren.
  const byChannel = new Map<ContentType, ScoredEntry[]>();
  for (const s of scored) {
    const list = byChannel.get(s.asset.channel as ContentType) ?? [];
    list.push(s);
    byChannel.set(s.asset.channel as ContentType, list);
  }

  // 3. Datenlage (ehrliches Gate — keine erfundenen Erkenntnisse).
  const perChannelCount: Record<string, number> = {};
  let enoughData = false;
  for (const ch of PERF_CHANNELS) {
    perChannelCount[ch] = byChannel.get(ch as ContentType)?.length ?? 0;
    if (perChannelCount[ch] >= MIN_SAMPLE_PER_CHANNEL) enoughData = true;
  }
  let needed = 0;
  for (const ch of PERF_CHANNELS) {
    if (perChannelCount[ch] > 0 && perChannelCount[ch] < MIN_SAMPLE_PER_CHANNEL) {
      needed += MIN_SAMPLE_PER_CHANNEL - perChannelCount[ch];
    }
  }
  const dataSufficiency: PerfDataSufficiency = { enoughData, needed, perChannel: perChannelCount };

  // 4. Kanal-Zusammenfassungen + Trends + Faktoren.
  const channels: PerfChannelSummary[] = [];
  const successFactors: SuccessFactor[] = [];
  const suggestions: PerfSuggestion[] = [];
  const trends: PerfTrend[] = [];

  for (const ch of PERF_CHANNELS) {
    const list = (byChannel.get(ch as ContentType) ?? []).slice().sort((a, b) => b.score - a.score);
    if (list.length === 0) continue;

    const avgScore = Math.round((list.reduce((s, e) => s + e.score, 0) / list.length) * 10) / 10;
    const best = list[0];
    const bestAsset = best
      ? { id: best.asset.id, title: best.asset.title, score: best.score, metrics: best.entry.metrics }
      : null;

    // Wochen-Trend (7 Tage) + Mini-Balken (ISO-Wochen).
    const thisWeek = list.filter((e) => now - Date.parse(e.entry.publishedAt) < 7 * 86400000);
    const prevWeek = list.filter((e) => {
      const t = now - Date.parse(e.entry.publishedAt);
      return t >= 7 * 86400000 && t < 14 * 86400000;
    });
    const trend = trendBetween(thisWeek, prevWeek, ch as ContentType);
    if (trend) trends.push(trend);

    const byWeek = new Map<string, number[]>();
    for (const e of list) {
      const wk = weekKey(e.entry.publishedAt);
      const arr = byWeek.get(wk) ?? [];
      arr.push(e.score);
      byWeek.set(wk, arr);
    }
    const weeklyScores = [...byWeek.entries()]
      .map(([week, scores]) => ({ week, avg: Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) / 10 }))
      .sort((a, b) => a.week.localeCompare(b.week))
      .slice(-8);

    channels.push({ channel: ch as ContentType, count: list.length, avgScore, bestAsset, trend, weeklyScores });

    // ── Faktoren (nur mit ausreichender Stichprobe) ──
    if (list.length < MIN_SAMPLE_PER_CHANNEL) continue;
    const n = list.length;
    const tercileSize = Math.max(1, Math.ceil(n / 3));
    const top = list.slice(0, tercileSize);
    const bottom = list.slice(n - tercileSize);
    const channelKey = ch as ContentType;
    const metricKey = primaryMetricKey(channelKey);
    const metricLabel = METRIC_LABEL[metricKey]?.[lang] ?? metricKey;
    const chLabel = CHANNEL_LABEL[channelKey]?.[lang] ?? channelKey;

    const featureKeys = Object.keys(FEATURE_DEFS) as (keyof Features)[];
    for (const fk of featureKeys) {
      const topCount = top.filter((e) => e.features[fk]).length;
      const bottomCount = bottom.filter((e) => e.features[fk]).length;
      const topShare = topCount / top.length;
      const bottomShare = bottomCount / bottom.length;
      const diff = topShare - bottomShare;
      // Mindestens eine Merkmals-Gruppe muss real vorhanden sein.
      const withFeature = list.filter((e) => e.features[fk]);
      const withoutFeature = list.filter((e) => !e.features[fk]);
      if (withFeature.length === 0 || withoutFeature.length === 0) continue;
      const relativeDiff = topShare - bottomShare;
      if (relativeDiff < MIN_RELATIVE_DIFF) continue;

      // Magnitude: Median-Rate mit Merkmal / Median-Rate ohne Merkmal.
      const rateWith = median(withFeature.map((e) => e.primaryRate));
      const rateWithout = median(withoutFeature.map((e) => e.primaryRate));
      if (rateWith <= 0) continue;
      const magnitude = rateWithout > 0 ? rateWith / rateWithout : Math.max(1, withFeature.length);
      if (magnitude < 1.2 && rateWithout > 0) continue;

      const def = FEATURE_DEFS[fk];
      const factor: SuccessFactor = {
        channel: channelKey,
        factor: fk,
        label: def.label[lang],
        evidence: `${chLabel} mit ${def.label[lang]} erzielten ${fmtMag(magnitude, lang)}× mehr ${metricLabel} (${withFeature.length} mit, ${withoutFeature.length} ohne)`,
        magnitude: Math.round(magnitude * 10) / 10,
        direction: 'positive',
        sampleSize: list.length,
      };
      successFactors.push(factor);

      // Vorschlag für Underperformer, die das Merkmal NICHT haben.
      const underperformersMissing = bottom.filter((e) => !e.features[fk]);
      if (underperformersMissing.length > 0) {
        suggestions.push({
          channel: channelKey,
          action: def.action[lang],
          reason: `${chLabel} mit ${def.label[lang]} erzielten ${fmtMag(magnitude, lang)}× mehr ${metricLabel}`,
          factor: fk,
          affectedAssets: underperformersMissing.length,
        });
      }
    }
  }

  // 5. Gesamt-Trend + Streak + Top-Asset (motivierender Header).
  const overallThisWeek = scored.filter((e) => now - Date.parse(e.entry.publishedAt) < 7 * 86400000);
  const overallPrevWeek = scored.filter((e) => {
    const t = now - Date.parse(e.entry.publishedAt);
    return t >= 7 * 86400000 && t < 14 * 86400000;
  });
  const overallTrend = trendBetween(overallThisWeek, overallPrevWeek, 'overall');

  // Streak: aufeinanderfolgende Wochen mit steigendem Ø-Score (endet in der
  // letzten Woche MIT Daten). Nur behaupten, was die Daten belegen.
  const overallByWeek = new Map<string, number[]>();
  for (const e of scored) {
    const wk = weekKey(e.entry.publishedAt);
    const arr = overallByWeek.get(wk) ?? [];
    arr.push(e.score);
    overallByWeek.set(wk, arr);
  }
  const weeklyAvgs = [...overallByWeek.entries()]
    .map(([week, scores]) => ({ week, avg: scores.reduce((s, x) => s + x, 0) / scores.length }))
    .sort((a, b) => a.week.localeCompare(b.week));
  let streakWeeks = 0;
  if (weeklyAvgs.length >= 2) {
    for (let i = weeklyAvgs.length - 1; i >= 1; i--) {
      if (weeklyAvgs[i].avg >= weeklyAvgs[i - 1].avg) streakWeeks++;
      else break;
    }
  }

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const topAsset = sorted[0]
    ? { channel: sorted[0].asset.channel as ContentType, title: sorted[0].asset.title, score: sorted[0].score, metrics: sorted[0].entry.metrics }
    : null;

  return {
    entries: scored.map((s) => s.entry),
    channels,
    successFactors,
    suggestions,
    trends,
    dataSufficiency,
    overallTrend,
    streakWeeks,
    topAsset,
    ruleVersion: PERFORMANCE_RULE_VERSION,
  };
}

/** Baue einen PerformanceOverview aus leeren Daten (nie throw). */
export function emptyOverview(): PerformanceOverview {
  const perChannel: Record<string, number> = {};
  for (const ch of PERF_CHANNELS) perChannel[ch] = 0;
  return {
    entries: [],
    channels: [],
    successFactors: [],
    suggestions: [],
    trends: [],
    dataSufficiency: { enoughData: false, needed: 0, perChannel },
    overallTrend: null,
    streakWeeks: 0,
    topAsset: null,
    ruleVersion: PERFORMANCE_RULE_VERSION,
  };
}
