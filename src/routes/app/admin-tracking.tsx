import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { ProtectedRoute } from "~/components/ProtectedRoute";
import { useTranslation } from "~/i18n";
import { OWNER_USER_ID } from "~/lib/tracking";

export const Route = createFileRoute("/app/admin-tracking")({
  component: AdminTrackingPage,
});

type RangeKey = 7 | 30 | "all";
interface Report {
  rangeDays: number | null;
  excludedUserIds: string[];
  uniqueUsers: number;
  newRegistrations: number;
  activeUsers: number;
  eventsByType: { event: string; count: number }[];
  lastActivity: {
    userId: string;
    lastActive: string;
    firstSeen: string;
    eventCount: number;
  }[];
  funnel: { stage: string; users: number }[];
}

const EVENT_LABEL_KEYS: Record<string, string> = {
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

const FUNNEL_LABEL_KEYS: Record<string, string> = {
  user_registered: "tracking_funnel_stage_registered",
  project_created: "tracking_funnel_stage_project",
  asset_created: "tracking_funnel_stage_asset",
};

// ── Owner-only gate ──────────────────────────────────────────────────────────
// ProtectedRoute ensures the user is signed in; this extra gate restricts the
// dashboard to the owner's Clerk id only (internal admin tool).
function AdminTrackingPage() {
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
      <AdminTrackingContent />
    </ProtectedRoute>
  );
}

function AdminTrackingContent() {
  const { t } = useTranslation();
  const [range, setRange] = useState<RangeKey>(7);
  const [hideOwn, setHideOwn] = useState(true);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const tAny = t as unknown as Record<string, string>;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    (async () => {
      try {
        const res = await fetch("/api/admin-tracking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rangeDays: range === "all" ? "all" : range,
            hideOwnerTest: hideOwn,
          }),
        });
        if (res.status === 403 || res.status === 401) {
          if (!cancelled) {
            setReport(null);
            setError(true);
          }
          return;
        }
        const data = (await res.json()) as Report;
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
  }, [range, hideOwn]);

  const maxEventCount =
    report && report.eventsByType.length > 0
      ? Math.max(...report.eventsByType.map((e) => e.count), 1)
      : 1;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.tracking_admin_title}</h1>
          <p className="mt-2 text-gray-500">{t.tracking_admin_subtitle}</p>
        </div>
        {/* Zeitraum-Umschalter */}
        <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
          {([7, 30, "all"] as RangeKey[]).map((r) => (
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

      {/* Eigene Testaktivitäten ausblenden */}
      <label className="flex w-fit cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
        <input
          type="checkbox"
          checked={hideOwn}
          onChange={(e) => setHideOwn(e.target.checked)}
          className="h-4 w-4 accent-blue-600"
        />
        <span className="text-sm font-medium text-gray-700">{t.tracking_hide_own}</span>
      </label>

      {loading && <p className="py-16 text-center text-gray-400">{t.common_loading}</p>}
      {error && !loading && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {t.tracking_error}
        </div>
      )}
      {!loading && !error && report && (
        <>
          {/* Kennzahlen */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label={t.tracking_stat_unique} value={report.uniqueUsers} icon="👥" />
            <StatCard label={t.tracking_stat_new} value={report.newRegistrations} icon="🆕" />
            <StatCard label={t.tracking_stat_active} value={report.activeUsers} icon="🚀" />
          </section>

          {/* Event-Anzahl je Typ */}
          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900">{t.tracking_events_title}</h2>
            {report.eventsByType.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">{t.tracking_empty}</p>
            ) : (
              <div className="mt-4 space-y-2.5">
                {report.eventsByType.map((e) => (
                  <div key={e.event} className="flex items-center gap-3">
                    <span className="w-48 shrink-0 truncate text-sm font-medium text-gray-700">
                      {tAny[EVENT_LABEL_KEYS[e.event] ?? ""] ?? e.event}
                    </span>
                    <div className="h-5 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500"
                        style={{ width: `${Math.max((e.count / maxEventCount) * 100, 4)}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-sm font-bold text-gray-900">{e.count}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Funnel */}
          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900">{t.tracking_funnel_title}</h2>
            <p className="mt-1 text-xs text-gray-400">{t.tracking_funnel_note}</p>
            <div className="mt-4 flex flex-col gap-2">
              {report.funnel.map((s, i) => (
                <div key={s.stage} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 text-sm font-medium text-gray-700">
                    {tAny[FUNNEL_LABEL_KEYS[s.stage] ?? ""] ?? s.stage}
                  </span>
                  <div className="h-8 flex-1 overflow-hidden rounded-lg bg-gray-100">
                    <div
                      className="flex h-full items-center rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 px-2"
                      style={{
                        width: `${report.funnel[0]?.users ? (s.users / report.funnel[0].users) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="w-12 text-right text-sm font-bold text-gray-900">{s.users}</span>
                  {i < report.funnel.length - 1 && <span className="text-gray-300">↓</span>}
                </div>
              ))}
            </div>
          </section>

          {/* Letzte Aktivität je Nutzer */}
          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900">{t.tracking_last_activity_title}</h2>
            {report.lastActivity.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">{t.tracking_empty}</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">{t.tracking_last_activity_user}</th>
                      <th className="px-3 py-2">{t.tracking_last_activity_first}</th>
                      <th className="px-3 py-2">{t.tracking_last_activity_time}</th>
                      <th className="px-3 py-2">{t.tracking_last_activity_count}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.lastActivity.map((u) => (
                      <tr key={u.userId}>
                        <td className="px-3 py-2 font-mono text-xs text-gray-700">{u.userId}</td>
                        <td className="px-3 py-2 text-gray-500">
                          {new Date(u.firstSeen).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-900">
                          {new Date(u.lastActive).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{u.eventCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">{label}</span>
        <span className="text-xl">{icon}</span>
      </div>
      <p className="mt-2 text-3xl font-extrabold text-gray-900">{value}</p>
    </div>
  );
}
