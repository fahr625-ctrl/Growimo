import type { GeneratedImage } from '~/ai/image-providers/types';
import { sanitizeReferenceImageData, MAX_REFERENCE_DATA_URL_LENGTH } from '~/ai/image-providers/reference';

/**
 * Shared prefill bridge between a generated marketing strategy and the
 * existing Image Studio route (/app/image-studio).
 *
 * The strategy result is a single markdown-ish German body rendered as
 * `<pre>`. The image-relevant numbers live inside it:
 *   «8. Bildkonzept»      – full art-director image concept
 *   «9. KI-Bild-Prompt (ENGLISCH)» – one-line, copy-ready AI image prompt
 * Overlay text sits inside section 8 under "(f) Text-Overlay-Vorschlag".
 *
 * We do NOT build a second image pipeline. We only transfer the extracted
 * values to the existing Image Studio, which is told to prefill its prompt /
 * ratio and to surface the values + brand context as visible chips.
 */

export interface StrategyImagePayload {
  /** one-line KI-Bild-Prompt (prefilled into the prompt field). */
  prompt: string;
  /** full Bildkonzept text (section 8). */
  concept: string;
  /** overlay suggestion from section 8(f). */
  overlay: string;
  /** recommended aspect ratio ('2:3' | '4:3' | '1:1' | '16:9'). */
  ratio: GeneratedImage['aspectRatio'];
  /** the asset's content type, e.g. 'pinterest_pin'. */
  contentType: string;
  /** human-readable platform label (resolved here via key below). */
  platform: string;
  /** Stabilisierung Schritt 3 (Punkt 5) — Projektkontext, damit das Studio das
   *  richtige Projekt vorauswählt ('' wenn unbekannt). */
  projectId?: string;
  /** Produktidee des Projekts/Channels — Kontextzeile im Studio-Prompt. */
  productIdea?: string;
  /**
   * Vorhandenes Produktbild als data-URL. Wird — wenn gesetzt — als verbindliche
   * Referenz in den Bild-Edit-Pfad gegeben (Produkt bleibt identisch).
   *
   * WICHTIG (Datenvolumen): data-URLs gehören NICHT dauerhaft in die
   * sessionStorage. `saveStrategyPrefill` verwirft eine zu große Referenz
   * bewusst (dann überlebt wenigstens der Prompt) — der praktische Weg im
   * Studio ist das hochgeladene Produktbild, siehe lib/image-reference.ts.
   */
  referenceImage?: string;
  /** Kompakte Markeninfo-Zeile (Marke/Farben/Tonalität) als Prompt-Kontext. */
  brandInfo?: string;
}

/** sessionStorage key that carries the payload until the studio reads it. */
export const STRATEGY_PREFILL_KEY = 'growimo_strategy_prefill';

/** Field-proven section parser for numbered strategy headings. */
function splitSections(body: string): Map<string, string> {
  const map = new Map<string, string>();
  let currentKey: string | null = null;
  const headingRe = /^\s*(\d+)\.\s+(.+?)\s*$/;
  for (const line of body.split('\n')) {
    const m = line.match(headingRe);
    if (m) {
      currentKey = m[2].trim().toLowerCase();
      map.set(currentKey, '');
    } else if (currentKey) {
      map.set(currentKey, (map.get(currentKey) || '') + line + '\n');
    }
  }
  return map;
}

function firstLineOf(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0] ?? '';
}

/**
 * Ist eine Abschnitts-Überschrift ein Bildprompt?
 *
 * Vorher: `key.startsWith('ki-bild-prompt')` — damit fiel z. B. „12. Pinterest-
 * Bildprompt (ENGLISCH)" (seo_blog) und „20. Pinterest-Bildprompt" (etsy_listing)
 * durch, und der „Bild jetzt erstellen"-Knopf fehlte genau dort, wo ein
 * fertiger Prompt generiert wurde. Jetzt konservativ als Substring über die
 * bekannten Schreibweisen — ohne „Bildkonzept"/„Pin-Beschreibung" zu treffen.
 */
function isPromptHeading(key: string): boolean {
  return /(^|[^a-zäöüß])(ki[- ]?)?bild[- ]?prompt/.test(key) || /image[- ]?prompt/.test(key);
}

/**
 * Wählt die Bildprompt-Sektion. Bevorzugt die ENGLISCHE Variante (auf
 * Bildmodelle optimiert), sonst die erste Treffer-Sektion in Dokumentreihenfolge.
 */
function findPromptSection(sections: Map<string, string>): string | null {
  const hits = [...sections.entries()].filter(([key, value]) => isPromptHeading(key) && value.trim());
  if (hits.length === 0) return null;
  const english = hits.find(([key]) => /englisch|english/.test(key));
  return (english ?? hits[0])[1].trim();
}

/** Bekannte Seitenverhältnis-Schreibweisen → Studio-Format (fail-closed: null). */
const RATIO_MAP: Record<string, GeneratedImage['aspectRatio']> = {
  '2:3': '2:3',
  '9:16': '2:3',
  '1:1': '1:1',
  '4:3': '4:3',
  '3:4': '4:3',
  '16:9': '16:9',
};

/** Erstes explizit genanntes Seitenverhältnis im Text (z. B. „exakt 2:3 vertikal"). */
function findExplicitRatio(text: string): GeneratedImage['aspectRatio'] | null {
  const matches = String(text ?? '').match(/\d{1,2}\s*:\s*\d{1,2}/g);
  if (!matches) return null;
  for (const raw of matches) {
    const normalized = raw.replace(/\s+/g, '');
    if (RATIO_MAP[normalized]) return RATIO_MAP[normalized];
  }
  return null;
}

function findSectionValue(
  sections: Map<string, string>,
  candidates: string[],
): string | null {
  for (const key of sections.keys()) {
    if (candidates.some((c) => key.startsWith(c))) {
      const value = sections.get(key)?.trim();
      if (value) return value;
    }
  }
  return null;
}

function extractOverlay(concept: string): string {
  if (typeof concept !== 'string') return '';
  const idx = concept.indexOf('Text-Overlay-Vorschlag');
  if (idx === -1) return '';
  const rest = concept.slice(idx).split('\n')[0].trim();
  const afterColon = rest.split(':').slice(1).join(':').trim();
  return afterColon.replace(/^„|"|'/, '').replace(/[„"']$/, '');
}

function detectRatio(contentType: string, body: string): GeneratedImage['aspectRatio'] {
  const ct = String(contentType ?? '').toLowerCase();
  if (/etsy/.test(ct)) return '4:3';
  if (/instagram|social/.test(ct)) return '1:1';
  if (/blog|seo/.test(ct)) return '16:9';
  // Pinterest strategies always demand vertical 2:3 — fall back to that.
  return '2:3';
}

/** Content-type → human platform label (kept here so the project page stays thin). */
export function platformLabelFor(contentType: string): string {
  const ct = String(contentType ?? '').toLowerCase();
  if (/pinterest/.test(ct)) return 'Pinterest';
  if (/etsy/.test(ct)) return 'Etsy';
  if (/instagram/.test(ct)) return 'Instagram';
  if (/blog|seo/.test(ct)) return 'Blog';
  if (/email|newsletter/.test(ct)) return 'Newsletter';
  if (/social/.test(ct)) return 'Social Media';
  return String(contentType ?? '');
}

/**
 * Extracts an image-ready payload from a strategy body, or null when the
 * result contains no usable KI-Bild-Prompt.
 *
 * `context` (Stabilisierung Schritt 3, Punkt 5) trägt die Felder nach, die der
 * Strategie-Body selbst nicht kennt: Projekt-ID, Produktidee, vorhandenes
 * Produktbild, Markeninfo. Aufrufer (new-project, Projektseite, Paket-Flow)
 * füllen sie auf, damit das Studio alle fünf Owner-Felder bekommt.
 */
export function extractStrategyImage(
  body: string,
  contentType: string,
  context?: {
    projectId?: string;
    productIdea?: string;
    referenceImage?: string;
    brandInfo?: string;
  },
): StrategyImagePayload | null {
  if (!body) return null;
  const sections = splitSections(body);
  const prompt = findPromptSection(sections) ?? '';
  const promptLine = firstLineOf(prompt);
  if (!promptLine) return null;

  const concept =
    findSectionValue(sections, ['bildkonzept']) ?? '';
  const overlay = concept ? extractOverlay(concept) : '';

  return {
    prompt: promptLine,
    concept: concept || '',
    overlay,
    // Format aus dem Inhalt (Bildkonzept/Prompt nennen „2:3 vertikal" explizit),
    // erst danach die Content-Typ-Heuristik.
    ratio: findExplicitRatio(concept) ?? findExplicitRatio(promptLine) ?? detectRatio(contentType, body),
    contentType,
    platform: platformLabelFor(contentType),
    projectId: context?.projectId ?? '',
    productIdea: context?.productIdea ?? '',
    referenceImage: sanitizeReferenceImageData(context?.referenceImage) ?? '',
    brandInfo: context?.brandInfo ?? '',
  };
}

/** TTL des Strategie-Prefills (Phase 3.3c). */
export const STRATEGY_PREFILL_TTL_MS = 24 * 60 * 60 * 1000;

/** Writes the payload to sessionStorage so the studio can prefill.
 *  Phase 3.3c: zusätzlich `savedAt` (TTL). Alt-Einträge ohne Feld bleiben gültig.
 *  Schritt 3 (Punkt 3/5): eine zu große Bildreferenz wird bewusst NICHT
 *  mitgeschrieben (sessionStorage-Quota) — dann überlebt wenigstens der Prompt. */
export function saveStrategyPrefill(payload: StrategyImagePayload, now: number = Date.now()): void {
  try {
    const reference = sanitizeReferenceImageData(payload.referenceImage);
    const safe: StrategyImagePayload = { ...payload };
    if (reference && reference.length > MAX_REFERENCE_DATA_URL_LENGTH) delete safe.referenceImage;
    sessionStorage.setItem(STRATEGY_PREFILL_KEY, JSON.stringify({ ...safe, savedAt: now }));
  } catch {
    // sessionStorage may be unavailable — prefill simply won't happen.
  }
}

/**
 * Reads the pending strategy prefill — NICHT mehr zerstörend (Phase 3.3c).
 *
 * Vorher wurde der Eintrag beim ersten Lesen gelöscht (Einmal-Prefill). Kam der
 * Nutzer per Browser-„Zurück“, Reload oder Forward erneut auf
 * `/app/image-studio?fromStrategy=1`, war der Prefill verbraucht → leeres
 * Promptfeld ohne Hinweis (Cluster C7). Jetzt bleibt der Eintrag erhalten, bis
 * die nächste Strategie ihn überschreibt (oder die TTL greift).
 * Name bewusst beibehalten: bestehende Aufrufer/Tests nutzen ihn weiter.
 */
export function consumeStrategyPrefill(now: number = Date.now()): StrategyImagePayload | null {
  try {
    const raw = sessionStorage.getItem(STRATEGY_PREFILL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StrategyImagePayload> & { savedAt?: number };
    if (!parsed.prompt) return null;
    if (
      typeof parsed.savedAt === 'number' &&
      Number.isFinite(parsed.savedAt) &&
      now - parsed.savedAt > STRATEGY_PREFILL_TTL_MS
    ) {
      return null;
    }
    const ratio: GeneratedImage['aspectRatio'] = ['2:3', '4:3', '1:1', '16:9'].includes(
      parsed.ratio as string,
    )
      ? (parsed.ratio as GeneratedImage['aspectRatio'])
      : '2:3';
    return {
      prompt: parsed.prompt,
      concept: parsed.concept ?? '',
      overlay: parsed.overlay ?? '',
      ratio,
      contentType: parsed.contentType ?? '',
      platform: parsed.platform ?? 'Pinterest',
      // Schritt 3: neue Kontextfelder fail-closed — falscher Typ oder
      // unbrauchbare Referenz ⇒ leerer String, NIE ein halber Wert.
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : '',
      productIdea: typeof parsed.productIdea === 'string' ? parsed.productIdea : '',
      referenceImage: sanitizeReferenceImageData(parsed.referenceImage) ?? '',
      brandInfo: typeof parsed.brandInfo === 'string' ? parsed.brandInfo : '',
    };
  } catch {
    return null;
  }
}

/** Alias mit ehrlichem Namen: nicht-zerstörendes Lesen (Phase 3.3c). */
export const readStrategyPrefill = consumeStrategyPrefill;

/** Explizites Aufräumen des Prefills (z. B. bewusstes Zurücksetzen). */
export function clearStrategyPrefill(): void {
  try {
    sessionStorage.removeItem(STRATEGY_PREFILL_KEY);
  } catch {
    // sessionStorage may be unavailable
  }
}
