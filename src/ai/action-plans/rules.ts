// ── F5 Kanal-Aktionspläne: deterministische Schritt-Generatoren ──────────────
// Each channel (Pinterest / Etsy / SEO) gets a concrete, checkable execution
// plan: 8 steps with {step, channel, action, detail, doneCriteria}. The steps
// interpolate the REAL asset content (title, keywords, CTA, hook, tags, alt
// text, …) from extract.ts — so "Pin-Titel einfügen" always names the actual
// generated title, never a generic tip. Pure functions, no LLM, never throw.
import type { ContentType } from '~/ai/types';
import type { ActionPlanAsset } from './extract';
import { extractEtsy, extractPinterest, extractSeo } from './extract';

export interface ActionPlanStep {
  /** 1-based position in the checklist. */
  step: number;
  /** Publication channel (pinterest_pin / etsy_listing / seo_blog). */
  channel: ContentType;
  /** Short imperative headline — rendered bold. */
  action: string;
  /** Concrete instruction referencing the actual asset content. */
  detail: string;
  /** Verifiable "done" criterion — „Fertig, wenn: …". */
  doneCriteria: string;
}

export interface ActionPlan {
  channel: ContentType;
  /** Reference to the asset this plan was built from (title). */
  assetRef: string;
  plan: ActionPlanStep[];
  /** Rules version so the plan can evolve without breaking clients. */
  ruleVersion: number;
}

let stepCounter = 0;
function step(
  channel: ContentType,
  action: string,
  detail: string,
  doneCriteria: string,
): ActionPlanStep {
  stepCounter += 1;
  return { step: stepCounter, channel, action, detail, doneCriteria };
}

function list(values: string[], max = 4): string {
  const v = values.filter(Boolean);
  if (v.length === 0) return '';
  const shown = v.slice(0, max);
  return shown.join(', ') + (v.length > max ? ' …' : '');
}

// ── Pinterest ─────────────────────────────────────────────────────────────────
function pinterestPlan(input: ActionPlanAsset): ActionPlanStep[] {
  const a = extractPinterest(input);
  const kws = a.firstKeywords.length > 0 ? a.firstKeywords : a.keywords;
  const plan: ActionPlanStep[] = [];
  stepCounter = 0;

  plan.push(
    step(
      'pinterest_pin',
      'Pin-Titel übernehmen',
      `Füge als Pin-Titel exakt ein: „${a.title}“ (max. 100 Zeichen — er ist auf SEO optimiert).`,
      'Der Titel steht im Pin-Titelfeld und ist nicht abgeschnitten.',
    ),
    step(
      'pinterest_pin',
      'Pin-Beschreibung einfügen',
      'Kopiere den kompletten Text aus dem Abschnitt „Pin-Beschreibung“ in das Beschreibungsfeld des neuen Pins.',
      'Die Beschreibung ist vollständig eingefügt (mindestens 2 Absätze).',
    ),
    step(
      'pinterest_pin',
      'Keywords in der Beschreibung prüfen',
      kws.length > 0
        ? `Stelle sicher, dass diese Keywords in der Pin-Beschreibung vorkommen: ${list(kws, 5)}.`
        : 'Stelle sicher, dass die wichtigsten Produktbegriffe in der Pin-Beschreibung vorkommen.',
      'Mindestens 3 der Keywords stehen wörtlich in der Beschreibung.',
    ),
    step(
      'pinterest_pin',
      '3 passende Boards auswählen',
      kws.length > 0
        ? `Wähle 3 Boards passend zu: ${list(kws, 3)} — z. B. Geschenkideen, Wanddeko und Hochzeit.`
        : 'Wähle 3 Boards, die zu deinem Produkt und deiner Zielgruppe passen.',
      '3 Boards sind ausgewählt; jedes Board passt zu mindestens einem Keyword.',
    ),
    step(
      'pinterest_pin',
      'Call-to-Action einbauen',
      a.cta
        ? `Ende der Beschreibung lautet: „${a.cta}“ — falls es fehlt, ergänze genau diesen Satz.`
        : 'Ergänze am Ende der Beschreibung eine klare Aufforderung (z. B. „Speichern, bevor die Sterne erlöschen!“).',
      'Die Beschreibung endet mit einem klaren Call-to-Action.',
    ),
    step(
      'pinterest_pin',
      'Alt-Text hinterlegen',
      a.altText
        ? `Übernimm den Alt-Text: „${a.altText}“ (Ziel: 80–125 Zeichen).`
        : 'Schreibe einen Alt-Text mit Haupt-Keyword + Beschreibung (Ziel: 80–125 Zeichen).',
      'Der Alt-Text ist hinterlegt und beschreibt das Bild konkret.',
    ),
    step(
      'pinterest_pin',
      'Hashtags ergänzen',
      a.hashtags.length > 0
        ? `Füge 3–5 Hashtags hinzu, z. B. ${list(a.hashtags, 5)}.`
        : 'Füge 3–5 Hashtags passend zum Produkt hinzu.',
      '3–5 Hashtags sind in der Beschreibung enthalten.',
    ),
    step(
      'pinterest_pin',
      'Kategorie & Link setzen',
      a.category
        ? `Setze die Kategorie „${a.category}“ und verlinke den Pin auf dein Etsy-Listing oder deinen Shop.`
        : 'Wähle eine passende Kategorie und verlinke den Pin auf dein Angebot.',
      'Der Pin ist veröffentlicht und auf dein Angebot verlinkt.',
    ),
  );
  return plan;
}

// ── Etsy ──────────────────────────────────────────────────────────────────────
function etsyPlan(input: ActionPlanAsset): ActionPlanStep[] {
  const a = extractEtsy(input);
  const plan: ActionPlanStep[] = [];
  stepCounter = 0;

  plan.push(
    step(
      'etsy_listing',
      'Listing-Titel einfügen',
      `Füge den Titel ein: „${a.title}“ (Etsy erlaubt max. 140 Zeichen).`,
      'Der Titel ist übernommen und unter 140 Zeichen.',
    ),
    step(
      'etsy_listing',
      'Kurzbeschreibung übernehmen',
      a.shortDesc
        ? `Nutze als erste Beschreibungszeile: „${a.shortDesc}“ — sie weckt direkt Neugier.`
        : 'Schreibe eine kurze, emotionale Eröffnungszeile, die das Besondere zeigt.',
      'Die erste Zeile der Beschreibung ist gesetzt (max. 160 Zeichen).',
    ),
    step(
      'etsy_listing',
      'Vollständige Beschreibung einfügen',
      'Füge den kompletten Abschnitt „Vollständige Etsy-Beschreibung“ (inkl. der Abschnitte a–e) als Description ein.',
      'Alle Abschnitte a–e sind eingefügt, Emojis und Absätze bleiben erhalten.',
    ),
    step(
      'etsy_listing',
      'Alle 13 Tags eintragen',
      a.tags.length > 0
        ? `Trage die Tags einzeln ein: ${list(a.tags, 13)} (Etsy: genau 13 Tags à max. 20 Zeichen).`
        : 'Erstelle 13 Tags mit je max. 20 Zeichen passend zum Produkt.',
      '13 Tags sind eingetragen — keiner doppelt, keiner länger als 20 Zeichen.',
    ),
    step(
      'etsy_listing',
      'Kategorie wählen',
      a.category
        ? `Wähle in Etsy die Kategorie „${a.category}“.`
        : 'Wähle die passendste Etsy-Kategorie für dein Produkt.',
      'Die Kategorie ist gesetzt.',
    ),
    step(
      'etsy_listing',
      'Preis & Versand festlegen',
      'Setze einen Preis mit Marge (Material + Arbeitszeit) und hinterlege Versandkosten sowie Bearbeitungszeit.',
      'Preis, Versandkosten und Bearbeitungszeit sind gespeichert.',
    ),
    step(
      'etsy_listing',
      'Fotos hochladen',
      a.style || a.primaryColor
        ? `Lade 5–10 Fotos hoch — das erste zeigt das Produkt im Kontext (Stil: ${a.style ?? 'dein Design'}, Farbe: ${a.primaryColor ?? 'deine Farbpalette'}).`
        : 'Lade 5–10 Fotos hoch — das erste zeigt das Produkt im Kontext (z. B. an der Wand).',
      '5–10 Fotos sind hochgeladen, das erste Bild zeigt das Produkt im Kontext.',
    ),
    step(
      'etsy_listing',
      'Personalisierung & FAQ prüfen',
      'Aktiviere das Personalisierungsfeld (Datum/Ort/Botschaft) und hinterlege die FAQ-Antworten aus dem Asset.',
      'Personalisierung ist aktiv und die FAQ-Antworten sind hinterlegt.',
    ),
  );
  return plan;
}

// ── SEO-Blog ──────────────────────────────────────────────────────────────────
function seoPlan(input: ActionPlanAsset): ActionPlanStep[] {
  const a = extractSeo(input);
  const plan: ActionPlanStep[] = [];
  stepCounter = 0;
  const fk = a.focusKeyword ?? 'dein Fokus-Keyword';

  plan.push(
    step(
      'seo_blog',
      'Meta-Titel setzen',
      a.metaTitle
        ? `Nutze im CMS als Meta-Titel: „${a.metaTitle}“ (max. 60 Zeichen).`
        : `Schreibe einen Meta-Titel mit dem Fokus-Keyword „${fk}“ (max. 60 Zeichen).`,
      'Der Meta-Titel ist gesetzt, ≤ 60 Zeichen, Fokus-Keyword enthalten.',
    ),
    step(
      'seo_blog',
      'Meta-Beschreibung setzen',
      a.metaDescription
        ? `Übernimm die Meta-Beschreibung: „${a.metaDescription}“ (max. 160 Zeichen).`
        : `Schreibe eine Meta-Beschreibung mit dem Fokus-Keyword „${fk}“ und Nutzenversprechen (max. 160 Zeichen).`,
      'Die Meta-Beschreibung ist gesetzt, ≤ 160 Zeichen.',
    ),
    step(
      'seo_blog',
      'H1 prüfen',
      a.h1
        ? `Setze als H1: „${a.h1}“ — das Fokus-Keyword „${fk}“ muss im H1 stehen.`
        : `Setze eine H1, die das Fokus-Keyword „${fk}“ enthält.`,
      'Es gibt genau eine H1, das Fokus-Keyword ist enthalten.',
    ),
    step(
      'seo_blog',
      'URL-Slug setzen',
      a.slug
        ? `Setze den Slug auf „/${a.slug}“ (kurz, ohne Sonderzeichen).`
        : `Erstelle einen kurzen Slug mit dem Fokus-Keyword „${fk}“.`,
      'Der Slug ist gesetzt und enthält das Fokus-Keyword.',
    ),
    step(
      'seo_blog',
      'Fokus-Keyword im Text verteilen',
      a.keywords.length > 1
        ? `Baue „${fk}“ in Einleitung, mindestens 2 Zwischenüberschriften und Fazit ein (4–6× gesamt) und verteile zusätzlich: ${list(a.keywords.slice(1), 5)}.`
        : `Baue „${fk}“ in Einleitung, mindestens 2 Zwischenüberschriften und Fazit ein (4–6× gesamt).`,
      'Das Keyword kommt 4–6× vor — in Intro, 2 Zwischenüberschriften und Fazit.',
    ),
    step(
      'seo_blog',
      'Einleitung mit Hook öffnen',
      a.hook
        ? `Beginne den Artikel mit dem Hook: „${a.hook}“ (erster Satz der Einleitung).`
        : 'Beginne den Artikel mit einer emotionalen Szene oder Frage zur Produktidee.',
      'Der erste Satz der Einleitung ist der Hook aus dem Asset.',
    ),
    step(
      'seo_blog',
      'Interne Links & Alt-Texte',
      'Setze mindestens einen internen Link auf einen passenden eigenen Artikel und beschrifte alle Bilder mit Alt-Texten (Keyword + Beschreibung).',
      'Mindestens 1 interner Link ist gesetzt, alle Bilder haben Alt-Texte.',
    ),
    step(
      'seo_blog',
      'CTA & Veröffentlichung',
      a.cta
        ? `Ende mit dem Call-to-Action „${a.cta}“ und veröffentliche den Artikel.`
        : 'Schließe mit einer klaren Handlungsaufforderung und veröffentliche den Artikel.',
      'Der Artikel ist live, der CTA steht am Ende.',
    ),
  );
  return plan;
}

type PlanBuilder = (input: ActionPlanAsset) => ActionPlanStep[];
export const PLAN_BUILDERS: Partial<Record<ContentType, PlanBuilder>> = {
  pinterest_pin: pinterestPlan,
  etsy_listing: etsyPlan,
  seo_blog: seoPlan,
};

/** Channels that have an action-plan builder. */
export function hasActionPlan(channel: ContentType): boolean {
  return Boolean(PLAN_BUILDERS[channel]);
}

export const ACTION_PLAN_RULE_VERSION = 1;
