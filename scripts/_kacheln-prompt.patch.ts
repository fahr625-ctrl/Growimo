/**
 * Patch: Prompt-Härtung marketing_plan — interne Markt-/Trend-Perspektive
 * (Owner-Direktion 2026-10-05: Trends/Analyse/Markt sind keine eigenen
 * Auswahlkacheln mehr, ihre Perspektive steckt in der passenden Strategie).
 *
 * Rein additiv im bestehenden Abschnitt 2 (USP) — KEINE neue Sektion, damit
 * (a) kein zusätzlicher Token-Verbrauch/Truncation-Risiko für Abschnitt 8
 * entsteht und (b) keine vorhandenen Sektions-Extraktoren brechen.
 *
 * Aufruf: bun scripts/_kacheln-prompt.patch.ts   (aus der Repo-Wurzel)
 */
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/ai/providers/openai.ts';
const ANCHOR = 'spezifische, überprüfbare Unterschiede.';
const ADDITION =
  ' Ergänze danach in 2–3 Sätzen die Markt- und Trend-Einordnung: Wie umkämpft ist dieses Umfeld, welche Nachfrage-Signale sprechen für dieses Produkt, und welche beobachtbaren Trends stützen den Bedarf? Leite das ausschließlich aus den Nutzerangaben und dem bereitgestellten Kontext ab — keine erfundenen Marktzahlen, Studien oder Trend-Prognosen.';

const MARKER = 'Ergänze danach in 2–3 Sätzen die Markt- und Trend-Einordnung';

const src = readFileSync(FILE, 'utf8');
if (src.includes(MARKER)) {
  console.log(`SKIP ${FILE} (already patched)`);
  process.exit(0);
}
const count = src.split(ANCHOR).length - 1;
if (count !== 1) throw new Error(`ANCHOR count ${count} in ${FILE} — erwartet 1`);
writeFileSync(FILE, src.replace(ANCHOR, ANCHOR + ADDITION));
console.log(`PATCHED ${FILE}`);
