import { trackEvent } from '~/store/analytics';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { ScoreBadge } from '~/components/ScoreBadge';
import { ScoreCard, scoreFromMetadata } from '~/components/ScoreCard';
import { useTranslation } from '~/i18n';
import { contentTypeLabel } from '~/lib/content-types';
import { getProject, getProjectContent, updateChannel } from '~/store/projects';
import type { ImproveOutcome } from '~/ai/types';
import type { ContentType, Project, StoredContent } from '~/store/projects';
import { ImageStudio } from '~/components/ImageStudio';
import { PrioritizeCard } from '~/components/PrioritizeCard';

const CONTENT_TYPE_CONFIG: Record<ContentType, { icon: string; color: string }> = {
  pinterest_pin: { icon: '📌', color: 'bg-red-100 text-red-700' },
  seo_blog: { icon: '📝', color: 'bg-blue-100 text-blue-700' },
  etsy_listing: { icon: '🛍️', color: 'bg-orange-100 text-orange-700' },
  social_post: { icon: '📱', color: 'bg-pink-100 text-pink-700' },
  email_newsletter: { icon: '📧', color: 'bg-yellow-100 text-yellow-700' },
  marketing_plan: { icon: '📊', color: 'bg-purple-100 text-purple-700' },
  product_idea: { icon: '💡', color: 'bg-green-100 text-green-700' },
  trend_insight: { icon: '📈', color: 'bg-cyan-100 text-cyan-700' },
  marketing_analysis: { icon: '🔍', color: 'bg-blue-100 text-blue-700' },
  market_intelligence: { icon: '📊', color: 'bg-violet-100 text-violet-700' },
};

export const Route = createFileRoute('/app/projects/$projectId')({ component: ProjectDetailPage });

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const [project, setProject] = useState<Project | undefined | null>(undefined);
  const [contents, setContents] = useState<StoredContent[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const [p, c] = await Promise.all([
          getProject(projectId),
          getProjectContent(projectId),
        ]);
        if (cancelled) return;
        setProject(p ?? null);
        setContents(c);
      } catch (err) {
        console.error('Failed to load project:', err);
        if (!cancelled) setProject(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="flex items-center gap-3 text-gray-500">
            <svg className="h-6 w-6 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium">{t.common_loading}</span>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  if (!project) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100"><span className="text-3xl">🔍</span></div>
          <h2 className="mt-4 text-lg font-bold text-gray-900">Project Not Found</h2>
          <p className="mt-1 text-sm text-gray-500">The project you're looking for doesn't exist or has been removed.</p>
          <Link to="/app" className="mt-6 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition-all hover:bg-gray-50">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back to Dashboard
          </Link>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ProjectDetailContent project={project} contents={contents} />
    </ProtectedRoute>
  );
}

function ProjectDetailContent({ project, contents }: { project: Project; contents: StoredContent[] }) {
  const { t } = useTranslation();
  return (
    <div>
      <Link to="/app" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-blue-600 transition-colors">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Back to Dashboard
      </Link>
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-gray-900">{project.title}</h1>
        <p className="mt-1 text-sm text-gray-500">{project.productIdea}</p>
        <p className="mt-2 text-xs text-gray-400">
          Created {project.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {project.contentTypes.map((ct) => {
            const config = CONTENT_TYPE_CONFIG[ct];
            return config ? (
              <span key={ct} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.color}`}>
                {config.icon} {contentTypeLabel(t, ct)}
              </span>
            ) : null;
          })}
        </div>
      </div>
      <div className="space-y-3">
        <h2 className="text-lg font-bold text-gray-900">Generated Content ({contents.length})</h2>
        {contents.length === 0 ? (
          <p className="text-sm text-gray-500">No content was generated for this project.</p>
        ) : (
          contents.map((content) => <ContentCard key={content.id} content={content} productIdea={project.productIdea} />)
        )}
      </div>
      {contents.length > 0 && (
        <div className="mt-8">
          <PrioritizeCard
            assets={contents.map((c) => ({
              channel: c.contentType,
              assetId: c.id,
              qualityScore: scoreFromMetadata(c.metadata)?.total ?? null,
              title: c.title,
            }))}
            productIdea={project.productIdea}
          />
        </div>
      )}
      {contents.length > 0 && <ImageStudio productIdea={project.productIdea} />}
    </div>
  );
}

function ContentCard({ content, productIdea }: { content: StoredContent; productIdea?: string }) {
  const { t } = useTranslation();
  const [display, setDisplay] = useState<StoredContent>(content);
  const config = CONTENT_TYPE_CONFIG[display.contentType];
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [showScore, setShowScore] = useState(false);
  const score = scoreFromMetadata(display.metadata);
  // F2: persist the improved asset (overwrite) so the new score survives reloads
  const handleImproved = async (outcome: ImproveOutcome) => {
    if (!outcome.improved || !outcome.improvedContent) return;
    const ic = outcome.improvedContent;
    try {
      const updated = await updateChannel(display.projectId, display.contentType, {
        title: ic.title,
        body: ic.body,
        metadata: { ...(ic.metadata ?? {}), score: ic.score ?? undefined },
      });
      if (updated) setDisplay(updated);
    } catch (err) {
      console.error('Persisting improved content failed:', err);
    }
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(display.body);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = display.body;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    try { trackEvent('content_exported'); } catch {}
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all hover:shadow-md">
      <button type="button" onClick={() => setExpanded((p) => !p)} className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50">
        <span className="flex-shrink-0 text-xl">{config?.icon ?? '📄'}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">{contentTypeLabel(t, display.contentType)}</p>
          <p className="truncate text-xs text-gray-500">{display.title}</p>
        </div>
        {score != null && score.total !== undefined && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowScore((s) => !s); }}
            title={t.score_badge}
            className="flex-shrink-0 transition-transform hover:scale-105"
          >
            <ScoreBadge total={score.total} size="sm" />
          </button>
        )}
        <svg className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4">
          <h4 className="mb-2 text-base font-bold text-gray-900">{display.title}</h4>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 font-sans">{display.body}</pre>
          {showScore && (
            <div className="mt-3">
              <ScoreCard
                score={score}
                defaultExpanded
                content={{
                  contentType: display.contentType,
                  title: display.title,
                  body: display.body,
                  metadata: display.metadata ?? {},
                  score: score ?? undefined,
                }}
                productIdea={productIdea}
                onImproved={handleImproved}
              />
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={handleCopy} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${copied ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {copied ? (
                <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> Copied!</>
              ) : (
                <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> Copy</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
