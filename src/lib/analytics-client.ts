// Client-side helper for Admin-Analytics MVP Phase 1 (fire-and-forget).
// NOTE: src/store/analytics.ts (existing localStorage analytics) and
// src/lib/tracking-client.ts (server-side beta-tracking) stay untouched —
// this is the SEPARATE anonymous-capable analytics system.
//
// Privacy: the client NEVER sends a userId — the server derives the pseudonym
// from the __session cookie (credentials: 'include'). Only harmless context
// (route/referrer-host/utm/channel/status/duration) is sent. Never throws,
// never blocks the calling feature.
import type { AnalyticsChannel, AnalyticsEvent, AnalyticsStatus } from "./analytics";
import { analyticsConsentHeader, isAnalyticsOptedOut } from "./analytics-consent";
import {
  isAnalyticsErrorCategory,
  isAnalyticsErrorCode,
  type AnalyticsErrorCategory,
} from "./analytics-error";

export interface TrackAnalyticsOptions {
  channel?: AnalyticsChannel;
  status?: AnalyticsStatus;
  durationMs?: number;
  referrerHost?: string;
  utmSource?: string;
  route?: string;
  /** Nur bei status === 'error': Kategorie aus der Owner-Whitelist. */
  errorCategory?: AnalyticsErrorCategory;
  /** Nur bei status === 'error': kurzer technischer Code (nie eine Meldung). */
  errorCode?: string;
}

function currentReferrerHost(): string | undefined {
  try {
    if (!document.referrer) return undefined;
    return new URL(document.referrer).hostname || undefined;
  } catch {
    return undefined;
  }
}

function currentUtmSource(): string | undefined {
  try {
    return new URLSearchParams(window.location.search).get("utm_source") || undefined;
  } catch {
    return undefined;
  }
}

function currentRoute(): string | undefined {
  try {
    const path = window.location.pathname;
    return path && path.startsWith("/") ? path : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pageview-Entdopplung (Owner-Auftrag 2026-10-26, „Pageview-Doppelzählung").
 *
 * Befund: PageviewTracker hing in `useEffect(..., [pathname])`. Bei einem
 * Seitenaufruf konnte derselbe Effekt zweimal laufen (Doppel-Mount/Hydration),
 * was zwei analytics_events-Zeilen für EINEN Seitenaufruf erzeugte (in der DB
 * belegt: Paare 5–1500 ms auseinander, route „/"). Der Server-Pfad schreibt
 * nachweislich genau eine Zeile pro Request (src/api/analytics.ts), der
 * Doppelfeuer entsteht also im Client.
 *
 * Fix: genau EINE pageview-Zeile pro Seitenaufruf — derselbe Route-Wert wird
 * pro Seiten-Lebenszyklus nur einmal gesendet. Ein echter Wechsel A→B→A zählt
 * weiterhin zweimal (nur DIREKT aufeinanderfolgende Duplikate fallen weg).
 * Opt-out/Consent-Verhalten bleibt unverändert (der Guard greift erst nach der
 * Opt-out-Prüfung und ändert weder Header noch Cookie-Verhalten).
 */
let lastPageviewRoute: string | null = null;

/** Nur für Tests: Dedup-Zustand zurücksetzen (neuer Seiten-Lebenszyklus). */
export function resetPageviewDedup(): void {
  lastPageviewRoute = null;
}

/**
 * Record an analytics event. Fire-and-forget: never throws, never blocks.
 * Missing/empty optional context is simply omitted (the server validates).
 */
export function trackAnalytics(
  event: AnalyticsEvent,
  opts: TrackAnalyticsOptions = {},
): void {
  try {
    // Widerruf (Owner-Vorgabe 2026-10-23): bei gesetztem Opt-out wird KEIN
    // Ereignis mehr gesendet — der Schalter in /datenschutz wirkt sofort.
    if (isAnalyticsOptedOut()) return;
    // Genau EIN pageview pro Seitenaufruf: ist der Route-Wert derselbe wie beim
    // letzten gesendeten pageview, wird der Aufruf verworfen (Doppel-Mount/
    // Hydration). Ohne bekannten Route-Wert (Node/SSR) keine Dedup.
    if (event === "pageview") {
      const dedupRoute = opts.route ?? currentRoute();
      if (dedupRoute) {
        if (lastPageviewRoute === dedupRoute) return;
        lastPageviewRoute = dedupRoute;
      }
    }
    const payload: Record<string, unknown> = { event };
    if (opts.channel) payload.channel = opts.channel;
    if (opts.status) payload.status = opts.status;
    if (typeof opts.durationMs === "number" && Number.isFinite(opts.durationMs)) {
      payload.durationMs = Math.max(0, Math.round(opts.durationMs));
    }
    const referrerHost = opts.referrerHost ?? currentReferrerHost();
    if (referrerHost) payload.referrerHost = referrerHost;
    const utmSource = opts.utmSource ?? currentUtmSource();
    if (utmSource) payload.utmSource = utmSource;
    const route = opts.route ?? currentRoute();
    if (route) payload.metadata = { route };
    // Fehleranalyse (additiv): NUR die zwei Kurzfelder, nur bei status='error'.
    // Server validiert Whitelist/Regex und lehnt Meldungen/Inhalte ab.
    if (opts.status === "error") {
      if (opts.errorCategory && isAnalyticsErrorCategory(opts.errorCategory)) {
        payload.errorCategory = opts.errorCategory;
      }
      if (opts.errorCode && isAnalyticsErrorCode(opts.errorCode)) {
        payload.errorCode = opts.errorCode;
      }
    }
    // Consent-Gate (additiv): nur bei ausdrücklicher Zustimmung sendet der
    // Client den Header, der serverseitig das Setzen der Besucher-Kennung
    // erlaubt. Ohne Zustimmung läuft der Request unverändert weiter (nur ohne
    // Cookie) — bestehendes Tracking wird nicht beeinflusst.
    void fetch("/api/analytics-events", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...analyticsConsentHeader() },
      body: JSON.stringify(payload),
    }).catch(() => {
      /* analytics must never surface errors */
    });
  } catch {
    /* analytics must never surface errors */
  }
}
