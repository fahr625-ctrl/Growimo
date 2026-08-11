// ── F4 Komplettes Marketing-Paket: Strategie-Kern ─────────────────────────────
// determineKernel() is the FIRST step of the package flow: ONE compact GPT-4o
// call derives the shared strategic core that ALL five channels then build on:
//   { keywords[2-4], mainHook, cta, voice, audienceNote }
// The kernel is what makes a package consistent — instead of five independent
// single-channel generations, every channel receives the same keywords, hook,
// CTA and tone (prepended as "Gemeinsamer Strategie-Kern" context).
//
// Resilience: the call never blocks the package. On any failure (network,
// malformed JSON, empty answer) a deterministic fallback kernel is derived from
// the product idea itself. Cost: exactly one LLM call.

import OpenAI from 'openai';

export interface MarketingKernel {
  /** 2–4 keywords with search-volume potential, shared across all channels. */
  keywords: string[];
  /** One-sentence main message / hook. */
  mainHook: string;
  /** One clear call-to-action. */
  cta: string;
  /** Tone / voice description, e.g. "warm, persönlich, ermutigend". */
  voice: string;
  /** One-sentence audience note (who, what moves them). */
  audienceNote: string;
}

const KERNEL_SYSTEM_PROMPT = `Du bist der Strategie-Kern einer Marketing-Engine. Du bestimmst aus einer Produktidee EINEN gemeinsamen Strategie-Kern, den ALLE Marketing-Kanäle (Pinterest, Etsy, SEO-Blog, Social Media, Newsletter) verbindlich gemeinsam nutzen: dieselben Keywords, dieselbe Hauptbotschaft, derselbe Call-to-Action, dieselbe Stimme. So entsteht ein konsistentes Marketing-Paket statt fünf unabhängiger Einzelstücke.

Antworte AUSSCHLIESSLICH mit validem JSON — kein anderer Text, keine Markdown-Fences. Exakt dieses Schema:
{
  "keywords": ["keyword 1", "keyword 2", "keyword 3"],
  "mainHook": "Ein-Satz-Hauptbotschaft, die emotional trifft",
  "cta": "Ein klarer Call-to-Action, maximal 10 Wörter",
  "voice": "Ton/Stimme in 2-4 Wörtern, z.B. warm, persönlich, ermutigend",
  "audienceNote": "Ein Satz: Wer ist die Zielgruppe und was bewegt sie?"
}

Regeln:
- keywords: genau 3 (nie weniger als 2, nie mehr als 4), deutsch, kurz (1-4 Wörter), mit echtem Suchvolumen-Potenzial, so formuliert wie Nutzer wirklich suchen.
- mainHook: deutsch, ein Satz, kein Marketing-Blabla, keine Versprechen ohne Substanz.
- cta: deutsch, konkret und handlungsorientiert, kein "Jetzt kaufen"-Standard.
- voice: an die Produktidee und Zielgruppe angepasst.
- audienceNote: konkret und psychografisch, keine demografischen Klischees.`;

const KERNEL_USER_TEMPLATE = `Produktidee:
${'%IDEA%'}

Bestimme daraus den gemeinsamen Strategie-Kern. Antworte nur mit JSON.`;

const BRIEF_SECTION = `
Strategie-Brief-Antworten (optional, wenn vorhanden — nutze sie, sonst ignoriere sie):
${'%BRIEF%'}`;

/** Deterministic fallback when the LLM kernel call fails — never blocks. */
export function fallbackKernel(productIdea: string): MarketingKernel {
  const idea = productIdea.trim() || 'Produkt';
  const name = idea
    .split('\n')[0]
    .split(',')[0]
    .replace(/^[^a-zA-ZäöüÄÖÜß0-9]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  const base = name || 'Produkt';
  const keywords = [
    base,
    `${base} kaufen`,
    `${base} geschenk`,
  ].filter((k, i, arr) => k && arr.indexOf(k) === i).slice(0, 4);
  return {
    keywords,
    mainHook: `${base} — für alle, die etwas wirklich Besonderes suchen.`,
    cta: 'Jetzt entdecken und dein Exemplar sichern.',
    voice: 'warm, persönlich, begeistert',
    audienceNote: `Menschen, die ${base.toLowerCase()} lieben und Wert auf Qualität, Gefühl und ein besonderes Erlebnis legen.`,
  };
}

/** Detect the deterministic fallback kernel (used for reporting only). */
export function isFallbackKernel(kernel: MarketingKernel): boolean {
  return (
    kernel.voice === 'warm, persönlich, begeistert' &&
    kernel.mainHook.includes('etwas wirklich Besonderes') &&
    kernel.cta === 'Jetzt entdecken und dein Exemplar sichern.'
  );
}

/** Extract the JSON object from a possibly noisy LLM answer. */
export function parseKernelJson(text: string): MarketingKernel | null {
  if (!text) return null;
  let candidate = text.trim();
  // Strip markdown fences
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();
  // Fall back to first { … last }
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  candidate = candidate.slice(first, last + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;

  const keywords = Array.isArray(p.keywords)
    ? (p.keywords as unknown[])
        .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
        .map((k) => k.trim())
        .slice(0, 4)
    : [];
  const mainHook = typeof p.mainHook === 'string' ? p.mainHook.trim() : '';
  const cta = typeof p.cta === 'string' ? p.cta.trim() : '';
  const voice = typeof p.voice === 'string' ? p.voice.trim() : '';
  const audienceNote = typeof p.audienceNote === 'string' ? p.audienceNote.trim() : '';

  if (keywords.length < 2 || !mainHook || !cta || !voice || !audienceNote) return null;
  return { keywords, mainHook, cta, voice, audienceNote };
}

/**
 * Determine the shared strategic kernel for a product idea.
 * Never throws: any failure degrades to the deterministic fallback kernel.
 * `brief` is an optional map of Strategy-Brief (F6) answers — empty when F6
 * has not been implemented yet; the flow works with or without it.
 */
export async function determineKernel(
  productIdea: string,
  brief?: Record<string, string> | null,
): Promise<MarketingKernel> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[package.kernel] no OPENAI_API_KEY — using fallback kernel');
    return fallbackKernel(productIdea);
  }

  let userPrompt = KERNEL_USER_TEMPLATE.replace('%IDEA%', productIdea);
  const briefText = brief && Object.keys(brief).length > 0
    ? Object.entries(brief).map(([k, v]) => `- ${k}: ${v}`).join('\n')
    : '';
  if (briefText) userPrompt += BRIEF_SECTION.replace('%BRIEF%', briefText);

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: KERNEL_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.6,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });
    const text = response.choices[0]?.message?.content;
    if (!text) throw new Error('empty kernel response');
    const kernel = parseKernelJson(text);
    if (!kernel) throw new Error('kernel JSON did not validate');
    console.log('[package.kernel] OK:', kernel.keywords.join(', '), '|', kernel.voice);
    return kernel;
  } catch (err) {
    console.error('[package.kernel] LLM call failed — using fallback kernel:', err);
    return fallbackKernel(productIdea);
  }
}
