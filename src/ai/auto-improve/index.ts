// ── F2.1 Bereichsgenaue Auto-Verbesserung (Flaggschiff-Differenzierung) ───────
// One click on "✨ Automatisch verbessern" regenerates ONLY the affected
// field/section (e.g. Pinterest-Titel, Etsy-Beschreibung) and shows the
// before/after + score delta. This is the key difference to plain AI
// generators: Growimo not only recommends — it closes the loop in place.
//
// Flow (exactly ONE GPT-4o call + the existing F1 score pipeline):
//  1. The prompt carries (a) the strategy context (Produktidee + Brief/Kernel),
//     (b) the concrete quality rule from the score issue (field/action/
//     suggestion), (c) the current value of the affected field, and (d) the
//     strict instruction: ONLY this field may change, everything else verbatim.
//  2. The model returns the COMPLETE asset (same structure contract as
//     generation) and is parsed with the SAME parser as F2 (parseResponse).
//  3. ROBUSTNESS (hard guarantee): only the target field value is taken from
//     the model output and deterministically SPLICED back into the original —
//     if the model deviated anywhere else, that deviation is discarded. The
//     spliced asset is then re-scored via scoreContent() (F1 pipeline).
//  4. Never blocks: on any error the original is returned untouched with
//     improved:false (+ reason/error), exactly like F2.

import type {
  AutoImproveSectionOutcome,
  ContentResult,
  ContentScore,
  ContentType,
  ScoreIssueFix,
} from '../types';
import { scoreContent } from '../scoring';
import { parseResponse } from '../providers/openai';
import { blockByHeading, extractBlocks, replaceSectionContent } from '../scoring/sections';
import { isAutoImproveFieldSupported } from './support';

const CHANNEL_LABELS: Record<string, string> = {
  pinterest_pin: 'Pinterest-Pin',
  etsy_listing: 'Etsy-Listing',
  seo_blog: 'SEO-Blogartikel',
  social_post: 'Social-Media-Beitrag',
  email_newsletter: 'E-Mail-Newsletter',
  marketing_plan: 'Marketing-Plan',
  product_idea: 'Produktidee',
};

/**
 * Which body section holds a field, per contentType:field. Used for the
 * deterministic splice AND for reading the current value out of a parsed
 * result. 'title' is special-cased: it maps to result.title AND (when the body
 * contains a title section) to that section, so the asset stays consistent.
 */
const FIELD_SECTION_HEADINGS: Record<string, string[]> = {
  'pinterest_pin:title': ['SEO Pin-Titel', 'SEO Pin Title'],
  'etsy_listing:description': ['Vollständige Etsy-Beschreibung', 'Etsy-Beschreibung'],
};

function maxTokensFor(type: ContentType): number {
  return type === 'pinterest_pin' ? 4000
    : type === 'seo_blog' || type === 'etsy_listing' ? 8000
    : 4000;
}

function fieldLabel(field: string, lang: 'de' | 'en'): string {
  if (field === 'title') return lang === 'en' ? 'title' : 'Titel';
  if (field === 'description') return lang === 'en' ? 'description' : 'Beschreibung';
  return field;
}

/**
 * Read the current value of a field out of a ContentResult (used for the
 * before-value AND for extracting the model's new value from its parsed
 * output). Returns null when the field cannot be located.
 */
export function extractFieldValue(
  contentType: ContentType,
  field: string,
  result: ContentResult,
): string | null {
  if (field === 'title') {
    const t = (result.title ?? '').trim();
    return t.length > 0 ? t : null;
  }
  const headings = FIELD_SECTION_HEADINGS[`${contentType}:${field}`];
  if (headings) {
    const block = blockByHeading(extractBlocks(result.body), headings);
    const content = block?.content?.trim() ?? '';
    return content.length > 0 ? content : null;
  }
  return null;
}

/**
 * Deterministic splice: apply ONLY the new field value to the original asset.
 * Everything outside the target field stays byte-identical. Returns null when
 * the splice is impossible (field unsupported / section not found) — the caller
 * must then treat the attempt as failed and keep the original untouched.
 */
export function spliceFieldValue(
  contentType: ContentType,
  field: string,
  original: ContentResult,
  newValue: string,
): ContentResult | null {
  const value = (newValue ?? '').trim();
  if (!value) return null;

  const updated: ContentResult = { ...original, score: null };

  if (field === 'title') {
    updated.title = value;
    const headings = FIELD_SECTION_HEADINGS[`${contentType}:title`];
    if (headings) {
      const spliced = replaceSectionContent(original.body, headings, value);
      if (!spliced.found) return null;
      updated.body = spliced.body;
    }
    return updated;
  }

  const headings = FIELD_SECTION_HEADINGS[`${contentType}:${field}`];
  if (!headings) return null;
  const spliced = replaceSectionContent(original.body, headings, value);
  if (!spliced.found) return null;
  updated.body = spliced.body;
  return updated;
}

function buildPrompt(opts: {
  channelLabel: string;
  fieldLabel: string;
  productIdea: string;
  strategyContext: string;
  fix: ScoreIssueFix;
  currentValue: string;
  body: string;
  lang: 'de' | 'en';
}): string {
  const { channelLabel, fieldLabel, productIdea, strategyContext, fix, currentValue, body, lang } = opts;

  const langRule =
    lang === 'en'
      ? 'Write in English, unless the original content is German — then keep the German text style.'
      : 'Schreibe auf Deutsch.';

  return `=== AUFGABE ===
Verbessere GENAU EIN Feld des folgenden ${channelLabel}: den ${fieldLabel}. Gib den KOMPLETTEN überarbeiteten Inhalt zurück — aber ändere AUSSCHLIESSLICH den ${fieldLabel}. Alle anderen Sektionen und Felder übernimmst du WORTWÖRTLICH unverändert — kein Satz, kein Wort, kein Zeichen anders.

=== STRATEGIE-KONTEXT (verbindlich einhalten — Produkt und Tonalität) ===
Produktidee: ${(productIdea || 'Nicht angegeben — arbeite nur mit dem vorhandenen Inhalt.').slice(0, 800)}
${(strategyContext || '').slice(0, 1200)}

=== ZU BEHEBENDER PUNKT (nur dieser) ===
Feld: ${fix.field} | Aktion: ${fix.action}
${fix.suggestion}

=== AKTUELLER WERT DES ${fieldLabel.toUpperCase()} ===
${currentValue.slice(0, 3000)}

=== AKTUELLER GESAMT-INHALT (Kontext — nur der ${fieldLabel} darf sich ändern) ===
${body.slice(0, 14000)}

=== AUSGABE-FORMAT (WICHTIG — bitte exakt einhalten) ===
Gib den KOMPLETTEN überarbeiteten Inhalt zurück — exakt dieselbe Struktur, dieselben nummerierten Überschriften und dieselbe Sektions-Reihenfolge wie im Original. Zwei harte Regeln:
1. NUR der ${fieldLabel} ändert sich. Jede andere Sektion bleibt WORTWÖRTLICH identisch (inklusive Überschriften). Ändere daran nichts, nicht einmal kleine Formulierungen.
2. Die Fix-Anweisung enthält exakte Zielwerte (Zeichenzahlen, Mengen, Limits). Erreiche diese Zielwerte EXAKT — weder zu wenig noch zu viel (z. B. „maximal 100 Zeichen" bedeutet: 100 oder weniger; „mindestens 500 Zeichen" bedeutet: 500 oder mehr).
${langRule} Keine Einleitung, kein Kommentar, kein Markdown-Rahmen — nur der Inhalt selbst.`;
}

export interface AutoImproveSectionRequest {
  contentType: ContentType;
  productIdea?: string;
  strategyContext?: string;
}

/**
 * F2.1: regenerate exactly ONE field/section of an asset and re-score the
 * spliced result.
 * - unsupported field / missing score / failure → improved:false, original
 *   untouched (never throws).
 * - The model output is parsed with the generation parser; only the target
 *   field value is spliced into the original — all other deviations discarded.
 */
export async function autoImproveSection(
  request: AutoImproveSectionRequest,
  original: ContentResult,
  fix: ScoreIssueFix,
  score: ContentScore | null | undefined,
  lang: 'de' | 'en' = 'de',
): Promise<AutoImproveSectionOutcome> {
  const field = fix.field;
  const base: AutoImproveSectionOutcome = {
    field,
    oldValue: '',
    newValue: '',
    oldScore: score ?? null,
    newScore: score ?? null,
    improved: false,
  };

  // 1) Field supported for this content type?
  if (!isAutoImproveFieldSupported(request.contentType, field)) {
    return { ...base, reason: 'unsupported' };
  }

  // 2) Locate the current value of the field in the original asset.
  const oldValue = extractFieldValue(request.contentType, field, original);
  if (!oldValue) return { ...base, reason: 'not_found' };

  // 3) Old score — reuse the passed F1 score; compute via the F1 pipeline when
  //    missing (legacy assets without stored score).
  let oldScore = score ?? null;
  if (!oldScore) {
    try {
      oldScore = await scoreContent(
        { contentType: request.contentType, productIdea: request.productIdea ?? '' },
        original,
      );
    } catch (err) {
      console.error('[auto-improve] old-score computation failed:', err);
      oldScore = null;
    }
  }
  if (!oldScore) return { ...base, reason: 'no_score' };

  // 4) One GPT-4o call.
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey });

    const channelLabel = CHANNEL_LABELS[request.contentType] ?? request.contentType;
    const fLabel = fieldLabel(field, lang);

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Du bist Growimos Bereichs-Verbesserer. Deine einzige Aufgabe: einen bereits generierten ${channelLabel} punktgenau verbessern, indem du GENAU EIN Feld neu schreibst (${fLabel}) und ALLES andere exakt wie im Original übernimmst. Du antwortest ausschließlich mit dem kompletten überarbeiteten Inhalt — keine Einleitung, kein Kommentar.`,
        },
        {
          role: 'user',
          content: buildPrompt({
            channelLabel,
            fieldLabel: fLabel,
            productIdea: request.productIdea ?? '',
            strategyContext: request.strategyContext ?? '',
            fix,
            currentValue: oldValue,
            body: original.body,
            lang,
          }),
        },
      ],
      temperature: 0.3,
      max_tokens: maxTokensFor(request.contentType),
    });

    const text = response.choices[0]?.message?.content;
    if (!text || !text.trim()) throw new Error('empty auto-improve response');

    // 5) Parse with the SAME parser as generation (F2 contract).
    const parsed = parseResponse(request.contentType, text);

    // 6) Deterministic splice: ONLY the target field value from the model
    //    output is taken over — any other deviation is discarded.
    const newValue = extractFieldValue(request.contentType, field, parsed);
    if (!newValue) throw new Error('target field not found in model output');
    if (newValue === oldValue) {
      console.log('[auto-improve] unchanged:', request.contentType, field);
      return { ...base, oldScore, reason: 'unchanged', improved: false };
    }
    const spliced = spliceFieldValue(request.contentType, field, original, newValue);
    if (!spliced) throw new Error('deterministic splice failed');

    // 7) Re-score the spliced asset with the F1 pipeline.
    const newScore = await scoreContent(
      { contentType: request.contentType, productIdea: request.productIdea ?? '' },
      spliced,
    );
    spliced.score = newScore;

    console.log(
      '[auto-improve]',
      request.contentType,
      field,
      '→',
      oldScore.total,
      '->',
      newScore.total,
      `(${newScore.total - oldScore.total >= 0 ? '+' : ''}${newScore.total - oldScore.total})`,
    );

    return {
      field,
      oldValue,
      newValue,
      oldScore,
      newScore,
      improved: true,
      improvedContent: spliced,
    };
  } catch (err) {
    console.error('[auto-improve] failed — original untouched:', err);
    return { ...base, oldScore, reason: 'failed', error: true };
  }
}
