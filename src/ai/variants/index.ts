// ── F7 A/B-Varianten mit Score-Vergleich (decision layer) ─────────────────────
// The user requests "A/B-Varianten" for a generated asset (title + body):
//  1. ONE GPT-4o call (json_object) returns 3 clearly different variants
//     {title, body} — different angles (emotional / nutzenorientiert /
//     faktisch), each internally consistent and in the SAME parser-compatible
//     structure as the original (same numbered section headings).
//  2. Every variant is scored through the EXISTING F1 pipeline
//     (scoreContent — no new scoring path), so each variant carries a
//     0–100 total + sub-scores.
//  3. Never blocks: any failure (API, JSON parse, scoring) returns null —
//     the original asset is untouched and the UI shows an error + retry.
//
// The user picks the best variant; the parent persists it exactly like
// F2/F2.1 (updateChannel) and keeps the variant's score on the asset.

import type {
  ContentResult,
  ContentScore,
  ContentType,
  VariantAsset,
  VariantsResult,
} from '../types';
import { scoreContent } from '../scoring';
import { parseResponse } from '../providers/openai';

const CHANNEL_LABELS: Record<string, string> = {
  pinterest_pin: 'Pinterest-Pin',
  etsy_listing: 'Etsy-Listing',
  seo_blog: 'SEO-Blogartikel',
  social_post: 'Social-Media-Beitrag',
  email_newsletter: 'E-Mail-Newsletter',
  marketing_plan: 'Marketing-Plan',
  product_idea: 'Produktidee',
};

function maxTokensFor(type: ContentType): number {
  // Three FULL variants must fit into one call.
  return type === 'seo_blog' || type === 'etsy_listing' ? 12000 : 6000;
}

/**
 * Defensive JSON-object extraction: strip markdown code fences and any
 * prose before/after, then try JSON.parse. On failure, attempt a lenient
 * repair (escape literal newlines/tabs inside string values) and retry.
 * Returns null when no valid JSON object can be recovered — the caller must
 * treat that as a failed variant generation (never throws).
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text || !text.trim()) return null;
  let candidate = text.trim();
  // Strip ```json ... ``` fences.
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();
  // Take the substring from the first '{' to the last '}'.
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  candidate = candidate.slice(first, last + 1);

  const tryParse = (raw: string): Record<string, unknown> | null => {
    try {
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct) return direct;

  // Lenient repair: inside string values, replace literal line breaks/tabs
  // with their escape sequences so the JSON becomes parseable.
  const repaired = repairJsonString(candidate);
  if (repaired !== candidate) {
    const retry = tryParse(repaired);
    if (retry) return retry;
  }
  return null;
}

/** Minimal state-machine repair: outside strings copy verbatim; inside a
 *  string, escape real \n, \r, \t and unescaped quotes. */
function repairJsonString(raw: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      // A real line break right after " never closes a string; a quote that
      // ends a string is followed by , } ] or whitespace. Heuristic: if we are
      // NOT in a string we open one; if we ARE in a string and the next
      // non-space char is a JSON delimiter, close it — otherwise escape it.
      if (!inString) {
        inString = true;
        out += ch;
      } else {
        let next = '';
        for (let j = i + 1; j < raw.length; j++) {
          if (raw[j] !== ' ' && raw[j] !== '\t') {
            next = raw[j];
            break;
          }
        }
        if (next === ',' || next === '}' || next === ']') {
          inString = false;
          out += ch;
        } else {
          out += '\\"';
        }
      }
      continue;
    }
    if (inString && (ch === '\n' || ch === '\r' || ch === '\t')) {
      out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\t';
      continue;
    }
    out += ch;
  }
  return out;
}

/** Collect variant entries from the parsed JSON in the most defensive way:
 *  preferred key "variants" (array of {title, body}); fallback: any array
 *  value; last resort: object entries whose value is {title, body}. */
function collectVariantEntries(
  obj: Record<string, unknown>,
): Array<{ title: string; body: string }> {
  const entries: Array<{ title: string; body: string }> = [];

  const push = (v: unknown): void => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const rec = v as Record<string, unknown>;
      const title = typeof rec.title === 'string' ? rec.title.trim() : '';
      const body = typeof rec.body === 'string' ? rec.body.trim() : '';
      if (title && body) entries.push({ title, body });
    }
  };

  // 1) Preferred: "variants" array.
  const variants = obj.variants;
  if (Array.isArray(variants)) {
    for (const v of variants) push(v);
    if (entries.length > 0) return entries;
  }
  // 2) Any array-valued key (variant_1/variants/ab etc.).
  for (const [, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      const before = entries.length;
      for (const item of v) push(item);
      if (entries.length > before) return entries;
    }
  }
  // 3) Flat object like { "1": {title, body}, "2": {…} } — numeric order.
  const flat = Object.entries(obj)
    .filter(([k]) => /^\d+$/.test(k.trim()))
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [, v] of flat) push(v);
  return entries;
}

function buildPrompt(opts: {
  channelLabel: string;
  productIdea: string;
  strategyContext: string;
  originalTitle: string;
  originalBody: string;
  lang: 'de' | 'en';
}): string {
  const { channelLabel, productIdea, strategyContext, originalTitle, originalBody, lang } = opts;

  const langRule =
    lang === 'en'
      ? 'Write in English, unless the original content is German — then keep the German text style.'
      : 'Schreibe auf Deutsch.';

  return `=== AUFGABE ===
Erstelle GENAU 3 alternative Varianten des folgenden ${channelLabel}. Jede Variante besteht aus:
- "title": der neue Titel (1 Zeile, max. 100 Zeichen, direkt zum Punkt)
- "body": der KOMPLETTE Inhalt der Variante — exakt dieselbe nummerierte Sektions-Struktur und dieselben Überschriften wie das Original, nur mit dem jeweiligen Angle umgeschrieben.

Die 3 Varianten müssen sich KLAR voneinander unterscheiden (verschiedene Angle):
- Variante A: emotional & atmosphärisch (Gefühle, Story, Bildsprache)
- Variante B: nutzenorientiert (konkrete Benefits, Ergebnisse, pragmatisch)
- Variante C: faktisch & klar (direkt, glaubwürdig, kompakt, wenig Beiwerk)
Jede Variante ist für sich vollständig und konsistent. Übernimm die Fakten des Originals (Produkt, Features, Zielgruppe) — erfinde nichts Neues und widersprich dem Original nicht.

=== STRATEGIE-KONTEXT (verbindlich einhalten — Produkt und Tonalität) ===
Produktidee: ${(productIdea || 'Nicht angegeben — arbeite nur mit dem vorhandenen Inhalt.').slice(0, 800)}
${(strategyContext || '').slice(0, 1200)}

=== ORIGINAL (Vorlage — Struktur, Überschriften und Sektions-Reihenfolge exakt übernehmen) ===
Titel: ${originalTitle.slice(0, 300)}
${originalBody.slice(0, 14000)}

=== AUSGABE-FORMAT (WICHTIG — exakt einhalten) ===
Antworte ausschließlich mit einem JSON-Objekt, das GENAU dieses Schema hat:
{
  "variants": [
    { "title": "…", "body": "…" },
    { "title": "…", "body": "…" },
    { "title": "…", "body": "…" }
  ]
}
Regeln:
1. GENAU 3 Einträge in "variants", jeder mit nicht-leerem "title" und "body".
2. Jede "body" enthält exakt dieselben nummerierten Überschriften in derselben Reihenfolge wie das Original — Parser-Kompatibilität ist Pflicht.
3. Zeilenumbrüche in "body" als \\n escaped. Keine Einleitung, kein Kommentar, kein Markdown-Rahmen — nur das JSON-Objekt.
${langRule}`;
}

export interface GenerateVariantsRequest {
  contentType: ContentType;
  productIdea?: string;
  strategyContext?: string;
}

/**
 * F7: ONE GPT-4o call (json_object) → 3 scored A/B variants of an asset.
 * - Every variant is scored via the existing F1 pipeline (scoreContent).
 * - Never throws: on any error (API / JSON parse / scoring) returns null.
 * - The original asset is never modified by this function.
 */
export async function generateVariants(
  request: GenerateVariantsRequest,
  original: ContentResult,
  lang: 'de' | 'en' = 'de',
): Promise<VariantsResult | null> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey });

    const channelLabel = CHANNEL_LABELS[request.contentType] ?? request.contentType;
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Du bist Growimos A/B-Varianten-Generator. Zu einem bereits generierten ${channelLabel} erstellst du GENAU 3 klar unterscheidbare Alternativ-Varianten (Titel + vollständiger Inhalt) und antwortest ausschließlich mit einem JSON-Objekt — keine Einleitung, kein Kommentar, kein Markdown.`,
        },
        {
          role: 'user',
          content: buildPrompt({
            channelLabel,
            productIdea: request.productIdea ?? '',
            strategyContext: request.strategyContext ?? '',
            originalTitle: original.title,
            originalBody: original.body,
            lang,
          }),
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8,
      max_tokens: maxTokensFor(request.contentType),
    });

    const text = response.choices[0]?.message?.content;
    if (!text || !text.trim()) throw new Error('empty variants response');

    const obj = extractJsonObject(text);
    if (!obj) throw new Error('variants response is not a JSON object');

    const raw = collectVariantEntries(obj);
    if (raw.length === 0) throw new Error('no variant entries in JSON response');
    // Cap at 3 (the contract) — never return more.
    const selected = raw.slice(0, 3);

    const variants: VariantAsset[] = [];
    for (const entry of selected) {
      // Parse with the SAME parser as generation (F2 contract): the parsed
      // title is the parser-compatible one (section 1 of the body).
      let title = entry.title;
      let metadata: Record<string, unknown> | undefined;
      try {
        const parsed = parseResponse(request.contentType, entry.body);
        if (parsed.title && parsed.title !== 'Pin-Titel' && parsed.title !== 'Etsy-Listing' && parsed.title !== 'Blog-Artikel') {
          title = parsed.title;
        }
        metadata = parsed.metadata;
      } catch {
        // keep the JSON title — the variant itself is still valid
      }

      const variantResult: ContentResult = {
        contentType: request.contentType,
        title,
        body: entry.body,
        metadata,
      };

      // F1 pipeline — reuse existing scoring, never a new path. scoreContent
      // itself never throws (degrades to rules-only), but guard anyway.
      let score: ContentScore | null = null;
      try {
        score = await scoreContent(
          { contentType: request.contentType, productIdea: request.productIdea ?? '' },
          variantResult,
        );
      } catch (err) {
        console.error('[variants] scoring failed for variant (kept as null):', err);
        score = null;
      }
      variants.push({ title, body: entry.body, score });
    }

    console.log(
      '[variants]',
      request.contentType,
      `${variants.length} Varianten`,
      'Scores:',
      variants.map((v) => v.score?.total ?? 'n/a').join(' / '),
    );

    return { variants, lang };
  } catch (err) {
    console.error('[variants] failed — original untouched:', err);
    return null;
  }
}
