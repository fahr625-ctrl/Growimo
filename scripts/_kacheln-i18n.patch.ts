/**
 * Patch: i18n-Kacheltexte (Owner-Direktion 2026-10-05).
 * Nutzt Datei-Read/Write statt EditFile (argv-Limit bei großen Dateien).
 * Aufruf: bun scripts/_kacheln-i18n.patch.ts  (aus der Repo-Wurzel)
 */
import { readFileSync, writeFileSync } from 'fs';

const DE_ANCHOR = "  strategy_create_btn: '🚀 Strategie erstellen',";
const DE_ADD = `${DE_ANCHOR}
  // ── Kachel-Vereinfachung (Owner-Direktion 2026-10-05) ────────────────────────
  // Sichtbar sind genau 6 Kacheln (src/ai/strategy-tiles.ts). SEO-Blog +
  // E-Mail-Newsletter sind unter „Content" zusammengefasst (2 Ergebnisse).
  strategy_tile_pinterest: 'Pinterest',
  strategy_tile_pinterest_desc: 'Pin-Titel, Beschreibung, Keywords & Bild-Prompt',
  strategy_tile_etsy: 'Etsy',
  strategy_tile_etsy_desc: 'Etsy-Titel, Beschreibung & alle 13 Tags',
  strategy_tile_social: 'Social Media',
  strategy_tile_social_desc: 'Beiträge für Instagram, Facebook & TikTok',
  strategy_tile_marketing: 'Marketing-Strategie',
  strategy_tile_marketing_desc: 'Kompletter Plan: Kanäle, Budget, KPIs, Markt- & Trend-Blick',
  strategy_tile_content: 'Content',
  strategy_tile_content_desc: 'SEO-Blogbeitrag + E-Mail-Newsletter in einem Lauf',
  strategy_tile_ideas: 'Produktideen',
  strategy_tile_ideas_desc: 'Neue Produktideen mit beobachtbarem Trend- und Marktblick',
  strategy_tiles_selected: '%d von %d ausgewählt',
  strategy_results_singular: '%d Ergebnis',
  strategy_results_plural: '%d Ergebnisse',
  strategy_cta_results_singular: 'Erstellt %d Ergebnis in diesem Lauf',
  strategy_cta_results_plural: 'Erstellt %d Ergebnisse in diesem Lauf',`;

const EN_ANCHOR = "  strategy_create_btn: '🚀 Create strategy',";
const EN_ADD = `${EN_ANCHOR}
  // ── Tile simplification (owner direction 2026-10-05) ────────────────────────
  // Exactly 6 tiles are visible (src/ai/strategy-tiles.ts). SEO blog +
  // email newsletter are combined under "Content" (2 results).
  strategy_tile_pinterest: 'Pinterest',
  strategy_tile_pinterest_desc: 'Pin titles, descriptions, keywords & image prompt',
  strategy_tile_etsy: 'Etsy',
  strategy_tile_etsy_desc: 'Etsy title, description & all 13 tags',
  strategy_tile_social: 'Social Media',
  strategy_tile_social_desc: 'Posts for Instagram, Facebook & TikTok',
  strategy_tile_marketing: 'Marketing strategy',
  strategy_tile_marketing_desc: 'Full plan: channels, budget, KPIs, market & trend view',
  strategy_tile_content: 'Content',
  strategy_tile_content_desc: 'SEO blog post + email newsletter in one run',
  strategy_tile_ideas: 'Product ideas',
  strategy_tile_ideas_desc: 'New product ideas with an observable trend and market view',
  strategy_tiles_selected: '%d of %d selected',
  strategy_results_singular: '%d result',
  strategy_results_plural: '%d results',
  strategy_cta_results_singular: 'Creates %d result in this run',
  strategy_cta_results_plural: 'Creates %d results in this run',`;

function patch(path: string, anchor: string, addition: string, marker: string) {
  let src = readFileSync(path, 'utf8');
  if (src.includes(marker)) {
    console.log(`SKIP ${path} (already patched)`);
    return;
  }
  if (!src.includes(anchor)) throw new Error(`ANCHOR NOT FOUND in ${path}`);
  src = src.replace(anchor, addition);
  writeFileSync(path, src);
  console.log(`PATCHED ${path}`);
}

patch('src/i18n/de.ts', DE_ANCHOR, DE_ADD, 'strategy_tile_pinterest:');
patch('src/i18n/en.ts', EN_ANCHOR, EN_ADD, 'strategy_tile_pinterest:');
