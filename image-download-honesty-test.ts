// ─────────────────────────────────────────────────────────────────────────────
// K4-A — Ehrlicher Download im Bild-Studio (Owner-Entscheid 2026-10-18)
// ─────────────────────────────────────────────────────────────────────────────
//   Teil A — die pure Namens-/Endungslogik (src/lib/image-download.ts): die
//            Dateiendung folgt dem ECHTEN Blob-Typ (Vorschau = image/jpeg).
//   Teil B — statische Wire-Checks am echten Aufrufer
//            (src/routes/app/image-studio.tsx): Download-Button ist auf
//            Vorschau-Karten als Vorschau beschriftet, der Sitzungs-Hinweis
//            erscheint NUR nach einer frischen Generierung (nicht bei
//            wiederhergestellten Vorschauen), und die Vorschau-/Persistenz-
//            Logik selbst ist NICHT angefasst (die ersetzt K4-B).
//
// Usage (aus der Repo-Wurzel):  bun image-download-honesty-test.ts
// Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageDownloadExtension, imageDownloadFilename } from './src/lib/image-download';

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
const studio = readFileSync(join(ROOT, 'src/routes/app/image-studio.tsx'), 'utf8');
const gallery = readFileSync(join(ROOT, 'src/lib/image-gallery.ts'), 'utf8');
const de = readFileSync(join(ROOT, 'src/i18n/de.ts'), 'utf8');
const en = readFileSync(join(ROOT, 'src/i18n/en.ts'), 'utf8');

// ── Teil A: Dateiendung folgt dem echten MIME-Typ ────────────────────────────
console.log('\n[A] Dateiendung = echter Blob-Typ (pure)');
check(
  imageDownloadExtension('image/png') === '.png',
  'frisches Original (image/png) ⇒ .png (unverändert)',
);
check(
  imageDownloadExtension('image/jpeg') === '.jpg',
  'wiederhergestellte Vorschau (image/jpeg) ⇒ .jpg statt .png (K4-A-Fix)',
);
check(
  imageDownloadExtension('image/jpeg; charset=binary') === '.jpg',
  'MIME mit Parameter wird korrekt aufgelöst',
);
check(
  imageDownloadExtension('IMAGE/WEBP') === '.webp',
  'Groß-/Kleinschreibung egal (image/webp ⇒ .webp)',
);
check(
  imageDownloadExtension(undefined) === '.png' && imageDownloadExtension('') === '.png',
  'unbekannter/fehlender Typ ⇒ .png (fail-safe, Download nie ohne Endung)',
);
check(
  imageDownloadExtension('application/octet-stream') === '.png',
  'fremder Typ ⇒ .png (kein falsches Format versprechen)',
);
check(
  imageDownloadFilename('abc-123', 'image/jpeg') === 'growimo-abc-123.jpg',
  'Dateiname growimo-<id>.jpg bei Vorschau-Blob',
);
check(
  imageDownloadFilename('abc-123', 'image/png') === 'growimo-abc-123.png',
  'Dateiname growimo-<id>.png beim Original-PNG',
);

// ── Teil B: Verdrahtung im Bild-Studio ───────────────────────────────────────
console.log('\n[B] Verdrahtung in src/routes/app/image-studio.tsx');
check(
  studio.includes('imageDownloadFilename(image.id, blob.type)'),
  'Download nutzt die Endung des echten Blob-Typs',
);
check(
  !studio.includes('growimo-${image.id}.png'),
  'keine hardcodierte .png-Endung mehr (K4-A-Kernaussage)',
);
check(
  studio.includes("import { imageDownloadFilename } from '~/lib/image-download'"),
  'Helfer wird aus dem getesteten Modul importiert',
);
check(
  studio.includes('⬇ {image.preview ? t.image_studio_download_preview : t.image_studio_download}'),
  'Download-Button heißt auf Vorschau-Karten „Vorschau herunterladen"',
);
check(
  studio.includes('const freshImagesInThisMount = generatedCount > restoredCount;'),
  'Sitzungs-Hinweis nur bei frisch in diesem Mount erzeugten Bildern',
);
check(
  studio.includes('{freshImagesInThisMount && <p data-testid="image-gallery-session-hint"'),
  'Hinweis „nur in dieser Sitzung verfügbar" hängt am Frisch-Mount-Merker',
);
check(
  !studio.includes('{restoredCount > 0 && <p data-testid="image-gallery-session-hint"'),
  'Hinweis erscheint NICHT bei wiederhergestellten Vorschauen',
);
check(
  studio.includes('t.image_studio_gallery_session_hint'),
  'Hinweistext kommt aus dem i18n-System (de + en)',
);

console.log('\n[B2] Vorschau-/Persistenz-Logik unverändert (K4-B übernimmt das)');
check(
  gallery.includes('IMAGE_PREVIEW_MAX_EDGE = 720') &&
    gallery.includes('IMAGE_GALLERY_ENTRY_MAX_CHARS = 600_000') &&
    gallery.includes('IMAGE_PREVIEW_QUALITY'),
  'Schwellen/Budget der Vorschau sind unverändert',
);
check(
  studio.includes('persistGallery(next)') && studio.includes('readGallery()'),
  'Persistenz-/Restore-Pfad bleibt wie vorher',
);

console.log('\n[B3] i18n-Parität der neuen Keys (de + en)');
for (const key of ['image_studio_download_preview', 'image_studio_gallery_session_hint']) {
  check(
    de.includes(`  ${key}:`) && en.includes(`  ${key}:`),
    `${key} existiert in de.ts UND en.ts`,
  );
}

console.log(`\nERGEBNIS: ${passed} PASS / ${failed} FAIL`);
if (failed > 0) process.exit(1);
