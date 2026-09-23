/**
 * Stabilisierung Phase 5d — Fund 3: „Galerie nicht navigationsfest".
 *
 * Befund (belegt in der 5c-Evidence): `image-studio.tsx` hielt die Galerie in
 * einem reinen `useState([])`. Sobald die Route durch Zurück/Vorwärts oder einen
 * Reload neu gemountet wurde, war die Galerie leer („Noch keine Bilder
 * generiert", galleryImgs=0) — obwohl die Generierungen bezahlt (verbraucht)
 * waren. Bezahlter Output verschwand.
 *
 * Fix: versionierte sessionStorage-Persistenz nach dem etablierten Muster von
 * `~/lib/tiktok-recent` (Phase 4.3) — dieselben Prinzipien:
 *
 *  1. JEDE gespeicherte Aufnahme trägt ihr eigenes `version`-Feld. Aufnahmen
 *     ohne oder mit fremder Version werden beim Lesen IGNORIERT (fail-closed,
 *     keine Interpretation unbekannter Daten).
 *  2. TTL (12 h) zusätzlich zur ohnehin flüchtigen Session.
 *  3. Duplikate (gleiche `id`) werden entfernt — das Neueste gewinnt.
 *  4. Beim Laden der Route wird der Eintrag zurück in den React-State
 *     eingespielt (deckt Reload, bfcache und Zurück/Vorwärts ab).
 *
 * ── GRÖSSEN-ENTSCHEIDUNG (dokumentiert, s. Evidence „5d") ────────────────────
 * Ein Bild kommt als `data:image/png;base64,…` an (gemessen in `.run/generated`:
 * 1,26–2,41 MB PNG ⇒ 1,7–3,2 Mio. Base64-Zeichen). Die Galerie-Kappung
 * `IMAGE_GALLERY_MAX = 8` bleibt IM STATE (sie begrenzt die Speicherlast des
 * Tabs); in den sessionStorage passen so große Daten NICHT:
 *
 *  - **Anzahl:** höchstens `IMAGE_GALLERY_PERSIST_MAX = 3` Aufnahmen (die
 *    drei neuesten, neueste zuerst) — deckt den Abnahmefall D ab, begrenzt die
 *    Last.
 *  - **Vorschau:** ist eine Aufnahme größer als `IMAGE_GALLERY_ENTRY_MAX_CHARS`
 *    Zeichen, wird sie als verkleinerte Vorschau gespeichert (längste Kante
 *    `IMAGE_PREVIEW_MAX_EDGE` px, JPEG q `IMAGE_PREVIEW_QUALITY`; typ. 50–120 KB)
 *    und als `preview: true` markiert, damit die UI ehrlich darauf hinweisen
 *    kann. Das Original-Datenbild bleibt im React-State der laufenden Sitzung.
 *  - **Budgets:** harte Obergrenze `IMAGE_GALLERY_PERSIST_BUDGET_CHARS` (3,5 Mio.
 *    Zeichen) für die gesamte Nutzlast — bewusst unter dem sessionStorage-Limit
 *    (~5 MB pro Origin, den sich alle Keys des Origins teilen).
 *  - **Quota-Fallback:** schlägt `setItem` trotzdem fehl (QuotaExceededError),
 *    wird der ÄLTESTE Eintrag verworfen und erneut geschrieben, bis es passt;
 *    passt nicht einmal ein Eintrag, wird der Schlüssel ENTFERNT (fail-closed —
 *    keine halben Daten, die Galerie bleibt dann im State).
 *
 * ZAHL-SEMANTIK (Phase 8.2 — Usage): Lesen/Schreiben dieser Persistenz berührt
 * KEINEN KI-Pfad (`generateImageServer`/`withGenerationGuard`) und damit das
 * konditionale Increment in `usage_monthly` nie. Ein wiederhergestelltes Bild
 * kostet 0 Generierungen.
 *
 * KEIN DB-Schema-/ContentType-Eingriff (Konvention 4.3): es wird ausschließlich
 * sessionStorage im Browser benutzt.
 *
 * Die reinen Funktionen (buildEntry/planPersist/parseGallery/serializeGallery)
 * sind ohne React, ohne DOM und ohne Netz testbar.
 */

/** sessionStorage-Schlüssel der Studio-Galerie. */
export const IMAGE_GALLERY_STORAGE_KEY = 'growimo_image_studio_gallery';
/** Format-Version je Aufnahme (Aufnahmen anderer Version werden ignoriert). */
export const IMAGE_GALLERY_STORAGE_VERSION = 1;
/** Höchstzahl persistierter Aufnahmen (die neuesten; s. Modulkopf). */
export const IMAGE_GALLERY_PERSIST_MAX = 3;
/** Harte Obergrenze der Nutzlast in Zeichen (unter dem sessionStorage-Limit). */
export const IMAGE_GALLERY_PERSIST_BUDGET_CHARS = 3_500_000;
/** Ab dieser Länge wird eine Aufnahme nur noch als Vorschau gespeichert. */
export const IMAGE_GALLERY_ENTRY_MAX_CHARS = 600_000;
/** TTL der Persistenz (12 h, wie TikTok „Zuletzt erstellt"). */
export const IMAGE_GALLERY_TTL_MS = 12 * 60 * 60 * 1000;
/** Längste Kante der Vorschau in Pixeln. */
export const IMAGE_PREVIEW_MAX_EDGE = 720;
/** JPEG-Qualität der Vorschau. */
export const IMAGE_PREVIEW_QUALITY = 0.72;

/** Eine persistierte Studio-Aufnahme (versioniert, selbsttragend). */
export interface PersistedImageEntry {
  version: number;
  id: string;
  /** Daten-URL: Original oder (bei `preview`) die verkleinerte Vorschau. */
  url: string;
  prompt: string;
  aspectRatio: string;
  /** Erzeugungszeitpunkt der Original-Generierung (ms epoch). */
  createdAt: number;
  /** Zeitpunkt der letzten Speicherung (Basis der TTL-Prüfung, ms epoch). */
  savedAt: number;
  /** true ⇒ `url` ist eine verkleinerte Vorschau, nicht das Original. */
  preview: boolean;
}

/** Minimale Bilddaten, die die Persistenz braucht (kein React-Typ nötig). */
export interface PersistableImage {
  id: string;
  url: string;
  prompt: string;
  aspectRatio: string;
  createdAt: Date | number;
}

/** Ergebnis eines Schreibversuchs (für die UI/Tests nachvollziehbar). */
export interface GalleryWriteResult {
  /** Anzahl tatsächlich gespeicherter Aufnahmen. */
  stored: number;
  /** Anzahl Aufnahmen, die Kappung/Budget/Quota gekostet haben. */
  dropped: number;
}

const MAX_PROMPT_CHARS = 400;

/**
 * Grobe Größe eines Eintrags in Zeichen (URL + Prompt + Rahmen). Bewusst rein
 * rechnend — die Nutzlast ist eine JSON-Zeichenkette, deshalb ist die Länge in
 * Zeichen das richtige Maß für das sessionStorage-Budget.
 */
export function entryChars(entry: Pick<PersistedImageEntry, 'url' | 'prompt'>): number {
  return entry.url.length + Math.min(entry.prompt.length, MAX_PROMPT_CHARS) + 160;
}

/** Braucht diese URL eine Vorschau, um überhaupt speicherbar zu sein? */
export function needsPreview(url: string, maxChars: number = IMAGE_GALLERY_ENTRY_MAX_CHARS): boolean {
  return typeof url === 'string' && url.length > maxChars;
}

function toMillis(value: Date | number): number {
  const ms = value instanceof Date ? value.getTime() : value;
  return Number.isFinite(ms) ? ms : Date.now();
}

/**
 * Baut eine versionierte Aufnahme (reine Funktion). `url` ist die zu
 * speichernde URL (Original oder Vorschau), `preview` markiert, ob es eine
 * verkleinerte Vorschau ist. Der Prompt wird gekappt — er ist nur Beschriftung.
 */
export function buildEntry(
  image: PersistableImage,
  url: string,
  preview: boolean,
  now: number = Date.now(),
): PersistedImageEntry {
  return {
    version: IMAGE_GALLERY_STORAGE_VERSION,
    id: image.id,
    url,
    prompt: image.prompt.length > MAX_PROMPT_CHARS ? image.prompt.slice(0, MAX_PROMPT_CHARS) : image.prompt,
    aspectRatio: image.aspectRatio,
    createdAt: toMillis(image.createdAt),
    savedAt: now,
    preview,
  };
}

/**
 * Fügt eine Aufnahme an Position 0 ein, entfernt ein Duplikat (gleiche id) und
 * kappt auf `max` (Default 3). Reine Funktion.
 */
export function addEntry(
  list: readonly PersistedImageEntry[],
  entry: PersistedImageEntry,
  max: number = IMAGE_GALLERY_PERSIST_MAX,
): PersistedImageEntry[] {
  const rest = list.filter((e) => e.id !== entry.id);
  return [entry, ...rest].slice(0, Math.max(1, max));
}

export interface PlanResult {
  keep: PersistedImageEntry[];
  dropped: number;
}

/**
 * Wendet Anzahl-Kappung UND Zeichen-Budget an (reine Funktion). Die Liste ist
 * neueste-zuerst; es wird von vorn gefüllt und abgebrochen, sobald `max`
 * erreicht ist oder die nächste Aufnahme das Budget sprengen würde. So bleibt
 * die Reihenfolge der Galerie erhalten (die neuesten Bilder überleben).
 */
export function planPersist(
  list: readonly PersistedImageEntry[],
  max: number = IMAGE_GALLERY_PERSIST_MAX,
  budgetChars: number = IMAGE_GALLERY_PERSIST_BUDGET_CHARS,
): PlanResult {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
  const budget = Number.isFinite(budgetChars) && budgetChars > 0 ? budgetChars : Infinity;
  const keep: PersistedImageEntry[] = [];
  let used = 0;
  for (const entry of list) {
    if (keep.length >= limit) break;
    const size = entryChars(entry);
    if (keep.length > 0 && used + size > budget) break;
    // Der erste Eintrag wird nie am Budget verworfen — sonst wäre die Galerie
    // nach jedem Generieren leer (das älteste Budget-Element ist das neueste Bild).
    keep.push(entry);
    used += size;
  }
  return { keep, dropped: Math.max(0, list.length - keep.length) };
}

/** Serialisiert die Galerie (JSON-Array, jede Aufnahme trägt ihr Versionsfeld). */
export function serializeGallery(list: readonly PersistedImageEntry[]): string {
  return JSON.stringify(list);
}

/**
 * Validiert eine gespeicherte Liste Element für Element und gibt nur die
 * brauchbaren Aufnahmen zurück: Version stimmt, id/url/prompt vorhanden,
 * Zeitstempel endlich, TTL nicht abgelaufen, keine Duplikate, gekappt auf
 * `max` + Budget. Aufnahmen OHNE Versionsfeld werden verworfen (fail-closed).
 * Reine Funktion.
 */
export function parseGallery(
  raw: string | null,
  now: number = Date.now(),
  ttlMs: number = IMAGE_GALLERY_TTL_MS,
  max: number = IMAGE_GALLERY_PERSIST_MAX,
  budgetChars: number = IMAGE_GALLERY_PERSIST_BUDGET_CHARS,
): PersistedImageEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const valid: PersistedImageEntry[] = [];
  for (const item of parsed) {
    const e = item as Partial<PersistedImageEntry> | null;
    if (!e || typeof e !== 'object') continue;
    // Fremde/alte Aufnahmen: kein Versionsfeld oder andere Version → ignorieren.
    if (e.version !== IMAGE_GALLERY_STORAGE_VERSION) continue;
    if (typeof e.id !== 'string' || e.id.trim() === '') continue;
    if (typeof e.url !== 'string' || e.url.trim() === '') continue;
    if (typeof e.savedAt !== 'number' || !Number.isFinite(e.savedAt)) continue;
    if (Number.isFinite(ttlMs) && ttlMs > 0 && now - e.savedAt > ttlMs) continue;
    if (valid.some((x) => x.id === e.id)) continue; // Duplikat: das Neuere gewinnt
    valid.push({
      version: IMAGE_GALLERY_STORAGE_VERSION,
      id: e.id,
      url: e.url,
      prompt: typeof e.prompt === 'string' ? e.prompt : '',
      aspectRatio: typeof e.aspectRatio === 'string' ? e.aspectRatio : '2:3',
      createdAt: typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) ? e.createdAt : e.savedAt,
      savedAt: e.savedAt,
      preview: e.preview === true,
    });
  }
  return planPersist(valid, max, budgetChars).keep;
}

/**
 * Liest die geschützte Galerie aus dem sessionStorage (Version/TTL/Duplikate/
 * Budget geprüft). Fehler und Privatmodus führen zu `[]` — nie zu einem Crash.
 */
export function readGallery(now: number = Date.now()): PersistedImageEntry[] {
  try {
    return parseGallery(sessionStorage.getItem(IMAGE_GALLERY_STORAGE_KEY), now);
  } catch {
    return [];
  }
}

/**
 * Schreibt die Galerie (gekappt + Budget). Bei QuotaExceededError wird der
 * älteste Eintrag verworfen und erneut geschrieben; passt nicht einmal einer,
 * wird der Schlüssel entfernt (fail-closed). Gibt zurück, wie viele Aufnahmen
 * tatsächlich gespeichert wurden — das ist die ehrliche Zahl für die Evidence.
 */
export function writeGallery(
  list: readonly PersistedImageEntry[],
  max: number = IMAGE_GALLERY_PERSIST_MAX,
  budgetChars: number = IMAGE_GALLERY_PERSIST_BUDGET_CHARS,
): GalleryWriteResult {
  const wanted = planPersist(list, max, budgetChars).keep;
  if (wanted.length === 0) {
    clearGallery();
    return { stored: 0, dropped: list.length };
  }
  let current = wanted;
  for (;;) {
    try {
      sessionStorage.setItem(IMAGE_GALLERY_STORAGE_KEY, serializeGallery(current));
      return { stored: current.length, dropped: Math.max(0, list.length - current.length) };
    } catch {
      if (current.length <= 1) {
        // Nicht einmal eine Aufnahme passt: nichts Halbes hinterlassen.
        clearGallery();
        return { stored: 0, dropped: list.length };
      }
      current = current.slice(0, current.length - 1); // ältestes Bild opfern
    }
  }
}

/** Entfernt die gespeicherte Galerie (bewusster Aufräum-Klick; nicht der Fix). */
export function clearGallery(): void {
  try {
    sessionStorage.removeItem(IMAGE_GALLERY_STORAGE_KEY);
  } catch {
    /* sessionStorage nicht verfügbar */
  }
}

/**
 * Erzeugt aus einer Original-Daten-URL eine verkleinerte Vorschau (längste
 * Kante `IMAGE_PREVIEW_MAX_EDGE`, JPEG). Läuft NUR im Browser — in Tests/Node
 * gibt es kein `document`/`Image` und die Funktion liefert `null`; der Aufrufer
 * speichert dann das Original (und `writeGallery` entscheidet per Quota).
 */
export async function makePreviewUrl(
  dataUrl: string,
  maxEdge: number = IMAGE_PREVIEW_MAX_EDGE,
  quality: number = IMAGE_PREVIEW_QUALITY,
): Promise<string | null> {
  try {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
    if (!dataUrl.startsWith('data:image/')) return null;
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = dataUrl;
    });
    if (!img || !img.width || !img.height) return null;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    const out = canvas.toDataURL('image/jpeg', quality);
    return out.startsWith('data:image/') ? out : null;
  } catch {
    return null;
  }
}

/**
 * Baut die zu speichernden Aufnahmen aus der Galerie (neueste zuerst):
 * zu große Originale werden als Vorschau gespeichert (`preview: true`),
 * bereits als Vorschau vorliegende Aufnahmen werden unverändert übernommen.
 */
export async function buildPersistEntries(
  images: readonly PersistableImage[],
  now: number = Date.now(),
  max: number = IMAGE_GALLERY_PERSIST_MAX,
): Promise<PersistedImageEntry[]> {
  const out: PersistedImageEntry[] = [];
  for (const image of images.slice(0, Math.max(1, max))) {
    if (image.url.length <= 0) continue;
    if (needsPreview(image.url)) {
      const preview = await makePreviewUrl(image.url);
      if (preview) {
        out.push(buildEntry(image, preview, true, now));
        continue;
      }
    }
    out.push(buildEntry(image, image.url, false, now));
  }
  return out;
}

/**
 * Nimmt die komplette Galerie in die Persistenz auf und gibt das Schreibergebnis
 * zurück. Liest den aktuellen Stand NICHT neu ein: die übergebene Liste IST der
 * neue Stand (die Route hält ihn als einzige Quelle).
 */
export async function persistGallery(
  images: readonly PersistableImage[],
  now: number = Date.now(),
): Promise<GalleryWriteResult> {
  const entries = await buildPersistEntries(images, now);
  return writeGallery(entries);
}
