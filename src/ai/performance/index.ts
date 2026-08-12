// ── F9 Performance-Feedback-Loop: öffentliche API ───────────────────────────
// Alles deterministisch (kein LLM, null Kosten), immer ehrlich: ohne
// Mindest-Stichprobe (≥ 3 Assets je Kanal) werden keine Erfolgsfaktoren
// erfunden — dataSufficiency-Gate.
export { performanceScore, CHANNEL_METRICS, metricDefsFor, metricLabel, primaryMetricKey, PERF_CHANNELS } from './metrics';
export type { MetricDef, PerfLang } from './metrics';
export { analyze, emptyOverview, PERFORMANCE_RULE_VERSION, MIN_SAMPLE_PER_CHANNEL } from './insights';
export { buildPerformanceContext } from './context';

import type { PerformanceEntry, PerfAssetInfo, PerformanceOverview } from '../types';
import { analyze, emptyOverview } from './insights';
import type { PerfLang } from './metrics';

/**
 * Server-seitige Assembly: DB-Zeilen → Analyse → Overview. Nie throw.
 * Diese Funktion ist der gemeinsame Kern für getPerformanceOverviewServer
 * (Dashboard) UND den Generation-Loop (Paket + QuickGenerator): die
 * Erkenntnisse fließen als Kontext in zukünftige Generierungen ein.
 */
export async function buildPerformanceOverview(
  userId: string,
  opts: { lang?: PerfLang } = {},
): Promise<PerformanceOverview> {
  try {
    const { qGetPerformanceEntries } = await import('../../db/queries');
    const rows = await qGetPerformanceEntries(userId);
    if (rows.length === 0) return emptyOverview();
    const entries: PerformanceEntry[] = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      assetId: r.assetId,
      channel: r.channel as PerformanceEntry['channel'],
      publishedAt: r.publishedAt,
      metrics: r.metrics,
      notes: r.notes ?? undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    const { qGetAllContentByUser } = await import('../../db/queries');
    const contents = await qGetAllContentByUser(userId);
    const assets: PerfAssetInfo[] = contents.map((c) => ({
      id: c.id,
      channel: c.contentType,
      title: c.title,
      body: c.body,
      metadata: c.metadata,
      qualityScore: qualityFromMetadata(c.metadata),
    }));
    return analyze(entries, assets, opts.lang === 'en' ? 'en' : 'de');
  } catch (err) {
    console.error('[performance] buildPerformanceOverview failed — returning empty overview:', err);
    return emptyOverview();
  }
}

/** F1-Score aus metadata.score.total (wie publish-plan/rules.ts). */
function qualityFromMetadata(metadata: Record<string, unknown> | undefined): number | null {
  const s = metadata?.score;
  if (s && typeof s === 'object' && typeof (s as { total?: unknown }).total === 'number') {
    return (s as { total: number }).total;
  }
  return null;
}
