/**
 * Bildqualität Schritt 3+4 (Owner-Freigabe 2026-10-07) — Verifikations-Suite.
 * Rein quelltext-/funktionsbasiert (keine DB, kein Netz):
 *   `bun bildqualitaet-schritt34-test.ts`
 *
 * SCHRITT 3 — Modell + Format-Wahrheit:
 *   Modell gpt-image-2, exakte Auflösungen je Seitenverhältnis (Kanten durch 16
 *   teilbar, Pixel im erlaubten Band, Verhältnis exakt), neues Format 9:16 in
 *   Typen/Whitelist/Studio-UI/Ratio-Map/Deep-Link, Edit-/Varianten-Pfad
 *   funktional unverändert.
 * SCHRITT 4 — Text im Bild + Prompt-Kette:
 *   Bild-Abschnitte sind vom Fakten-Schutz ausgenommen („85mm" im Bildprompt
 *   bleibt, „300 ml" im Produktabschnitt fliegt weiter), Sprach-Bevorzugung
 *   ENGLISCH im Ein-Zeilen-Extraktor, keine Überschrift als Prompt-Inhalt,
 *   Text-im-Bild-Regeln (Umlaute/Typografie/Safe-Bereich/Negativ-Baustein),
 *   kein Midjourney-/DALL·E-Dialekt mehr in den Prompt-Templates.
 */
import { readFileSync } from 'node:fs';
import { sanitizeFactResult, sanitizeFactText } from './src/ai/fact-guard';
import { extractStrategyImage } from './src/lib/strategy-image';
import {
  composeStrategyStudioPrompt,
  composeTextOverlayInstructions,
  MAX_OVERLAY_WORDS,
  resolveStudioPrefill,
  studioDeepLink,
  studioSearch,
  studioSearchPrefill,
} from './src/lib/studio-deeplink';
import {
  IMAGE_ASPECT_RATIOS,
  isImageAspectRatio,
  type ImageAspectRatio,
} from './src/ai/image-providers/types';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';

let failures = 0;
let passes = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) {
    failures++;
    console.log('FAIL:', name, '—', detail);
  } else {
    passes++;
    console.log('PASS:', name);
  }
}

const read = (p: string) => readFileSync(p, 'utf8');
const GENERATE = read('src/ai/image-providers/generate.ts');
const TYPES_SRC = read('src/ai/image-providers/types.ts');
const STRATEGY_IMAGE = read('src/lib/strategy-image.ts');
const STUDIO_TSX = read('src/routes/app/image-studio.tsx');
const OPENAI_TS = read('src/ai/providers/openai.ts');
const TIKTOK_TSX = read('src/routes/app/tiktok.tsx');

console.log('### SCHRITT 3 — Modell + Format-Wahrheit ###');

// ── 3.1 Modell ──────────────────────────────────────────────────────────────
check('(3.1) MODEL ist gpt-image-2', /const MODEL = 'gpt-image-2';/.test(GENERATE));
const modelCallSites34 = (GENERATE.match(/client\.images\.(generate|edit)\(/g) ?? []).length;
check('(3.1) genau eine Modell-Konstante, kein zweites Modell im Code',
  (GENERATE.match(/const MODEL = '/g) ?? []).length === 1 &&
  modelCallSites34 >= 2 &&
  (GENERATE.match(/model: MODEL/g) ?? []).length === modelCallSites34 &&
  !/model:\s*'/.test(GENERATE));
check('(3.1) SDK kennt gpt-image-2 (ImageModel in images.d.ts)',
  /'gpt-image-2'/.test(read('node_modules/openai/resources/images.d.ts')));

// ── 3.2 Sizes: exakt, kantengenau, im erlaubten Band ───────────────────────
const sizesBlock = GENERATE.match(/const SIZES: Record<string, string> = \{([\s\S]*?)\};/)?.[1] ?? '';
const sizes: Record<string, string> = {};
for (const m of sizesBlock.matchAll(/'(?:\d{1,2}):(?:\d{1,2})':\s*'(\d+)x(\d+)'/g)) {
  const key = (m[0].match(/'(.+?)':/) ?? [])[1] ?? '';
  sizes[key] = `${m[1]}x${m[2]}`;
}
console.log('   SIZES =', JSON.stringify(sizes));

const EXPECTED: Record<string, string> = {
  '2:3': '1024x1536',
  '1:1': '1024x1024',
  '4:3': '1152x864',
  '16:9': '1280x720',
  '9:16': '720x1280',
};
check('(3.2) genau 5 Formate in SIZES (inkl. 9:16)',
  Object.keys(sizes).length === 5 && Object.keys(EXPECTED).every((k) => k in sizes),
  JSON.stringify(Object.keys(sizes)));
for (const [ratio, size] of Object.entries(EXPECTED)) {
  check(`(3.2) ${ratio} → ${size}`, sizes[ratio] === size, String(sizes[ratio]));
}
check('(3.2) alte Fehlzuordnung 4:3/16:9 beide 1536x1024 ist weg',
  sizes['4:3'] !== '1536x1024' && sizes['16:9'] !== '1536x1024');
check('(3.2) Fallback bleibt 1024x1024', /SIZES\[ratio\] \?\? '1024x1024'/.test(GENERATE));

// Kanten/Pixel/Verhältnis prüfen — die Vorgabe „exakte Seitenverhältnisse".
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;
for (const [ratio, size] of Object.entries(sizes)) {
  const [w, h] = size.split('x').map(Number);
  const [rw, rh] = ratio.split(':').map(Number);
  check(`(3.2) ${ratio} (${size}): beide Kanten durch 16 teilbar`, w % 16 === 0 && h % 16 === 0, `${w}%16=${w % 16} ${h}%16=${h % 16}`);
  check(`(3.2) ${ratio} (${size}): Pixel im Band 655.360–8.294.400`, w * h >= MIN_PIXELS && w * h <= MAX_PIXELS, String(w * h));
  check(`(3.2) ${ratio} (${size}): Verhältnis EXAKT ${ratio}`, w * rh === h * rw, `${w * rh} vs ${h * rw}`);
  check(`(3.2) ${ratio} (${size}): Verhältnis zwischen 1:3 und 3:1`, w / h <= 3 && h / w <= 3);
}
check('(3.2) Trefferfläche der Map deckt alle 5 Studio-Formate ab',
  IMAGE_ASPECT_RATIOS.every((r) => r in sizes), JSON.stringify(IMAGE_ASPECT_RATIOS));

// ── 3.3 Edit-Pfad bleibt funktional unverändert ────────────────────────────
check('(3.3) images.edit + input_fidelity high + toFile unverändert',
  GENERATE.includes('client.images.edit({') && GENERATE.includes("input_fidelity: 'high',") && GENERATE.includes('toFile(parsed.bytes'));
check('(3.3) quality-Schalter (Schritt 2) gilt für ALLE Modell-Pfade (inkl. Streaming)',
  (GENERATE.match(/^\s+quality,$/gm) ?? []).length === modelCallSites34 && GENERATE.includes('resolveImageQuality()'));
check('(3.3) Rückgabe unverändert (b64_json → data-URL, n: 1)',
  GENERATE.includes('data:image/png;base64,') && GENERATE.includes('n: 1'));
check('(3.3) SDK-Typ erlaubt freie Auflösungen für BEIDE Pfade (string & {})',
  (read('node_modules/openai/resources/images.d.ts').match(/size\?: \(string & \{\}\)/g) ?? []).length === 2);

// ── 3.4 Format 9:16 überall erreichbar ─────────────────────────────────────
check('(3.4) Typ-Union enthält 9:16',
  /export type ImageAspectRatio = '2:3' \| '1:1' \| '4:3' \| '16:9' \| '9:16';/.test(TYPES_SRC));
check('(3.4) Whitelist IMAGE_ASPECT_RATIOS enthält 9:16',
  IMAGE_ASPECT_RATIOS.includes('9:16') && IMAGE_ASPECT_RATIOS.length === 5);
check('(3.4) isImageAspectRatio fail-closed',
  isImageAspectRatio('9:16') && !isImageAspectRatio('9:17') && !isImageAspectRatio('') && !isImageAspectRatio(undefined));
check('(3.4) Studio-Vorlagenliste enthält 9:16 (TikTok)', STUDIO_TSX.includes("['9:16', 'image_studio_template_tiktok', 'image_studio_prompt_base_tiktok']"));
check('(3.4) Blog-Hero bleibt 16:9 (kein 9:16 für Blog)',
  STUDIO_TSX.includes("['16:9', 'image_studio_template_blog', 'image_studio_prompt_base_blog']") &&
  !/image_studio_template_blog[^\n]*9:16/.test(STUDIO_TSX));
check('(3.4) Vorschau-Klasse kennt aspect-[9/16]', STUDIO_TSX.includes("'aspect-[9/16]'"));
check('(3.4) Ratio-State nutzt das Format-Union (inkl. 9:16)', STUDIO_TSX.includes("useState<ImageAspectRatio>('2:3')"));
check('(3.4) i18n-Label de/en vorhanden', typeof de.image_studio_template_tiktok === 'string' && typeof en.image_studio_template_tiktok === 'string');
check('(3.4) i18n-Label nennt 9:16', /9:16/.test(de.image_studio_template_tiktok) && /9:16/.test(en.image_studio_template_tiktok));
check('(3.4) Prompt-Basis 9:16 vorhanden (Vertikal)', /9:16/.test(de.image_studio_prompt_base_tiktok) && /9:16/.test(en.image_studio_prompt_base_tiktok));

// ── 3.5 Ratio-Map + Heuristik ──────────────────────────────────────────────
check('(3.5) RATIO_MAP mappt 9:16 nicht mehr still auf 2:3',
  /'9:16': '9:16',/.test(STRATEGY_IMAGE) && !/'9:16': '2:3'/.test(STRATEGY_IMAGE));

const PROMPT_LINE_EN = 'Hyperrealistic product photography of a handmade ceramic vase, warm afternoon light, shallow depth of field.';
/** Body OHNE explizite Ratio (sonst gewinnt `findExplicitRatio` vor der Heuristik). */
function bodyPlain(conceptLine: string, extraSection = '10. Pinterest Alt-Text\nKeramikvase in Beige.') {
  return `1. SEO Pin-Titel\nKeramikvase\n2. Pin-Beschreibung\nEine schöne Vase.\n8. Bildkonzept\nFarbpalette: Beige. Komposition: ${conceptLine}\n9. KI-Bild-Prompt (ENGLISCH)\n${PROMPT_LINE_EN}\n${extraSection}`;
}
check('(3.5) Pinterest-Konzept → 2:3', extractStrategyImage(bodyPlain('vertikal, Vase zentriert'), 'pinterest_pin')?.ratio === '2:3');
check('(3.5) Etsy-Kanal → 4:3', extractStrategyImage(bodyPlain('vertikal, Vase zentriert'), 'etsy_listing')?.ratio === '4:3');
check('(3.5) Instagram/Social → 1:1', extractStrategyImage(bodyPlain('quadratisch'), 'social_post')?.ratio === '1:1');
check('(3.5) Blog/SEO → 16:9', extractStrategyImage(bodyPlain('breit'), 'seo_blog')?.ratio === '16:9');
check('(3.5) TikTok-Kanaltyp → 9:16', extractStrategyImage(bodyPlain('vertikal'), 'tiktok_video')?.ratio === '9:16');
check('(3.5) explizites 9:16 im Konzept gewinnt (Pinterest-Typ)',
  extractStrategyImage(bodyPlain('9:16 Hochkant'), 'pinterest_pin')?.ratio === '9:16');
check('(3.5) explizites 2:3 im Konzept gewinnt (auch bei Video-Hinweis)',
  extractStrategyImage(bodyPlain('2:3 vertikal für Reels'), 'tiktok_video')?.ratio === '2:3');
check('(3.5) TikTok-Hinweis im Body → 9:16 (ohne explizites Verhältnis)',
  extractStrategyImage(bodyPlain('Hochkant für TikTok'), 'x_unknown')?.ratio === '9:16');
check('(3.5) Reels-/Shorts-Hinweis im Body → 9:16',
  extractStrategyImage(bodyPlain('Short-Form Video, Reels-Format'), 'x_unknown')?.ratio === '9:16');
check('(3.5) „hochkant" ALLEIN kippt einen Pin nicht auf 9:16 (dokumentierte Verengung)',
  extractStrategyImage(bodyPlain('hochkant, Vase zentriert'), 'pinterest_pin')?.ratio === '2:3');

// ── 3.6 Deep-Link/Studio-Default für TikTok ────────────────────────────────
check('(3.6) studioSearch reicht das Format durch',
  (studioSearch('p', '9:16') as { ratio?: string }).ratio === '9:16' && !('ratio' in studioSearch('p')));
check('(3.6) studioDeepLink baut ?ratio=9:16 additiv',
  studioDeepLink('p', '9:16') === `/app/image-studio?prompt=p&ratio=${encodeURIComponent('9:16')}` &&
  studioDeepLink('p') === '/app/image-studio?prompt=p');
check('(3.6) studioSearchPrefill liest ?ratio= (Whitelist, fail-closed)',
  studioSearchPrefill('?prompt=p&ratio=9:16').ratio === '9:16' &&
  studioSearchPrefill('?prompt=p&ratio=9:17').ratio === undefined &&
  studioSearchPrefill('?prompt=p').ratio === undefined);
check('(3.6) TikTok-/prompt=-Einstieg wählt 9:16 (vorher Studio-Default 2:3)',
  resolveStudioPrefill('?prompt=Keramikvase', null).ratio === '9:16');
check('(3.6) explizites ?ratio= schlägt den Einstiegs-Default',
  resolveStudioPrefill('?prompt=p&ratio=1:1', null).ratio === '1:1');
check('(3.6) Ideen-Einstieg ohne Angabe ändert nichts (undefined)',
  resolveStudioPrefill('?idea=Kerzen', null).ratio === undefined);
check('(3.6) Strategie-Prefill behält sein eigenes Format (kein Fremd-Ratio)',
  resolveStudioPrefill('?fromStrategy=1', { ratio: '2:3', prompt: 'x' } as never).ratio === undefined);
check('(3.6) Studio übernimmt das Format aus der Auflösung',
  STUDIO_TSX.includes('if (resolved.ratio) setRatio(resolved.ratio);'));
check('(3.6) TikTok-Aufnahmeanleitung/Video-Pfad unangetastet (kein ratio-Bau dort)',
  !TIKTOK_TSX.includes('studioSearch(img.studioPrompt, ') && TIKTOK_TSX.includes('search={studioSearch(img.studioPrompt)}'));

console.log('### SCHRITT 4 — Text im Bild + Prompt-Kette ###');

// ── 4.7 Bildprompt-Schutz im Fakten-Guard ──────────────────────────────────
const GROUNDING = 'Produktidee: handgemachte Keramikvase für Wohnzimmer-Deko.';
const BODY_WITH_85MM = `1. SEO Pin-Titel
Handgemachte Keramikvase
2. Pin-Beschreibung
Diese Vase bringt Ruhe in dein Wohnzimmer. Sie fasst 300 ml und ist in 3-5 Werktagen bei dir.
3. Fokus-Keywords
keramik vase, wohnzimmer deko
8. Bildkonzept
Farbpalette: warmes Beige. Komposition: 2:3 vertikal. Text-Overlay-Vorschlag: „Gemütlich wohnen"
9. KI-Bild-Prompt (ENGLISCH)
Hyperrealistic product photography of a handmade ceramic vase, shot on 85mm lens, 2:3 vertical, 8k.
10. Pinterest Alt-Text
Handgemachte Keramikvase auf Leinentisch.`;

const cleaned = sanitizeFactText(BODY_WITH_85MM, GROUNDING);
const cleanedBody = sanitizeFactResult({ title: '', body: BODY_WITH_85MM }, GROUNDING).body;

check('(4.7) „300 ml"-Satz im Produktabschnitt fliegt weiterhin',
  !cleaned.includes('300 ml') && !cleaned.includes('3-5 Werktagen'));
check('(4.7) unschuldiger Satz desselben Abschnitts bleibt', cleaned.includes('Diese Vase bringt Ruhe in dein Wohnzimmer.'));
check('(4.7) englischer Bildprompt mit „85mm" bleibt ERHALTEN',
  cleaned.includes('Hyperrealistic product photography of a handmade ceramic vase'));
check('(4.7) „85mm"/„8k" bleiben im Prompt-Text erhalten (nicht eliminiert)',
  cleaned.includes('85mm') && cleaned.includes('8k'));
check('(4.7) Abschnitt 9 ist nicht leer (kein Sprach-Artefakt)',
  /9\. KI-Bild-Prompt \(ENGLISCH\)\n\S/.test(cleaned));
check('(4.7) Bildkonzept-Abschnitt 8 bleibt inhaltlich erhalten (Overlay-Vorschlag)',
  cleaned.includes('Text-Overlay-Vorschlag: „Gemütlich wohnen"'));
check('(4.7) alle 6 Überschriften stehen weiter am Zeilenanfang',
  ['1. SEO Pin-Titel', '2. Pin-Beschreibung', '3. Fokus-Keywords', '8. Bildkonzept', '9. KI-Bild-Prompt (ENGLISCH)', '10. Pinterest Alt-Text']
    .every((h) => cleaned.split('\n').some((l) => l.trim() === h.trim())));
check('(4.7) Prompt ist über die Strategie-Extraktion weiter englisch lesbar',
  (extractStrategyImage(BODY_WITH_85MM, 'pinterest_pin')?.prompt ?? '').startsWith('Hyperrealistic'));
check('(4.7) sanitizeFactResult liefert denselben bereinigten Body', cleanedBody === cleaned);

// Schutz endet an der nächsten Überschrift: Verstoß NACH dem Bild-Abschnitt fliegt.
const BODY_AFTER = `${BODY_WITH_85MM} Sie fasst 500 ml.`;
const cleanedAfter = sanitizeFactText(BODY_AFTER, GROUNDING);
check('(4.7) Verstoß im Abschnitt NACH dem Bild-Abschnitt fliegt weiter',
  !cleanedAfter.includes('500 ml') && cleanedAfter.includes('Handgemachte Keramikvase auf Leinentisch.'));
check('(4.7) Bildprompt bleibt trotzdem erhalten (Schutz punktuell)',
  cleanedAfter.includes('85mm'));

// Kollabierter Body (keine Umbrüche) — genau der Live-Fingerabdruck der 16 Pinterest-Bodies.
const COLLAPSED = BODY_WITH_85MM.replace(/\n+/g, ' ');
const cleanedCollapsed = sanitizeFactText(COLLAPSED, GROUNDING);
check('(4.7) kollabierter Body: Prompt-Zeile mit „85mm" überlebt',
  cleanedCollapsed.includes('Hyperrealistic product photography of a handmade ceramic vase'));
check('(4.7) kollabierter Body: „300 ml"-Behauptung fliegt weiterhin',
  !cleanedCollapsed.includes('300 ml'));

// Fakt-freier Body bleibt byte-identisch (kein Verhalten außerhalb des Schutzes).
const CLEAN_BODY = `1. SEO Pin-Titel\nKeramikvase\n2. Pin-Beschreibung\nEine schöne Vase.\n9. KI-Bild-Prompt (ENGLISCH)\nHyperrealistic vase, 2:3 vertical.`;
check('(4.7) fakt-freier Body kommt unverändert (===) zurück',
  sanitizeFactText(CLEAN_BODY, GROUNDING) === CLEAN_BODY);

// ── 4.8 Extraktor: ENGLISCH bevorzugen, keine Überschrift als Inhalt ───────
const SEO_COLLAPSED = [
  '1. Fokus-Keyword Keramikvase',
  '10. Pinterest-Zusammenfassung Eine kurze Zusammenfassung für Pinterest.',
  '11. Pinterest-Bildprompt (DEUTSCH) Titel-Text auf dem Bild: „Keramikvase kaufen", deutsche Bildidee.',
  '12. Pinterest-Bildprompt (ENGLISCH) Hyperrealistic product photography of a ceramic vase, warm afternoon light.',
  '13. Interne Verlinkungsideen [Ankertext] und Begründung.',
].join(' ');
const seo = extractStrategyImage(SEO_COLLAPSED, 'seo_blog');
check('(4.8) kollabierter SEO-Body liefert einen Payload', !!seo);
check('(4.8) ENGLISCHE Fassung gewinnt (nicht mehr Abschnitt 11 = DEUTSCH)',
  (seo?.prompt ?? '').startsWith('Hyperrealistic product photography'),
  seo?.prompt ?? 'null');
check('(4.8) deutscher Abschnitts-Text wird nicht mehr als Prompt geliefert',
  !(seo?.prompt ?? '').includes('Titel-Text auf dem Bild'));
check('(4.8) Sprachmarker (DEUTSCH)/(ENGLISCH) sauber gestrippt',
  !/\(DEUTSCH\)|\(ENGLISCH\)/i.test(seo?.prompt ?? ''));
check('(4.8) Ratio des SEO-Bodies bleibt 16:9 (Blog-Kanal)',
  extractStrategyImage(SEO_COLLAPSED, 'seo_blog')?.ratio === '16:9', String(seo?.ratio));

const SEO_EMPTY_EN = [
  '1. Fokus-Keyword Keramikvase',
  '10. Pinterest-Zusammenfassung Eine kurze Zusammenfassung für Pinterest.',
  '12. Pinterest-Bildprompt (ENGLISCH) 13. Interne Verlinkungsideen [Anker] und Begründung.',
].join(' ');
const seoEmpty = extractStrategyImage(SEO_EMPTY_EN, 'seo_blog');
check('(4.8) leerer englischer Abschnitt → kein Prompt (statt der nächsten Überschrift)',
  seoEmpty === null || !/Interne Verlinkungsideen/.test(seoEmpty.prompt),
  seoEmpty?.prompt ?? 'null');

// ── 4.9/4.10 Text-im-Bild-Regeln + Negativ-Baustein ────────────────────────
const rules = {
  overlay: de.image_studio_prompt_rule_overlay,
  noText: de.image_studio_prompt_rule_no_text,
  typography: de.image_studio_prompt_rule_typography,
  negatives: de.image_studio_prompt_rule_negatives,
};
const withOverlay = composeTextOverlayInstructions({ overlay: '„Gemütlich wohnen"', platform: 'Pinterest' }, rules);
check('(4.9) Overlay wird als gequoteter String ausgegeben', withOverlay[0].includes('"Gemütlich wohnen"'), withOverlay[0]);
check('(4.9) Overlay wird auf max. 6 Wörter gekürzt',
  (withOverlay[0].match(/"([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean).length <= MAX_OVERLAY_WORDS);
check('(4.9) Langtext-Overlay wird gekürzt (10 Wörter → max. 6)', (() => {
  const long = composeTextOverlayInstructions({ overlay: 'eins zwei drei vier fünf sechs sieben acht neun zehn', platform: 'Pinterest' }, rules);
  return (long[0].match(/"([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean).length === MAX_OVERLAY_WORDS;
})());
check('(4.9) Typografie-Regel ist enthalten (Umlaute, eine Schriftfamilie, Safe-Bereich)',
  withOverlay.some((l) => /ä ö ü ß/.test(l) && /Schriftfamilie/.test(l) && /Safe-Bereich/.test(l)));
check('(4.10) Negativ-Baustein ist enthalten', withOverlay.some((l) => /Wasserzeichen/.test(l) && /Logos/.test(l)));
check('(4.9) Fotostil ohne Overlay → ausdrücklich „kein Text im Bild"',
  composeTextOverlayInstructions({ overlay: '', platform: 'Etsy' }, rules).some((l) => l === de.image_studio_prompt_rule_no_text));
check('(4.9) Pinterest ohne Overlay → kein Textverbot (Overlay zulässig)',
  !composeTextOverlayInstructions({ overlay: '', platform: 'Pinterest' }, rules).some((l) => l === de.image_studio_prompt_rule_no_text));
check('(4.9) en-Regeln sind parallel vorhanden (Parität)',
  en.image_studio_prompt_rule_overlay.includes('%s') && en.image_studio_prompt_rule_negatives.length > 20 && en.image_studio_prompt_rule_no_text.length > 10);
check('(4.10) Negativ-Baustein entspricht der bestehenden Referenz-Sperre-Logik (keine erfundenen Logos)',
  /keine Wasserzeichen/.test(de.image_studio_prompt_rule_negatives) && /no watermarks/.test(en.image_studio_prompt_rule_negatives));

const labelsDE = {
  product: de.image_studio_prompt_line_product,
  concept: de.image_studio_prompt_line_concept,
  overlay: de.image_studio_prompt_line_overlay,
  platform: de.image_studio_prompt_line_platform,
  brand: de.image_studio_prompt_line_brand,
};
const payload = { prompt: 'EN prompt', concept: 'Bildidee', overlay: 'Gemütlich wohnen', platform: 'Pinterest', productIdea: 'Keramikvase', brandInfo: 'Marke · Creme' };
const composedOld = composeStrategyStudioPrompt(payload, labelsDE);
const composedNew = composeStrategyStudioPrompt(payload, { ...labelsDE, rules });
check('(4.9) ohne Regeln bleibt der Studio-Prompt byte-identisch (Rückwärtskompatibilität)',
  composedOld.startsWith('EN prompt') && !composedOld.includes('Schriftfamilie'));
check('(4.9) mit Regeln kommen Text-/Negativ-Regeln dazu',
  composedNew.includes('Schriftfamilie') && composedNew.includes('Wasserzeichen') && composedNew.includes('"Gemütlich wohnen"'));
check('(4.9) Regeln hängen hinter dem Basis-Prompt (Reihenfolge stabil)',
  composedNew.indexOf('EN prompt') === 0 && composedNew.indexOf('Schriftfamilie') > composedNew.indexOf('Markenkontext'));
check('(4.10) Studio übergibt die Regeln im Strategie-Pfad', STUDIO_TSX.includes('rules: studioPromptRules(t)'));
check('(4.10) Studio hängt die Regeln auch im Deep-Link-/Ideen-Pfad an',
  STUDIO_TSX.includes('composeTextOverlayInstructions('));

// Kein Midjourney-/DALL·E-Dialekt mehr in den Bildprompt-Templates.
// Die Sprachregel-Konstante nennt die VERBOTENEN Muster als Negativ-Beispiele —
// für die Prüfung wird sie vorher aus dem Quelltext entfernt.
// (Der Kommentarblock über der Konstante nennt dieselben verbotenen Muster —
// er wird mit entfernt, sonst prüft der Test seinen eigenen Kommentar.)
const OPENAI_TEMPLATES = OPENAI_TS.replace(
  /\/\/ Schritt 4 \(Owner-Freigabe[\s\S]*?const IMAGE_PROMPT_RULES = `[\s\S]*?`;/,
  '',
);
check('(4.9) Sprachregel-Konstante wurde für die Prüfung entfernt', OPENAI_TEMPLATES !== OPENAI_TS);
check('(4.9) kein „für Midjourney/DALL·E/Flux"-Auftrag mehr in den Templates',
  !/Prompt für Midjourney/.test(OPENAI_TEMPLATES) && !/optimiert für Midjourney/.test(OPENAI_TEMPLATES) && !/Midjourney/.test(OPENAI_TEMPLATES));
check('(4.9) kein „--ar"/„--style raw" mehr in den Templates', !/--ar/.test(OPENAI_TEMPLATES) && !/--style raw/.test(OPENAI_TEMPLATES));
check('(4.9) keine Brennweiten-Angabe „85mm" mehr in den Templates', !/85mm/.test(OPENAI_TEMPLATES));
check('(4.9) kein „8k"-Qualitäts-Booster mehr in den Templates', !/\b8k\b/.test(OPENAI_TEMPLATES));
check('(4.10) Sprachregel-Konstante IMAGE_PROMPT_RULES wird 3× eingesetzt',
  (OPENAI_TS.match(/\$\{IMAGE_PROMPT_RULES\}/g) ?? []).length === 3);
check('(4.10) Sprachregel fordert deutsche Schriftzeichen (ä ö ü ß)', /ä ö ü ß/.test(OPENAI_TS));
check('(4.10) Sprachregel nennt den Negativ-Baustein (Wasserzeichen/Logos)', /Wasserzeichen/.test(OPENAI_TS) && /Logos/.test(OPENAI_TS));
check('(4.10) Sprachregel adressiert das echte Zielmodell gpt-image-2', /gpt-image-2/.test(OPENAI_TS));

// ── i18n-Parität (neue Schlüssel in beiden Sprachen) ──────────────────────
const deKeys = Object.keys(de).sort();
const enKeys = Object.keys(en).sort();
check('i18n: Schlüsselanzahl de == en', deKeys.length === enKeys.length, `${deKeys.length} vs ${enKeys.length}`);
check('i18n: keine fehlenden Schlüssel', deKeys.every((k, i) => k === enKeys[i]));
const NEW_KEYS: Array<keyof typeof de> = [
  'image_studio_template_tiktok',
  'image_studio_prompt_base_tiktok',
  'image_studio_prompt_rule_overlay',
  'image_studio_prompt_rule_no_text',
  'image_studio_prompt_rule_typography',
  'image_studio_prompt_rule_negatives',
];
check('i18n: alle 6 neuen Schlüssel in de UND en',
  NEW_KEYS.every((k) => typeof de[k] === 'string' && (de[k] as string).trim().length > 0 && typeof en[k] === 'string' && (en[k] as string).trim().length > 0));

// ── Typ-Wächter (Compile-Zeit-Beweis für das neue Format) ─────────────────
const typedRatio: ImageAspectRatio = '9:16';
check('Typ-Wächter: 9:16 ist ein gültiges ImageAspectRatio', typedRatio === '9:16' && IMAGE_ASPECT_RATIOS.includes(typedRatio));

console.log(`\n=== bildqualitaet-schritt34-test: ${passes} PASS, ${failures} FAIL ===`);
if (failures > 0) {
  console.log('FEHLGESCHLAGEN');
  process.exit(1);
}
console.log('ALLE TESTS BESTANDEN');
