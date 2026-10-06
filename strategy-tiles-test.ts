// ─────────────────────────────────────────────────────────────────────────────
// strategy-tiles-test.ts — Kachel-Vereinfachung „Neue Strategie"
// (Owner-Direktion 2026-10-05)
// ─────────────────────────────────────────────────────────────────────────────
// Rein quelltext- und funktionsbasiert (keine DB, kein Netz).
// Aufruf aus der Repo-Wurzel:  bun strategy-tiles-test.ts
// Exit 0 nur, wenn alle Checks grün sind.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'fs';
import {
  STRATEGY_TILE_CONFIG,
  STRATEGY_TILE_CONTENT_TYPES,
  STRATEGY_TILE_COUNT,
  STRATEGY_TILES_MARKER,
  isStrategySelectableContentType,
  isStrategyTileSelected,
  normalizeStrategySelection,
  selectAllStrategyContentTypes,
  selectedStrategyTileCount,
  strategyResultCount,
  strategyTileResultCount,
  toggleStrategyTile,
} from './src/ai/strategy-tiles';
import { CONTENT_TYPE_REGISTRY } from './src/ai/content-types';
import type { ContentType } from './src/ai/types';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';

let passed = 0;
let failed = 0;
const failures: string[] = [];
const check = (label: string, cond: boolean, detail = '') => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('\n[1] Genau 6 Kacheln in der Owner-Reihenfolge');
check('6 Kacheln', STRATEGY_TILE_CONFIG.length === 6, String(STRATEGY_TILE_CONFIG.length));
check(
  'Reihenfolge = Pinterest, Etsy, Social Media, Marketing-Strategie, Content, Produktideen',
  STRATEGY_TILE_CONFIG.map((t) => t.key).join(',') ===
    'pinterest,etsy,social,marketing,content,ideas',
  STRATEGY_TILE_CONFIG.map((t) => t.key).join(','),
);
check('STRATEGY_TILE_COUNT = 6', STRATEGY_TILE_COUNT === 6);
check(
  'Alle Kacheln haben Icon, Label-Key und Beschreibungs-Key',
  STRATEGY_TILE_CONFIG.every((t) => !!t.icon && !!t.labelKey && !!t.descKey),
);

console.log('\n[2] Mapping Kachel → echte ContentTypes (Kosten = Anzahl Typen)');
const expect: Record<string, ContentType[]> = {
  pinterest: ['pinterest_pin'],
  etsy: ['etsy_listing'],
  social: ['social_post'],
  marketing: ['marketing_plan'],
  content: ['seo_blog', 'email_newsletter'],
  ideas: ['product_idea'],
};
for (const tile of STRATEGY_TILE_CONFIG) {
  check(
    `${tile.key} → [${expect[tile.key].join(', ')}]`,
    tile.contentTypes.join(',') === expect[tile.key].join(','),
    tile.contentTypes.join(','),
  );
}
check(
  'Marketing-Strategie enthält NICHT marketing_analysis/market_intelligence',
  !STRATEGY_TILE_CONFIG.find((t) => t.key === 'marketing')!.contentTypes.some(
    (ct) => ct === 'marketing_analysis' || ct === 'market_intelligence',
  ),
);
check(
  'Content-Kachel = 2 Ergebnisse (SEO-Blog + Newsletter)',
  strategyTileResultCount(STRATEGY_TILE_CONFIG.find((t) => t.key === 'content')!) === 2,
);
check(
  '5 Kacheln = 1 Ergebnis, 1 Kachel = 2 Ergebnisse → 7 Einheiten bei „Alle auswählen"',
  STRATEGY_TILE_CONFIG.filter((t) => strategyTileResultCount(t) === 1).length === 5 &&
    selectAllStrategyContentTypes().length === 7,
);

console.log('\n[3] Auswahl-Semantik (selectedTypes bleibt contentTypes-Array)');
const contentTile = STRATEGY_TILE_CONFIG.find((t) => t.key === 'content')!;
const pinterestTile = STRATEGY_TILE_CONFIG.find((t) => t.key === 'pinterest')!;
const marketingTile = STRATEGY_TILE_CONFIG.find((t) => t.key === 'marketing')!;
let sel: ContentType[] = [];
sel = toggleStrategyTile(sel, contentTile);
check(
  'Klick auf „Content" toggelt SEO-Blog UND Newsletter',
  sel.join(',') === 'seo_blog,email_newsletter',
  sel.join(','),
);
check('Zähler: 1 Kachel ausgewählt, 2 Ergebnisse', selectedStrategyTileCount(sel) === 1 && strategyResultCount(sel) === 2);
check('Content-Kachel gilt als ausgewählt', isStrategyTileSelected(contentTile, sel));
sel = toggleStrategyTile(sel, contentTile);
check('Zweiter Klick auf „Content" deselektiert beide', sel.length === 0, sel.join(','));
sel = toggleStrategyTile(sel, pinterestTile);
sel = toggleStrategyTile(sel, marketingTile);
check(
  'Kanonische Reihenfolge unabhängig von Klick-Reihenfolge',
  sel.join(',') === 'pinterest_pin,marketing_plan',
  sel.join(','),
);
sel = selectAllStrategyContentTypes();
check('„Alle auswählen" = 7 Einheiten (6 Kacheln)', selectedStrategyTileCount(sel) === 6 && strategyResultCount(sel) === 7);
check(
  '„Alle auswählen" enthält keine nicht wählbaren Typen',
  !sel.includes('trend_insight' as ContentType) &&
    !sel.includes('marketing_analysis' as ContentType) &&
    !sel.includes('market_intelligence' as ContentType),
);

console.log('\n[4] Kanonisierung alter Entwürfe (kein unsichtbarer Zusatzverbrauch)');
check(
  'Legacy-Typen ohne Kachel werden entfernt, Duplikate dedupliziert',
  normalizeStrategySelection([
    'trend_insight',
    'pinterest_pin',
    'marketing_analysis',
    'pinterest_pin',
    'market_intelligence',
  ]).join(',') === 'pinterest_pin',
);
check('Nicht-Array → leere Auswahl', normalizeStrategySelection(null).length === 0 && normalizeStrategySelection('x').length === 0);
check(
  'Nur-Wähler-Erkennung',
  isStrategySelectableContentType('seo_blog') &&
    isStrategySelectableContentType('email_newsletter') &&
    !isStrategySelectableContentType('trend_insight') &&
    !isStrategySelectableContentType('marketing_analysis') &&
    !isStrategySelectableContentType('market_intelligence'),
);

console.log('\n[5] Registry-Integrität: nichts gelöscht, nichts doppelt');
check('CONTENT_TYPE_REGISTRY weiterhin 10 Typen', CONTENT_TYPE_REGISTRY.length === 10, String(CONTENT_TYPE_REGISTRY.length));
for (const required of ['trend_insight', 'marketing_analysis', 'market_intelligence'] as ContentType[]) {
  check(`Registry enthält weiterhin ${required} (interne Nutzung/Anzeige)`, CONTENT_TYPE_REGISTRY.some((c) => c.type === required));
}
check(
  'Jeder Kachel-Typ existiert in der Registry',
  STRATEGY_TILE_CONTENT_TYPES.every((ct) => CONTENT_TYPE_REGISTRY.some((c) => c.type === ct)),
);
check(
  'Kein Typ liegt in zwei Kacheln',
  new Set(STRATEGY_TILE_CONTENT_TYPES).size === STRATEGY_TILE_CONTENT_TYPES.length,
);

console.log('\n[6] i18n de/en: Kachel-Texte + Parität');
const dicts = { de, en } as const;
for (const [locale, dict] of Object.entries(dicts)) {
  for (const tile of STRATEGY_TILE_CONFIG) {
    const label = (dict as Record<string, unknown>)[tile.labelKey as string];
    const desc = (dict as Record<string, unknown>)[tile.descKey as string];
    check(`${locale}: ${String(tile.labelKey)} vorhanden`, typeof label === 'string' && label.length > 0, String(label));
    check(`${locale}: ${String(tile.descKey)} vorhanden`, typeof desc === 'string' && desc.length > 0, String(desc));
  }
}
for (const key of [
  'strategy_tiles_selected',
  'strategy_results_singular',
  'strategy_results_plural',
  'strategy_cta_results_singular',
  'strategy_cta_results_plural',
]) {
  const deV = (de as Record<string, unknown>)[key];
  const enV = (en as Record<string, unknown>)[key];
  check(`de+en: ${key}`, typeof deV === 'string' && typeof enV === 'string');
  check(
    `${key}: Platzhalter-Anzahl de/en identisch`,
    (String(deV).match(/%d/g) ?? []).length === (String(enV).match(/%d/g) ?? []).length,
  );
}
check(
  'Owner-Kachelnamen (de) wörtlich gepflegt',
  de.strategy_tile_pinterest === 'Pinterest' &&
    de.strategy_tile_etsy === 'Etsy' &&
    de.strategy_tile_social === 'Social Media' &&
    de.strategy_tile_marketing === 'Marketing-Strategie' &&
    de.strategy_tile_content === 'Content' &&
    de.strategy_tile_ideas === 'Produktideen',
);

console.log('\n[7] new-project.tsx rendert die Kacheln (keine verwaisten Alt-Kacheln)');
const np = readFileSync('src/routes/app/new-project.tsx', 'utf8');
check('Render nutzt STRATEGY_TILE_CONFIG', np.includes('{STRATEGY_TILE_CONFIG.map((tile) => {'));
check('Render nutzt NICHT mehr CONTENT_TYPE_REGISTRY als Kachel-Quelle', !np.includes('{CONTENT_TYPE_REGISTRY.map('));
check('Bundle-Marker am Grid gesetzt', np.includes('data-strategy-tiles={STRATEGY_TILES_MARKER}'));
check('Marker-Konstante stabil', STRATEGY_TILES_MARKER === 'growimo-strategy-tiles-v1');
check('Klick-Handler ruft toggleTile (Kachel-Toggle)', np.includes('onClick={() => toggleTile(tile)}'));
check('Content-Kachel-Badge nutzt den Ergebnis-Text', np.includes("t.strategy_results_plural.replace('%d', String(tileResults))"));
check('Draft-Restore kanonisiert alte Auswahlen', np.includes('normalizeStrategySelection(draft.selectedTypes)'));
check('selectAll nutzt die Kachel-Typen', np.includes('setSelectedTypes(selectAllStrategyContentTypes())'));

console.log(`\n=== strategy-tiles-test: ${passed} PASS, ${failed} FAIL ===`);
if (failed > 0) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}
process.exit(0);
