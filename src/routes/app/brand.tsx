import { seoHead } from "~/lib/seo";
import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect, useRef } from 'react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import BrandProfileToggle from '~/components/BrandProfileToggle';
import { useTranslation } from '~/i18n';
import { trackEvent } from '~/store/analytics';
import { toneLabel } from '~/lib/tones';
import {
  getBrandProfile,
  saveBrandProfile,
  BRAND_FONT_IDS,
  type BrandProfile,
  type BrandFontId,
} from '~/store/brand';
import { LOGO_ACCEPT, prepareLogo, type LogoErrorCode } from '~/lib/kampagne/logo-client';

export const Route = createFileRoute('/app/brand')({
  head: () => seoHead({ titleKey: 'meta_app_brand_title' }),
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
  { value: 'locker' },
  { value: 'emotional' },
  { value: 'frech' },
  { value: 'inspirierend' },
] as const;

const EMPTY_PROFILE: BrandProfile = {
  brandName: '',
  website: '',
  tagline: '',
  tone: '',
  targetAudience: '',
  uniqueSellingPoint: '',
  offerings: '',
  mainGoal: '',
  statusChallenge: '',
  brandColors: '',
  competitors: '',
  products: [],
  avoidTopics: '',
  neverClaim: '',
  brandVoice: '',
  logo: '',
  fontId: '',
  enabled: true,
  lastUpdated: '',
};

const FONT_LABEL_KEYS = {
  sans: 'brand_font_sans',
  serif: 'brand_font_serif',
  mono: 'brand_font_mono',
} as const;

const LOGO_ERROR_KEYS = {
  logo_type: 'brand_logo_err_type',
  logo_unreadable: 'brand_logo_err_unreadable',
  logo_too_large: 'brand_logo_err_too_large',
} as const;

function BrandContent() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<BrandProfile>(EMPTY_PROFILE);
  const [saved, setSaved] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);
  const [productsInput, setProductsInput] = useState('');
  // Brand Kit (2026-11-16): Logo-Datei + Meldung
  const [logoError, setLogoError] = useState<LogoErrorCode | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const handleLogoFile = async (file: File | null | undefined) => {
    if (!file) return;
    setLogoError(null);
    setLogoBusy(true);
    try {
      const result = await prepareLogo(file);
      if (!result.ok) {
        setLogoError(result.code);
        return;
      }
      setProfile((p) => ({ ...p, logo: result.dataUrl }));
    } finally {
      setLogoBusy(false);
    }
  };

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

      {/* Phase 1 — EIN/AUS-Schalter: sichtbarer Zustand, ohne das Profil zu löschen */}
      {hasExisting && (
        <div className="mb-6">
          <BrandProfileToggle
            onChange={(enabled) => {
              setProfile((p) => ({ ...p, enabled }));
            }}
          />
        </div>
      )}

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
                {t.brand_website}
              </label>
              <input
                type="text"
                value={profile.website}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, website: e.target.value }))
                }
                placeholder={t.brand_website_placeholder}
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
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                {t.brand_status_challenge}
              </label>
              <input
                type="text"
                value={profile.statusChallenge}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, statusChallenge: e.target.value }))
                }
                placeholder={t.brand_status_placeholder}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-1.5 block text-xs font-semibold text-gray-600">
              {t.brand_offerings}
            </label>
            <textarea
              value={profile.offerings}
              onChange={(e) =>
                setProfile((p) => ({ ...p, offerings: e.target.value }))
              }
              rows={3}
              placeholder={t.brand_offerings_placeholder}
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              {t.brand_offerings_hint}
            </p>
          </div>
        </div>

        {/* Card 1b: Brand Kit — optionales Logo + Schrift (2026-11-16) */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold text-gray-800">{t.brand_kit_section}</h2>
          <p className="mb-5 mt-1 text-[11px] text-gray-400">{t.brand_kit_hint}</p>

          {/* Logo */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-gray-600">
              {t.brand_logo_label}
            </label>
            <p className="mb-2 text-[11px] text-gray-400">{t.brand_logo_hint}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={logoBusy}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-700 transition-all hover:border-blue-500 hover:text-blue-600 disabled:opacity-50"
              >
                {t.brand_logo_upload}
              </button>
              {profile.logo ? (
                <button
                  type="button"
                  onClick={() => {
                    setProfile((p) => ({ ...p, logo: '' }));
                    setLogoError(null);
                  }}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-500 transition-all hover:border-red-300 hover:text-red-600"
                >
                  {t.brand_logo_remove}
                </button>
              ) : null}
              <input
                ref={logoInputRef}
                type="file"
                accept={LOGO_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = '';
                  void handleLogoFile(file);
                }}
              />
            </div>
            {logoError ? (
              <p className="mt-2 text-[11px] font-medium text-red-600">
                {t[LOGO_ERROR_KEYS[logoError]]}
              </p>
            ) : null}
            {profile.logo ? (
              <div className="mt-3 flex flex-wrap gap-4">
                <figure className="m-0">
                  <div className="flex h-20 w-28 items-center justify-center rounded-lg border border-gray-200 bg-white p-2">
                    <img
                      src={profile.logo}
                      alt={t.brand_logo_preview_light}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <figcaption className="mt-1 text-[10px] text-gray-400">
                    {t.brand_logo_preview_light}
                  </figcaption>
                </figure>
                <figure className="m-0">
                  <div className="flex h-20 w-28 items-center justify-center rounded-lg border border-gray-700 bg-gray-900 p-2">
                    <img
                      src={profile.logo}
                      alt={t.brand_logo_preview_dark}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <figcaption className="mt-1 text-[10px] text-gray-400">
                    {t.brand_logo_preview_dark}
                  </figcaption>
                </figure>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-gray-400">{t.brand_logo_none}</p>
            )}
          </div>

          {/* Schrift */}
          <div className="mt-6">
            <label className="mb-1.5 block text-xs font-semibold text-gray-600">
              {t.brand_font_label}
            </label>
            <p className="mb-2 text-[11px] text-gray-400">{t.brand_font_hint}</p>
            <div className="flex flex-wrap gap-2">
              {BRAND_FONT_IDS.map((id: BrandFontId) => {
                const active = (profile.fontId || 'sans') === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setProfile((p) => ({ ...p, fontId: id }))}
                    className={
                      active
                        ? 'rounded-xl border border-blue-500 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700'
                        : 'rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-700 transition-all hover:border-blue-500 hover:text-blue-600'
                    }
                  >
                    {t[FONT_LABEL_KEYS[id as keyof typeof FONT_LABEL_KEYS] ?? 'brand_font_sans']}
                  </button>
                );
              })}
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
                {t.brand_main_goal}
              </label>
              <select
                value={profile.mainGoal}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, mainGoal: e.target.value }))
                }
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">{t.brand_main_goal_placeholder}</option>
                <option value="Reichweite">{t.brand_main_goal_reach}</option>
                <option value="Follower">{t.brand_main_goal_followers}</option>
                <option value="Leads">{t.brand_main_goal_leads}</option>
                <option value="Verkäufe">{t.brand_main_goal_sales}</option>
                <option value="Bekanntheit">{t.brand_main_goal_awareness}</option>
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
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                {t.brand_never_claim}
              </label>
              <textarea
                value={profile.neverClaim}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, neverClaim: e.target.value }))
                }
                rows={2}
                placeholder={t.brand_never_claim_placeholder}
                className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <p className="mt-1 text-[11px] text-gray-400">
                {t.brand_never_claim_hint}
              </p>
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
