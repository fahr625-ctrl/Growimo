import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { ProtectedRoute } from "~/components/ProtectedRoute";
import { useTranslation } from "~/i18n";
import { OWNER_USER_ID } from "~/lib/tracking";

export const Route = createFileRoute("/app/admin-analytics")({
  component: AdminAnalyticsPage,
});

type RangeKey = 7 | 30 | 90 | "all";

// Local report shape (counts only — never user ids). Mirrors
// AdminAnalyticsReport in src/db/admin-analytics.ts; defined locally so the
// client bundle never pulls in the server-only module (node:crypto).
interface AnalyticsReport {
  rangeDays: number | null;
  generatedAt: string;
  excludedOwnerTestActivity: boolean;
  excludedTestUsers: number;
  pseudonymExclusionActive: boolean;
  ttlDeleted: number;
  kpi: {
    views: number;
    uniquePseudonyms: number;
    anonymousViews: number;
    viewsToday: number;
    registrations: number;
    activeUsers: number;
  };
  trend: { day: string; views: number }[];
  topReferrers: { host: string; count: number }[];
  topUtmSources: { source: string; count: number }[];
  featureUsage: { event: string; count: number }[];
  generationByChannel: {
    channel: string;
    started: number;
    done: number;
    errors: number;
    avgMs: number | null;
    medianMs: number | null;
  }[];
  usersPerFunction: {
    function: string;
    users: number;
    source: "tracking" | "analytics";
    events: string[];
  }[];
}

const EVENT_LABEL_KEYS: Record<string, string> = {
  pageview: "analytics_event_pageview",
  generation_started: "analytics_event_generation_started",
  generation_finished: "analytics_event_generation_finished",
  user_registered: "tracking_event_user_registered",
  user_login: "tracking_event_user_login",
  project_created: "tracking_event_project_created",
  image_studio_opened: "tracking_event_image_studio_opened",
  image_generated: "tracking_event_image_generated",
  pinterest_pin_created: "tracking_event_pinterest_pin_created",
  package_or_pricing_opened: "tracking_event_package_or_pricing_opened",
  upgrade_clicked: "tracking_event_upgrade_clicked",
  tiktok_area_opened: "tracking_event_tiktok_area_opened",
  tiktok_created: "tracking_event_tiktok_created",
  tiktok_diagnosed: "tracking_event_tiktok_diagnosed",
};

const FUNCTION_LABEL_KEYS: Record<string, string> = {
  tiktok: "analytics_upf_tiktok",
  pinterest: "analytics_upf_pinterest",
  strategie: "analytics_upf_strategie",
  image_studio: "analytics_upf_image_studio",
  paket_preise: "analytics_upf_paket_preise",
  konto: "analytics_upf_konto",
};

const CHANNEL_LABEL_KEYS: Record<string, string> = {
  pinterest_pin: "analytics_channel_pinterest_pin",
  etsy_listing: "analytics_channel_etsy_listing",
  seo_blog: "analytics_channel_seo_blog",
  social_post: "analytics_channel_social_post",
  email_newsletter: "analytics_channel_email_newsletter",
  package: "analytics_channel_package",
  image: "analytics_channel_image",
  tiktok: "analytics_channel_tiktok",
};

function formatMs(ms: number | null, dash: string): string {
  if (ms === null || !Number.isFinite(ms)) return dash;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
}

// ── Owner-only gate ──────────────────────────────────────────────────────────
// ProtectedRoute ensures the user is signed in; this extra gate restricts the
// dashboard to the owner's Clerk id only (internal admin tool). Non-owners
// (and 401/403 report responses) see the lock screen — report data is never
// rendered for them.
function AdminAnalyticsPage() {
  const { user } = useUser();
  const { t } = useTranslation();
  if (!user || user.id !== OWNER_USER_ID) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
          <div className="text-3xl">🔒</div>
          <h1 className="mt-3 text-xl font-bold text-gray-900">{t.tracking_not_authorized}</h1>
          <p className="mt-2 text-sm text-gray-500">{t.tracking_not_authorized_desc}</p>
        </div>
      </div>
    );
  }
  return (
    <ProtectedRoute>
      <AdminAnalyticsContent />
    </ProtectedRoute>
  );
}

function AdminAnalyticsContent() {
  const { t } = useTranslation();
  const tAny = t as unknown as Record<string, string>;
  const [range, setRange] = useState<RangeKey>(30);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setForbidden(false);
    (async () => {
      try {
        const res = await fetch(
          `/api/admin-analytics?rangeDays=${range === "all" ? "all" : range}`,
        );
        if (res.status === 401 || res.status === 403) {
          if (!cancelled) {
            setReport(null);
            setForbidden(true);
          }
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as AnalyticsReport;
        if (!cancelled) setReport(data);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  // 401/403 from the report path → same lock screen as for non-owners.
  if (forbidden) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
          <div className="text-3xl">🔒</div>
          <h1 className="mt-3 text-xl font-bold text-gray-900">{t.tracking_not_authorized}</h1>
          <p className="mt-2 text-sm text-gray-500">{t.tracking_not_authorized_desc}</p>
        </div>
      </div>
    );
  }

  const kpi = report?.kpi;
  const isEmpty =
    report !== null &&
    (kpi?.views ?? 0) === 0 &&
    (kpi?.registrations ?? 0) === 0 &&
    (kpi?.activeUsers ?? 0) === 0 &&
    report.featureUsage.length === 0 &&
    report.generationByChannel.length === 0 &&
    report.usersPerFunction.length === 0;
  const maxFeature =
    report && report.featureUsage.length > 0
      ? Math.max(...report.featureUsage.map((e) => e.count), 1)
      : 1;
  const maxTrend =
    report && report.trend.length > 0
      ? Math.max(...report.trend.map((d) => d.views), 1)
      : 1;

  const functionLabel = (fn: string): string => {
    if (fn.startsWith("generierung:")) {
      const channel = fn.slice("generierung:".length);
      const channelLabel = tAny[CHANNEL_LABEL_KEYS[channel] ?? ""] ?? channel;
      return t.analytics_upf_generation.replace("%s", channelLabel);
    }
    return tAny[FUNCTION_LABEL_KEYS[fn] ?? ""] ?? fn;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.analytics_admin_title}</h1>
          <p className="mt-2 text-gray-500">{t.analytics_admin_subtitle}</p>
        </div>
        {/* Zeitraum-Umschalter */}
        <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
          {([7, 30, 90, "all"] as RangeKey[]).map((r) => (
            <button
              key={String(r)}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
                range === r
                  ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {r === "all"
                ? t.tracking_range_all
                : t.tracking_range_days.replace("%d", String(r))}
            </button>
          ))}
        </div>
      </header>

      {loading && <p className="py-16 text-center text-gray-400">{t.common_loading}</p>}
      {error && !loading && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {t.tracking_error}
        </div>
      )}
      {!loading && !error && report && isEmpty && (
        <div className="rounded-2xl border border-gray-100 bg-white p-12 text-center shadow-sm">
          <div className="text-3xl">📊</div>
          <p className="mt-3 text-sm font-medium text-gray-500">{t.analytics_empty}</p>
        </div>
      )}
      {!loading && !error && report && !isEmpty && (
        <>
          {/* Kennzahlen */}
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard label={t.analytics_kpi_views} value={kpi?.views ?? 0} icon="👁️" />
            <StatCard label={t.analytics_kpi_today} value={kpi?.viewsToday ?? 0} icon="📅" />
            <StatCard
              label={t.analytics_kpi_unique}
              value={kpi?.uniquePseudonyms ?? 0}
              icon="👥"
              note={t.analytics_unique_note}
            />
            <StatCard label={t.analytics_kpi_anon} value={kpi?.anonymousViews ?? 0} icon="🕵️" />
            <StatCard label={t.analytics_kpi_reg} value={kpi?.registrations ?? 0} icon="🆕" />
            <StatCard label={t.analytics_kpi_active} value={kpi?.activeUsers ?? 0} icon="🚀" />
          </section>

          {/* Trend: Besuche je Tag */}
          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900">{t.analytics_trend_title}</h2>
            {report.trend.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">{t.tracking_empty}</p>
            ) : (
              <div
                className="mt-4 flex h-40 items-end gap-1"
                role="img"
                aria-label={t.analytics_trend_title}
              >
                {report.trend.map((d) => (
                  <div
                    key={d.day}
                    className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                    title={`${d.day}: ${d.views}`}
                  >
                    <span className="text-[10px] font-semibold text-gray-500">{d.views}</span>
                    <div
                      className="w-full rounded-t bg-gradient-to-t from-blue-500 to-purple-500"
                      style={{ height: `${Math.max((d.views / maxTrend) * 100, d.views > 0 ? 4 : 1)}%` }}
                    />
                    <span className="hidden w-full truncate text-center text-[9px] text-gray-400 sm:block">
                      {d.day.slice(5)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Herkunft */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">{t.analytics_referrer_title}</h2>
              {report.topReferrers.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">{t.tracking_empty}</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {report.topReferrers.map((r) => (
                    <li key={r.host} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate font-medium text-gray-700">{r.host}</span>
                      <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-0.5 font-bold text-blue-700">
                        {r.count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">{t.analytics_utm_title}</h2>
              {report.topUtmSources.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">{t.tracking_empty}</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {report.topUtmSources.map((r) => (
                    <li key={r.source} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate font-medium text-gray-700">{r.source}</span>
                      <span className="shrink-0 rounded-full bg-purple-50 px-2.5 py-0.5 font-bold text-purple-700">
                        {r.count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Funktionsnutzung */}
          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900">{t.analytics_feature_title}</h2>
            {report.featureUsage.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">{t.tracking_empty}</p>
            ) : (
              <div className="mt-4 space-y-2.5">
                {[...report.featureUsage]
                  .sort((a, b) => b.count - a.count)
                  .map((e) => (
                    <div key={e.event} className="flex items-center gap-3">
                      <span className="w-48 shrink-0 truncate text-sm font-medium text-gray-700">
                        {tAny[EVENT_LABEL_KEYS[e.event] ?? ""] ?? e.event}
                      </span>
                      <div className="h-5 flex-1 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500"
                          style={{ width: `${Math.max((e.count / maxFeature) * 100, 4)}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-sm font-bold text-gray-900">
                        {e.count}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </section>

          {/* Generierung je Kanal */}
          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900">{t.analytics_gen_title}</h2>
            {report.generationByChannel.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">{t.tracking_empty}</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">{t.analytics_gen_channel}</th>
                      <th className="px-3 py-2 text-right">{t.analytics_gen_started}</th>
                      <th className="px-3 py-2 text-right">{t.analytics_gen_done}</th>
                      <th className="px-3 py-2 text-right">{t.analytics_gen_errors}</th>
                      <th className="px-3 py-2 text-right">{t.analytics_gen_avg}</th>
                      <th className="px-3 py-2 text-right">{t.analytics_gen_median}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.generationByChannel.map((g) => (
                      <tr key={g.channel}>
                        <td className="px-3 py-2 font-medium text-gray-900">
                          {tAny[CHANNEL_LABEL_KEYS[g.channel] ?? ""] ?? g.channel}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">{g.started}</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-600">
                          {g.done}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-red-500">
                          {g.errors}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {formatMs(g.avgMs, "–")}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {formatMs(g.medianMs, "–")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Nutzer je Funktion (nur Zählungen, nie IDs) */}
          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900">{t.analytics_users_title}</h2>
            <p className="mt-1 text-xs text-gray-400">{t.analytics_users_note}</p>
            {report.usersPerFunction.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">{t.tracking_empty}</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {report.usersPerFunction.map((u) => (
                  <li key={u.function} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-gray-700">{functionLabel(u.function)}</span>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 font-bold text-gray-900">
                      {t.analytics_users_count.replace("%d", String(u.users))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Meta */}
          <p className="text-center text-xs text-gray-400">
            {t.analytics_generated.replace("%s", new Date(report.generatedAt).toLocaleString())}
            {report.ttlDeleted > 0 &&
              ` · ${t.analytics_ttl_cleaned.replace("%d", String(report.ttlDeleted))}`}
            {!report.pseudonymExclusionActive && ` · ${t.analytics_no_salt}`}
          </p>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  note,
}: {
  label: string;
  value: number;
  icon: string;
  note?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">{label}</span>
        <span className="text-xl">{icon}</span>
      </div>
      <p className="mt-2 text-3xl font-extrabold text-gray-900">{value}</p>
      {note && <p className="mt-1 text-[11px] text-gray-400">{note}</p>}
    </div>
  );
}
