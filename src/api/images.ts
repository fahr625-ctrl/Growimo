// ─────────────────────────────────────────────────────────────────────────────
// K4-B — Bild-Routen: GET /api/images · GET|DELETE /api/images/<id> (+ POST)
// ─────────────────────────────────────────────────────────────────────────────
// Aufbau exakt nach dem bestehenden Routenmuster des Repos (src/api/image-stream.ts,
// src/api/tracking.ts): eine exportierte `handleXxxApi(req, pathname)`-Funktion,
// die in vercel-entry.ts und serve.ts verdrahtet wird. KEIN neuer Auth-Weg.
//
// Auth-/Identitätsweg (Design-Freeze §4, verbindlich):
//   verifySessionSubject(req)  → Clerk-`sub` (clerk_id)
//   ensureUserRow(clerkId)     → `users.id` (UUID)
//   generated_images.user_id   = diese UUID  ← NICHT die Clerk-ID
// Die Falle ist bewusst dokumentiert: `usage_monthly.user_id` und
// `usage_events.user_id` sind TEXT (Clerk-ID), `generated_images.user_id` ist
// UUID. Ohne `users`-Zeile: fail-closed 401 — nie „irgendein Nutzer".
//
// Δ gegenüber DESIGN-FREEZE §4 (ausdrücklich vermerkt, Grund unten):
//   ZUSÄTZLICH `POST /api/images`. Notwendig, weil der Bild-Erzeugungspfad zwei
//   Ausgänge hat: die SSE-Route `/api/image/stream` speichert serverseitig direkt
//   nach dem Endbild, der klassische ServerFn-Rückfall (`generateImageServer`)
//   kennt die Route aber nicht — dessen Ergebnis muss derselbe Speicherpfad
//   erreichen können. POST ist das REST-Geschwister von `GET /api/images`, nutzt
//   dieselbe Auth und dieselbe Guard-/Cap-/TTL-Kette; ohne ihn gäbe es für den
//   Rückfall-Pfad gar keine dauerhafte Speicherung.
//
// Antworten der Lese-Routen enthalten NIE Pixel, NIE die private Store-URL.

import { verifySessionSubject } from './tracking';
import { IMAGE_LIST_LIMIT_DEFAULT, isValidDeleteReason } from '../lib/generated-images-logic';

export const IMAGES_PATH = '/api/images';
export const IMAGES_PREFIX = '/api/images/';

/** UUID-Form prüfen (sonst würde Postgres mit 22P02 abbrechen). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveUserId(subject: string | null): Promise<string | null> {
  if (!subject) return null;
  try {
    const { ensureUserRow } = await import('../db/queries');
    const id = await ensureUserRow(subject);
    return UUID_RE.test(id) ? id : null;
  } catch {
    // DB nicht erreichbar / keine users-Zeile ⇒ fail-closed, kein Rateergebnis.
    return null;
  }
}

/** Einheitliche JSON-Antwort ohne Cache (private Nutzerdaten). */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
}

/** Liste/Statusbericht — der Client braucht die Warnung für das Banner. */
export async function handleImagesApi(req: Request, pathname: string): Promise<Response | null> {
  const isCollection = pathname === IMAGES_PATH;
  const isItem = pathname.startsWith(IMAGES_PREFIX) && pathname.length > IMAGES_PREFIX.length;
  if (!isCollection && !isItem) return null;

  const itemId = isItem ? pathname.slice(IMAGES_PREFIX.length) : '';
  if (isItem && !UUID_RE.test(itemId)) {
    return json({ error: 'Not found', code: 'invalid_id' }, 404);
  }

  // Auth FIRST (gleiche Reihenfolge wie die SSE-Route).
  const subject = await verifySessionSubject(req);
  if (!subject) return json({ error: 'Unauthorized', code: 'unauthorized' }, 401);
  const userId = await resolveUserId(subject);
  if (!userId) return json({ error: 'Unauthorized', code: 'no_user_row' }, 401);

  if (isCollection && req.method === 'GET') {
    const { listOwnImages } = await import('../lib/generated-images-api');
    const result = await listOwnImages(userId, IMAGE_LIST_LIMIT_DEFAULT);
    if ('unavailable' in result) {
      return json({ error: 'Bildspeicher ist nicht konfiguriert', code: 'storage_unavailable' }, 503);
    }
    return json(result);
  }

  if (isCollection && req.method === 'POST') {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Invalid JSON', code: 'invalid_json' }, 400);
    }
    const { saveGeneratedImage } = await import('../lib/generated-images-service');
    const saved = await saveGeneratedImage({
      userId,
      dataUrl: typeof body.dataUrl === 'string' ? body.dataUrl : '',
      aspectRatio: typeof body.aspectRatio === 'string' ? body.aspectRatio : null,
      prompt: typeof body.prompt === 'string' ? body.prompt : null,
      projectId: typeof body.projectId === 'string' ? body.projectId : null,
    });
    if (!saved.saved && saved.reason === 'unavailable') {
      // Fail-closed und ehrlich: nie „gespeichert" ohne Speicherung.
      return json({ saved: false, reason: 'unavailable', code: 'storage_unavailable' }, 503);
    }
    return json(saved, saved.saved ? 201 : 200);
  }

  if (isItem && req.method === 'GET') {
    const { fetchOwnImage } = await import('../lib/generated-images-service');
    const outcome = await fetchOwnImage({ requesterUserId: userId, imageId: itemId });
    if (outcome.status !== 200) {
      const code =
        outcome.status === 401 ? 'unauthorized'
          : outcome.status === 403 ? 'forbidden'
            : outcome.status === 410 ? 'expired'
              : 'missing';
      return json({ error: 'Image not available', code, status: outcome.status }, outcome.status);
    }
    const { imageDownloadFilename } = await import('../lib/image-download');
    return new Response(outcome.bytes, {
      status: 200,
      headers: {
        'Content-Type': outcome.contentType,
        'Content-Length': String(outcome.bytes.byteLength),
        'Content-Disposition': `attachment; filename="${imageDownloadFilename(itemId, outcome.contentType)}"`,
        // Privater Store: kein Zwischenspeicher für Dritte.
        'Cache-Control': 'private, no-store',
      },
    });
  }

  if (isItem && req.method === 'DELETE') {
    const { deleteOwnImage } = await import('../lib/generated-images-service');
    const result = await deleteOwnImage({ requesterUserId: userId, imageId: itemId });
    if (result.status === 200) return json({ deleted: true });
    const code =
      result.status === 401 ? 'unauthorized'
        : result.status === 403 ? 'forbidden'
          : result.status === 410 ? 'already_deleted'
            : 'missing';
    return json({ error: 'Image not available', code }, result.status);
  }

  return json({ error: 'Method not allowed' }, 405);
}

/** Nur für den einmaligen manuellen Orphan-Check (nicht im Hot Path). */
export function isOrphanCheckRequest(pathname: string): boolean {
  return pathname === `${IMAGES_PATH}/_orphan-check`;
}

/** Löschgrund-Whitelist wird hier nur re-exportiert, damit Tests sie prüfen können. */
export const IMAGE_DELETE_REASON_VALIDATOR = isValidDeleteReason;
