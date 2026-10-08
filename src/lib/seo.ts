// ─────────────────────────────────────────────────────────────────────────────
// SEO-Grundlagen (FIX-BLOCK 3, 2026-10-08)
// ─────────────────────────────────────────────────────────────────────────────
// Zentrale Stelle für alles, was mit Indexierbarkeit zu tun hat:
//   * absolute URLs (Canonical, og:image, twitter:image, Sitemap)
//   * Seitentitel je Route über die bestehenden i18n-Dictionaries (de/en)
//   * robots-Direktiven (noindex für den eingeloggten Arbeitsbereich)
//
// Die Dictionaries werden direkt importiert (nicht über den I18nProvider), weil
// `head()` von TanStack Router außerhalb des React-Baums läuft und beim
// Server-Rendering ausgeführt wird. Dort gibt es kein localStorage → Deutsch ist
// der im HTML ausgelieferte Default (konsistent mit <html lang="de">); nach
// einem Sprachwechsel im Browser folgt der Titel der gewählten Sprache.
import { de } from '~/i18n/de';
import { en } from '~/i18n/en';

/** Produktions-Origin (www ist die kanonische Hostform von growimo.app). */
export const SITE_ORIGIN = 'https://www.growimo.app';
/** Kanonische Startseiten-URL inkl. abschließendem Slash. */
export const SITE_HOME_URL = `${SITE_ORIGIN}/`;
/** Absolutes Social-Preview-Bild — liegt als statische Datei in /public. */
export const OG_IMAGE_URL = `${SITE_ORIGIN}/logo.png`;
/** Social-Preview-Breite/Höhe von logo.png — wird nicht geraten, siehe SEO-Doku. */
export const ROBOTS_PRIVATE = 'noindex,follow';
export const ROBOTS_PUBLIC = 'index,follow';
export const LANGUAGE_STORAGE_KEY = 'growimo_language';

/** Macht einen Pfad zu einer absoluten kanonischen URL. */
export function canonicalUrl(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`canonicalUrl braucht einen absoluten Pfad, bekam: ${path}`);
  }
  return path === '/' ? SITE_HOME_URL : `${SITE_ORIGIN}${path}`;
}

/** Aktive Sprache zur Head-Bauzeit (SSR = 'de', Client = gespeicherte Wahl). */
export function currentSeoLocale(): 'de' | 'en' {
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === 'en' || stored === 'de') return stored;
    } catch {
      // localStorage kann (Privacy-Modus) blockiert sein → Default Deutsch
    }
  }
  return 'de';
}

/** Übersetzter Text zu einem i18n-Schlüssel (Fallback: de, dann leer). */
export function seoText(key: keyof typeof de): string {
  const dict: Record<string, unknown> =
    currentSeoLocale() === 'en' ? (en as unknown as Record<string, unknown>) : (de as unknown as Record<string, unknown>);
  const value = dict[key] ?? (de as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : String(value ?? '');
}

export type SeoMeta = { title?: string; name?: string; property?: string; content?: string };
export type SeoLink = { rel: string; href: string };

/**
 * Titel-Head für eine Route. `robots` optional — der /app-Bereich setzt
 * noindex bereits im Layout; öffentliche Ausnahmen überschreiben ihn explizit.
 */
export function seoHead(opts: {
  titleKey?: keyof typeof de;
  robots?: string;
  canonical?: string;
}): { meta: SeoMeta[]; links: SeoLink[] } {
  const meta: SeoMeta[] = [];
  if (opts.titleKey) meta.push({ title: seoText(opts.titleKey) });
  if (opts.robots) meta.push({ name: 'robots', content: opts.robots });
  const links: SeoLink[] = opts.canonical
    ? [{ rel: 'canonical', href: canonicalUrl(opts.canonical) }]
    : [];
  return { meta, links };
}
