import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useMemo, useEffect } from 'react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation } from '~/i18n';
import type { Translations } from '~/i18n';
import { timeAgo } from '~/lib/date';
import {
  getStats,
  getEvents,
  isAnalyticsEnabled,
  setAnalyticsEnabled,
  type AnalyticsEntry,
  type AnalyticsEvent,
} from '~/store/analytics';

export const Route = createFileRoute('/app/analytics')({
  component: AnalyticsPage,
});

// ── Event display config ─────────────────────────────────────────────────────────
const EVENT_CONFIG: Record<AnalyticsEvent, { icon: string; labelKey: keyof Translations }> = {
  signup: { icon: '👤', labelKey: 'analytics_event_signup' },
  signin: { icon: '🔑', labelKey: 'analytics_event_signin' },
  strategy_created: { icon: '✨', labelKey: 'analytics_event_strategy_created' },
  strategy_regenerated: { icon: '🔄', labelKey: 'analytics_event_strategy_regenerated' },
  content_exported: { icon: '📥', labelKey: 'analytics_event_content_exported' },
  project_saved: { icon: '💾', labelKey: 'analytics_event_project_saved' },
  feedback_submitted: { icon: '💬', labelKey: 'analytics_event_feedback_submitted' },
  onboarding_completed: { icon: '✅', labelKey: 'analytics_event_onboarding_completed' },
  onboarding_skipped: { icon: '⏭️', labelKey: 'analytics_event_onboarding_skipped' },
  brand_profile_saved: { icon: '🏷️', labelKey: 'analytics_event_brand_profile_saved' },
};

function AnalyticsPage() {
  return (
    <ProtectedRoute>
      <AnalyticsContent />
    </ProtectedRoute>
  );
}

function AnalyticsContent() {
  const { t, locale } = useTranslation();
  const [enabled, setEnabled] = useState<boolean>(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setEnabled(isAnalyticsEnabled());
  }, [refreshKey]);

  const stats = useMemo(() => getStats(), [refreshKey]);
  const events = useMemo(() => getEvents(), [refreshKey]);
  const hasData = stats.totalEvents > 0;

  const handleToggle = () => {
    const newState = !enabled;
    setAnalyticsEnabled(newState);
    setEnabled(newState);
    setRefreshKey((k) => k + 1);
  };

  // ── Days since first event ───────────────────────────────────────────────────
  const daysSinceFirst = useMemo(() => {
    if (!stats.firstEventDate) return 0;
    const first = new Date(stats.firstEventDate);
    const now = new Date();
    return Math.max(1, Math.ceil((now.getTime() - first.getTime()) / (1000 * 60 * 60 * 24)));
  }, [stats.firstEventDate]);

  const retentionRate = daysSinceFirst > 0
    ? Math.round((stats.uniqueDays / daysSinceFirst) * 100)
    : 0;

  // ── Events per day (last 14 days) ────────────────────────────────────────────
  const eventsPerDay = useMemo(() => {
    const days: { date: string; count: number }[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      days.push({ date: dateStr, count: 0 });
    }

    for (const e of events) {
      const day = e.timestamp.slice(0, 10);
      const found = days.find((d) => d.date === day);
      if (found) found.count++;
    }

    return days;
  }, [events]);

  const maxCountPerDay = Math.max(1, ...eventsPerDay.map((d) => d.count));

  // ── Channel usage from strategy_created metadata ──────────────────────────────
  const channelUsage = useMemo(() => {
    const channels: Record<string, number> = {};
    for (const e of events) {
      if (e.event === 'strategy_created' && e.metadata?.channels) {
        const chans = e.metadata.channels.split(',').map((c) => c.trim()).filter(Boolean);
        for (const ch of chans) {
          channels[ch] = (channels[ch] || 0) + 1;
        }
      }
    }
    return Object.entries(channels)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [events]);

  const maxChannelCount = Math.max(1, ...channelUsage.map(([, c]) => c));

  // ── Recent events (last 20) ──────────────────────────────────────────────────
  const recentEvents = useMemo(() => {
    return [...events].reverse().slice(0, 20);
  }, [events]);

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!hasData) {
    return (
      <div>
        <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">{t.analytics_title}</h1>
            <p className="mt-1 text-sm text-gray-500">{t.analytics_subtitle}</p>
          </div>
          <Link
            to="/app/performance"
            className="inline-flex items-center gap-1.5 rounded-xl border border-fuchsia-200 bg-fuchsia-50 px-4 py-2 text-sm font-semibold text-fuchsia-700 transition-all hover:bg-fuchsia-100"
          >
            {t.perf_dashboard_link}
          </Link>
        </div>

        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-100 to-purple-100">
            <span className="text-3xl">📊</span>
          </div>
          <h3 className="mt-4 text-sm font-semibold text-gray-900">{t.analytics_title}</h3>
          <p className="mt-1 text-sm text-gray-500">{t.analytics_empty}</p>
        </div>

        <AnalyticsFooter enabled={enabled} onToggle={handleToggle} />
      </div>
    );
  }

  // ── Full dashboard ───────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">{t.analytics_title}</h1>
          <p className="mt-1 text-sm text-gray-500">{t.analytics_subtitle}</p>
        </div>
        <Link
          to="/app/performance"
          className="inline-flex items-center gap-1.5 rounded-xl border border-fuchsia-200 bg-fuchsia-50 px-4 py-2 text-sm font-semibold text-fuchsia-700 transition-all hover:bg-fuchsia-100"
        >
          {t.perf_dashboard_link}
        </Link>
      </div>

      {/* KPI Row */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard
          icon="👤"
          value={stats.eventCounts.signup}
          label={t.analytics_signups}
        />
        <KPICard
          icon="✨"
          value={stats.eventCounts.strategy_created}
          label={t.analytics_strategies}
        />
        <KPICard
          icon="📅"
          value={`${retentionRate}%`}
          label={t.analytics_retention}
        />
        <KPICard
          icon="📥"
          value={stats.eventCounts.content_exported}
          label={t.analytics_exports}
        />
      </div>

      {/* Charts Row */}
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        {/* Events per day bar chart */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-bold text-gray-800">
            {t.analytics_events_per_day}
          </h3>
          <div className="flex items-end gap-1.5" style={{ height: '160px' }}>
            {eventsPerDay.map((day) => (
              <div
                key={day.date}
                className="group relative flex flex-1 flex-col items-center justify-end transition-all"
              >
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-blue-500 to-purple-500 transition-all hover:from-blue-600 hover:to-purple-600"
                  style={{
                    height: `${(day.count / maxCountPerDay) * 140}px`,
                    minHeight: day.count > 0 ? '4px' : '0',
                  }}
                />
                {/* Tooltip on hover */}
                <div className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none">
                  {day.count !== 1
                    ? t.analytics_events_count_plural.replace('%d', String(day.count))
                    : t.analytics_events_count.replace('%d', String(day.count))}
                </div>
                {/* Date label */}
                <span className="mt-1.5 text-[9px] text-gray-400 truncate w-full text-center">
                  {day.date.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Top channels horizontal bar chart */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-bold text-gray-800">
            {t.analytics_top_channels}
          </h3>
          {channelUsage.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">{t.analytics_empty}</p>
          ) : (
            <div className="space-y-3">
              {channelUsage.map(([channel, count], idx) => {
                const colors = [
                  'bg-blue-500',
                  'bg-purple-500',
                  'bg-pink-500',
                  'bg-blue-500',
                  'bg-emerald-500',
                  'bg-amber-500',
                  'bg-cyan-500',
                  'bg-rose-500',
                ];
                const color = colors[idx % colors.length];
                return (
                  <div key={channel} className="flex items-center gap-3">
                    <span className="w-24 flex-shrink-0 text-xs font-medium text-gray-600 truncate">
                      {channel}
                    </span>
                    <div className="flex flex-1 items-center gap-2">
                      <div className="h-5 flex-1 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={`h-full rounded-full ${color} transition-all`}
                          style={{
                            width: `${(count / maxChannelCount) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="w-8 text-right text-xs font-semibold text-gray-700">
                        {count}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent events timeline */}
      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-bold text-gray-800">
          {t.analytics_recent}
        </h3>
        <div className="space-y-2">
          {recentEvents.map((entry, idx) => {
            const config = EVENT_CONFIG[entry.event];
            return (
              <div
                key={idx}
                className="flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-gray-50"
              >
                <span className="flex-shrink-0 text-lg">
                  {config?.icon ?? '📌'}
                </span>
                <span className="flex-1 text-sm text-gray-700">
                  {config ? t[config.labelKey] : entry.event}
                  {entry.metadata?.contentTypes && (
                    <span className="ml-1.5 text-xs text-gray-400">
                      ({t.analytics_types_suffix.replace('%d', String(entry.metadata.contentTypes))})
                    </span>
                  )}
                  {entry.metadata?.channels && (
                    <span className="ml-1.5 text-xs text-gray-400">
                      ({entry.metadata.channels})
                    </span>
                  )}
                </span>
                <span className="flex-shrink-0 text-xs text-gray-400">
                  {timeAgo(entry.timestamp, t, locale)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* GDPR note + opt-out */}
      <AnalyticsFooter enabled={enabled} onToggle={handleToggle} />
    </div>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────────

function KPICard({
  icon,
  value,
  label,
}: {
  icon: string;
  value: string | number;
  label: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
      <span className="text-2xl">{icon}</span>
      <p className="mt-3 text-3xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-xs font-medium text-gray-500">{label}</p>
    </div>
  );
}

// ── Footer with opt-out ──────────────────────────────────────────────────────────

function AnalyticsFooter({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700">
              {t.analytics_optout}
            </span>
            <button
              type="button"
              onClick={onToggle}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                enabled ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          {!enabled && (
            <p className="mt-1 text-xs text-amber-600">
              {t.analytics_disabled}
            </p>
          )}
        </div>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-gray-400">
        {t.analytics_gdpr}
      </p>
    </div>
  );
}
