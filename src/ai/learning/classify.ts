// ── F10 Persönliche Lernschleife: deterministische Asset-Klassifikation ──────
// classifyAsset() erkennt aus Titel + Body REGEL-basiert (kein LLM, null
// Kosten), in welche Präferenz-Dimensionen ein Asset fällt:
//   - Ton: emotional | freundlich | professionell (dominante Dimension,
//     nur wenn eindeutig — Gleichstand → null, kein erfundener Ton)
//   - Format: kompakt (< 800 Zeichen Body) | detailliert (>= 1500 Zeichen)
//   - Kanal-Affinität: der Kanal des Assets selbst
// Die Klassifikation wird beim Feedback-ZEITPUNKT gespeichert, damit ein
// späterer Toggle (Like→Dislike) dasselbe Asset nicht neu klassifiziert.

import type { PreferenceFormat, PreferenceTone } from '../types';

export interface AssetClassification {
  /** Dominante Ton-Dimension oder null bei Gleichstand/keinem Treffer. */
  tone: PreferenceTone | null;
  /** Format-Länge oder null bei neutraler Länge. */
  format: PreferenceFormat | null;
  /** Kanal des Assets (ContentType-String). */
  channel: string;
}

const TONE_KEYWORDS: Record<PreferenceTone, { de: string[]; en: string[] }> = {
  emotional: {
    de: ['herz', 'lieb', 'gefüh', 'warm', 'magisch', 'zauber', 'träum', 'gemütlich', 'glück', 'freude', 'weihnacht', 'nostalg', 'besonder', 'kostbar', 'dankbar', 'momente', 'erinnerung', 'kuschelig', 'leidenschaft'],
    en: ['heart', 'love', 'feel', 'warm', 'magic', 'dream', 'cozy', 'happy', 'joy', 'christmas', 'nostalgi', 'special', 'precious', 'thankful', 'moment', 'memory', 'cuddly', 'passion'],
  },
  friendly: {
    de: ['du ', 'dir ', 'dein', 'persönlich', 'gemeinsam', 'zusammen', 'spaß', 'spass', 'probier', 'einfach', 'willkommen', 'hilf', 'freundlich', 'locker'],
    en: ['you', 'your', 'personal', 'together', 'fun', 'try it', 'simple', 'quick', 'welcome', 'help', 'friendly', 'casual'],
  },
  professional: {
    de: ['strategie', 'analyse', 'professionell', 'roi', 'effizienz', 'optimier', 'zielgruppe', 'marke', 'wachstum', 'konvertier', 'kpi', 'framework', 'method', 'system', 'messbar', 'skalier'],
    en: ['strategy', 'analysis', 'professional', 'roi', 'efficiency', 'optimize', 'target audience', 'brand', 'growth', 'convert', 'kpi', 'framework', 'method', 'system', 'measurable', 'scale'],
  },
};

/** Kompakte Bodys (< 800 Zeichen) → "concise", lange (>= 1500) → "detailed". */
const CONCISE_BODY_LIMIT = 800;
const DETAILED_BODY_LIMIT = 1500;
const CONCISE_TITLE_LIMIT = 40;
const DETAILED_TITLE_LIMIT = 70;

export function classifyAsset(opts: {
  title?: string;
  body?: string;
  channel: string;
}): AssetClassification {
  const title = opts.title ?? '';
  const body = opts.body ?? '';
  const text = `${title} ${body}`.toLowerCase();

  // ── Ton: Treffer pro Dimension zählen, nur eindeutiges Maximum gewinnt ────
  const hits: Record<PreferenceTone, number> = {
    emotional: 0,
    friendly: 0,
    professional: 0,
  };
  for (const tone of Object.keys(TONE_KEYWORDS) as PreferenceTone[]) {
    const words = [...TONE_KEYWORDS[tone].de, ...TONE_KEYWORDS[tone].en];
    for (const w of words) {
      if (text.includes(w)) hits[tone]++;
    }
  }
  let tone: PreferenceTone | null = null;
  let best = 0;
  for (const t of Object.keys(hits) as PreferenceTone[]) {
    if (hits[t] > best) {
      best = hits[t];
      tone = t;
    } else if (hits[t] === best && best > 0) {
      tone = null; // Gleichstand → kein eindeutiges Signal
    }
  }
  if (best === 0) tone = null;

  // ── Format: Länge von Body (primär) bzw. Titel (Fallback) ──────────────────
  let format: PreferenceFormat | null = null;
  if (body.trim().length > 0) {
    if (body.length < CONCISE_BODY_LIMIT) format = 'concise';
    else if (body.length >= DETAILED_BODY_LIMIT) format = 'detailed';
  } else if (title.length > 0) {
    if (title.length <= CONCISE_TITLE_LIMIT) format = 'concise';
    else if (title.length > DETAILED_TITLE_LIMIT) format = 'detailed';
  }

  return { tone, format, channel: opts.channel };
}
