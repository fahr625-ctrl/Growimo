// ── F1 LLM judgment pass (Hook, Keyword-Relevanz, CTA, Ton) ───────────────────
// One structured GPT-4o call per generated asset. Returns 0–100 scores with a
// one-line German reason each. Strict JSON is requested via response_format;
// the parser is defensive (strips code fences, recovers broken JSON) so a bad
// response degrades to null instead of failing generation.

export interface LlmJudgment {
  hookScore: number;
  hookReason: string;
  keywordScore: number;
  keywordReason: string;
  ctaScore: number;
  ctaReason: string;
  toneScore: number;
  toneReason: string;
}

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
 * Runs the LLM judgment pass. Returns null when the model is not configured,
 * the call fails, or the response cannot be parsed — the caller must still
 * return a score based on the deterministic rules alone.
 */
export async function judgeContent(
  contentType: string,
  productIdea: string,
  body: string,
): Promise<LlmJudgment | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  let OpenAI;
  try {
    OpenAI = (await import('openai')).default;
  } catch {
    return null;
  }

  const channelLabel = CHANNEL_LABELS[contentType] ?? contentType;

  const prompt = `Du bist ein strenger, aber fairer Content-Qualitätsprüfer für einen ${channelLabel}. Du bewertest ehrlich: Ein Score von 80+ ist exzellent und selten — die meisten Erstentwürfe liegen zwischen 45 und 70. Analysiere NUR den gelieferten Content, erfinde keine Stärken.

Bewerte GENAU diese vier Dimensionen (jeweils 0–100):
1. hookScore — Wie stark ist der Hook/Einstieg (Titel und erste Zeilen)? Stoppt er einen Scroller oder wird er sofort übersprungen?
2. keywordScore — Sind die Keywords natürlich und relevant zur Produktidee eingebaut (kein Keyword-Stuffing)?
3. ctaScore — Wie klar, überzeugend und kanaltypisch ist der Call-to-Action?
4. toneScore — Passt Ton und Stimme zum Kanal und zur Zielgruppe? Ist der Text konsistent und muttersprachlich deutsch?

=== PRODUKTIDEE ===
${productIdea.slice(0, 800)}

=== CONTENT ===
${body.slice(0, 9000)}

Antworte AUSSCHLIESSLICH mit einem gültigen JSON-Objekt in exakt diesem Format — keine Einleitung, kein Markdown, kein Text außerhalb des JSON:
{"hookScore":72,"hookReason":"Ein-Satz-Begründung auf Deutsch","keywordScore":65,"keywordReason":"Ein-Satz-Begründung auf Deutsch","ctaScore":48,"ctaReason":"Ein-Satz-Begründung auf Deutsch","toneScore":70,"toneReason":"Ein-Satz-Begründung auf Deutsch"}`;

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Du bist ein strenger Content-Qualitätsprüfer. Du antwortest ausschließlich mit validem JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });

    const text = response.choices[0]?.message?.content;
    if (!text) return null;
    return parseJudgment(text);
  } catch (err) {
    console.error('[scoring] LLM judgment failed:', err);
    return null;
  }
}

function parseJudgment(text: string): LlmJudgment | null {
  let cleaned = text.trim();
  // strip markdown fences if the model wrapped the JSON anyway
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  // extract the first {...} block as a fallback
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

  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return 50;
    return Math.max(0, Math.min(100, Math.round(n)));
  };
  const str = (v: unknown): string => (typeof v === 'string' && v.trim() ? v.trim() : '');

  return {
    hookScore: num(raw.hookScore),
    hookReason: str(raw.hookReason) || 'Keine Begründung angegeben.',
    keywordScore: num(raw.keywordScore),
    keywordReason: str(raw.keywordReason) || 'Keine Begründung angegeben.',
    ctaScore: num(raw.ctaScore),
    ctaReason: str(raw.ctaReason) || 'Keine Begründung angegeben.',
    toneScore: num(raw.toneScore),
    toneReason: str(raw.toneReason) || 'Keine Begründung angegeben.',
  };
}
