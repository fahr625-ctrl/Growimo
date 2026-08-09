import { useState } from 'react';
import { generatePlaceholderImage } from '~/ai/image-providers';
import { useTranslation } from '~/i18n';
import type { ImageGenerationRequest } from '~/ai/image-providers/types';

interface ImageStudioProps {
  productIdea: string;
  contentType?: string;
}

type StudioFormat = ImageGenerationRequest['aspectRatio'];

const FORMATS: Array<{ ratio: StudioFormat; labelKey: 'image_studio_format_pinterest' | 'image_studio_format_etsy' | 'image_studio_format_instagram' | 'image_studio_format_blog'; filename: string; promptKey: 'image_studio_prompt_format_pinterest' | 'image_studio_prompt_format_etsy' | 'image_studio_prompt_format_instagram' | 'image_studio_prompt_format_blog'; prompt: (idea: string, template: string) => string }> = [
  { ratio: '2:3', labelKey: 'image_studio_format_pinterest', filename: 'pinterest-pin', prompt: (idea) => `Professional Pinterest pin image for: ${idea}. Vertical 2:3 format, clean aesthetic, eye-catching, minimal text overlay space at bottom.` },
  { ratio: '4:3', labelKey: 'image_studio_format_etsy', filename: 'etsy-product-mockup', prompt: (idea) => `Clean Etsy product mockup for: ${idea}. 4:3 format, white background, professional product photography style.` },
  { ratio: '1:1', labelKey: 'image_studio_format_instagram', filename: 'instagram-post', prompt: (idea) => `Instagram post image for: ${idea}. Square 1:1 format, modern social media aesthetic, vibrant and engaging.` },
  { ratio: '16:9', labelKey: 'image_studio_format_blog', filename: 'blog-hero-image', prompt: (idea) => `Blog hero image for: ${idea}. Wide 16:9 format, professional header style, subtle gradient overlay for text readability.` },
];

function fallbackCopy(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export function ImageStudio({ productIdea }: ImageStudioProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);

  const copyPrompt = async (key: string, prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      fallbackCopy(prompt);
    }
    setCopied(key);
    window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
  };

  const downloadImage = async (format: typeof FORMATS[number]) => {
    const dataUrl = generatePlaceholderImage(format.ratio);
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `growimo-${format.filename}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="mt-10" aria-labelledby="image-studio-title">
      <div className="mb-3"><a href={`/app/image-studio?idea=${encodeURIComponent(productIdea)}`} className="text-sm font-semibold text-blue-600 hover:underline">{t.image_studio_open_full}</a></div>
      <div className="mb-4">
        <h2 id="image-studio-title" className="text-lg font-bold text-gray-900">{t.image_studio_title}</h2>
        <p className="mt-1 text-sm text-gray-500">{t.image_studio_subtitle}</p>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {FORMATS.map((format) => {
          const prompt = format.prompt(productIdea, t[format.promptKey]);
          const copiedThis = copied === format.ratio;
          const label = t[format.labelKey];
          return (
            <article key={format.ratio} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all hover:scale-[1.01] hover:shadow-md">
              <div className={`relative overflow-hidden bg-blue-500 ${format.ratio === '2:3' ? 'aspect-[2/3]' : format.ratio === '4:3' ? 'aspect-[4/3]' : format.ratio === '16:9' ? 'aspect-video' : 'aspect-square'}`}>
                <img src={generatePlaceholderImage(format.ratio)} alt={t.image_studio_alt_placeholder.replace('%s', label)} className="h-full w-full object-cover" />
                <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-gray-700 shadow-sm">{label} · {format.ratio}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
                <button type="button" onClick={() => void downloadImage(format)} className="inline-flex items-center justify-center gap-1 rounded-xl border border-gray-200 px-2 py-2 text-xs font-semibold text-gray-700 transition hover:border-blue-300 hover:bg-blue-50" title={t.image_studio_download_svg}>⬇ <span>{t.image_studio_download}</span></button>
                <button type="button" onClick={() => void copyPrompt(format.ratio, prompt)} className={`inline-flex items-center justify-center gap-1 rounded-xl border px-2 py-2 text-xs font-semibold transition ${copiedThis ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50'}`} title={t.image_studio_copy_prompt_title}>{copiedThis ? '✓' : '📋'} <span>{copiedThis ? t.image_studio_copied : t.image_studio_copy_prompt}</span></button>
                <button type="button" disabled title={t.image_studio_api_required} className="inline-flex cursor-not-allowed items-center justify-center gap-1 rounded-xl border border-gray-200 px-2 py-2 text-xs font-semibold text-gray-500 opacity-50">🔄 <span>{t.image_studio_regenerate}</span></button>
                <button type="button" disabled title={t.image_studio_api_required} className="inline-flex cursor-not-allowed items-center justify-center gap-1 rounded-xl border border-gray-200 px-2 py-2 text-xs font-semibold text-gray-500 opacity-50">✨ <span>{t.image_studio_variation}</span></button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
