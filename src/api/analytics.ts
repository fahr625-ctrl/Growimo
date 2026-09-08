// ── Admin-Analytics MVP Phase 1: anonymer Schreib-Endpunkt (additiv) ───────
// POST /api/analytics-events — bewusst OHNE Owner-Gate, damit auch anonyme
// Besucher (pageview ohne Login) erfasst werden. Schutz stattdessen durch:
//  - feste Event-Whitelist (ANALYTICS_EVENTS),
//  - feste Channel-/Status-Whitelists,
//  - max. ~1 KB Body (Content-Length- + Body-Längen-Limit),
//  - In-Memory-Rate-Limit (Muster src/api/beta.ts),
//  - KEINE PII/IP-Persistierung: keine email/name/content-Felder, keine Header.
// Pseudonym-Pfad: der Client sendet NIE eine userId. Der Handler prüft optional
// das __session-Cookie via verifySessionSubject; bei gültiger Session wird
// user_pseudonym = HMAC-SHA256(ANALYTICS_SALT, clerk_id) gespeichert, sonst
// NULL (anonym). Ohne ANALYTICS_SALT → ebenfalls NULL (nie unsalted hashen,
// nie Clerk-ID im Klartext speichern).
import { createHmac } from "node:crypto";
import { qInsertAnalyticsEvent } from "../db/analytics";
import {
  isAnalyticsChannel,
  isAnalyticsEvent,
  isAnalyticsStatus,
} from "../lib/analytics";
import { verifySessionSubject } from "./tracking";

// ── Limits ───────────────────────────────────────────────────────────────────
/** Max request body accepted (~1 KB). Enforced via Content-Length + body size. */
export const ANALYTICS_BODY_LIMIT_BYTES = 1024;

/** In-memory rate limit: max N posts per IP per window (resets on cold start). */
const ANALYTICS_RATE_WINDOW_MS = 60_000;
const ANALYTICS_RATE_MAX = 60;
const analyticsRate = new Map<string, { count: number; at: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const prior = analyticsRate.get(ip);
  if (!prior || now - prior.at >= ANALYTICS_RATE_WINDOW_MS) {
    analyticsRate.set(ip, { count: 1, at: now });
    return false;
  }
  prior.count += 1;
  return prior.count > ANALYTICS_RATE_MAX;
}

// ── Field guards ─────────────────────────────────────────────────────────────
// Rejected outright (PII/content must never reach the DB, even inside metadata).
const FORBIDDEN_KEYS = new Set([
  "email",
  "name",
  "first_name",
  "firstname",
  "lastname",
  "last_name",
  "userId",
  "user_id",
  "userpseudonym",
  "user_pseudonym",
  "pseudonym",
  "clerk_id",
  "clerkid",
  "content",
  "body",
  "title",
  "prompt",
  "productIdea",
  "product_idea",
  "text",
  "message",
  "password",
  "token",
  "session",
]);

function containsForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 3 || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((v) => containsForbiddenKey(v, depth + 1));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) =>
        FORBIDDEN_KEYS.has(k) ||
        FORBIDDEN_KEYS.has(k.toLowerCase()) ||
        containsForbiddenKey(v, depth + 1),
    );
  }
  return false;
}

/** Hostname-only guard: letters/digits/dots/hyphens, max 253 chars, no URL parts. */
function sanitizeHostname(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const host = raw.trim().toLowerCase();
  if (!host || host.length > 253) return null;
  if (host.includes("/") || host.includes("?") || host.includes("#") || host.includes("@")) {
    return null;
  }
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) return null;
  return host;
}

/** utm_source guard: short token, no URLs/queries. */
function sanitizeUtm(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const v = raw.trim();
  if (!v || v.length > 100) return null;
  if (/[\s/?#@<>]/.test(v)) return null;
  return v;
}

/** Route guard: must start with /, no query/hash, max 200 chars. */
function sanitizeRoute(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const v = raw.trim();
  if (!v || v.length > 200 || !v.startsWith("/")) return null;
  if (v.includes("?") || v.includes("#") || v.includes("\\")) return null;
  return v;
}

/** Compute the pseudonym server-side. Never salt-less, never raw. */
function pseudonymFor(clerkId: string | null): string | null {
  if (!clerkId) return null;
  const salt = process.env.ANALYTICS_SALT || "";
  if (!salt) return null;
  return createHmac("sha256", salt).update(clerkId).digest("hex");
}

export async function handleAnalyticsApi(
  req: Request,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== "/api/analytics-events") return null;
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Rate limit (IP used ONLY in memory, never persisted).
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  // Body size limit: Content-Length fast path + measured text length.
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > ANALYTICS_BODY_LIMIT_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }
  let rawText: string;
  try {
    rawText = await req.text();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  if (rawText.length > ANALYTICS_BODY_LIMIT_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = rawText ? (JSON.parse(rawText) as unknown) : null;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  // Event whitelist (unknown → 400).
  if (typeof b.event !== "string" || !isAnalyticsEvent(b.event)) {
    return Response.json({ error: "Unknown event" }, { status: 400 });
  }
  const event = b.event;

  // Optional channel/status whitelists (unknown → 400, never silently stored).
  let channel: string | null = null;
  if (b.channel !== undefined && b.channel !== null) {
    if (typeof b.channel !== "string" || !isAnalyticsChannel(b.channel)) {
      return Response.json({ error: "Unknown channel" }, { status: 400 });
    }
    channel = b.channel;
  }
  let status: string | null = null;
  if (b.status !== undefined && b.status !== null) {
    if (typeof b.status !== "string" || !isAnalyticsStatus(b.status)) {
      return Response.json({ error: "Unknown status" }, { status: 400 });
    }
    status = b.status;
  }

  // duration_ms: finite non-negative number, capped at 24 h.
  let durationMs: number | null = null;
  if (b.durationMs !== undefined && b.durationMs !== null) {
    const n = typeof b.durationMs === "number" ? b.durationMs : Number(b.durationMs);
    if (!Number.isFinite(n) || n < 0 || n > 86_400_000) {
      return Response.json({ error: "Invalid durationMs" }, { status: 400 });
    }
    durationMs = Math.round(n);
  }

  const referrerHost = sanitizeHostname(b.referrerHost);
  if (b.referrerHost !== undefined && b.referrerHost !== null && referrerHost === null) {
    return Response.json({ error: "Invalid referrerHost" }, { status: 400 });
  }
  const utmSource = sanitizeUtm(b.utmSource);
  if (b.utmSource !== undefined && b.utmSource !== null && utmSource === null) {
    return Response.json({ error: "Invalid utmSource" }, { status: 400 });
  }

  // metadata: only the harmless { route } key, strictly guarded.
  let metadata: Record<string, unknown> = {};
  if (b.metadata !== undefined && b.metadata !== null) {
    if (typeof b.metadata !== "object" || Array.isArray(b.metadata)) {
      return Response.json({ error: "Invalid metadata" }, { status: 400 });
    }
    const m = b.metadata as Record<string, unknown>;
    const keys = Object.keys(m);
    if (keys.length > 1 || (keys.length === 1 && keys[0] !== "route")) {
      return Response.json({ error: "Invalid metadata" }, { status: 400 });
    }
    if (keys.length === 1) {
      const route = sanitizeRoute(m.route);
      if (route === null) {
        return Response.json({ error: "Invalid metadata" }, { status: 400 });
      }
      metadata = { route };
    }
    if (containsForbiddenKey(metadata)) {
      return Response.json({ error: "Invalid metadata" }, { status: 400 });
    }
  }

  // Reject any PII/content-bearing field outright (top-level extras like
  // email/userId/prompt, or forbidden keys nested anywhere in the payload).
  if (containsForbiddenKey(b)) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Pseudonym: server-side only, from the __session cookie (never from client).
  let clerkId: string | null = null;
  try {
    clerkId = await verifySessionSubject(req);
  } catch {
    clerkId = null;
  }
  const userPseudonym = pseudonymFor(clerkId);

  await qInsertAnalyticsEvent({
    userPseudonym,
    event,
    channel,
    status,
    durationMs,
    referrerHost,
    utmSource,
    metadata,
  });
  return Response.json({ ok: true }, { status: 202 });
}
