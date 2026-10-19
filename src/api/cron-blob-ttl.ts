// ─────────────────────────────────────────────────────────────────────────────
// K4-B — Tageslauf: GET /api/cron/blob-ttl (Vercel Cron, 0 3 * * *)
// ─────────────────────────────────────────────────────────────────────────────
// Hobby-konform: GENAU 1×/Tag (häufigere Ausdrücke lassen den Deploy scheitern,
// HOBBY-PRUEFUNG §1a). Ausführung irgendwann zwischen 03:00 und 03:59.
//
// Fail-closed-Authentifizierung (Design-Freeze §3b): ohne `CRON_SECRET` antwortet
// die Route IMMER 401 — sie ist nie offen. Vercel sendet den Secret automatisch
// als `Authorization: Bearer <CRON_SECRET>` (quellen/vercel-cron-jobs-manage.md).
//
// Arbeit: abgelaufene Bilder markieren → Blob löschen → Bildzeile löschen, danach
// IMMER den Wiederanlauf für stehen gebliebene Markierungen. Antwortkörper ist der
// Belegkörper für das Testprotokoll: { marked, blobDeleted, blobFailed, rowsDeleted }.
//
// Datenschutz: Protokoll enthält NUR Zähler — keine Pfade, keine IDs, keine Inhalte.

import { cronAuthOk } from '../lib/generated-images-logic';
import type { ImageServiceDeps } from '../lib/generated-images-service';

export const CRON_BLOB_TTL_PATH = '/api/cron/blob-ttl';

/**
 * @param sweepDeps Test-Hook: Injektion von SQL-Executor/Store/Parametern, damit
 *   die Route gegen eine LOKALE Postgres-Kopie + Blob-Fake geprüft werden kann
 *   (keine Produktions-DB, kein echter Store). Im Betrieb wird nichts übergeben
 *   → Default = Neon-Treiber + echter Store.
 */
export async function handleCronBlobTtlApi(
  req: Request,
  pathname: string,
  sweepDeps: ImageServiceDeps = {},
): Promise<Response | null> {
  if (pathname !== CRON_BLOB_TTL_PATH) return null;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authorized = cronAuthOk({
    secret: process.env.CRON_SECRET,
    authorization: req.headers.get('authorization'),
  });
  if (!authorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  try {
    const { runDailySweep } = await import('../lib/generated-images-service');
    const result = await runDailySweep(sweepDeps);
    return new Response(
      JSON.stringify({
        marked: result.marked,
        blobDeleted: result.blobDeleted,
        blobFailed: result.blobFailed,
        rowsDeleted: result.rowsDeleted,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  } catch {
    // Nie eine Meldung/Stacktrace nach außen — nur ein ehrlicher Fehlerstatus.
    return new Response(JSON.stringify({ error: 'Sweep failed', code: 'sweep_failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
