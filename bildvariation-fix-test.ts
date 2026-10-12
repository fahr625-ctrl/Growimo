// ── Bildvariations-Fix (Owner-Freigabe 2026-10-12) — Unit-Tests ──────────────
// Lauf: bun run bildvariation-fix-test.ts
//
// Deckt die Fixes A (Design-/Vorlagentreue im Upload-Prompt), B (Format der
// Vorlage statt hart 1:1), C (Pflichtfeld „Was soll sich ändern?"), D
// (Textschutz für JEDES Referenzbild) und G (ehrliche Button-/Hinweistexte) ab.
//
// Grundlage des Fixes: docs/BEFUND unter
// /home/team/shared/bildvariation-untersuchung-2026-10-11/BEFUND-2026-10-11.md
import { readFileSync } from 'node:fs';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';
import {
  composePromptWithReferenceLock,
  composePromptWithReferenceLocks,
} from './src/ai/image-providers/reference';
import { nearestImageAspectRatio } from './src/ai/image-providers/types';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) { failures++; console.log('FAIL:', name, '—', detail); }
  else console.log('PASS:', name);
}
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

// ── 1. Fix B — Format der Vorlage (2:3 bleibt 2:3) ───────────────────────────
check('B1 1000x1500 (Owner-Vorlage) → 2:3', nearestImageAspectRatio(1000, 1500) === '2:3', String(nearestImageAspectRatio(1000, 1500)));
check('B2 1024x1536 (2:3-Zielgröße) → 2:3', nearestImageAspectRatio(1024, 1536) === '2:3');
check('B3 1024x1024 → 1:1', nearestImageAspectRatio(1024, 1024) === '1:1');
check('B4 1200x900 → 4:3', nearestImageAspectRatio(1200, 900) === '4:3');
check('B5 1920x1080 → 16:9', nearestImageAspectRatio(1920, 1080) === '16:9');
check('B6 1080x1920 → 9:16', nearestImageAspectRatio(1080, 1920) === '9:16');
check('B7 1500x1000 (3:2 quer) bleibt quer → 4:3', nearestImageAspectRatio(1500, 1000) === '4:3');
check('B8 1000x1600 (5:8 hoch) bleibt hoch → 2:3', nearestImageAspectRatio(1000, 1600) === '2:3');
check('B9 900x1200 (3:4 hoch) bleibt hoch → 2:3', nearestImageAspectRatio(900, 1200) === '2:3');
check('B10 Maße 0/negativ/NaN → null (fail-closed)', nearestImageAspectRatio(0, 100) === null
  && nearestImageAspectRatio(100, -1) === null && nearestImageAspectRatio(Number.NaN, 10) === null);
check('B11 nicht-integer Maße sind erlaubt', nearestImageAspectRatio(1000.5, 1500.5) === '2:3');

// ── 2. Fix A+D — Bausteine werden angehängt, nicht doppelt, in Reihenfolge ───
const LOCK_DE = de.image_studio_prompt_reference_lock as string;
const TEXT_DE = de.image_studio_prompt_reference_text_lock as string;
const DESIGN_DE = de.image_studio_prompt_design_fidelity as string;
check('A1 ohne Referenz KEIN Baustein',
  composePromptWithReferenceLocks('p', [LOCK_DE, TEXT_DE, DESIGN_DE], false) === 'p');
check('A2 mit Referenz: Produkttreue angehängt',
  composePromptWithReferenceLocks('p', [LOCK_DE], true).includes('Variiere NUR Hintergrund'));
check('A3 mit Referenz: Textschutz (D) angehängt',
  composePromptWithReferenceLocks('p', [LOCK_DE, TEXT_DE], true).includes('TEXTSCHUTZ für das Referenzbild'));
check('A4 Design-Treue (A) nur wenn übergeben',
  !composePromptWithReferenceLocks('p', [LOCK_DE, TEXT_DE], true).includes('VORLAGENTREUE')
  && composePromptWithReferenceLocks('p', [LOCK_DE, TEXT_DE, DESIGN_DE], true).includes('VORLAGENTREUE'));
check('A5 Reihenfolge bleibt erhalten',
  composePromptWithReferenceLocks('p', [LOCK_DE, TEXT_DE, DESIGN_DE], true)
    .indexOf('Produkttreue') < composePromptWithReferenceLocks('p', [LOCK_DE, TEXT_DE, DESIGN_DE], true).indexOf('TEXTSCHUTZ'));
check('A6 keine Doppelanhängung (idempotent, 3 Bausteine)',
  (() => {
    const once = composePromptWithReferenceLocks('p', [LOCK_DE, TEXT_DE, DESIGN_DE], true);
    const twice = composePromptWithReferenceLocks(once, [LOCK_DE, TEXT_DE, DESIGN_DE], true);
    return once === twice && once.split('Produkttreue').length === 2;
  })());
check('A7 leere/undefinierte Bausteine werden übersprungen',
  composePromptWithReferenceLocks('p', ['', undefined, null, LOCK_DE], true)
    .split('WICHTIG — Produkttreue').length === 2);
check('A8 Einzel-Baustein-API bleibt identisch (Rückwärtskompatibilität)',
  composePromptWithReferenceLock('nur prompt', LOCK_DE, false) === 'nur prompt'
  && composePromptWithReferenceLock('nur prompt', LOCK_DE, true).includes('Variiere NUR Hintergrund'));
check('A9 leere Basis + Referenz → nur die Bausteine (kein führender Leerraum)',
  composePromptWithReferenceLocks('', [LOCK_DE], true) === LOCK_DE);

// ── 3. Prompt-Form des Upload-Pfads (aus den echten i18n-Werten gebaut) ──────
const uploadPrompt = `${de.image_studio_prompt_upload_variation}\n\n${(de.image_studio_prompt_upload_change_request as string).replace('%s', 'Hintergrund in Holzoptik')}`;
const composed = composePromptWithReferenceLocks(uploadPrompt, [LOCK_DE, TEXT_DE, DESIGN_DE], true);
check('C1 Nutzertext steht wörtlich im Prompt (einzige Änderung)',
  composed.includes('Hintergrund in Holzoptik')
  && composed.includes('Der einzige erlaubte Unterschied zur Vorlage: Hintergrund in Holzoptik.'));
check('C2 Nutzertext wird NICHT mehr durch eine Fotografie-Richtung ersetzt',
  !composed.includes('Nahaufnahme aus leicht erhöhter Kameraposition')
  && !composed.includes('geringe Tiefenschärfe'));
check('C3 Prompt nennt die Vorlage (nicht „hochgeladenes Bild" allein)',
  (de.image_studio_prompt_upload_variation as string).includes('Vorlage'));
check('C4 „%s"-Platzhalter bleibt auflösbar (kein Platzhalter-Rest im Prompt)',
  !composed.includes('%s'));

// ── 4. Fix D — Textschutz ohne Konditionalsatz (de + en) ─────────────────────
check('D1 de/reference_lock: alter Konditionalsatz ist weg',
  !LOCK_DE.includes('Ein oben ausdrücklich beschriebener Text-Overlay ist erlaubt')
  && LOCK_DE.includes('auch dann, wenn er oben nicht ausdrücklich beschrieben ist'));
check('D2 en/reference_lock: alter Konditionalsatz ist weg',
  !(en.image_studio_prompt_reference_lock as string).includes('explicitly described above is allowed')
  && (en.image_studio_prompt_reference_lock as string).includes('even when it is not explicitly described above'));
check('D3 de/Textschutz deckt alle Texte + Wortlaut/Rechtschreibung/Typografie ab',
  TEXT_DE.includes('Jeder im Referenzbild vorhandene Text')
  && TEXT_DE.includes('gleicher Wortlaut') && TEXT_DE.includes('gleiche Rechtschreibung')
  && TEXT_DE.includes('gleiche Typografie') && TEXT_DE.includes('keine Bedingung') === false);
check('D4 de/Textschutz verbietet Hinzufügen/Entfernen/Umformulieren',
  TEXT_DE.includes('ergänzt') && TEXT_DE.includes('gekürzt') && TEXT_DE.includes('umformuliert'));
check('D5 en/Textschutz vorhanden und vollständig',
  typeof en.image_studio_prompt_reference_text_lock === 'string'
  && (en.image_studio_prompt_reference_text_lock as string).includes('every text present in the reference image')
  && (en.image_studio_prompt_reference_text_lock as string).includes('same spelling'));
check('D6 bestehender Text-Overlay-Baustein unverändert erhalten (kein Modul-Rückschritt)',
  (de.image_studio_prompt_rule_overlay as string).includes('Bildtext (Text-Overlay) exakt und ausschließlich so: %s'));

// ── 5. Fix A — Design-/Vorlagentreue deckt den flachen Vorlagen-Fall ab ──────
check('A10 de/Design-Treue: fertiges Design + unverändert',
  DESIGN_DE.includes('FERTIGES DESIGN') && DESIGN_DE.includes('unverändert übernommen'));
check('A11 de/Design-Treue: alle Texte wörtlich (Wortlaut/Rechtschreibung/Zeichensetzung/Reihenfolge)',
  DESIGN_DE.includes('gleicher Wortlaut') && DESIGN_DE.includes('gleiche Rechtschreibung')
  && DESIGN_DE.includes('gleiche Zeichensetzung') && DESIGN_DE.includes('gleiche Reihenfolge'));
check('A12 de/Design-Treue: Typografie, Farben, Grafiken, Layout, Proportionen, Bildelemente',
  DESIGN_DE.includes('Typografie') && DESIGN_DE.includes('Farben') && DESIGN_DE.includes('Grafiken')
  && DESIGN_DE.includes('Layout') && DESIGN_DE.includes('Proportionen') && DESIGN_DE.includes('Bildelemente'));
check('A13 de/Design-Treue: nur der genannte Aspekt ändert sich',
  DESIGN_DE.includes('AUSSCHLIESSLICH der ausdrücklich genannte Änderungswunsch'));
check('A14 en/Design-Treue gleichwertig vorhanden',
  (en.image_studio_prompt_design_fidelity as string).includes('FINISHED DESIGN')
  && (en.image_studio_prompt_design_fidelity as string).includes('letter by letter')
  && (en.image_studio_prompt_design_fidelity as string).includes('ONLY the explicitly requested modification'));

// ── 6. Fix G — ehrliche Zusagen (keine Überzusage mehr) ─────────────────────
const deBtn = de.image_studio_upload_variation_btn as string;
const enBtn = en.image_studio_upload_variation_btn as string;
const deActive = de.image_studio_upload_reference_active as string;
const enActive = en.image_studio_upload_reference_active as string;
const deSent = de.image_studio_reference_sent_hint as string;
const enSent = en.image_studio_reference_sent_hint as string;
check('G1 Button nennt die Vorlage und die Erhaltung (de)', deBtn.includes('Vorlage') && deBtn.includes('bleibt erhalten'));
check('G2 Button (en) gleichwertig', enBtn.includes('template') && enBtn.includes('stays intact'));
check('G3 Button verspricht NICHT mehr „Produkttreue"/identisches Produkt',
  !deBtn.includes('Produkttreue') && !enBtn.includes('product fidelity'));
check('G4 Hinweis (de) sagt, was garantiert wird: Referenz + unverändert + nur der genannte Punkt',
  deActive.includes('verbindliche Referenz') && deActive.includes('unverändert') && deActive.includes('genannte Punkt'));
check('G5 Hinweis (de) nennt die KI-Einschränkung statt einer Garantie',
  deActive.includes('KI-Ergebnisse können in Details abweichen'));
check('G6 kein „Produkt bleibt identisch" mehr (de, beide Hinweise)',
  !deActive.includes('bleibt identisch') && !deSent.includes('bleibt identisch'));
check('G7 kein „your product stays identical" mehr (en, beide Hinweise)',
  !enActive.includes('stays identical') && !enSent.includes('stays identical'));
check('G8 kein „unbegrenzt/kostenlos/garantiert"-Etikett in den neuen Texten',
  ![deBtn, deActive, deSent, DESIGN_DE, TEXT_DE].some((s) => /kostenlos|unbegrenzt|garantiert/i.test(s))
  && ![enBtn, enActive, enSent].some((s) => /free|unlimited|guaranteed/i.test(s)));
check('G9 Hinweis nennt das Format der Vorlage (%s-Platzhalter, de+en)',
  deActive.includes('%s') && enActive.includes('%s'));

// ── 7. Pflichtfeld „Was soll sich ändern?" (Fix C, de + en) ─────────────────
check('C5 Label de/en vorhanden', (de.image_studio_upload_change_label as string) === 'Was soll sich ändern?'
  && (en.image_studio_upload_change_label as string) === 'What should change?');
check('C6 Pflicht-Hinweis de/en vorhanden',
  (de.image_studio_upload_change_required as string).includes('Pflichtfeld')
  && (en.image_studio_upload_change_required as string).includes('Required field'));
check('C7 Platzhalter-Hilfe de/en vorhanden',
  (de.image_studio_upload_change_placeholder as string).length > 10
  && (en.image_studio_upload_change_placeholder as string).length > 10);

// ── 8. Verdrahtung in image-studio.tsx (Quelltext-Ebene) ────────────────────
const studio = read('src/routes/app/image-studio.tsx');
check('W1 Upload-Aufruf ist NICHT mehr hart auf 1:1',
  !studio.includes("uploadVariationPrompt(), '1:1', file.dataUrl"));
check('W2 Upload-Pfad bestimmt das Format aus der Vorlage (Fix B)',
  studio.includes('file.aspectRatio') && studio.includes('detectImageAspectRatio(reference)') && studio.includes("?? '1:1'"));
check('W3 Format wird beim Einlesen der Datei ermittelt',
  studio.includes('const aspectRatio = usable ? await detectImageAspectRatio(usable) : null;'));
check('W4 Vorlage wird als Referenz mitgesendet (unverändert)',
  studio.includes('const reference = file.dataUrl ?? undefined;'));
check('W5 Pflichtfeld blockiert den Start (disabled + early return)',
  studio.includes('disabled={loading || uploadChangeMissing(file)}') && studio.includes('if (!change) return;'));
check('W6 Änderungswunsch geht als %s in den Prompt',
  studio.includes("t.image_studio_prompt_upload_change_request.replace('%s', change)"));
check('W7 Design-Treue-Baustein (A) läuft im Upload-Pfad mit',
  studio.includes('[t.image_studio_prompt_design_fidelity],'));
check('W8 Textschutz (D) läuft in ALLEN Referenz-Pfaden mit',
  (studio.match(/t\.image_studio_prompt_reference_text_lock/g) ?? []).length === 2
  && studio.includes('composePromptWithReferenceLocks('));
check('W9 kein generate()-Aufruf mit dem alten Einzel-Baustein',
  !studio.includes('composePromptWithReferenceLock('));
check('W10 bestehende Testids erhalten (E2E-Kompatibilität)',
  studio.includes('data-testid="upload-variation-btn"') && studio.includes('data-testid="upload-card"')
  && studio.includes('data-testid="upload-no-reference"'));
check('W11 neue Testids dokumentiert vorhanden',
  studio.includes('data-testid="upload-change-label"') && studio.includes('data-testid="upload-change-request"')
  && studio.includes('data-testid="upload-change-required"') && studio.includes('data-testid="upload-reference-active"'));
const uploadBuilder = studio.slice(
  studio.indexOf('const uploadVariationPrompt = ('),
  studio.indexOf('const runUploadVariation = ('),
);
check('W12 Fotografie-Richtungen nur noch in der Karten-Variation, nicht im Upload-Pfad',
  uploadBuilder.length > 50 && !uploadBuilder.includes('variationDirectionKeys')
  && studio.includes('const directionKey = variationDirectionKeys[variationCounter.current % variationDirectionKeys.length];'));
check('W13 Statuszustände der Upload-Karte unverändert (ready/reading/failed)',
  studio.includes("status: 'reading'") && studio.includes("status: usable ? 'ready' : 'failed'"));

// ── 9. i18n-Parität der neuen Keys ──────────────────────────────────────────
const newKeys = [
  'image_studio_prompt_upload_change_request',
  'image_studio_prompt_design_fidelity',
  'image_studio_prompt_reference_text_lock',
  'image_studio_upload_change_label',
  'image_studio_upload_change_placeholder',
  'image_studio_upload_change_required',
] as const;
for (const key of newKeys) {
  const d = (de as Record<string, unknown>)[key];
  const e = (en as Record<string, unknown>)[key];
  check(`I18N ${key}: de+en vorhanden und nicht leer`,
    typeof d === 'string' && (d as string).length > 5 && typeof e === 'string' && (e as string).length > 5);
}
check('I18N de/en Key-Anzahl gleich', Object.keys(de).length === Object.keys(en).length,
  `${Object.keys(de).length} vs ${Object.keys(en).length}`);

console.log(failures === 0 ? 'RESULT: ALL PASS (0 Fehler)' : `RESULT: ${failures} FEHLER`);
process.exit(failures === 0 ? 0 : 1);
