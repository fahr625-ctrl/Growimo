// HTTP-Basic-Auth-Zugriffsschutz für die geschützte Klick-Demo (preview.growimo.app).
//
// Konzept: /home/team/shared/klick-demo-2026-10-25/ZUGRIFFSSCHUTZ-KONZEPT.md
// (Variante 2, Phase 2 — env-gesteuert, in Production nachweislich wirkungslos).
//
// Grundsätze:
//  * NUR aktiv, wenn PREVIEW_AUTH_USER **und** PREVIEW_AUTH_PASS gesetzt sind.
//    In Production sind beide nie gesetzt → kein 401, keine Verzögerung, keine
//    zusätzlichen Header; die Anfrage läuft exakt wie heute weiter.
//  * Angewendet wird der Check im EINZIGEN Function-Einstieg `vercel-entry.ts`
//    (vor jedem /api/*-Handler, jedem SSE-Stream, jeder ServerFn und dem SSR).
//  * Vergleich von User **und** Passwort mit `timingSafeEqual` (Konstantzeit,
//    kein früher Abbruch), damit der Schutz kein Timing-Orakel aufbaut.
//  * Ausgenommen sind nur Routen, die ihre eigene, stärkere Absicherung haben:
//    der Stripe-Webhook (Signaturprüfung mit STRIPE_WEBHOOK_SECRET) und der
//    Cron-Tageslauf (CRON_SECRET, fail-closed). Beide können keine
//    Basic-Auth-Header senden und würden sonst dauerhaft mit 401 scheitern.
//  * Die Werte werden ausschließlich serverseitig über `process.env` gelesen —
//    niemals als VITE_*-Variable, sonst landen die Zugangsdaten im Client-Bundle.
import { timingSafeEqual } from "node:crypto";

import { STRIPE_WEBHOOK_PATH } from "../api/stripe-webhook";
import { CRON_BLOB_TTL_PATH } from "../api/cron-blob-ttl";

/** Realm, den der Browser im Anmeldedialog anzeigt. */
export const PREVIEW_AUTH_REALM = "Growimo Preview";

/**
 * Pfade, die NICHT hinter der Basic-Auth liegen: sie authentifizieren sich
 * selbst (Webhook-Signatur bzw. Cron-Secret) und werden von Maschinen
 * aufgerufen, die keine Basic-Auth-Header senden können.
 */
export const PREVIEW_AUTH_EXEMPT_PATHS: readonly string[] = [
  STRIPE_WEBHOOK_PATH,
  CRON_BLOB_TTL_PATH,
];

export type PreviewAuthConfig = { user: string; pass: string };

/** Minimal-Typen, damit die Logik ohne echten Node-Server testbar bleibt. */
export type GateRequest = {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
};

export type GateResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => unknown;
  end: (body?: string) => unknown;
};

/**
 * Liest die Zugangsdaten aus der Umgebung. `null` bedeutet: Schutz AUS.
 * Beide Variablen müssen nicht-leer gesetzt sein — eine halb gesetzte
 * Konfiguration schaltet den Schutz nicht scharf (sie wäre nicht durchsetzbar)
 * und ändert auch sonst nichts.
 */
export function readPreviewAuthConfig(
  env: Record<string, string | undefined> = process.env,
): PreviewAuthConfig | null {
  const user = env.PREVIEW_AUTH_USER;
  const pass = env.PREVIEW_AUTH_PASS;
  if (!user || !pass) return null;
  return { user, pass };
}

/** Normalisiert einen Pfad für den Ausnahme-Vergleich (ohne Query/Trailing-Slash). */
export function normalizePath(pathname: string): string {
  if (!pathname) return "/";
  const withoutQuery = pathname.split("?")[0] ?? "/";
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return withoutQuery.replace(/\/+$/, "") || "/";
  }
  return withoutQuery;
}

/** true, wenn der Pfad zur Ausnahmeliste gehört (Webhook, Cron). */
export function isPreviewAuthExempt(pathname: string): boolean {
  const p = normalizePath(pathname);
  return PREVIEW_AUTH_EXEMPT_PATHS.some(
    (exempt) => p === exempt || p.startsWith(`${exempt}/`),
  );
}

/**
 * Konstantzeit-Vergleich zweier Strings.
 * Beide Eingaben werden auf dieselbe Länge gepolstert, damit `timingSafeEqual`
 * (das bei ungleicher Länge wirft) niemals vorzeitig abbricht und die
 * Laufzeit nicht von der Position der ersten Abweichung abhängt. Die
 * Längengleichheit fließt erst danach in das Ergebnis ein.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  const len = Math.max(aBuf.length, bBuf.length, 1);
  const aPad = Buffer.alloc(len);
  const bPad = Buffer.alloc(len);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  const sameBytes = timingSafeEqual(aPad, bPad);
  return sameBytes && aBuf.length === bBuf.length;
}

/** Zerlegt einen `Authorization`-Header in User/Passwort (null bei Fehlformat). */
export function parseBasicCredentials(
  authorization: string | null | undefined,
): { user: string; pass: string } | null {
  if (!authorization) return null;
  const match = /^basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(authorization.trim());
  if (!match) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1]!, "base64").toString("utf8");
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return null;
  return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
}

export type PreviewAuthDecision =
  | { kind: "disabled" }
  | { kind: "exempt" }
  | { kind: "allowed" }
  | { kind: "denied" };

/** Kernentscheidung — ohne Seiteneffekte, damit sie direkt testbar ist. */
export function decidePreviewAuth(input: {
  pathname: string;
  authorization: string | null | undefined;
  config: PreviewAuthConfig | null;
}): PreviewAuthDecision {
  if (!input.config) return { kind: "disabled" };
  if (isPreviewAuthExempt(input.pathname)) return { kind: "exempt" };
  const got = parseBasicCredentials(input.authorization);
  if (!got) return { kind: "denied" };
  // Beide Vergleiche immer ausführen (kein Kurzschluss) → kein Timing-Leak
  // darüber, ob schon der Benutzername falsch war.
  const userOk = timingSafeStringEqual(got.user, input.config.user);
  const passOk = timingSafeStringEqual(got.pass, input.config.pass);
  return userOk && passOk ? { kind: "allowed" } : { kind: "denied" };
}

/**
 * Wendet den Zugriffsschutz auf eine eingehende Anfrage an.
 *
 * Rückgabe `true` = die Anfrage wurde beantwortet (401 geschrieben) und darf
 * NICHT weiterverarbeitet werden. `false` = unverändert weiterlaufen.
 *
 * Ohne gesetzte Envs passiert buchstäblich nichts: kein Header, kein Status,
 * kein `res.end()`.
 */
export function applyPreviewBasicAuth(
  req: GateRequest,
  res: GateResponse,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const config = readPreviewAuthConfig(env);
  if (!config) return false;

  const pathname = req.url ?? "/";
  const rawAuth = req.headers.authorization ?? req.headers.Authorization;
  const authorization = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;

  const decision = decidePreviewAuth({ pathname, authorization, config });
  if (decision.kind !== "denied") return false;

  res.statusCode = 401;
  res.setHeader(
    "WWW-Authenticate",
    `Basic realm="${PREVIEW_AUTH_REALM}", charset="UTF-8"`,
  );
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-robots-tag", "noindex");
  res.end(
    "Zugang nur mit Demo-Zugangsdaten.\nAccess requires demo credentials.\n",
  );
  return true;
}
