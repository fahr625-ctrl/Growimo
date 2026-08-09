import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useClerk, useUser } from '@clerk/clerk-react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation } from '~/i18n';
import { getApiKeyStatusServer } from '~/ai/server';
import { CONTENT_TYPE_REGISTRY } from '~/ai/content-types';
import type { ContentType } from '~/ai/types';
import { TONES, toneLabel } from '~/lib/tones';
import { contentTypeLabel } from '~/lib/content-types';

export const Route = createFileRoute('/app/settings')({
  component: SettingsPage,
});

// ── Preference storage keys ──────────────────────────────────────────────────
const TONE_KEY = 'growimo_default_tone';
const TYPES_KEY = 'growimo_default_types';

// ── Safe localStorage helpers (SSR-safe) ─────────────────────────────────────
function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readTypes(): ContentType[] {
  const raw = readStorage(TYPES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is ContentType =>
        CONTENT_TYPE_REGISTRY.some((c) => c.type === t),
      );
    }
  } catch {
    // ignore corrupt value
  }
  return [];
}

function SettingsPage() {
  return (
    <ProtectedRoute>
      <SettingsContent />
    </ProtectedRoute>
  );
}

function SettingsContent() {
  const { user } = useUser();
  const { openUserProfile } = useClerk();
  const { t, locale, setLocale } = useTranslation();

  // ── Preference state ──────────────────────────────────────────────────────
  const [tone, setTone] = useState<string>(() => readStorage(TONE_KEY) ?? '');
  const [types, setTypes] = useState<ContentType[]>(readTypes);

  // ── API key status ────────────────────────────────────────────────────────
  const [apiConfigured, setApiConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getApiKeyStatusServer()
      .then((res) => {
        if (!cancelled) setApiConfigured(Boolean(res.configured));
      })
      .catch(() => {
        if (!cancelled) setApiConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── "Saved ✓" indicator per section ───────────────────────────────────────
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashSaved = useCallback((section: string) => {
    setSavedSection(section);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSavedSection(null), 1800);
  }, []);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  // ── Handlers (auto-save on change) ────────────────────────────────────────
  const handleSetTone = useCallback((value: string) => {
    setTone(value);
    try {
      if (value) window.localStorage.setItem(TONE_KEY, value);
      else window.localStorage.removeItem(TONE_KEY);
    } catch {
      // ignore storage errors
    }
    flashSaved('preferences');
  }, [flashSaved]);

  const toggleType = useCallback((type: ContentType) => {
    setTypes((prev) => {
      const next = prev.includes(type)
        ? prev.filter((tp) => tp !== type)
        : [...prev, type];
      try {
        window.localStorage.setItem(TYPES_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
    flashSaved('preferences');
  }, [flashSaved]);

  const handleSetLanguage = useCallback((l: 'de' | 'en') => {
    setLocale(l);
    flashSaved('preferences');
  }, [setLocale, flashSaved]);

  const name = user?.fullName?.trim() || user?.firstName?.trim() || '';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const avatarUrl = user?.imageUrl || null;

  return (
    <div className="mx-auto max-w-3xl animate-fadeIn">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-gray-900 sm:text-3xl">
          {t.settings_title}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {t.settings_subtitle}
        </p>
      </div>

      {/* ── Profile ─────────────────────────────────────────────────────────── */}
      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-base font-bold text-gray-900">{t.settings_profile}</h2>
          <span className="h-px flex-1 bg-gray-100" />
        </div>

        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name || t.settings_avatar_alt}
              className="h-16 w-16 flex-shrink-0 rounded-2xl border border-gray-200 object-cover shadow-sm"
            />
          ) : (
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 text-2xl font-bold text-white shadow-sm">
              {(name || 'G').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-gray-900">
              {name || t.settings_default_name}
            </p>
            <p className="truncate text-sm text-gray-500">{email || '—'}</p>
          </div>
          <button
            type="button"
            onClick={() => openUserProfile()}
            className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            {t.settings_manage_account}
          </button>
        </div>
      </section>

      {/* ── Preferences ─────────────────────────────────────────────────────── */}
      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-base font-bold text-gray-900">{t.settings_preferences}</h2>
          <span className="h-px flex-1 bg-gray-100" />
          {savedSection === 'preferences' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              ✓ {t.settings_saved}
            </span>
          )}
        </div>

        {/* Language */}
        <div className="mb-6">
          <span className="mb-2 block text-sm font-semibold text-gray-700">
            {t.settings_language}
          </span>
          <div className="inline-flex gap-1 rounded-xl bg-gray-100 p-1">
            <button
              type="button"
              onClick={() => handleSetLanguage('de')}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                locale === 'de'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.lang_de}
            </button>
            <button
              type="button"
              onClick={() => handleSetLanguage('en')}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                locale === 'en'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.lang_en}
            </button>
          </div>
        </div>

        {/* Default tone */}
        <div className="mb-6">
          <span className="mb-2 block text-sm font-semibold text-gray-700">
            {t.settings_tone}
          </span>
          <div className="flex flex-wrap gap-2">
            {TONES.map((tn) => (
              <button
                key={tn}
                type="button"
                onClick={() => handleSetTone(tone === tn ? '' : tn)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  tone === tn
                    ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {toneLabel(t, tn)}
              </button>
            ))}
          </div>
          {tone && (
            <p className="mt-2 text-xs text-gray-400">
              {t.strategy_tone_label}: {toneLabel(t, tone)}
            </p>
          )}
        </div>

        {/* Default content types */}
        <div>
          <span className="mb-2 block text-sm font-semibold text-gray-700">
            {t.settings_types}
          </span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CONTENT_TYPE_REGISTRY.map((ct) => {
              const checked = types.includes(ct.type);
              return (
                <label
                  key={ct.type}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 transition-all ${
                    checked
                      ? 'border-blue-500 bg-blue-50/60'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleType(ct.type)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500/20"
                  />
                  <span className="text-base">{ct.icon}</span>
                  <span className={`text-xs font-semibold leading-tight ${checked ? 'text-blue-700' : 'text-gray-700'}`}>
                    {contentTypeLabel(t, ct.type)}
                  </span>
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            {types.length > 0
              ? t.strategy_selected_count.replace('%d', String(types.length))
              : '—'}
          </p>
        </div>
      </section>

      {/* ── API Key ─────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-base font-bold text-gray-900">{t.settings_api}</h2>
          <span className="h-px flex-1 bg-gray-100" />
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3.5">
          {apiConfigured === null ? (
            <span className="inline-flex items-center gap-2 text-sm text-gray-500">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" />
              OpenAI …
            </span>
          ) : apiConfigured ? (
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-base">✅</span>
              OpenAI — {t.settings_api_connected}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-amber-700">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-base">⚠️</span>
              OpenAI — {t.settings_api_not_configured}
            </span>
          )}
        </div>

        <p className="mt-4 text-sm leading-relaxed text-gray-500">
          {t.settings_api_note}
        </p>
        <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-white px-4 py-3">
          <code className="text-xs font-medium text-gray-600">OPENAI_API_KEY</code>
          <span className="mx-2 text-gray-300">→</span>
          <span className="text-xs text-gray-400">••••••••••••••••</span>
        </div>
      </section>
    </div>
  );
}
