/**
 * Phase 4.2 (Stabilisierung) — Kontexttreue ALLER Kanäle.
 *
 * Ursache C1/C2: Die Kanäle (Pinterest/SEO/Etsy/Newsletter/Paket) konnten das
 * Thema des Nutzers verlassen und stattdessen Growimo selbst (die App) zum
 * Inhalt machen — Growimo-Marketing statt Inhalt über das Nutzerthema
 * (Owner-Beschwerde). Phase 1 hat den NUTZER-VORRANG als Prompt-Regel
 * eingeführt (`USER_PRIORITY_CONSTRAINT`), Phase 2 das Selbstreferenz-Verbot im
 * TikTok-Modul. Was fehlte:
 *   1. eine explizite Selbstbezug-Regel für ALLE Kanäle (Prompt-Baustein unten),
 *   2. ein DETERMINISTISCHER Post-Check der Kanal-Ausgaben (Muster
 *      `ai/tiktok.ts` — dort `SELF_REFERENCE_PATTERNS`), der eine unbegründete
 *      Growimo-Selbstthematisierung erkennt und ehrlich ablehnt.
 *
 * Erlaubt ist Growimo als Inhalt NUR, wenn
 *   (a) der Nutzer Growimo in seiner Eingabe (Produktidee) ausdrücklich nennt
 *       ODER
 *   (b) das Markenprofil eindeutig Growimo ist (Markenname „Growimo" ODER
 *       Website growimo.app) — NICHT schon beim bloßen Vorkommen des Wortes
 *       irgendwo im Zusatzkontext (Test A: Profil EIN + Idee „Growimo" bleibt
 *       korrekt, Test B/E: Café/Weihnachts-Pin ohne Profil liefern KEIN
 *       „Growimo").
 *
 * Alle Funktionen hier sind rein (keine Netzwerk-/DB-Zugriffe) und damit ohne
 * API-Aufruf testbar.
 */
import type { ContentRequest } from './types';

/** Markenname der eigenen App. */
export const GROWIMO_BRAND_NAME = 'Growimo';
/** Eigene Domain (eindeutiges Kennzeichen des Growimo-Markenprofils). */
export const GROWIMO_BRAND_SITE = 'growimo.app';

/** Erkennung einer Growimo-Erwähnung in einer Ausgabe (Wort oder Domain). */
const GROWIMO_MENTION_RE = /\bgrowimo(?:\.app)?\b/i;
/** Erkennung einer ausdrücklichen Growimo-Nennung im NUTZERINPUT. */
const GROWIMO_USER_MENTION_RE = /\bgrowimo(?:\.app)?\b/i;
/** Markenname-Zeile des MARKENKONTEXT-Blocks (store/brand.ts). */
const BRAND_NAME_RE = /^-\s*Marke:\s*(.+)$/im;
/** Website-Zeile des MARKENKONTEXT-Blocks. */
const BRAND_SITE_RE = /^-\s*Website:\s*(.+)$/im;

/**
 * Globaler Prompt-Baustein (de+en) für JEDEN Kanal: Growimo ist nur dann
 * Inhalt, wenn der Nutzer es als Thema nennt oder das Profil eindeutig Growimo
 * ist. Wird von `providers/openai.ts#buildSystemPrompt` an jeden System-Prompt
 * angehängt — und läuft damit auch im Paket-Flow und im Strategie-Stream.
 */
export const SELF_REFERENCE_CONSTRAINT = `⚠️ KEIN SELBSTBEZUG AUF GROWIMO (harte Regel): Thema und Inhalt kommen AUSSCHLIESSLICH aus der Nutzereingabe (Produktidee + vom Nutzer gelieferter Kontext). Die App Growimo ist selbst NUR dann Inhalt, wenn (a) der Nutzer Growimo ausdrücklich als Thema nennt ODER (b) das vorliegende Projekt-/Markenprofil eindeutig Growimo ist (Markenname „Growimo" oder Website growimo.app). In JEDEM anderen Fall ist es VERBOTEN, Growimo, seine Funktionen, sein Team, seine Zielgruppe oder sein Marketing zu erwähnen oder das Nutzerthema in Growimo-Marketing umzudeuten — schreibe ausschließlich über das Nutzerthema.
 EN: Mention Growimo (the app) ONLY if the user explicitly names it as the topic, or the project/brand profile is clearly Growimo (brand name "Growimo" or website growimo.app). Otherwise never mention, advertise or pivot to Growimo — write about the user's subject only.`;

/** Korrektur-Hinweis für den EINEN wiederholten Versuch nach einem Verstoß. */
export function contextLoyaltyCorrection(lang: 'de' | 'en' = 'de'): string {
  return lang === 'en'
    ? `⚠️ HARD CORRECTION (previous attempt rejected): The previous output talked about Growimo itself although NOTHING in the user input or the brand profile makes Growimo the topic. Rewrite it completely about the user's subject ("Produktidee") and do NOT mention Growimo, its features, its team or its marketing at all.`
    : `⚠️ HARTE KORREKTUR (der vorherige Versuch wurde verworfen): Die vorherige Ausgabe handelte von Growimo selbst, obwohl weder das Nutzerinput noch das Markenprofil Growimo zum Thema machen. Schreibe vollständig über das Nutzerthema („Produktidee") und erwähne Growimo, seine Funktionen, sein Team und sein Marketing NICHT.`;
}

/**
 * Ehrliche Fehlermeldung, wenn auch der korrigierte Versuch das Nutzerthema
 * durch Growimo-Selbstbezug ersetzt hat: es wird NICHTS still geliefert.
 * Zweisprachig, weil der Server die UI-Sprache nicht kennt (gleiche Konvention
 * wie die übrigen Server-Meldungen).
 */
export const CONTEXT_LOYALTY_ERROR =
  'Die Ausgabe handelte unbegründet von Growimo selbst statt vom Nutzerthema und wurde deshalb verworfen. Bitte nenne das Thema eindeutig in der Produktidee (oder nenne Growimo ausdrücklich als Thema) und starte die Generierung erneut. — EN: The output talked about Growimo itself instead of the user\'s subject and was therefore rejected. Please state the topic clearly in your product idea (or name Growimo explicitly as the topic) and generate again.';

export interface GrowimoContext {
  /** true = Growimo darf Inhalt sein. */
  allowsGrowimo: boolean;
  /** Woher die Erlaubnis kommt (null = Growimo ist verboten). */
  source: 'user' | 'brand' | null;
  /** Markenname aus dem MARKENKONTEXT-Block (falls vorhanden). */
  brandName: string | null;
  /** Website aus dem MARKENKONTEXT-Block (falls vorhanden). */
  website: string | null;
}

/** Nennt der NUTZER Growimo selbst als Thema? (Produktidee, ausdrücklich) */
export function userNamesGrowimo(productIdea: string | undefined | null): boolean {
  if (typeof productIdea !== 'string' || productIdea.trim() === '') return false;
  return GROWIMO_USER_MENTION_RE.test(productIdea);
}

/**
 * Ist das Markenprofil EINDEUTIG Growimo? Bewusst streng: nur die Felder
 * „Marke" (Markenname = Growimo…) und „Website" (growimo.app) des
 * MARKENKONTEXT-Blocks zählen — ein beliebiges Vorkommen des Wortes „Growimo"
 * im restlichen Zusatzkontext (Strategie-Brief, Performance, Präferenzen)
 * gibt KEINE Erlaubnis.
 */
export function brandContextIsGrowimo(brandContext: string | undefined | null): boolean {
  if (typeof brandContext !== 'string' || brandContext.trim() === '') return false;
  const name = BRAND_NAME_RE.exec(brandContext)?.[1]?.trim() ?? '';
  const site = BRAND_SITE_RE.exec(brandContext)?.[1]?.trim() ?? '';
  if (name && /^growimo\b/i.test(name)) return true;
  if (site && site.toLowerCase().includes(GROWIMO_BRAND_SITE)) return true;
  return false;
}

/** Markenname/Website aus dem Markenkontakt lesen (nur für Diagnose/Tests). */
export function readBrandIdentity(
  brandContext: string | undefined | null,
): { brandName: string | null; website: string | null } {
  if (typeof brandContext !== 'string' || brandContext.trim() === '') {
    return { brandName: null, website: null };
  }
  return {
    brandName: BRAND_NAME_RE.exec(brandContext)?.[1]?.trim() || null,
    website: BRAND_SITE_RE.exec(brandContext)?.[1]?.trim() || null,
  };
}

/**
 * Kontext-Modell EINES Requests: Nutzereingabe zuerst, dann Markenprofil.
 * `additionalContext` ist der Zusatzkontext der Kanäle (dort steckt u. a. der
 * MARKENKONTEXT-Block des Markenprofils).
 */
export function resolveGrowimoContext(
  request: Pick<ContentRequest, 'productIdea' | 'additionalContext'>,
): GrowimoContext {
  const identity = readBrandIdentity(request.additionalContext);
  if (userNamesGrowimo(request.productIdea)) {
    return { allowsGrowimo: true, source: 'user', ...identity };
  }
  if (brandContextIsGrowimo(request.additionalContext)) {
    return { allowsGrowimo: true, source: 'brand', ...identity };
  }
  return { allowsGrowimo: false, source: null, ...identity };
}

/**
 * Deterministische Prüfung einer Kanal-Ausgabe (Muster `ai/tiktok.ts`):
 * liefert die Namen aller Verstöße (leer = ok).
 */
export function contextLoyaltyViolations(
  text: string,
  ctx: GrowimoContext,
): string[] {
  if (typeof text !== 'string' || text.trim() === '') return [];
  if (ctx.allowsGrowimo) return [];
  return GROWIMO_MENTION_RE.test(text) ? ['SELF-REF:growimo'] : [];
}

/** Bequemer Kombipfad: Request + Ausgabe → Verstöße. */
export function requestLoyaltyViolations(
  request: Pick<ContentRequest, 'productIdea' | 'additionalContext'>,
  text: string,
): string[] {
  return contextLoyaltyViolations(text, resolveGrowimoContext(request));
}

/**
 * Prüft die fertigen Teile einer Ausgabe (Titel + Body) und liefert die
 * Verstöße in stabiler, deduplizierter Form.
 */
export function resultLoyaltyViolations(
  request: Pick<ContentRequest, 'productIdea' | 'additionalContext'>,
  result: { title?: string; body?: string },
): string[] {
  const blob = `${result.title ?? ''}\n${result.body ?? ''}`;
  return requestLoyaltyViolations(request, blob);
}
