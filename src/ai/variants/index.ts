// ── F7 A/B-Varianten mit Score-Vergleich (decision layer) ─────────────────────
// The user requests "A/B-Varianten" for a generated asset (title + body):
//  1. ONE GPT-4o call (json_object) returns 3 variants {angle, strategyNote,
//     title, body}. Each variant carries a REAL strategy assignment (see
//     ./angles.ts): A emotional/gift-led, B benefit-led, C fact/SEO-led —
//     different positioning, sub-audience and CTA mechanics on the SAME user
//     facts (never invented product facts).
//  2. Every variant is scored SEPARATELY through the EXISTING F1 pipeline
//     (scoreContent — no new scoring path, never the original's score) and then
//     checked deterministically against its own approach (applyAngleFit), so the
//     three scores differ by content and approach — even when the LLM judge is
//     unavailable (rules-only degradation).
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
import {
  VARIANT_ANGLES,
  applyAngleFit,
  angleForIndex,
  resolveAngleAssignments,
  type VariantAngleKey,
} from './angles';

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
 *  preferred key "variants" (array of {angle, strategyNote, title, body});
 *  fallback: any array value; last resort: object entries whose value is
 *  {title, body}. "angle"/"strategyNote" are optional — the caller assigns the
 *  approach positionally when the model omits them. */
function collectVariantEntries(
  obj: Record<string, unknown>,
): Array<{ title: string; body: string; angle?: string; strategyNote?: string }> {
  const entries: Array<{ title: string; body: string; angle?: string; strategyNote?: string }> = [];

  const push = (v: unknown): void => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const rec = v as Record<string, unknown>;
      const title = typeof rec.title === 'string' ? rec.title.trim() : '';
      const body = typeof rec.body === 'string' ? rec.body.trim() : '';
      if (title && body) {
        const angle = typeof rec.angle === 'string' ? rec.angle.trim() : undefined;
        const strategyNote = typeof rec.strategyNote === 'string' ? rec.strategyNote.trim().slice(0, 240) : undefined;
        entries.push({ title, body, angle, strategyNote });
      }
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

  // Owner 2026-10-03 (Schritt 1, Punkt 1a): drei ECHT verschiedene
  // Strategie-Aufträge statt kosmetischer Angle-Zeilen. Die Differenz liegt in
  // Strategie, Ansprache, Positionierung, CTA-Mechanik und Fokus — niemals in
  // erfundenen Produktfakten.
  const assignments = VARIANT_ANGLES.map(
    (a) => `Variante ${a.letter} (${a.key}):\n${a.instruction[lang === 'en' ? 'en' : 'de']}`,
  ).join('\n\n');

  const structureRule =
    lang === 'en'
      ? `STRUCTURE (this is where the three variants may and should differ):
- You may change the ORDER of the sections, the wording of headings, the narrative build-up and you may add approach-specific extra sections. Each variant must follow the beats of its own approach.
- BUT: keep every field heading that carries structured data (e.g. "SEO Pin-Titel", "Fokus-Keywords", "Hashtags", "Pinterest Alt-Text", "Pin-Beschreibung", "Call to Action", "KI-Bild-Prompt", "Pinterest-Bildprompt", "SEO-Titel", "13 Etsy-Tags", "URL-Slug", "FAQ" …). Growimo reads those values out of your text — without the headings the variant cannot be used. The image-prompt line must stay a single English sentence (it feeds the image studio).
- Same facts, different strategy: take product, features and audience ONLY from the product idea / original. Invent nothing and do not contradict the original.`
      : `STRUKTUR (hier dürfen und sollen sich die drei Varianten unterscheiden):
- Reihenfolge der Abschnitte, Formulierung der Überschriften, Story-Aufbau und ansatzspezifische Zusatz-Abschnitte darfst du frei setzen. Jede Variante folgt den Schritten ihres eigenen Auftrags.
- ABER: Behalte jede Feld-Überschrift bei, die strukturierte Angaben trägt (z. B. „SEO Pin-Titel", „Fokus-Keywords", „Hashtags", „Pinterest Alt-Text", „Pin-Beschreibung", „Call to Action", „KI-Bild-Prompt", „Pinterest-Bildprompt", „SEO-Titel", „13 Etsy-Tags", „URL-Slug", „FAQ" …). Growimo liest diese Werte aus deinem Text — ohne die Überschriften ist die Variante nicht verwendbar. Die Bildprompt-Zeile bleibt EIN englischer Satz (sie speist das Bild-Studio).
- Gleiche Fakten, andere Strategie: Produkt, Eigenschaften und Zielgruppe NUR aus der Produktidee/dem Original. Erfinde nichts und widersprich dem Original nicht.`;

  return `=== AUFGABE ===
Erstelle GENAU 3 alternative Varianten des folgenden ${channelLabel}. Jede Variante hat einen FEST ZUGEWIESENEN Strategie-Auftrag — sie ist kein Sprachstil, sondern ein anderer Marketing-Ansatz (Positionierung, Ansprache, CTA-Mechanik, Fokus). Jede Variante besteht aus:
- "angle": die Kennung des zugewiesenen Auftrags (exakt einer der drei unten genannten Werte)
- "strategyNote": EIN Satz, wie dieser Ansatz in der Variante umgesetzt wurde (max. 120 Zeichen)
- "title": der neue Titel (1 Zeile, max. 100 Zeichen, direkt zum Punkt)
- "body": der KOMPLETTE Inhalt der Variante

=== DIE DREI UNABHÄNGIGEN STRATEGIE-AUFTRÄGE (verbindlich, je Variante genau einer) ===
${assignments}

=== STRATEGIE-KONTEXT (verbindlich einhalten — Produkt und Tonalität) ===
Produktidee: ${(productIdea || 'Nicht angegeben — arbeite nur mit dem vorhandenen Inhalt.').slice(0, 800)}
${(strategyContext || '').slice(0, 1200)}

=== ${structureRule}

=== ORIGINAL (Faktenbasis und Vorlage — nicht 1:1 kopieren) ===
Titel: ${originalTitle.slice(0, 300)}
${originalBody.slice(0, 14000)}

=== AUSGABE-FORMAT (WICHTIG — exakt einhalten) ===
Antworte ausschließlich mit einem JSON-Objekt, das GENAU dieses Schema hat:
{
  "variants": [
    { "angle": "emotional_gift", "strategyNote": "…", "title": "…", "body": "…" },
    { "angle": "benefit_focus", "strategyNote": "…", "title": "…", "body": "…" },
    { "angle": "fact_seo", "strategyNote": "…", "title": "…", "body": "…" }
  ]
}
Regeln:
1. GENAU 3 Einträge in "variants", jeder mit nicht-leerem "title" und "body".
2. "angle" ist exakt einer der drei Werte (emotional_gift, benefit_focus, fact_seo) — jeder genau einmal, in der Reihenfolge A, B, C.
3. Die drei "body"-Texte müssen sich in Aufbau, Einstieg, Positionierung und Abschluss klar unterscheiden — nicht nur in einzelnen Wörtern.
4. Zeilenumbrüche in "body" als \\n escaped. Keine Einleitung, kein Kommentar, kein Markdown-Rahmen — nur das JSON-Objekt.
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
    // 1a: Ansatz je Variante festnageln (Angabe des Modells zuerst, sonst
    // Position A/B/C) — jeder Ansatz genau einmal.
    const angles = resolveAngleAssignments(selected.map((e) => e.angle));

    const variants: VariantAsset[] = [];
    for (let i = 0; i < selected.length; i++) {
      const entry = selected[i];
      const angle: VariantAngleKey = angles[i];
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

      // 1b: Jede Variante wird EINZELN neu bewertet (nie der Score des
      // Ausgangsergebnisses). Der zugewiesene Ansatz geht als additionalContext
      // in die Bewertung und wird danach deterministisch gegen den Inhalt
      // geprüft (applyAngleFit) — so bleiben die Varianten auch dann
      // unterscheidbar, wenn der LLM-Judge ausfällt (Regeln-only).
      let score: ContentScore | null = null;
      let fitScore: number | null = null;
      try {
        const angleInstruction = VARIANT_ANGLES.find((a) => a.key === angle);
        const scored = await scoreContent(
          {
            contentType: request.contentType,
            productIdea: request.productIdea ?? '',
            additionalContext: [
              `Zugewiesener Varianten-Ansatz: ${angleInstruction?.labelDe ?? angle}`,
              entry.strategyNote ?? '',
            ].filter(Boolean).join('\n'),
          },
          variantResult,
        );
        const fitted = applyAngleFit(scored, variantResult, angle);
        score = fitted.score;
        fitScore = fitted.fit.score;
      } catch (err) {
        console.error('[variants] scoring failed for variant (kept as null):', err);
        score = null;
      }
      variants.push({
        title,
        body: entry.body,
        score,
        angle,
        strategyNote: entry.strategyNote ?? undefined,
      });
      console.log(
        '[variants]',
        angleForIndex(i).letter,
        angle,
        'Ansatz-Treffer:',
        fitScore == null ? 'n/a' : `${fitScore}/100`,
        'Score:',
        score?.total ?? 'n/a',
      );
    }

    console.log(
      '[variants]',
      request.contentType,
      `${variants.length} Varianten`,
      'Angles:',
      variants.map((v) => v.angle ?? '?').join(' / '),
      'Scores:',
      variants.map((v) => v.score?.total ?? 'n/a').join(' / '),
    );

    return { variants, lang };
  } catch (err) {
    console.error('[variants] failed — original untouched:', err);
    return null;
  }
}
