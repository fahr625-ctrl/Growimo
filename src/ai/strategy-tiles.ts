import type { ContentType } from './types';
import type { Translations } from '~/i18n';

/**
 * Kachel-Vereinfachung „Neue Strategie" — Owner-Direktion vom 2026-10-05.
 * ==========================================================================
 * Die sichtbare Auswahl im Strategie-Flow besteht aus genau 6 Kacheln. Jede
 * Kachel bündelt einen oder mehrere echte `ContentType`s aus der
 * CONTENT_TYPE_REGISTRY (`src/ai/content-types.ts`) — diese Registry bleibt
 * UNVERÄNDERT: Trends, Analyse und Markt bleiben vollständig im Code
 * (Prompts, DB-Constraint, Dashboard-/Bibliotheks-/Kalender-Lesepfade) und
 * werden nur nicht mehr als eigene Auswahlkachel angeboten.
 *
 * Kosten-Semantik (verbindlich, siehe Businessplan „1 Generierung = 1
 * fertiges Ergebnis"): Jeder generierte ContentType kostet 1 Usage-Einheit
 * (`withGenerationGuard` je Kanal in `src/ai/stream.ts`). Weil die
 * Kachel „Content" zwei Typen bündelt (SEO-Blog + E-Mail-Newsletter), kostet
 * sie 2 Einheiten — das wird in der UI transparent als „2 Ergebnisse"
 * angezeigt. Es wird NICHTS still erzeugt: die Auswahl enthält am Ende exakt
 * die Typen, die generiert, gezählt und gespeichert werden.
 */

/** Einmaliger, stabiler Marker für die Prod-Bundle-Prüfung. */
export const STRATEGY_TILES_MARKER = 'growimo-strategy-tiles-v1';

export type StrategyTileKey =
  | 'pinterest'
  | 'etsy'
  | 'social'
  | 'marketing'
  | 'content'
  | 'ideas';

export interface StrategyTileConfig {
  key: StrategyTileKey;
  /** i18n-Kachelüberschrift (de/en). */
  labelKey: keyof Translations;
  /** i18n-Kurzbeschreibung (de/en). */
  descKey: keyof Translations;
  icon: string;
  /** Die dahinterliegenden echten ContentTypes (Reihenfolge = Generierung). */
  contentTypes: ContentType[];
}

export const STRATEGY_TILE_CONFIG: StrategyTileConfig[] = [
  {
    key: 'pinterest',
    labelKey: 'strategy_tile_pinterest',
    descKey: 'strategy_tile_pinterest_desc',
    icon: '📌',
    contentTypes: ['pinterest_pin'],
  },
  {
    key: 'etsy',
    labelKey: 'strategy_tile_etsy',
    descKey: 'strategy_tile_etsy_desc',
    icon: '🛍️',
    contentTypes: ['etsy_listing'],
  },
  {
    key: 'social',
    labelKey: 'strategy_tile_social',
    descKey: 'strategy_tile_social_desc',
    icon: '📱',
    contentTypes: ['social_post'],
  },
  {
    key: 'marketing',
    labelKey: 'strategy_tile_marketing',
    descKey: 'strategy_tile_marketing_desc',
    icon: '📊',
    contentTypes: ['marketing_plan'],
  },
  {
    // Zusammenfassung: SEO-Blog + E-Mail-Newsletter unter „Content".
    key: 'content',
    labelKey: 'strategy_tile_content',
    descKey: 'strategy_tile_content_desc',
    icon: '📝',
    contentTypes: ['seo_blog', 'email_newsletter'],
  },
  {
    key: 'ideas',
    labelKey: 'strategy_tile_ideas',
    descKey: 'strategy_tile_ideas_desc',
    icon: '💡',
    contentTypes: ['product_idea'],
  },
];

/** Alle ContentTypes, die über die sichtbaren Kacheln wählbar sind. */
export const STRATEGY_TILE_CONTENT_TYPES: ContentType[] = STRATEGY_TILE_CONFIG.flatMap(
  (tile) => tile.contentTypes,
);

/** Anzahl der sichtbaren Kacheln (für die Zähler-Anzeige). */
export const STRATEGY_TILE_COUNT = STRATEGY_TILE_CONFIG.length;

/** Ist dieser ContentType über eine sichtbare Kachel wählbar? */
export function isStrategySelectableContentType(type: string): boolean {
  return STRATEGY_TILE_CONTENT_TYPES.includes(type as ContentType);
}

/**
 * Kanonisiert eine rohe Auswahl auf die wählbaren Typen: entfernt fremde /
 * nicht mehr angebotene Typen (z. B. `trend_insight` aus einem alten Entwurf
 * in localStorage), entfernt Duplikate und ordnet die Typen in
 * Kachel-Reihenfolge. Ergebnis ist immer eine Teilmenge von
 * `STRATEGY_TILE_CONTENT_TYPES`.
 */
export function normalizeStrategySelection(raw: unknown): ContentType[] {
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.filter((v): v is string => typeof v === 'string'));
  return STRATEGY_TILE_CONTENT_TYPES.filter((ct) => wanted.has(ct));
}

/** Alle Typen der 6 Kacheln (für „Alle auswählen"). */
export function selectAllStrategyContentTypes(): ContentType[] {
  return [...STRATEGY_TILE_CONTENT_TYPES];
}

/** Ist eine Kachel vollständig ausgewählt (alle ihre Typen)? */
export function isStrategyTileSelected(
  tile: StrategyTileConfig,
  selected: readonly ContentType[],
): boolean {
  return tile.contentTypes.every((ct) => selected.includes(ct));
}

/**
 * Klick auf eine Kachel: ausgewählt → alle Typen der Kachel entfernen;
 * nicht ausgewählt → alle fehlenden Typen der Kachel ergänzen. Das Ergebnis
 * wird kanonisiert (Kachel-Reihenfolge, keine Duplikate).
 */
export function toggleStrategyTile(
  selected: readonly ContentType[],
  tile: StrategyTileConfig,
): ContentType[] {
  const allOn = isStrategyTileSelected(tile, selected);
  const next = allOn
    ? selected.filter((ct) => !tile.contentTypes.includes(ct))
    : [...selected, ...tile.contentTypes];
  return normalizeStrategySelection(next);
}

/** Anzahl der AKTIVEN Kacheln (nicht: Anzahl der Ergebnisse). */
export function selectedStrategyTileCount(selected: readonly ContentType[]): number {
  return STRATEGY_TILE_CONFIG.filter((tile) => isStrategyTileSelected(tile, selected)).length;
}

/**
 * Anzahl der Ergebnisse = Anzahl der Generierungen = Anzahl der
 * Usage-Einheiten. Identisch zu `selected.length`, hier bewusst benannt,
 * damit UI-Texte und Kosten-Anzeige dieselbe Quelle nutzen.
 */
export function strategyResultCount(selected: readonly ContentType[]): number {
  return selected.length;
}

/** Ergebnisse, die eine einzelne Kachel erzeugt (Transparenz auf der Kachel). */
export function strategyTileResultCount(tile: StrategyTileConfig): number {
  return tile.contentTypes.length;
}
