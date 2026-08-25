import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import type { ReactNode } from "react";
import { useUser } from "@clerk/clerk-react";
import { ProtectedRoute } from "~/components/ProtectedRoute";
import { useTranslation } from "~/i18n";
import OnboardingTour from "~/components/OnboardingTour";
import { trackEvent } from "~/store/analytics";
import { track } from "~/lib/tracking-client";
import {
  getProjectsByUser,
  getFavoriteProjects,
  getStats,
  getProjectContent,
  toggleFavorite,
  duplicateProject,
  deleteProject,
} from "~/store/projects";
import type { ContentType, Project } from "~/store/projects";
import { timeAgo as timeAgoFromLib } from "~/lib/date";

export const Route = createFileRoute("/app/")({
  component: DashboardPage,
});

// ── Content type display config ───────────────────────────────────────────────
const CONTENT_TYPE_CONFIG: Record<
  ContentType,
  { label: string; icon: string; color: string }
> = {
  pinterest_pin: {
    label: "Pinterest",
    icon: "📌",
    color: "bg-red-100 text-red-700",
  },
  seo_blog: {
    label: "SEO Blog",
    icon: "📝",
    color: "bg-blue-100 text-blue-700",
  },
  etsy_listing: {
    label: "Etsy",
    icon: "🛍️",
    color: "bg-orange-100 text-orange-700",
  },
  social_post: {
    label: "Social",
    icon: "📱",
    color: "bg-pink-100 text-pink-700",
  },
  email_newsletter: {
    label: "Email",
    icon: "📧",
    color: "bg-yellow-100 text-yellow-700",
  },
  marketing_plan: {
    label: "Marketing",
    icon: "📊",
    color: "bg-purple-100 text-purple-700",
  },
  product_idea: {
    label: "Product",
    icon: "💡",
    color: "bg-green-100 text-green-700",
  },
  trend_insight: {
    label: "Trends",
    icon: "📈",
    color: "bg-cyan-100 text-cyan-700",
  },
  marketing_analysis: {
    label: "Analyse",
    icon: "🔍",
    color: "bg-blue-100 text-blue-700",
  },
  market_intelligence: {
    label: "Market",
    icon: "📊",
    color: "bg-teal-100 text-teal-700",
  },
};

function timeAgo(date: Date, t: ReturnType<typeof useTranslation>['t'], locale: string): string {
  return timeAgoFromLib(date, t, locale);
}

// ── Quick-start examples ─────────────────────────────────────────────────────
const QUICKSTART_EXAMPLES = [
  { key: 'dashboard_example_1', value: 'Personalisierte Kerze aus Sojawachs' },
  { key: 'dashboard_example_2', value: 'Hundeleine aus Leder' },
  { key: 'dashboard_example_3', value: 'Print-on-Demand T-Shirt' },
  { key: 'dashboard_example_4', value: 'Personalisierte Trinkflasche' },
  { key: 'dashboard_example_5', value: 'Digitaler Haushaltsplaner' },
  { key: 'dashboard_example_6', value: 'Grußkarte für Geburtstag' },
];

// ── Analysis parsing helpers ──────────────────────────────────────────────────

/** Extract a `### Section` body from the structured marketing_analysis text. */
function extractSection(body: string, name: string): string | null {
  const regex = new RegExp(`###\\s*${name}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n###\\s|$)`, 'i');
  const m = body.match(regex);
  return m ? m[1].trim() : null;
}

/**
 * Pull 2–3 actionable recommendations out of a marketing_analysis body.
 * Prefers "Nächste Schritte (Top 3)", then "Prioritäten (Top 3)", then
 * "⚡ Quick Wins", and finally falls back to any bullet/numbered lines.
 */
function extractScore(body: string, sectionName: string): number | null {
  const section = extractSection(body, sectionName);
  if (!section || /nicht generiert|not generated/i.test(section)) return null;
  const match = section.match(/Score\s*:\s*(\d{1,3})\s*\/\s*100/i);
  return match ? Math.max(0, Math.min(100, Number(match[1]))) : null;
}

function extractCoach(body: string): string | null {
  return extractSection(body, '[🤖 ]?Marketing Coach');
}

function extractMission(body: string): { title: string; tasks: string[]; progress: number | null; lever: string | null } | null {
  const section = extractSection(body, '[🎯 ]?Marketing Mission');
  if (!section) return null;
  const lines = section.split('\n').map((line) => line.replace(/[*_]/g, '').trim()).filter(Boolean);
  const tasks = lines.filter((line) => /^(?:[-•]|\d+[.)])\s+/.test(line)).map((line) => line.replace(/^(?:[-•]|\d+[.)])\s+/, '')).slice(0, 3);
  const progressMatch = section.match(/(?:Fortschritt|Progress)\s*:?\s*(\d{1,3})\s*\/?\s*100/i);
  const leverMatch = section.match(/(?:Größter Hebel heute|Biggest Lever Today)\s*:?\s*(.+)/i);
  const title = lines.find((line) => !/^Score\s*:|^(?:Fortschritt|Progress)/i.test(line) && !/^(?:[-•]|\d+[.)])\s+/.test(line)) ?? '';
  return { title, tasks, progress: progressMatch ? Number(progressMatch[1]) : null, lever: leverMatch?.[1]?.trim() ?? null };
}

function parseRecommendations(body: string): string[] {
  const clean = (s: string) => s.replace(/\*\*/g, '').trim();

  // 1) Nächste Schritte: "1. **Action** — reason"
  const nextSteps = extractSection(body, 'Nächste Schritte \\(Top 3\\)');
  if (nextSteps) {
    const items: string[] = [];
    const bold = /^\d+\.\s*\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = bold.exec(nextSteps)) !== null) {
      items.push(`${clean(m[1])} — ${clean(m[2])}`);
    }
    if (items.length === 0) {
      const plain = /^\d+\.\s*(.+)$/gm;
      while ((m = plain.exec(nextSteps)) !== null) items.push(clean(m[1]));
    }
    if (items.length > 0) return items.slice(0, 3);
  }

  // 2) Prioritäten: "1. Title — Einfluss: Hoch — reason"
  const priorities = extractSection(body, 'Prioritäten \\(Top 3\\)');
  if (priorities) {
    const items: string[] = [];
    const re = /^\d+\.\s*(.+?)\s*[—–-]\s*Einfluss:\s*(Hoch|Mittel|Niedrig)\s*[—–-]\s*(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(priorities)) !== null) {
      items.push(`${clean(m[1])} — ${clean(m[3])}`);
    }
    if (items.length > 0) return items.slice(0, 3);
  }

  // 3) Quick Wins: "- **Quick Win**: title" / "⚡ Einfluss: Hoch — reason"
  const quickWins = extractSection(body, '⚡ Quick Wins');
  if (quickWins) {
    const items: string[] = [];
    const re = /\*\*Quick Win\*\*:\s*(.+?)(?:\n|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(quickWins)) !== null) items.push(clean(m[1]));
    if (items.length > 0) return items.slice(0, 3);
  }

  // 4) Generic fallback: first meaningful list lines anywhere in the body
  const generic: string[] = [];
  for (const line of body.split('\n')) {
    const cleaned = clean(line.replace(/^\s*(?:[-•*]|\d+\.)\s*/, ''));
    if (
      cleaned.length > 15 &&
      cleaned.length < 220 &&
      !cleaned.startsWith('###') &&
      !cleaned.startsWith('Score:')
    ) {
      generic.push(cleaned);
    }
    if (generic.length >= 3) break;
  }
  return generic;
}

// ── Date / greeting helpers ───────────────────────────────────────────────────

function dateFmtFor(locale: string): string {
  return locale === 'de' ? 'de-DE' : 'en-US';
}

function formatLongDate(date: Date, locale: string): string {
  return date.toLocaleDateString(dateFmtFor(locale), {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ── Week strip (content calendar mini preview) ───────────────────────────────

interface WeekDay {
  key: string;
  label: string;
  dayNum: number;
  planned: boolean;
  isToday: boolean;
}

function buildWeekDays(now: Date, locale: string): WeekDay[] {
  // Monday as start of week (getDay(): 0=Sun … 6=Sat → Monday offset)
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - ((now.getDay() + 6) % 7),
  );
  // Deterministic pseudo-random "planned" pattern derived from the week start,
  // so SSR and client render identical output (stable across re-renders).
  const seedStr = `${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`;
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) % 997;
  const fmt = dateFmtFor(locale);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return {
      key: `day-${i}`,
      label: d.toLocaleDateString(fmt, { weekday: 'short' }),
      dayNum: d.getDate(),
      planned: (seed + i * 131) % 10 < 4,
      isToday: d.toDateString() === now.toDateString(),
    };
  });
}

// ── Page ──────────────────────────────────────────────────────────────────────

function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}

function DashboardContent() {
  const { user } = useUser();
  const navigate = useNavigate();
  const { t, locale } = useTranslation();
  const userId = user?.id ?? "anonymous";
  const firstName = user?.firstName?.trim() ?? "";

  const [now, setNow] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "favorites">("all");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [copyingAll, setCopyingAll] = useState(false);
  const [sharingDashboard, setSharingDashboard] = useState(false);

  // ── PostgreSQL-backed state ──────────────────────────────────────────────
  const [baseProjects, setBaseProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState({
    projectCount: 0,
    contentCount: 0,
    distinctTypes: 0,
  });
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [analysisBody, setAnalysisBody] = useState<string | null>(null);

  // Set "now" on the client only, so greeting/date/week render identically
  // on server and client (avoids hydration mismatches).
  useEffect(() => {
    setNow(new Date());
  }, []);

  // Check if onboarding should show
  useEffect(() => {
    try {
      const completed = localStorage.getItem('growimo_onboarding_completed');
      const skipped = localStorage.getItem('growimo_onboarding_skipped');
      if (!completed && !skipped) {
        setShowOnboarding(true);
      }
      // Check for pending analytics event from signup/signin
      const pendingTrack = localStorage.getItem('growimo_pending_track');
      if (pendingTrack === 'signup') {
        trackEvent('signup');
        // Server-side beta-tracking (additive): fresh registration
        track('user_registered', user?.id);
        localStorage.removeItem('growimo_pending_track');
      } else if (pendingTrack === 'signin') {
        trackEvent('signin');
        // Server-side beta-tracking (additive): successful sign-in
        track('user_login', user?.id);
        localStorage.removeItem('growimo_pending_track');
      }
    } catch {
      // localStorage may not be available
    }
  }, []);

  const forceRefresh = () => setRefreshKey((k) => k + 1);
  const quickActions = [
    { title: t.package_dashboard_title, desc: t.package_dashboard_desc, icon: '✨', to: '/app/package', style: 'border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 via-white to-purple-50', iconStyle: 'bg-fuchsia-100' },
    { title: t.dashboard_task_publish_pin, desc: t.dashboard_task_publish_pin_desc, icon: '📌', to: '/app/generate/pinterest', style: 'border-pink-100 bg-gradient-to-br from-rose-50 to-white', iconStyle: 'bg-rose-100' },
    { title: t.dashboard_task_improve_etsy, desc: t.dashboard_task_improve_etsy_desc, icon: '🛍️', to: '/app/generate/etsy', style: 'border-amber-100 bg-gradient-to-br from-amber-50 to-white', iconStyle: 'bg-amber-100' },
    { title: t.dashboard_task_create_blog, desc: t.dashboard_task_create_blog_desc, icon: '📝', to: '/app/generate/blog', style: 'border-blue-100 bg-gradient-to-br from-blue-50 to-white', iconStyle: 'bg-blue-100' },
    { title: t.dashboard_tools_image_studio, desc: t.dashboard_tools_image_studio_desc, icon: '🎨', to: '/app/image-studio', style: 'border-purple-100 bg-gradient-to-br from-purple-50 to-white', iconStyle: 'bg-purple-100' },
  ];

  // Load projects + stats from PostgreSQL
  useEffect(() => {
    let cancelled = false;
    setLoadingProjects(true);
    const load = async () => {
      try {
        const [projects, statsData] = await Promise.all([
          filterTab === "favorites"
            ? getFavoriteProjects(userId)
            : getProjectsByUser(userId),
          getStats(userId),
        ]);
        if (cancelled) return;
        setBaseProjects(projects);
        setStats(statsData);
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
        if (!cancelled) setBaseProjects([]);
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId, filterTab, refreshKey]);

  const projects = useMemo(() => {
    if (!searchQuery.trim()) return baseProjects;
    const lower = searchQuery.toLowerCase();
    return baseProjects.filter(
      (p) =>
        p.title.toLowerCase().includes(lower) ||
        p.productIdea.toLowerCase().includes(lower),
    );
  }, [baseProjects, searchQuery]);

  const handleToggleFavorite = async (projectId: string) => {
    try {
      await toggleFavorite(projectId);
    } catch (err) {
      console.error("toggleFavorite failed:", err);
    }
    forceRefresh();
  };

  const handleDuplicate = async (projectId: string) => {
    let dup: Project | undefined;
    try {
      dup = await duplicateProject(projectId, userId);
    } catch (err) {
      console.error("duplicateProject failed:", err);
    }
    setOpenMenuId(null);
    forceRefresh();
    if (dup) {
      navigate({ to: "/app/projects/$projectId", params: { projectId: dup.id } });
    }
  };

  const handleDelete = async (projectId: string) => {
    setOpenMenuId(null);
    if (confirm(t.dashboard_delete_confirm)) {
      try {
        await deleteProject(projectId);
      } catch (err) {
        console.error("deleteProject failed:", err);
      }
      forceRefresh();
    }
  };

  const handleExampleClick = (idea: string) => {
    const encoded = encodeURIComponent(idea);
    navigate({ to: `/app/new-project?idea=${encoded}` });
  };

  const hasProjects = baseProjects.length > 0;

  // ── Command-center derived data ─────────────────────────────────────────────
  const analysisProjects = useMemo(
    () => baseProjects.filter((p) => p.contentTypes.includes('marketing_analysis')),
    [baseProjects],
  );
  const latestAnalysisProject = analysisProjects[0] ?? null;

  // Load the marketing_analysis body for the latest analysis project
  useEffect(() => {
    let cancelled = false;
    if (!latestAnalysisProject) {
      setAnalysisBody(null);
      return;
    }
    getProjectContent(latestAnalysisProject.id)
      .then((contents) => {
        if (cancelled) return;
        const c = contents.find((x) => x.contentType === 'marketing_analysis');
        setAnalysisBody(c?.body ?? null);
      })
      .catch((err) => {
        console.error("Failed to load analysis content:", err);
        if (!cancelled) setAnalysisBody(null);
      });
    return () => {
      cancelled = true;
    };
  }, [latestAnalysisProject?.id, refreshKey]);

  const recommendations = useMemo(
    () => (analysisBody ? parseRecommendations(analysisBody) : []),
    [analysisBody],
  );
  const scores = useMemo(() => ({
    content: analysisBody ? extractScore(analysisBody, 'Gesamtbewertung') : null,
    seo: analysisBody ? extractScore(analysisBody, 'SEO-Analyse') : null,
    pinterest: analysisBody ? extractScore(analysisBody, 'Pinterest-Analyse') : null,
    etsy: analysisBody ? extractScore(analysisBody, 'Etsy-Analyse') : null,
  }), [analysisBody]);
  const coach = useMemo(() => analysisBody ? extractCoach(analysisBody) : null, [analysisBody]);
  const mission = useMemo(() => analysisBody ? extractMission(analysisBody) : null, [analysisBody]);

  // Premium command-center metrics are derived exclusively from the existing dashboard data.
  const marketingScore = useMemo(() => {
    const values = [scores.content, scores.seo, scores.pinterest, scores.etsy].filter(
      (value): value is number => value !== null,
    );
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  }, [scores]);
  const strategyCompletion = useMemo(() => {
    const hasContent = stats.contentCount > 0;
    const hasAnalysis = analysisBody !== null;
    // A generated channel represents a completed/visited generation surface. This keeps
    // the metric useful for existing accounts without introducing another data source.
    const visitedGeneratePages = ['pinterest_pin', 'etsy_listing', 'seo_blog'].every((type) =>
      baseProjects.some((project) => project.contentTypes.includes(type as ContentType)),
    );
    return Math.round((hasProjects ? 25 : 0) + (hasContent ? 25 : 0) + (hasAnalysis ? 25 : 0) + (visitedGeneratePages ? 25 : 0));
  }, [stats.contentCount, analysisBody, baseProjects, hasProjects]);
  const copyAllContent = async () => {
    if (copyingAll) return;
    setCopyingAll(true);
    const text = baseProjects.map((project) => `${project.title}\n${project.productIdea}`).join('\n\n');
    try {
      await navigator.clipboard.writeText(text || 'No generated content yet.');
      window.alert(t.dashboard_all_copied);
    } catch { window.alert(t.common_copy_failed); }
    finally { setCopyingAll(false); }
  };
  const shareDashboard = async () => {
    if (sharingDashboard) return;
    setSharingDashboard(true);
    try {
      await navigator.clipboard.writeText(window.location.href);
      window.alert(t.dashboard_link_copied);
    } catch { window.alert(t.common_copy_link_failed); }
    finally { setSharingDashboard(false); }
  };

  const greeting = useMemo(() => {
    const hour = now?.getHours() ?? new Date().getHours();
    if (hour < 12) return t.dashboard_greeting_morning;
    if (hour < 18) return t.dashboard_greeting_afternoon;
    return t.dashboard_greeting_evening;
  }, [now, t]);

  const dateStr = now ? formatLongDate(now, locale) : '';
  const weekDays = useMemo(
    () => buildWeekDays(now ?? new Date(), locale),
    [now, locale],
  );

  // ── Getting-started checklist state (persisted) ────────────────────────────
  const [gsSteps, setGsSteps] = useState<boolean[]>(() => {
    if (typeof window === 'undefined') return [false, false, false];
    try {
      const raw = window.localStorage.getItem('growimo_getting_started');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return [Boolean(parsed[0]), Boolean(parsed[1]), Boolean(parsed[2])];
        }
      }
    } catch {
      // ignore corrupt value
    }
    return [false, false, false];
  });

  const toggleGsStep = (index: number) => {
    setGsSteps((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      try {
        window.localStorage.setItem('growimo_getting_started', JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loadingProjects) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <svg className="h-6 w-6 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm font-medium">{t.common_loading}</span>
        </div>
      </div>
    );
  }

  // ── Empty state: premium Welcome + CTA + Quick-start + How-it-works ─────────
  if (!hasProjects) {
    return (
      <>
        {showOnboarding && (
          <OnboardingTour
            onComplete={() => setShowOnboarding(false)}
            onSkip={() => setShowOnboarding(false)}
          />
        )}
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Welcome hero */}
          <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br from-blue-50/70 via-white to-purple-50/70 p-8 sm:p-10 text-center shadow-sm">
            <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-purple-200/30 blur-3xl" />
            <div className="absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-blue-200/30 blur-3xl" />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-white/80 px-3 py-1 text-xs font-semibold text-blue-700 shadow-sm">
              ✨ {t.dashboard_welcome}
            </span>
            <h1 className="mt-4 text-2xl sm:text-3xl font-bold text-gray-900">
              {firstName
                ? t.dashboard_welcome_hero.replace('%s', firstName)
                : t.dashboard_welcome_hero.replace(', %s', '')}
            </h1>
            <p className="mt-3 text-sm text-gray-500 max-w-xl mx-auto leading-relaxed">
              {t.dashboard_welcome_subtitle}
            </p>

            {/* Primary CTA button */}
            <div className="mt-6 flex justify-center">
              <Link
                to="/app/new-project"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-xl hover:-translate-y-0.5"
              >
                {t.dashboard_cta_create}
              </Link>
            </div>
          </div>

          {/* Getting Started checklist */}
          <GettingStartedCard steps={gsSteps} onToggle={toggleGsStep} t={t} />

          {/* Quick Start examples */}
          <div>
            <p className="mb-3 text-sm font-medium text-gray-500">
              {t.dashboard_quickstart_label}
            </p>
            <div className="flex flex-wrap gap-2.5">
              {QUICKSTART_EXAMPLES.map((example) => (
                <button
                  key={example.key}
                  type="button"
                  onClick={() => handleExampleClick(example.value)}
                  className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 cursor-pointer transition-all duration-200 hover:bg-blue-50 hover:border-blue-300 hover:-translate-y-0.5 hover:shadow-sm"
                >
                  {t[example.key as keyof typeof t] ?? example.value}
                </button>
              ))}
            </div>
          </div>

          {/* How it works card */}
          <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/70 to-purple-50/50 p-6 shadow-sm">
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              {t.dashboard_how_title}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-xs font-bold text-white">
                  1
                </span>
                <span className="text-sm text-gray-700 pt-0.5">
                  {t.dashboard_how_step1}
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-xs font-bold text-white">
                  2
                </span>
                <span className="text-sm text-gray-700 pt-0.5">
                  {t.dashboard_how_step2}
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-xs font-bold text-white">
                  3
                </span>
                <span className="text-sm text-gray-700 pt-0.5">
                  {t.dashboard_how_step3}
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-xs font-bold text-white">
                  4
                </span>
                <span className="text-sm text-gray-700 pt-0.5">
                  {t.dashboard_how_step4}
                </span>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── Has projects: AI Marketing Command Center ───────────────────────────────
  return (
    <>
      {showOnboarding && (
        <OnboardingTour
          onComplete={() => setShowOnboarding(false)}
          onSkip={() => setShowOnboarding(false)}
        />
      )}
      <div className="space-y-6">
        {/* ── 1. Welcome header ───────────────────────────────────────────── */}
        <WelcomeHeader
          greeting={greeting}
          firstName={firstName}
          dateStr={dateStr}
          projectCount={baseProjects.length}
          t={t}
        />

        {/* ── Premium marketing command center ─────────────────────────────── */}
        <section className="relative overflow-hidden rounded-3xl border border-blue-100 bg-gradient-to-br from-white via-blue-50/60 to-purple-50/70 p-6 shadow-md sm:p-8">
          <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-purple-200/30 blur-3xl" />
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-6 sm:gap-8">
              <div className="relative h-32 w-32 shrink-0 sm:h-40 sm:w-40">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="#e5e7eb" strokeWidth="10" />
                  <circle cx="60" cy="60" r="50" fill="none" stroke="url(#marketing-score-gradient)" strokeWidth="10" strokeLinecap="round" strokeDasharray={314} strokeDashoffset={314 - marketingScore * 3.14} />
                  <defs><linearGradient id="marketing-score-gradient" x1="0" x2="1"><stop stopColor="#2563eb" /><stop offset="1" stopColor="#9333ea" /></linearGradient></defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-4xl font-bold tracking-tight text-gray-900">{marketingScore}</span><span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">/ 100</span></div>
              </div>
              <div><p className="text-sm font-semibold uppercase tracking-wider text-blue-600">{t.dashboard_marketing_score}</p><h2 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">{t.dashboard_growth_at_glance}</h2><p className="mt-2 max-w-sm text-sm leading-relaxed text-gray-500">{t.dashboard_readiness_desc}</p><p className="mt-3 text-xs font-semibold text-emerald-600">{t.dashboard_momentum}</p></div>
            </div>
            <div className="w-full max-w-sm rounded-2xl border border-white/80 bg-white/70 p-5 shadow-sm">
              <div className="flex items-center justify-between"><p className="text-sm font-semibold text-gray-800">{t.dashboard_strategy_completion}</p><span className="text-lg font-bold text-gray-900">{strategyCompletion}%</span></div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-purple-600 transition-all" style={{ width: `${strategyCompletion}%` }} /></div>
              <p className="mt-3 text-xs text-gray-500">{t.dashboard_foundation_hint}</p>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{t.dashboard_next_actions}</p><h2 className="mt-1 text-xl font-bold text-gray-900">{t.dashboard_priority_tasks}</h2></div><span className="text-xs text-gray-400">{t.dashboard_actions_count.replace('%d', String(quickActions.length))}</span></div>
          <div className="grid gap-4 md:grid-cols-3">
            {quickActions.map((task) => <Link key={task.title} to={task.to} className={`group rounded-2xl border p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md ${task.style}`}><div className="flex items-start justify-between"><span className={`flex h-11 w-11 items-center justify-center rounded-xl text-xl ${task.iconStyle}`}>{task.icon}</span><span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-white/80 text-xs text-gray-300 shadow-sm">○</span></div><h3 className="mt-4 text-base font-bold text-gray-900 group-hover:text-blue-700">{task.title}</h3><p className="mt-1 text-sm leading-relaxed text-gray-500">{task.desc}</p><span className="mt-4 inline-flex text-xs font-semibold text-gray-700 group-hover:text-blue-700">{t.dashboard_start_now} →</span></Link>)}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <button type="button" onClick={copyAllContent} disabled={copyingAll} className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-3 text-sm font-semibold text-gray-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"><span>📋</span> {copyingAll ? t.common_loading : t.common_copy_all}</button>
            <button type="button" onClick={() => window.alert(t.common_coming_soon)} className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-3 text-sm font-semibold text-gray-700 transition hover:border-blue-300 hover:bg-blue-50"><span>📄</span> {t.dashboard_download_pdf}</button>
            <Link to="/app/new-project" className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-3 text-sm font-semibold text-gray-700 transition hover:border-blue-300 hover:bg-blue-50"><span>🔄</span> {t.dashboard_regenerate}</Link>
            <button type="button" onClick={shareDashboard} disabled={sharingDashboard} className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-3 text-sm font-semibold text-gray-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"><span>🔗</span> {sharingDashboard ? t.common_loading : t.dashboard_share}</button>
          </div>
        </section>

        {/* ── 2. KPI overview cards ───────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            accent="border-l-blue-500"
            gradient="bg-gradient-to-br from-blue-50/70 via-white to-purple-50/40"
            tint="bg-blue-50 text-blue-600"
            label={t.dashboard_kpi_projects}
            value={stats.projectCount}
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
            }
          />
          <KpiCard
            accent="border-l-purple-500"
            gradient="bg-gradient-to-br from-purple-50/70 via-white to-blue-50/40"
            tint="bg-purple-50 text-purple-600"
            label={t.dashboard_kpi_content}
            value={stats.contentCount}
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6M9 8h1m4 0h1M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
              </svg>
            }
          />
          <KpiCard
            accent="border-l-emerald-500"
            gradient="bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/40"
            tint="bg-emerald-50 text-emerald-600"
            label={t.dashboard_kpi_channels}
            value={stats.distinctTypes}
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
          />
          <KpiCard
            accent="border-l-amber-500"
            gradient="bg-gradient-to-br from-amber-50/70 via-white to-orange-50/40"
            tint="bg-amber-50 text-amber-600"
            label={t.dashboard_kpi_insights}
            value={analysisProjects.length}
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
            }
          />
        </div>

        {/* ── 3. Performance scores ────────────────────────────────────────── */}
        <PerformanceScores scores={scores} t={t} />

        {/* ── 4. AI Recommendations panel ──────────────────────────────────── */}
        <AIRecommendationsPanel
          recommendations={recommendations}
          hasAnalysis={analysisBody !== null}
          latestProjectId={latestAnalysisProject?.id ?? null}
          coach={coach}
          mission={mission}
          t={t}
        />

        {/* ── 4. Quick Tools grid ──────────────────────────────────────────── */}
        <QuickToolsGrid t={t} />

        {/* ── 5. Content calendar mini preview ─────────────────────────────── */}
        <CalendarMiniPreview days={weekDays} t={t} />

        {/* ── 6. Recent Projects ───────────────────────────────────────────── */}
        <div className="pt-2">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-gray-900">
              {t.dashboard_recent_title}
            </h2>
            <div className="mt-3 border-t border-gray-200" />
          </div>

          {/* Search + Filter row */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Search bar */}
            <div className="relative flex-1 max-w-md">
              <svg
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.dashboard_search_placeholder}
                className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setFilterTab("all")}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                  filterTab === "all"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t.dashboard_filter_all}
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("favorites")}
                className={`inline-flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                  filterTab === "favorites"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t.dashboard_filter_favorites}
              </button>
            </div>
          </div>

          {/* Project cards grid */}
          {projects.length === 0 ? (
            <EmptyState hasSearch={searchQuery.trim().length > 0} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isMenuOpen={openMenuId === project.id}
                  onToggleMenu={() =>
                    setOpenMenuId(openMenuId === project.id ? null : project.id)
                  }
                  onFavorite={() => handleToggleFavorite(project.id)}
                  onDuplicate={() => handleDuplicate(project.id)}
                  onDelete={() => handleDelete(project.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Welcome Header ─────────────────────────────────────────────────────────────

function WelcomeHeader({
  greeting,
  firstName,
  dateStr,
  projectCount,
  t,
}: {
  greeting: string;
  firstName: string;
  dateStr: string;
  projectCount: number;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
          {greeting}
          {firstName ? `, ${firstName}` : ''} 👋
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">
          {dateStr}
          <span className="mx-2 text-gray-300">•</span>
          {projectCount} {projectCount === 1 ? t.dashboard_count_singular : t.dashboard_count_plural}
        </p>
      </div>
      <Link
        to="/app/new-project"
        className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-xl hover:-translate-y-0.5"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 4v16m8-8H4"
          />
        </svg>
        {t.dashboard_cta_new}
      </Link>
    </div>
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KpiCard({
  accent,
  gradient,
  tint,
  label,
  value,
  icon,
}: {
  accent: string;
  gradient: string;
  tint: string;
  label: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-gray-200 border-l-4 ${gradient} p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${accent}`}
    >
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tint}`}>
        {icon}
      </div>
      <p className="mt-3 text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-gray-500">{label}</p>
    </div>
  );
}

// ── AI Recommendations Panel ───────────────────────────────────────────────────

function AIRecommendationsPanel({
  recommendations,
  hasAnalysis,
  latestProjectId,
  coach,
  mission,
  t,
}: {
  recommendations: string[];
  hasAnalysis: boolean;
  latestProjectId: string | null;
  coach: string | null;
  mission: { title: string; tasks: string[]; progress: number | null; lever: string | null } | null;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-gradient-to-br from-blue-50/50 to-purple-50/30 p-6 shadow-[0_0_28px_rgba(191,219,254,0.55)] transition-all duration-200 hover:shadow-[0_0_40px_rgba(191,219,254,0.7)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-900 [text-shadow:0_0_22px_rgba(139,92,246,0.45)]">
            {t.dashboard_ai_title}
          </h2>
          {hasAnalysis && (
            <p className="mt-1 text-xs text-gray-500">
              {t.dashboard_ai_subtitle}
            </p>
          )}
        </div>
        {hasAnalysis && latestProjectId && (
          <Link
            to="/app/projects/$projectId"
            params={{ projectId: latestProjectId }}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white/80 px-3.5 py-2 text-xs font-semibold text-blue-700 shadow-sm transition-all hover:border-blue-300 hover:bg-white hover:shadow"
          >
            🔍 {t.dashboard_ai_view}
          </Link>
        )}
      </div>

      {recommendations.length > 0 ? (
        <ul className="mt-4 space-y-2.5">
          {recommendations.map((rec, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-xl border border-gray-200/80 bg-white/85 p-3.5 shadow-sm"
            >
              <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                <svg
                  className="h-3 w-3 text-emerald-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <p className="text-sm leading-relaxed text-gray-700">{rec}</p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white/70 p-6 text-center">
          <span className="text-2xl">🤖</span>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
            {t.dashboard_ai_empty}
          </p>
          <Link
            to="/app/new-project"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-lg hover:-translate-y-0.5"
          >
            {t.dashboard_ai_empty_cta}
          </Link>
        </div>
      )}

      {coach && <div className="mt-4 rounded-xl border border-purple-100 bg-white/80 p-4">
        <h3 className="text-sm font-semibold text-gray-900">🤖 {t.dashboard_coach_title}</h3>
        <blockquote className="mt-2 border-l-4 border-purple-300 pl-3 text-sm italic leading-relaxed text-gray-600">{coach}</blockquote>
      </div>}
      {mission && <div className="mt-4 rounded-xl border border-blue-100 bg-white/80 p-4">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-gray-900">{t.dashboard_mission_title}</h3>{mission.progress !== null && <span className="text-xs font-semibold text-blue-700">{t.dashboard_mission_progress.replace('%d', String(mission.progress))}</span>}</div>
        {mission.title && <p className="mt-1 text-sm text-gray-700">{mission.title}</p>}
        <div className="mt-2 space-y-1">{mission.tasks.map((task, i) => <label key={i} className="flex items-start gap-2 text-xs text-gray-600"><input type="checkbox" className="mt-0.5 rounded border-gray-300 text-blue-600" />{task}</label>)}</div>
        {mission.lever && <p className="mt-3 text-xs text-gray-500"><strong>{t.dashboard_hebel_label}:</strong> {mission.lever}</p>}
      </div>}
    </section>
  );
}

function PerformanceScores({ scores, t }: { scores: { content: number | null; seo: number | null; pinterest: number | null; etsy: number | null }; t: ReturnType<typeof useTranslation>['t'] }) {
  const cards = [
    { key: 'content', label: t.dashboard_scores_content, score: scores.content, color: 'url(#score-blue)' },
    { key: 'seo', label: t.dashboard_scores_seo, score: scores.seo, color: '#10b981' },
    { key: 'pinterest', label: t.dashboard_scores_pinterest, score: scores.pinterest, color: '#ec4899' },
    { key: 'etsy', label: t.dashboard_scores_etsy, score: scores.etsy, color: '#f59e0b' },
  ];
  return <section><h2 className="mb-4 text-base font-bold text-gray-900">{t.dashboard_scores_title}</h2><div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{cards.map((card) => <ScoreRing key={card.key} score={card.score} color={card.color} label={card.label} naLabel={t.dashboard_scores_na} />)}</div></section>;
}

function ScoreRing({ score, color, label, naLabel }: { score: number | null; color: string; label: string; naLabel: string }) {
  const radius = 34; const circumference = 2 * Math.PI * radius; const offset = score === null ? circumference : circumference * (1 - score / 100);
  return <div className="flex flex-col items-center rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"><div className="relative h-20 w-20"><svg className="h-20 w-20 -rotate-90 animate-ring-pulse" viewBox="0 0 80 80"><circle cx="40" cy="40" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="6"/><circle cx="40" cy="40" r={radius} fill="none" stroke={score === null ? '#d1d5db' : color} strokeWidth="6" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}/></svg><span className={"absolute inset-0 flex items-center justify-center text-lg font-bold " + (score === null ? 'text-gray-400' : 'text-gray-900')}>{score === null ? naLabel : score}</span></div><p className="mt-3 text-center text-xs font-semibold text-gray-600">{label}</p></div>;
}

// ── Quick Tools Grid ───────────────────────────────────────────────────────────

function QuickToolsGrid({
  t,
}: {
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const tools = [
    {
      key: 'pinterest',
      to: '/app/generate/pinterest' as const,
      icon: '📌',
      title: t.dashboard_tools_pinterest,
      desc: t.dashboard_tools_pinterest_desc,
      tint: 'bg-red-50',
    },
    {
      key: 'etsy',
      to: '/app/generate/etsy' as const,
      icon: '🛍️',
      title: t.dashboard_tools_etsy,
      desc: t.dashboard_tools_etsy_desc,
      tint: 'bg-orange-50',
    },
    {
      key: 'blog',
      to: '/app/generate/blog' as const,
      icon: '📝',
      title: t.dashboard_tools_blog,
      desc: t.dashboard_tools_blog_desc,
      tint: 'bg-blue-50',
    },
    {
      key: 'calendar',
      to: '/app/calendar' as const,
      icon: '📅',
      title: t.dashboard_tools_calendar,
      desc: t.dashboard_tools_calendar_desc,
      tint: 'bg-purple-50',
    },
    {
      key: 'performance',
      to: '/app/performance' as const,
      icon: '📈',
      title: t.dashboard_tools_performance,
      desc: t.dashboard_tools_performance_desc,
      tint: 'bg-fuchsia-50',
    },
  ];

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-base font-bold text-gray-900">{t.dashboard_tools_title}</h2>
        <p className="mt-0.5 text-xs text-gray-500">{t.dashboard_tools_subtitle}</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {tools.map((tool) => (
          <Link
            key={tool.key}
            to={tool.to}
            className="group rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
          >
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg ${tool.tint}`}>
              {tool.icon}
            </span>
            <h3 className="mt-3 text-sm font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">
              {tool.title}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">{tool.desc}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ── Content Calendar Mini Preview ──────────────────────────────────────────────

function CalendarMiniPreview({
  days,
  t,
}: {
  days: WeekDay[];
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-all duration-200 hover:shadow-md">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">{t.dashboard_calendar_title}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{t.dashboard_calendar_week}</p>
        </div>
        <a
          href="/app/calendar"
          className="flex-shrink-0 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700"
        >
          {t.dashboard_calendar_view_full}
        </a>
      </div>
      <div className="mt-5 grid grid-cols-7 gap-2">
        {days.map((d) => (
          <div
            key={d.key}
            className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 transition-all ${
              d.isToday
                ? 'border-blue-200 bg-blue-50'
                : 'border-gray-100 bg-gray-50/50'
            }`}
          >
            <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
              {d.label}
            </span>
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                d.isToday
                  ? 'bg-gradient-to-br from-blue-600 to-purple-600 text-white shadow-sm'
                  : 'text-gray-700'
              }`}
            >
              {d.dayNum}
            </span>
            <span className="flex h-2 items-center justify-center">
              {d.planned && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-blue-500"
                  title={t.dashboard_calendar_planned}
                />
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Project Card ───────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  isMenuOpen,
  onToggleMenu,
  onFavorite,
  onDuplicate,
  onDelete,
}: {
  project: Project;
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onFavorite: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t, locale } = useTranslation();
  return (
    <div className="group relative rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
      {/* Favorite star */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onFavorite();
        }}
        className="absolute top-4 right-4 z-10"
        title={project.favorite ? t.dashboard_favorite_remove : t.dashboard_favorite_add}
      >
        <svg
          className={`h-5 w-5 transition-colors ${
            project.favorite
              ? "text-amber-400 fill-amber-400"
              : "text-gray-300 hover:text-amber-400"
          }`}
          fill={project.favorite ? "currentColor" : "none"}
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
          />
        </svg>
      </button>

      {/* ⋮ Menu */}
      <div className="absolute top-4 right-12 z-10">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleMenu();
          }}
          className="flex h-7 w-7 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </button>

        {isMenuOpen && (
          <div className="absolute right-0 top-8 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-xl">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDuplicate();
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              📋 {t.dashboard_duplicate}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              🗑️ {t.dashboard_delete}
            </button>
          </div>
        )}
      </div>

      {/* Clickable card body */}
      <Link
        to="/app/projects/$projectId"
        params={{ projectId: project.id }}
        className="block pt-2"
      >
        <h3 className="text-base font-semibold text-gray-900 group-hover:text-blue-700 transition-colors line-clamp-1">
          {project.title}
        </h3>
        <p className="mt-1 text-xs text-gray-500">
          {timeAgo(project.createdAt, t, locale)}
        </p>

        {/* Content type badges */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {project.contentTypes.map((ct) => {
            const config = CONTENT_TYPE_CONFIG[ct];
            return config ? (
              <span
                key={ct}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.color}`}
              >
                {config.icon} {config.label}
              </span>
            ) : null;
          })}
        </div>

        {/* Product idea preview */}
        <p className="mt-3 line-clamp-2 text-xs text-gray-400">
          {project.productIdea}
        </p>
      </Link>
    </div>
  );
}

// ── Getting Started Checklist ─────────────────────────────────────────────────

function GettingStartedCard({
  steps,
  onToggle,
  t,
}: {
  steps: boolean[];
  onToggle: (index: number) => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const stepLabels = [t.dashboard_step1, t.dashboard_step2, t.dashboard_step3];
  const doneCount = steps.filter(Boolean).length;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-900">
          🚀 {t.dashboard_getting_started}
        </h3>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
          {doneCount}/3
        </span>
      </div>
      <div className="space-y-2.5">
        {stepLabels.map((label, index) => {
          const done = Boolean(steps[index]);
          return (
            <button
              key={index}
              type="button"
              onClick={() => onToggle(index)}
              className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all ${
                done
                  ? 'border-emerald-200 bg-emerald-50/60'
                  : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40'
              }`}
            >
              <span
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all ${
                  done
                    ? 'bg-emerald-500 text-white'
                    : 'bg-gradient-to-br from-blue-500 to-purple-600 text-white'
                }`}
              >
                {done ? '✓' : index + 1}
              </span>
              <span
                className={`text-sm font-medium ${
                  done ? 'text-emerald-800 line-through decoration-emerald-300' : 'text-gray-700'
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
      {doneCount === 3 && (
        <p className="mt-3 text-center text-xs font-medium text-emerald-600">
          🎉 {t.beta_checklist_all_done}
        </p>
      )}
    </div>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────────

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-100 to-purple-100">
        <span className="text-3xl">{hasSearch ? "🔍" : "🚀"}</span>
      </div>
      <h3 className="mt-4 text-sm font-semibold text-gray-900">
        {hasSearch ? t.dashboard_empty_no_results : t.dashboard_empty_no_projects}
      </h3>
      <p className="mt-1 text-sm text-gray-500">
        {hasSearch
          ? t.dashboard_empty_no_results_desc
          : t.dashboard_empty_no_projects_desc}
      </p>
      {!hasSearch && (
        <Link
          to="/app/new-project"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:-translate-y-0.5"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4v16m8-8H4"
            />
          </svg>
          {t.dashboard_empty_cta}
        </Link>
      )}
    </div>
  );
}
