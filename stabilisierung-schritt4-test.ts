// ── Stabilisierung Schritt 4 (Punkt 6) — Unit-Tests ──────────────────────────
// Lauf: bun run stabilisierung-schritt4-test.ts
// Getestet wird der NEUE Baustein (lib/app-context.ts) sowie die additive
// Erweiterung des Strategie-Prefills um die Herkunft ('source'), die den
// kontextabhängigen Rückweg im Bild-Studio trägt.
import {
  APP_CONTEXT_KEY,
  APP_CONTEXT_TTL_MS,
  APP_CONTEXT_VERSION,
  mergeAppContext,
  parseAppContext,
  readContext,
  rememberContext,
  sanitizeAppContext,
  serializeAppContext,
  clearContext,
} from './src/lib/app-context';
import {
  consumeStrategyPrefill,
  extractStrategyImage,
  saveStrategyPrefill,
  STRATEGY_PREFILL_KEY,
} from './src/lib/strategy-image';
import { enrichImagePayload } from './src/components/NextActions';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) { failures++; console.log('FAIL:', name, '—', detail); }
  else console.log('PASS:', name);
}

// sessionStorage-Stub (Node/Bun hat keins) — dasselbe Muster wie Schritt 3.
const store = new Map<string, string>();
(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const NOW = 1_700_000_000_000;

// ── 1. Serialisieren / Parsen (Version, TTL, fail-closed) ────────────────────
const ctx = { projectId: 'p-1', productIdea: 'Handgemachte Kerze', source: 'project' as const, brandEnabled: false };
const raw = serializeAppContext(ctx, NOW);
check('serialize: Version + savedAt gesetzt', JSON.parse(raw).version === APP_CONTEXT_VERSION && JSON.parse(raw).savedAt === NOW);
const parsed = parseAppContext(raw, NOW);
check('parse: Felder bleiben erhalten', parsed?.projectId === 'p-1' && parsed?.productIdea === 'Handgemachte Kerze' && parsed?.source === 'project' && parsed?.brandEnabled === false);
check('parse: brandEnabled=false überlebt (kein falsy-Bug)', parsed?.brandEnabled === false);
check('parse: kaputtes JSON → null (fail-closed)', parseAppContext('{kaputt', NOW) === null);
check('parse: leer → null', parseAppContext(null, NOW) === null);
check('parse: fremde Version → null', parseAppContext(JSON.stringify({ version: 99, projectId: 'p', savedAt: NOW }), NOW) === null);
check('parse: fehlende Version → null', parseAppContext(JSON.stringify({ projectId: 'p', savedAt: NOW }), NOW) === null);
check('parse: fehlendes savedAt → null', parseAppContext(JSON.stringify({ version: APP_CONTEXT_VERSION, projectId: 'p' }), NOW) === null);
check('parse: NaN savedAt → null', parseAppContext(JSON.stringify({ version: APP_CONTEXT_VERSION, projectId: 'p', savedAt: 'x' }), NOW) === null);
check('parse: abgelaufen (25 h) → null', parseAppContext(raw, NOW + APP_CONTEXT_TTL_MS + 1) === null);
check('parse: noch gültig (23 h) → Kontext', parseAppContext(raw, NOW + 23 * 60 * 60 * 1000)?.projectId === 'p-1');
check('parse: gültige Version ohne Inhalt → null', parseAppContext(serializeAppContext({}, NOW), NOW) === null);

// ── 2. Sanitizing (falsche Typen ⇒ Feld weglassen, nie halber Wert) ───────────
const messy = sanitizeAppContext({ projectId: 42, productIdea: 7, source: 'bogus', brandEnabled: 'ja' });
check('sanitize: alle falschen Typen → leeres Objekt', Object.keys(messy).length === 0);
check('sanitize: unbekannte Quelle wird verworfen', sanitizeAppContext({ source: 'marketplace' }).source === undefined);
check('sanitize: bekannte Quelle bleibt', sanitizeAppContext({ source: 'package' }).source === 'package');
check('sanitize: nur Leerzeichen → weggelassen', sanitizeAppContext({ projectId: '   ', productIdea: '\n' }).projectId === undefined);
check('sanitize: Produktidee wird gekappt (280)', (sanitizeAppContext({ productIdea: 'x'.repeat(1000) }).productIdea ?? '').length === 280);
check('sanitize: Array → leeres Objekt', Object.keys(sanitizeAppContext([1, 2, 3])).length === 0);

// ── 3. Merge: nichts wird versehentlich gelöscht ─────────────────────────────
const merged = mergeAppContext({ projectId: 'p-1', productIdea: 'Kerze', source: 'project' }, { productIdea: 'Vase' });
check('merge: neuer Wert gewinnt', merged.productIdea === 'Vase');
check('merge: bestehender Projektbezug bleibt', merged.projectId === 'p-1');
check('merge: Herkunft bleibt, wenn Patch sie nicht nennt', merged.source === 'project');
check('merge: brandEnabled wird gesetzt', mergeAppContext({}, { brandEnabled: false }).brandEnabled === false);
check('merge: vorheriges false wird durch true überschrieben', mergeAppContext({ brandEnabled: false }, { brandEnabled: true }).brandEnabled === true);
check('merge: null-Vorgänger ist ok', mergeAppContext(null, { projectId: 'p' }).projectId === 'p');

// ── 4. Schreiben/Lesen über die sessionStorage ───────────────────────────────
clearContext();
check('readContext: ohne Eintrag → null', readContext(NOW) === null);
rememberContext({ projectId: 'p-1', productIdea: 'Kerze', source: 'project' }, NOW);
rememberContext({ source: 'package' }, NOW + 1000);
const afterTwoWrites = readContext(NOW + 2000);
check('rememberContext: zweiter Aufruf ergänzt statt zu überschreiben',
  afterTwoWrites?.projectId === 'p-1' && afterTwoWrites?.productIdea === 'Kerze' && afterTwoWrites?.source === 'package');
check('rememberContext: Wert steht unter dem neuen Schlüssel', store.has(APP_CONTEXT_KEY));
rememberContext({ projectId: 'p-2' }, NOW + 3000);
check('rememberContext: gezielte Aktualisierung', readContext(NOW + 4000)?.projectId === 'p-2');
store.set(APP_CONTEXT_KEY, 'kein json');
check('readContext: defekter Eintrag → null statt Crash', readContext(NOW) === null);
clearContext();
check('clearContext: entfernt den Eintrag', readContext(NOW) === null);

// ── 5. Prefill-Herkunft (Rückweg im Studio) ──────────────────────────────────
const BODY = ['1. Titel', 'Test', '', '8. Bildkonzept', 'Ruhige Szene, exakt 2:3 vertikal', '', '9. KI-Bild-Prompt (ENGLISCH)', 'A calm product photo of a ceramic vase'].join('\n');
const withSource = extractStrategyImage(BODY, 'pinterest_pin', { projectId: 'p-1', productIdea: 'Kerze', source: 'package' });
check('extractStrategyImage: Herkunft wird übernommen', withSource?.source === 'package');
check('extractStrategyImage: Projekt + Produktidee im Payload', withSource?.projectId === 'p-1' && withSource?.productIdea === 'Kerze');
const bogusSource = extractStrategyImage(BODY, 'pinterest_pin', { source: 'bogus' as never });
check('extractStrategyImage: unbekannte Herkunft → undefined (fail-closed)', bogusSource?.source === undefined);
check('extractStrategyImage: ohne Kontext kein source', extractStrategyImage(BODY, 'pinterest_pin')?.source === undefined);

store.delete(STRATEGY_PREFILL_KEY);
saveStrategyPrefill({ ...(withSource as NonNullable<typeof withSource>) }, NOW);
check('Prefill-Roundtrip: Herkunft bleibt erhalten', consumeStrategyPrefill(NOW)?.source === 'package');
store.set(STRATEGY_PREFILL_KEY, JSON.stringify({ prompt: 'p', source: 42, savedAt: NOW }));
check('Prefill: kaputte Herkunft → undefined (kein Fremdwert)', consumeStrategyPrefill(NOW)?.source === undefined);
store.set(STRATEGY_PREFILL_KEY, JSON.stringify({ prompt: 'p', source: 'marketplace', savedAt: NOW }));
check('Prefill: unbekannte Herkunft → undefined', consumeStrategyPrefill(NOW)?.source === undefined);
store.delete(STRATEGY_PREFILL_KEY);

// ── 6. enrichImagePayload (Kontext-Anreicherung der „Weiter mit …“-Aktion) ────
const base = { prompt: 'EN prompt', concept: '', overlay: '', ratio: '2:3' as const, contentType: 'etsy_listing', platform: 'Etsy' };
const enriched = enrichImagePayload(base, 'p-9', 'Vase');
check('enrich: Projekt-ID aus dem Argument', enriched.projectId === 'p-9');
check('enrich: Produktidee aus dem Argument', enriched.productIdea === 'Vase');
const own = enrichImagePayload({ ...base, projectId: 'p-eigen', productIdea: 'Kerze', brandInfo: 'Marke X' }, 'p-9', 'Vase');
check('enrich: Payload-Werte gewinnen gegen Argumente', own.projectId === 'p-eigen' && own.productIdea === 'Kerze');
check('enrich: vorhandene Markeninfo bleibt', own.brandInfo === 'Marke X');
check('enrich: Prompt/Format unangetastet', enriched.prompt === 'EN prompt' && enriched.ratio === '2:3');

// ── 7. i18n-Parität der neuen Strings (de = en) ──────────────────────────────
const newKeys = ['next_actions_title', 'next_actions_context_hint', 'next_actions_tiktok', 'next_actions_open_project', 'image_studio_back_to_package', 'image_studio_back_to_project'] as const;
for (const key of newKeys) {
  const deVal = (de as Record<string, string>)[key];
  const enVal = (en as Record<string, string>)[key];
  check(`i18n ${key}: de+en vorhanden und nicht leer`, typeof deVal === 'string' && deVal.length > 0 && typeof enVal === 'string' && enVal.length > 0);
}
check('i18n: TikTok-Aktion nennt das Projekt (de)', de.next_actions_tiktok.includes('Projekt'));
check('i18n: Rückweg zum Paket (de/en)', de.image_studio_back_to_package.includes('Paket') && en.image_studio_back_to_package.includes('package'));

console.log(`\nRESULT: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
if (failures > 0) process.exit(1);
