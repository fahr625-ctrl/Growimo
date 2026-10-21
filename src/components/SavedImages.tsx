// ─────────────────────────────────────────────────────────────────────────────
// K4-B (UI-Anbindung) — Bausteine für die Anzeige der DAUERHAFT gespeicherten Bilder
// ─────────────────────────────────────────────────────────────────────────────
// Warum eine eigene Datei: Bild-Studio und Projektseite brauchen dieselbe Wahrheit
// über „was liegt dauerhaft im Konto" — Abruf (GET /api/images), ehrliche
// Zustände (503/„nicht konfiguriert"/Warnung), Download der Original-Bytes
// (GET /api/images/<id>) und Vorschau-Laden. Zwei Kopien würden auseinanderlaufen.
//
// Hausregel: Die Galerie verspricht NICHTS, was nicht belegt ist.
//  * Ohne Metadaten aus der DB zeigt die Galerie nur die Sitzungsbilder (wie vor
//    K4-B) — kein „gespeichert"-Badge, kein leeres Versprechen.
//  * Ein gespeichertes Bild hat im Browser KEINE Pixel (die Liste enthält bewusst
//    keine). Die Karte lädt die Vorschau erst bei Bedarf über die Route — und
//    wenn das scheitert, steht das da statt eines kaputten Bildrahmens.
//  * Der Download nutzt IMMER die Route (Original-Bytes, attachment) und NIE
//    eine private Store-URL.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '~/i18n';
import { imageDownloadFilename } from '~/lib/image-download';
import { formatDateTime } from '~/lib/date';
import {
  SAVED_IMAGES_RETRY_DELAY_MS,
  fetchSavedImageBytes,
  fetchSavedImagesWithRetry,
  isSavedImagesHardError,
  storageStatusParts,
  type GalleryEntry,
  type SavedImagesFetchResult,
  type SavedImagesReport,
} from '~/lib/saved-images-client';

/** Wie viele gespeicherte Bilder ihre Vorschau automatisch laden (Netz-Budget). */
export const SAVED_PREVIEW_AUTOLOAD = 6;
/** Schrittweite des „weitere anzeigen"-Knopfes. */
export const SAVED_PREVIEW_PAGE = 12;

/**
 * Lädt die Original-Bytes über die Route und startet den Download. Gibt `true`
 * nur zurück, wenn der Browser den Download wirklich angestoßen hat — die UI
 * meldet sonst ehrlich einen Fehler (kein stiller Nicht-Download).
 */
export async function downloadSavedImage(id: string): Promise<boolean> {
  const result = await fetchSavedImageBytes(id);
  if (!result.ok) return false;
  try {
    const objectUrl = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = imageDownloadFilename(id, result.contentType);
    a.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return true;
  } catch {
    return false;
  }
}

export interface SavedImagesState {
  result: SavedImagesFetchResult | null;
  loading: boolean;
  /** true ⇒ der einzige Wiederholungsversuch läuft gerade (Live-Fund 2026-10-20). */
  retrying: boolean;
  /** Anzahl gestarteter Requests des letzten Laufs (1 = ohne Wiederholung). */
  attempts: number;
  /**
   * true ⇒ ENDGÜLTIGER Lade-/Netzwerkfehler (kein 404). Die UI muss das sichtbar
   * zeigen — eine still leere Galerie wäre eine falsche Aussage über die Daten.
   */
  failed: boolean;
  /** Fertige Liste (leer, wenn der Abruf nicht `ok` war — nie geraten). */
  images: GalleryEntry[];
  /** Der volle Bericht für Statuszeile und Warnung (nur bei `ok`). */
  report: SavedImagesReport | null;
  /** Erneut abrufen (nach jeder neuen Generierung — billig, keine Generierung). */
  refresh: () => void;
}

/**
 * Meta-Liste der gespeicherten Bilder. `projectId` filtert auf ein Projekt
 * (Projektansicht); ohne Filter kommt der ganze Bestand (Studio).
 *
 * Der Abruf kostet KEINE Generierung (reine DB-/Meta-Abfrage) und läuft nur,
 * wenn der Nutzer eingeloggt ist (`enabled`).
 */
export function useSavedImages(options: { projectId?: string | null; enabled?: boolean } = {}): SavedImagesState {
  const { projectId = null, enabled = true } = options;
  const [result, setResult] = useState<SavedImagesFetchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [nonce, setNonce] = useState(0);
  const aliveRef = useRef(true);
  // Jeder Lauf bekommt eine Nummer: nur der JÜNGSTE darf den Zustand setzen. So
  // kann ein verspäteter (oder wiederholter) Abruf keinen neueren überschreiben
  // und es landet nie eine doppelte Ladung in der Galerie.
  const runRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const run = runRef.current + 1;
    runRef.current = run;
    const isCurrent = () => aliveRef.current && runRef.current === run;
    setLoading(true);
    setRetrying(false);
    // EIN Wiederholungsversuch bei Netzfehler/5xx (Live-Fund 2026-10-20: der
    // eigene Aufruf kam mit 503, derselbe Aufruf 11 ms später mit 200). Lesen
    // kostet 0 Generierungen; das Ergebnis des LETZTEN Versuchs gewinnt.
    void fetchSavedImagesWithRetry({
      delayMs: SAVED_IMAGES_RETRY_DELAY_MS,
      onRetry: () => { if (isCurrent()) setRetrying(true); },
      shouldContinue: isCurrent,
      sleep: (ms) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
    }).then((outcome) => {
      if (!isCurrent()) return;
      setResult(outcome.result);
      setAttempts(outcome.attempts);
      setRetrying(false);
      setLoading(false);
    });
    return () => { /* `runRef` entwertet den Lauf; kein setState nach Unmount */ };
  }, [enabled, nonce, projectId]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const report = result?.kind === 'ok' ? result.report : null;
  const images: GalleryEntry[] = report
    ? report.images
        .filter((entry) => (projectId ? entry.projectId === projectId : true))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map((entry) => ({
          key: entry.id,
          id: entry.id,
          url: null,
          prompt: entry.prompt ?? '',
          aspectRatio: entry.aspectRatio ?? '',
          createdAt: Date.parse(entry.createdAt) || 0,
          stored: true,
          preview: false,
          projectId: entry.projectId,
          sizeLabel: entry.sizeLabel,
          expiresAt: entry.expiresAt,
        }))
    : [];

  return { result, loading, retrying, attempts, failed: isSavedImagesHardError(result), images, report, refresh };
}

/** Ehrliche Statuszeile („X von 200 Bildern · Y MB") + Warnung, sonst `null`. */
export function useSavedStorageStatus(report: SavedImagesReport | null): { status: string | null; warning: string | null } {
  const { t } = useTranslation();
  if (!report) return { status: null, warning: null };
  const parts = storageStatusParts(report);
  const status = parts.capped
    ? t.image_studio_saved_status
        .replace('%s', String(parts.count))
        .replace('%s', String(parts.limit))
        .replace('%s', parts.liveLabel)
    : t.image_studio_saved_status_nocap
        .replace('%s', String(parts.count))
        .replace('%s', parts.liveLabel);
  const warning = parts.warning
    ? t.image_studio_saved_warning
        .replace('%s', parts.liveLabel)
        .replace('%s', parts.capLabel || (report.capBytes > 0 ? String(report.capBytes) : '—'))
    : null;
  return { status, warning };
}

/**
 * Karte eines gespeicherten Bildes. Die Vorschau wird — nur wenn `autoLoad`
 * gesetzt ist — über die Route geladen (Original-Bytes, keine Store-URL) und in
 * eine Blob-URL gewandelt. Scheitert das, bleibt die Karte benutzbar und sagt
 * ehrlich, dass der Download das Original liefert.
 */
export function SavedImageCard({
  entry,
  autoLoad,
  onDownloadError,
  testId = 'saved-image-card',
}: {
  entry: GalleryEntry;
  autoLoad: boolean;
  onDownloadError?: () => void;
  testId?: string;
}) {
  const { t, locale } = useTranslation();
  const [preview, setPreview] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!autoLoad || !entry.id) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    void fetchSavedImageBytes(entry.id).then((res) => {
      if (cancelled) return;
      if (!res.ok) { setFailed(true); return; }
      try {
        objectUrl = URL.createObjectURL(res.blob);
        setPreview(objectUrl);
      } catch {
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [autoLoad, entry.id]);

  const ratioClass =
    entry.aspectRatio === '2:3' ? 'aspect-[2/3]'
      : entry.aspectRatio === '4:3' ? 'aspect-[4/3]'
        : entry.aspectRatio === '16:9' ? 'aspect-video'
          : entry.aspectRatio === '9:16' ? 'aspect-[9/16]'
            : 'aspect-square';

  const handle = async () => {
    if (!entry.id) return;
    setBusy(true);
    const ok = await downloadSavedImage(entry.id);
    setBusy(false);
    if (!ok) onDownloadError?.();
  };

  return (
    <article data-testid={testId} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md">
      <div className={`relative ${ratioClass} bg-gray-100`}>
        {preview
          ? <img data-testid="saved-image-preview" src={preview} alt={entry.prompt} className="h-full w-full object-cover" />
          : <div className="flex h-full w-full items-center justify-center bg-gray-100 px-4 text-center text-xs text-gray-500">
              {failed ? t.image_studio_saved_preview_failed : t.image_studio_saved_loading_preview}
            </div>}
        {entry.aspectRatio && <span className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-gray-700">{entry.aspectRatio}</span>}
        <span
          data-testid="saved-image-badge"
          title={t.image_studio_saved_badge_hint}
          className="absolute right-3 top-3 rounded-full bg-emerald-600/90 px-3 py-1 text-xs font-bold text-white"
        >
          ✓ {t.image_studio_saved_badge}
        </span>
      </div>
      <div className="space-y-1 px-4 pt-3 text-[11px] text-gray-500">
        {entry.sizeLabel && <p data-testid="saved-image-size">{entry.sizeLabel}</p>}
        {entry.createdAt > 0 && <p>{formatDateTime(new Date(entry.createdAt), locale)}</p>}
        {entry.expiresAt && <p data-testid="saved-image-expires">{t.image_studio_saved_expires.replace('%s', formatDateTime(new Date(entry.expiresAt), locale))}</p>}
      </div>
      <div className="p-4">
        <button
          type="button"
          data-testid="saved-image-download"
          disabled={!entry.id || busy}
          onClick={() => void handle()}
          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:bg-gray-200 disabled:opacity-60"
        >
          {busy ? <span className="inline-block animate-spin">◌</span> : '⬇'} {t.image_studio_saved_download}
        </button>
      </div>
    </article>
  );
}

/**
 * Fertiger Abschnitt „Gespeicherte Bilder" (Projektseite). Selbsttragend: eigener
 * Abruf, ehrliche Zustände, keine Erfolgsmeldung ohne Daten.
 *
 *  * `unauthorized`/404     → der Abschnitt verschwindet vollständig (die Seite
 *    bleibt genau wie vor K4-B nutzbar; die Route fehlt in der Live-Version noch).
 *  * `error` (endgültig)     → sichtbarer Hinweis + „erneut versuchen" statt einer
 *    still leeren Galerie (Live-Fund 2026-10-20).
 *  * `storage_unavailable`   → klarer Hinweis statt kaputter Galerie.
 *  * `storageConfigured:false` → getrennter Hinweis (Liste geht, Ablegen nicht).
 */
export function SavedImagesPanel({
  projectId = null,
  titleKey = 'proj_saved_images_title',
  emptyKey = 'proj_saved_images_empty',
}: {
  projectId?: string | null;
  titleKey?: 'proj_saved_images_title' | 'image_studio_saved_title';
  emptyKey?: 'proj_saved_images_empty';
}) {
  const { t } = useTranslation();
  const { result, images, report, loading, refresh } = useSavedImages({ projectId });
  const { status, warning } = useSavedStorageStatus(report);
  const [visible, setVisible] = useState(SAVED_PREVIEW_PAGE);
  const [downloadError, setDownloadError] = useState(false);

  if (!result || result.kind === 'unauthorized') return null;
  if (result.kind === 'storage_unavailable') {
    return (
      <section data-testid="saved-images-unavailable" className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-lg font-bold text-amber-900">{t[titleKey]}</h2>
        <p className="mt-1 text-sm text-amber-800">{t.image_studio_saved_unavailable}</p>
      </section>
    );
  }
  if (result.kind !== 'ok') {
    // Live-Fund 2026-10-20: ein endgültiger Ladefehler darf NICHT als „keine
    // Bilder" durchgehen. 404 (Route fehlt in dieser Version) bleibt still.
    if (!isSavedImagesHardError(result)) return null;
    return (
      <section data-testid="saved-images-load-error" className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5">
        <h2 className="text-lg font-bold text-red-900">{t[titleKey]}</h2>
        <p className="mt-1 text-sm text-red-800">{t.image_studio_saved_load_failed}</p>
        <button
          type="button"
          data-testid="saved-images-load-retry"
          onClick={refresh}
          className="mt-3 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
        >
          {t.image_studio_saved_load_retry}
        </button>
      </section>
    );
  }
  const shown = images.slice(0, visible);

  return (
    <section data-testid="saved-images-panel" className="mt-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold text-gray-900">{t[titleKey]}</h2>
        {status && <p data-testid="saved-images-status" className="text-xs font-semibold text-gray-500">{status}</p>}
      </div>
      {!report?.storageConfigured && (
        <p data-testid="saved-images-not-configured" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          {t.image_studio_saved_not_configured}
        </p>
      )}
      {warning && (
        <p data-testid="saved-images-warning" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">{warning}</p>
      )}
      {downloadError && (
        <p data-testid="saved-images-download-error" className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          {t.image_studio_saved_download_failed}
        </p>
      )}
      {loading && images.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">{t.common_loading}</p>
      ) : images.length === 0 ? (
        <p data-testid="saved-images-empty" className="mt-3 text-sm text-gray-500">{t[emptyKey]}</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
            {shown.map((entry, index) => (
              <SavedImageCard
                key={entry.key}
                entry={entry}
                autoLoad={index < SAVED_PREVIEW_AUTOLOAD}
                onDownloadError={() => setDownloadError(true)}
              />
            ))}
          </div>
          {images.length > shown.length && (
            <button
              type="button"
              data-testid="saved-images-more"
              onClick={() => setVisible((v) => v + SAVED_PREVIEW_PAGE)}
              className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              {t.image_studio_saved_more.replace('%s', String(images.length - shown.length))}
            </button>
          )}
        </>
      )}
    </section>
  );
}
