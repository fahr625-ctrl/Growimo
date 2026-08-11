// ── F1 deterministic rule checks (per content type) ───────────────────────────
// Channel best-practice thresholds (Pinterest/Etsy/SEO/Social/Email). Every
// check is deterministic and explainable: a failing check becomes an issue
// entry with a machine-readable fix (field + action + German suggestion) that
// the future auto-improve loop (F2) can consume directly.
//
// Thresholds are based on published platform guidance:
//  - Pinterest: titles ≤ 100 chars, descriptions ~250–400 chars, 14–20 keywords,
//    12–18 hashtags, alt text 80–125 chars, 2:3 image prompt.
//  - Etsy: title ≤ 140 chars, exactly 13 tags (≤ 20 chars each), descriptions
//    ≥ 500 chars, main keyword at position 1, FAQ, alt text 90–130 chars.
//  - SEO: 1.500–2.500 words, H1/meta title ≤ 60 chars, meta description ≤ 160
//    chars, keyword 4–6× in body + in H1, FAQ, CTA, slug.
//  - Social: Instagram caption 100–180, Facebook 150–250, TikTok 30–100 chars,
//    5–8 / 2–3 hashtags per platform, engagement CTA.
//  - Email: subject ≤ 50 chars, preview text, body CTA, P.S., body length.

import type { ContentResult, ScoreDimension, ScoreIssue, ScoreIssueFix, ScoreSeverity } from '../types';
import {
  blockByHeading,
  blockByNumber,
  charCount,
  countLines,
  extractBlocks,
  numberedBlocks,
  type SectionBlock,
  wordCount,
} from './sections';

export interface RuleOutcome {
  pass: boolean;
  severity: ScoreSeverity;
  dimension: ScoreDimension;
  message: string;
  fix: ScoreIssueFix;
}

export interface RuleResults {
  /** Outcomes for every check that ran (passing ones included, for the ratio). */
  outcomes: RuleOutcome[];
  /** Issues = failing outcomes, critical first. */
  issues: ScoreIssue[];
}

interface RuleContext {
  type: ContentResult['contentType'];
  blocks: SectionBlock[];
  numbered: Map<number, SectionBlock>;
  result: ContentResult;
}

type RuleCheck = (ctx: RuleContext) => RuleOutcome;

// ── helpers ───────────────────────────────────────────────────────────────────

const DIM_LABEL: Record<ScoreDimension, string> = {
  title: 'Titel',
  keywords: 'Keywords',
  cta: 'CTA',
  length: 'Länge',
  image: 'Bild',
  structure: 'Struktur',
  relevance: 'Relevanz',
};

function issue(
  pass: boolean,
  dimension: ScoreDimension,
  message: string,
  fix: ScoreIssueFix,
  severity: ScoreSeverity = 'warning',
): RuleOutcome {
  return { pass, severity, dimension, message, fix };
}

function inRange(len: number, min: number, max: number): boolean {
  return len >= min && len <= max;
}

function lower(s: string | undefined | null): string {
  return (s ?? '').toLowerCase();
}

// ── Pinterest ─────────────────────────────────────────────────────────────────

const pinterestRules: RuleCheck[] = [
  (ctx) => {
    const title = ctx.result.title;
    const len = charCount(title);
    if (len > 100) {
      return issue(false, 'title', `Der Pin-Titel ist mit ${len} Zeichen zu lang (Limit: 100).`,
        { field: 'title', action: 'shorten', suggestion: `Kürze den SEO-Pin-Titel auf maximal 100 Zeichen (aktuell ${len}). Setze das stärkste Keyword an den Anfang und entferne Füllwörter.` },
        len > 140 ? 'critical' : 'warning');
    }
    return issue(true, 'title', `Pin-Titel hat ${len} Zeichen (Limit: 100).`, { field: 'title', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const kw = ctx.result.metadata?.keywords;
    const title = lower(ctx.result.title);
    const found = Array.isArray(kw) ? kw.filter((k) => title.includes(lower(String(k)))).length : 0;
    if (found === 0) {
      return issue(false, 'keywords', 'Kein Fokus-Keyword steckt im Pin-Titel.',
        { field: 'title', action: 'insert_keyword', suggestion: 'Integriere das Keyword mit dem höchsten Suchvolumen direkt in den Pin-Titel, z. B. als Subjekt der Headline.' });
    }
    return issue(true, 'keywords', `${found} Keyword(s) im Titel gefunden.`, { field: 'title', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const desc = blockByHeading(ctx.blocks, ['Pin-Beschreibung']);
    const len = desc ? charCount(desc.content) : 0;
    if (!desc || len === 0) {
      return issue(false, 'length', 'Die Pin-Beschreibung fehlt.',
        { field: 'description', action: 'add', suggestion: 'Schreibe eine Pin-Beschreibung mit 250–400 Zeichen: Mikro-Hook, dann Produktnutzen, dann Speicher-Anreiz.' }, 'critical');
    }
    if (len < 150) {
      return issue(false, 'length', `Die Pin-Beschreibung ist mit ${len} Zeichen zu kurz (Ziel: 250–400).`,
        { field: 'description', action: 'expand', suggestion: `Erweitere die Pin-Beschreibung auf 250–400 Zeichen (aktuell ${len}). Baue 2–3 Keywords natürlich in den Fließtext ein.` }, len < 100 ? 'critical' : 'warning');
    }
    if (len > 500) {
      return issue(false, 'length', `Die Pin-Beschreibung ist mit ${len} Zeichen zu lang (Ziel: 250–400).`,
        { field: 'description', action: 'shorten', suggestion: `Kürze die Pin-Beschreibung auf 250–400 Zeichen (aktuell ${len}). Entferne redundante Sätze, behalte Hook und CTA.` });
    }
    return issue(true, 'length', `Pin-Beschreibung: ${len} Zeichen (Ziel 250–400).`, { field: 'description', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const kw = ctx.result.metadata?.keywords;
    const count = Array.isArray(kw) ? kw.length : 0;
    if (count < 12) {
      return issue(false, 'keywords', `Nur ${count} Fokus-Keywords gefunden (Ziel: 14–20).`,
        { field: 'keywords', action: 'add', suggestion: `Ergänze auf 14–20 Keywords (aktuell ${count}): 60 % Such-Keywords, 40 % emotionale Trigger-Keywords, 2–4 Wörter pro Phrase.` }, count < 5 ? 'critical' : 'warning');
    }
    return issue(true, 'keywords', `${count} Fokus-Keywords (Ziel 14–20).`, { field: 'keywords', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const tags = ctx.result.metadata?.hashtags;
    const list = Array.isArray(tags) ? tags.map((t) => String(t)) : [];
    const count = list.length;
    const duplicates = new Set(list.map((t) => t.toLowerCase())).size !== list.length;
    if (count < 8) {
      return issue(false, 'keywords', `Nur ${count} Hashtags gefunden (Ziel: 12–18).`,
        { field: 'hashtags', action: 'add', suggestion: `Ergänze auf 12–18 Pinterest-Hashtags (aktuell ${count}): 4 breite, 5–8 nischenspezifische, 3–5 saisonale.` }, count < 5 ? 'critical' : 'warning');
    }
    if (duplicates) {
      return issue(false, 'keywords', 'Hashtags enthalten Duplikate.',
        { field: 'hashtags', action: 'remove', suggestion: 'Entferne doppelte Hashtags — jeder Hashtag darf nur einmal vorkommen.' });
    }
    return issue(true, 'keywords', `${count} Hashtags, keine Duplikate.`, { field: 'hashtags', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const cta = blockByHeading(ctx.blocks, ['Call to Action', 'Call-to-Action']);
    const len = cta ? charCount(cta.content) : 0;
    if (!cta || len < 10) {
      return issue(false, 'cta', 'Der Call-to-Action fehlt oder ist leer.',
        { field: 'cta', action: 'add', suggestion: 'Schreibe einen CTA mit maximal 100 Zeichen, der FOMO oder Neugier erzeugt (z. B. „Hol dir die Anleitung — bevor sie im Feed verschwindet").' }, 'critical');
    }
    if (len > 100) {
      return issue(false, 'cta', `Der CTA ist mit ${len} Zeichen zu lang (Limit: 100).`,
        { field: 'cta', action: 'shorten', suggestion: `Kürze den CTA auf maximal 100 Zeichen (aktuell ${len}).` });
    }
    return issue(true, 'cta', `CTA vorhanden (${len} Zeichen, Limit 100).`, { field: 'cta', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const img = blockByHeading(ctx.blocks, ['KI-Bild-Prompt', 'Bildprompt']);
    const content = img?.content ?? '';
    if (!img || content.length < 60) {
      return issue(false, 'image', 'Der KI-Bild-Prompt fehlt oder ist zu kurz.',
        { field: 'imagePrompt', action: 'add', suggestion: 'Erstelle einen detaillierten, einzeiligen englischen Bild-Prompt: Motiv, Kunststil, Farbpalette, Licht, Kameraperspektive, 2:3-Angabe, Qualitäts-Booster.' }, 'critical');
    }
    if (!lower(content).includes('2:3')) {
      return issue(false, 'image', 'Der Bild-Prompt enthält keine 2:3-Angabe (Pinterest-Format).',
        { field: 'imagePrompt', action: 'add', suggestion: 'Ergänze im Bild-Prompt die Angabe „2:3" bzw. „vertical 2:3", damit das Bild im Pinterest-Format generiert wird.' });
    }
    return issue(true, 'image', 'Bild-Prompt vorhanden inkl. 2:3-Format.', { field: 'imagePrompt', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const alt = ctx.result.metadata?.altText ? String(ctx.result.metadata.altText) : '';
    const len = charCount(alt);
    if (!alt) {
      return issue(false, 'image', 'Der Alt-Text fehlt.',
        { field: 'altText', action: 'add', suggestion: 'Schreibe einen Alt-Text mit 80–125 Zeichen: Hauptkeyword + sensorische Beschreibung (Farbe, Material, Stimmung).' });
    }
    if (len < 60 || len > 140) {
      return issue(false, 'image', `Alt-Text hat ${len} Zeichen (Ziel: 80–125).`,
        { field: 'altText', action: 'rewrite', suggestion: `Passe den Alt-Text auf 80–125 Zeichen an (aktuell ${len}).` });
    }
    return issue(true, 'image', `Alt-Text: ${len} Zeichen (Ziel 80–125).`, { field: 'altText', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const cat = ctx.result.metadata?.category;
    if (!cat || String(cat).trim().length < 3) {
      return issue(false, 'structure', 'Die Pin-Kategorie fehlt.',
        { field: 'category', action: 'add', suggestion: 'Wähle die exakte Pinterest-Kategorie (z. B. „DIY & Handwerk") mit ein bis zwei Sätzen Begründung.' });
    }
    return issue(true, 'structure', 'Pin-Kategorie vorhanden.', { field: 'category', action: 'keep', suggestion: '' });
  },
];

// ── Etsy ──────────────────────────────────────────────────────────────────────

const etsyRules: RuleCheck[] = [
  (ctx) => {
    const title = ctx.result.title;
    const len = charCount(title);
    if (len > 140) {
      return issue(false, 'title', `Der Etsy-Titel ist mit ${len} Zeichen zu lang (Limit: 140).`,
        { field: 'title', action: 'shorten', suggestion: `Kürze den Etsy-SEO-Titel auf maximal 140 Zeichen (aktuell ${len}). Beginne mit dem Hauptkeyword, trenne Keyword-Cluster mit | und streiche Füllwörter.` }, len > 200 ? 'critical' : 'warning');
    }
    return issue(true, 'title', `Etsy-Titel: ${len} Zeichen (Limit 140).`, { field: 'title', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const fk = ctx.result.metadata?.focusKeywords;
    const first = Array.isArray(fk) && fk.length > 0 ? lower(String(fk[0])) : '';
    const titleHead = lower(ctx.result.title).slice(0, 40);
    if (!first || !titleHead.includes(first)) {
      return issue(false, 'keywords', 'Das Hauptkeyword steht nicht an Position 1 des Etsy-Titels.',
        { field: 'title', action: 'reorder', suggestion: 'Beginne den Etsy-Titel mit dem Hauptkeyword (der erste Suchbegriff hat das höchste Gewicht für das Etsy-Ranking).' });
    }
    return issue(true, 'keywords', 'Hauptkeyword steht an Position 1.', { field: 'title', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const tags = ctx.result.metadata?.tags;
    const list = Array.isArray(tags) ? tags.map((t) => String(t)) : [];
    const count = list.length;
    const duplicates = new Set(list.map((t) => t.toLowerCase())).size !== list.length;
    const overlong = list.filter((t) => charCount(t) > 20).length;
    if (count < 13) {
      return issue(false, 'structure', `Nur ${count} von 13 Etsy-Tags ausgefüllt.`,
        { field: 'tags', action: 'add', suggestion: `Fülle ALLE 13 Etsy-Tags aus (aktuell ${count}). Nutze Longtail-Phrasen, wie Käufer wirklich suchen — maximal 20 Zeichen pro Tag.` }, count < 10 ? 'critical' : 'warning');
    }
    if (duplicates) {
      return issue(false, 'structure', 'Etsy-Tags enthalten Duplikate.',
        { field: 'tags', action: 'remove', suggestion: 'Ersetze doppelte Tags durch neue Suchbegriffe — jede Tag-Position zählt für das Ranking.' });
    }
    if (overlong > 0) {
      return issue(false, 'structure', `${overlong} Tag(s) länger als 20 Zeichen.`,
        { field: 'tags', action: 'shorten', suggestion: 'Kürze alle Tags auf maximal 20 Zeichen, sonst vergibt Etsy die Tag-Position nicht.' });
    }
    return issue(true, 'structure', `Alle ${count} Tags gefüllt, ≤ 20 Zeichen, keine Duplikate.`, { field: 'tags', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const fk = ctx.result.metadata?.focusKeywords;
    const count = Array.isArray(fk) ? fk.length : 0;
    if (count < 5) {
      return issue(false, 'keywords', `Nur ${count} Fokus-Keywords gefunden (Ziel: 6–10).`,
        { field: 'keywords', action: 'add', suggestion: `Ergänze 6–10 Fokus-Keywords mit hoher Kaufintention (aktuell ${count}).` }, count < 3 ? 'critical' : 'warning');
    }
    return issue(true, 'keywords', `${count} Fokus-Keywords (Ziel 6–10).`, { field: 'keywords', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const lt = ctx.result.metadata?.longtailKeywords ?? ctx.numbered.get(6)?.content ?? '';
    const count = Array.isArray(lt) ? lt.length : 0;
    if (Array.isArray(lt) && count < 8) {
      return issue(false, 'keywords', `Nur ${count} Longtail-Keywords (Ziel: 10–15).`,
        { field: 'longtailKeywords', action: 'add', suggestion: `Ergänze 10–15 Longtail-Phrasen mit klarer Kaufabsicht (aktuell ${count}), z. B. „handgemachte Keramiktasse für Kaffeeliebhaber Geschenk".` }, count < 4 ? 'critical' : 'warning');
    }
    if (!Array.isArray(lt)) {
      // fall back to raw text length check when metadata is missing
      const len = charCount(String(lt));
      if (len < 60) {
        return issue(false, 'keywords', 'Longtail-Keywords fehlen oder sind zu kurz.',
          { field: 'longtailKeywords', action: 'add', suggestion: 'Ergänze 10–15 Longtail-Phrasen mit klarer Kaufabsicht (3–6 Wörter).' });
      }
    }
    return issue(true, 'keywords', 'Longtail-Keywords vorhanden.', { field: 'longtailKeywords', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const desc = blockByHeading(ctx.blocks, ['Vollständige Etsy-Beschreibung', 'Etsy-Beschreibung']);
    const len = desc ? charCount(desc.content) : 0;
    if (!desc || len < 200) {
      return issue(false, 'length', `Die Etsy-Beschreibung ist zu kurz (${len} Zeichen, Ziel: ≥ 500).`,
        { field: 'description', action: 'expand', suggestion: `Erweitere die Etsy-Beschreibung auf mindestens 500 Zeichen (aktuell ${len}). Baue die Abschnitte „Das Besondere", „Auf einen Blick", „Perfekt für dich", „Geschenkidee" und CTA aus.` }, len < 100 ? 'critical' : 'warning');
    }
    if (len < 500) {
      return issue(false, 'length', `Die Etsy-Beschreibung hat ${len} Zeichen (Ziel: ≥ 500).`,
        { field: 'description', action: 'expand', suggestion: `Erweitere die Beschreibung auf ≥ 500 Zeichen (aktuell ${len}): mehr Details zu Material, Pflege, Einsatzbereichen.` });
    }
    return issue(true, 'length', `Etsy-Beschreibung: ${len} Zeichen (Ziel ≥ 500).`, { field: 'description', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const cta = blockByHeading(ctx.blocks, ['Jetzt gehört es dir', 'Jetzt gehört es Dir']);
    if (!cta || charCount(cta.content) < 20) {
      return issue(false, 'cta', 'Der persönliche CTA-Abschnitt fehlt.',
        { field: 'cta', action: 'add', suggestion: 'Ergänze einen freundlichen, direkten CTA mit Vorfreude auf die Lieferung (z. B. „Ich packe jedes Stück persönlich ein — in 3–5 Tagen hältst du es in den Händen.").' }, 'critical');
    }
    return issue(true, 'cta', 'Persönlicher CTA vorhanden.', { field: 'cta', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const faq = blockByHeading(ctx.blocks, ['FAQ']);
    const questions = faq ? countLines(faq.content, /\?/) : 0;
    if (!faq || questions < 3) {
      return issue(false, 'structure', `FAQ fehlt oder hat nur ${questions} Frage(n) (Ziel: 5).`,
        { field: 'faq', action: 'add', suggestion: `Ergänze 5 häufige Käuferfragen (Pflege, Größe, Material, Lieferung, Rückgabe) mit ausführlichen Antworten — aktuell ${questions} Frage(n) gefunden.` });
    }
    return issue(true, 'structure', `FAQ mit ${questions} Fragen vorhanden.`, { field: 'faq', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const fn = ctx.numbered.get(14)?.content ?? '';
    const alt = ctx.result.metadata?.altText ? String(ctx.result.metadata.altText) : '';
    if (!fn || !fn.trim().toLowerCase().endsWith('.jpg')) {
      return issue(false, 'image', 'Kein suchmaschinenfreundlicher Dateiname (Endung .jpg) vorhanden.',
        { field: 'imageFilename', action: 'add', suggestion: 'Benenne das Produktbild suchmaschinenfreundlich: kleingeschrieben, Bindestriche, 3–4 Hauptkeywords, Endung .jpg.' });
    }
    const altLen = charCount(alt);
    if (altLen < 60 || altLen > 150) {
      return issue(false, 'image', `SEO-Alt-Text hat ${altLen} Zeichen (Ziel: 90–130).`,
        { field: 'altText', action: 'rewrite', suggestion: `Passe den Alt-Text auf 90–130 Zeichen an (aktuell ${altLen}) — Farbe, Material, Stil und Nutzungskontext in einem Satz.` });
    }
    return issue(true, 'image', 'Dateiname (.jpg) und Alt-Text passen.', { field: 'imageFilename', action: 'keep', suggestion: '' });
  },
];

// ── SEO Blog ──────────────────────────────────────────────────────────────────

const blogRules: RuleCheck[] = [
  (ctx) => {
    const words = wordCount(ctx.result.body);
    if (words < 800) {
      return issue(false, 'length', `Der Blogartikel hat nur ${words} Wörter (Ziel: 1.500–2.500).`,
        { field: 'body', action: 'expand', suggestion: `Erweitere den Artikel auf 1.500–2.500 Wörter (aktuell ${words}). Vertiefe jede H2 mit Praxis-Tipps, Beispielen und LSI-Keywords.` }, 'critical');
    }
    if (words < 1500 || words > 3000) {
      return issue(false, 'length', `Der Blogartikel hat ${words} Wörter (Ziel: 1.500–2.500).`,
        { field: 'body', action: words < 1500 ? 'expand' : 'shorten', suggestion: words < 1500
          ? `Baue den Artikel auf mindestens 1.500 Wörter aus (aktuell ${words}).`
          : `Kürze den Artikel auf höchstens 2.500 Wörter (aktuell ${words}) — entferne Füllabsätze ohne Mehrwert.` });
    }
    return issue(true, 'length', `${words} Wörter (Ziel 1.500–2.500).`, { field: 'body', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const title = ctx.result.title;
    const len = charCount(title);
    if (len > 60) {
      return issue(false, 'title', `Der H1/SEO-Titel ist mit ${len} Zeichen zu lang (Limit: 60).`,
        { field: 'title', action: 'shorten', suggestion: `Kürze den SEO-Titel (H1) auf maximal 60 Zeichen (aktuell ${len}), startend mit dem Fokus-Keyword.` }, len > 90 ? 'critical' : 'warning');
    }
    return issue(true, 'title', `H1-Titel: ${len} Zeichen (Limit 60).`, { field: 'title', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const meta = ctx.result.metadata?.metaDescription ? String(ctx.result.metadata.metaDescription) : '';
    const len = charCount(meta);
    if (!meta) {
      return issue(false, 'title', 'Die Meta-Beschreibung fehlt.',
        { field: 'metaDescription', action: 'add', suggestion: 'Schreibe eine Meta-Beschreibung mit maximal 160 Zeichen: Mini-Hook, Fokus-Keyword im ersten Satz, Nutzenversprechen am Ende.' }, 'critical');
    }
    if (len > 160) {
      return issue(false, 'title', `Die Meta-Beschreibung hat ${len} Zeichen (Limit: 160).`,
        { field: 'metaDescription', action: 'shorten', suggestion: `Kürze die Meta-Beschreibung auf maximal 160 Zeichen (aktuell ${len}), sonst wird sie in den Suchergebnissen abgeschnitten.` }, len > 200 ? 'critical' : 'warning');
    }
    return issue(true, 'title', `Meta-Beschreibung: ${len} Zeichen (Limit 160).`, { field: 'metaDescription', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const kw = ctx.result.metadata?.focusKeyword ? String(ctx.result.metadata.focusKeyword) : '';
    if (!kw) {
      return issue(false, 'keywords', 'Kein Fokus-Keyword definiert.',
        { field: 'focusKeyword', action: 'add', suggestion: 'Definiere EIN primäres Fokus-Keyword mit nachweislichem Suchvolumen und klarer Suchintention.' }, 'critical');
    }
    const inTitle = lower(ctx.result.title).includes(lower(kw));
    const inBody = (ctx.result.body.toLowerCase().match(new RegExp(escapeRegExp(lower(kw)), 'g')) ?? []).length;
    if (!inTitle) {
      return issue(false, 'keywords', 'Das Fokus-Keyword fehlt im H1-Titel.',
        { field: 'title', action: 'insert_keyword', suggestion: `Setze das Fokus-Keyword „${kw}" an den Anfang des SEO-Titels (H1).` });
    }
    if (inBody < 4) {
      return issue(false, 'keywords', `Fokus-Keyword nur ${inBody}× im Fließtext (Ziel: 4–6×).`,
        { field: 'body', action: 'insert_keyword', suggestion: `Verteile das Fokus-Keyword „${kw}" natürlich 4–6× im Fließtext (aktuell ${inBody}×) — auch in mindestens einer H2.` });
    }
    return issue(true, 'keywords', `Fokus-Keyword im H1 und ${inBody}× im Text.`, { field: 'focusKeyword', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const headings = countLines(ctx.result.body, /^\s*(#{2,3}\s|\*\*[^*\n]+\*\*\s*$|\d{1,2}[.)]\s+\S)/m);
    if (headings < 4) {
      return issue(false, 'structure', `Nur ${headings} Überschriften/Strukturelemente gefunden (Ziel: ≥ 4 H2/H3).`,
        { field: 'structure', action: 'add', suggestion: `Baue 4–6 H2-Überschriften ein, die Neugier erzeugen (aktuell ${headings} gefunden), mit H3-Unterüberschriften wo sinnvoll.` }, headings < 2 ? 'critical' : 'warning');
    }
    return issue(true, 'structure', `${headings} Überschriften/Strukturelemente.`, { field: 'structure', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const faq = blockByHeading(ctx.blocks, ['FAQ']);
    const questions = faq ? countLines(faq.content, /\?/) : 0;
    if (!faq || questions < 3) {
      return issue(false, 'structure', `FAQ fehlt oder hat nur ${questions} Frage(n) (Ziel: 5–7).`,
        { field: 'faq', action: 'add', suggestion: `Ergänze 5–7 echte „People Also Ask"-Fragen mit ausführlichen Antworten (aktuell ${questions} Frage(n)).` });
    }
    return issue(true, 'structure', `FAQ mit ${questions} Fragen vorhanden.`, { field: 'faq', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const cta = blockByHeading(ctx.blocks, ['Call-to-Action', 'Call to Action', 'CTA']);
    const len = cta ? charCount(cta.content) : 0;
    if (!cta || len < 30) {
      return issue(false, 'cta', 'Der Call-to-Action fehlt.',
        { field: 'cta', action: 'add', suggestion: 'Schließe mit einem natürlichen CTA ab: Zusammenfassung des Mehrwerts → Brücke zum Angebot → klare Handlung (3–4 Sätze).' }, 'critical');
    }
    return issue(true, 'cta', 'CTA-Abschnitt vorhanden.', { field: 'cta', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const slug = ctx.result.metadata?.slug ? String(ctx.result.metadata.slug) : '';
    if (!slug || !slug.startsWith('/')) {
      return issue(false, 'structure', 'Der URL-Slug fehlt oder ist ungültig.',
        { field: 'slug', action: 'add', suggestion: 'Erstelle einen kurzen URL-Slug mit dem Fokus-Keyword, ohne Sonderzeichen (z. B. /trauerkarten-gestalten-persoenlich).' });
    }
    return issue(true, 'structure', `URL-Slug vorhanden (${slug}).`, { field: 'slug', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const lsi = ctx.result.metadata?.lsiKeywords;
    const count = Array.isArray(lsi) ? lsi.length : 0;
    if (count < 8) {
      return issue(false, 'keywords', `Nur ${count} LSI-Keywords (Ziel: 12–18).`,
        { field: 'lsiKeywords', action: 'add', suggestion: `Ergänze 12–18 semantisch verwandte Keywords (aktuell ${count}) und streue sie natürlich in den Text.` });
    }
    return issue(true, 'keywords', `${count} LSI-Keywords.`, { field: 'lsiKeywords', action: 'keep', suggestion: '' });
  },
];

// ── Social posts ──────────────────────────────────────────────────────────────

const SOCIAL_CTA_RE = /(folgen|kommentier|sag\s+mir|schreib\s+in|frag\s+mich|link\s+in\s+der\s+bio|hier\s+(klicken|entlang)|speichern|probier|check\s+(es|den)|teilen|markier|retten|meinung|euch\b|kommentar|diskutier|was\s+ist\s+euer|deine\s+lieblings|dein\s+liebstes)/i;

const socialRules: RuleCheck[] = [
  (ctx) => {
    const platforms = ['instagram', 'facebook', 'tiktok'].filter((p) =>
      ctx.blocks.some((b) => lower(b.heading).includes(p)),
    );
    const missing = ['Instagram', 'Facebook', 'TikTok'].filter((p) => !platforms.some((f) => lower(p).includes(f)));
    if (missing.length > 0) {
      return issue(false, 'structure', `Plattform-Variante fehlt: ${missing.join(', ')}.`,
        { field: 'body', action: 'add', suggestion: `Ergänze die fehlende Plattform-Variante (${missing.join(', ')}) mit eigener Caption, Hashtags und Ton.` }, 'critical');
    }
    return issue(true, 'structure', 'Instagram, Facebook und TikTok vorhanden.', { field: 'body', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const ig = ctx.blocks.find((b) => lower(b.heading).includes('instagram'));
    const len = ig ? charCount(ig.content) : 0;
    if (!ig || len < 50) {
      return issue(false, 'length', 'Instagram-Caption fehlt oder ist zu kurz.',
        { field: 'instagramCaption', action: 'expand', suggestion: 'Schreibe eine Instagram-Caption mit 100–180 Zeichen: visueller Hook, Gefühl statt Feature, max. 2–3 Emojis.' }, 'critical');
    }
    if (len > 400) {
      return issue(false, 'length', `Instagram-Caption ist mit ${len} Zeichen zu lang (Ziel: 100–180).`,
        { field: 'instagramCaption', action: 'shorten', suggestion: `Kürze die Instagram-Caption auf 100–180 Zeichen (aktuell ${len}).` });
    }
    return issue(true, 'length', `Instagram-Caption: ${len} Zeichen (Ziel 100–180).`, { field: 'instagramCaption', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const fb = ctx.blocks.find((b) => lower(b.heading).includes('facebook'));
    const len = fb ? charCount(fb.content) : 0;
    if (!fb || len < 80) {
      return issue(false, 'length', 'Facebook-Beitrag fehlt oder ist zu kurz.',
        { field: 'facebookPost', action: 'expand', suggestion: 'Schreibe einen Facebook-Beitrag mit 150–250 Zeichen: Mini-Geschichte, Community-Frage am Ende, 2–3 Hashtags.' }, 'critical');
    }
    if (len > 500) {
      return issue(false, 'length', `Facebook-Beitrag ist mit ${len} Zeichen zu lang (Ziel: 150–250).`,
        { field: 'facebookPost', action: 'shorten', suggestion: `Kürze den Facebook-Beitrag auf 150–250 Zeichen (aktuell ${len}).` });
    }
    return issue(true, 'length', `Facebook-Beitrag: ${len} Zeichen (Ziel 150–250).`, { field: 'facebookPost', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const tt = ctx.blocks.find((b) => lower(b.heading).includes('tiktok') || lower(b.heading).includes('reels'));
    const len = tt ? charCount(tt.content) : 0;
    if (!tt || len < 20) {
      return issue(false, 'length', 'TikTok/Reels-Caption fehlt oder ist zu kurz.',
        { field: 'tiktokCaption', action: 'expand', suggestion: 'Schreibe eine TikTok/Reels-Caption mit 30–100 Zeichen: Hook in den ersten 3 Wörtern, 3–5 trendige Hashtags.' }, 'critical');
    }
    if (len > 300) {
      return issue(false, 'length', `TikTok/Reels-Caption ist mit ${len} Zeichen zu lang (Ziel: 30–100).`,
        { field: 'tiktokCaption', action: 'shorten', suggestion: `Kürze die TikTok-Caption auf 30–100 Zeichen (aktuell ${len}) — maximaler Punch auf minimalem Raum.` });
    }
    return issue(true, 'length', `TikTok/Reels-Caption: ${len} Zeichen (Ziel 30–100).`, { field: 'tiktokCaption', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const hashtags = (ctx.result.body.match(/#[a-zA-ZäöüÄÖÜ0-9]+/g) ?? []).length;
    if (hashtags < 8) {
      return issue(false, 'keywords', `Nur ${hashtags} Hashtags über alle Plattformen (Ziel: ≥ 8).`,
        { field: 'hashtags', action: 'add', suggestion: `Ergänze Hashtags: Instagram 5–8 (2 große, 3 mittlere, 3 Nische), TikTok 3–5 trendige — aktuell ${hashtags} gefunden.` }, hashtags < 3 ? 'critical' : 'warning');
    }
    return issue(true, 'keywords', `${hashtags} Hashtags über alle Plattformen.`, { field: 'hashtags', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    if (!SOCIAL_CTA_RE.test(ctx.result.body)) {
      return issue(false, 'cta', 'Kein Engagement-CTA (Frage/Aufforderung) in den Captions gefunden.',
        { field: 'captions', action: 'add', suggestion: 'Ergänze mindestens eine Frage oder Aufforderung, die zum Kommentieren animiert (z. B. „Was ist euer liebstes Material — Leinen oder Baumwolle?") und einen klaren Handlungs-CTA.' });
    }
    return issue(true, 'cta', 'Engagement-CTA vorhanden.', { field: 'captions', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const emoji = ctx.blocks.find((b) => lower(b.heading).includes('emoji'));
    if (!emoji || charCount(emoji.content) < 30) {
      return issue(false, 'structure', 'Die Emoji-Strategie fehlt.',
        { field: 'emojiStrategy', action: 'add', suggestion: 'Ergänze einen kurzen Abschnitt „Emoji-Strategie": welche 2–4 Emojis funktionieren für dieses Produkt und warum.' });
    }
    return issue(true, 'structure', 'Emoji-Strategie vorhanden.', { field: 'emojiStrategy', action: 'keep', suggestion: '' });
  },
];

// ── Email newsletter ──────────────────────────────────────────────────────────

const EMAIL_CTA_RE = /(jetzt|sichern|hier|kostenlos|loslegen|entdecken|melde\s+dich|klick|vorbei\s+schauen|mehr\s+erfahren|nur\s+noch)/i;

const emailRules: RuleCheck[] = [
  (ctx) => {
    const subjects = ctx.blocks.filter((b) => /^Betreffzeile/i.test(b.heading));
    if (subjects.length < 2) {
      return issue(false, 'title', `Nur ${subjects.length} Betreffzeile(n) gefunden (Ziel: 3).`,
        { field: 'subjectLines', action: 'add', suggestion: 'Ergänze 3 Betreffzeilen (Neugier, Dringlichkeit/Nutzen, Emotional/Story) — je maximal 50 Zeichen.' }, subjects.length === 0 ? 'critical' : 'warning');
    }
    const tooLong = subjects.filter((s) => {
      // Betreffzeile content is the first non-empty line after the heading
      const line = s.content.split('\n').find((l) => l.trim().length > 0) ?? '';
      return charCount(line.trim()) > 60;
    }).length;
    if (tooLong > 0) {
      return issue(false, 'title', `${tooLong} Betreffzeile(n) länger als 50 Zeichen.`,
        { field: 'subjectLines', action: 'shorten', suggestion: `Kürze alle Betreffzeilen auf maximal 50 Zeichen (aktuell ${tooLong} zu lang) — sie werden sonst auf dem Smartphone abgeschnitten.` });
    }
    return issue(true, 'title', `${subjects.length} Betreffzeilen, alle ≤ 60 Zeichen.`, { field: 'subjectLines', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const hasPreheader = /präheader|preheader|vorschau/i.test(ctx.result.body) && !/präheader\s*$/im.test(ctx.result.body);
    if (!hasPreheader) {
      return issue(false, 'structure', 'Kein Preheader/Vorschau-Text gefunden.',
        { field: 'preheader', action: 'add', suggestion: 'Ergänze einen Preheader (1 Satz neben der Betreffzeile), der die Betreffzeile ergänzt — er entscheidet über die Öffnungsrate.' });
    }
    return issue(true, 'structure', 'Preheader vorhanden.', { field: 'preheader', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    if (!EMAIL_CTA_RE.test(ctx.result.body)) {
      return issue(false, 'cta', 'Kein klarer CTA im Newsletter gefunden.',
        { field: 'cta', action: 'add', suggestion: 'Ergänze EINEN klaren Button-Text mit Versprechen (nicht „Jetzt kaufen", sondern z. B. „Mein neues Lieblingsstück sichern") plus unterstützenden Satz.' }, 'critical');
    }
    return issue(true, 'cta', 'CTA mit konkretem Nutzenversprechen vorhanden.', { field: 'cta', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const len = charCount(ctx.result.body);
    if (len < 300) {
      return issue(false, 'length', `Der Newsletter ist mit ${len} Zeichen sehr kurz (Ziel: ≥ 500).`,
        { field: 'body', action: 'expand', suggestion: `Baue den Newsletter aus: persönliche Eröffnung, Hauptteil mit 3–5 Nutzen-Punkten, Dringlichkeits-Brücke, CTA, P.S. (aktuell ${len} Zeichen).` }, len < 150 ? 'critical' : 'warning');
    }
    if (len < 500) {
      return issue(false, 'length', `Der Newsletter hat ${len} Zeichen (Ziel: ≥ 500).`,
        { field: 'body', action: 'expand', suggestion: `Erweitere den Newsletter auf mindestens 500 Zeichen (aktuell ${len}) — mehr persönlicher Ton, konkretere Punkte.` });
    }
    return issue(true, 'length', `Newsletter: ${len} Zeichen (Ziel ≥ 500).`, { field: 'body', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    if (!/P\.?S\.?/i.test(ctx.result.body)) {
      return issue(false, 'structure', 'Das P.S. fehlt.',
        { field: 'ps', action: 'add', suggestion: 'Ergänze ein P.S. mit einem letzten Impuls — es wird fast immer gelesen und hebt die Conversion.' });
    }
    return issue(true, 'structure', 'P.S. vorhanden.', { field: 'ps', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    if (!/\{Name\}|{Name}|liebe\s+\w+|hallo\s+\w+/i.test(ctx.result.body)) {
      return issue(false, 'relevance', 'Keine persönliche Anrede gefunden.',
        { field: 'greeting', action: 'add', suggestion: 'Verwende eine persönliche Anrede (z. B. „Liebe {Name},") — persönliche E-Mails werden deutlich häufiger geöffnet.' });
    }
    return issue(true, 'relevance', 'Persönliche Anrede vorhanden.', { field: 'greeting', action: 'keep', suggestion: '' });
  },
  (ctx) => {
    const bullets = countLines(ctx.result.body, /^\s*(–|—|-|\*|•)\s+/);
    if (bullets < 2) {
      return issue(false, 'structure', 'Hauptteil hat keine Aufzählungspunkte.',
        { field: 'body', action: 'add', suggestion: 'Formatiere den Hauptteil als 3–5 Aufzählungspunkte, jeder beginnend mit einem emotionalen Nutzen-Versprechen.' });
    }
    return issue(true, 'structure', `${bullets} Aufzählungspunkte im Hauptteil.`, { field: 'body', action: 'keep', suggestion: '' });
  },
];

// ── Registry ──────────────────────────────────────────────────────────────────

const RULES_BY_TYPE: Partial<Record<ContentResult['contentType'], RuleCheck[]>> = {
  pinterest_pin: pinterestRules,
  etsy_listing: etsyRules,
  seo_blog: blogRules,
  social_post: socialRules,
  email_newsletter: emailRules,
};

/** German label per dimension (server-side; UI may re-label via i18n). */
export function dimensionLabel(dim: ScoreDimension): string {
  return DIM_LABEL[dim];
}

/**
 * Run all deterministic checks for a content type. Never throws: malformed
 * output degrades to warnings, and unsupported types return no issues.
 */
export function runRules(result: ContentResult): RuleResults {
  const checks = RULES_BY_TYPE[result.contentType] ?? [];
  if (checks.length === 0) {
    return { outcomes: [], issues: [] };
  }
  const blocks = extractBlocks(result.body);
  const numbered = numberedBlocks(blocks);
  const ctx: RuleContext = { type: result.contentType, blocks, numbered, result };

  const outcomes = checks.map((check) => {
    try {
      return check(ctx);
    } catch (err) {
      console.error('[scoring] rule failed:', result.contentType, err);
      return issue(true, 'structure', 'Prüfung nicht auswertbar (ignoriert).', { field: 'body', action: 'keep', suggestion: '' });
    }
  });

  const issues: ScoreIssue[] = outcomes
    .filter((o) => !o.pass)
    .map((o) => ({
      severity: o.severity,
      category: o.dimension,
      message: o.message,
      fix: o.fix,
    }))
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));

  return { outcomes, issues };
}

/** Rule score (0–100) per dimension: share of passing checks in that dimension. */
export function ruleDimensionScores(outcomes: RuleOutcome[]): Record<ScoreDimension, { score: number; passed: number; total: number }> {
  const byDim = new Map<ScoreDimension, { passed: number; total: number }>();
  for (const o of outcomes) {
    const cur = byDim.get(o.dimension) ?? { passed: 0, total: 0 };
    cur.total += 1;
    if (o.pass) cur.passed += 1;
    byDim.set(o.dimension, cur);
  }
  const result = {} as Record<ScoreDimension, { score: number; passed: number; total: number }>;
  for (const [dim, v] of byDim) {
    result[dim] = { score: Math.round((v.passed / v.total) * 100), passed: v.passed, total: v.total };
  }
  return result;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
