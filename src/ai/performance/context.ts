// ── F9 Performance-Feedback-Loop: Kontext-Block für zukünftige Generierungen ─
// buildPerformanceContext() übersetzt die Analyse in einen zusätzlichen
// Kontext-Block, der in ALLE zukünftigen Generierungen einfließt (Paket +
// QuickGenerator) — nie blockierend, bei zu wenig Daten leer.
// Die Formulierung ist ein Template (kein LLM) — jede Zahl ist echt und kommt
// aus der deterministischen Analyse.

import type { PerformanceOverview, PerfSuggestion, SuccessFactor } from '../types';
import type { PerfLang } from './metrics';
import { CHANNEL_LABEL, fmtFactorList } from './wording';

const HEADER: Record<PerfLang, string> = {
  de: '📈 Was bei dir funktioniert (aus deinen Performance-Daten — bitte für diesen Inhalt übernehmen, was passt):',
  en: '📈 What works for you (from your performance data — please adopt what fits for this content):',
};
const SUGGESTION_HEADER: Record<PerfLang, string> = {
  de: '💡 Worauf du bei neuen Inhalten achten solltest:',
  en: '💡 What to focus on for new content:',
};
const CHANNEL_NAME: Record<string, Record<PerfLang, string>> = {
  pinterest_pin: { de: 'Pinterest-Pins', en: 'Pinterest pins' },
  etsy_listing: { de: 'Etsy-Listings', en: 'Etsy listings' },
  seo_blog: { de: 'Blogartikel', en: 'Blog posts' },
  social_post: { de: 'Social-Posts', en: 'Social posts' },
  email_newsletter: { de: 'Newsletter', en: 'Newsletters' },
};

/**
 * Baut den Performance-Kontext-Block. Leerer String, wenn die Datenlage nicht
 * ausreicht (dataSufficiency-Gate) — dann fließt nichts in die Generierung ein.
 */
export function buildPerformanceContext(
  overview: PerformanceOverview | null | undefined,
  lang: PerfLang = 'de',
): string {
  if (!overview || !overview.dataSufficiency?.enoughData) return '';
  const lines: string[] = [];
  const factors = overview.successFactors.filter((f) => f.direction === 'positive');
  const byChannel = new Map<string, SuccessFactor[]>();
  for (const f of factors) {
    const list = byChannel.get(f.channel) ?? [];
    list.push(f);
    byChannel.set(f.channel, list);
  }
  for (const [channel, list] of byChannel) {
    const chName = CHANNEL_NAME[channel]?.[lang] ?? channel;
    lines.push(`- ${chName}: ${fmtFactorList(list, lang)}`);
  }
  if (lines.length === 0) return ''; // Daten da, aber keine klaren Muster → ehrlich leer
  let out = `${HEADER[lang]}\n${lines.join('\n')}`;
  const suggestions = overview.suggestions.filter((s) => s.affectedAssets > 0);
  if (suggestions.length > 0) {
    const sugLines = dedupeSuggestions(suggestions).map((s) => {
      const chName = CHANNEL_NAME[s.channel]?.[lang] ?? s.channel;
      return `- ${chName}: ${s.action} — ${s.reason}.`;
    });
    if (sugLines.length > 0) out += `\n\n${SUGGESTION_HEADER[lang]}\n${sugLines.join('\n')}`;
  }
  return out;
}

function dedupeSuggestions(suggestions: PerfSuggestion[]): PerfSuggestion[] {
  const seen = new Set<string>();
  const out: PerfSuggestion[] = [];
  for (const s of suggestions) {
    const key = `${s.channel}:${s.factor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export { CHANNEL_LABEL };
