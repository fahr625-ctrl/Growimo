import { useState, useMemo, useEffect } from 'react';
import type { Project, StoredContent } from '~/store/projects';
import { getAllContentByUser } from '~/store/projects';
import { getBrandProfile } from '~/store/brand';
import type { ContentType } from '~/ai/types';
import { useTranslation } from '~/i18n';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProjectIntelligenceProps {
  projects: Project[];
  currentProjectId?: string | null;
}

interface KeywordEntry {
  word: string;
  count: number;
  projects: string[];
  projectIds: string[];
}

interface ProjectPair {
  projectA: Project;
  projectB: Project;
  sharedKeywords: string[];
  overlapPercent: number;
}

// ── Keyword Extractor ──────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'der', 'die', 'das', 'und', 'oder', 'ein', 'eine', 'einen', 'einem',
  'mit', 'von', 'zu', 'für', 'auf', 'an', 'in', 'im', 'ist', 'sind',
  'wird', 'werden', 'wurde', 'war', 'bei', 'aus', 'nach', 'über',
  'unter', 'vor', 'auch', 'nicht', 'nur', 'noch', 'schon', 'aber',
  'wenn', 'dann', 'mehr', 'sehr', 'the', 'and', 'for', 'that', 'this',
  'with', 'your', 'from', 'are', 'will', 'can', 'has', 'its', 'our',
  'durch', 'eine', 'wie', 'einen', 'zum', 'zur', 'als', 'um', 'ab',
  'den', 'des', 'dem', 'sich', 'so', 'es', 'er', 'sie', 'ihr',
  'haben', 'hat', 'was', 'kann', 'man', 'alle', 'allem', 'allen',
  'aller', 'alles', 'wäre', 'würde', 'wurden', 'sei', 'seit',
]);

function extractKeywords(text: string): string[] {
  // Extract words 3+ chars, lowercase, filter stop words and numbers-only
  const words = text
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  // Deduplicate
  return [...new Set(words)];
}

function buildKeywordMap(projects: Project[], allContent: (StoredContent & { projectTitle: string })[]): KeywordEntry[] {
  const map = new Map<string, { count: number; projects: Set<string>; projectIds: Set<string> }>();

  // Build a lookup from projectId -> project title for content matching
  const projectIdToTitle = new Map<string, string>();
  for (const project of projects) {
    projectIdToTitle.set(project.id, project.title);
  }

  for (const project of projects) {
    const projectTexts: string[] = [project.title, project.productIdea];

    // Add content from this project
    for (const content of allContent) {
      // Match by projectId if available on the content
      if ((content as any).projectId === project.id || content.projectTitle === project.title) {
        projectTexts.push(content.title, content.body);
      }
    }

    const keywords = extractKeywords(projectTexts.join(' '));
    for (const kw of keywords) {
      const existing = map.get(kw);
      if (existing) {
        existing.count += 1;
        existing.projects.add(project.title);
        existing.projectIds.add(project.id);
      } else {
        map.set(kw, {
          count: 1,
          projects: new Set([project.title]),
          projectIds: new Set([project.id]),
        });
      }
    }
  }

  const entries: KeywordEntry[] = [];
  for (const [word, data] of map) {
    entries.push({
      word,
      count: data.count,
      projects: [...data.projects],
      projectIds: [...data.projectIds],
    });
  }

  // Sort by count descending
  entries.sort((a, b) => b.count - a.count);
  return entries;
}

// ── Content Type Labels ────────────────────────────────────────────────────────

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  pinterest_pin: 'Pinterest Pin',
  etsy_listing: 'Etsy Listing',
  seo_blog: 'SEO Blog',
  social_post: 'Social Media',
  email_newsletter: 'Email Newsletter',
  marketing_plan: 'Marketing Plan',
  product_idea: 'Produktidee',
  trend_insight: 'Trend Insight',
  marketing_analysis: 'Analyse',
  market_intelligence: 'Market Intelligence',
};

// ── Content Type Emojis ────────────────────────────────────────────────────────

const CONTENT_TYPE_EMOJIS: Record<ContentType, string> = {
  pinterest_pin: '📌',
  etsy_listing: '🛍️',
  seo_blog: '📝',
  social_post: '📱',
  email_newsletter: '📧',
  marketing_plan: '📋',
  product_idea: '💡',
  trend_insight: '📈',
  marketing_analysis: '🔍',
  market_intelligence: '📊',
};

// ── Diversification suggestions ────────────────────────────────────────────────

const DIVERSIFICATION_THEMES = [
  'Nachhaltigkeit & Öko',
  'Personalisierung & Customization',
  'Geschenke & Anlässe',
  'DIY & Selbermachen',
  'Luxus & Premium',
  'Minimalismus & Einfachheit',
  'Community & Social Proof',
  'Behind-the-Scenes & Storytelling',
  'Saisonale Trends',
  'Problemlösung & Pain Points',
];

// ── Color Scale ────────────────────────────────────────────────────────────────

function keywordColor(rank: number, total: number): string {
  const ratio = 1 - rank / Math.max(total, 1);
  if (ratio > 0.8) return 'bg-blue-600 text-white';
  if (ratio > 0.6) return 'bg-blue-500 text-white';
  if (ratio > 0.4) return 'bg-blue-400 text-white';
  if (ratio > 0.2) return 'bg-blue-300 text-blue-900';
  return 'bg-blue-100 text-blue-800';
}

// ── Bar Chart ──────────────────────────────────────────────────────────────────

function BarChart({
  items,
  maxValue,
  labelFn,
  colorClass = 'bg-blue-500',
}: {
  items: { label: string; value: number }[];
  maxValue: number;
  labelFn?: (item: { label: string; value: number }) => string;
  colorClass?: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const pct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="w-32 flex-shrink-0 truncate text-xs text-gray-600">
              {labelFn ? labelFn(item) : item.label}
            </span>
            <div className="flex-1">
              <div className="h-5 w-full rounded-full bg-gray-100">
                <div
                  className={`h-5 rounded-full transition-all duration-500 ${colorClass}`}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
            </div>
            <span className="w-8 flex-shrink-0 text-right text-xs font-semibold text-gray-700">
              {item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Section Card ───────────────────────────────────────────────────────────────

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-800">
        <span>{icon}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ProjectIntelligence({
  projects,
  currentProjectId,
}: ProjectIntelligenceProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  // Gather all content for keyword analysis (from PostgreSQL)
  const [allContent, setAllContent] = useState<(StoredContent & { projectTitle: string })[]>([]);
  useEffect(() => {
    if (projects.length === 0) {
      setAllContent([]);
      return;
    }
    const userId = projects[0]?.userId ?? 'anonymous';
    let cancelled = false;
    getAllContentByUser(userId)
      .then((c) => {
        if (!cancelled) setAllContent(c);
      })
      .catch(() => {
        if (!cancelled) setAllContent([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const keywordMap = useMemo(
    () => buildKeywordMap(projects, allContent),
    [projects, allContent],
  );

  const brandProfile = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return getBrandProfile();
  }, []);

  // ── Similar project pairs ─────────────────────────────────────────────────
  const similarPairs = useMemo((): ProjectPair[] => {
    const pairs: ProjectPair[] = [];
    for (let i = 0; i < projects.length; i++) {
      for (let j = i + 1; j < projects.length; j++) {
        const kwA = extractKeywords(
          projects[i].title + ' ' + projects[i].productIdea,
        );
        const kwB = extractKeywords(
          projects[j].title + ' ' + projects[j].productIdea,
        );
        const shared = kwA.filter((k) => kwB.includes(k));
        if (shared.length > 0) {
          const maxLen = Math.max(kwA.length, kwB.length, 1);
          pairs.push({
            projectA: projects[i],
            projectB: projects[j],
            sharedKeywords: shared,
            overlapPercent: Math.round((shared.length / maxLen) * 100),
          });
        }
      }
    }
    pairs.sort((a, b) => b.overlapPercent - a.overlapPercent);
    return pairs;
  }, [projects]);

  // ── Content type usage ────────────────────────────────────────────────────
  const contentTypeUsage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const project of projects) {
      for (const ct of project.contentTypes) {
        counts[ct] = (counts[ct] || 0) + 1;
      }
    }
    const items = Object.entries(counts)
      .map(([type, count]) => ({
        label: CONTENT_TYPE_EMOJIS[type as ContentType] + ' ' + (CONTENT_TYPE_LABELS[type as ContentType] || type),
        contentType: type as ContentType,
        value: count,
      }))
      .sort((a, b) => b.value - a.value);
    return items;
  }, [projects]);

  const unusedContentTypes = useMemo(() => {
    const used = new Set<string>();
    for (const project of projects) {
      for (const ct of project.contentTypes) {
        used.add(ct);
      }
    }
    const allTypes = Object.keys(CONTENT_TYPE_LABELS) as ContentType[];
    return allTypes.filter((ct) => !used.has(ct) && ct !== 'marketing_analysis' && ct !== 'market_intelligence');
  }, [projects]);

  // ── Top strategies ────────────────────────────────────────────────────────
  const topStrategies = useMemo(() => {
    return [...projects]
      .sort((a, b) => {
        const aContent = b.contentTypes.length - a.contentTypes.length;
        if (aContent !== 0) return aContent;
        return b.versions.reduce((sum, v) => sum + v.length, 0) -
          a.versions.reduce((sum, v) => sum + v.length, 0);
      })
      .slice(0, 3);
  }, [projects]);

  // ── Duplicate keywords ────────────────────────────────────────────────────
  const duplicateKeywords = useMemo(() => {
    return keywordMap.filter((kw) => kw.projectIds.length > 1);
  }, [keywordMap]);

  const highOverlapKeywords = useMemo(() => {
    return duplicateKeywords.filter((kw) => kw.projectIds.length > projects.length * 0.5);
  }, [duplicateKeywords, projects.length]);

  // ── Diversification suggestions ───────────────────────────────────────────
  const usedKeywordsSet = useMemo(() => new Set(keywordMap.map((k) => k.word)), [keywordMap]);

  const diversificationSuggestions = useMemo(() => {
    // Return themes not reflected in current keyword set
    const themeKeywords: Record<string, string[]> = {
      'Nachhaltigkeit & Öko': ['nachhaltig', 'öko', 'bio', 'umwelt', 'recycling', 'natur'],
      'Personalisierung & Customization': ['personalisiert', 'custom', 'individuell', 'name', 'gravur'],
      'Geschenke & Anlässe': ['geschenk', 'geburtstag', 'weihnachten', 'hochzeit', 'valentinstag'],
      'DIY & Selbermachen': ['diy', 'selber', 'basteln', 'anleitung', 'einfach'],
      'Luxus & Premium': ['luxus', 'premium', 'exklusiv', 'edel', 'hochwertig'],
      'Minimalismus & Einfachheit': ['minimalistisch', 'einfach', 'clean', 'modern', 'reduziert'],
      'Community & Social Proof': ['community', 'bewertung', 'kunden', 'rezension', 'testimonial'],
      'Behind-the-Scenes & Storytelling': ['story', 'hintergrund', 'geschichte', 'handwerk', 'prozess'],
      'Saisonale Trends': ['saisonal', 'trend', 'aktuell', 'sommer', 'winter', 'frühling', 'herbst'],
      'Problemlösung & Pain Points': ['problem', 'lösung', 'hilfe', 'einfach', 'schnell', 'praktisch'],
    };

    const suggestions: { theme: string; missingKeywords: string[] }[] = [];
    for (const theme of DIVERSIFICATION_THEMES) {
      const kw = themeKeywords[theme] || [];
      const missing = kw.filter((k) => !usedKeywordsSet.has(k));
      if (missing.length >= kw.length * 0.5) {
        suggestions.push({ theme, missingKeywords: missing.slice(0, 3) });
      }
    }
    return suggestions.slice(0, 5);
  }, [usedKeywordsSet]);

  // ── Brand consistency check ───────────────────────────────────────────────
  const brandConsistency = useMemo(() => {
    if (!brandProfile?.tone) return null;
    const brandTone = brandProfile.tone.toLowerCase();
    const deviations: string[] = [];

    for (const project of projects) {
      // Check if project's product idea mentions tone-inconsistent language
      const text = (project.title + ' ' + project.productIdea).toLowerCase();
      // Simple heuristic: check for opposite tones
      if (brandTone === 'professionell' || brandTone === 'professional') {
        if (text.includes('lässig') || text.includes('casual') || text.includes('spaß')) {
          deviations.push(project.title);
        }
      } else if (brandTone === 'verspielt' || brandTone === 'playful') {
        if (text.includes('professionell') || text.includes('seriös') || text.includes('business')) {
          deviations.push(project.title);
        }
      }
    }

    return {
      tone: brandProfile.tone,
      consistent: deviations.length === 0,
      deviations,
    };
  }, [brandProfile, projects]);

  // ── Empty / low-project states ────────────────────────────────────────────

  if (projects.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h3 className="mb-2 text-center text-lg font-bold text-gray-800">
          🧠 {t.pi_title}
        </h3>
        <p className="text-center text-sm text-gray-500">{t.pi_empty}</p>
      </div>
    );
  }

  if (projects.length === 1) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h3 className="mb-2 text-center text-lg font-bold text-gray-800">
          🧠 {t.pi_title}
        </h3>
        <p className="text-center text-sm text-gray-500">{t.pi_need_more}</p>
      </div>
    );
  }

  // ── Full dashboard ────────────────────────────────────────────────────────

  return (
    <div className="rounded-2xl border border-blue-200 bg-white shadow-sm">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-3 px-6 py-5 text-left transition-colors hover:bg-blue-50/30 rounded-t-2xl"
      >
        <span className="text-xl">🧠</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-gray-900">{t.pi_title}</h2>
          <p className="text-sm text-gray-500">{t.pi_subtitle}</p>
        </div>
        <svg
          className={`h-5 w-5 flex-shrink-0 text-gray-400 transition-transform duration-200 ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      <div
        className={`grid transition-all duration-300 ease-in-out ${
          isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-6 border-t border-gray-100 px-6 pb-6 pt-5">
            {/* ── a) Wiederverwendete Keywords ── */}
            <SectionCard icon="🔑" title={t.pi_keywords_reused}>
              <div className="flex flex-wrap gap-2">
                {keywordMap.slice(0, 15).map((kw, i) => (
                  <span
                    key={kw.word}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-all ${keywordColor(
                      i,
                      keywordMap.length,
                    )}`}
                  >
                    {kw.word}
                    <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">
                      {kw.count}
                    </span>
                  </span>
                ))}
              </div>
            </SectionCard>

            {/* ── b) Keyword-Dopplungen ── */}
            {duplicateKeywords.length > 0 && (
              <SectionCard icon="⚠️" title={t.pi_keywords_duplicates}>
                <p className="mb-3 text-xs text-gray-500">
                  {t.pi_keywords_duplicates_desc}{' '}
                  <span className="font-semibold text-amber-600">
                    {duplicateKeywords.length} Keywords
                  </span>
                </p>
                <div className="space-y-2">
                  {duplicateKeywords.slice(0, 10).map((kw) => (
                    <div
                      key={kw.word}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                        kw.projectIds.length > projects.length * 0.5
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <span className="font-medium text-gray-800">{kw.word}</span>
                      <span className="text-xs text-gray-500">
                        {kw.projectIds.length}/{projects.length} Projekte
                      </span>
                    </div>
                  ))}
                </div>
                {highOverlapKeywords.length > 0 && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                    <p className="text-xs font-semibold text-amber-800">
                      ⚠️ {highOverlapKeywords.length} Keywords in &gt;50% der Projekte verwendet
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {highOverlapKeywords.map((kw) => (
                        <span
                          key={kw.word}
                          className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                        >
                          {kw.word}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </SectionCard>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              {/* ── c) Ähnliche Projekte ── */}
              {similarPairs.length > 0 && (
                <SectionCard icon="📎" title={t.pi_similar_projects}>
                  <div className="space-y-3">
                    {similarPairs.slice(0, 5).map((pair, i) => (
                      <div
                        key={i}
                        className="rounded-xl border border-blue-100 bg-blue-50/30 p-3"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-blue-700">
                            {pair.overlapPercent}% {t.pi_similar_share}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {pair.sharedKeywords.length} Keywords
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-700">
                          <span className="truncate font-medium">
                            {pair.projectA.title}
                          </span>
                          <span className="text-gray-400">↔</span>
                          <span className="truncate font-medium">
                            {pair.projectB.title}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {pair.sharedKeywords.slice(0, 4).map((kw) => (
                            <span
                              key={kw}
                              className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700"
                            >
                              {kw}
                            </span>
                          ))}
                          {pair.sharedKeywords.length > 4 && (
                            <span className="text-[10px] text-gray-400">
                              +{pair.sharedKeywords.length - 4} mehr
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              {/* ── d) Empfehlungen zur Diversifizierung ── */}
              <SectionCard icon="💡" title={t.pi_diversify}>
                <p className="mb-3 text-xs text-gray-500">{t.pi_diversify_tip}</p>
                <div className="space-y-2">
                  {diversificationSuggestions.map((s, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-gray-200 bg-white p-3"
                    >
                      <p className="text-sm font-semibold text-gray-800">
                        {s.theme}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {s.missingKeywords.map((kw) => (
                          <span
                            key={kw}
                            className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                          >
                            +{kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>

            {/* ── e) Markenkonsistenz ── */}
            {brandConsistency && (
              <SectionCard icon="🎨" title={t.pi_consistency}>
                {brandConsistency.consistent ? (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3">
                    <span className="text-emerald-600">✅</span>
                    <p className="text-sm text-emerald-800">
                      {t.pi_consistency_ok} ({brandConsistency.tone})
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3">
                      <span className="text-amber-600">⚠️</span>
                      <p className="text-sm text-amber-800">
                        {brandConsistency.deviations.length} Projekt
                        {brandConsistency.deviations.length > 1 ? 'e' : ''}{' '}
                        {t.pi_consistency_warn} ({brandConsistency.tone})
                      </p>
                    </div>
                    {brandConsistency.deviations.map((d) => (
                      <div
                        key={d}
                        className="rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs"
                      >
                        ⚠️ <span className="font-medium">{d}</span> {t.pi_consistency_warn}
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            )}

            {/* ── f) Lernfunktion ── */}
            <SectionCard icon="📈" title={t.pi_learning}>
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-semibold text-gray-600">
                    {t.pi_learning_most_used}
                  </p>
                  <BarChart
                    items={contentTypeUsage}
                    maxValue={contentTypeUsage[0]?.value ?? 1}
                  />
                </div>
                {unusedContentTypes.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold text-gray-600">
                      {t.pi_learning_unused}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {unusedContentTypes.map((ct) => (
                        <span
                          key={ct}
                          className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"
                        >
                          {CONTENT_TYPE_EMOJIS[ct]}{' '}
                          {CONTENT_TYPE_LABELS[ct]}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>

            {/* ── g) Erfolgreichste Strategien ── */}
            {topStrategies.length > 0 && (
              <SectionCard icon="🏆" title={t.pi_top_strategies}>
                <div className="space-y-3">
                  {topStrategies.map((project, i) => {
                    const contentCount = project.versions.reduce(
                      (sum, v) => sum + v.length,
                      0,
                    );
                    const channelCount = project.contentTypes.length;
                    const colors = [
                      'border-amber-300 bg-amber-50',
                      'border-gray-200 bg-gray-50',
                      'border-orange-200 bg-orange-50',
                    ];
                    const medals = ['🥇', '🥈', '🥉'];
                    return (
                      <div
                        key={project.id}
                        className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${colors[i] || 'border-gray-200 bg-white'}`}
                      >
                        <span className="text-2xl">{medals[i] || '📄'}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-gray-900">
                            {project.title}
                          </p>
                          <p className="text-xs text-gray-500">
                            {i === 0 ? t.pi_top_comprehensive : ''}{' '}
                            {t.pi_top_with} {contentCount} Inhalten {t.pi_top_over}{' '}
                            {channelCount} Kanäle
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
