import { createFileRoute, Link } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation } from '~/i18n';
import { getProjectsByUser, type Project } from '~/store/projects';
import type { GeneratedImage } from '~/ai/image-providers/types';

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

function ImageStudioPage() { return <ProtectedRoute><ImageStudioContent /></ProtectedRoute>; }
function ImageStudioContent() {
  const { t } = useTranslation();
  const { user } = useUser();
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState<GeneratedImage['aspectRatio']>('2:3');
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [uploads, setUploads] = useState<{ name: string; url: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState('');

  useEffect(() => { const idea = new URLSearchParams(window.location.search).get('idea'); if (idea) setPrompt(idea); }, []);
  useEffect(() => { if (user?.id) getProjectsByUser(user.id).then(setProjects).catch(() => setProjects([])); }, [user?.id]);
  const generate = async (text = prompt, selectedRatio = ratio) => {
    if (!text.trim()) return;
    setLoading(true); setError(false);
    try { const result = await generateImageServer({ data: { prompt: text, aspectRatio: selectedRatio } }); setImages((prev) => [{ id: crypto.randomUUID(), url: result.url, prompt: text, aspectRatio: selectedRatio, createdAt: new Date() }, ...prev]); }
    catch { setError(true); } finally { setLoading(false); }
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
    <section className="rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white shadow-lg"><label className="mb-2 block text-sm font-semibold">{t.image_studio_prompt_label}</label><div className="flex flex-col gap-3 sm:flex-row"><input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t.image_studio_prompt_placeholder} className="min-w-0 flex-1 rounded-xl border-0 px-4 py-3 text-gray-900 outline-none ring-2 ring-transparent focus:ring-white" /><button onClick={() => void generate()} disabled={loading || !prompt.trim()} className="rounded-xl bg-white px-6 py-3 font-bold text-blue-700 transition hover:bg-blue-50 disabled:opacity-60">{loading ? <span className="inline-block animate-spin">◌</span> : '✨'} {loading ? t.image_studio_generating : t.image_studio_generate_btn}</button></div><p className="mt-5 text-xs font-semibold uppercase tracking-wide text-blue-100">{t.image_studio_templates_label}</p><div className="mt-2 flex flex-wrap gap-2">{templates.map(([r, key, baseKey]) => <button key={r} onClick={() => { setRatio(r); setPrompt(`${t[baseKey]} ${prompt || t.image_studio_prompt_fallback_product}${t.image_studio_prompt_suffix}`); }} className="rounded-full bg-white/15 px-3 py-2 text-xs font-semibold transition hover:bg-white/30">{t[key]} </button>)}</div></section>
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-gray-900">{t.image_studio_from_strategy}</h2><select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)} className="mt-3 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm"><option value="">{t.image_studio_select_project}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>{strategyPrompts.length > 0 && <><p className="mt-4 text-sm font-semibold text-gray-700">{t.image_studio_prompts_generated}</p><div className="mt-2 flex flex-wrap gap-2">{strategyPrompts.map((p) => <button key={p} onClick={() => setPrompt(p)} className="rounded-full bg-blue-50 px-3 py-2 text-left text-xs text-blue-700 transition hover:bg-blue-100">{p}</button>)}</div></>}</section>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{t.image_studio_error} <button onClick={() => void generate()} className="ml-3 font-bold underline">{t.analysis_retry}</button></div>}
    <section><h2 className="mb-4 text-xl font-bold text-gray-900">{t.image_studio_gallery_title}</h2>{images.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center text-sm text-gray-500">{t.image_studio_empty}</div> : <div className="grid grid-cols-1 gap-6 md:grid-cols-2">{images.map((image) => <article key={image.id} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md"><div className={`relative ${aspectClass(image.aspectRatio)} bg-gray-100`}><img src={image.url} alt={image.prompt} className="h-full w-full object-cover" /><span className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-gray-700">{image.aspectRatio}</span></div><div className="grid grid-cols-2 gap-2 p-4"><button onClick={() => download(image)} className="rounded-lg border px-2 py-2 text-xs hover:bg-blue-50">⬇ {t.image_studio_download}</button><button onClick={() => void copy(image.prompt)} className="rounded-lg border px-2 py-2 text-xs hover:bg-blue-50">📋 {t.image_studio_copy_prompt}</button><button onClick={() => void generate(image.prompt, image.aspectRatio)} className="rounded-lg border px-2 py-2 text-xs hover:bg-blue-50">🔄 {t.image_studio_regenerate}</button><button onClick={() => void generate(`${image.prompt}, ${t.image_studio_prompt_variation}`, image.aspectRatio)} className="rounded-lg border px-2 py-2 text-xs hover:bg-blue-50">✨ {t.image_studio_variation}</button></div></article>)}</div>}</section>
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-gray-900">{t.image_studio_upload_title}</h2><label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-8 text-center transition hover:bg-blue-50"><span className="text-3xl">⬆️</span><span className="mt-2 text-sm font-semibold text-blue-700">{t.image_studio_upload_dropzone}</span><input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} /></label>{uploads.length > 0 && <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">{uploads.map((file) => <div key={file.url} className="overflow-hidden rounded-xl border"><img src={file.url} className="aspect-square w-full object-cover" alt={file.name} /><p className="truncate p-2 text-xs text-gray-600">{file.name}</p><button onClick={() => void generate(`${t.image_studio_prompt_upload_variation} ${file.name}`, '1:1')} className="m-2 rounded-lg bg-blue-600 px-2 py-1 text-xs font-semibold text-white">✨ {t.image_studio_variation}</button></div>)}</div>}</section>
  </div>;
}
