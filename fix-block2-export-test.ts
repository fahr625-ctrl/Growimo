// ─────────────────────────────────────────────────────────────────────────────
// FIX-BLOCK 2 (2026-10-08) — Test-Suite: Text-Export (Markdown/Text).
// ─────────────────────────────────────────────────────────────────────────────
// Usage (aus der Repo-Wurzel):  bun fix-block2-export-test.ts
//
// Deckt ab:
//   1. Dateiname-Muster `growimo-<projekt>-<typ>.md` (inkl. Umlaut-Slug).
//   2. Dokument-Bauer (Markdown/Text, de/en) — rein, ohne DOM.
//   3. Verdrahtung: Projektseite + Dashboard rufen die Export-Engine wirklich
//      auf; der frühere „PDF herunterladen"-Alert-Platzhalter ist weg;
//      PDF/Word bleiben ungenutzte Platzhalter; der Bild-Download im
//      Image-Studio ist unberührt.
//   4. i18n de/en paritätisch (inkl. der neuen Export-Strings).
// Keine DB-, keine Netzwerkzugriffe: reine Funktionen + Quelltext-Checks.
// Exit-Code 0 nur, wenn alle Checks grün sind.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { buildMarkdownExport, buildTextExport, exportFileName } from './src/utils/export';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';
import type { Project, StoredContent } from './src/store/projects';

let passed = 0;
let failed = 0;
const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ PASS: ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ FAIL: ${label}`);
  }
};
const src = (p: string) => readFileSync(p, 'utf8');

const project = {
  id: 'p-1',
  title: 'Kerzen Set „Frühling“',
  productIdea: 'Handgegossene Sojawachs-Kerzen im Set',
  createdAt: new Date('2026-10-08T10:00:00Z'),
  contentTypes: ['pinterest_pin', 'etsy_listing'],
} as unknown as Project;

const contents = [
  {
    id: 'c-1',
    projectId: 'p-1',
    contentType: 'pinterest_pin',
    title: 'Pin-Titel',
    body: 'Pin-Body mit Inhalt',
    metadata: {},
  },
  {
    id: 'c-2',
    projectId: 'p-1',
    contentType: 'etsy_listing',
    title: 'Etsy-Titel',
    body: 'Etsy-Body mit Inhalt',
    metadata: {},
  },
] as unknown as StoredContent[];

console.log('— fix-block2-export-test —\n');

// ── 1. Dateiname ────────────────────────────────────────────────────────────
console.log('[1] Dateiname growimo-<projekt>-<typ>.md');
{
  const fn = exportFileName('Kerzen Set', 'pinterest_pin', 'md');
  check(fn === 'growimo-kerzen-set-pinterest-pin.md', `Muster korrekt (${fn})`);
  check(/^growimo-[a-z0-9-]+\.md$/.test(fn), 'nur ASCII, keine Leerzeichen');
  check(exportFileName('Schöne Grüße', 'etsy_listing') === 'growimo-schoene-gruesse-etsy-listing.md', 'Umlaute → ae/oe/ue, ß → ss');
  check(exportFileName('Kerzen Set', 'pinterest_pin', 'txt').endsWith('.txt'), 'Text-Variante endet auf .txt');
  check(exportFileName('   ', 'x').startsWith('growimo-export-'), 'leerer Titel fällt nicht auf leeren Slug zurück');
}

// ── 2. Dokument-Bauer ───────────────────────────────────────────────────────
console.log('\n[2] Dokument-Bauer (Markdown / Text, de+en)');
{
  const md = buildMarkdownExport(project, contents);
  check(md.startsWith('# Kerzen Set „Frühling“'), 'Markdown: H1 = Projekttitel');
  check(md.includes('> Handgegossene Sojawachs-Kerzen im Set'), 'Markdown: Produktidee als Zitat');
  check(md.includes('**Erstellt:**'), 'Markdown: deutsches Erstellt-Datum');
  check(md.includes('**Kanäle:**'), 'Markdown: Kanal-Liste');
  check(md.includes('Pin-Body mit Inhalt') && md.includes('Etsy-Body mit Inhalt'), 'Markdown: beide Kanal-Bodies enthalten');
  check(md.includes('**Pin-Titel**'), 'Markdown: Asset-Titel fett');
  check(md.indexOf('Pin-Body') < md.indexOf('Etsy-Body'), 'Markdown: Reihenfolge = Inhaltsreihenfolge');

  const mdEn = buildMarkdownExport(project, contents, 'en');
  check(mdEn.includes('**Created:**') && mdEn.includes('**Channels:**'), 'Markdown EN: Labels lokalisiert');
  check(!mdEn.includes('**Erstellt:**'), 'Markdown EN: keine deutschen Labels');

  const txt = buildTextExport(project, contents);
  check(txt.startsWith('KERZEN SET „FRÜHLING“'), 'Text: Titel in Großbuchstaben');
  check(txt.includes('Erstellt:') && txt.includes('Kanäle:'), 'Text: deutsche Labels');
  check(txt.includes('Pin-Body mit Inhalt') && txt.includes('Etsy-Body mit Inhalt'), 'Text: beide Kanal-Bodies enthalten');
  const txtEn = buildTextExport(project, contents, 'en');
  check(txtEn.includes('Created:') && txtEn.includes('Channels:'), 'Text EN: Labels lokalisiert');

  const empty = buildMarkdownExport(project, []);
  check(empty.includes('# Kerzen Set') && !empty.includes('undefined'), 'kein Inhalt → kein Crash, kein undefined');
}

// ── 3. Verdrahtung in der UI ────────────────────────────────────────────────
console.log('\n[3] Verdrahtung Projektseite + Dashboard');
{
  const projectPage = src('src/routes/app/projects/$projectId.tsx');
  check(projectPage.includes("from '~/utils/export'"), 'Projektseite importiert die Export-Engine');
  check(projectPage.includes('exportMarkdown('), 'Projektseite ruft exportMarkdown auf');
  check(projectPage.includes('data-testid="content-download-md"'), 'Projektseite: Download-Button am Ergebnis');
  check(projectPage.includes('data-testid="project-download-md"'), 'Projektseite: Download-Button am Projekt');
  check(projectPage.includes('const handleDownload = (e: React.MouseEvent)'), 'Projektseite: Download-Handler vorhanden');
  check(projectPage.includes('handleCopy'), 'Projektseite: „📋 Kopieren“ bleibt unverändert erhalten');

  const dash = src('src/routes/app/index.tsx');
  check(dash.includes('from "~/utils/export"'), 'Dashboard importiert die Export-Engine');
  check(dash.includes('exportMarkdown('), 'Dashboard ruft exportMarkdown auf');
  check(dash.includes('data-testid="project-card-download"'), 'Dashboard: Export-Button je Projektkarte');
  check(dash.includes('data-testid="dashboard-export-md"'), 'Dashboard: Export-Button in der Werkzeugleiste');
  check(dash.includes('const handleExportProject'), 'Dashboard: Export-Handler vorhanden');
  check(!dash.includes('common_coming_soon'), 'Dashboard: kein „Demnächst verfügbar“-Alert-Platzhalter mehr');
  check(!/onClick=\{\(\) => window\.alert\(t\.common_coming_soon\)\}/.test(dash), 'Dashboard: der PDF-Alert-Button ist ersetzt');

  const exportSrc = src('src/utils/export.ts');
  check(exportSrc.includes('export function exportPdfPlaceholder'), 'PDF bleibt Platzhalter (nicht implementiert)');
  check(exportSrc.includes('export function exportWordPlaceholder'), 'Word bleibt Platzhalter (nicht implementiert)');
  check(!/exportPdfPlaceholder|exportWordPlaceholder/.test(projectPage) && !/exportPdfPlaceholder|exportWordPlaceholder/.test(dash),
    'UI ruft die PDF/Word-Platzhalter nirgends auf');
  check(exportSrc.includes('a.download = filename'), 'Export nutzt a.download');

  // Bild-Download (Image-Studio) bleibt unangetastet.
  const studio = src('src/routes/app/image-studio.tsx');
  check(/\.download\s*=/.test(studio) && studio.includes('.png'), 'Image-Studio: Bild-Download (.png) unberührt');
}

// ── 4. i18n de/en ───────────────────────────────────────────────────────────
console.log('\n[4] i18n de/en');
{
  const keys = ['proj_export_download', 'proj_export_project', 'proj_export_latest_hint', 'proj_export_empty', 'proj_export_error', 'proj_export_md'];
  for (const key of keys) {
    check(
      typeof (de as unknown as Record<string, unknown>)[key] === 'string' &&
        typeof (en as unknown as Record<string, unknown>)[key] === 'string',
      `i18n de+en: ${key}`,
    );
  }
  const dk = Object.keys(de);
  const ek = Object.keys(en);
  check(dk.length === ek.length, `i18n de/en Parität (gleiche Schlüsselanzahl: de=${dk.length} en=${ek.length})`);
  check(dk.every((k) => k in en) && ek.every((k) => k in de), 'i18n keine fehlenden Schlüssel');
}

console.log(`\n=== fix-block2-export-test: ${passed} PASS, ${failed} FAIL ===`);
if (failed > 0) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}
process.exit(0);
