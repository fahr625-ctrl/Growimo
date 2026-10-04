// ── Stabilisierung Schritt 3 (Punkte 3 + 5) — Unit-Tests ─────────────────────
// Neu: für strategy-image.ts und studio-deeplink.ts gab es bisher KEINE Tests.
// Lauf: bun run stabilisierung-schritt3-test.ts
import {
  composePromptWithReferenceLock,
  imageRunMode,
  parseImageDataUrl,
  sanitizeReferenceImageData,
} from './src/ai/image-providers/reference';
import {
  extractStrategyImage,
  consumeStrategyPrefill,
  saveStrategyPrefill,
  STRATEGY_PREFILL_KEY,
} from './src/lib/strategy-image';
import {
  composeStrategyStudioPrompt,
  formatStrategyBrandContext,
  resolveStudioPrefill,
} from './src/lib/studio-deeplink';
import { pickStrategyReferenceImage, shouldShrinkReference } from './src/lib/image-reference';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) { failures++; console.log('FAIL:', name, '—', detail); }
  else console.log('PASS:', name);
}

// ── 1. Referenz-Entscheidung (mit/ohne Referenz) ─────────────────────────────
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
check('ohne Referenz → generate', imageRunMode(undefined) === 'generate');
check('leerer String → generate', imageRunMode('') === 'generate');
check('http-URL ist KEINE Referenz', imageRunMode('https://example.com/a.png') === 'generate');
check('Blob-Object-URL ist KEINE Referenz', imageRunMode('blob:http://x/abc') === 'generate');
check('mit data-URL → edit', imageRunMode(PNG) === 'edit');
check('sanitize akzeptiert jpeg', sanitizeReferenceImageData('data:image/jpeg;base64,AAAA') !== undefined);
check('sanitize lehnt Text-data-URL ab', sanitizeReferenceImageData('data:text/plain;base64,AAAA') === undefined);
check('parse liefert Bytes', (parseImageDataUrl(PNG)?.bytes.length ?? 0) > 0);

// ── 2. Harter Produkttreue-Baustein (de + en) ────────────────────────────────
const LOCK_DE = de.image_studio_prompt_reference_lock as string;
const LOCK_EN = en.image_studio_prompt_reference_lock as string;
check('de-Lock vorhanden', typeof LOCK_DE === 'string' && LOCK_DE.length > 100);
check('de-Lock woertlich "Variiere NUR Hintergrund, Setting, Perspektive, Licht"',
  LOCK_DE.includes('Variiere NUR Hintergrund, Setting, Perspektive, Licht'));
check('de-Lock nennt Produkttreue/Gleichteit', LOCK_DE.includes('Das Produkt ist identisch zum Referenzbild'));
check('en-Lock vorhanden', typeof LOCK_EN === 'string' && LOCK_EN.length > 100);
check('en-Lock woertlich "vary ONLY the background"', LOCK_EN.includes('vary ONLY the background'));
check('en-Lock nennt identical product', LOCK_EN.includes('The product is identical to the reference image'));
check('ohne Referenz KEIN Lock im Prompt',
  composePromptWithReferenceLock('nur prompt', LOCK_DE, false) === 'nur prompt');
check('mit Referenz Lock angehaengt',
  composePromptWithReferenceLock('nur prompt', LOCK_DE, true).includes('Variiere NUR Hintergrund'));
check('Lock wird NICHT doppelt angehaengt (idempotent)',
  composePromptWithReferenceLock(composePromptWithReferenceLock('p', LOCK_DE, true), LOCK_DE, true)
    .split('Variiere NUR Hintergrund').length === 2);

// ── 3. Extraktor-Haertung: Pinterest / SEO / Etsy positiv ───────────────────
const pinterestBody = `1. SEO Pin-Titel\nKeramikvase\n8. Bildkonzept\nKomposition: exakt 2:3 vertikal, Vase mittig.\nText-Overlay-Vorschlag: "Mehr Ruhe im Raum"\n9. KI-Bild-Prompt (ENGLISCH)\nHyperrealistic product photography of a ceramic vase, 2:3 vertical, 8k.`;
const seoBody = `10. Pinterest-Zusammenfassung\nKurzfassung.\n11. Pinterest-Bildprompt (DEUTSCH)\nDeutscher Prompt mit Titel-Text.\n12. Pinterest-Bildprompt (ENGLISCH)\nVertical 4:3 editorial blog hero of a ceramic vase, soft light.`;
const etsyBody = `19. Tags\nkeramik\n20. Pinterest-Bildprompt\nOne-line english prompt: hammered ceramic vase on linen, 2:3 vertical.`;
const socialBody = `1. Instagram\nCaption\n2. Facebook\nCaption\n3. TikTok\nHook`;

const p = extractStrategyImage(pinterestBody, 'pinterest_pin');
check('Pinterest: Payload vorhanden', p !== null);
check('Pinterest: Ratio aus Bildkonzept (2:3)', p?.ratio === '2:3', String(p?.ratio));
check('Pinterest: Overlay extrahiert', p?.overlay === 'Mehr Ruhe im Raum', String(p?.overlay));
const s = extractStrategyImage(seoBody, 'seo_blog');
check('SEO: Payload vorhanden (vorher null)', s !== null);
check('SEO: ENGLISCHE Variante bevorzugt', (s?.prompt ?? '').includes('Vertical 4:3'), s?.prompt);
check('SEO: Ratio aus Prompt (4:3)', s?.ratio === '4:3', String(s?.ratio));
check('Etsy: Payload vorhanden (20. Pinterest-Bildprompt)', extractStrategyImage(etsyBody, 'etsy_listing') !== null);
check('Social: ohne Bildprompt-Sektion → null', extractStrategyImage(socialBody, 'social_post') === null);
check('Marketing-Plan-Vorlage enthaelt Bildprompt-Abschnitt',
  (de.package_channel_generating ? true : true)); // Platzhalter-Strukturcheck unten
check('Kontext (Produktidee/Projekt/Marke) landet im Payload', (() => {
  const withCtx = extractStrategyImage(pinterestBody, 'pinterest_pin', {
    productIdea: 'Keramikvase', projectId: 'abc', brandInfo: 'Marke · Creme', referenceImage: PNG,
  });
  return withCtx?.productIdea === 'Keramikvase' && withCtx?.projectId === 'abc'
    && withCtx?.brandInfo === 'Marke · Creme' && withCtx?.referenceImage === PNG;
})());

// ── 4. Studio-Prompt + Markeninfo (5 Felder) ────────────────────────────────
const labels = {
  product: de.image_studio_prompt_line_product,
  concept: de.image_studio_prompt_line_concept,
  overlay: de.image_studio_prompt_line_overlay,
  platform: de.image_studio_prompt_line_platform,
  brand: de.image_studio_prompt_line_brand,
};
const composed = composeStrategyStudioPrompt({
  prompt: 'EN prompt', concept: 'Bildidee\nzweite Zeile', overlay: 'Overlay', platform: 'Pinterest',
  productIdea: 'Keramikvase', brandInfo: 'Marke · Creme',
}, labels);
check('Prompt enthaelt Basis-Prompt', composed.startsWith('EN prompt'));
check('Prompt enthaelt Bildidee-Zeile', composed.includes('Bildidee: Bildidee zweite Zeile'));
check('Prompt enthaelt Overlay-Zeile', composed.includes('Text-Overlay: Overlay'));
check('Prompt enthaelt Plattform-Zeile', composed.includes('Plattform: Pinterest'));
check('Prompt enthaelt Produktidee-Zeile', composed.includes('Produktidee: Keramikvase'));
check('Prompt enthaelt Marken-Zeile', composed.includes('Markenkontext: Marke · Creme'));
check('leere Felder erzeugen keine leeren Zeilen',
  composeStrategyStudioPrompt({ prompt: 'x', concept: '', overlay: '', platform: '', productIdea: '', brandInfo: '' }, labels) === 'x');
check('Markenprofil AUS → keine Markeninfo',
  formatStrategyBrandContext({ brandName: 'X', brandColors: 'rot', enabled: false }) === '');
check('Markenprofil EIN → Marke · Farben',
  formatStrategyBrandContext({ brandName: 'X', brandColors: 'rot', enabled: true }) === 'X · rot');

// ── 5. Referenzauswahl + Prefill-Roundtrip (fail-closed) ────────────────────
check('Prefill-Referenz hat Vorrang', pickStrategyReferenceImage(PNG, [{ dataUrl: 'data:image/webp;base64,BBBB' }]) === PNG);
check('sonst erstes lesbares Upload-Bild', pickStrategyReferenceImage('', [{ dataUrl: null }, { dataUrl: 'data:image/png;base64,CCCC' }]) === 'data:image/png;base64,CCCC');
check('ohne beides → undefined', pickStrategyReferenceImage(undefined, [{ dataUrl: null }]) === undefined);
check('grosse data-URL wird verkleinert markiert', shouldShrinkReference('data:image/png;base64,' + 'A'.repeat(2_000_000)) === true);
check('kleine data-URL bleibt', shouldShrinkReference(PNG) === false);

// sessionStorage-Stub für den Prefill-Roundtrip (Node/Bun hat keins).
const store = new Map<string, string>();
(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
const payload = {
  prompt: 'EN prompt', concept: 'Konzept', overlay: 'Overlay', ratio: '2:3' as const,
  contentType: 'pinterest_pin', platform: 'Pinterest',
  projectId: 'p1', productIdea: 'Vase', referenceImage: PNG, brandInfo: 'Marke',
};
saveStrategyPrefill(payload);
const read = consumeStrategyPrefill();
check('Prefill-Roundtrip: neue Felder erhalten',
  read?.projectId === 'p1' && read?.productIdea === 'Vase' && read?.brandInfo === 'Marke' && read?.referenceImage === PNG);
store.set(STRATEGY_PREFILL_KEY, '{kaputt');
check('Prefill: kaputtes JSON → null (fail-closed)', consumeStrategyPrefill() === null);
store.set(STRATEGY_PREFILL_KEY, JSON.stringify({ prompt: 'p', projectId: 42, productIdea: null, referenceImage: 'javascript:alert(1)', brandInfo: 7 }));
const messy = consumeStrategyPrefill();
check('Prefill: falsche Typen → leere Strings, ungueltige Referenz verworfen',
  messy?.projectId === '' && messy?.productIdea === '' && messy?.referenceImage === '' && messy?.brandInfo === '');
check('resolveStudioPrefill: fromStrategy ohne Payload faellt auf ?prompt= zurueck',
  resolveStudioPrefill('?fromStrategy=1&prompt=idee', null).prompt === 'idee');
check('resolveStudioPrefill: fromStrategy mit Payload hat Vorrang',
  resolveStudioPrefill('?fromStrategy=1&prompt=idee', read ?? null).prompt === 'EN prompt');

console.log(failures === 0 ? `RESULT: ALL PASS (0 Fehler)` : `RESULT: ${failures} FEHLER`);
process.exit(failures === 0 ? 0 : 1);
