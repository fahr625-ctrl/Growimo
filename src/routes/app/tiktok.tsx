import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation } from '~/i18n';
import { track } from '~/lib/tracking-client';
import type { TikTokDiagnoseResult, TikTokIdeaResult, TikTokMode, TikTokResult } from '~/ai/tiktok';
import { generateTikTokServer } from '~/ai/server';
import {
  getBrandProfile,
  getBrandContext,
  isBrandProfileComplete,
  type BrandProfile,
} from '~/store/brand';

/** localStorage-Historie der zuletzt generierten TikTok-Ideen (Hooks). Max 10. */
const TIKTOK_HISTORY_KEY = 'growimo_tiktok_history';
const TIKTOK_HISTORY_MAX = 10;
function loadTikTokHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TIKTOK_HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function pushTikTokHistory(hook: string): void {
  try {
    const h = [hook.trim(), ...loadTikTokHistory().filter((x) => x.trim() !== hook.trim())];
    localStorage.setItem(TIKTOK_HISTORY_KEY, JSON.stringify(h.slice(0, TIKTOK_HISTORY_MAX)));
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * TikTok-Bereich: eigenständige, geführte Route (kein leerer Chat).
 * Growimo liefert Entscheidungen in 3 Modi (todayIdea / concept / diagnose).
 * Ergebnisse werden strukturiert im UI dargestellt (nicht persistiert).
 */

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <button
      onClick={() => void copy()}
      className="ml-2 inline-flex shrink-0 items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 transition hover:bg-gray-100"
    >
      {copied ? `✓ ${t.tiktok_copied}` : `📋 ${label}`}
    </button>
  );
}

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">{label}</h4>
      <div className="text-sm leading-relaxed text-gray-800">{children}</div>
    </div>
  );
}

function ResultView({ result }: { result: TikTokResult }) {
  const { t } = useTranslation();
  if (result.mode === 'diagnose') {
    const r = result as TikTokDiagnoseResult;
    return (
      <div className="rounded-2xl border border-cyan-100 bg-white p-6 shadow-sm">
        <FieldBlock label={t.tiktok_result_biggest}>
          <p>{r.biggestProblem}</p>
        </FieldBlock>
        <FieldBlock label={t.tiktok_result_works}>
          <ul className="list-disc space-y-1 pl-5">
            {r.whatWorks.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </FieldBlock>
        <FieldBlock label={t.tiktok_result_improve}>
          <ul className="list-disc space-y-1 pl-5">
            {r.whatToImprove.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </FieldBlock>
        <FieldBlock label={t.tiktok_result_newhook}>
          <p>{r.newHook}<CopyButton text={r.newHook} label={t.tiktok_copy} /></p>
        </FieldBlock>
        <FieldBlock label={t.tiktok_result_optimized}>
          <p className="whitespace-pre-line">{r.optimized}<CopyButton text={r.optimized} label={t.tiktok_copy} /></p>
        </FieldBlock>
        <FieldBlock label={t.tiktok_result_nexttest}>
          <p>{r.nextTest}<CopyButton text={r.nextTest} label={t.tiktok_copy} /></p>
        </FieldBlock>
      </div>
    );
  }
  const r = result as TikTokIdeaResult;
  return (
    <div className="rounded-2xl border border-cyan-100 bg-white p-6 shadow-sm">
      <FieldBlock label={t.tiktok_result_idea}>
        <p>{r.idea}<CopyButton text={r.idea} label={t.tiktok_copy} /></p>
      </FieldBlock>
      <FieldBlock label={t.tiktok_result_hook}>
        <p>{r.hook}<CopyButton text={r.hook} label={t.tiktok_copy} /></p>
      </FieldBlock>
      <FieldBlock label={t.tiktok_result_length}>
        <p>{r.length}</p>
      </FieldBlock>
      <FieldBlock label={t.tiktok_result_scenes}>
        <ol className="list-decimal space-y-1 pl-5">
          {r.scenes.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </FieldBlock>
      {r.overlays.length > 0 && (
        <FieldBlock label={t.tiktok_result_overlays}>
          <ul className="list-disc space-y-1 pl-5">
            {r.overlays.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
          <div className="mt-2"><CopyButton text={r.overlays.join('\n')} label={t.tiktok_copy} /></div>
        </FieldBlock>
      )}
      {r.spokenText.trim() !== '' && (
        <FieldBlock label={t.tiktok_result_spoken}>
          <p className="whitespace-pre-line">{r.spokenText}<CopyButton text={r.spokenText} label={t.tiktok_copy} /></p>
        </FieldBlock>
      )}
      <FieldBlock label={t.tiktok_result_caption}>
        <p className="whitespace-pre-line">{r.caption}<CopyButton text={r.caption} label={t.tiktok_copy} /></p>
      </FieldBlock>
      <FieldBlock label={t.tiktok_result_hashtags}>
        <p className="whitespace-pre-line">{r.hashtags.join(' ')}<CopyButton text={r.hashtags.join(' ')} label={t.tiktok_copy} /></p>
      </FieldBlock>
      <FieldBlock label={t.tiktok_result_cta}>
        <p>{r.cta}</p>
      </FieldBlock>
      <FieldBlock label={t.tiktok_result_why}>
        <p>{r.why}</p>
      </FieldBlock>
    </div>
  );
}

function TikTokPage() {
  return <ProtectedRoute><TikTokContent /></ProtectedRoute>;
}

function TikTokContent() {
  const { t, locale } = useTranslation();
  const { user } = useUser();
  const [biz, setBiz] = useState('');
  const [goal, setGoal] = useState('');
  const [audience, setAudience] = useState('');
  const [topic, setTopic] = useState('');
  const [metrics, setMetrics] = useState({ views: '', length: '', avgWatch: '', likes: '', comments: '', shares: '', profile: '' });
  const [activeMode, setActiveMode] = useState<TikTokMode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<TikTokResult | null>(null);
  const [brandProfile, setBrandProfile] = useState<BrandProfile | null>(null);

  useEffect(() => {
    track('tiktok_area_opened', user?.id);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [user?.id]);

  // Markenprofil laden und das Formular (biz/audience) automatisch vorausfüllen.
  useEffect(() => {
    const profile = getBrandProfile();
    if (profile) {
      setBrandProfile(profile);
      setBiz((prev) => {
        if (prev.trim()) return prev;
        const src = profile.offerings?.trim() || profile.tagline?.trim();
        return src || profile.uniqueSellingPoint?.trim() || '';
      });
      setAudience((prev) => (prev.trim() ? prev : profile.targetAudience?.trim() || ''));
    }
  }, []);

  const brandReady = isBrandProfileComplete(brandProfile);

  const metric = (k: keyof typeof metrics) => Number(metrics[k]) || 0;

  const run = async (mode: TikTokMode) => {
    const brandContext = getBrandContext();
    if (!biz.trim() && !brandContext) {
      setError(true);
      return;
    }
    let valid = true;
    if (mode === 'concept' && !topic.trim()) valid = false;
    if (mode === 'diagnose' && metrics.views.trim() === '') valid = false;
    if (!valid) { setError(true); return; }
    setError(false);
    setLoading(true);
    setActiveMode(mode);
    try {
      const payload = {
        mode,
        biz: biz.trim(),
        brandContext,
        history: loadTikTokHistory(),
        goal: goal || (brandProfile?.mainGoal?.trim() || undefined),
        audience: audience.trim() || undefined,
        topic: mode === 'concept' ? topic.trim() : undefined,
        metrics: mode === 'diagnose'
          ? {
              views: metric('views'),
              length: metrics.length || 'n/a',
              avgWatch: metric('avgWatch'),
              likes: metric('likes'),
              comments: metric('comments'),
              shares: metric('shares'),
              profileVisits: metric('profile'),
            }
          : undefined,
        lang: locale,
      };
      console.info('[tiktok] calling generateTikTokServer at', new Date().toISOString());
      const res = await generateTikTokServer({ data: payload });
      setResult(res);
      if (res.mode !== 'diagnose') pushTikTokHistory(res.hook);
      if (mode === 'diagnose') track('tiktok_diagnosed', user?.id);
      else track('tiktok_created', user?.id, { mode });
    } catch (error) {
      console.error('[tiktok] generation failed:', error);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setActiveMode(null);
    setError(false);
  };

  const metricInput = (k: keyof typeof metrics, label: string, placeholder?: string) => (
    <div>
      <label className="mb-1 block text-xs font-semibold text-gray-600">{label}</label>
      <input
        value={metrics[k]}
        onChange={(e) => setMetrics((m) => ({ ...m, [k]: e.target.value }))}
        placeholder={placeholder}
        inputMode={k === 'length' ? 'text' : 'numeric'}
        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-cyan-400"
      />
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <div className="mb-2 flex items-center gap-3">
          <Link to="/app" className="text-sm text-blue-600 hover:underline">← {t.nav_dashboard}</Link>
        </div>
        <h1 className="text-3xl font-bold text-gray-900">{t.tiktok_page_title}</h1>
        <p className="mt-2 text-gray-500">{t.tiktok_page_subtitle}</p>
      </header>

      {/* Hinweis, wenn ein (vollständiges) Markenprofil aktiv ist */}
      {brandReady && brandProfile && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <span>{t.tiktok_brand_hint.replace('%s', brandProfile.brandName)}</span>
          <Link to="/app/brand" className="shrink-0 font-bold text-blue-700 underline hover:text-blue-900">
            {t.tiktok_brand_edit}
          </Link>
        </div>
      )}

      {/* Schritt 1 — Unternehmens-Angaben */}
      <section className="rounded-2xl bg-gradient-to-r from-cyan-600 to-teal-600 p-6 text-white shadow-lg">
        <label className="mb-2 block text-sm font-semibold">{t.tiktok_biz_label}</label>
        <input
          value={biz}
          onChange={(e) => setBiz(e.target.value)}
          placeholder={t.tiktok_biz_placeholder}
          className="w-full rounded-xl border-0 px-4 py-3 text-gray-900 outline-none ring-2 ring-transparent focus:ring-white"
        />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-cyan-100">{t.tiktok_goal_label}</label>
            <select value={goal} onChange={(e) => setGoal(e.target.value)} className="w-full rounded-xl border-0 px-4 py-3 text-gray-900 outline-none">
              <option value="">{t.tiktok_goal_placeholder}</option>
              <option value={t.tiktok_goal_reach}>{t.tiktok_goal_reach}</option>
              <option value={t.tiktok_goal_followers}>{t.tiktok_goal_followers}</option>
              <option value={t.tiktok_goal_sales}>{t.tiktok_goal_sales}</option>
              <option value={t.tiktok_goal_community}>{t.tiktok_goal_community}</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-cyan-100">{t.tiktok_audience_label}</label>
            <input
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder={t.tiktok_audience_placeholder}
              className="w-full rounded-xl border-0 px-4 py-3 text-gray-900 outline-none"
            />
          </div>
        </div>
      </section>

      {/* Schritt 2 — die 3 Aktions-Karten */}
      <section>
        <h2 className="mb-4 text-xl font-bold text-gray-900">{t.tiktok_prompt_section_title}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <button onClick={() => void run('todayIdea')} disabled={loading} className="rounded-2xl border border-cyan-100 bg-gradient-to-br from-cyan-50 to-white p-5 text-left shadow-sm transition hover:shadow-md disabled:opacity-60">
            <div className="text-2xl">✨</div>
            <h3 className="mt-2 font-bold text-gray-900">{t.tiktok_card_today_title}</h3>
            <p className="mt-1 text-sm text-gray-500">{t.tiktok_card_today_desc}</p>
          </button>
          <button onClick={() => void run('concept')} disabled={loading} className="rounded-2xl border border-fuchsia-100 bg-gradient-to-br from-fuchsia-50 to-white p-5 text-left shadow-sm transition hover:shadow-md disabled:opacity-60">
            <div className="text-2xl">🎬</div>
            <h3 className="mt-2 font-bold text-gray-900">{t.tiktok_card_concept_title}</h3>
            <p className="mt-1 text-sm text-gray-500">{t.tiktok_card_concept_desc}</p>
          </button>
          <button onClick={() => void run('diagnose')} disabled={loading} className="rounded-2xl border border-teal-100 bg-gradient-to-br from-teal-50 to-white p-5 text-left shadow-sm transition hover:shadow-md disabled:opacity-60">
            <div className="text-2xl">📊</div>
            <h3 className="mt-2 font-bold text-gray-900">{t.tiktok_card_diagnose_title}</h3>
            <p className="mt-1 text-sm text-gray-500">{t.tiktok_card_diagnose_desc}</p>
          </button>
        </div>
      </section>

      {/* Modus-abhängige Zusatzfelder */}
      {activeMode === 'concept' && (
        <section className="rounded-2xl border border-fuchsia-100 bg-white p-6 shadow-sm">
          <label className="mb-2 block text-sm font-semibold">{t.tiktok_topic_label}</label>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t.tiktok_topic_placeholder} className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-fuchsia-400" />
        </section>
      )}
      {activeMode === 'diagnose' && (
        <section className="rounded-2xl border border-teal-100 bg-white p-6 shadow-sm">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">{t.tiktok_metrics_label}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {metricInput('views', t.tiktok_metrics_views)}
            {metricInput('length', t.tiktok_metrics_length, '31s')}
            {metricInput('avgWatch', t.tiktok_metrics_avgwatch)}
            {metricInput('likes', t.tiktok_metrics_likes)}
            {metricInput('comments', t.tiktok_metrics_comments)}
            {metricInput('shares', t.tiktok_metrics_shares)}
            {metricInput('profile', t.tiktok_metrics_profile)}
          </div>
        </section>
      )}

      {/* Ladezustand */}
      {loading && (
        <div className="flex items-center gap-3 rounded-2xl border border-cyan-100 bg-cyan-50 p-5 text-sm font-semibold text-cyan-800">
          <span className="inline-block animate-spin">◌</span>{t.tiktok_loading}
        </div>
      )}

      {/* Fehlerzustand */}
      {error && !loading && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {t.tiktok_error}
          <button onClick={() => activeMode && void run(activeMode)} className="ml-3 font-bold underline">{t.tiktok_retry}</button>
        </div>
      )}

      {/* Ergebnis */}
      {result && !loading && !error && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">{activeMode === 'diagnose' ? t.tiktok_result_biggest : t.tiktok_result_idea}</h2>
            <button onClick={reset} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100">{t.tiktok_new_session}</button>
          </div>
          <ResultView result={result} />
        </section>
      )}
    </div>
  );
}

export const Route = createFileRoute('/app/tiktok')({ component: TikTokPage });
