// ─────────────────────────────────────────────────────────────────────────────
// K4-A (Owner-Entscheid 2026-10-18) — ehrlicher Download im Bild-Studio
// ─────────────────────────────────────────────────────────────────────────────
// Befund (Launch-Test 2026-10-13, K4): Die Galerie hält Bilder als base64-
// Data-URLs im React-State. Nach einem Remount kommt die Karte aus der
// sessionStorage — dort liegt bewusst nur eine auf 720 px verkleinerte
// JPEG-Vorschau (src/lib/image-gallery.ts, Schwelle 600.000 Zeichen). Der
// Download nutzte diese URL unverändert, benannte die Datei aber IMMER „.png",
// obwohl der Blob `image/jpeg` war.
//
// Diese Datei enthält nur die reine Namens-/Endungs-Ableitung (keine DOM-/
// Browser-APIs), damit sie ohne Browser und ohne Kosten testbar ist
// (siehe image-download-honesty-test.ts).
//
// Bewusst KEINE Änderung an der Vorschau-/Persistenz-Logik selbst — die wird
// durch K4-B (dauerhafte Originalspeicherung) ersetzt.

/**
 * Dateiendung passend zum ECHTEN MIME-Typ des heruntergeladenen Blobs.
 * Unbekannte/fehlende Typen fallen auf `.png` zurück (bisheriges Verhalten,
 * damit ein Download nie ohne Endung endet).
 */
export function imageDownloadExtension(mimeType: string | null | undefined): string {
  const mime = String(mimeType ?? '').toLowerCase().split(';')[0].trim();
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/avif':
      return '.avif';
    case 'image/png':
      return '.png';
    default:
      return '.png';
  }
}

/** Vollständiger Dateiname eines Studio-Downloads (ohne Pfad). */
export function imageDownloadFilename(id: string, mimeType: string | null | undefined): string {
  return `growimo-${id}${imageDownloadExtension(mimeType)}`;
}
