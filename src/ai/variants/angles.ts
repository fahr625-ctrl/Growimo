// ── Owner 2026-10-03 (Stabilisierungspaket Schritt 1, Punkt 1a/1b) ────────────
// Die drei A/B/C-Varianten waren faktisch nur anders formuliert: „emotional /
// nutzenorientiert / faktisch" stand als kosmetische Zeile im Prompt, während
// die Struktur „exakt wie das Original" erzwungen wurde. Hier stehen drei ECHT
// verschiedene Strategie-Aufträge (Ansprache, Positionierung, CTA-Mechanik,
// Fokus) — und je Ansatz deterministische Prüfungen, was davon sichtbar wurde.
//
// Wichtig (Punkt 2, eine zentrale Wahrheit): angleFit() liefert nicht nur eine
// Zahl, sondern einen echten ScoreIssue (message + fix). Der Abzug fließt in die
// Teilwerte, das Total wird über die zentrale Formel (totalFromSubScores) und
// die Abschlussmeldung über die zentrale buildScoreSummary() neu abgeleitet —
// es gibt keinen zweiten, abweichenden Score-Pfad.
//
// Fakten bleiben unangetastet: die Ansätze unterscheiden Strategie, Ansprache
// und Fokus — NICHT die Produktfakten.

import type { ContentResult, ContentScore, ScoreIssue } from '../types';
import { buildScoreSummary, totalFromSubScores } from '../scoring';
import { blockByHeading, extractBlocks } from '../scoring/sections';

export type VariantAngleKey = 'emotional_gift' | 'benefit_focus' | 'fact_seo';

export interface VariantAngle {
  key: VariantAngleKey;
  /** Anzeige-Kürzel für Logs/Belege (A/B/C). */
  letter: 'A' | 'B' | 'C';
  /** Deutscher Kurzname (Server-seitige Issue-Texte; UI nutzt i18n-Keys). */
  labelDe: string;
  /** Der verbindliche Strategie-Auftrag im Prompt (de/en). */
  instruction: { de: string; en: string };
}

export const VARIANT_ANGLES: readonly VariantAngle[] = [
  {
    key: 'emotional_gift',
    letter: 'A',
    labelDe: 'Emotional & geschenk-orientiert',
    instruction: {
      de: `ANSATZ A — Emotional & geschenk-orientiert (Hook-/Story-getrieben):
- Eröffne mit einem konkreten Moment beim Beschenkten (Szene, Gefühl, kleine Story). Der erste Satz ist ein Scroll-Stop, keine Produktbeschreibung.
- Positionierung: „der Geschenk-Moment". Das Produkt ist der Auslöser eines Gefühls, nicht der Star des Textes.
- Ansprache: die schenkende Person (du/dir), ihre Vorfreude und der Moment der Übergabe.
- CTA-Mechanik: emotional/identifikativ — lädt dazu ein, diesen Moment möglich zu machen. Keine Rabatt-, Dringlichkeits- oder Trend-Rhetorik.
- Tonalität: warm, bildhaft, kurze Sätze.`,
      en: `APPROACH A — Emotional & gift-driven (hook/story-led):
- Open with a concrete moment for the recipient (scene, feeling, short story). The first line is a scroll-stopper, not a product description.
- Positioning: "the gift moment". The product triggers a feeling; it is not the hero of the text.
- Address the giver (you/your), their anticipation and the moment of handing it over.
- CTA mechanics: emotional/identity-led — invite them to make that moment happen. No discount, urgency or trend rhetoric.
- Tone: warm, vivid, short sentences.`,
    },
  },
  {
    key: 'benefit_focus',
    letter: 'B',
    labelDe: 'Nutzen & Vorteil',
    instruction: {
      de: `ANSATZ B — Nutzen & Vorteil (vorteilsgetrieben):
- Eröffne mit dem konkreten Vorteil/dem Ergebnis für den Nutzer: Was ist danach einfacher, besser, angenehmer?
- Positionierung: „die praktische Lösung" für eine konkrete Alltagssituation.
- Ansprache: eine ANDERE Teilzielgruppe als A — die Person, die für sich selbst entscheidet bzw. rein praktisch abwägt (nicht die schenkende Person).
- CTA-Mechanik: direkte Handlungsaufforderung mit Begründung („… damit du X sofort hast"). Sachlich, ohne Druck.
- Tonalität: klar, konkret, Nutzen vor Emotion. Keine erfundenen Ergebnisse oder Zahlen.`,
      en: `APPROACH B — Benefits & advantages (benefit-led):
- Open with the concrete benefit/outcome for the user: what becomes easier, better, nicer afterwards?
- Positioning: "the practical solution" for a concrete everyday situation.
- Address a DIFFERENT sub-audience than A — the person deciding for themselves and weighing things pragmatically (not the giver).
- CTA mechanics: a direct call to action with a reason ("… so you get X right away"). Matter-of-fact, no pressure.
- Tone: clear, concrete, benefit before emotion. No invented results or numbers.`,
    },
  },
  {
    key: 'fact_seo',
    letter: 'C',
    labelDe: 'Fakten & SEO',
    instruction: {
      de: `ANSATZ C — Fakten & SEO (fakten-/kompakt-getrieben):
- Eröffne mit der stärksten Suchintention bzw. der Kernaussage in EINEM kompakten Satz.
- Positionierung: „die informierte Kaufentscheidung". Fokus: Nachhaltigkeit, Material, Herstellung, Nutzung — ausschließlich so, wie es in der Produktidee steht.
- Ansprache: die suchende, abwägende Person (konkreter Suchanlass/Frage).
- CTA-Mechanik: sachlich-informativ und an den Suchanlass gebunden (z. B. weitere Details ansehen), nicht emotional.
- Tonalität: kompakt, faktisch, wenig Beiwerk. Suchbegriffe natürlich eingebaut, keine Keyword-Ketten.`,
      en: `APPROACH C — Facts & SEO (fact-led, compact):
- Open with the strongest search intent or the key statement in ONE compact sentence.
- Positioning: "the informed purchase decision". Focus: sustainability, material, how it is made, how it is used — strictly as stated in the product idea.
- Address the searching, weighing person (concrete search occasion/question).
- CTA mechanics: factual-informative and tied to the search occasion (e.g. see more details), not emotional.
- Tone: compact, factual, little decoration. Search terms woven in naturally, no keyword chains.`,
    },
  },
];

export function isVariantAngleKey(v: unknown): v is VariantAngleKey {
  return typeof v === 'string' && VARIANT_ANGLES.some((a) => a.key === v);
}

export function angleForIndex(i: number): VariantAngle {
  return VARIANT_ANGLES[i] ?? VARIANT_ANGLES[0];
}

export function angleLabelDe(key: string | undefined): string {
  return VARIANT_ANGLES.find((a) => a.key === key)?.labelDe ?? '';
}

/**
 * Weist jeder Variante einen Ansatz zu. Zuerst zählt die Angabe des Modells
 * (jeder Ansatz nur einmal); fehlt oder doppelt sie sich, wird die Position
 * genutzt (Variante 1 → A, 2 → B, 3 → C) — so zeigt die UI immer drei klar
 * benannte, unterschiedliche Ansätze statt drei gleicher Etiketten.
 */
export function resolveAngleAssignments(reported: Array<string | undefined>): VariantAngleKey[] {
  const used = new Set<VariantAngleKey>();
  const first = reported.map((r) => {
    if (isVariantAngleKey(r) && !used.has(r)) {
      used.add(r);
      return r;
    }
    return null;
  });
  return first.map((key, i) => {
    if (key) return key;
    const preferred = VARIANT_ANGLES[i]?.key;
    if (preferred && !used.has(preferred)) {
      used.add(preferred);
      return preferred;
    }
    const rest = VARIANT_ANGLES.map((a) => a.key).find((k) => !used.has(k));
    if (rest) {
      used.add(rest);
      return rest;
    }
    return preferred ?? VARIANT_ANGLES[0].key;
  });
}

// ── Deterministischer Ansatz-Abgleich (1b) ────────────────────────────────────
// Ohne LLM-Judge (Regeln-only-Degradation) waren die Varianten-Scores oft
// identisch, weil die Regel-Quantisierung gleich ausfiel. Diese Prüfungen sind
// rein deterministisch und je Ansatz unterschiedlich: sie bewerten, ob die
// Variante ihren ZUGEWIESENEN Auftrag überhaupt erfüllt hat.

export interface AngleFitCheck {
  label: string;
  ok: boolean;
}

export interface AngleFitResult {
  angle: VariantAngleKey;
  /** 0–100: Anteil erfüllter Ansatz-Prüfungen. */
  score: number;
  passed: string[];
  failed: string[];
}

const EMOTION_WORDS = [
  'geschenk', 'schenk', 'geburtstag', 'überrasch', 'freude', 'glück', 'moment', 'erinnerung',
  'strahl', 'leuchtet', 'herz', 'liebe', 'zauber', 'lächeln', 'staunen',
  'gift', 'surprise', 'joy', 'memory', 'glow', 'heart', 'love', 'magic', 'smile',
];
const BENEFIT_WORDS = [
  'nutzen', 'vorteil', 'damit du', 'so dass', 'dadurch', 'praktisch', 'unkompliziert', 'einfach',
  'ideal für', 'perfekt für', 'für dich', 'spart', 'schnell', 'robust', 'langlebig', 'alltag',
  'sofort', 'jederzeit', 'genau das', 'benefit', 'so you', 'so that', 'practical', 'easy',
  'ideal for', 'perfect for', 'for you', 'durable', 'everyday', 'right away',
];
const CTA_ACTION_WORDS = [
  'jetzt', 'hol dir', 'sichere', 'bestell', 'kauf', 'entdeck', 'starte', 'probiere', 'speicher',
  'abonnier', 'klick', 'gönn', 'schau', 'get', 'grab', 'order', 'save', 'shop', 'try', 'start',
  'discover', 'click', 'explore', 'sign up', 'browse',
];
const FACT_WORDS = [
  'material', 'nachhaltig', 'umwelt', 'bio', 'regional', 'herstellung', 'hergestellt', 'zutaten',
  'entscheidung', 'kriterium', 'kriterien', 'fakten', 'vergleich', 'maße', 'größe', 'stück', 'angaben',
  'sustainable', 'sustainability', 'eco', 'facts', 'comparison', 'decision', 'size', 'made of', 'details',
];
const CTA_HEADINGS = ['Call to Action', 'Call-to-Action', 'CTA', 'Jetzt gehört es dir', 'Jetzt gehört es Dir'];

/** Der Abschluss-Abschnitt der Variante (Fallback: letzte Zeilen). */
function ctaText(body: string): string {
  try {
    const block = blockByHeading(extractBlocks(body ?? ''), CTA_HEADINGS);
    if (block?.content) return block.content.toLowerCase();
  } catch {
    // fall through to the tail heuristic
  }
  return (body ?? '').slice(-420).toLowerCase();
}

function countHits(haystack: string, needles: string[]): number {
  const seen = new Set<string>();
  for (const n of needles) {
    if (n && haystack.includes(n)) seen.add(n);
  }
  return seen.size;
}

/** Prüft, ob eine Variante ihren zugewiesenen Ansatz sichtbar umsetzt. */
export function angleFit(key: VariantAngleKey, title: string, body: string): AngleFitResult {
  const text = `${title ?? ''}\n${body ?? ''}`.toLowerCase();
  const head = text.slice(0, 260);

  let checks: AngleFitCheck[];
  if (key === 'emotional_gift') {
    checks = [
      { label: 'emotionale Bildsprache', ok: countHits(text, EMOTION_WORDS) >= 2 },
      { label: 'Ansprache der schenkenden Person (Geschenk-/Übergabe-Moment)', ok: countHits(text, ['geschenk', 'schenk', 'überrasch', 'gift', 'surprise', 'birthday', 'geburtstag']) >= 1 },
      { label: 'Story-/Hook-Einstieg in den ersten Zeilen', ok: countHits(head, EMOTION_WORDS) >= 1 || /[!?]/.test(head) },
    ];
  } else if (key === 'benefit_focus') {
    checks = [
      { label: 'konkreter Nutzen als Einstieg', ok: countHits(head, BENEFIT_WORDS) >= 1 },
      { label: 'mehrere greifbare Vorteile (Nutzen-Breite)', ok: countHits(text, BENEFIT_WORDS) >= 4 },
      { label: 'direkte Handlungsaufforderung im Abschluss', ok: countHits(ctaText(body), CTA_ACTION_WORDS) >= 1 },
    ];
  } else {
    checks = [
      { label: 'Fakten-/Entscheidungsangaben im Text', ok: countHits(text, FACT_WORDS) >= 2 },
      { label: 'mehrere konkrete Fakten (Material, Größe, Herstellung, Kriterien)', ok: countHits(text, FACT_WORDS) >= 4 },
      { label: 'kompakte, faktenorientierte Sätze', ok: averageSentenceWords(text) <= 22 },
    ];
  }

  const passed = checks.filter((c) => c.ok).map((c) => c.label);
  const failed = checks.filter((c) => !c.ok).map((c) => c.label);
  return {
    angle: key,
    score: Math.round((passed.length / checks.length) * 100),
    passed,
    failed,
  };
}

function averageSentenceWords(text: string): number {
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
  if (sentences.length === 0) return 999;
  const words = sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0);
  return words / sentences.length;
}

/** Abzug je verfehlter Ansatz-Prüfung (0–4 Punkte pro Prüfung). */
const PENALTY_PER_FAILED_CHECK = 4;

/**
 * Wendet den Ansatz-Abgleich auf einen fertig berechneten Score an:
 *  - verfehlte Ansatz-Prüfungen erzeugen einen ECHTEN ScoreIssue (message+fix),
 *  - der Abzug landet in der zuständigen Teilwert-Dimension (relevance, sonst
 *    die schwächste Dimension) und das Total wird über die zentrale Formel neu
 *    berechnet,
 *  - die Abschlussmeldung wird aus der zentralen buildScoreSummary() neu gebildet.
 * Es wird nie ein Score ERHÖHT — nur ehrlich abgewertet, wenn der Ansatz fehlt.
 */
export function applyAngleFit(
  score: ContentScore,
  result: Pick<ContentResult, 'contentType' | 'title' | 'body'>,
  key: VariantAngleKey,
): { score: ContentScore; fit: AngleFitResult } {
  const fit = angleFit(key, result.title, result.body);
  if (fit.failed.length === 0) return { score, fit };

  const penalty = Math.min(12, fit.failed.length * PENALTY_PER_FAILED_CHECK);
  const target = score.subScores.find((s) => s.key === 'relevance') ?? weakest(score.subScores);
  const subScores = score.subScores.map((s) =>
    target && s.key === target.key
      ? { ...s, score: Math.max(0, s.score - penalty), comment: `${s.comment} Ansatz-Abgleich: −${penalty}.` }
      : s,
  );
  const total = totalFromSubScores(subScores);

  const issue: ScoreIssue = {
    severity: 'warning',
    category: target?.key ?? 'relevance',
    message: `Die Variante folgt dem Ansatz „${angleLabelDe(key)}" nur teilweise — es fehlt: ${fit.failed.join(', ')}.`,
    fix: {
      field: 'body',
      action: 'rewrite',
      suggestion: `Schreibe die Variante konsequent im Ansatz „${angleLabelDe(key)}": ${fit.failed.join(', ')}. Verwende dabei nur Fakten aus der Produktidee — keine neuen Angaben.`,
    },
  };

  const issues = [...score.issues, issue];
  return {
    score: {
      ...score,
      total,
      subScores,
      issues,
      summary: buildScoreSummary(result.contentType, total, subScores, issues),
    },
    fit,
  };
}

function weakest(subScores: ContentScore['subScores']) {
  if (!subScores || subScores.length === 0) return null;
  return subScores.reduce((worst, cur) => (cur.score < worst.score ? cur : worst), subScores[0]);
}
