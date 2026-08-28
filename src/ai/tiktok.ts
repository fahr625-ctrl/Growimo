// ── TikTok-Bereich: eigenständige, additiv ergänzte Entscheidungs-Engine ────
// Growimo liefert KEINEN leeren Chat — hier werden konkrete TikTok-Entscheidungen
// erzeugt. Drei Modi (je eine GPT-4o-Frage, json_object-Antwort, strukturell
// validiert und für das UI in Felder zerlegt):
//   todayIdea : Growimo entwickelt SELBST eine passende Videoidee (Unternehmen +
//               Ziel reichen — der Nutzer nennt KEINE Videoart).
//   concept   : Nutzer gibt zusätzlich ein Thema/Produkt/grobe Idee vor.
//   diagnose  : Nutzer gibt echte Metriken an → Analyse + neuer Hook +
//               optimierte Version + nächster Test.
//
// Implementierungs-Entscheidung (dokumentiert, pragmatisch): Die Ergebnisse
// werden NUR im UI dargestellt und NICHT in generated_content persistiert.
// Eine Persistenz würde eine DB-Migration erfordern (content_type-Check-
// Constraint erlaubt derzeit kein 'tiktok_idea'); der Owner will primär die
// Erweiterung. Kein bestehendes Feature/Typ wird dadurch verändert.
import OpenAI from 'openai';

export type TikTokMode = 'todayIdea' | 'concept' | 'diagnose';
export type TikTokLang = 'de' | 'en';

export interface TikTokMetrics {
  views: number;
  length: string; // z.B. "31s"
  avgWatch: number; // Sekunden durchschnittliche Wiedergabedauer
  likes: number;
  comments: number;
  shares: number;
  profileVisits: number;
}

export interface TikTokInput {
  mode: TikTokMode;
  biz: string; // kurze Unternehmens-/Produktbeschreibung (Pflicht)
  goal?: string; // Reichweite | Follower | Verkäufe | Community
  audience?: string; // optionale Zielgruppe
  topic?: string; // nur concept
  metrics?: TikTokMetrics; // nur diagnose
}

/** Ergebnis für todayIdea + concept (strukturiert, kein Roh-Chat). */
export interface TikTokIdeaResult {
  mode: 'todayIdea' | 'concept';
  idea: string; // konkrete Videoidee
  hook: string; // starker Hook (erste 1–2 Sekunden) + Texteinblendung
  length: string; // empfohlene Videolänge
  scenes: string[]; // Szenenablauf (Schritte)
  overlays: string[]; // Texteinblendungen
  spokenText: string; // optionaler Sprechtext
  caption: string;
  hashtags: string[]; // passende Hashtags
  cta: string;
  why: string; // kurze Erklärung, warum die Idee funktionieren könnte
}

/** Ergebnis für diagnose. */
export interface TikTokDiagnoseResult {
  mode: 'diagnose';
  biggestProblem: string; // wahrscheinlich größtes Problem
  whatWorks: string[]; // was bereits funktioniert
  whatToImprove: string[]; // was verbessert werden sollte
  newHook: string; // neuer Hook
  optimized: string; // konkrete optimierte Video-Version
  nextTest: string; // Empfehlung für den nächsten Test
}

export type TikTokResult = TikTokIdeaResult | TikTokDiagnoseResult;

// ── Prompts (de/en) ──────────────────────────────────────────────────────────
// Bewusst detailliert: Die Qualität der drei Modi hängt an klaren Feld- und
// Inhaltsvorgaben. Heute-Idee: Growimo wählt die Videoart SELBST (kein Rückfragen).
const IDEA_COMMON_EN = `You are Growimo's TikTok strategist — a veteran who knows exactly which short-form videos hook viewers in the first second and get pushed by the algorithm. Growimo DECIDES: do not ask the user what they want to make. Always deliver ONE concrete, complete, ready-to-record TikTok concept.

Rules:
- Answer ONLY with valid JSON, no other text, no markdown fences.
- Output must be in English.
- Be concrete, specific and practical. Never generic ("make a fun video" is forbidden).
- Tie everything to the business/goal/audience provided. Never invent product specs that were not given.
- The hook MUST be a specific spoken + on-screen line for the first 1-2 seconds that stops the scroll.
- Scenes: 3–6 concrete steps (what is shown/said at each moment).
- Text overlays: 2–5 short on-screen text lines in natural wording.
- Caption: ready to paste; Hashtags: 6–10 relevant ones WITH #.
- CTA: one clear, realistic call-to-action.
- whyWorks: one short paragraph explaining why this idea can perform for THIS goal.

JSON schema exactly:
{
  "idea": "one-sentence concrete video idea / concept",
  "hook": "exact first 1-2 second hook line (spoken + written)", 
  "length": "recommended length, e.g. '45 Sekunden / 45 seconds'",
  "scenes": ["step 1...", "step 2...", "step 3..."],
  "overlays": ["on-screen text 1", "on-screen text 2"],
  "spokenText": "optional spoken script (or empty string)",
  "caption": "ready-to-paste caption",
  "hashtags": ["#tag1", "#tag2"],
  "cta": "one clear call-to-action",
  "why": "why this idea can work for this goal"
}`;

const IDEA_COMMON_DE = `Du bist Growimos TikTok-Strateg: ein Veteran, der genau weiß, welche Kurzvideos in der ersten Sekunde haken und vom Algorithmus gepusht werden. Growimo ENTSCHEIDET: Frage den Nutzer NICHT, was er machen will. Liefere immer EIN konkretes, komplettes, aufnahmefähiges TikTok-Konzept.

Regeln:
- Antworte AUSSCHLIESSLICH mit validem JSON, kein anderer Text, keine Markdown-Fences.
- Ausgabe vollständig auf Deutsch.
- Sei konkret, spezifisch und praktisch. Niemals generisch („Mach ein lustiges Video" ist verboten).
- Alles auf Unternehmen/Ziel/Zielgruppe abstimmen. Erfinde keine Produktdetails, die nicht genannt wurden.
- Der Hook MUSS eine konkrete gesprochene + eingeblendete Zeile für die ersten 1–2 Sekunden sein, die den Scroll stoppt.
- Szenen: 3–6 konkrete Schritte (was in jedem Moment gezeigt/gesagt wird).
- Texteinblendungen: 2–5 kurze Bildschirmtextzeilen in natürlicher Formulierung.
- Caption: kopierfertig; Hashtags: 6–10 relevante MIT #.
- CTA: ein klarer, realistischer Call-to-Action.
- why: ein kurzer Absatz, warum diese Idee für DIESES Ziel funktionieren kann.

JSON-Schema exakt:
{
  "idea": "ein Satz: konkrete Videoidee/Konzept",
  "hook": "exakte Hook-Zeile für die ersten 1-2 Sekunden (gesprochen + eingeblendet)",
  "length": "empfohlene Länge, z.B. '45 Sekunden'",
  "scenes": ["Schritt 1...", "Schritt 2...", "Schritt 3..."],
  "overlays": ["Texteinblendung 1", "Texteinblendung 2"],
  "spokenText": "optionaler Sprechtext (auch leere Zeichenkette möglich)",
  "caption": "kopierfertige Caption",
  "hashtags": ["#Tag1", "#Tag2"],
  "cta": "ein klarer Call-to-Action",
  "why": "warum diese Idee für dieses Ziel funktionieren kann"
}`;

const TODAY_IDEA_EN = `${IDEA_COMMON_EN}

The user gave only their business + goal (+optional audience) and did NOT tell you which video format they want. YOU must choose the most promising video angle yourself (e.g. a before/after, a quick tutorial, a behind-the-scenes, a myth-bust, a product-in-action, a personal story, a transformation, a trend-remix that fits). Pick ONE that best serves the stated goal.`;
const TODAY_IDEA_DE = `${IDEA_COMMON_DE}

Der Nutzer hat nur Unternehmen + Ziel (+ optional Zielgruppe) angegeben und NICHT gesagt, welche Videoart er möchte. DU wählst selbst den vielversprechendsten Video-Winkel (z. B. Vorher/Nachher, schnelles Tutorial, Behind-the-Scenes, Mythos-entkräftung, Produkt in Aktion, persönliche Geschichte, Transformation, passender Trend-Remix). Wähle EINEN, der dem genannten Ziel am besten dient.`;

const CONCEPT_EN = `${IDEA_COMMON_EN}

The user additionally provided a topic/product/rough idea. Build the complete TikTok concept around THAT specifically (treat it as the subject) while still choosing the best angle and format yourself.`;
const CONCEPT_DE = `${IDEA_COMMON_DE}

Der Nutzer hat zusätzlich ein Thema/Produkt/grobe Idee vorgegeben. Baue das komplette TikTok-Konzept gezielt darum (als Gegenstand) — wähle dabei weiterhin selbst den besten Winkel und das Format.`;

const DIAGNOSE_EN = `You are Growimo's TikTok diagnostician. The user provides real performance numbers for one of their TikToks. You must analyze them honestly and give concrete, prioritized next steps — NEVER a generic pep talk, NEVER "keep going" without evidence.

Rules:
- Answer ONLY with valid JSON, no other text, no markdown fences. Output in English.
- Derive every claim from the numbers given (use them in your wording). Do NOT invent metrics that were not provided.
- Identify the MOST LIKELY biggest problem from the data (e.g. retention vs reach vs engagement vs clicks), explain it plainly, and ground it in the numbers.
- whatWorks: what the numbers show is already working (mention the actual figures). If genuinely nothing works yet, say so honestly.
- whatToImprove: 2–4 concrete, actionable improvements tied to the diagnosis.
- newHook: a specific, rewritten first-1-2-second hook that directly targets the diagnosed problem.
- optimized: ONE concrete optimized video version (retain what works, fix the problem, describe the new scenes/hook/overlay concretely).
- nextTest: exactly ONE concrete next test (what to change and what metric to watch), so the user can A/B iterate.

JSON schema exactly:
{
  "biggestProblem": "most likely biggest problem, plainly explained with the numbers",
  "whatWorks": ["what already works (with actual numbers)"],
  "whatToImprove": ["improvement 1", "improvement 2", "improvement 3"],
  "newHook": "specific rewritten first-1-2-second hook",
  "optimized": "one concrete optimized video version",
  "nextTest": "one concrete next test + the metric to watch"
}`;

const DIAGNOSE_DE = `Du bist Growimos TikTok-Diagnostiker. Der Nutzer liefert echte Performance-Zahlen zu einem seiner TikToks. Analysiere sie ehrlich und gib konkrete, priorisierte nächste Schritte — NIEMALS einen generischen Motivationsspruch, NIEMALS „mach einfach weiter" ohne Beleg.

Regeln:
- Antworte AUSSCHLIESSLICH mit validem JSON, kein anderer Text, keine Markdown-Fences. Ausgabe auf Deutsch.
- Leite jede Aussage aus den genannten Zahlen ab (nutze sie wörtlich). Erfinde keine Metriken, die nicht genannt wurden.
- Benenne das WAHrscheinlich größte Problem aus den Daten (z. B. Retention vs. Reichweite vs. Engagement vs. Klicks), erkläre es verständlich und begründe es mit den Zahlen.
- whatWorks: was die Zahlen zeigen, dass es bereits funktioniert (mit den konkreten Zahlen). Wenn ehrlich noch nichts funktioniert, sage das.
- whatToImprove: 2–4 konkrete, umsetzbare Verbesserungen, die zur Diagnose passen.
- newHook: eine konkret neu geschriebene Hook-Zeile für die ersten 1–2 Sekunden, die direkt das diagnostizierte Problem adressiert.
- optimized: EINE konkrete optimierte Video-Version (Behalte, was funktioniert, behebe das Problem, beschreibe neue Szenen/Hook/Einblendung konkret).
- nextTest: GENAU EIN konkreter nächster Test (was zu ändern und welche Metrik zu beobachten), damit der Nutzer iterieren kann.

JSON-Schema exakt:
{
  "biggestProblem": "wahrscheinlich größtes Problem, verständlich erklärt mit den Zahlen",
  "whatWorks": ["was bereits funktioniert (mit konkreten Zahlen)"],
  "whatToImprove": ["Verbesserung 1", "Verbesserung 2", "Verbesserung 3"],
  "newHook": "konkrete neu geschriebene Hook-Zeile für die ersten 1-2 Sekunden",
  "optimized": "eine konkrete optimierte Video-Version",
  "nextTest": "ein konkreter nächster Test + die zu beobachtende Metrik"
}`;

// ── System-/User-Prompt-Auswahl ──────────────────────────────────────────────
function pickSystemPrompt(mode: TikTokMode, lang: TikTokLang): string {
  const de = lang === 'de';
  if (mode === 'diagnose') return de ? DIAGNOSE_DE : DIAGNOSE_EN;
  if (mode === 'concept') return de ? CONCEPT_DE : CONCEPT_EN;
  return de ? TODAY_IDEA_DE : TODAY_IDEA_EN;
}

function buildUserPrompt(input: TikTokInput, lang: TikTokLang): string {
  const de = lang === 'de';
  const lines: string[] = [];
  lines.push(de ? 'Unternehmen / Produkt (kurz):' : 'Business / product (short):', input.biz);
  if (input.goal) {
    lines.push(de ? 'Ziel:' : 'Goal:', input.goal);
  }
  if (input.audience) {
    lines.push(de ? ('Zielgruppe: ' + input.audience) : ('Target audience: ' + input.audience));
  }
  if (input.mode === 'concept' && input.topic) {
    lines.push(
      de ? 'Thema / Produkt / grobe Idee:' : 'Topic / product / rough idea:',
      input.topic,
    );
  }
  if (input.mode === 'diagnose' && input.metrics) {
    const m = input.metrics;
    const label = (k: string, v: string) => (de ? `${k}: ${v}` : `${k}: ${v}`);
    lines.push(de ? 'Bestehende TikTok-Daten:' : 'Existing TikTok data:');
    lines.push(label(de ? 'Aufrufe (Views)' : 'Views', String(m.views)));
    lines.push(label(de ? 'Videolänge' : 'Video length', m.length));
    lines.push(label(de ? 'Durchschn. Wiedergabedauer (Sek.)' : 'Avg watch time (s)', String(m.avgWatch)));
    lines.push(label(de ? 'Likes' : 'Likes', String(m.likes)));
    lines.push(label(de ? 'Kommentare' : 'Comments', String(m.comments)));
    lines.push(label(de ? 'Shares' : 'Shares', String(m.shares)));
    lines.push(label(de ? 'Profilaufrufe' : 'Profile visits', String(m.profileVisits)));
  }
  lines.push(de ? 'Antworte nur mit dem JSON-Schema.' : 'Answer with the JSON schema only.');
  return lines.join('\n');
}

// ── JSON-Validierung ─────────────────────────────────────────────────────────
function extractJson(text: string): unknown {
  let candidate = (text || '').trim();
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  candidate = candidate.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function strArr(v: unknown): string[] {
  return Array.isArray(v)
    ? (v as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
    : [];
}

function parseIdea(mode: 'todayIdea' | 'concept', p: Record<string, unknown>): TikTokIdeaResult | null {
  if (!str(p.idea) || !str(p.hook) || !str(p.length)) return null;
  return {
    mode,
    idea: str(p.idea),
    hook: str(p.hook),
    length: str(p.length),
    scenes: strArr(p.scenes),
    overlays: strArr(p.overlays),
    spokenText: str(p.spokenText),
    caption: str(p.caption),
    hashtags: strArr(p.hashtags),
    cta: str(p.cta),
    why: str(p.why),
  };
}

function parseDiagnose(p: Record<string, unknown>): TikTokDiagnoseResult | null {
  if (!str(p.biggestProblem) || !str(p.newHook) || !str(p.optimized) || !str(p.nextTest)) return null;
  return {
    mode: 'diagnose',
    biggestProblem: str(p.biggestProblem),
    whatWorks: strArr(p.whatWorks),
    whatToImprove: strArr(p.whatToImprove),
    newHook: str(p.newHook),
    optimized: str(p.optimized),
    nextTest: str(p.nextTest),
  };
}

function parseResult(mode: TikTokMode, text: string): TikTokResult | null {
  const raw = extractJson(text);
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (mode === 'diagnose') return parseDiagnose(p);
  return parseIdea(mode === 'concept' ? 'concept' : 'todayIdea', p);
}

// ── Hauptfunktion ────────────────────────────────────────────────────────────
/**
 * Erzeugt ein strukturiertes TikTok-Ergebnis für einen der drei Modi.
 * Wirft bei fehlendem Key, Netzwerkfehler oder nicht validierbarem JSON.
 * `lang` steuert die Ausgabesprache (de/en) — identisches JSON-Schema.
 */
export async function generateTikTok(
  input: TikTokInput,
  lang: TikTokLang = 'de',
): Promise<TikTokResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      lang === 'de'
        ? 'TikTok-Engine nicht konfiguriert (OPENAI_API_KEY fehlt).'
        : 'TikTok engine not configured (OPENAI_API_KEY missing).',
    );
  }
  const client = new OpenAI({ apiKey });
  const system = pickSystemPrompt(input.mode, lang);
  const user = buildUserPrompt(input, lang);

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.7,
    max_tokens: 1600,
    response_format: { type: 'json_object' },
  });
  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error('TikTok-Engine lieferte eine leere Antwort.');

  const result = parseResult(input.mode, text);
  if (!result) {
    throw new Error(
      lang === 'de'
        ? 'Die TikTok-Antwort konnte nicht gelesen werden. Bitte erneut versuchen.'
        : 'Could not read the TikTok response. Please try again.',
    );
  }
  console.log(`[tiktok] ${input.mode} OK (${lang}) — idea/analysis generated`);
  return result;
}
