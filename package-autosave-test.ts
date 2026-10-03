// ─────────────────────────────────────────────────────────────────────────────
// Auto-Save nach Paket-Lauf — Test-Suite (Owner-Entscheid 2026-10-01)
// ─────────────────────────────────────────────────────────────────────────────
// Geprüft wird genau das, was der Live-E2E NICHT abdeckt:
//   Teil A — die pure Entscheidungs-/Idempotenz-Logik (src/lib/package-autosave.ts):
//            wann wird automatisch gespeichert, wann NICHT (Teilergebnis, schon
//            gespeichert, Speichervorgang läuft, kein erfolgreicher Kanal).
//   Teil B — statische Wire-Checks am echten Aufrufer (src/routes/app/package.tsx):
//            genau EIN Auslösepunkt nach Lauf-Ende, derselbe Speicher-Pfad wie
//            „Als Projekt speichern", KEIN usage-guard/-increment auf dem
//            Speicher-Pfad, Hinweis-Text über das i18n-System (de + en).
//
// Usage (aus der Repo-Wurzel):  bun package-autosave-test.ts
// Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LAST_SAVED_PACKAGE_STORAGE_KEY,
  MIN_SUCCESSFUL_CHANNELS_TO_AUTOSAVE,
  parseLastSavedPackage,
  shouldAutoSavePackage,
} from './src/lib/package-autosave';

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
const pkgRoute = readFileSync(join(ROOT, 'src/routes/app/package.tsx'), 'utf8');
const deDict = readFileSync(join(ROOT, 'src/i18n/de.ts'), 'utf8');
const enDict = readFileSync(join(ROOT, 'src/i18n/en.ts'), 'utf8');
const projectsStore = readFileSync(join(ROOT, 'src/store/projects.ts'), 'utf8');

// ── Teil A: Entscheidung ─────────────────────────────────────────────────────
console.log('\n[A] Auto-Save-Entscheidung (pure)');
check(
  MIN_SUCCESSFUL_CHANNELS_TO_AUTOSAVE === 1,
  'MIN_SUCCESSFUL_CHANNELS_TO_AUTOSAVE = 1',
);
check(
  shouldAutoSavePackage({ runFinished: true, successfulChannels: 5, alreadySaved: false }) ===
    true,
  'fertiger Lauf, 5/5 Kanäle, noch nichts gespeichert ⇒ Auto-Save',
);
check(
  shouldAutoSavePackage({ runFinished: false, successfulChannels: 5, alreadySaved: false }) ===
    false,
  'unfertiger Lauf ⇒ KEIN Auto-Save (auch wenn alle Kanäle schon da sind)',
);
check(
  shouldAutoSavePackage({ runFinished: false, successfulChannels: 1, alreadySaved: false }) ===
    false,
  'Teilergebnis (1 Kanal, Lauf läuft) ⇒ KEIN Auto-Save',
);
check(
  shouldAutoSavePackage({ runFinished: true, successfulChannels: 5, alreadySaved: true }) ===
    false,
  'bereits gespeichert (manuell ODER Auto-Save) ⇒ KEIN Auto-Save (idempotent)',
);
check(
  shouldAutoSavePackage({
    runFinished: true,
    successfulChannels: 5,
    alreadySaved: false,
    saveInFlight: true,
  }) === false,
  'laufender Speichervorgang ⇒ KEIN Auto-Save (kein Duplikat)',
);
check(
  shouldAutoSavePackage({ runFinished: true, successfulChannels: 0, alreadySaved: false }) ===
    false,
  'kein einziger erfolgreicher Kanal ⇒ KEIN Auto-Save (nichts zu speichern)',
);
check(
  shouldAutoSavePackage({ runFinished: true, successfulChannels: 1, alreadySaved: false }) ===
    true,
  'fertiger Lauf mit Teilausfall (1/5) ⇒ Auto-Save (verbrauchtes Kontingent nicht verlieren)',
);
check(
  shouldAutoSavePackage({ runFinished: true, successfulChannels: 4, alreadySaved: false }) ===
    true,
  'fertiger Lauf mit 4/5 ⇒ Auto-Save',
);
{
  // Idempotenz über mehrere Aufrufe: nach dem ersten Speichern nie wieder true.
  let saved = false;
  let triggers = 0;
  for (let i = 0; i < 3; i++) {
    if (
      shouldAutoSavePackage({
        runFinished: true,
        successfulChannels: 5,
        alreadySaved: saved,
        saveInFlight: false,
      })
    ) {
      triggers++;
      saved = true;
    }
  }
  check(triggers === 1, 'drei Auswertungen desselben Laufs ⇒ genau EIN Auto-Save');
}
{
  // Zwei Läufe nacheinander: jeder Lauf bekommt genau eine Chance.
  let savedProjectForRun: number | null = null;
  let triggers = 0;
  for (const runId of [1, 1, 2, 2]) {
    const alreadySaved = savedProjectForRun === runId;
    if (shouldAutoSavePackage({ runFinished: true, successfulChannels: 5, alreadySaved })) {
      triggers++;
      savedProjectForRun = runId;
    }
  }
  check(triggers === 2, 'zwei getrennte Läufe ⇒ zwei Projekte (kein Session-Dedup)');
}
console.log('\n[A2] Merker des zuletzt gespeicherten Pakets (fail-closed)');
check(
  LAST_SAVED_PACKAGE_STORAGE_KEY === 'growimo_package_last_saved',
  'Storage-Key stabil (growimo_package_last_saved)',
);
check(parseLastSavedPackage(null) === null, 'kein Merker ⇒ null');
check(parseLastSavedPackage('{kaputt') === null, 'kaputtes JSON ⇒ null (kein UI-Hinweis)');
check(parseLastSavedPackage('"nur-ein-string"') === null, 'falscher Typ ⇒ null');
check(parseLastSavedPackage('{}') === null, 'leeres Objekt (ohne projectId) ⇒ null');
{
  const p = parseLastSavedPackage(
    JSON.stringify({ projectId: 'p-1', title: 'Kerzen', savedAt: '2026-10-01T10:00:00Z', auto: true }),
  );
  check(
    !!p && p.projectId === 'p-1' && p.title === 'Kerzen' && p.auto === true,
    'gültiger Merker wird gelesen',
  );
  const manual = parseLastSavedPackage(JSON.stringify({ projectId: 'p-2' }));
  check(
    !!manual && manual.auto === false && manual.title === '',
    'manuell gespeichert (auto fehlt) ⇒ auto=false, keine Abstürze',
  );
}

// ── Teil B: Verdrahtung im echten Paket-Flow ─────────────────────────────────
console.log('\n[B] Verdrahtung im Paket-Flow (src/routes/app/package.tsx)');
check(
  (pkgRoute.match(/shouldAutoSavePackage\(/g) ?? []).length === 1,
  'genau EIN Auslösepunkt der Auto-Save-Entscheidung',
);
check(
  pkgRoute.includes('runFinished: true'),
  'Auslöser meldet den Lauf als abgeschlossen (runFinished: true)',
);
check(
  pkgRoute.indexOf('AUTO-SAVE nach vollständigem Paket-Lauf') >
    pkgRoute.indexOf('recordGeneration(uid);'),
  'Auto-Save steht NACH dem Zähler des Laufs (Reihenfolge: generieren → speichern)',
);
check(
  pkgRoute.includes('await persistPackage(acc, true)') &&
    pkgRoute.includes('await persistPackage(pkg.channels, false)'),
  'manueller und automatischer Save nutzen denselben Pfad persistPackage()',
);
check(
  (pkgRoute.match(/await saveProject\(/g) ?? []).length === 1,
  'genau EIN saveProject()-Aufruf im Paket-Flow (kein zweiter Speicherpfad)',
);
check(
  pkgRoute.includes('const contents = buildPackageContents(channels);'),
  'Auto-Save schreibt dieselben generated_content-Einträge (buildPackageContents)',
);
check(
  pkgRoute.includes("if (!pkg || savedProjectRef.current) return;"),
  'manuelles Speichern erzeugt kein zweites Projekt (Idempotenz)',
);
check(
  pkgRoute.includes("if (contents.length === 0) return false;") &&
    pkgRoute.includes('if (saveInFlightRef.current) return false;'),
  'Speicherpfad bricht bei leerem Paket und bei laufendem Save ab',
);
check(
  pkgRoute.includes('savedProjectRef.current = null;') &&
    pkgRoute.includes('autoSavedRunRef.current = runId;'),
  'je Lauf genau eine Auto-Save-Chance (Lauf-Reset + Lauf-Merker)',
);
check(
  pkgRoute.includes('shouldAutoSavePackage({') &&
    pkgRoute.includes('savedProjectRef.current !== null || autoSavedRunRef.current === runId'),
  'auch ein während des Laufs geklicktes manuelles Speichern blockt den Auto-Save',
);
console.log('\n[B2] Zähl-Semantik: Speichern = 0 Generierungen');
check(
  !/usage-guard|qIncrementUsage|recordGeneration\(/.test(projectsStore),
  'src/store/projects.ts (Speicherpfad) enthält keinen usage-guard/Increment',
);
check(
  !/from '~\/lib\/usage-guard'/.test(pkgRoute) &&
    !/withGenerationGuard|assertCanGenerate|qIncrementUsage/.test(pkgRoute),
  'Paket-Route ruft keinen usage-guard auf (Auto-Save kann den Zähler nicht erhöhen)',
);
check(
  pkgRoute.includes('recordGeneration(uid);'),
  'der Paket-Lauf selbst zählt weiterhin (unverändert genau 1 Aufruf)',
);
check(
  (pkgRoute.match(/recordGeneration\(uid\);/g) ?? []).length === 1,
  'kein zusätzlicher Zähler-Aufruf durch den Auto-Save',
);
console.log('\n[B3] Sichtbarkeit (i18n de + en)');
for (const key of [
  'package_autosaved',
  'package_autosaving',
  'package_saved_done',
  'package_last_saved_title',
]) {
  check(
    new RegExp(`\\b${key}:`).test(deDict) && new RegExp(`\\b${key}:`).test(enDict),
    `i18n-Key ${key} in de.ts UND en.ts vorhanden`,
  );
}
check(
  pkgRoute.includes("import {\n  LAST_SAVED_PACKAGE_STORAGE_KEY,") ||
    pkgRoute.includes('LAST_SAVED_PACKAGE_STORAGE_KEY,'),
  'Paket-Route nutzt das Auto-Save-Modul',
);
check(pkgRoute.includes('data-testid="package-autosave-hint"'), 'Hinweis-Chip im DOM markiert');
check(pkgRoute.includes('data-testid="package-last-saved"'), 'Merker-Karte im DOM markiert');
check(
  pkgRoute.includes('disabled={Boolean(savedProjectId) || autoSaveStatus === \'saving\'}') &&
    pkgRoute.includes('{savedProjectId ? t.package_saved_done : t.package_save_project}'),
  'Button zeigt „Gespeichert" und ist dann deaktiviert (manueller Weg bleibt vorhanden)',
);
check(
  pkgRoute.includes('{t.package_autosaved}'),
  'Hinweis „Automatisch gespeichert" wird gerendert',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
