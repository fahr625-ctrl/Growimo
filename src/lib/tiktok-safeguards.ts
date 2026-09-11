/**
 * Phase 5 — Client-seitige Härtung für den TikTok-Server-Call.
 *
 * Der TikTok-Aufruf ist 1 blockierender POST über createServerFn (server-seitig
 * mit bis zu 4 sequenziellen Retries). Damit der Nutzer NIE vor einem Hänger
 * sitzt, läuft jeder Aufruf durch diese Guard:
 *   - Timeout  : bricht den Request nach TIKTOK_CLIENT_TIMEOUT_MS ab (~90 s).
 *   - Abbruch  : der „Abbrechen“-Button ruft abort('user') → Abbruch sofort.
 * Beide Wege nutzen AbortSignal — TanStack Start reicht `signal` an den
 * zugrunde liegenden fetch durch (createServerFn-Opts unterstützen signal),
 * sodass der Request tatsächlich abgebrochen wird und kein Zombie-Call hängt.
 *
 * Reine, testbare Funktionen: kein React-, kein Node-spezifischer Import.
 * Der übergebene Aufrufer (`run`) muss das Signal respektieren (tiktok.tsx
 * reicht es an generateTikTokServer weiter).
 */
export type TikTokAbortReason = 'user' | 'timeout';

/** Wird geworfen, wenn ein Lauf abgebrochen wurde (Button oder Timeout). */
export class TikTokClientAbortError extends Error {
  readonly reason: TikTokAbortReason;
  constructor(reason: TikTokAbortReason) {
    super(reason === 'timeout' ? 'TikTok request timed out' : 'TikTok request aborted');
    this.name = 'TikTokClientAbortError';
    this.reason = reason;
  }
}

export interface GuardedTikTokRun<T> {
  /** Settelt, sobald `run` fertig ist — oder mit TikTokClientAbortError. */
  promise: Promise<T>;
  /** Bricht den Lauf ab („Abbrechen“-Button). Zweiter Aufruf ist No-op. */
  abort: (reason?: TikTokAbortReason) => void;
  /** Aktueller Abbruchgrund (für die ehrliche UI-Meldung) — null = läuft. */
  reason: () => TikTokAbortReason | null;
}

/** Gesamt-Timeout des TikTok-Aufrufs im Client (Server begrenzt sich selbst
 *  härter auf TIKTOK_TIMEOUT_MS in src/ai/tiktok.ts, damit seine saubere
 *  Fehlermeldung vor dem Client-Timeout ankommt). */
export const TIKTOK_CLIENT_TIMEOUT_MS = 90_000;

export function guardTikTokRun<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = TIKTOK_CLIENT_TIMEOUT_MS,
): GuardedTikTokRun<T> {
  const controller = new AbortController();
  let reason: TikTokAbortReason | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
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
    try {
      return await run(controller.signal);
    } catch (err) {
      if (reason) throw new TikTokClientAbortError(reason);
      // Signal wurde ohne unseren gesetzten Grund abortiert (z. B. Server hat
      // die Verbindung abgebrochen): als Timeout melden — nie hängen lassen.
      if (controller.signal.aborted) throw new TikTokClientAbortError('timeout');
      throw err;
    } finally {
      clear();
    }
  })();
  return {
    promise,
    abort: (r: TikTokAbortReason = 'user') => {
      if (!reason) {
        reason = r;
        controller.abort();
      }
    },
    reason: () => reason,
  };
}