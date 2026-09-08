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

export interface TrackAnalyticsOptions {
  channel?: AnalyticsChannel;
  status?: AnalyticsStatus;
  durationMs?: number;
  referrerHost?: string;
  utmSource?: string;
  route?: string;
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
 * Record an analytics event. Fire-and-forget: never throws, never blocks.
 * Missing/empty optional context is simply omitted (the server validates).
 */
export function trackAnalytics(
  event: AnalyticsEvent,
  opts: TrackAnalyticsOptions = {},
): void {
  try {
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
    void fetch("/api/analytics-events", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      /* analytics must never surface errors */
    });
  } catch {
    /* analytics must never surface errors */
  }
}
