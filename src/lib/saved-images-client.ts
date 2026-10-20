// ─────────────────────────────────────────────────────────────────────────────
// K4-B (UI-Anbindung) — Client-Zugriff auf die dauerhaft gespeicherten Bilder
// ─────────────────────────────────────────────────────────────────────────────
// BEFUND (Owner-Auftrag 2026-10-19, K4-B UI): Die Studio-Galerie zeigte AUSSCHLIESS-
// LICH die sessionStorage-Aufnahmen (`image-gallery.ts`). Die serverseitig
// gespeicherten Originale (`generated_images` + Blob) wurden auf keiner Seite
// gelistet — der einzige Client-Pfad zu `/api/images` war das POST beim Speichern
// (`image-studio-stream.ts`). Ein bezahlter Output war damit nach einem
// Browser-Wechsel unsichtbar, obwohl er dauerhaft vorlag.
//
// Diese Datei kapselt den LESE-Weg vollständig und ist bewusst FREI von React,
// DOM und i18n — dadurch ohne Netz, ohne Browser und ohne Kosten prüfbar
// (siehe saved-images-client-test.ts).
//
// Vertrag mit der Route (`src/api/images.ts` · `src/lib/generated-images-api.ts`):
//   GET /api/images          → JSON-Meta (NIE Pixel, NIE private Store-URL)
//   GET /api/images/<id>     → Original-Bytes als attachment (private, no-store)
// Auth läuft über das `__session`-Cookie der Seite — deshalb `credentials:
// 'same-origin'` wie im bestehenden POST-Fallback.
//
// EHRLICHE ZUSTÄNDE (Hausregel „nur versprechen, was geliefert wird"):
//   * 503 `storage_unavailable` → der Store ist nicht konfiguriert; die UI sagt
//     das und behauptet NICHT, Bilder seien gespeichert.
//   * `storageConfigured: false` in einer 200er-Antwort → Liste ist da, Download
//     kann aber scheitern; die UI kennzeichnet das getrennt.
//   * 401/403, 404 (alte Live-Version ohne die Route), Netzfehler und kaputtes
//     JSON werden zu eigenen Zweigen — nie zu einem stillen „leer".

/** Sammlungspfad der Bild-Meta-Liste (identisch zur Route). */
export const SAVED_IMAGES_PATH = '/api/images';

/** Einzelpfad eines gespeicherten Bildes (Original-Bytes als attachment). */
export function savedImagePath(id: string): string {
  return `${SAVED_IMAGES_PATH}/${encodeURIComponent(id)}`;
}

/** Eine vom Server gemeldete Zeile aus `generated_images` (keine Pixel). */
export interface SavedImageEntry {
  id: string;
  aspectRatio: string | null;
  sizeBytes: number | null;
  sizeLabel: string;
  prompt: string | null;
  projectId: string | null;
  createdAt: string;
  expiresAt: string;
}

/** Der Meta-Bericht — Felder exakt wie in `generated-images-api.ts`. */
export interface SavedImagesReport {
  count: number;
  limit: number;
  liveBytes: number;
  liveLabel: string;
  capBytes: number;
  capLabel: string;
  warnBytes: number;
  warning: boolean;
  storageConfigured: boolean;
  ttlDays: number;
  images: SavedImageEntry[];
}

/** Ergebnis eines Listen-Abrufs — jeder Zweig ist in der UI ehrlich darstellbar. */
export type SavedImagesFetchResult =
  | { kind: 'ok'; report: SavedImagesReport }
  /** 503 `storage_unavailable`: kein Store konfiguriert (fail-closed-Server). */
  | { kind: 'storage_unavailable'; status: 503 }
  /** Keine (gültige) Sitzung/Nutzerzeile — die UI zeigt keinen Fehler, nur nichts. */
  | { kind: 'unauthorized'; status: number }
  /** Route nicht vorhanden (alte Version), 5xx, Netzfehler oder kaputtes JSON. */
  | { kind: 'error'; status: number };

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Defensive Auswertung der Serverantwort. Gibt `null` zurück, wenn die Form nicht
 * stimmt (dann behandelt der Aufrufer es als Fehler statt als „leere Galerie" —
 * ein stilles Leer würde einen Defekt als „nichts gespeichert" verkaufen).
 */
export function parseSavedImagesReport(payload: unknown): SavedImagesReport | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  if (!Array.isArray(raw.images)) return null;
  const images: SavedImageEntry[] = [];
  for (const item of raw.images) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = asString(row.id).trim();
    if (!id) continue;
    images.push({
      id,
      aspectRatio: asNullableString(row.aspectRatio),
      sizeBytes: asNumber(row.sizeBytes),
      sizeLabel: asString(row.sizeLabel),
      prompt: asNullableString(row.prompt),
      projectId: asNullableString(row.projectId),
      createdAt: asString(row.createdAt),
      expiresAt: asString(row.expiresAt),
    });
  }
  return {
    count: asNumber(raw.count) ?? images.length,
    limit: asNumber(raw.limit) ?? 0,
    liveBytes: asNumber(raw.liveBytes) ?? 0,
    liveLabel: asString(raw.liveLabel),
    capBytes: asNumber(raw.capBytes) ?? 0,
    capLabel: asString(raw.capLabel),
    warnBytes: asNumber(raw.warnBytes) ?? 0,
    warning: raw.warning === true,
    // Fehlt das Feld (alte Version), gilt fail-closed „nicht konfiguriert".
    storageConfigured: raw.storageConfigured === true,
    ttlDays: asNumber(raw.ttlDays) ?? 0,
    images,
  };
}

/** Liest den Fehlercode aus einem 503-Body (nur zur Unterscheidung). */
async function storageUnavailable(response: Response): Promise<boolean> {
  try {
    const text = await response.text();
    if (!text) return true;
    const parsed = JSON.parse(text) as { code?: unknown };
    // Unlesbarer/leerer Body bei 503 dieser Route ist dokumentiert der Store-Fall.
    return parsed?.code === undefined || parsed.code === 'storage_unavailable';
  } catch {
    return true;
  }
}

/**
 * Holt die Meta-Liste. `fetchImpl` ist injizierbar (Tests) — Default ist das
 * globale `fetch` mit `credentials: 'same-origin'` wie der bestehende POST-Pfad.
 */
export async function fetchSavedImages(
  fetchImpl: typeof fetch = fetch,
  url: string = SAVED_IMAGES_PATH,
): Promise<SavedImagesFetchResult> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
  } catch {
    return { kind: 'error', status: 0 };
  }
  if (response.status === 503) {
    return (await storageUnavailable(response))
      ? { kind: 'storage_unavailable', status: 503 }
      : { kind: 'error', status: 503 };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: 'unauthorized', status: response.status };
  }
  if (!response.ok) return { kind: 'error', status: response.status };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { kind: 'error', status: response.status };
  }
  const report = parseSavedImagesReport(payload);
  if (!report) return { kind: 'error', status: response.status };
  return { kind: 'ok', report };
}

/**
 * Lädt die ORIGINAL-Bytes eines gespeicherten Bildes (nie die private Store-URL)
 * und liefert sie als Blob plus den ehrlichen Dateinamen zum echten MIME-Typ.
 */
export async function fetchSavedImageBytes(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; blob: Blob; contentType: string } | { ok: false; status: number }> {
  let response: Response;
  try {
    response = await fetchImpl(savedImagePath(id), {
      method: 'GET',
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!response.ok) return { ok: false, status: response.status };
  try {
    return { ok: true, blob: await response.blob(), contentType: response.headers.get('content-type') ?? '' };
  } catch {
    return { ok: false, status: response.status };
  }
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** Ehrliche Byte-Anzeige als Rückfall, wenn der Server kein Label mitschickt. */
export function formatBytesLabel(bytes: number | null | undefined): string {
  const value = typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (value < 1000) return `${Math.round(value)} B`;
  let scaled = value;
  let unit = 0;
  while (scaled >= 1000 && unit < BYTE_UNITS.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  return `${scaled.toFixed(scaled >= 10 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

/** Wertetabelle für die ehrliche Speicher-Statuszeile („X von 200 Bildern · Y MB"). */
export interface StorageStatusParts {
  count: number;
  limit: number;
  liveLabel: string;
  capLabel: string;
  warning: boolean;
  /** true ⇒ der Deckel ist aktiv (capBytes > 0); sonst „unbegrenzt". */
  capped: boolean;
}

/**
 * Zerlegt den Bericht in die Anzeigeteile. `count`/`limit`/`liveBytes` kommen
 * ausschließlich aus der Serverantwort — es wird nichts geschätzt. Fehlt ein
 * Label, wird es aus den Bytes gebildet (dieselbe Zahl, andere Formatierung).
 */
export function storageStatusParts(report: SavedImagesReport): StorageStatusParts {
  return {
    count: report.count,
    limit: report.limit,
    liveLabel: report.liveLabel || formatBytesLabel(report.liveBytes),
    capLabel: report.capLabel || (report.capBytes > 0 ? formatBytesLabel(report.capBytes) : ''),
    warning: report.warning,
    capped: report.capBytes > 0,
  };
}

/** Eine Aufnahme der vereinigten Galerie (Session-Pixel ODER nur Meta aus der DB). */
export interface GalleryEntry {
  /** Eindeutiger Schlüssel (die Server-ID, wenn vorhanden — sonst die Session-ID). */
  key: string;
  id: string | null;
  /** Pixel im Browser. `null` = nur in der DB (Vorschau wird separat geladen). */
  url: string | null;
  prompt: string;
  aspectRatio: string;
  createdAt: number;
  /** true ⇒ dieses Bild liegt dauerhaft im Konto (Badge „Gespeichert"). */
  stored: boolean;
  /** true ⇒ `url` ist eine verkleinerte Sitzungs-Vorschau, nicht das Original. */
  preview: boolean;
  projectId: string | null;
  sizeLabel: string | null;
  expiresAt: string | null;
}

/** Minimale Session-Sicht (deckt `StudioImage` aus image-studio.tsx ab). */
export interface SessionGalleryImage {
  id: string;
  url: string;
  prompt: string;
  aspectRatio: string;
  createdAt: Date | number;
  preview?: boolean;
  /** K4-B: „der Server hat dieses Original gespeichert" (done-Event). */
  saved?: boolean;
}

function toMs(value: Date | number): number {
  const ms = value instanceof Date ? value.getTime() : value;
  return Number.isFinite(ms) ? ms : 0;
}

function toEpoch(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

export interface MergeGalleryOptions {
  /**
   * Nur gespeicherte Bilder dieses Projekts zeigen (Projektansicht). Die
   * Session-Bilder der laufenden Sitzung bleiben unangetastet — sie sind die
   * Arbeit von gerade und dürfen nie verschwinden.
   */
  projectId?: string | null;
}

/**
 * Vereinigt Session-Galerie und gespeicherte Bilder.
 *
 * Regeln (bewusst so, weil die Session die EINZIGE Pixel-Quelle ist):
 *  1. Session-Bilder stehen vorn und behalten ihre Reihenfolge (neueste zuerst).
 *  2. Ein Session-Bild, dessen ID auch in der DB liegt, wird als `stored`
 *     markiert — die Pixel gewinnen (Session), die Metadaten kommen aus der DB.
 *     Ohne ID-Gleichheit (z. B. alter Server ohne `imageId`) markiert das Flag
 *     `saved` des done-Events den Zustand.
 *  3. Reine DB-Einträge folgen danach (neueste zuerst) mit `url: null` — es gibt
 *     im Browser keine Pixel; die UI lädt die Vorschau bewusst erst bei Bedarf.
 *  4. Duplikate werden nach ID entfernt; kein Bild erscheint zweimal.
 */
export function mergeGallery(
  session: readonly SessionGalleryImage[],
  saved: readonly SavedImageEntry[],
  options: MergeGalleryOptions = {},
): GalleryEntry[] {
  const projectFilter = options.projectId ?? null;
  const savedFiltered = projectFilter
    ? saved.filter((entry) => entry.projectId === projectFilter)
    : saved.slice();
  const savedById = new Map(savedFiltered.map((entry) => [entry.id, entry]));
  const sessionIds = new Set(session.map((image) => image.id));

  const sessionEntries: GalleryEntry[] = session.map((image) => {
    const db = savedById.get(image.id);
    return {
      key: image.id,
      id: image.id || null,
      url: image.url,
      prompt: image.prompt || db?.prompt || '',
      aspectRatio: image.aspectRatio || db?.aspectRatio || '',
      createdAt: toMs(image.createdAt) || (db ? toEpoch(db.createdAt) : 0),
      stored: image.saved === true || Boolean(db),
      preview: image.preview === true,
      projectId: db?.projectId ?? null,
      sizeLabel: db?.sizeLabel ?? null,
      expiresAt: db?.expiresAt ?? null,
    };
  });

  const savedOnly: GalleryEntry[] = savedFiltered
    .filter((entry) => !sessionIds.has(entry.id))
    .sort((a, b) => toEpoch(b.createdAt) - toEpoch(a.createdAt))
    .map((entry) => ({
      key: entry.id,
      id: entry.id,
      url: null,
      prompt: entry.prompt ?? '',
      aspectRatio: entry.aspectRatio ?? '',
      createdAt: toEpoch(entry.createdAt),
      stored: true,
      preview: false,
      projectId: entry.projectId,
      sizeLabel: entry.sizeLabel,
      expiresAt: entry.expiresAt,
    }));

  return [...sessionEntries, ...savedOnly];
}
