import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation } from '~/i18n';
import { trackAnalytics } from '~/lib/analytics-client';
import { track } from '~/lib/tracking-client';
import type { TikTokDiagnoseResult, TikTokIdeaResult, TikTokMode, TikTokResult } from '~/ai/tiktok';
import { generateTikTokServer } from '~/ai/server';
import { pickTodayIdeaDirection } from '~/lib/tiktok-directions';
import { studioDeepLink } from '~/lib/studio-deeplink';
import {
  getBrandProfile,
  getBrandContext,
  isBrandProfileComplete,
  type BrandProfile,
} from '~/store/brand';
import { getRecentProjects, type Project } from '~/store/projects';
import { buildTikTokProjectContext } from '~/lib/tiktok-project-context';
import { buildTikTokRecordingPlan } from '~/ai/action-plans/tiktok-recording';
import { guardTikTokRun } from '~/lib/tiktok-safeguards';

/** localStorage-Historie der zuletzt generierten TikTok-Ideen (Hooks). Max 10. */
const TIKTOK_HISTORY_KEY = 'growimo_tiktok_history';
const TIKTOK_HISTORY_MAX = 10;
// Diversität (todayIdea): zuletzt verwendete Content-Richtung — wird bei der
// nächsten Generierung deterministisch ausgeschlossen (Katalog-Rotation).
const TIKTOK_LAST_DIRECTION_KEY = 'growimo_tiktok_last_direction';

/** Lücken des Markenkontexts für die Minimal-Abfrage (Phase 1): welche der
 * 2–3 Kernfelder (Produkt/Angebot, Zielgruppe, Hauptziel) fehlen, damit der
 * Nutzer gezielt nur das nachtragen muss, was Growimo wirklich braucht. */
export interface BrandGaps {
  needProduct: boolean; // Produkt/Angebot fehlt (Pflicht für heute-Idee ohne Markenprofil)
  needAudience: boolean; // Zielgruppe fehlt (optional, aber hilfreich)
  needGoal: boolean; // Hauptziel fehlt (optional)
}

/** Reine Funktion (exportiert für Tests): leitet die fehlenden Felder aus dem
 * aktuellen Formular-Stand + dem (ggf. unvollständigen) Markenprofil ab. */
export function computeBrandGaps(
  biz: string,
  audience: string,
  goal: string,
  profile: BrandProfile | null,
): BrandGaps {
  const p = profile;
  const profileHasOffer = !!(
    p?.offerings?.trim() ||
    (Array.isArray(p?.products) && p.products.length > 0) ||
    p?.uniqueSellingPoint?.trim() ||
    p?.tagline?.trim()
  );
  return {
    needProduct: biz.trim() === '' && !profileHasOffer,
    needAudience: audience.trim() === '' && !(p?.targetAudience?.trim()),
    needGoal: goal.trim() === '' && !(p?.mainGoal?.trim()),
  };
}

/** Entscheidet, ob statt der Generierung die gezielte Minimal-Abfrage erscheint
 * (nur todayIdea): wenn weder ein Unternehmensfeld gefüllt ist noch ein
 * VOLLSTÄNDIGES Markenprofil (isBrandProfileComplete) die Fakten liefert —
 * also auch bei unvollständigem Profil, nicht nur ohne Profil. Phase 4: ein
 * gewähltes Projekt (hasProject) liefert ebenfalls Fakten → dann KEINE
 * Minimal-Abfrage (die Projekt-Fakten ersetzen die Markenangaben, nur lesend). */
export function shouldShowMinimalQuery(
  mode: TikTokMode,
  biz: string,
  brandReady: boolean,
  hasProject: boolean = false,
): boolean {
  return mode === 'todayIdea' && biz.trim() === '' && !brandReady && !hasProject;
}

/** Phase 3 — Pflichtfelder der Diagnose (views + length + avgWatch): liefert die
 *  exakt fehlenden Felder (leer = vollständig). Reine Funktion (exportiert für
 *  Tests); die Fehlermeldung nennt dem Nutzer genau diese Felder. */
export function missingDiagnoseMetrics(m: {
  views: string;
  length: string;
  avgWatch: string;
}): Array<'views' | 'length' | 'avgWatch'> {
  const out: Array<'views' | 'length' | 'avgWatch'> = [];
  if (m.views.trim() === '') out.push('views');
  if (m.length.trim() === '') out.push('length');
  if (m.avgWatch.trim() === '') out.push('avgWatch');
  return out;
}

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
  const { t, locale } = useTranslation();
  // Phase 4 — Aufnahme-/Umsetzungs-Anleitung (deterministisch, LLM-frei):
  // wird nur für Idee-Ergebnisse gebaut (Diagnose → null, Abschnitt entfällt).
  const recPlan = useMemo(
    () =>
      result.mode === 'diagnose'
        ? null
        : buildTikTokRecordingPlan(result as TikTokIdeaResult, locale),
    [result, locale],
  );
  if (result.mode === 'diagnose' && result.dataGap) {
    // Phase 3 — ehrlicher „zu wenig Daten"-Zustand: das Modell wurde nicht
    // gerufen; Growimo erklärt, was ohne die fehlenden Felder nicht beurteilbar
    // ist, und listet die exakt zu ergänzenden Angaben.
    const g = result;
    const labelOf = (k: 'views' | 'length' | 'avgWatch') =>
      k === 'views' ? t.tiktok_metrics_views : k === 'length' ? t.tiktok_metrics_length : t.tiktok_metrics_avgwatch;
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <FieldBlock label={t.tiktok_data_gap_title}>
          <p className="whitespace-pre-line">{g.note}</p>
        </FieldBlock>
        <FieldBlock label={t.tiktok_data_gap_missing}>
          <ul className="list-disc space-y-1 pl-5">
            {g.missingMetrics.map((k, i) => <li key={i}>{labelOf(k)}</li>)}
          </ul>
        </FieldBlock>
        <div className="rounded-xl bg-white/70 px-4 py-3 text-sm leading-relaxed text-gray-800">{g.cta}</div>
      </div>
    );
  }
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
        {r.lengthRecommendation && (
          <FieldBlock label={t.tiktok_result_length_recommendation}>
            <div className="space-y-2">
              <p className="font-semibold text-gray-900">
                {t.tiktok_result_length_seconds.replace('%s', String(r.lengthRecommendation.seconds))}
              </p>
              <p className="whitespace-pre-line text-gray-800">{r.lengthRecommendation.structure}</p>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{t.tiktok_result_length_reason}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-700">{r.lengthRecommendation.reason}</p>
              </div>
            </div>
          </FieldBlock>
        )}
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
      {r.format && (
        <FieldBlock label={t.tiktok_result_format}>
          <span className="inline-flex items-center rounded-full bg-fuchsia-50 px-3 py-1 text-sm font-semibold text-fuchsia-700">
            {r.format}
          </span>
        </FieldBlock>
      )}
      {r.title && (
        <FieldBlock label={t.tiktok_result_title}>
          <p>{r.title}<CopyButton text={r.title} label={t.tiktok_copy} /></p>
        </FieldBlock>
      )}
      {r.timedScenes && r.timedScenes.length > 0 && (
        <FieldBlock label={t.tiktok_result_timed_scenes}>
          <div className="space-y-2">
            {r.timedScenes.map((s, i) => (
              <div key={i} className="flex flex-col gap-1 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 sm:flex-row sm:gap-3">
                <span className="shrink-0 self-start rounded-full bg-cyan-600 px-2 py-0.5 text-xs font-bold text-white">{s.time}</span>
                <div className="min-w-0 text-sm text-gray-800">
                  <p>{s.scene}</p>
                  {s.text.trim() !== '' && <p className="mt-0.5 text-xs italic text-gray-500">„{s.text}“</p>}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton
              text={r.timedScenes.map((s) => `${s.time} – ${s.scene}${s.text.trim() ? ` – „${s.text}“` : ''}`).join('\n')}
              label={t.tiktok_copy}
            />
          </div>
        </FieldBlock>
      )}
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
      {r.imageIdeas && r.imageIdeas.length > 0 && (
        <FieldBlock label={t.tiktok_result_image_ideas}>
          <div className="space-y-3">
            {r.imageIdeas.map((img, i) => (
              <div key={i} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm font-semibold text-gray-900">
                  {img.description}<CopyButton text={img.description} label={t.tiktok_copy} />
                </p>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t.tiktok_result_studio_prompt}</p>
                <p className="mt-1 break-words whitespace-pre-line text-xs text-gray-700">
                  {img.studioPrompt}<CopyButton text={img.studioPrompt} label={t.tiktok_copy} />
                </p>
                <a
                  href={studioDeepLink(img.studioPrompt)}
                  className="mt-3 inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-blue-700"
                >
                  🎨 {t.tiktok_result_image_studio}
                </a>
              </div>
            ))}
          </div>
        </FieldBlock>
      )}
      {/* Phase 4 — Aufnahme-/Umsetzungs-Anleitung (deterministischer Builder,
          siehe src/ai/action-plans/tiktok-recording.ts — nur TikTok nutzt ihn). */}
      {recPlan && (
        <FieldBlock label={t.tiktok_result_recording}>
          <p className="-mt-1 mb-3 text-xs text-gray-500">{t.tiktok_result_recording_hint}</p>
          <ol className="space-y-3">
            {recPlan.plan.map((s) => (
              <li key={s.step} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fuchsia-600 text-xs font-bold text-white">
                    {s.step}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900">{s.action}</p>
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-gray-700">{s.detail}</p>
                    <p className="mt-1.5 text-xs text-gray-500">
                      <span className="font-semibold text-emerald-700">✓ {t.tiktok_result_recording_done}</span>{' '}
                      {s.doneCriteria}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </FieldBlock>
      )}
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<TikTokResult | null>(null);
  const [brandProfile, setBrandProfile] = useState<BrandProfile | null>(null);
  // Gezielte Minimal-Abfrage (Phase 1): statt generischem Fehler werden nur die
  // wirklich fehlenden 2–3 Felder abgefragt (Produkt/Angebot, Zielgruppe, Hauptziel).
  const [minimalQuery, setMinimalQuery] = useState<BrandGaps | null>(null);
  const [minimalError, setMinimalError] = useState<string | null>(null);
  // Phase 4 — jüngste Projekte (LESEND, via getRecentProjects): kompakte
  // Projektauswahl „Mein Projekt“ statt Topic-Eingabe. Keine Schreiboperationen.
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

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

  // Phase 4 — jüngste Projekte LESEND laden (max. 5) für die Projektauswahl.
  // Bewusst non-blocking: schlägt das Laden fehl, nutzt der TikTok-Flow einfach
  // die bisherigen Eingaben (keine Verschlechterung des Bestandsverhaltens).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setProjectsLoading(true);
    getRecentProjects(user.id, 5)
      .then((rows) => {
        if (!cancelled) setProjects(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        /* Projekte sind optional — nie blockieren */
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const brandReady = isBrandProfileComplete(brandProfile);

  // Metrik-Feld: leeres Feld = "nicht angegeben" (undefined, wird NICHT gesendet);
  // eine echte 0 wird als 0 gesendet. So kann das Modell "fehlt" von "0" trennen.
  const metricNumber = (raw: string): number | undefined => {
    const v = raw.trim();
    if (v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  // Phase 5 — Härtung: 1 blockierender Server-Call (serverseitig bis zu 4
  // Retries) wird clientseitig mit Timeout (~90 s) + Abbruch-Button versehen.
  // Die Guard nutzt AbortSignal — createServerFn reicht es an den fetch durch,
  // sodass ein abgebrochener Request wirklich beendet wird (kein Hänger).
  const runGuardRef = useRef<ReturnType<typeof guardTikTokRun<TikTokResult>> | null>(null);
  const handleAbortTikTok = () => {
    runGuardRef.current?.abort('user');
  };
  const run = async (mode: TikTokMode) => {
    const brandContext = getBrandContext();
    // Phase 4 — gewähltes Projekt als LESENDE Faktenquelle (nur vorhandene
    // Felder: title/productIdea/brief-Extrakt; nie erfinden, nie schreiben).
    // Für die Diagnose wird bewusst KEIN Projekt-Kontext gesendet (die
    // Diagnose bleibt rein zahlenbasiert — die Metriken oben sind die Basis).
    const projectContextPayload = mode === 'diagnose'
      ? undefined
      : buildTikTokProjectContext(selectedProject, locale);
    // concept/diagnose: ohne jegliche Marken-/Projektinfos generischer Fehler (wie bisher).
    if (!biz.trim() && !brandContext && !projectContextPayload && mode !== 'todayIdea') {
      setErrorMessage(t.tiktok_error_brand);
      return;
    }
    // todayIdea: GEZIELTE Minimal-Abfrage statt generischer Fehlermeldung —
    // erscheint, wenn Markeninfos fehlen (kein Profil ODER Profil unvollständig
    // per isBrandProfileComplete) UND kein Projekt gewählt ist; abgeleitet aus
    // den Lücken (max. 2–3 Felder). Mit gewähltem Projekt liefern dessen Fakten
    // die Basis (Phase 4).
    if (shouldShowMinimalQuery(mode, biz, brandReady, Boolean(projectContextPayload))) {
      setMinimalQuery(computeBrandGaps(biz, audience, goal, brandProfile));
      setMinimalError(null);
      setActiveMode(mode);
      setErrorMessage(null);
      return;
    }
    let valid = true;
    let validationMsg = '';
    // concept: topic ist seit Phase 1 OPTIONAL (Modell wählt das Thema selbst).
    // diagnose (Phase 3): views + length + avgWatch sind Pflicht — nur damit kann
    // die Diagnose eine Retentions-basierte Längen-/Aufbau-Empfehlung liefern.
    // Die Fehlermeldung nennt die EXAKT fehlenden Felder.
    if (mode === 'diagnose') {
      const missingDiag = missingDiagnoseMetrics(metrics);
      if (missingDiag.length > 0) {
        valid = false;
        const labels = missingDiag.map((k) =>
          k === 'views' ? t.tiktok_metrics_views : k === 'length' ? t.tiktok_metrics_length : t.tiktok_metrics_avgwatch,
        );
        validationMsg = t.tiktok_error_metrics.replace('%s', labels.join(', '));
      }
    }
    if (!valid) { setErrorMessage(validationMsg); return; }
    setErrorMessage(null);
    setMinimalQuery(null);
    setMinimalError(null);
    setLoading(true);
    setActiveMode(mode);
    // Admin-Analytics MVP Phase 1 (additive): tiktok run started + finished.
    const tiktokStart = Date.now();
    const tiktokEvent = mode === 'diagnose' ? 'tiktok_diagnosed' : 'tiktok_created';
    try { trackAnalytics(tiktokEvent, { channel: 'tiktok', status: 'started' }); } catch { /* never block */ }
    try {
      const payload = {
        mode,
        biz: biz.trim(),
        brandContext,
        history: loadTikTokHistory(),
        // Diversität (todayIdea): zuletzt genutzte Richtung → Engine rotiert
        // deterministisch zur NÄCHSTEN Katalog-Richtung (keine Wiederholung).
        previousDirection:
          mode === 'todayIdea' ? (localStorage.getItem(TIKTOK_LAST_DIRECTION_KEY) ?? undefined) : undefined,
        goal: goal || (brandProfile?.mainGoal?.trim() || undefined),
        audience: audience.trim() || undefined,
        topic: mode === 'concept' ? topic.trim() : undefined,
        projectContext: projectContextPayload,
        metrics: mode === 'diagnose'
          ? {
              // 0-vs-fehlend: leere Felder → undefined (werden NICHT an die Engine
              // gesendet); eine echte 0 wird als 0 übertragen.
              views: metricNumber(metrics.views),
              length: metrics.length.trim() ? metrics.length.trim() : undefined,
              avgWatch: metricNumber(metrics.avgWatch),
              likes: metricNumber(metrics.likes),
              comments: metricNumber(metrics.comments),
              shares: metricNumber(metrics.shares),
              profileVisits: metricNumber(metrics.profile),
            }
          : undefined,
        lang: locale,
      };
      console.info('[tiktok] calling generateTikTokServer at', new Date().toISOString());
      const guarded = guardTikTokRun((signal) => generateTikTokServer({ data: payload, signal }));
      runGuardRef.current = guarded;
      const res = await guarded.promise;
      setResult(res);
      if (res.mode !== 'diagnose') pushTikTokHistory(res.hook);
      if (mode === 'todayIdea') {
        // Client und Engine nutzen dieselbe deterministische Funktion → die hier
        // gespeicherte Richtung ist identisch mit der im Prompt verwendeten.
        const prev = localStorage.getItem(TIKTOK_LAST_DIRECTION_KEY) ?? undefined;
        try {
          localStorage.setItem(TIKTOK_LAST_DIRECTION_KEY, pickTodayIdeaDirection(prev));
        } catch { /* localStorage unavailable */ }
      }
      if (mode === 'diagnose') track('tiktok_diagnosed', user?.id);
      else track('tiktok_created', user?.id, { mode });
      // Admin-Analytics MVP Phase 1 (additive): tiktok run finished/done.
      try { trackAnalytics(tiktokEvent, { channel: 'tiktok', status: 'done', durationMs: Date.now() - tiktokStart }); } catch { /* never block */ }
    } catch (error) {
      console.error('[tiktok] generation failed:', error);
      // Phase 5 — ehrliche Meldung: Abbruch (Button) und Timeout werden als
      // solche benannt statt als generischer Fehler; sonst generische Meldung.
      const reason = runGuardRef.current?.reason();
      setErrorMessage(reason === 'user' ? t.tiktok_error_aborted : reason === 'timeout' ? t.tiktok_error_timeout : t.tiktok_error);
      // Admin-Analytics MVP Phase 1 (additive): tiktok run finished/error.
      try { trackAnalytics(tiktokEvent, { channel: 'tiktok', status: 'error', durationMs: Date.now() - tiktokStart }); } catch { /* never block */ }
    } finally {
      runGuardRef.current = null;
      setLoading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setActiveMode(null);
    setErrorMessage(null);
    setMinimalQuery(null);
    setMinimalError(null);
  };

  /** Minimal-Abfrage absenden: fehlendes Pflichtfeld (Produkt/Angebot) muss
   * gefüllt sein — Zielgruppe/Hauptziel sind optional. Danach normal generieren. */
  const submitMinimal = () => {
    const gaps = computeBrandGaps(biz, audience, goal, brandProfile);
    if (gaps.needProduct) {
      setMinimalError(t.tiktok_minq_error_product);
      return;
    }
    setMinimalError(null);
    void run('todayIdea');
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

      {/* Gezielte Minimal-Abfrage (Phase 1): erscheint statt des generischen
          Fehlers, wenn für die heute-Idee Markeninfos fehlen — max. 2–3 Felder,
          abgeleitet aus den Lücken des Markenprofils. */}
      {minimalQuery && !loading && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">{t.tiktok_minq_title}</h2>
          <p className="mt-1 text-sm text-gray-600">{t.tiktok_minq_subtitle}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {minimalQuery.needProduct && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-gray-700">{t.tiktok_minq_product}</label>
                <input
                  value={biz}
                  onChange={(e) => setBiz(e.target.value)}
                  placeholder={t.tiktok_minq_product_ph}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            )}
            {minimalQuery.needAudience && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-gray-700">{t.tiktok_minq_audience}</label>
                <input
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder={t.tiktok_minq_audience_ph}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            )}
            {minimalQuery.needGoal && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-gray-700">{t.tiktok_minq_goal}</label>
                <select
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">{t.tiktok_goal_placeholder}</option>
                  <option value={t.tiktok_goal_reach}>{t.tiktok_goal_reach}</option>
                  <option value={t.tiktok_goal_followers}>{t.tiktok_goal_followers}</option>
                  <option value={t.tiktok_goal_sales}>{t.tiktok_goal_sales}</option>
                  <option value={t.tiktok_goal_community}>{t.tiktok_goal_community}</option>
                </select>
              </div>
            )}
          </div>
          {minimalError && <p className="mt-3 text-sm font-semibold text-red-700">{minimalError}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button
              onClick={submitMinimal}
              className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600"
            >
              {t.tiktok_minq_submit}
            </button>
            <button
              onClick={() => { setMinimalQuery(null); setMinimalError(null); }}
              className="text-sm font-semibold text-gray-600 underline hover:text-gray-800"
            >
              {t.tiktok_minq_later}
            </button>
            <Link to="/app/brand" className="text-sm font-semibold text-amber-700 underline hover:text-amber-900">
              {t.tiktok_minq_brandlink}
            </Link>
          </div>
        </section>
      )}

      {/* Phase 4 — Projektauswahl (LESEND): „Mein Projekt“ statt Topic-Eingabe.
          Titel, Produktidee und Strategie-Brief (F6) werden als Faktenquelle an
          die Engine geschickt (nur heute-Idee/Konzept; Diagnose bleibt zahlenbasiert). */}
      {projects.length > 0 && (
        <section className="rounded-2xl border border-violet-100 bg-white p-6 shadow-sm">
          <label className="mb-2 block text-sm font-semibold text-gray-900">{t.tiktok_project_label}</label>
          <select
            value={selectedProject?.id ?? ''}
            onChange={(e) => {
              const id = e.target.value;
              setSelectedProject(projects.find((p) => p.id === id) ?? null);
            }}
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-violet-400"
          >
            <option value="">{t.tiktok_project_none}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title?.trim() || (p.productIdea || '').slice(0, 60)}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-gray-500">{t.tiktok_project_hint}</p>
        </section>
      )}
      {projectsLoading && (
        <div className="text-xs font-medium text-gray-400">{t.tiktok_project_loading}</div>
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
          <p className="mt-2 text-xs text-gray-500">{t.tiktok_topic_hint}</p>
        </section>
      )}
      {activeMode === 'diagnose' && (
        <section className="rounded-2xl border border-teal-100 bg-white p-6 shadow-sm">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">{t.tiktok_metrics_label}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {metricInput('views', t.tiktok_metrics_views, '–')}
            {metricInput('length', t.tiktok_metrics_length, '31s')}
            {metricInput('avgWatch', t.tiktok_metrics_avgwatch, '–')}
            {metricInput('likes', t.tiktok_metrics_likes, '–')}
            {metricInput('comments', t.tiktok_metrics_comments, '–')}
            {metricInput('shares', t.tiktok_metrics_shares, '–')}
            {metricInput('profile', t.tiktok_metrics_profile, '–')}
          </div>
          <p className="mt-3 text-xs text-gray-500">{t.tiktok_metrics_hint}</p>
        </section>
      )}

      {/* Ladezustand */}
      {loading && (
        <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-5 text-sm font-semibold text-cyan-800">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-3">
              <span className="inline-block animate-spin">◌</span>{t.tiktok_loading}
            </span>
            <button
              onClick={handleAbortTikTok}
              type="button"
              className="shrink-0 rounded-xl border border-cyan-300 bg-white px-3 py-1.5 text-xs font-bold text-cyan-700 transition hover:bg-cyan-100"
            >
              {t.tiktok_abort}
            </button>
          </div>
          <p className="mt-2 text-xs font-normal text-cyan-700">{t.tiktok_loading_hint}</p>
        </div>
      )}

      {/* Fehlerzustand */}
      {errorMessage && !loading && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {errorMessage}
          <button onClick={() => activeMode && void run(activeMode)} className="ml-3 font-bold underline">{t.tiktok_retry}</button>
        </div>
      )}

      {/* Ergebnis */}
      {result && !loading && !errorMessage && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">
              {result.mode === 'diagnose' && result.dataGap ? t.tiktok_data_gap_title : activeMode === 'diagnose' ? t.tiktok_result_biggest : t.tiktok_result_idea}
            </h2>
            <button onClick={reset} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100">{t.tiktok_new_session}</button>
          </div>
          <ResultView result={result} />
        </section>
      )}
    </div>
  );
}

export const Route = createFileRoute('/app/tiktok')({ component: TikTokPage });
