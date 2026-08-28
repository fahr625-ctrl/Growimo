import { createFileRoute, Link } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation } from '~/i18n';
import { track } from '~/lib/tracking-client';
import { getProjectsByUser, type Project } from '~/store/projects';
import type { GeneratedImage } from '~/ai/image-providers/types';
import { consumeStrategyPrefill, type StrategyImagePayload } from '~/lib/strategy-image';
import { getBrandProfile } from '~/store/brand';

const generateImageServer = createServerFn({ method: 'POST' }).validator((input: unknown) => input as { prompt: string; aspectRatio: string }).handler(async ({ data }) => {
  const { generateImage } = await import('~/ai/image-providers/generate');
  return generateImage(data.prompt, data.aspectRatio);
});

export const Route = createFileRoute('/app/image-studio')({ component: ImageStudioPage });

const templates = [
  ['2:3', 'image_studio_template_pinterest', 'image_studio_prompt_base_pinterest'],
  ['4:3', 'image_studio_template_etsy', 'image_studio_prompt_base_etsy'],
  ['1:1', 'image_studio_template_instagram', 'image_studio_prompt_base_instagram'],
  ['16:9', 'image_studio_template_blog', 'image_studio_prompt_base_blog'],
] as const;
const aspectClass = (ratio: string) => ratio === '2:3' ? 'aspect-[2/3]' : ratio === '4:3' ? 'aspect-[4/3]' : ratio === '16:9' ? 'aspect-video' : 'aspect-square';

// Distinct variation directions. Each one explicitly instructs a different
// combination of composition/perspective/lighting/depth-of-field while the
// main subject, style and format stay identical. They rotate deterministically
// per click (see runCardAction + variationCounter) so repeated taps produce
// visibly different alternates instead of near-identical frames.
const variationDirectionKeys = [
  'image_studio_prompt_variant_1',
  'image_studio_prompt_variant_2',
  'image_studio_prompt_variant_3',
  'image_studio_prompt_variant_4',
  'image_studio_prompt_variant_5',
  'image_studio_prompt_variant_6',
] as const;

function StrategyStamp({ t, prefill }: { t: ReturnType<typeof useTranslation>['t']; prefill: StrategyImagePayload }) {
  const profile = getBrandProfile();
  const infoChip = (label: string, value: string) => (
    <div className="min-w-0 rounded-lg bg-white/70 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">{label}</p>
      <p className="mt-0.5 break-words text-xs text-gray-700">{value || '—'}</p>
    </div>
  );
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">✓</span>
        <span className="text-sm font-bold text-emerald-800">{t.image_studio_from_strategy_badge}</span>
        <span className="ml-auto rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">{prefill.ratio}</span>
      </div>
      <p className="mt-1.5 text-xs text-emerald-700">{t.image_studio_from_strategy_info}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {infoChip(t.image_studio_strategy_platform, prefill.platform)}
        {prefill.overlay && infoChip(t.image_studio_strategy_overlay, prefill.overlay)}
        <div className="min-w-0 rounded-lg bg-white/70 px-3 py-2 sm:col-span-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">{t.image_studio_strategy_concept}</p>
          <p className="mt-0.5 break-words whitespace-pre-wrap text-xs text-gray-700">{prefill.concept || '—'}</p>
        </div>
        {profile?.brandName || profile?.brandColors ? (
          <div className="min-w-0 rounded-lg bg-white/70 px-3 py-2 sm:col-span-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">{t.image_studio_strategy_brand}</p>
            <p className="mt-0.5 break-words text-xs text-gray-700">
              {[profile?.brandName, profile?.brandColors].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
function ImageStudioPage() {
 return <ProtectedRoute><ImageStudioContent /></ProtectedRoute>; }
function ImageStudioContent() {
  const { t } = useTranslation();
  const { user } = useUser();
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState<GeneratedImage['aspectRatio']>('2:3');
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<{ id: string; action: 'variation' | 'regenerate' } | null>(null);
  const [cardError, setCardError] = useState<{ id: string; message: string } | null>(null);
  const [uploads, setUploads] = useState<{ name: string; url: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [strategyPrefill, setStrategyPrefill] = useState<StrategyImagePayload | null>(null);
  // Deterministic rotation across the variation directions so that consecutive
  // "Variation" clicks never request the same direction (and thus never converge
  // to the same composition via gpt-image-1's similar-prompt fold).
  const variationCounter = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const idea = params.get('idea');
    const fromStrategy = params.get('fromStrategy') === '1';
    if (fromStrategy) {
      const prefill = consumeStrategyPrefill();
      if (prefill) {
        setStrategyPrefill(prefill);
        setPrompt(prefill.prompt);
        setRatio(prefill.ratio);
        return;
      }
    }
    if (idea) setPrompt(idea);
  }, []);
  useEffect(() => { if (user?.id) getProjectsByUser(user.id).then(setProjects).catch(() => setProjects([])); }, [user?.id]);
  // Server-side beta-tracking (additive): Image Studio opened.
  useEffect(() => { track('image_studio_opened', user?.id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);
  const generate = async (text = prompt, selectedRatio = ratio) => {
    if (!text.trim()) return;
    setLoading(true); setError(false);
    try { const result = await generateImageServer({ data: { prompt: text, aspectRatio: selectedRatio } }); setImages((prev) => [{ id: crypto.randomUUID(), url: result.url, prompt: text, aspectRatio: selectedRatio, createdAt: new Date() }, ...prev]); track('image_generated', user?.id, { aspectRatio: selectedRatio }); }
    catch { setError(true); } finally { setLoading(false); }
  };
  // Per-card gallery action (Variation / Neu generieren): shows immediate
  // feedback on the card itself, keeps the original image, prepends the new
  // variant, and surfaces a readable per-card error instead of a generic banner.
  const runCardAction = async (image: GeneratedImage, action: 'variation' | 'regenerate') => {
    // 'regenerate' intentionally reproduces the EXACT original prompt. Only
    // 'variation' builds a new prompt: it keeps the original subject/style/
    // format text and appends a rotation-selected direction that explicitly
    // changes composition/perspective/lighting, so gpt-image-1 produces a
    // visibly different frame instead of an identical near-fold.
    const directionKey = variationDirectionKeys[variationCounter.current % variationDirectionKeys.length];
    const cardPrompt = (action === 'variation'
      ? `${image.prompt}. ${t.image_studio_prompt_variation.replace('%s', t[directionKey])}`
      : image.prompt).trim();
    if (cardPrompt) variationCounter.current += 1;
    if (!cardPrompt) return;
    setBusy({ id: image.id, action });
    setCardError(null);
    try {
      const result = await generateImageServer({ data: { prompt: cardPrompt, aspectRatio: image.aspectRatio } });
      setImages((prev) => [{ id: crypto.randomUUID(), url: result.url, prompt: cardPrompt, aspectRatio: image.aspectRatio, createdAt: new Date() }, ...prev]);
      track('image_generated', user?.id, { aspectRatio: image.aspectRatio, action });
    } catch {
      setCardError({ id: image.id, message: t.image_studio_card_error });
    } finally {
      setBusy(null);
    }
  };
  const project = projects.find((p) => p.id === selectedProject);
  const strategyPrompts = project ? templates.map(([, , baseKey]) => `${t[baseKey]} ${project.productIdea}, ${t.image_studio_prompt_optimized_for} ${project.contentTypes.join(', ')}.`) : [];
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); } catch { /* clipboard unavailable */ } };
  const download = async (image: GeneratedImage) => {
    try {
      const response = await fetch(image.url);
      if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `growimo-${image.id}.png`;
      a.click();
      // Let the browser start the download before releasing the blob URL.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      setError(true);
    }
  };
  const handleFiles = (files: FileList | null) => { if (!files) return; setUploads((prev) => [...prev, ...Array.from(files).map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))]); };
  return <div className="mx-auto max-w-5xl space-y-8">
    <header><div className="mb-2 flex items-center gap-3"><Link to="/app" className="text-sm text-blue-600 hover:underline">← {t.nav_dashboard}</Link></div><h1 className="text-3xl font-bold text-gray-900">{t.image_studio_page_title}</h1><p className="mt-2 text-gray-500">{t.image_studio_page_subtitle}</p></header>
    {strategyPrefill && <StrategyStamp t={t} prefill={strategyPrefill} />}
    <section className="rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white shadow-lg"><label className="mb-2 block text-sm font-semibold">{t.image_studio_prompt_label}</label><div className="flex flex-col gap-3 sm:flex-row"><input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t.image_studio_prompt_placeholder} className="min-w-0 flex-1 rounded-xl border-0 px-4 py-3 text-gray-900 outline-none ring-2 ring-transparent focus:ring-white" /><button onClick={() => void generate()} disabled={loading || !prompt.trim()} className="rounded-xl bg-white px-6 py-3 font-bold text-blue-700 transition hover:bg-blue-50 disabled:opacity-60">{loading ? <span className="inline-block animate-spin">◌</span> : '✨'} {loading ? t.image_studio_generating : t.image_studio_generate_btn}</button></div><p className="mt-5 text-xs font-semibold uppercase tracking-wide text-blue-100">{t.image_studio_templates_label}</p><div className="mt-2 flex flex-wrap gap-2">{templates.map(([r, key, baseKey]) => <button key={r} onClick={() => { setRatio(r); setPrompt(`${t[baseKey]} ${prompt || t.image_studio_prompt_fallback_product}${t.image_studio_prompt_suffix}`); }} className="rounded-full bg-white/15 px-3 py-2 text-xs font-semibold transition hover:bg-white/30">{t[key]} </button>)}</div></section>
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-gray-900">{t.image_studio_from_strategy}</h2><select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)} className="mt-3 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm"><option value="">{t.image_studio_select_project}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>{strategyPrompts.length > 0 && <><p className="mt-4 text-sm font-semibold text-gray-700">{t.image_studio_prompts_generated}</p><div className="mt-2 flex flex-wrap gap-2">{strategyPrompts.map((p) => <button key={p} onClick={() => setPrompt(p)} className="rounded-full bg-blue-50 px-3 py-2 text-left text-xs text-blue-700 transition hover:bg-blue-100">{p}</button>)}</div></>}</section>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{t.image_studio_error} <button onClick={() => void generate()} className="ml-3 font-bold underline">{t.analysis_retry}</button></div>}
    <section><h2 className="mb-4 text-xl font-bold text-gray-900">{t.image_studio_gallery_title}</h2>{images.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center text-sm text-gray-500">{t.image_studio_empty}</div> : <div className="grid grid-cols-1 gap-6 md:grid-cols-2">{images.map((image) => <article key={image.id} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md"><div className={`relative ${aspectClass(image.aspectRatio)} bg-gray-100`}><img src={image.url} alt={image.prompt} className="h-full w-full object-cover" /><span className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-gray-700">{image.aspectRatio}</span></div>{cardError?.id === image.id && <div className="border-t border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700">{cardError.message}</div>}<div className="grid grid-cols-2 gap-2 p-4"><button onClick={() => download(image)} className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:bg-gray-200">⬇ {t.image_studio_download}</button><button onClick={() => void copy(image.prompt)} className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:bg-gray-200">📋 {t.image_studio_copy_prompt}</button><button onClick={() => void runCardAction(image, 'regenerate')} disabled={busy?.id === image.id} className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:bg-gray-200 disabled:opacity-60">{busy?.id === image.id && busy.action === 'regenerate' ? <span className="inline-block animate-spin">◌</span> : '🔄'} {busy?.id === image.id && busy.action === 'regenerate' ? t.image_studio_regenerate_generating : t.image_studio_regenerate}</button><button onClick={() => void runCardAction(image, 'variation')} disabled={busy?.id === image.id} className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:bg-gray-200 disabled:opacity-60">{busy?.id === image.id && busy.action === 'variation' ? <span className="inline-block animate-spin">◌</span> : '✨'} {busy?.id === image.id && busy.action === 'variation' ? t.image_studio_variation_generating : t.image_studio_variation}</button></div></article>)}</div>}</section>
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-gray-900">{t.image_studio_upload_title}</h2><label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-8 text-center transition hover:bg-blue-50"><span className="text-3xl">⬆️</span><span className="mt-2 text-sm font-semibold text-blue-700">{t.image_studio_upload_dropzone}</span><input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} /></label>{uploads.length > 0 && <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">{uploads.map((file) => <div key={file.url} className="overflow-hidden rounded-xl border"><img src={file.url} className="aspect-square w-full object-cover" alt={file.name} /><p className="truncate p-2 text-xs text-gray-600">{file.name}</p><button onClick={() => void generate(`${t.image_studio_prompt_upload_variation} ${file.name}`, '1:1')} className="m-2 rounded-lg bg-blue-600 px-2 py-1 text-xs font-semibold text-white">✨ {t.image_studio_variation}</button></div>)}</div>}</section>
  </div>;
}
