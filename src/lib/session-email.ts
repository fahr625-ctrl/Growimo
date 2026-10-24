// ─────────────────────────────────────────────────────────────────────────────
// SESSION-E-MAIL — woher `ensureUserRow()` die echte E-Mail nimmt
// ─────────────────────────────────────────────────────────────────────────────
// Owner-Auftrag 2026-10-24: „ensureUserRow() bekommt die E-Mail aus der Session
// (Clerk-JWT/subject), wenn verfügbar."
//
// ZWEI QUELLEN, in dieser Reihenfolge:
//   1. Claim `email` / `email_address` im `__session`-JWT (falls der Clerk-
//      Session-Token entsprechend erweitert ist) — kein zusätzlicher Request.
//   2. Clerk-Backend-API `GET /v1/users/{id}` (nur mit `CLERK_SECRET_KEY`) —
//      liefert die primäre, verifizierte E-Mail-Adresse.
//
// SICHERHEIT: Die Clerk-Abfrage läuft NUR, wenn die per JWKS verifizierte
// Session genau diesen `sub` trägt. Ein Aufruf für eine fremde clerk_id kann
// damit niemals eine fremde `users`-Zeile „heilen" (Identität nur aus dem
// Cookie, nie aus dem Payload — identisch zu usage-guard/checkout).
//
// FAIL-OPEN, ABER OHNE DATENVERLUST: Jeder Fehler (kein h3-Kontext, kein
// Secret, Netzfehler, 404) ergibt `null`. Der Aufrufer fällt dann auf das
// bisherige Verhalten zurück (Platzhalter bzw. vorhandener Wert bleibt) — es
// gibt keinen Crash und keine Löschung einer echten Adresse.
//
// CACHE: 10 Minuten pro Clerk-User im Prozessspeicher. Damit kostet die
// Heilung genau einen Clerk-Aufruf, nicht einen pro Generierung.
// ─────────────────────────────────────────────────────────────────────────────
import { normalizeEmail } from '../db/user-email';

/** Wie lange eine ermittelte E-Mail wiederverwendet wird. */
export const SESSION_EMAIL_CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { email: string | null; at: number }>();

/** Test-/Ops-Helfer: Cache leeren (z. B. nach einem E-Mail-Wechsel). */
export function clearSessionEmailCache(): void {
  cache.clear();
}

export interface SessionEmailDeps {
  /** Injizierbares fetch (Tests). Default: globales fetch. */
  fetchImpl?: typeof fetch;
  /** Injizierbare Uhr (Tests). Default: Date.now. */
  now?: () => number;
  /**
   * Injizierbare Session-Sub-Ermittlung (Tests). Default: echte
   * `__session`-Cookie-Verifikation über h3 + Clerk-JWKS.
   */
  sessionSubject?: () => Promise<string | null>;
  /** Env-Override (Tests). Default: process.env. */
  env?: Record<string, string | undefined>;
}

/**
 * Prüft den `__session`-Cookie und gibt die verifizierten Claims zurück.
 * Ohne h3-Kontext (Bun-Skripte, Unit-Tests) → null.
 */
async function currentSessionClaims(): Promise<Record<string, unknown> | null> {
  try {
    const { getRequest } = await import('@tanstack/start-server-core/request-response');
    const req = getRequest() as unknown as Request | undefined;
    const cookie = req?.headers?.get?.('cookie') ?? '';
    if (!cookie.includes('__session=')) return null;
    const { verifySessionPayload } = await import('../api/tracking');
    return await verifySessionPayload(req as Request);
  } catch {
    return null;
  }
}

/**
 * Liest die primäre E-Mail-Adresse aus der Clerk-Backend-API.
 * Fail-closed: ohne Secret oder bei jedem Fehler `null`.
 */
async function fetchClerkPrimaryEmail(
  clerkUserId: string,
  deps: SessionEmailDeps,
): Promise<string | null> {
  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  const secret = env.CLERK_SECRET_KEY;
  if (!secret) return null;
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const res = await doFetch(
      `https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      primary_email_address_id?: string;
      email_addresses?: { id?: string; email_address?: string }[];
    };
    const addresses = Array.isArray(data?.email_addresses) ? data.email_addresses : [];
    const primary =
      addresses.find((a) => a?.id && a.id === data?.primary_email_address_id) ?? addresses[0];
    return normalizeEmail(primary?.email_address);
  } catch {
    return null;
  }
}

/**
 * Echte E-Mail des Angemeldeten für `clerkUserId` — oder `null`.
 *
 * `null` bedeutet ausdrücklich „keine verlässliche Quelle": entweder ist
 * niemand angemeldet, die Session gehört zu einer ANDEREN clerk_id, oder die
 * Ermittlung ist fehlgeschlagen. Der Aufrufer darf daraus nie eine Löschung
 * ableiten, nur „nichts ändern".
 */
export async function getSessionEmailFor(
  clerkUserId: string,
  deps: SessionEmailDeps = {},
): Promise<string | null> {
  const id = String(clerkUserId ?? '').trim();
  if (!id || id === 'anonymous') return null;

  const now = (deps.now ?? Date.now)();
  const cached = cache.get(id);
  if (cached && now - cached.at < SESSION_EMAIL_CACHE_TTL_MS) return cached.email;

  // 1. Claims der verifizierten Session (kein Extra-Request).
  const claims = await currentSessionClaims();
  const sub = typeof claims?.sub === 'string' ? claims.sub : null;

  // Ohne eigenen Hook gilt: nur die EIGENE Session darf heilen.
  if (!deps.sessionSubject) {
    if (!sub || sub !== id) return null;
  } else {
    const injected = await deps.sessionSubject();
    if (!injected || injected !== id) return null;
  }

  const claimEmail =
    normalizeEmail(claims?.email) ??
    normalizeEmail((claims as Record<string, unknown> | null)?.email_address);

  const email = claimEmail ?? (await fetchClerkPrimaryEmail(id, deps));
  // Nur erfolgreiche Ermittlungen cachen — ein transienter Fehler darf die
  // Heilung nicht für 10 Minuten blockieren.
  if (email) cache.set(id, { email, at: now });
  return email;
}
