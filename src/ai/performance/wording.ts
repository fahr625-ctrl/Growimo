// ── F9 Performance-Feedback-Loop: geteilte Formulierungs-Helfer ─────────────
// Gemeinsame Kanal-Labels und Formatierung der Erfolgsfaktoren für die
// Klartext-Evidence (insights.ts) und den Generierungs-Kontext (context.ts) —
// eine Quelle, kein Doppel-Pflegen.

import type { SuccessFactor } from '../types';
import type { PerfLang } from './metrics';

export const CHANNEL_LABEL: Record<string, Record<PerfLang, string>> = {
  pinterest_pin: { de: 'Pins', en: 'Pins' },
  etsy_listing: { de: 'Etsy-Listings', en: 'Etsy listings' },
  seo_blog: { de: 'Blogartikel', en: 'Blog posts' },
  social_post: { de: 'Social-Posts', en: 'Social posts' },
  email_newsletter: { de: 'Newsletter', en: 'Newsletters' },
};

/** „2.1×" — de mit Komma, en mit Punkt. */
export function fmtMag(mag: number, lang: PerfLang): string {
  const s = mag >= 10 ? Math.round(mag).toString() : mag.toFixed(1);
  return lang === 'de' ? s.replace('.', ',') : s;
}

/** Alle Faktoren eines Kanals kompakt, z. B. „Pins mit Zahl erzielten 2,1× mehr Saves; …“. */
export function fmtFactorList(factors: SuccessFactor[], lang: PerfLang): string {
  return factors.map((f) => f.evidence).join('; ');
}
