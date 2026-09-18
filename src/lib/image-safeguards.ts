/**
 * Phase 3 (Stabilisierung) — Client-seitige Härtung für die Bildgenerierung
 * des Image-Studios (Ursachen-Cluster C6/C5).
 *
 * Vorher: `image-studio.tsx` rief den ServerFn direkt auf; `setLoading(false)`
 * stand NUR im `finally`. Settelte der Promise nie (hängender Request,
 * abgerissene Mobilfunk-Verbindung, Cold-Start > Server-Timeout), blieb die
 * Skeleton-Karte mit „Generiere Bild… · Ns“ UNBEGRENZT stehen — der Nutzer
 * hatte keinen Ausweg (kein Timeout, kein Abbrechen).
 *
 * Jetzt läuft jeder Studio-Aufruf (Hauptkarte, Variation, Neu generieren)
 * durch diese Guard — analog zum TikTok-Muster (`lib/tiktok-safeguards.ts`):
 *   - Timeout  : bricht den Aufruf nach IMAGE_CLIENT_TIMEOUT_MS ab (~120 s).
 *   - Abbruch  : der „Abbrechen“-Button ruft abort('user') → Abbruch sofort.
 * Beide Wege nutzen `AbortSignal`; TanStack Start reicht das Signal an den
 * zugrunde liegenden fetch durch, sodass kein Zombie-Request hängen bleibt.
 * Der Aufrufer MUSS im `finally` ein `setLoading(false)` haben (image-studio
 * tut das) — die Guard garantiert, dass die Promise immer settelt.
 *
 * Reine, testbare Funktionen: kein React-, kein Node-spezifischer Import.
 */

export type ImageAbortReason = 'user' | 'timeout';

/** Wird geworfen, wenn ein Lauf abgebrochen wurde (Button oder Timeout). */
export class ImageClientAbortError extends Error {
  readonly reason: ImageAbortReason;
  constructor(reason: ImageAbortReason) {
    super(reason === 'timeout' ? 'Image request timed out' : 'Image request aborted');
    this.name = 'ImageClientAbortError';
    this.reason = reason;
  }
}

export interface GuardedImageRun<T> {
  /** Settelt, sobald `run` fertig ist — oder mit ImageClientAbortError. */
  promise: Promise<T>;
  /** Bricht den Lauf ab („Abbrechen“-Button). Zweiter Aufruf ist No-op. */
  abort: (reason?: ImageAbortReason) => void;
  /** Aktueller Abbruchgrund (für die ehrliche UI-Meldung) — null = läuft. */
  reason: () => ImageAbortReason | null;
}

/**
 * Gesamt-Timeout eines Bild-Aufrufs im Client.
 * Messbasis: real 16–23 s Generierung plus Cold-Start/Kaltstart-Reserve
 * (`/home/team/shared/image-gen-latency-analysis.md`); bewusst großzügig,
 * damit ein langsamer, aber erfolgreicher Lauf nicht abgeschnitten wird.
 */
export const IMAGE_CLIENT_TIMEOUT_MS = 120_000;

export function guardImageRun<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = IMAGE_CLIENT_TIMEOUT_MS,
): GuardedImageRun<T> {
  const controller = new AbortController();
  let reason: ImageAbortReason | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Phase 3.1 — die Guard settelt IMMER: sie raced den Lauf gegen das
  // Abort-Signal. Selbst wenn der Aufrufer das Signal ignoriert (oder ein
  // ServerFn-Promise nie settelt), endet der Ladezustand nach dem Timeout.
  let abortReject: ((e: unknown) => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    abortReject = reject;
  });
  const onAbort = () => {
    abortReject?.(new ImageClientAbortError(reason ?? 'timeout'));
  };
  if (typeof controller.signal.addEventListener === 'function') {
    controller.signal.addEventListener('abort', onAbort, { once: true });
  }
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      reason = 'timeout';
      controller.abort();
    }, timeoutMs);
  }
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const promise = (async () => {
    let runner: Promise<T>;
    try {
      runner = run(controller.signal);
    } catch (err) {
      clear();
      throw err;
    }
    // Verliert der Lauf das Rennen, darf seine spätere Ablehnung nicht als
    // unbehandelte Rejection auftauchen.
    void runner.catch(() => { /* Rennen verloren — Ergebnis wird nicht mehr gebraucht */ });
    try {
      return await Promise.race([runner, aborted]);
    } catch (err) {
      if (reason) throw new ImageClientAbortError(reason);
      // Ohne eigenen Abbruchgrund abgebrochene Verbindung (z. B. Server hat
      // den Request fallen gelassen): als Timeout melden — nie hängen lassen.
      if (controller.signal.aborted) throw new ImageClientAbortError('timeout');
      throw err;
    } finally {
      clear();
    }
  })();
  return {
    promise,
    abort: (r: ImageAbortReason = 'user') => {
      if (!reason) {
        reason = r;
        controller.abort();
      }
    },
    reason: () => reason,
  };
}

/**
 * i18n-Schlüssel für die ehrliche Fehlermeldung (Timeout/Abbruch/generisch).
 * Reine Abbildung → direkt testbar, ohne die UI zu rendern.
 */
export function imageErrorTextKey(
  reason: ImageAbortReason | null,
): 'image_studio_error_timeout' | 'image_studio_error_aborted' | 'image_studio_error' {
  if (reason === 'timeout') return 'image_studio_error_timeout';
  if (reason === 'user') return 'image_studio_error_aborted';
  return 'image_studio_error';
}

/**
 * Phase 3.4 — Speicherlast der Daten-URL-Bilder begrenzen (Android-Härtung).
 * Jedes 2:3-PNG ist ~2,0 MB als Base64 im React-State und im DOM; unbegrenzt
 * viele Karten erzeugen auf Android Speicherdruck bis zum Tab-Freeze.
 * Deshalb: nur die letzten `max` Bilder behalten (neueste zuerst).
 * `dropped` sagt der UI, ob sie den Hinweis anzeigen muss.
 */
export const IMAGE_GALLERY_MAX = 8;

export function capGallery<T>(items: T[], max: number = IMAGE_GALLERY_MAX): { items: T[]; dropped: number } {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
  if (items.length <= limit) return { items: items.slice(), dropped: 0 };
  return { items: items.slice(0, limit), dropped: items.length - limit };
}
