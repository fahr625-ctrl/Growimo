// ─────────────────────────────────────────────────────────────────────────────
// K3 — Auto-Save für die Einzelgeneratoren (Owner-Entscheid 2026-10-18)
// ─────────────────────────────────────────────────────────────────────────────
// Geprüft wird genau das, was ein Live-E2E NICHT abdeckt:
//   Teil A — die pure Entscheidungs-/Namenslogik (src/lib/quick-autosave.ts):
//            wann wird automatisch gespeichert, wann NICHT (kein Ergebnis,
//            schon gespeichert, Speichervorgang läuft) + Projektname.
//   Teil B — statische Wire-Checks am echten Aufrufer
//            (src/components/QuickGenerator.tsx): genau EIN Auslösepunkt nach
//            recordGeneration, derselbe Speicher-Pfad wie „In Projekt speichern",
//            Idempotenz (kein zweites Projekt), ALLE DREI contentTypes,
//            Verbessern/A-B schreiben in dasselbe Projekt, KEIN usage-guard auf
//            dem Speicher-Pfad, Hinweis-Text über das i18n-System (de + en).
//
// Usage (aus der Repo-Wurzel):  bun quick-autosave-test.ts
// Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  QUICK_PROJECT_TITLE_MAX,
  quickProjectTitle,
  shouldAutoSaveQuick,
} from './src/lib/quick-autosave';

let passed = 0;
let failed = 0;
function check(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + label);
  } else {
    failed++;
    console.log('  ✗ ' + label);
  }
}

const ROOT = __dirname;
const quick = readFileSync(join(ROOT, 'src/components/QuickGenerator.tsx'), 'utf8');
const de = readFileSync(join(ROOT, 'src/i18n/de.ts'), 'utf8');
const en = readFileSync(join(ROOT, 'src/i18n/en.ts'), 'utf8');
const projectsStore = readFileSync(join(ROOT, 'src/store/projects.ts'), 'utf8');

// ── Teil A: Entscheidung (pure) ──────────────────────────────────────────────
console.log('\n[A] Auto-Save-Entscheidung Einzelgenerator (pure)');
check(
  shouldAutoSaveQuick({ runFinished: true, hasContent: true, alreadySaved: false }) === true,
  'abgeschlossener Lauf mit Inhalt, noch nichts gespeichert ⇒ Auto-Save',
);
check(
  shouldAutoSaveQuick({ runFinished: false, hasContent: true, alreadySaved: false }) === false,
  'nicht abgeschlossener Lauf ⇒ KEIN Auto-Save',
);
check(
  shouldAutoSaveQuick({ runFinished: true, hasContent: false, alreadySaved: false }) === false,
  'leerer Inhalt ⇒ KEIN Auto-Save (kein leeres Projekt)',
);
check(
  shouldAutoSaveQuick({ runFinished: true, hasContent: true, alreadySaved: true }) === false,
  'bereits gespeichert (manuell ODER Auto-Save) ⇒ KEIN Auto-Save (idempotent)',
);
check(
  shouldAutoSaveQuick({
    runFinished: true,
    hasContent: true,
    alreadySaved: false,
    saveInFlight: true,
  }) === false,
  'laufender Speichervorgang ⇒ KEIN Auto-Save (kein Duplikat)',
);

console.log('\n[A2] Projektname (Kanal-Label + Kurzform der Idee, i18n-fähig)');
check(
  quickProjectTitle('SEO-Blog', 'Kerzen aus Sojawachs') === 'SEO-Blog: Kerzen aus Sojawachs',
  'Label + Idee ⇒ „SEO-Blog: Kerzen aus Sojawachs"',
);
check(
  quickProjectTitle('Pinterest-Pin', '  Kerzen   aus\nSojawachs ') ===
    'Pinterest-Pin: Kerzen aus Sojawachs',
  'Whitespace der Idee wird normalisiert',
);
check(
  quickProjectTitle('Etsy-Angebot', '') === 'Etsy-Angebot',
  'leere Idee ⇒ nur das Kanal-Label (kein „: "-Rest)',
);
check(
  quickProjectTitle('', 'Kerzen') === 'Kerzen',
  'fehlendes Label ⇒ nur die Idee',
);
const longTitle = quickProjectTitle('SEO-Blog', 'x'.repeat(200));
check(
  longTitle.length <= QUICK_PROJECT_TITLE_MAX && longTitle.endsWith('...'),
  `langer Name wird auf ${QUICK_PROJECT_TITLE_MAX} Zeichen gekürzt (mit „...")`,
);

// ── Teil B: Verdrahtung im echten Quick-Generator ────────────────────────────
console.log('\n[B] Verdrahtung in src/components/QuickGenerator.tsx');
check(
  (quick.match(/shouldAutoSaveQuick\(/g) ?? []).length === 1,
  'genau EIN Auslösepunkt der Auto-Save-Entscheidung',
);
check(
  quick.includes('runFinished: true'),
  'Auslöser meldet den Lauf als abgeschlossen (runFinished: true)',
);
check(
  quick.includes('hasContent: Boolean(generated?.body)'),
  'Auslöser prüft echten Inhalt (hasContent aus dem generierten body)',
);
check(
  quick.indexOf('AUTO-SAVE nach erfolgreicher Einzel-Generierung') >
    quick.indexOf('recordGeneration(uid);'),
  'Auto-Save steht NACH dem Zähler des Laufs (Reihenfolge: generieren → zählen → speichern)',
);
check(
  quick.includes('void persistResult(generated, uid, true)') &&
    quick.includes('await persistResult(result, uid, false)'),
  'manueller und automatischer Save nutzen denselben Pfad persistResult()',
);
check(
  (quick.match(/await saveProject\(/g) ?? []).length === 1,
  'genau EIN saveProject()-Aufruf (kein zweiter Speicherpfad im Einzelgenerator)',
);
check(
  quick.includes('if (savedProjectRef.current) return;'),
  'manuelles Speichern erzeugt kein zweites Projekt (Idempotenz)',
);
check(
  quick.includes('savedProjectRef.current = null;') &&
    quick.includes('savedProjectRef.current !== null'),
  'je Lauf genau eine Auto-Save-Chance (Lauf-Reset + Lauf-Merker)',
);
check(
  quick.includes("if (saveInFlightRef.current) return false;") &&
    quick.includes('if (!content || !content.body) return false;'),
  'Speicherpfad bricht bei leerem Inhalt und bei laufendem Save ab',
);
check(
  (quick.match(/savedProjectRef\.current \?\? savedProjectId/g) ?? []).length === 2,
  'Verbessern UND A/B-Varianten schreiben in dasselbe Projekt (updateChannel)',
);
check(
  quick.includes('contentTypes: [contentType]'),
  'Projekt trägt genau den contentType des Laufs (Blog/Pinterest/Etsy bedient dieselbe Komponente)',
);
const quickRoutes = ['blog', 'pinterest', 'etsy'].map((name) =>
  readFileSync(join(ROOT, `src/routes/app/generate/${name}.tsx`), 'utf8'),
);
check(
  quickRoutes.every((r) => r.includes('QuickGeneratorPage')) &&
    quickRoutes.map((r) => (r.match(/contentType: '([a-z_]+)'/) ?? [])[1]).join(',') ===
      'seo_blog,pinterest_pin,etsy_listing',
  'alle drei Einzelgeneratoren (seo_blog, pinterest_pin, etsy_listing) laufen über QuickGenerator',
);
check(
  quick.includes('quickProjectTitle(contentTypeLabel(t, contentType), productIdea)'),
  'Projektname aus Kanal-Label (i18n) + Kurzform der Idee',
);
check(
  quick.includes('data-testid="quick-autosave-hint"') &&
    quick.includes('autoSaveStatus === \'saved\' ? t.gen_autosaved : t.gen_autosaving'),
  'sichtbarer Hinweis „Automatisch gespeichert" nach dem Auto-Save',
);
check(
  (quick.match(/gen_save_project/g) ?? []).length === 1,
  'der Button „In Projekt speichern" bleibt erhalten',
);

console.log('\n[B2] Zähl-Semantik: Speichern = 0 Generierungen');
check(
  !/usage-guard|qIncrementUsage|recordGeneration\(/.test(projectsStore),
  'src/store/projects.ts (Speicherpfad) enthält keinen usage-guard/Increment',
);
check(
  !/from '~\/lib\/usage-guard'|import\('~\/lib\/usage-guard'\)|withGenerationGuard\(/.test(quick),
  'QuickGenerator.tsx importiert/ruft keinen usage-guard (Speichern kostet nichts)',
);

console.log('\n[B3] i18n-Parität der neuen Keys (de + en)');
for (const key of ['gen_autosaved', 'gen_autosaving']) {
  check(
    de.includes(`  ${key}:`) && en.includes(`  ${key}:`),
    `${key} existiert in de.ts UND en.ts`,
  );
}

console.log(`\nERGEBNIS: ${passed} PASS / ${failed} FAIL`);
if (failed > 0) process.exit(1);
