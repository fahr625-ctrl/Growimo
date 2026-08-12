import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { useUser } from '@clerk/clerk-react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation, type Translations } from '~/i18n';
import { getAllContentByUser } from '~/store/projects';
import type { StoredContent } from '~/store/projects';
import { getContentTypeConfig, CONTENT_TYPE_REGISTRY } from '~/ai/content-types';
import type { ContentType, PublishPlanItem, PublishTask } from '~/ai/types';
import { buildPublishPlanServer, savePublishPlanServer, updateTaskDoneServer, getPublishPlanServer } from '~/ai/server';
import { ScoreBadge } from '~/components/ScoreBadge';

export const Route = createFileRoute('/app/calendar')({ component: CalendarPage });

type View = 'week' | 'month';
type StoredItem = StoredContent & { projectTitle: string };

// ── Date helpers ───────────────────────────────────────────────────────────────
function mondayOf(date: Date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }
/** YYYY-MM-DD (local time) — used as the schedule key for a day */
function dateKey(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function parseDateKey(key: string) { return new Date(`${key}T00:00:00`); }

// ── Static recommendations ─────────────────────────────────────────────────────
/** Best publishing times per channel (content type → translation key) */
const BEST_TIME_KEY: Record<ContentType, keyof Translations> = {
  pinterest_pin: 'calendar_best_time_pinterest',
  etsy_listing: 'calendar_best_time_etsy',
  seo_blog: 'calendar_best_time_blog',
  social_post: 'calendar_best_time_social',
  email_newsletter: 'calendar_best_time_social',
  marketing_plan: 'calendar_best_time_social',
  product_idea: 'calendar_best_time_social',
  trend_insight: 'calendar_best_time_social',
  marketing_analysis: 'calendar_best_time_social',
  market_intelligence: 'calendar_best_time_social',
};
/** Short channel label used in the weekly stats line */
function shortChannel(type: ContentType): string {
  if (type === 'pinterest_pin') return 'pins';
  if (type === 'seo_blog') return 'blog';
  if (type === 'etsy_listing') return 'etsy';
  return 'social';
}

function CalendarPage() { return <ProtectedRoute><CalendarContent /></ProtectedRoute>; }

function CalendarContent() {
  const { user } = useUser();
  const { t, locale } = useTranslation();
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [content, setContent] = useState<StoredItem[]>([]);
  const [loadingContent, setLoadingContent] = useState(true);

  // Load content from PostgreSQL
  useEffect(() => {
    let cancelled = false;
    setLoadingContent(true);
    getAllContentByUser(user?.id ?? 'anonymous')
      .then((items) => {
        if (!cancelled) setContent(items);
      })
      .catch((err) => {
        console.error('Failed to load calendar content:', err);
        if (!cancelled) setContent([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // ── F8 Veröffentlichungsplan (automatisch, deterministisch, persistiert) ───
  const [plan, setPlan] = useState<PublishPlanItem[]>([]);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [confirmRecreate, setConfirmRecreate] = useState(false);
  const [openTasks, setOpenTasks] = useState<Set<string>>(new Set());
  const BEST_TIME_I18N: Record<string, keyof Translations> = {
    pinterest: 'publish_plan_time_pinterest',
    etsy: 'publish_plan_time_etsy',
    blog: 'publish_plan_time_blog',
    social: 'publish_plan_time_social',
    newsletter: 'publish_plan_time_newsletter',
  };
  useEffect(() => {
    let cancelled = false;
    setLoadingPlan(true);
    getPublishPlanServer({ data: { userId: user?.id ?? 'anonymous' } })
      .then((items) => { if (!cancelled) setPlan(items ?? []); })
      .catch((err) => { console.error('Failed to load publish plan:', err); if (!cancelled) setPlan([]); })
      .finally(() => { if (!cancelled) setLoadingPlan(false); });
    return () => { cancelled = true; };
  }, [user?.id]);
  // Plan-Termine in die Kalender-Schedule aufnehmen (erscheinen an scheduledDate)
  useEffect(() => {
    if (plan.length === 0) return;
    setSchedule((prev) => {
      const next: Record<string, string[]> = {};
      for (const [k, ids] of Object.entries(prev)) next[k] = [...ids];
      for (const item of plan) {
        const k = item.scheduledDate;
        if (!next[k]) next[k] = [];
        if (!next[k].includes(item.assetId)) next[k] = [...next[k], item.assetId];
      }
      return next;
    });
  }, [plan]);
  const handleCreatePlan = async () => {
    if (!hasContent) return;
    setCreatingPlan(true);
    try {
      const built = await buildPublishPlanServer({ data: { userId: user?.id ?? 'anonymous', lang: locale } });
      const items = built?.items ?? [];
      if (items.length > 0) await savePublishPlanServer({ data: { userId: user?.id ?? 'anonymous', plan: built } });
      setPlan(items);
      setConfirmRecreate(false);
      showToast(t.publish_plan_saved_toast.replace('{n}', String(items.length)));
    } catch (err) {
      console.error('Publish plan failed:', err);
      showToast(t.publish_plan_error);
    } finally {
      setCreatingPlan(false);
    }
  };
  const handleToggleTask = async (item: PublishPlanItem, task: PublishTask) => {
    const next = plan.map((i) =>
      i.assetId === item.assetId
        ? { ...i, tasks: i.tasks.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)) }
        : i,
    );
    setPlan(next); // optimistic
    try {
      await updateTaskDoneServer({ data: { userId: user?.id ?? 'anonymous', itemId: item.assetId, taskId: task.id, done: !task.done } });
    } catch (err) {
      console.error('Task toggle failed:', err);
      setPlan(plan); // revert
    }
  };
  const toggleOpen = (id: string) =>
    setOpenTasks((prev) => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });

  const today = new Date();
  const monday = mondayOf(anchor);
  const fmt = locale === 'de' ? 'de-DE' : 'en-US';
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; }), [monday.getTime()]);

  // ── Client-side scheduling state (in-memory only, reset on refresh) ─────────
  // Maps date (YYYY-MM-DD) → array of content IDs scheduled for that day.
  const [schedule, setSchedule] = useState<Record<string, string[]>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<string | null>(null); // card with open mobile day-picker
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchDrag = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const initialized = useRef(false);

  const contentById = useMemo(() => new Map(content.map((c) => [c.id, c])), [content]);

  // Initialize schedule from createdAt dates of existing content on mount.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setSchedule((prev) => {
      const next: Record<string, string[]> = {};
      for (const [k, ids] of Object.entries(prev)) next[k] = [...ids];
      for (const item of content) {
        const k = dateKey(new Date(item.createdAt));
        if (!next[k]) next[k] = [];
        if (!next[k].includes(item.id)) next[k] = [...next[k], item.id];
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // contentId → dateKey of its scheduled day
  const scheduledDateOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const [k, ids] of Object.entries(schedule)) {
      for (const id of ids) if (!m.has(id)) m.set(id, k);
    }
    return m;
  }, [schedule]);

  // Week view: items are placed on the day column matching their scheduled
  // date when it falls inside the displayed week.
  const weekByDay = useMemo(() => {
    const map = new Map<number, StoredItem[]>();
    for (const [key, ids] of Object.entries(schedule)) {
      const idx = days.findIndex((d) => dateKey(d) === key);
      if (idx < 0) continue;
      const items = ids.map((id) => contentById.get(id)).filter((x): x is StoredItem => Boolean(x));
      map.set(idx, [...(map.get(idx) ?? []), ...items]);
    }
    return map;
  }, [schedule, days, contentById]);

  // Month view: dots on scheduled dates
  const byDay = useMemo(() => {
    const map = new Map<string, StoredItem[]>();
    for (const [k, ids] of Object.entries(schedule)) {
      const items = ids.map((id) => contentById.get(id)).filter((x): x is StoredItem => Boolean(x));
      if (items.length) map.set(k, items);
    }
    return map;
  }, [schedule, contentById]);

  // All items currently visible in the displayed week
  const weekItems = useMemo(() => {
    const all: StoredItem[] = [];
    for (const items of weekByDay.values()) all.push(...items);
    return all;
  }, [weekByDay]);
  const weekTypes = useMemo(() => Array.from(new Set(weekItems.map((i) => i.contentType))), [weekItems]);
  const weekStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of weekItems) {
      const label = shortChannel(item.contentType);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([label, n]) => `${n} ${label}`).join(', ');
  }, [weekItems]);

  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = mondayOf(monthStart);
  const monthDays = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const shift = (amount: number) => setAnchor(prev => { const d = new Date(prev); d.setDate(view === 'week' ? d.getDate() + amount * 7 : 1); if (view === 'month') d.setMonth(d.getMonth() + amount); return d; });
  const goToDay = (day: Date) => { setSelectedDay(day); setAnchor(mondayOf(day)); setView('week'); };
  const labelFor = (type: ContentType) => getContentTypeConfig(type) ?? CONTENT_TYPE_REGISTRY[0];
  const hasContent = content.length > 0;

  // ── Toast ────────────────────────────────────────────────────────────────────
  const showToast = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // ── Scheduling ───────────────────────────────────────────────────────────────
  const handleDrop = (id: string, targetKey: string) => {
    const item = contentById.get(id);
    if (!id || !item) return;
    setSchedule((prev) => {
      const next: Record<string, string[]> = {};
      for (const [k, ids] of Object.entries(prev)) next[k] = ids.filter((x) => x !== id);
      next[targetKey] = [...(next[targetKey] ?? []), id];
      return next;
    });
    const day = parseDateKey(targetKey);
    const dayName = day.toLocaleDateString(fmt, { weekday: 'long' });
    const dateStr = day.toLocaleDateString(fmt, { month: 'short', day: 'numeric' });
    const msg = t.calendar_scheduled_toast.replace('{day}', dayName).replace('{date}', dateStr);
    showToast(`${item.title} · ${msg}`);
  };

  // ── Touch drag (mobile fallback for HTML5 DnD) ───────────────────────────────
  const handleTouchStart = (e: TouchEvent<HTMLDivElement>, item: StoredItem) => {
    const touch = e.touches[0];
    touchDrag.current = { id: item.id, startX: touch.clientX, startY: touch.clientY, moved: false };
    setDraggingId(item.id);
  };
  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    const t = touchDrag.current;
    if (!t) return;
    const touch = e.touches[0];
    if (!t.moved && (Math.abs(touch.clientX - t.startX) > 10 || Math.abs(touch.clientY - t.startY) > 10)) t.moved = true;
    if (!t.moved) return;
    // Highlight the day column currently under the finger
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const dayEl = el?.closest?.('[data-day-key]') as HTMLElement | null;
    setDragOverKey(dayEl?.dataset.dayKey ?? null);
  };
  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const t = touchDrag.current;
    touchDrag.current = null;
    setDraggingId(null);
    setDragOverKey(null);
    if (!t?.moved) return;
    e.preventDefault(); // suppress the tap-through click on the card link
    const touch = e.changedTouches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const dayEl = el?.closest?.('[data-day-key]') as HTMLElement | null;
    if (dayEl?.dataset.dayKey) handleDrop(t.id, dayEl.dataset.dayKey);
  };

  if (loadingContent) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="flex items-center gap-3 text-gray-500">
            <svg className="h-6 w-6 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium">{t.common_loading}</span>
          </div>
        </div>
      </main>
    );
  }
  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
    <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-bold text-gray-900">{t.calendar_title}</h1><p className="mt-1 text-gray-500">{t.calendar_subtitle}</p></div>
      <div className="flex flex-wrap items-center gap-3"><div className="flex rounded-xl border border-gray-200 bg-gray-50 p-1"><button onClick={() => setView('week')} className={`rounded-lg px-4 py-2 text-sm font-medium ${view === 'week' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'}`}>{t.calendar_week}</button><button onClick={() => setView('month')} className={`rounded-lg px-4 py-2 text-sm font-medium ${view === 'month' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'}`}>{t.calendar_month}</button></div><Link to="/app/new-project" className="rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-purple-700">+ {t.calendar_new_strategy}</Link></div>
    </div>
    <section className="mb-6 overflow-hidden rounded-2xl border border-fuchsia-100 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-fuchsia-100 bg-gradient-to-r from-fuchsia-50 via-purple-50 to-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{t.publish_plan_title}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{t.publish_plan_subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {plan.length > 0 ? (
            <button
              onClick={() => setConfirmRecreate(true)}
              className="rounded-xl border border-fuchsia-200 bg-white px-4 py-2 text-sm font-semibold text-fuchsia-700 shadow-sm transition hover:bg-fuchsia-50"
            >🔄 {t.publish_plan_recreate}</button>
          ) : (
            <button
              onClick={handleCreatePlan}
              disabled={!hasContent || creatingPlan}
              className="rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-fuchsia-700 hover:to-purple-700 disabled:opacity-50"
            >✨ {creatingPlan ? t.publish_plan_creating : t.publish_plan_create}</button>
          )}
        </div>
      </div>
      {confirmRecreate && (
        <div className="border-b border-fuchsia-100 bg-fuchsia-50/40 px-5 py-3">
          <p className="text-sm font-semibold text-gray-800">{t.publish_plan_confirm_title}</p>
          <p className="mt-0.5 text-xs text-gray-500">{t.publish_plan_confirm_desc}</p>
          <div className="mt-2 flex gap-2">
            <button onClick={handleCreatePlan} disabled={creatingPlan} className="rounded-lg bg-fuchsia-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fuchsia-700">{t.publish_plan_confirm_ok}</button>
            <button onClick={() => setConfirmRecreate(false)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">{t.publish_plan_confirm_cancel}</button>
          </div>
        </div>
      )}
      {loadingPlan ? (
        <p className="px-5 py-6 text-center text-sm text-gray-400">{t.publish_plan_loading}</p>
      ) : plan.length === 0 ? (
        <div className="px-5 py-8 text-center">
          {!hasContent ? (
            <>
              <p className="text-sm text-gray-500">{t.publish_plan_empty_no_content}</p>
              <Link to="/app/new-project" className="mt-3 inline-block rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white">{t.publish_plan_empty_no_content_cta}</Link>
            </>
          ) : (
            <>
              <p className="mx-auto max-w-lg text-sm text-gray-500">{t.publish_plan_empty_no_plan}</p>
              <button
                onClick={handleCreatePlan}
                disabled={creatingPlan}
                className="mt-4 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:from-fuchsia-700 hover:to-purple-700 disabled:opacity-50"
              >✨ {creatingPlan ? t.publish_plan_creating : t.publish_plan_create}</button>
            </>
          )}
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          <p className="border-b border-gray-100 bg-gray-50/60 px-5 py-2 text-[11px] font-medium text-gray-400">{t.publish_plan_rule_cadence}</p>
          {plan.map((item) => {
            const cfg = labelFor(item.channel);
            const done = item.tasks.filter((x) => x.done).length;
            const open = openTasks.has(item.assetId);
            const dayLabel = item.scheduledDate === dateKey(new Date()) ? t.publish_plan_today : item.scheduledDate === dateKey(new Date(Date.now() + 86400000)) ? t.publish_plan_tomorrow : parseDateKey(item.scheduledDate).toLocaleDateString(fmt, { weekday: 'short', day: 'numeric', month: 'short' });
            return (
              <div key={item.assetId} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-lg border border-fuchsia-100 bg-fuchsia-50 px-2 py-1 text-xs font-semibold text-fuchsia-700">{cfg.icon} {cfg.label}</span>
                  {item.rank === 1 ? (
                    <span className="rounded-full bg-gradient-to-r from-fuchsia-600 to-purple-600 px-2.5 py-0.5 text-[11px] font-bold text-white">{t.publish_plan_publish_first}</span>
                  ) : (
                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] font-semibold text-gray-600">{t.publish_plan_rank.replace('{rank}', String(item.rank))}</span>
                  )}
                  {item.qualityScore != null && <ScoreBadge total={item.qualityScore} size="sm" />}
                </div>
                <div className="mt-2 flex flex-wrap items-start gap-x-3 gap-y-1">
                  <Link to="/app/projects/$projectId" params={{ projectId: item.projectId }} className="max-w-full truncate text-sm font-semibold text-gray-900 hover:text-fuchsia-700">{item.title || item.projectTitle}</Link>
                  <span className="text-xs text-gray-400">· {item.projectTitle}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">📅 {t.publish_plan_planned_for.replace('{date}', dayLabel)}</span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-purple-100 bg-purple-50 px-2.5 py-0.5 text-[11px] font-semibold text-purple-700">🕒 {t.publish_plan_best_time}: {t[BEST_TIME_I18N[item.bestTime] ?? 'publish_plan_time_social']}</span>
                  <button onClick={() => toggleOpen(item.assetId)} className="inline-flex items-center gap-1 text-xs font-semibold text-fuchsia-700 hover:text-fuchsia-900">
                    {open ? '▾' : '▸'} {t.publish_plan_tasks} · {t.publish_plan_tasks_progress.replace('{done}', String(done)).replace('{total}', String(item.tasks.length))}
                  </button>
                  <Link to="/app/projects/$projectId" params={{ projectId: item.projectId }} className="text-xs font-medium text-gray-400 hover:text-fuchsia-700">→ {t.publish_plan_link_project}</Link>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-gray-500">{item.rationale}</p>
                {open && item.tasks.length > 0 && (
                  <ul className="mt-3 space-y-1.5 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                    {item.tasks.map((task) => (
                      <li key={task.id}>
                        <label className="flex cursor-pointer items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={task.done}
                            onChange={() => handleToggleTask(item, task)}
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-fuchsia-600 focus:ring-fuchsia-500"
                          />
                          <span className={`text-xs leading-relaxed ${task.done ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{task.label}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-5 flex items-center justify-between"><button onClick={() => shift(-1)} className="rounded-lg px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100">← {t.calendar_prev}</button><div className="flex items-center gap-3"><h2 className="text-lg font-bold text-gray-900">{view === 'week' ? `${days[0].toLocaleDateString(fmt, { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString(fmt, { month: 'short', day: 'numeric', year: 'numeric' })}` : anchor.toLocaleDateString(fmt, { month: 'long', year: 'numeric' })}</h2>{view === 'week' && <button onClick={() => { setAnchor(new Date()); setSelectedDay(null); }} className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">{t.calendar_this_week}</button>}</div><button onClick={() => shift(1)} className="rounded-lg px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100">{t.calendar_next} →</button></div>
      {!hasContent ? <div className="py-16 text-center"><div className="mb-3 text-4xl">📅</div><p className="font-semibold text-gray-900">{t.calendar_empty}</p><Link to="/app/new-project" className="mt-4 inline-block rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white">{t.calendar_empty_cta}</Link></div> : view === 'week' ? (
        <div>
          {/* ── AI Publishing Tips panel ── */}
          {weekItems.length > 0 ? (
            <div className="mb-4 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50/60 to-purple-50/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-gray-800">💡 {t.calendar_publishing_tips}</h3>
                <span className="flex items-center gap-1 text-[11px] text-gray-400">⋮⋮ {t.calendar_drag_hint}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {weekTypes.map((type) => {
                  const config = labelFor(type);
                  return (
                    <div key={type} className="flex items-center gap-1.5 rounded-lg border border-blue-100/70 bg-white/70 px-2.5 py-1.5 text-xs text-gray-700">
                      <span>{config.icon}</span>
                      <span className="font-semibold">{config.label}</span>
                      <span className="text-gray-400">·</span>
                      <span className="font-medium text-blue-700">{t[BEST_TIME_KEY[type]]}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-blue-100/70 pt-3">
                <p className="text-xs font-semibold text-gray-800">📊 {t.calendar_this_week_stats.replace('{stats}', weekStats)}</p>
                <div className="flex min-h-7 flex-1 items-end gap-1.5" aria-hidden>
                  {days.map((day, i) => {
                    const count = (weekByDay.get(i) ?? []).length;
                    const max = Math.max(1, ...Array.from(weekByDay.values()).map((v) => v.length));
                    return (
                      <div key={dateKey(day)} className="flex flex-1 flex-col items-center gap-0.5">
                        <div className="flex h-5 w-full items-end justify-center">
                          <div
                            title={`${count}`}
                            className={`w-full max-w-4 rounded-t ${count > 0 ? 'bg-gradient-to-t from-blue-500 to-purple-400' : 'bg-gray-200/70'}`}
                            style={{ height: count > 0 ? `${Math.max(6, Math.round((count / max) * 20))}px` : '3px' }}
                          />
                        </div>
                        <span className="text-[9px] font-medium text-gray-400">{day.toLocaleDateString(fmt, { weekday: 'narrow' })}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-4 rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-4 text-center text-sm text-gray-500">💡 {t.calendar_empty_week}</div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-7">{days.map((day, i) => { const items = weekByDay.get(i) ?? []; const isToday = sameDay(day, today); const over = dragOverKey === dateKey(day); return (
            <div
              key={dateKey(day)}
              data-day-key={dateKey(day)}
              onDragOver={(e) => { e.preventDefault(); if (Array.from(e.dataTransfer.types).includes('text/plain')) setDragOverKey(dateKey(day)); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverKey((k) => (k === dateKey(day) ? null : k)); }}
              onDrop={(e) => { e.preventDefault(); setDragOverKey(null); const id = e.dataTransfer.getData('text/plain'); if (id) handleDrop(id, dateKey(day)); }}
              className={`min-h-40 rounded-xl border p-3 transition-colors ${isToday ? 'border-blue-200 bg-blue-50 ring-1 ring-blue-200' : 'border-gray-200 bg-gray-50/50'} ${over ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-200' : ''}`}
            >
              <div className="mb-3 flex items-center justify-between text-sm font-semibold text-gray-700"><span>{day.toLocaleDateString(fmt, { weekday: 'short' })}</span><span className={isToday ? 'rounded-full bg-blue-600 px-2 py-0.5 text-white' : ''}>{day.getDate()}</span></div>
              <div className="space-y-2">{items.map(item => { const config = labelFor(item.contentType); const isDragging = draggingId === item.id; return (
                <div key={item.id} className="relative touch-pan-y" onTouchStart={(e) => handleTouchStart(e, item)} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
                  <Link
                    to="/app/projects/$projectId"
                    params={{ projectId: item.projectId }}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', item.id); setDraggingId(item.id); }}
                    onDragEnd={() => setDraggingId(null)}
                    className={`group block rounded-xl border border-gray-200 bg-white p-2 pr-7 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${isDragging ? 'cursor-grabbing opacity-50 scale-95' : 'cursor-grab'}`}
                  >
                    <div className="flex items-center gap-1 text-xs font-semibold text-gray-700">
                      <span className="select-none text-gray-300 opacity-0 transition-opacity group-hover:opacity-100">⋮⋮</span>
                      <span>{config.icon}</span>
                      <span className="truncate">{config.label}</span>
                    </div>
                    <p className="mt-1 truncate text-xs font-medium text-gray-900">{item.title.slice(0, 40)}</p>
                    <p className="mt-1 truncate text-[11px] text-gray-500">{t.calendar_project}: {item.projectTitle}</p>
                  </Link>
                  <button
                    draggable={false}
                    onClick={() => setMoveFor((v) => (v === item.id ? null : item.id))}
                    aria-label={t.calendar_move}
                    title={t.calendar_move}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md text-lg leading-none text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                  >⋯</button>
                  {moveFor === item.id && (
                    <div className="absolute right-0 top-8 z-20 w-44 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                      <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t.calendar_move}</p>
                      {days.map((d) => { const k = dateKey(d); const isScheduled = scheduledDateOf.get(item.id) === k; return (
                        <button
                          key={k}
                          onClick={() => { handleDrop(item.id, k); setMoveFor(null); }}
                          className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-medium transition ${isScheduled ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}
                        >
                          <span>{d.toLocaleDateString(fmt, { weekday: 'short' })}</span>
                          <span>{d.getDate()}</span>
                        </button>
                      ); })}
                    </div>
                  )}
                </div>
              ); })}</div>
            </div>
          ); })}</div>
        </div>
      ) : <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-gray-200">{monthDays.map(day => { const items = byDay.get(dateKey(day)) ?? []; const inMonth = day.getMonth() === anchor.getMonth(); return <button key={dateKey(day)} onClick={() => items.length && goToDay(day)} className={`relative min-h-20 border-b border-r border-gray-200 p-2 text-left hover:bg-blue-50 ${!inMonth ? 'bg-gray-50 text-gray-400' : 'bg-white text-gray-700'}`}><span className={`inline-flex h-7 w-7 items-center justify-center text-sm ${sameDay(day, today) ? 'rounded-full bg-blue-600 font-bold text-white' : ''}`}>{day.getDate()}</span>{items.length > 0 && <span className="absolute bottom-2 left-3 h-1.5 w-1.5 rounded-full bg-blue-600" />}</button>; })}</div>}
    </section>
    {selectedDay && view === 'week' && <p className="mt-3 text-center text-xs text-gray-500">{selectedDay.toLocaleDateString(fmt, { weekday: 'long', month: 'long', day: 'numeric' })}</p>}
    {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-white px-5 py-3 text-sm font-medium text-gray-800 shadow-lg ring-1 ring-gray-200">{toast}</div>}
  </main>;
}
