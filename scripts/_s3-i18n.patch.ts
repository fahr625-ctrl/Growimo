// Patch: i18n-Keys für Stabilisierung Schritt 3 (Punkt 3 + 5) einfügen.
import { readFileSync, writeFileSync } from 'fs';

const DE_ANCHOR = "  image_studio_prompt_upload_variation: 'Erstelle eine Variation basierend auf dem hochgeladenen Bild',";
const EN_ANCHOR = "  image_studio_prompt_upload_variation: 'Create a variation based on uploaded image',";

const DE_NEW = `
  // Stabilisierung Schritt 3 (Punkt 3) — harter Produkttreue-Baustein der
  // Variations-Pipeline. Greift NUR, wenn eine echte Bildreferenz mitgeht.
  image_studio_prompt_reference_lock: 'WICHTIG — Produkttreue: Variiere NUR Hintergrund, Setting, Perspektive, Licht oder Bildausschnitt. Das Produkt ist identisch zum Referenzbild: gleiche Form, Farbe, Material, Proportion und Details — nichts am Produkt hinzufügen oder weglassen, keine erfundenen Logos oder Beschriftungen. Ein oben ausdrücklich beschriebener Text-Overlay ist erlaubt.',
  image_studio_upload_reference_active: 'Produktvorlage aktiv: Dieses Bild wird als verbindliche Referenz mitgesendet — dein Produkt bleibt identisch, variiert werden Hintergrund, Licht, Perspektive und Ausschnitt.',
  image_studio_upload_reading: 'Wird eingelesen…',
  image_studio_upload_reference_missing: 'Keine Bildreferenz — bitte als JPG, PNG oder WebP hochladen.',
  image_studio_reference_sent_hint: 'Mit Referenzbild: Dein Produkt bleibt identisch, variiert werden Hintergrund, Licht, Perspektive und Ausschnitt.',
  image_studio_upload_variation_btn: 'Variation mit Produkttreue',
  // Stabilisierung Schritt 3 (Punkt 5) — „Bild jetzt erstellen" überall.
  image_studio_create_image_now: '🎨 Bild jetzt erstellen',
  image_studio_create_image_now_hint: 'Prompt, Format, Produktidee, Markenprofil und vorhandenes Produktbild werden automatisch übernommen — nichts kopieren, direkt generieren.',
  image_studio_strategy_product: 'Produktidee',
  image_studio_strategy_project: 'Projekt',
  image_studio_strategy_reference: 'Produktbild',
  image_studio_strategy_reference_none: 'Kein Produktbild vorhanden — das Bild wird aus dem Prompt erstellt.',
  image_studio_prompt_line_concept: 'Bildidee',
  image_studio_prompt_line_overlay: 'Text-Overlay',
  image_studio_prompt_line_platform: 'Plattform',
  image_studio_prompt_line_brand: 'Markenkontext';

`;

const EN_NEW = `
  // Stabilisierung Schritt 3 (Punkt 3) — hard product-fidelity block.
  image_studio_prompt_reference_lock: 'IMPORTANT — product fidelity: vary ONLY the background, setting, perspective, lighting or framing. The product is identical to the reference image: same shape, colour, material, proportions and details — add or omit nothing on the product, no invented logos or labels. A text overlay explicitly described above is allowed.',
  image_studio_upload_reference_active: 'Product reference active: this image is sent as a binding reference — your product stays identical while background, lighting, perspective and framing may vary.',
  image_studio_upload_reading: 'Reading…',
  image_studio_upload_reference_missing: 'No image reference — please upload a JPG, PNG or WebP.',
  image_studio_reference_sent_hint: 'With reference image: your product stays identical while background, lighting, perspective and framing may vary.',
  image_studio_upload_variation_btn: 'Variation with product fidelity',
  // Stabilisierung Schritt 3 (Punkt 5) — "create image now" everywhere.
  image_studio_create_image_now: '🎨 Create image now',
  image_studio_create_image_now_hint: 'Prompt, format, product idea, brand profile and any existing product image are carried over automatically — nothing to copy, generate right away.',
  image_studio_strategy_product: 'Product idea',
  image_studio_strategy_project: 'Project',
  image_studio_strategy_reference: 'Product image',
  image_studio_strategy_reference_none: 'No product image available — the image is created from the prompt.',
  image_studio_prompt_line_concept: 'Image idea',
  image_studio_prompt_line_overlay: 'Text overlay',
  image_studio_prompt_line_platform: 'Platform',
  image_studio_prompt_line_brand: 'Brand context';

`;

function patch(path: string, anchor: string, insert: string) {
  const src = readFileSync(path, 'utf8');
  if (src.includes('image_studio_prompt_reference_lock')) {
    console.log('SKIP (already patched):', path);
    return;
  }
  const idx = src.indexOf(anchor);
  if (idx === -1) throw new Error('anchor not found in ' + path);
  const lineEnd = src.indexOf('\n', idx);
  const out = src.slice(0, lineEnd + 1) + insert + src.slice(lineEnd + 1);
  writeFileSync(path, out);
  console.log('patched', path, '(+', insert.split('\n').length - 2, 'keys)');
}

patch('src/i18n/de.ts', DE_ANCHOR, DE_NEW);
patch('src/i18n/en.ts', EN_ANCHOR, EN_NEW);
