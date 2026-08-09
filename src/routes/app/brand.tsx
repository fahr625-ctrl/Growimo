import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation } from '~/i18n';
import { trackEvent } from '~/store/analytics';
import { toneLabel } from '~/lib/tones';
import {
  getBrandProfile,
  saveBrandProfile,
  type BrandProfile,
} from '~/store/brand';

export const Route = createFileRoute('/app/brand')({
  component: BrandPage,
});

function BrandPage() {
  return (
    <ProtectedRoute>
      <BrandContent />
    </ProtectedRoute>
  );
}

const TONE_OPTIONS = [
  { value: '' },
  { value: 'professionell' },
  { value: 'freundlich' },
  { value: 'verspielt' },
  { value: 'luxuriös' },
  { value: 'lässig' },
] as const;

const EMPTY_PROFILE: BrandProfile = {
  brandName: '',
  tagline: '',
  tone: '',
  targetAudience: '',
  uniqueSellingPoint: '',
  brandColors: '',
  competitors: '',
  products: [],
  avoidTopics: '',
  brandVoice: '',
  lastUpdated: '',
};

function BrandContent() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<BrandProfile>(EMPTY_PROFILE);
  const [saved, setSaved] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);
  const [productsInput, setProductsInput] = useState('');

  // Load profile on mount
  useEffect(() => {
    const existing = getBrandProfile();
    if (existing) {
      setProfile(existing);
      setProductsInput((existing.products || []).join(', '));
      setHasExisting(true);
    }
  }, []);

  const handleSave = () => {
    const productsList = productsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const toSave: BrandProfile = {
      ...profile,
      products: productsList,
    };
    saveBrandProfile(toSave);
    setHasExisting(true);
    setSaved(true);
    try { trackEvent('brand_profile_saved'); } catch { /* ignore */ }
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-gray-900">{t.brand_title}</h1>
        <p className="mt-1 text-sm text-gray-500">{t.brand_subtitle}</p>
      </div>

      {/* Success toast */}
      {saved && (
        <div className="mb-6 animate-fadeIn rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-sm">
          {t.brand_saved}
        </div>
      )}

      {/* Form cards */}
      <div className="space-y-6">
        {/* Card 1: Basics */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-gray-800">
            {t.brand_section_basics}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                {t.brand_name}
              </label>
              <input
                type="text"
                value={profile.brandName}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, brandName: e.target.value }))
                }
                placeholder={t.brand_name_placeholder}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                {t.brand_tagline}
              </label>
              <input
                type="text"
                value={profile.tagline}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, tagline: e.target.value }))
                }
                placeholder={t.brand_tagline_placeholder}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
        </div>

        {/* Card 2: Tone & Audience */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-gray-800">
            {t.brand_section_tone}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                {t.brand_tone}
              </label>
              <select
                value={profile.tone}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, tone: e.target.value }))
                }
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {TONE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value === '' ? '—' : toneLabel(t, opt.value)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                {t.brand_audience}
              </label>
              <input
                type="text"
                value={profile.targetAudience}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, targetAudience: e.target.value }))
                }
                placeholder={t.brand_audience_placeholder}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
        </div>

        {/* Card 3: Brand Details */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-gray-800">
            {t.brand_section_details}
          </h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                {t.brand_usp}
              </label>
              <input
                type="text"
                value={profile.uniqueSellingPoint}
                onChange={(e) =>
                  setProfile((p) => ({
                    ...p,
                    uniqueSellingPoint: e.target.value,
                  }))
                }
                placeholder={t.brand_usp_placeholder}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                  {t.brand_colors}
                </label>
                <input
                  type="text"
                  value={profile.brandColors}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, brandColors: e.target.value }))
                  }
                  placeholder={t.brand_colors_placeholder}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                  {t.brand_competitors}
                </label>
                <input
                  type="text"
                  value={profile.competitors}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, competitors: e.target.value }))
                  }
                  placeholder={t.brand_competitors_placeholder}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                {t.brand_products}
              </label>
              <input
                type="text"
                value={productsInput}
                onChange={(e) => setProductsInput(e.target.value)}
                placeholder={t.brand_products_placeholder}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <p className="mt-1 text-[11px] text-gray-400">
                {t.brand_products_hint}
              </p>
            </div>
          </div>
        </div>

        {/* Card 4: Voice & Restrictions */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-gray-800">
            {t.brand_section_voice}
          </h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                {t.brand_voice}
              </label>
              <textarea
                value={profile.brandVoice}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, brandVoice: e.target.value }))
                }
                rows={3}
                placeholder={t.brand_voice_placeholder}
                className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                {t.brand_avoid}
              </label>
              <input
                type="text"
                value={profile.avoidTopics}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, avoidTopics: e.target.value }))
                }
                placeholder={t.brand_avoid_placeholder}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-xl hover:-translate-y-0.5"
          >
            {t.brand_save}
          </button>
        </div>
      </div>
    </div>
  );
}
