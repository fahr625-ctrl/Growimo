// ── Phase 1 Nachweis: Absage-Gate + Kontingent-Rückgabe + Kacheln ────────────
// Offline: kein Netz, kein KI-Anbieter, keine DB. Der Provider wird injiziert.
// Usage: bun scripts/phase1-gate-test.ts
/* eslint-disable no-console */
import { checkResultQuality, isRefusalText, GenerationQualityError, isQualityError } from '../src/lib/result-quality';
import { STRATEGY_TILE_CONFIG, STRATEGY_LINK_TILES, STRATEGY_TILE_COUNT, STRATEGY_TILE_COUNT_ALL, normalizeStrategySelection } from '../src/ai/strategy-tiles';

let PASS = 0, FAIL = 0;
const bad: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; bad.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

// ── 1. Der echte Fall vom 11.11.2026 (Wortlaut aus der Prod-DB) ──────────────
const ECHTFALL = 'Es tut mir leid, aber ich kann diese Anfrage nicht weiter bearbeiten.';
console.log('\n[1] Verweigerungserkennung — echter Fall 2026-11-11');
ok('Absage wird erkannt', isRefusalText(ECHTFALL));
ok('Absage als Titel erkannt', isRefusalText('Es tut mir leid, aber ich kann diese Anfrage nicht weiter bearbeiten.'));
ok('normales Ergebnis ist keine Absage', !isRefusalText('Pin-Titel: Keramik-Tassen für den Morgen\nBeschreibung: Handgemachte Tassen …'));

// Das gespeicherte Ergebnisobjekt des Echfalls (Titel + Body = Absage).
const echfallResult = { title: ECHTFALL, body: ECHTFALL, metadata: { keywords: [], hashtags: [] } };
const q = checkResultQuality('pinterest_pin', echfallResult);
ok('Echfall-Objekt besteht die Prüfung NICHT', !q.ok, JSON.stringify(q));
ok('Echfall-Klassifikation = refusal', q.code === 'refusal', String(q.code));
ok('Fehler trägt strukturellen Code REFUSAL', new GenerationQualityError('refusal').code === 'REFUSAL');

// ── 2. Strukturprüfung ──────────────────────────────────────────────────────
console.log('\n[2] Strukturprüfung');
const gut = {
  title: 'Keramik-Tassen: 12 Ideen für deinen Etsy-Shop',
  body: 'x'.repeat(400),
  metadata: { keywords: ['keramik tasse', 'handmade'], tags: ['keramiktasse'] },
};
ok('vollständiges Pinterest-Ergebnis besteht', checkResultQuality('pinterest_pin', gut).ok);
ok('vollständiges Etsy-Ergebnis besteht', checkResultQuality('etsy_listing', gut).ok);
ok('leerer Body = unvollständig', checkResultQuality('pinterest_pin', { ...gut, body: '' }).code === 'incomplete');
ok('Parser-Fallback-Titel „Pin-Titel" = unvollständig', checkResultQuality('pinterest_pin', { ...gut, title: 'Pin-Titel' }).violations.includes('fallback_title'));
ok('ohne Keywords = unvollständig', checkResultQuality('pinterest_pin', { ...gut, metadata: { keywords: [] } }).violations.includes('missing_keywords'));
ok('ohne Tags = unvollständig', checkResultQuality('etsy_listing', { ...gut, metadata: { tags: [] } }).violations.includes('missing_tags'));
ok('abgeschriebener Prompt = unvollständig', checkResultQuality('pinterest_pin', { ...gut, body: '[1 Satz] '.repeat(4) + 'x'.repeat(400) }).violations.includes('template_echo'));

// ── 3. Gate + 1 Wiederholung + Kontingent-Rückgabe (Mechanik) ───────────────
// Bildet `runProviderGated` + `withGenerationGuard` nach: der Guard reserviert
// VOR dem Call (+1), kompensiert bei Fehler (−1) — Endstand 0.
console.log('\n[3] Gate → 1 Wiederholung → Fehler → Kontingent zurück');
let counter = 0;
let calls = 0;
async function runProviderGatedFake(outputs: Array<{ title: string; body: string; metadata?: Record<string, unknown> }>) {
  const first = outputs[calls++]!;
  const firstCheck = checkResultQuality('pinterest_pin', first);
  if (firstCheck.ok) return first;
  const retry = outputs[calls++]!;
  const retryCheck = checkResultQuality('pinterest_pin', retry);
  if (retryCheck.ok) return retry;
  throw new GenerationQualityError(retryCheck.code ?? 'incomplete', retryCheck.violations);
}
async function withGuard<T>(fn: () => Promise<T>): Promise<T> {
  counter += 1;                       // Reservierung VOR dem Call
  try { return await fn(); }
  catch (e) { counter -= 1; throw e; } // Kompensation bei Fehler
}

// Fall A: Absage, dann brauchbares Ergebnis ⇒ 2 Aufrufe, 1 Einheit verbraucht.
calls = 0; counter = 0;
const a = await withGuard(() => runProviderGatedFake([echfallResult, gut]));
ok('A: Wiederholung liefert brauchbares Ergebnis', checkResultQuality('pinterest_pin', a).ok);
ok('A: genau 2 Provider-Aufrufe', calls === 2, String(calls));
ok('A: 1 Einheit verbraucht (Erfolg)', counter === 1, String(counter));

// Fall B: Absage, dann wieder Absage ⇒ Fehler, 2 Aufrufe, 0 Einheiten.
calls = 0; counter = 0;
let threw: unknown = null;
try { await withGuard(() => runProviderGatedFake([echfallResult, echfallResult])); }
catch (e) { threw = e; }
ok('B: Fehler nach zweiter Absage', isQualityError(threw));
ok('B: genau 2 Provider-Aufrufe', calls === 2, String(calls));
ok('B: Kontingent zurückgegeben (0 verbraucht)', counter === 0, String(counter));
ok('B: Code REFUSAL im Fehler', (threw as GenerationQualityError).code === 'REFUSAL');

// ── 4. Drei Kacheln ─────────────────────────────────────────────────────────
console.log('\n[4] Drei Kacheln');
ok('genau 2 generierende Kacheln', STRATEGY_TILE_COUNT === 2, String(STRATEGY_TILE_COUNT));
ok('genau 3 sichtbare Kacheln', STRATEGY_TILE_COUNT_ALL === 3, String(STRATEGY_TILE_COUNT_ALL));
ok('Pinterest + Etsy generierbar', STRATEGY_TILE_CONFIG.map((t) => t.key).join(',') === 'pinterest,etsy');
ok('TikTok führt ins bestehende Modul', STRATEGY_LINK_TILES.length === 1 && STRATEGY_LINK_TILES[0]!.href === '/app/tiktok');
ok('alte Typen sind nicht mehr wählbar', normalizeStrategySelection(['social_post', 'marketing_plan', 'pinterest_pin']).join(',') === 'pinterest_pin');
ok('die alten Typen bleiben in der Registry', (await import('../src/ai/content-types')).CONTENT_TYPE_REGISTRY.length === 10);

console.log(`\n${PASS} PASS / ${FAIL} FAIL`);
if (FAIL > 0) { console.log('Fehlgeschlagen:\n - ' + bad.join('\n - ')); process.exit(1); }
