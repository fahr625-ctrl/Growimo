// ── F10 Persönliche Lernschleife: Sprachbausteine (de/en) ────────────────────
// Reine Templates — keine LLM-Formulierung, keine erfundenen Zahlen.

export type LearnLang = 'de' | 'en';

export const TONE_LABEL: Record<string, Record<LearnLang, string>> = {
  emotional: { de: 'emotional (herzlich, bildhaft, gefühlvoll)', en: 'emotional (warm, vivid, heartfelt)' },
  friendly: { de: 'freundlich (persönlich, locker, direkt)', en: 'friendly (personal, casual, direct)' },
  professional: { de: 'professionell (kompetent, sachlich, strategisch)', en: 'professional (competent, factual, strategic)' },
};

export const FORMAT_LABEL: Record<string, Record<LearnLang, string>> = {
  concise: { de: 'kompakt (kurze Sätze, prägnant)', en: 'concise (short sentences, to the point)' },
  detailed: { de: 'detailliert (ausführlich, informativ)', en: 'detailed (thorough, informative)' },
};

export const CHANNEL_LABEL: Record<string, Record<LearnLang, string>> = {
  pinterest_pin: { de: 'Pinterest-Pins', en: 'Pinterest pins' },
  etsy_listing: { de: 'Etsy-Listings', en: 'Etsy listings' },
  seo_blog: { de: 'Blogartikel', en: 'Blog posts' },
  social_post: { de: 'Social-Posts', en: 'Social posts' },
  email_newsletter: { de: 'Newsletter', en: 'Newsletters' },
};
