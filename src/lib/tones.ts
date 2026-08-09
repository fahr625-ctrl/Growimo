import type { Translations } from '~/i18n';

/**
 * Canonical tone values. These are persisted (localStorage key
 * `growimo_default_tone`) and sent to the AI providers, so the values
 * must stay stable — only the *labels* are localized via i18n keys.
 */
export const TONES = ['Professionell', 'Freundlich', 'Verspielt', 'Luxus', 'Lässig'] as const;

export type Tone = (typeof TONES)[number];

const TONE_KEYS: Record<string, keyof Translations> = {
  // Canonical values (new-project, settings, QuickGenerator)
  Professionell: 'tone_professional',
  Freundlich: 'tone_friendly',
  Verspielt: 'tone_playful',
  Luxus: 'tone_luxury',
  Lässig: 'tone_casual',
  // Brand-profile variants (brand.tsx stores lowercase values)
  professionell: 'tone_professional',
  freundlich: 'tone_friendly',
  verspielt: 'tone_playful',
  luxuriös: 'tone_luxury',
  lässig: 'tone_casual',
};

/** Localized display label for a tone value. */
export function toneLabel(t: Translations, tone: string): string {
  const key = TONE_KEYS[tone as Tone];
  return key ? t[key] : tone;
}
