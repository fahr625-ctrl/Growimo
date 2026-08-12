import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation } from '~/i18n';
import { getContentTypeConfig } from '~/ai/content-types';
import type { ContentType, PerformanceOverview } from '~/ai/types';
import {
  getPerformanceOverviewServer,
  getPublishedAssetsServer,
  logPerformanceServer,
} from '~/ai/server';
import { CHANNEL_METRICS } from '~/ai/performance/metrics';
import { ScoreBadge } from '~/components/ScoreBadge';
import { PreferencesCard } from '~/components/PreferencesCard';

export const Route = createFileRoute('/app/performance')({ component: PerformancePage });

// ── Types (server rows are plain JSON) ─────────────────────────────────────────
interface PublishedAsset {
  assetId: string;
  projectId: string;
  projectTitle: string;
  channel: string;
  title: string;
  qualityScore: number | null;
  plannedDate: string | null;
  logged: boolean;
  existingMetrics: Record<string, number>;
  publishedAt: string | null;
}

const PUBLISHABLE: ContentType[] = ['pinterest_pin', 'etsy_listing', 'seo_blog', 'social_post', 'email_newsletter'];

function PerformancePage() {
  return (
    <ProtectedRoute>
      <PerformanceContent />
    </ProtectedRoute>
  );
}

function PerformanceContent() {
  const { user } = useUser();
  const uid = user?.id ?? 'anonymous';
  const { t, locale } = useTranslation();
  const lang = locale === 'en' ? 'en' : 'de';

  const [overview, setOverview] = useState<PerformanceOverview | null>(null);
  const [assets, setAssets] = useState<PublishedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeChannel, setActiveChannel] = useState<string>('all');
  const [openForms, setOpenForms] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  // Form state: metric values + date + notes per asset
  const [form, setForm] = useState<Record<string, Record<string, string>>>({});
  const [formDate, setFormDate] = useState<Record<string, string>>({});
  const [formNotes, setFormNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!uid) return;
    try {
      const [ov, as] = await Promise.all([
        getPerformanceOverviewServer({ data: { userId: uid, lang } }),
        getPublishedAssetsServer({ data: { userId: uid } }),
      ]);
      setOverview(ov);
      setAssets(as ?? []);
      setError(null);
    } catch (err) {
      console.error('Failed to load performance data:', err);
      setError(err instanceof Error ? err.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [uid, lang]);

  useEffect(() => {
    setLoading(true);
    reload().catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // ?asset=<id> from the calendar → auto-open that asset's form
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const target = params.get('asset');
      if (target) {
        setOpenForms((prev) => new Set(prev).add(target));
        setActiveChannel('all');
      }
    } catch {
      // ignore
    }
  }, [assets.length]);

  const toggleForm = useCallback((assetId: string) => {
    setOpenForms((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);

  const handleSave = useCallback(
    async (asset: PublishedAsset) => {
      const metrics: Record<string, number> = {};
      for (const def of CHANNEL_METRICS[asset.channel] ?? []) {
        const raw = form[asset.assetId]?.[def.key];
        const n = Number(raw);
        if (raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0) metrics[def.key] = n;
      }
      setSaving(asset.assetId);
      try {
        await logPerformanceServer({
          data: {
            userId: uid,
            assetId: asset.assetId,
            channel: asset.channel,
            publishedAt: formDate[asset.assetId] || undefined,
            metrics,
            notes: formNotes[asset.assetId] || undefined,
          },
        });
        setToast(t.perf_log_saved);
        setForm((prev) => ({ ...prev, [asset.assetId]: {} }));
        await reload();
        setTimeout(() => setToast(null), 3500);
      } catch (err) {
        console.error('logPerformance failed:', err);
        setToast(t.perf_log_error);
      } finally {
        setSaving(null);
      }
    },
    [form, formDate, formNotes, uid, reload, t],
  );

  const totalLogged = overview?.entries.length ?? 0;
  const channels = useMemo(
    () => (overview?.channels ?? []).slice().sort((a, b) => b.count - a.count),
    [overview],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-gray-500">
        <span className="animate-pulse">{t.common_loading}</span>
      </div>
    );
  }

  const sufficiency = overview?.dataSufficiency;

  return (
    <div className="animate-fadeIn">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">{t.perf_title}</h1>
          <p className="mt-1 max-w-xl text-sm text-gray-500">{t.perf_subtitle}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-100 bg-fuchsia-50 px-3 py-1.5 text-xs font-semibold text-fuchsia-700">
          ✨ {t.perf_badge_loop}
        </span>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {totalLogged === 0 ? (
        <div className="mb-8">
          <EmptyState
            onCta={() => {
              setActiveChannel('log');
              document.getElementById('perf-log')?.scrollIntoView({ behavior: 'smooth' });
            }}
          />
        </div>
      ) : (
        <>
          {/* Motivierende Header-Karten: Gesamt-Trend + Sieger + Streak */}
          {overview && <TrendHeader overview={overview} />}

          {/* Kanal-Karten / Tabs */}
          <ChannelSection
            channels={channels}
            activeChannel={activeChannel}
            setActiveChannel={setActiveChannel}
            t={t}
            lang={lang}
          />
        </>
      )}

      {/* F10 Persönliche Lernschleife — gelernte Präferenzen + Reset */}
      <PreferencesCard />

      {toast && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="rounded-2xl border border-emerald-200 bg-white px-5 py-3 text-sm font-semibold text-emerald-800 shadow-xl">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyState({ onCta }: { onCta: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-14 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-100 to-purple-100 text-3xl">
        📈
      </div>
      <h3 className="mt-4 text-sm font-semibold text-gray-900">{t.perf_no_data}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">{t.perf_no_data_desc}</p>
      <button
        onClick={onCta}
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:from-fuchsia-700 hover:to-purple-700"
      >
        {t.perf_no_data_cta}
      </button>
    </div>
  );
}

// ── Trend-Header: Gesamt-Trend + Sieger-Karte + Streak ────────────────────────
function TrendHeader({ overview }: { overview: PerformanceOverview }) {
  const { t, locale } = useTranslation();
  const lang = locale === 'en' ? 'en' : 'de';
  const trend = overview.overallTrend;
  const top = overview.topAsset;
  const streak = overview.streakWeeks;

  let trendText = t.perf_no_baseline;
  let trendTone = 'text-gray-500';
  if (trend?.delta != null) {
    if (trend.delta > 0) {
      trendText = t.perf_overall_up.replace('{pct}', String(Math.abs(trend.delta)));
      trendTone = 'text-emerald-600';
    } else if (trend.delta < 0) {
      trendText = t.perf_overall_down.replace('{pct}', String(Math.abs(trend.delta)));
      trendTone = 'text-red-500';
    } else {
      trendText = t.perf_overall_flat;
      trendTone = 'text-gray-600';
    }
  }

  const topCfg = top ? getContentTypeConfig(top.channel) : undefined;
  const metricsLine = top ? metricsSummary(top.metrics, top.channel, lang) : '';

  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-3">
      {/* Gesamt-Trend */}
      <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-fuchsia-50/70 via-white to-purple-50/40 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t.perf_avg_score}</p>
        <p className={`mt-2 text-2xl font-extrabold ${trendTone}`}>
          {trend?.delta != null ? `${trend.delta > 0 ? '+' : ''}${trend.delta} %` : '—'}
        </p>
        <p className="mt-1 text-xs text-gray-500">{trendText}</p>
        {streak >= 1 && (
          <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-orange-50 to-amber-50 border border-amber-200 px-3 py-1 text-xs font-bold text-amber-700">
            {t.perf_streak.replace('{n}', String(streak + 1))}
          </span>
        )}
      </div>

      {/* Sieger-Karte */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {top ? t.perf_winner.replace('{channel}', (topCfg?.label ?? '').toLowerCase()) : t.perf_winner.replace('{channel}', '')}
            </p>
            {top ? (
              <>
                <p className="mt-1.5 truncate text-lg font-bold text-gray-900">
                  <span className="mr-1.5">{topCfg?.icon}</span>
                  {top.title}
                </p>
                <p className="mt-1 text-sm font-semibold text-fuchsia-700">{metricsLine}</p>
              </>
            ) : (
              <p className="mt-1.5 text-sm text-gray-500">{t.perf_no_data}</p>
            )}
          </div>
          {top && <ScoreBadge total={top.score} />}
        </div>
      </div>
    </div>
  );
}

// ── Kanal-Karten / Tabs ────────────────────────────────────────────────────────
function ChannelSection({
  channels,
  activeChannel,
  setActiveChannel,
  t,
  lang,
}: {
  channels: PerformanceOverview['channels'];
  activeChannel: string;
  setActiveChannel: (c: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
  lang: 'de' | 'en';
}) {
  if (channels.length === 0) return null;
  const visible = activeChannel === 'all' ? channels : channels.filter((c) => c.channel === activeChannel);

  return (
    <section className="mt-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-gray-900">{t.perf_channels_title}</h2>
      </div>
      {/* Horizontal scrollbare Tabs (mobile-first) */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveChannel('all')}
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
            activeChannel === 'all'
              ? 'bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white shadow-sm'
              : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          Alle
        </button>
        {channels.map((c) => {
          const cfg = getContentTypeConfig(c.channel);
          return (
            <button
              key={c.channel}
              onClick={() => setActiveChannel(c.channel)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                activeChannel === c.channel
                  ? 'bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white shadow-sm'
                  : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {cfg?.icon} {cfg?.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {visible.map((c) => (
          <ChannelCard key={c.channel} channel={c} t={t} lang={lang} />
        ))}
      </div>
    </section>
  );
}

function ChannelCard({
  channel,
  t,
  lang,
}: {
  channel: PerformanceOverview['channels'][number];
  t: ReturnType<typeof useTranslation>['t'];
  lang: 'de' | 'en';
}) {
  const cfg = getContentTypeConfig(channel.channel);
  const trendDelta = channel.trend?.delta ?? null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-fuchsia-50 text-lg">
            {cfg?.icon}
          </span>
          <div>
            <p className="text-sm font-bold text-gray-900">{cfg?.label}</p>
            <p className="text-[11px] text-gray-400">
              {t.perf_assets_logged.replace('{count}', String(channel.count))}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">{t.perf_avg_score}</p>
          <p className="text-lg font-extrabold text-gray-900">{channel.avgScore}</p>
          {trendDelta != null && (
            <p className={`text-[11px] font-bold ${trendDelta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {trendDelta >= 0 ? '↑' : '↓'} {Math.abs(trendDelta)} %
            </p>
          )}
        </div>
      </div>

      {/* Mini-Trend-Balken (pure CSS) */}
      {channel.weeklyScores.length > 1 ? (
        <div className="mt-4 flex h-12 items-end gap-1.5">
          {channel.weeklyScores.map((w) => (
            <div key={w.week} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t-md bg-gradient-to-t from-fuchsia-500 to-purple-500"
                style={{ height: `${Math.max(3, (w.avg / 100) * 36)}px` }}
                title={`${w.week}: ${w.avg}`}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex h-12 items-center justify-center rounded-xl bg-gray-50 text-xs text-gray-400">
          {t.perf_no_assets_channel}
        </div>
      )}

      {channel.bestAsset && (
        <div className="mt-4 rounded-xl border border-fuchsia-100 bg-fuchsia-50/50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fuchsia-600">
            {t.perf_best_asset}
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-gray-900">{channel.bestAsset.title}</p>
          <p className="mt-0.5 text-xs font-medium text-fuchsia-700">
            {metricsSummary(channel.bestAsset.metrics, channel.channel, lang)}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Asset-Formular (Performance erfassen) ──────────────────────────────────────
function AssetLogCard({
  asset,
  open,
  onToggle,
  formValues,
  dateValue,
  notesValue,
  saving,
  onField,
  onDate,
  onNotes,
  onSave,
  t,
  lang,
}: {
  asset: PublishedAsset;
  open: boolean;
  onToggle: () => void;
  formValues: Record<string, string>;
  dateValue: string;
  notesValue: string;
  saving: boolean;
  onField: (key: string, value: string) => void;
  onDate: (v: string) => void;
  onNotes: (v: string) => void;
  onSave: () => void;
  t: ReturnType<typeof useTranslation>['t'];
  lang: 'de' | 'en';
}) {
  const cfg = getContentTypeConfig(asset.channel as ContentType);
  const defs = CHANNEL_METRICS[asset.channel] ?? [];
  const prefill = asset.logged
    ? Object.fromEntries(Object.entries(asset.existingMetrics).map(([k, v]) => [k, String(v)]))
    : {};
  const hasValues = Object.keys(formValues).length > 0 || asset.logged;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm transition-all hover:shadow-md">
      <button onClick={onToggle} className="flex w-full items-start gap-3 p-4 text-left">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-fuchsia-50 text-lg">
          {cfg?.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-gray-900">{asset.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400">
            <span>{asset.projectTitle}</span>
            <span>·</span>
            <span>{cfg?.label}</span>
            {asset.plannedDate && (
              <>
                <span>·</span>
                <span>📅 {t.perf_log_planned}: {asset.plannedDate}</span>
              </>
            )}
            {asset.qualityScore != null && <ScoreBadge total={asset.qualityScore} size="sm" />}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
            asset.logged ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {asset.logged ? `✓ ${t.perf_log_logged}` : t.perf_log_not_logged}
        </span>
        <span className="shrink-0 text-gray-400">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 p-4">
          {!hasValues && defs.length > 0 && (
            <p className="mb-3 text-xs text-gray-400">{t.perf_log_expand}</p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {defs.map((def) => (
              <label key={def.key} className="block">
                <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-gray-600">
                  <span>{def.icon}</span> {def.label[lang]}
                </span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={formValues[def.key] ?? prefill[def.key] ?? ''}
                  onChange={(e) => onField(def.key, e.target.value)}
                  placeholder={def.placeholder}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-300 focus:border-fuchsia-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20"
                />
              </label>
            ))}
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-gray-600">
                <span>📅</span> {t.perf_log_published_at}
              </span>
              <input
                type="date"
                value={dateValue}
                onChange={(e) => onDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-fuchsia-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20"
              />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">{t.perf_log_notes}</span>
            <input
              type="text"
              value={notesValue}
              onChange={(e) => onNotes(e.target.value)}
              placeholder={t.perf_log_notes_placeholder}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-300 focus:border-fuchsia-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20"
            />
          </label>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={onSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:from-fuchsia-700 hover:to-purple-700 disabled:opacity-50"
            >
              {saving ? '…' : '💾'} {t.perf_log_save}
            </button>
            {asset.logged && (
              <span className="text-xs font-medium text-gray-400">✏️ {t.perf_log_updated}</span>
            )}
            <button onClick={onToggle} className="text-sm font-semibold text-gray-400 hover:text-gray-600">
              {t.perf_log_collapse}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Insights: Erfolgsfaktoren + Vorschläge + Datenlage ─────────────────────────
function InsightsSection({
  overview,
  t,
}: {
  overview: PerformanceOverview | null;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  if (!overview) return null;
  const factors = overview.successFactors.filter((f) => f.direction === 'positive');
  const suggestions = overview.suggestions;
  const sufficiency = overview.dataSufficiency;

  return (
    <section className="mt-8">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Erfolgsfaktoren */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-gray-900">{t.perf_insights_title}</h2>
          {factors.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">
              {t.perf_insights_empty.replace('{needed}', String(Math.max(sufficiency.needed, 3)))}
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {factors.map((f, i) => {
                const cfg = getContentTypeConfig(f.channel);
                return (
                  <div key={`${f.channel}-${f.factor}`} className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-gray-900">
                        <span className="mr-1">{cfg?.icon}</span>
                        {f.label}
                      </p>
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-extrabold text-emerald-700">
                        ×{f.magnitude}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{f.evidence}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Verbesserungsvorschläge */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-gray-900">{t.perf_suggestions_title}</h2>
          {suggestions.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">{t.perf_suggestions_empty}</p>
          ) : (
            <div className="mt-3 space-y-3">
              {suggestions.map((s, i) => {
                const cfg = getContentTypeConfig(s.channel);
                return (
                  <div key={`${s.channel}-${s.factor}-${i}`} className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
                    <p className="text-sm font-bold text-gray-900">
                      <span className="mr-1">{cfg?.icon}</span>
                      {s.action}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-600">
                      {t.perf_insights_evidence}: {s.reason}
                    </p>
                    <p className="mt-1 text-[11px] font-semibold text-amber-600">
                      {t.perf_suggestions_affected.replace('{n}', String(s.affectedAssets))}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Datenlage-Hinweis */}
          <div
            className={`mt-4 rounded-xl px-3 py-2.5 text-xs font-semibold ${
              sufficiency.enoughData ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {sufficiency.enoughData
              ? `✅ ${t.perf_sufficiency_ok}`
              : `⏳ ${t.perf_sufficiency.replace('{needed}', String(sufficiency.needed))}`}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Helfer ─────────────────────────────────────────────────────────────────────
/** Kompakte Metrik-Zusammenfassung, z. B. „620 Saves · 12.500 Impressionen“. */
function metricsSummary(metrics: Record<string, number>, channel: string, lang: 'de' | 'en'): string {
  const defs = CHANNEL_METRICS[channel] ?? [];
  const parts: string[] = [];
  const primary = defs.find((d) => !d.base) ?? defs[0];
  const base = defs.find((d) => d.base);
  if (primary && metrics[primary.key] != null) {
    parts.push(`${Number(metrics[primary.key]).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')} ${primary.label[lang]}`);
  }
  if (base && metrics[base.key] != null) {
    parts.push(`${Number(metrics[base.key]).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')} ${base.label[lang]}`);
  }
  return parts.join(' · ');
}
