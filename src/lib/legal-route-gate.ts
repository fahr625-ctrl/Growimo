// Route-Gate für die Rechtstext-Seiten (Owner-Freigabe 2026-10-26).
//
// Hintergrund: Die vier Rechtsseiten (/impressum, /datenschutz, /agb,
// /widerruf) sind mit af62dcc/8c0bef8 im Repo gebaut. Der Owner hat am
// 2026-10-26 AUSSCHLIESSLICH die korrigierte Datenschutzerklärung zur
// Veröffentlichung freigegeben — Impressum, AGB und Widerrufsbelehrung warten
// noch auf sein finales Gegenlesen (und auf die Kleinunternehmer-Entscheidung).
//
// Deshalb dieses Gate:
//   * Production (www.growimo.app, VERCEL_ENV=production):
//       /impressum, /agb, /widerruf  → HTTP 404 (echter Status, kein Soft-404)
//       /datenschutz                 → unverändert 200 (öffentlich)
//   * Preview (preview.growimo.app, VERCEL_ENV=preview) und lokal/Tests:
//       alle vier Routen 200 — das Owner-Gegenlesen in der Vorschau bleibt
//       unverändert möglich.
//
// Grundsätze (analog zum Basic-Auth-Gate der Klick-Demo):
//  * Angewendet wird das Gate im EINZIGEN Function-Einstieg `vercel-entry.ts`,
//    VOR SSR und vor jedem Handler. Damit ist der 404-Status garantiert echt und
//    gilt für JEDEN Zugriffsweg auf eine URL (Tippen, Lesezeichen, Suchmaschine,
//    Klick auf einen Footer-Link — die Footer-Links sind bewusst einfache
//    `<a href>`, also volle Seitenaufrufe, keine Client-Navigation).
//  * Kein Zustand, kein DB-Zugriff, keine Seiteneffekte: eine reine
//    Pfad/Umgebungs-Entscheidung, direkt unit-testbar.
//  * Ohne Production-Umgebung passiert buchstäblich nichts (kein Header, kein
//    Status, kein `res.end()`).
// (Bewusst ohne Importe: dieses Modul ist eine reine Pfad/Env-Entscheidung und
//  bleibt so auch in Tests ohne Datenbank-/Zahlungsanbindung importierbar.)


/**
 * Pfade, die in Production 404 liefern. `/datenschutz` fehlt hier ABSICHTLICH —
 * diese Seite ist freigegeben und muss öffentlich erreichbar bleiben.
 */
// Owner-Freigabe 2026-10-26 (Launch-Vorlauf Teil 1): Das Gate ist AUS.
// /impressum, /agb und /widerruf sind (wie /datenschutz) in JEDER Umgebung
// öffentlich erreichbar — 200 in Production, Preview, lokal und Tests. Es wird
// auch kein `x-robots-tag: noindex` mehr gesetzt, weil der 404-Zweig nie läuft.
export const PROD_404_LEGAL_PATHS: readonly string[] = [];

/**
 * Pfade, die unabhängig von der Umgebung NIE gegatet werden. Redundant zur
 * Liste oben (dort stehen sie nicht), aber explizit: so kann ein späteres
 * Hinzufügen zur 404-Liste die Datenschutzerklärung nicht versehentlich
 * mitnehmen.
 */
export const ALWAYS_PUBLIC_LEGAL_PATHS: readonly string[] = ["/datenschutz"];

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

/** Pfad normalisieren: Query weg, Trailing-Slash weg, Groß-/Kleinschreibung egal. */
export function normalizeGatePath(pathname: string): string {
  if (!pathname) return "/";
  const withoutQuery = pathname.split("?")[0] ?? "/";
  const trimmed =
    withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") || "/" : withoutQuery;
  return trimmed.toLowerCase();
}

/**
 * true, wenn diese Instanz die öffentliche Produktion ist.
 *
 * Kriterium ist `VERCEL_ENV` (Vercel setzt es zur Laufzeit: 'production' für das
 * Production-Deployment, 'preview' für Preview-Deployments). Lokal, in Tests und
 * auf der Arbeits-Umgebung ist die Variable nicht gesetzt → Gate AUS. Das ist die
 * gleiche Umgebungs-Unterscheidung, die schon der Basic-Auth-Schutz der
 * Klick-Demo nutzt (dort env-gesteuert, in Production wirkungslos).
 */
export function isProductionDeployment(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env.VERCEL_ENV ?? "").trim().toLowerCase() === "production";
}

export type LegalGateDecision = { kind: "serve" } | { kind: "not-found"; path: string };

/** Kernentscheidung — ohne Seiteneffekte. */
export function decideLegalRouteGate(input: {
  pathname: string;
  env?: Record<string, string | undefined>;
}): LegalGateDecision {
  const env = input.env ?? process.env;
  const path = normalizeGatePath(input.pathname);
  if (!isProductionDeployment(env)) return { kind: "serve" };
  if (ALWAYS_PUBLIC_LEGAL_PATHS.some((p) => path === p.toLowerCase())) {
    return { kind: "serve" };
  }
  // Unterpfade (z. B. /impressum/foo) werden mitgenommen — nichts davon ist
  // im Repo vorhanden, aber ein 404 ist dort ebenfalls die richtige Antwort.
  const gated = PROD_404_LEGAL_PATHS.some(
    (p) => path === p.toLowerCase() || path.startsWith(`${p.toLowerCase()}/`),
  );
  return gated ? { kind: "not-found", path } : { kind: "serve" };
}

/**
 * Wendet das Gate an. Rückgabe `true` = die Anfrage wurde beantwortet (404
 * geschrieben) und darf NICHT weiterverarbeitet werden. `false` = unverändert
 * weiterlaufen (Preview, lokal, Tests, /datenschutz, alle anderen Pfade).
 */
export function applyLegalRouteGate(
  req: GateRequest,
  res: GateResponse,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const decision = decideLegalRouteGate({ pathname: req.url ?? "/", env });
  if (decision.kind !== "not-found") return false;

  res.statusCode = 404;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-robots-tag", "noindex");
  res.end(
    "<!doctype html><html lang=\"de\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"robots\" content=\"noindex\">" +
      "<title>404 — Growimo</title>" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head>" +
      "<body style=\"font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1.5rem;color:#374151\">" +
      "<h1 style=\"font-size:1.5rem;color:#111827\">404 — Seite nicht gefunden</h1>" +
      "<p>Diese Seite ist unter dieser Adresse nicht verfügbar.</p>" +
      "<p><a href=\"/\" style=\"color:#2563eb\">Zurück zu Growimo</a></p>" +
      "</body></html>",
  );
  return true;
}
