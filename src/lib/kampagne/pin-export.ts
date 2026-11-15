// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Kampagne: Export (PNG je Pin, ZIP für alle)
// ─────────────────────────────────────────────────────────────────────────────
// Der Export benutzt KEIN neues Rendering und keinen zweiten Weg: er nimmt
// genau die PNG-Bytes, die der Server gerade gerendert hat (Data-URL aus
// pin-server.ts). Damit ist der Download immer das Bild, das der Nutzer in der
// Vorschau sieht — und der Text ist der zuletzt bearbeitete, weil die Route vor
// dem Download neu rendert (siehe `renderLatestPins` in kampagne.tsx).
//
// Das ZIP wird hier selbst geschrieben (nur „gespeichert", ohne Kompression):
// PNG ist bereits komprimiert, ein Deflate-Bringt nichts, und so braucht der
// Export keine zusätzliche Abhängigkeit. Aufbau nach PKWARE APPNOTE 6.3.x:
// lokaler Dateikopf + Daten + zentrales Verzeichnis + End-of-Central-Directory.
// ─────────────────────────────────────────────────────────────────────────────

export interface ZipEntry {
  /** Dateiname im Archiv (ASCII, ohne Pfad). */
  name: string;
  bytes: Uint8Array;
}

/** Data-URL (base64) → Bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (!comma || !meta.includes(';base64')) {
    throw new Error('not_a_base64_data_url');
  }
  const binary = atob(payload);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** CRC-32 (IEEE 802.3) — von ZIP für jede Datei verlangt. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Fester Zeitstempel (1980-01-01 00:00) — dasselbe Archiv ergibt immer dieselben
// Bytes, damit sich ein Download prüfen und vergleichen lässt.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/** Baut ein ZIP-Archiv (Methode 0 = gespeichert) aus den Einträgen. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // Signatur lokal
    lv.setUint16(4, 20, true); // Version nötig
    lv.setUint16(6, 0x0800, true); // Flags: Dateiname ist UTF-8
    lv.setUint16(8, 0, true); // Methode: gespeichert
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // komprimiert
    lv.setUint32(22, size, true); // unkomprimiert
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // kein Extra-Feld
    local.set(nameBytes, 30);
    locals.push(local, entry.bytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // Signatur zentral
    cv.setUint16(4, 20, true); // Version erstellt von
    cv.setUint16(6, 20, true); // Version nötig
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // Extra
    cv.setUint16(32, 0, true); // Kommentar
    cv.setUint16(34, 0, true); // Diskette
    cv.setUint16(36, 0, true); // interne Attribute
    cv.setUint32(38, 0, true); // externe Attribute
    cv.setUint32(42, offset, true); // Offset des lokalen Kopfs
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length + size;
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/** Dateiname eines Pins: `pin-1-text-unten-links.png`. */
export function pinFileName(index: number, layout: string): string {
  return `pin-${index + 1}-${layout}.png`;
}

/** Dateiname des Archivs: `kampagne-<name>-pins.zip` (ohne Sonderzeichen). */
export function zipFileName(campaignName: string): string {
  const slug = (campaignName || 'kampagne')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'kampagne'}-pins.zip`;
}

/** Startet den Download im Browser. Gibt die Blob-URL zurück (für Tests). */
export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): string {
  // Kopie über einen eigenen Puffer: `bytes` kann ein Ausschnitt sein, und der
  // Blob-Konstruktor nimmt das ganze dahinterliegende ArrayBuffer.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return url;
}
