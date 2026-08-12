// ── F6 Strategie-Brief: Fragen-Definitionen + Kontext-Bau ─────────────────────
// EINE Quelle für UI UND Prompt-Bau: Die UI rendert die Fragen/Optionen aus
// diesem Modul, buildBriefContext() erzeugt daraus den additionalContext-Text,
// der in jede Generierung eingespeist wird. Keine LLM-Calls nötig — der Brief
// ist reiner Kontext (kostensparsam).
//
// Form des Briefes (flach, JSON-sicher):
//   { [questionKey]: optionValue | freierText, [questionKey + '_note']: freierText }
// `_note`-Einträge sind die optionalen Freitext-Ergänzungen je Frage.

export type BriefLang = 'de' | 'en';

export type BriefQuestionKey = 'audience' | 'price' | 'season' | 'usp' | 'platform' | 'voice';

export interface BriefOption {
  /** Stabiler Wert — wird im Brief gespeichert und in die Prompts übersetzt. */
  value: string;
  label: Record<BriefLang, string>;
}

export interface BriefQuestion {
  key: BriefQuestionKey;
  /** Kurzer Prompt-Name für buildBriefContext („Zielgruppe=", „Preis=" …). */
  promptLabel: Record<BriefLang, string>;
  /** UI-Label der Frage. */
  label: Record<BriefLang, string>;
  options: BriefOption[];
  /** voice ist laut Roadmap optional (Tonalität existiert bereits separat). */
  optional?: boolean;
}

export const BRIEF_QUESTIONS: BriefQuestion[] = [
  {
    key: 'audience',
    promptLabel: { de: 'Zielgruppe', en: 'Target audience' },
    label: { de: '1. Zielgruppe', en: '1. Target audience' },
    options: [
      { value: 'young_parents', label: { de: 'Junge Eltern', en: 'Young parents' } },
      { value: 'design_lovers', label: { de: 'Design-Liebhaber', en: 'Design lovers' } },
      { value: 'gift_shoppers', label: { de: 'Geschenk-Käufer', en: 'Gift shoppers' } },
      { value: 'hobby_diy', label: { de: 'Hobby & DIY', en: 'Hobby & DIY' } },
      { value: 'business', label: { de: 'Business/Profis', en: 'Business/Professionals' } },
    ],
  },
  {
    key: 'price',
    promptLabel: { de: 'Preis', en: 'Price' },
    label: { de: '2. Preisposition', en: '2. Price point' },
    options: [
      { value: 'budget', label: { de: 'Budget <20 €', en: 'Budget <€20' } },
      { value: 'mid', label: { de: 'Mittel 20–60 €', en: 'Mid €20–60' } },
      { value: 'premium', label: { de: 'Premium 60–150 €', en: 'Premium €60–150' } },
      { value: 'luxury', label: { de: 'Luxus >150 €', en: 'Luxury >€150' } },
    ],
  },
  {
    key: 'season',
    promptLabel: { de: 'Saison', en: 'Season' },
    label: { de: '3. Saison / Anlass', en: '3. Season / Occasion' },
    options: [
      { value: 'all_year', label: { de: 'Ganzjährig', en: 'All year round' } },
      { value: 'christmas', label: { de: 'Weihnachten', en: 'Christmas' } },
      { value: 'birthday', label: { de: 'Geburtstag', en: 'Birthday' } },
      { value: 'wedding', label: { de: 'Hochzeit', en: 'Wedding' } },
      { value: 'summer', label: { de: 'Sommer/Urlaub', en: 'Summer/Vacation' } },
    ],
  },
  {
    key: 'usp',
    promptLabel: { de: 'USP', en: 'USP' },
    label: { de: '4. Alleinstellungsmerkmal', en: '4. Unique selling point' },
    options: [
      { value: 'personalized', label: { de: 'Personalisiert', en: 'Personalized' } },
      { value: 'sustainable', label: { de: 'Nachhaltig', en: 'Sustainable' } },
      { value: 'handmade', label: { de: 'Handgemacht', en: 'Handmade' } },
      { value: 'durable', label: { de: 'Langlebig/Qualität', en: 'Durable/Quality' } },
      { value: 'fast_shipping', label: { de: 'Schnelle Lieferung', en: 'Fast shipping' } },
    ],
  },
  {
    key: 'platform',
    promptLabel: { de: 'Plattform', en: 'Platform' },
    label: { de: '5. Plattform-Schwerpunkt', en: '5. Platform focus' },
    options: [
      { value: 'pinterest', label: { de: 'Pinterest', en: 'Pinterest' } },
      { value: 'etsy', label: { de: 'Etsy', en: 'Etsy' } },
      { value: 'google_seo', label: { de: 'Google/SEO', en: 'Google/SEO' } },
      { value: 'social', label: { de: 'Social Media', en: 'Social Media' } },
      { value: 'all', label: { de: 'Alle gleich', en: 'All equally' } },
    ],
  },
  {
    key: 'voice',
    promptLabel: { de: 'Ton', en: 'Tone' },
    label: { de: '6. Ton / Stimme (optional)', en: '6. Tone of voice (optional)' },
    optional: true,
    options: [
      { value: 'professional', label: { de: 'Professionell', en: 'Professional' } },
      { value: 'friendly', label: { de: 'Freundlich', en: 'Friendly' } },
      { value: 'playful', label: { de: 'Verspielt', en: 'Playful' } },
      { value: 'luxury', label: { de: 'Luxus', en: 'Luxury' } },
      { value: 'casual', label: { de: 'Lässig', en: 'Casual' } },
    ],
  },
];

/** Known question keys — used for validation. */
export const BRIEF_QUESTION_KEYS: BriefQuestionKey[] = BRIEF_QUESTIONS.map((q) => q.key);

export function isBriefQuestionKey(key: string): key is BriefQuestionKey {
  return (BRIEF_QUESTION_KEYS as string[]).includes(key);
}

/** Der Freitext-Schlüssel zu einer Frage (z. B. `audience_note`). */
export function noteKeyOf(questionKey: BriefQuestionKey): string {
  return `${questionKey}_note`;
}

/** Option einer Frage per Wert finden (nicht gefunden → null). */
export function findOption(questionKey: BriefQuestionKey, value: string): BriefOption | null {
  const q = BRIEF_QUESTIONS.find((question) => question.key === questionKey);
  return q?.options.find((o) => o.value === value) ?? null;
}

/**
 * Erzeugt den Kontext-Text für additionalContext aus einem Brief.
 * Leerer Brief → leere Zeile (Flow verhält sich exakt wie ohne F6).
 * Format (kompakt, gut prompt-lesbar):
 *   „Strategie-Brief: Zielgruppe=Junge Eltern, Preis=Mittel 20–60 €, …"
 * Freitext-Ergänzungen werden als „(Zusatz: …)" angehängt.
 */
export function buildBriefContext(brief: Record<string, string> | null | undefined, lang: BriefLang = 'de'): string {
  if (!brief) return '';
  const parts: string[] = [];
  for (const question of BRIEF_QUESTIONS) {
    const value = brief[question.key];
    if (!value) continue;
    const option = findOption(question.key, value);
    // Bekannte Option → übersetztes Label; sonst roher Freitext des Nutzers.
    const label = option ? option.label[lang] : value;
    let part = `${question.promptLabel[lang]}=${label}`;
    const note = brief[noteKeyOf(question.key)];
    if (note && note.trim()) part += ` (Zusatz: ${note.trim()})`;
    parts.push(part);
  }
  return parts.length > 0 ? `Strategie-Brief: ${parts.join(', ')}` : '';
}
