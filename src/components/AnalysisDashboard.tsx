import { useState, useCallback } from 'react';
import type { ContentResult, ContentType } from '~/ai/types';
import { improveContentServer } from '~/ai/server';
import { useTranslation } from '~/i18n';
import MarketingMission from '~/components/MarketingMission';
import MarketIntelligence from '~/components/MarketIntelligence';
import ProjectIntelligence from '~/components/ProjectIntelligence';
import type { Project } from '~/store/projects';

// ── Color helpers ──────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score > 75) return { bg: 'bg-emerald-100', text: 'text-emerald-800', stroke: '#10B981', badge: 'bg-emerald-600' };
  if (score >= 50) return { bg: 'bg-amber-100', text: 'text-amber-800', stroke: '#F59E0B', badge: 'bg-amber-500' };
  return { bg: 'bg-red-100', text: 'text-red-800', stroke: '#EF4444', badge: 'bg-red-500' };
}

function impactColor(impact: string) {
  const i = impact.toLowerCase();
  if (i === 'hoch' || i === 'high') return 'bg-red-100 text-red-700';
  if (i === 'mittel' || i === 'medium') return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-600';
}

// ── Section Parser ─────────────────────────────────────────────────────────────

interface AnalysisSections {
  strengths: string | null;
  weaknesses: string | null;
  seo: string | null;
  pinterest: string | null;
  etsy: string | null;
  social: string | null;
  priorities: string | null;
  nextSteps: string | null;
  timeInvestment: string | null;
  warnings: string | null;
  quickWins: string | null;
  coach: string | null;
  marketingMission: string | null;
  overall: string | null;
  overallScore: number | null;
}

function parseSections(body: string): AnalysisSections {
  const extract = (name: string): string | null => {
    const regex = new RegExp(`###\\s*${name}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n###\\s|$)`, 'i');
    const m = body.match(regex);
    return m ? m[1].trim() : null;
  };

  const extractScore = (text: string): number | null => {
    const m = text.match(/Score:\s*(\d+)\s*\/\s*100/i);
    return m ? parseInt(m[1]) : null;
  };

  const overall = extract('Gesamtbewertung');

  return {
    strengths: extract('Stärken'),
    weaknesses: extract('Schwächen'),
    seo: extract('SEO-Analyse'),
    pinterest: extract('Pinterest-Analyse'),
    etsy: extract('Etsy-Analyse'),
    social: extract('Social-Media-Analyse'),
    priorities: extract('Prioritäten \\(Top 3\\)'),
    nextSteps: extract('Nächste Schritte \\(Top 3\\)'),
    timeInvestment: extract('Zeitinvestition'),
    warnings: extract('⚠️ Achtung'),
    quickWins: extract('⚡ Quick Wins'),
    coach: extract('🤖 Marketing Coach'),
    marketingMission: extract('🎯 Marketing Mission'),
    overall,
    overallScore: overall ? extractScore(overall) : null,
  };
}

// ── Circular Score ─────────────────────────────────────────────────────────────

function CircularScore({ score, size = 120 }: { score: number | null; size?: number }) {
  const displayScore = score ?? 0;
  const colors = scoreColor(displayScore);
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (displayScore / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="#E5E7EB" strokeWidth="10"
          />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={colors.stroke} strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-extrabold" style={{ color: colors.stroke }}>
            {displayScore}
          </span>
          <span className="text-[11px] font-medium text-gray-400">/100</span>
        </div>
      </div>
      <p className="mt-2 text-sm font-semibold text-gray-700">{t.analysis_overall}</p>
    </div>
  );
}

// ── Priority Card ──────────────────────────────────────────────────────────────

function PriorityCard({ number, title, impact, reason }: { number: number; title: string; impact: string; reason: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <span className={`inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${impactColor(impact)}`}>
            {impact === 'Hoch' ? t.analysis_impact_high : impact === 'Mittel' ? t.analysis_impact_medium : t.analysis_impact_low}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-gray-600">{reason}</p>
      </div>
    </div>
  );
}

// ── Strength/Weakness card ─────────────────────────────────────────────────────

function StrengthCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border-l-4 border-emerald-400 bg-emerald-50/60 p-3">
      <div className="flex gap-2">
        <span className="flex-shrink-0 text-base">💪</span>
        <p className="text-sm leading-relaxed text-emerald-900">{text}</p>
      </div>
    </div>
  );
}

function WeaknessCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border-l-4 border-amber-400 bg-amber-50/60 p-3">
      <div className="flex gap-2">
        <span className="flex-shrink-0 text-base">🔧</span>
        <p className="text-sm leading-relaxed text-amber-900">{text}</p>
      </div>
    </div>
  );
}

// ── Channel Analysis Accordion ─────────────────────────────────────────────────

const CHANNEL_MAP: Record<string, { labelKey: string; contentType: ContentType; icon: string }> = {
  seo: { labelKey: 'analysis_seo', contentType: 'seo_blog', icon: '📝' },
  pinterest: { labelKey: 'analysis_pinterest', contentType: 'pinterest_pin', icon: '📌' },
  etsy: { labelKey: 'analysis_etsy', contentType: 'etsy_listing', icon: '🛍️' },
  social: { labelKey: 'analysis_social', contentType: 'social_post', icon: '📱' },
};

function ChannelSection({
  channelKey,
  analysisText,
  allResults,
  productIdea,
  onContentImproved,
}: {
  channelKey: string;
  analysisText: string | null;
  allResults: ContentResult[];
  productIdea: string;
  onContentImproved: (contentType: ContentType, result: ContentResult) => void;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isImproving, setIsImproving] = useState(false);
  const [improveError, setImproveError] = useState<string | null>(null);
  const [flashGreen, setFlashGreen] = useState(false);

  const channel = CHANNEL_MAP[channelKey];
  if (!channel) return null;

  const scoreMatch = analysisText?.match(/Score:\s*(\d+)\s*\/\s*100/i);
  const score = scoreMatch ? parseInt(scoreMatch[1]) : null;
  const colors = score !== null ? scoreColor(score) : { badge: 'bg-gray-400' };

  const isNotGenerated = analysisText?.includes('wurde nicht generiert') ?? false;

  const handleImprove = useCallback(async () => {
    setIsImproving(true);
    setImproveError(null);

    // Find the current content for this channel
    const currentResult = allResults.find((r) => r.contentType === channel.contentType);
    if (!currentResult) {
      setImproveError('Kein Original-Content gefunden.');
      setIsImproving(false);
      return;
    }

    try {
      const improved = await improveContentServer({
        data: {
          contentType: channel.contentType,
          currentContent: currentResult.body,
          analysisFeedback: analysisText ?? '',
          productIdea,
        },
      });
      onContentImproved(channel.contentType, improved);
      setFlashGreen(true);
      setTimeout(() => setFlashGreen(false), 2000);
    } catch (err) {
      setImproveError(err instanceof Error ? err.message : t.analysis_improve_error);
    } finally {
      setIsImproving(false);
    }
  }, [channel.contentType, analysisText, productIdea, allResults, onContentImproved]);

  return (
    <div className={`overflow-hidden rounded-xl border shadow-sm transition-all duration-300 ${flashGreen ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-gray-200'}`}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50"
      >
        <span className="text-lg">{channel.icon}</span>
        <span className="flex-1 text-sm font-semibold text-gray-900">
          {t[channel.labelKey as keyof typeof t] ?? channelKey}
        </span>
        {score !== null && (
          <span className={`inline-flex flex-shrink-0 items-center rounded-full px-3 py-1 text-xs font-bold text-white ${colors.badge}`}>
            {score}/100
          </span>
        )}
        {isNotGenerated && (
          <span className="inline-flex flex-shrink-0 items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500">
            —
          </span>
        )}
        <svg
          className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body */}
      <div className={`grid transition-all duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="border-t border-gray-100 px-5 py-4">
            {analysisText ? (
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                {analysisText}
              </div>
            ) : (
              <p className="text-sm italic text-gray-400">Keine Analyse verfügbar.</p>
            )}

            {/* Improve button */}
            {!isNotGenerated && analysisText && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleImprove}
                  disabled={isImproving}
                  className={`inline-flex items-center gap-2 rounded-xl border-2 border-blue-400 px-4 py-2 text-sm font-semibold text-blue-700 transition-all hover:bg-blue-50 hover:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed ${isImproving ? 'animate-pulse' : ''}`}
                >
                  {isImproving ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      {t.analysis_improving}
                    </>
                  ) : flashGreen ? (
                    <>
                      <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {t.analysis_improved}
                    </>
                  ) : (
                    t.analysis_improve_btn
                  )}
                </button>
                {improveError && (
                  <p className="mt-2 text-xs text-red-600">{improveError}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Parse bullet-like items from raw text ──────────────────────────────────────

function parseBulletItems(text: string | null): string[] {
  if (!text) return [];
  // Split on **Heading** or on double newline, keep meaningful chunks
  const items = text.split(/\n\n+/).filter((item) => item.trim().length > 10);
  if (items.length === 0) return [text];
  return items;
}

function parsePriorityItems(text: string | null): Array<{ title: string; impact: string; reason: string }> {
  if (!text) return [];
  const items: Array<{ title: string; impact: string; reason: string }> = [];
  const regex = /^\d+\.\s*(.+?)\s*—\s*Einfluss:\s*(Hoch|Mittel|Niedrig)\s*—\s*(.+)$/gm;
  let m;
  while ((m = regex.exec(text)) !== null) {
    items.push({ title: m[1].trim(), impact: m[2], reason: m[3].trim() });
  }
  return items;
}

// ── Parse "Nächste Schritte" items (format: 1. **Title** — reason) ─────────────

function parseNextSteps(text: string | null): Array<{ title: string; reason: string }> {
  if (!text) return [];
  const items: Array<{ title: string; reason: string }> = [];
  // Match: 1. **Title** — explanation text
  const regex = /^\d+\.\s*\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/gm;
  let m;
  while ((m = regex.exec(text)) !== null) {
    items.push({ title: m[1].trim(), reason: m[2].trim() });
  }
  return items;
}

// ── Parse "Zeitinvestition" items ───────────────────────────────────────────────

interface TimeInvestmentItem {
  task: string;
  effort: string;
  impact: string;
  why: string;
}

function parseTimeInvestment(text: string | null): TimeInvestmentItem[] {
  if (!text) return [];
  const items: TimeInvestmentItem[] = [];
  // Split by "**Aufgabe**:" pattern
  const blocks = text.split(/(?=\*\*Aufgabe\*\*:)/g);
  for (const block of blocks) {
    const taskMatch = block.match(/\*\*Aufgabe\*\*:\s*(.+?)(?:\n|$)/);
    const effortMatch = block.match(/⏱\s*Aufwand:\s*(.+?)(?:\n|$)/);
    const impactMatch = block.match(/📈\s*Wirkung:\s*(.+?)(?:\n|$)/);
    const whyMatch = block.match(/🎯\s*Warum:\s*(.+?)(?:\n|$)/);
    if (taskMatch) {
      items.push({
        task: taskMatch[1].trim(),
        effort: effortMatch?.[1]?.trim() ?? '',
        impact: impactMatch?.[1]?.trim() ?? '',
        why: whyMatch?.[1]?.trim() ?? '',
      });
    }
  }
  return items;
}

// ── Parse "Achtung" items (⚠️-prefixed warnings) ────────────────────────────────

function parseWarnings(text: string | null): string[] {
  if (!text) return [];
  // Split on lines starting with ⚠️ or on bullet points with ⚠️
  const items = text.split(/\n(?=⚠️|[-•]\s*⚠️)/);
  return items.map((i) => i.replace(/^[-•]\s*/, '').trim()).filter((i) => i.length > 0);
}

// ── Parse "Quick Wins" items ───────────────────────────────────────────────────

interface QuickWinItem {
  title: string;
  impact: string;
  impactLabel: string;
  explanation: string;
}

function parseQuickWins(text: string | null): QuickWinItem[] {
  if (!text) return [];
  const items: QuickWinItem[] = [];
  // Match: - **Quick Win**: title \n  - ⚡ Einfluss: Hoch — explanation
  const blocks = text.split(/(?=\*\*Quick Win\*\*:)/g);
  for (const block of blocks) {
    const titleMatch = block.match(/\*\*Quick Win\*\*:\s*(.+?)(?:\n|$)/);
    const impactMatch = block.match(/⚡\s*Einfluss:\s*(Hoch|Mittel)\s*[—–-]\s*(.+?)(?:\n|$)/i);
    if (titleMatch) {
      const impactRaw = impactMatch?.[1]?.trim() ?? 'Mittel';
      items.push({
        title: titleMatch[1].trim(),
        impact: impactRaw,
        impactLabel: impactRaw === 'Hoch' ? 'Hoch' : 'Mittel',
        explanation: impactMatch?.[2]?.trim() ?? '',
      });
    }
  }
  return items;
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

interface AnalysisDashboardProps {
  data: ContentResult;
  allResults?: ContentResult[];
  productIdea?: string;
  projectId?: string | null;
  onContentImproved?: (contentType: ContentType, result: ContentResult) => void;
  marketIntelligenceContent?: ContentResult | null;
  allProjects?: Project[];
}

export default function AnalysisDashboard({
  data,
  allResults = [],
  productIdea = '',
  projectId = null,
  onContentImproved,
  marketIntelligenceContent,
  allProjects,
}: AnalysisDashboardProps) {
  const { t } = useTranslation();
  const sections = parseSections(data.body);

  const strengths = parseBulletItems(sections.strengths);
  const weaknesses = parseBulletItems(sections.weaknesses);
  const priorities = parsePriorityItems(sections.priorities);
  const nextSteps = parseNextSteps(sections.nextSteps);
  const timeInvestments = parseTimeInvestment(sections.timeInvestment);
  const warnings = parseWarnings(sections.warnings);
  const quickWins = parseQuickWins(sections.quickWins);

  // If parsing didn't find any priority items, fall back to manual parsing
  const displayPriorities = priorities.length > 0 ? priorities : (
    sections.priorities ? [{ title: sections.priorities, impact: 'Mittel', reason: '' }] : []
  );

  const handleContentImproved = useCallback((contentType: ContentType, result: ContentResult) => {
    onContentImproved?.(contentType, result);
  }, [onContentImproved]);

  return (
    <div className="space-y-6">
      {/* ── 🧠 Project Intelligence (cross-project analysis) ── */}
      {allProjects && allProjects.length >= 1 && (
        <ProjectIntelligence projects={allProjects} currentProjectId={projectId} />
      )}

      {/* ── 📊 Market Intelligence (broadest strategic overview, rendered first) ── */}
      {marketIntelligenceContent && (
        <MarketIntelligence intelligenceText={marketIntelligenceContent.body} />
      )}

      {/* ── 🎯 Marketing Mission ────────────────────────────────────────────── */}
      {sections.marketingMission && (
        <MarketingMission
          missionText={sections.marketingMission}
          projectId={projectId}
        />
      )}

      {/* ── Top Section: Score + Priorities ───────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
        {/* Circular Score */}
        <div className="flex justify-center lg:justify-start">
          <CircularScore score={sections.overallScore} size={130} />
        </div>

        {/* Priorities */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-gray-800">{t.analysis_priorities}</h3>
          {displayPriorities.length > 0 ? (
            displayPriorities.map((p, i) => (
              <PriorityCard key={i} number={i + 1} title={p.title} impact={p.impact} reason={p.reason} />
            ))
          ) : (
            <p className="text-sm italic text-gray-400">Keine Prioritäten verfügbar.</p>
          )}
        </div>
      </div>

      {/* ── Stärken & Schwächen ────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Stärken */}
        <div>
          <h3 className="mb-3 text-sm font-bold text-gray-800 flex items-center gap-2">
            <span>✅</span> {t.analysis_strengths}
          </h3>
          <div className="space-y-2">
            {strengths.length > 0 ? (
              strengths.map((s, i) => <StrengthCard key={i} text={s} />)
            ) : (
              <p className="text-sm italic text-gray-400">{t.analysis_no_strengths}</p>
            )}
          </div>
        </div>

        {/* Schwächen */}
        <div>
          <h3 className="mb-3 text-sm font-bold text-gray-800 flex items-center gap-2">
            <span>⚠️</span> {t.analysis_weaknesses}
          </h3>
          <div className="space-y-2">
            {weaknesses.length > 0 ? (
              weaknesses.map((w, i) => <WeaknessCard key={i} text={w} />)
            ) : (
              <p className="text-sm italic text-gray-400">{t.analysis_no_weaknesses}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Channel Analyses ───────────────────────────────────────────────── */}
      <div>
        <h3 className="mb-3 text-sm font-bold text-gray-800">{t.analysis_channels}</h3>
        <div className="space-y-2">
          {(['seo', 'pinterest', 'etsy', 'social'] as const).map((key) => (
            <ChannelSection
              key={key}
              channelKey={key}
              analysisText={
                key === 'seo' ? sections.seo :
                key === 'pinterest' ? sections.pinterest :
                key === 'etsy' ? sections.etsy :
                sections.social
              }
              allResults={allResults}
              productIdea={productIdea}
              onContentImproved={handleContentImproved}
            />
          ))}
        </div>
      </div>

      {/* ── Priorities (repeated standalone) ───────────────────────────────── */}
      {displayPriorities.length > 0 && sections.priorities && (
        <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-purple-50 p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-blue-900">📋 {t.analysis_priorities}</h3>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-blue-900">
            {sections.priorities}
          </div>
        </div>
      )}

      {/* ── 🚀 Nächste Schritte ─────────────────────────────────────────────── */}
      {nextSteps.length > 0 && (
        <div className="mb-8">
          <h3 className="mb-3 text-sm font-bold text-gray-800 flex items-center gap-2">
            <span>🚀</span> {t.analysis_next_steps}
          </h3>
          <div className="space-y-3">
            {nextSteps.map((step, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm border-l-4 border-l-blue-400 transition-all hover:shadow-md hover:border-l-blue-500"
              >
                <span
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{
                    background: i === 0
                      ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                      : i === 1
                      ? 'linear-gradient(135deg, #8b5cf6, #a78bfa)'
                      : 'linear-gradient(135deg, #a78bfa, #c4b5fd)',
                  }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900">{step.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-600">{step.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 🎯 Zeitinvestition ──────────────────────────────────────────────── */}
      {timeInvestments.length > 0 && (
        <div className="mb-8">
          <h3 className="mb-3 text-sm font-bold text-gray-800 flex items-center gap-2">
            <span>🎯</span> {t.analysis_time_investment}
          </h3>
          <div className="space-y-3">
            {timeInvestments.map((item, i) => (
              <div
                key={i}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <p className="text-sm font-semibold text-gray-900 mb-3">{item.task}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {item.effort && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                      ⏱ {item.effort}
                    </span>
                  )}
                  {item.impact && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                      📈 {item.impact}
                    </span>
                  )}
                  {item.why && (
                    <span className="mt-1 block w-full text-xs text-gray-500">
                      🎯 {item.why}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ⚠️ Achtung ──────────────────────────────────────────────────────── */}
      {warnings.length > 0 && (
        <div className="mb-8">
          <h3 className="mb-3 text-sm font-bold text-gray-800 flex items-center gap-2">
            <span>⚠️</span> {t.analysis_warnings}
          </h3>
          <div className="space-y-2">
            {warnings.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-2xl border border-amber-200 border-l-4 border-l-amber-400 bg-amber-50 p-4 shadow-sm"
              >
                <span className="flex-shrink-0 text-lg">⚠️</span>
                <p className="text-sm leading-relaxed text-amber-900 font-medium">{w}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ⚡ Quick Wins ───────────────────────────────────────────────────── */}
      {quickWins.length > 0 && (
        <div className="mb-8">
          <h3 className="mb-3 text-sm font-bold text-gray-800 flex items-center gap-2">
            <span>⚡</span> {t.analysis_quick_wins}
          </h3>
          <div className="space-y-2">
            {quickWins.map((qw, i) => (
              <div
                key={i}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center gap-3 mb-1">
                  <p className="text-sm font-semibold text-gray-900">{qw.title}</p>
                  <span
                    className={`inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      qw.impact === 'Hoch'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    ⚡ {t.analysis_quick_win_impact}: {qw.impactLabel}
                  </span>
                </div>
                {qw.explanation && (
                  <p className="text-xs text-gray-500">{qw.explanation}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 🤖 Marketing Coach ──────────────────────────────────────────────── */}
      {sections.coach && (
        <div className="mb-8">
          <h3 className="mb-3 text-sm font-bold text-gray-800 flex items-center gap-2">
            <span>🤖</span> {t.analysis_coach}
          </h3>
          <div className="rounded-2xl bg-blue-50/60 p-6 shadow-sm">
            <div className="text-base leading-relaxed text-gray-800 whitespace-pre-wrap">
              {sections.coach}
            </div>
            <p className="mt-4 text-sm italic text-blue-600">{t.analysis_coach_signature}</p>
          </div>
        </div>
      )}

      {/* ── Gesamtbewertung ────────────────────────────────────────────────── */}
      {sections.overall && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-gray-800 flex items-center gap-2">
            <span>🏆</span> {t.analysis_overall}
          </h3>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
            {sections.overall}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Exportable placeholder component for loading/error ─────────────────────────

export function AnalysisPlaceholder({
  isLoading,
  error,
  onRetry,
}: {
  isLoading: boolean;
  error: string | null;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 h-10 w-10 animate-spin rounded-full border-3 border-blue-200 border-t-blue-600" />
        <p className="text-sm font-medium text-gray-500">{t.analysis_loading}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <span className="mb-3 text-3xl">⚠️</span>
        <p className="text-sm font-medium text-red-700">{t.analysis_error}</p>
        <p className="mt-1 text-xs text-red-500">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-all hover:bg-red-50"
          >
            {t.analysis_retry}
          </button>
        )}
      </div>
    );
  }

  return null;
}
