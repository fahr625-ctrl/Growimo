// Phase 1 i18n-Patch (de+en) — als Skript, weil EditFile an der argv-Grenze scheitert.
import { readFileSync, writeFileSync } from 'node:fs';

const DE_TILES = `  // Phase 1 (Owner-Freigabe 2026-11-11): dritte Kachel fuehrt in das bestehende
  // TikTok-Modul (Skript, kein Video).
  strategy_tile_tiktok: 'TikTok',
  strategy_tile_tiktok_desc: 'Videoskript mit Zeitangaben, Sprechtext & 5 Hashtags',
  strategy_create_btn_pinterest: '📌 Pin erstellen',
  strategy_create_btn_etsy: '🛍️ Listing erstellen',`;

const EN_TILES = `  // Phase 1 (Owner approval 2026-11-11): third tile leads into the existing
  // TikTok module (script, no video).
  strategy_tile_tiktok: 'TikTok',
  strategy_tile_tiktok_desc: 'Video script with timings, spoken text & 5 hashtags',
  strategy_create_btn_pinterest: '📌 Create pin',
  strategy_create_btn_etsy: '🛍️ Create listing',`;

const DE_RESULTS = `  results_incomplete_badge: 'Unvollständig',
  results_quality_failed_title: 'Kein brauchbares Ergebnis',
  results_quality_failed_body:
    'Für diese Kanäle liegt kein verwendbares Ergebnis vor: %s. Es wurde nichts als Erfolg angezeigt und nichts als abgeschlossen gespeichert.',
  results_retry_failed: 'Erneut generieren',`;

const EN_RESULTS = `  results_incomplete_badge: 'Incomplete',
  results_quality_failed_title: 'No usable result',
  results_quality_failed_body:
    'No usable result was produced for these channels: %s. Nothing was shown as successful and nothing was saved as completed.',
  results_retry_failed: 'Generate again',`;

function patch(file: string, tiles: string, results: string): void {
  let src = readFileSync(file, 'utf8');
  const before = src.length;

  const tileAnchor = /^(  strategy_tile_ideas_desc:.*)$/m;
  if (!tileAnchor.test(src)) throw new Error('tile anchor missing in ' + file);
  src = src.replace(tileAnchor, (_m, line: string) => `${line}\n${tiles}`);

  const resultAnchor = /^(  results_generated_badge:.*)$/m;
  if (!resultAnchor.test(src)) throw new Error('results anchor missing in ' + file);
  src = src.replace(resultAnchor, (_m, line: string) => `${line}\n${results}`);

  writeFileSync(file, src);
  console.log(`${file}: ${before} -> ${src.length} Zeichen`);
}

patch('src/i18n/de.ts', DE_TILES, DE_RESULTS);
patch('src/i18n/en.ts', EN_TILES, EN_RESULTS);
