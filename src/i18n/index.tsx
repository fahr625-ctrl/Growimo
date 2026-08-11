import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { de } from './de';
import { en } from './en';

export type Locale = 'de' | 'en';
export type Translations = typeof de;

const translations: Record<Locale, Translations> = { de, en };

const STORAGE_KEY = 'growimo_language';

function getInitialLocale(): Locale {
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'de' || stored === 'en') return stored;
    } catch {
      // localStorage may not be available
    }
  }
  return 'de';
}

const I18nContext = createContext<{
  locale: Locale;
  t: Translations;
  setLocale: (l: Locale) => void;
}>({ locale: 'de', t: de, setLocale: () => {} });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Always start with 'de' during SSR and initial client render to avoid
  // hydration mismatches (localStorage is unavailable server-side).
  const [locale, setLocaleState] = useState<Locale>('de');
  const [hydrated, setHydrated] = useState(false);

  // After hydration, sync with localStorage if a preference was saved
  useEffect(() => {
    setHydrated(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'de' || stored === 'en') {
        setLocaleState(stored);
      }
    } catch {}
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // localStorage may not be available
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = l;
    }
  }, []);

  // Sync lang attribute on mount and locale change
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, t: translations[locale], setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}
