import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { ProtectedRoute } from "~/components/ProtectedRoute";
import { ScoreBadge } from "~/components/ScoreBadge";
import { ScoreCard, scoreFromMetadata } from "~/components/ScoreCard";
import { getAllContentByUser } from "~/store/projects";
import type { ContentType, StoredContent } from "~/store/projects";
import { useTranslation } from "~/i18n";
import { contentTypeLabel } from "~/lib/content-types";
import { timeAgo } from "~/lib/date";

// ── Content type config ───────────────────────────────────────────────────────
const CONTENT_TYPE_CONFIG: Record<
  ContentType,
  { icon: string; color?: string }
> = {
  pinterest_pin: { icon: "📌" },
  seo_blog: { icon: "📝" },
  etsy_listing: { icon: "🛍️" },
  social_post: { icon: "📱" },
  email_newsletter: { icon: "📧" },
  marketing_plan: { icon: "📊" },
  product_idea: { icon: "💡" },
  trend_insight: { icon: "📈" },
  marketing_analysis: { icon: "🔍" },
  market_intelligence: {
    icon: "📊",
    color: "bg-violet-100 text-violet-700",
  },
};

export const Route = createFileRoute("/app/content-library")({
  component: ContentLibraryPage,
});

function ContentLibraryPage() {
  return (
    <ProtectedRoute>
      <ContentLibraryContent />
    </ProtectedRoute>
  );
}

function ContentLibraryContent() {
  const { user } = useUser();
  const { t, locale } = useTranslation();
  const userId = user?.id ?? "anonymous";
  const [allContent, setAllContent] = useState<
    (StoredContent & { projectTitle: string })[]
  >([]);
  const [loading, setLoading] = useState(true);

  // Load content from PostgreSQL
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAllContentByUser(userId)
      .then((content) => {
        if (!cancelled) setAllContent(content);
      })
      .catch((err) => {
        console.error("Failed to load content library:", err);
        if (!cancelled) setAllContent([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const [activeTab, setActiveTab] = useState<ContentType | "all">("all");

  const filteredContent =
    activeTab === "all"
      ? allContent
      : allContent.filter((c) => c.contentType === activeTab);

  // Group by content type for the "All" tab
  const groupedContent = groupBy(
    filteredContent,
    (c) => c.contentType,
  );

  const filterTabs: { key: ContentType | "all"; label: string; icon: string }[] = [
    { key: "all", label: t.content_library_all, icon: "📋" },
    ...(Object.entries(CONTENT_TYPE_CONFIG) as [ContentType, { icon: string; color?: string }][]).map(
      ([key, config]) => ({ key, label: contentTypeLabel(t, key), icon: config.icon }),
    ),
  ];

  if (loading) {
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

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-gray-900">
          {t.sidebar_content_library}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {t.content_library_subtitle}
        </p>
      </div>

      {/* Filter tabs */}
      <div className="mb-6 flex flex-wrap gap-2">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${
              activeTab === tab.key
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content list */}
      {allContent.length === 0 ? (
        <EmptyState />
      ) : filteredContent.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
          <span className="text-4xl">📭</span>
          <h3 className="mt-4 text-sm font-semibold text-gray-900">
            {t.content_library_no_type}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {t.content_library_generate_hint.replace(
              "%s",
              activeTab !== "all"
                ? contentTypeLabel(t, activeTab)
                : t.content_library_content,
            )}
          </p>
          <Link
            to="/app/new-project"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700"
          >
            {t.gen_generate_btn}
          </Link>
        </div>
      ) : activeTab === "all" ? (
        /* Grouped view */
        <div className="space-y-8">
          {Object.entries(groupedContent).map(([contentType, items]) => {
            const config =
              CONTENT_TYPE_CONFIG[contentType as ContentType];
            return (
              <div key={contentType}>
                <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-gray-900">
                  <span>{config?.icon ?? "📄"}</span>
                  {contentTypeLabel(t, contentType)}
                  <span className="text-sm font-normal text-gray-400">
                    ({items.length})
                  </span>
                </h2>
                <div className="space-y-2">
                  {items.map((item) => (
                    <ContentCard
                      key={item.id}
                      content={item}
                      showProject
                      locale={locale}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Filtered list */
        <div className="space-y-2">
          {filteredContent.map((item) => (
            <ContentCard
              key={item.id}
              content={item}
              showProject
              locale={locale}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ContentCard({
  content,
  showProject,
  locale,
}: {
  content: StoredContent & { projectTitle: string };
  showProject?: boolean;
  locale?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [showScore, setShowScore] = useState(false);
  const score = scoreFromMetadata(content.metadata);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (copying) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(content.body);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = content.body;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setCopying(false);
  };

  const preview =
    content.body.length > 100
      ? content.body.slice(0, 100) + "..."
      : content.body;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span>{CONTENT_TYPE_CONFIG[content.contentType]?.icon ?? "📄"}</span>
            <h3 className="text-sm font-semibold text-gray-900">
              {content.title}
            </h3>
          </div>
          {showProject && (
            <Link
              to="/app/projects/$projectId"
              params={{ projectId: content.projectId }}
              className="mt-1 inline-block text-xs text-blue-600 hover:text-blue-800"
            >
              {content.projectTitle}
            </Link>
          )}
          <p className="mt-1 text-xs text-gray-500">{preview}</p>
          <p className="mt-1 text-xs text-gray-400">
            {timeAgo(content.createdAt, t, locale)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {score != null && score.total !== undefined && (
            <button
              type="button"
              onClick={() => setShowScore((s) => !s)}
              title={t.score_badge}
              className="transition-transform hover:scale-105"
            >
              <ScoreBadge total={score.total} size="sm" />
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            disabled={copying}
            className={`flex-shrink-0 inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
              copied
                ? "bg-emerald-50 text-emerald-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {copied ? (
              <>
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                {t.common_copied}
              </>
            ) : (
              <>
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                {t.common_copy}
              </>
            )}
          </button>
        </div>
      </div>

      {/* F1 score detail — toggled via the badge */}
      {showScore && (
        <div className="mt-3">
          <ScoreCard score={score} defaultExpanded />
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-100 to-purple-100">
        <span className="text-3xl">📚</span>
      </div>
      <h3 className="mt-4 text-sm font-semibold text-gray-900">
        {t.content_library_empty_title}
      </h3>
      <p className="mt-1 text-sm text-gray-500">
        {t.content_library_empty_desc}
      </p>
      <Link
        to="/app/new-project"
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700"
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
        {t.content_library_new_project}
      </Link>
    </div>
  );
}

// ── Utility ────────────────────────────────────────────────────────────────────
function groupBy<T, K extends string | number | symbol>(
  items: T[],
  keyFn: (item: T) => K,
): Record<K, T[]> {
  const result = {} as Record<K, T[]>;
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}
