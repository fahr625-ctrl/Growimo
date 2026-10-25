// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS-PSEUDONYM — EINE Implementierung für Schreib- UND Löschseite
// (2026-10-25, Fix C1 aus der Datenschutz-Verifikation)
// ─────────────────────────────────────────────────────────────────────────────
// `analytics_events.user_pseudonym` ist HMAC-SHA256(ANALYTICS_SALT, clerk_id)
// als Hex-String. Die Schreibseite (`src/api/analytics.ts`) und die Löschseite
// (`src/account/deletion-runner.ts`) MÜSSEN denselben Wert berechnen — sonst
// findet `DELETE FROM analytics_events WHERE user_pseudonym = …` keine Zeile
// und die pseudonymen Reichweiten-Daten überleben die Kontolöschung still.
//
// Deshalb liegt die Berechnung seit 2026-10-25 in DIESEM Modul und wird von
// beiden Seiten importiert (vorher: lokale Kopie im API-Handler + ein
// dynamischer Lookup im Runner, der auf nicht existierende Exporte zeigte).
//
// Regeln (unverändert übernommen):
//   · keine Clerk-ID im Klartext, nie unsalted hashen,
//   · ohne ANALYTICS_SALT → null (dann wird nichts geschrieben/gelöscht),
//   · Encoding: `createHmac('sha256', salt).update(clerkId).digest('hex')`.
//
// NUR SERVERSEITIG verwenden (`node:crypto`) — dieses Modul darf NICHT aus
// Client-Code importiert werden.
import { createHmac } from 'node:crypto';

/**
 * Pseudonym einer Clerk-ID für die Reichweitenmessung.
 * @returns Hex-HMAC, oder `null` wenn keine ID bzw. kein `ANALYTICS_SALT` gesetzt ist.
 */
export function analyticsPseudonymFor(clerkId: string | null | undefined): string | null {
  if (!clerkId) return null;
  const salt = process.env.ANALYTICS_SALT || '';
  if (!salt) return null;
  return createHmac('sha256', salt).update(clerkId).digest('hex');
}
