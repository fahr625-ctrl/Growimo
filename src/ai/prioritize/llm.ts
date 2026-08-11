// ── F3 LLM phrasing pass ─────────────────────────────────────────────────────
// The ranking decision is made deterministically in rules.ts. This module ONLY
// rephrases the WHY into a short, concrete user text (one compact GPT-4o call).
// It never decides the order: the model receives the ordered list and is told
// explicitly not to change it. On any failure it returns null and the caller
// falls back to the template rationales — prioritization never blocks.

import type { PriorityItem } from '../types';
import type { Lang } from './rules';
import { channelLabel } from './rules';

export interface LlmPrioritizeTexts {
  summary: string;
  /** rationale per channel key. */
  rationales: Record<string, string>;
}

function langInstruction(lang: Lang): string {
  return lang === 'en'
    ? 'Write ALL text in English, in a natural, concrete, helpful tone.'
    : 'Schreibe ALLE Texte auf Deutsch, in einem natürlichen, konkreten, hilfreichen Ton.';
}

/**
 * Runs the LLM phrasing pass. Returns null when the model is not configured,
 * the call fails, or the response cannot be parsed — the caller must then use
 * the deterministic template texts.
 */
export async function phrasePriorities(
  ordered: PriorityItem[],
  productIdea: string,
  lang: Lang = 'de',
): Promise<LlmPrioritizeTexts | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  let OpenAI;
  try {
    OpenAI = (await import('openai')).default;
  } catch {
    return null;
  }

  const listLines = ordered
    .map(
      (item, i) =>
        `${i + 1}. ${channelLabel(item.channel, lang)} — Qualität ${item.qualityScore ?? 'n/a'}/100, Priorität ${item.priorityScore}/100`,
    )
    .join('\n');

  const prompt = `Du bist Growimos Veröffentlichungs-Berater. Die Entscheidung, WAS zuerst publiziert wird, ist bereits gefallen — deine einzige Aufgabe ist, die Begründung in kurzem, konkretem Klartext zu formulieren. Ändere die Reihenfolge NICHT und stelle sie nicht in Frage.

=== PRODUKTIDEE ===
${(productIdea || 'Nicht angegeben.').slice(0, 800)}

=== BEREITS GEFALLENE RANGFOLGE (nicht ändern) ===
${listLines}

Antworte AUSSCHLIESSLICH mit einem gültigen JSON-Objekt — keine Einleitung, kein Markdown, kein Text außerhalb des JSON:
{"summary":"Maximal zwei Sätze: die Gesamt-Reihenfolge auf den Punkt begründen (z. B. warum der erste Kanal zuerst und der letzte zuletzt kommt) — direkt und konkret, ohne Floskeln","rationales":{"${ordered[0]?.channel}":"1–2 Sätze: Warum genau dieser Kanal auf diesem Platz steht — konkret zum Produkt, ohne Allgemeinplätze"}}

${langInstruction(lang)}`;

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            lang === 'en'
              ? 'You are Growimo\'s publishing advisor. You only rephrase an already-made decision in plain language. Be concise and direct, address the user with "you". You answer exclusively with valid JSON.'
              : 'Du bist Growimos Veröffentlichungs-Berater. Du formulierst nur eine bereits getroffene Entscheidung in Klartext um. Sei knapp und direkt, duze den Nutzer. Du antwortest ausschließlich mit validem JSON.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 700,
      response_format: { type: 'json_object' },
    });

    const text = response.choices[0]?.message?.content;
    if (!text) return null;
    return parseTexts(text, ordered);
  } catch (err) {
    console.error('[prioritize] LLM phrasing failed (using templates):', err);
    return null;
  }
}

function parseTexts(text: string, ordered: PriorityItem[]): LlmPrioritizeTexts | null {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const braceStart = cleaned.indexOf('{');
  const braceEnd = cleaned.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    cleaned = cleaned.slice(braceStart, braceEnd + 1);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }

  const summary =
    typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim()
      : '';
  const rationalesRaw =
    typeof raw.rationales === 'object' && raw.rationales !== null
      ? (raw.rationales as Record<string, unknown>)
      : {};

  const rationales: Record<string, string> = {};
  for (const item of ordered) {
    const r = rationalesRaw[item.channel];
    rationales[item.channel] =
      typeof r === 'string' && r.trim() ? r.trim() : '';
  }

  const hasAny = ordered.some((item) => rationales[item.channel]);
  if (!summary && !hasAny) return null;

  return { summary, rationales };
}
