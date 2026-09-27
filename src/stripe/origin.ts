// ── Öffentliche App-Origin für Stripe-Rückkehr-URLs ──────────────────────────
// Bug 1 der Bestandsaufnahme (2026-09-27): `getOrigin()` las ausschließlich
// `PUBLIC_SITE_URL`; die Variable ist in Vercel Production NICHT gesetzt → jede
// Checkout-Session trug `success_url`/`cancel_url` = http://localhost:3000/… und
// das Portal `return_url` = http://localhost:3000/app/billing. Der Nutzer landete
// nach der Zahlung auf einer toten Seite.
//
// Fallback-Kette (verbindlich):
//   (a) PUBLIC_SITE_URL  — explizite Konfiguration gewinnt immer
//   (b) Origin / X-Forwarded-Host / Host des laufenden Requests (https erzwungen)
//   (c) https://www.growimo.app — fester Production-Fallback, NIE localhost
// `http://localhost:3000` bleibt ausschließlich für lokale Hostnamen (Dev/E2E).

/** Fester Production-Fallback — nie localhost (Bug 1: tote Rückkehr-Seite). */
export const PROD_SITE_ORIGIN = 'https://www.growimo.app';

/** Nur für lokale Entwicklung/Tests (Host localhost/127.0.0.1). */
export const DEV_SITE_ORIGIN = 'http://localhost:3000';

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}

/**
 * Normalisiert einen Origin-/Host-Kandidaten zu `scheme://host[:port]`.
 * - akzeptiert "https://www.growimo.app", "www.growimo.app", "host:3000"
 * - erzwingt `https` für alles außer lokale Hostnamen (Dev bleibt `http`)
 * - `null` für leere/ungültige Kandidaten (z. B. der String "null" als Origin)
 */
export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  // X-Forwarded-Host kann eine Liste sein ("a.example, b.example") → erster Eintrag.
  const first = raw.split(',')[0]?.trim() ?? '';
  if (!first || first === 'null') return null;
  let url: URL;
  try {
    url = new URL(first.includes('://') ? first : `https://${first}`);
  } catch {
    return null;
  }
  if (!url.hostname) return null;
  const scheme = isLocalHostname(url.hostname) ? 'http' : 'https';
  return `${scheme}://${url.host}`;
}

/**
 * Origin der laufenden Anfrage: `Origin`-Header zuerst (das ist exakt der
 * Browser-Origin), dann `X-Forwarded-Host` (Vercel-Proxy), dann `Host`,
 * zuletzt die Request-URL selbst. Erste verwertbare Quelle gewinnt.
 */
export function originFromRequest(request: Request | null | undefined): string | null {
  if (!request) return null;
  let headers: Headers | undefined;
  try {
    headers = request.headers;
  } catch {
    headers = undefined;
  }
  const candidates: Array<string | null | undefined> = [
    headers?.get('origin'),
    headers?.get('x-forwarded-host'),
    headers?.get('host'),
  ];
  for (const candidate of candidates) {
    const normalized = normalizeOrigin(candidate ?? null);
    if (normalized) return normalized;
  }
  try {
    if (typeof request.url === 'string' && request.url) {
      const fromUrl = normalizeOrigin(new URL(request.url).origin);
      if (fromUrl) return fromUrl;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Reine Fallback-Kette (unit-testbar, ohne Laufzeit-Kontext):
 * PUBLIC_SITE_URL → Request-Origin → PROD_SITE_ORIGIN.
 */
export function resolveOrigin(
  request?: Request | null,
  env: Record<string, string | undefined> | undefined = typeof process !== 'undefined'
    ? process.env
    : undefined,
): string {
  return normalizeOrigin(env?.PUBLIC_SITE_URL ?? null) ?? originFromRequest(request) ?? PROD_SITE_ORIGIN;
}

/**
 * Origin für die laufende ServerFn-Anfrage. Der Request wird ausschließlich
 * server-seitig über den Server-Runtime-Kontext gelesen; fehlt er (z. B.
 * außerhalb eines Requests, in Tests oder im Client-Bundle), greift der feste
 * Production-Fallback — nie localhost.
 */
export async function getOrigin(): Promise<string> {
  const configured = normalizeOrigin(
    typeof process !== 'undefined' ? process.env?.PUBLIC_SITE_URL ?? null : null,
  );
  if (configured) return configured;

  let request: Request | null = null;
  try {
    // Dynamischer Import: dieses Modul wird auch vom Client-Bundle berührt
    // (checkout.ts/portal.ts exportieren ServerFns) — der Server-Runtime-
    // Einstieg darf deshalb nicht statisch importiert werden.
    const serverRuntime = (await import('@tanstack/react-start/server')) as {
      getRequest?: () => Request;
    };
    request = typeof serverRuntime.getRequest === 'function' ? serverRuntime.getRequest() : null;
  } catch {
    request = null;
  }

  return originFromRequest(request) ?? PROD_SITE_ORIGIN;
}
