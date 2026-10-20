/**
 * K4-B (UI-Anbindung) — API-Vertrag der Bild-Routen, LOKAL ohne Prod-Berührung
 * Aufruf: `bun saved-images-api-local-test.ts` · Exit 0 = grün.
 *
 * Warum diese Suite: Die UI-Anbindung hängt an GENAU diesem Vertrag
 * (GET /api/images → JSON-Meta, GET /api/images/<id> → attachment-Bytes,
 * 401/503/404/403/405). Geprüft wird der ECHTE Handler
 * (`handleImagesApi` aus src/api/images.ts) — nur Auth, DB-Transport und Store
 * sind gestubbt:
 *   * `verifySessionSubject`  → fester Betreff (kein Clerk, kein Netz)
 *   * `ensureUserRow`         → feste `users.id` (keine DB)
 *   * `getDb()`               → Tagged-Template-Attrappe mit vorgegebenen Zeilen
 *                               (dieselbe Abfrageform wie src/db/generated-images.ts)
 *   * `blob-store`            → In-Memory-Store, umschaltbar „konfiguriert/nein"
 *
 * Damit sind HTTP-Status, Header, Auth-Reihenfolge und die JSON-Form beweisbar —
 * ohne Datenbank, ohne Prod, ohne Deploy, ohne Kosten. Die SQL-SEMANTIK selbst
 * ist Sache der Integrations-Suite auf einer lokalen Postgres-Kopie
 * (`generated-images-integration-test.ts`) und wird hier bewusst NICHT ersetzt.
 *
 * BEFUND (belegt in Check 4 dieser Suite): GET /api/images antwortet bei nicht
 * konfiguriertem Store mit **200 + storageConfigured:false**, NICHT mit 503 —
 * `listOwnImages` gibt nie `{unavailable:...}` zurück, der 503-Zweig in
 * src/api/images.ts:76 ist damit toter Code. Die UI behandelt BEIDE Zustände
 * ehrlich (eigener Hinweis je Fall), siehe saved-images-client-test.ts.
 */

// `mock` kommt aus Bun. Das Repo hat kein `@types/bun` — dieselbe Situation wie in
// image-streaming-test.ts (vorbestehender tsc-Hinweis in Testdateien, nicht Teil des
// App-Bundles). Deshalb hier eine Zeile bewusst stillgelegt, damit diese Datei den
// tsc-Stand NICHT verändert.
// @ts-ignore — bun:test ist zur Laufzeit (bun) vorhanden
import { mock } from 'bun:test';
import type { ImageSql } from './src/db/generated-images';

const BASE = new URL('./', import.meta.url).pathname;
const SUBJECT = 'user_local_k4bui';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID_OK = '11111111-1111-4111-8111-111111111111';
const ID_FOREIGN = '22222222-2222-4222-8222-222222222222';
const ID_GONE = '33333333-3333-4333-8333-333333333333';
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

let checks = 0;
let failed = 0;
const failures: string[] = [];
function ok(cond: boolean, label: string) {
  checks += 1;
  if (!cond) { failed += 1; failures.push(label); console.error(`FAIL  ${label}`); }
}
function eq<T>(actual: T, expected: T, label: string) {
  ok(Object.is(actual, expected), `${label} (erwartet ${String(expected)}, war ${String(actual)})`);
}

// ── Zustand, den die Stubs lesen ─────────────────────────────────────────────
let subject: string | null = SUBJECT;
let storeConfigured = true;

const liveRows = [
  {
    id: ID_OK, aspect_ratio: '2:3', size_bytes: '1500000', prompt: 'Produktfoto einer Tasse',
    project_id: 'proj-1', created_at: '2026-10-19T10:00:00.000Z', expires_at: '2027-01-17T10:00:00.000Z',
  },
  {
    id: ID_GONE, aspect_ratio: '1:1', size_bytes: '900000', prompt: 'Zweites Bild',
    project_id: null, created_at: '2026-10-18T10:00:00.000Z', expires_at: '2027-01-16T10:00:00.000Z',
  },
];

/** Volle Zeile für qGetImageById (inkl. privatem Pfad — der darf NIE im Client landen). */
function fullRow(id: string): Record<string, unknown> | null {
  if (id === ID_OK) {
    return {
      id: ID_OK, user_id: USER_ID, project_id: 'proj-1', blob_path: `images/${USER_ID}/${ID_OK}`,
      blob_url: 'https://private.example.invalid/secret', aspect_ratio: '2:3', mime_type: 'image/png',
      size_bytes: '1500000', prompt: 'Produktfoto einer Tasse', created_at: '2026-10-19T10:00:00.000Z',
      expires_at: '2027-01-17T10:00:00.000Z', deleted_at: null, delete_reason: null,
    };
  }
  if (id === ID_FOREIGN) {
    return {
      id: ID_FOREIGN, user_id: OTHER_USER_ID, project_id: null, blob_path: `images/${OTHER_USER_ID}/${ID_FOREIGN}`,
      blob_url: 'https://private.example.invalid/fremd', aspect_ratio: '2:3', mime_type: 'image/png',
      size_bytes: '1000', prompt: 'fremd', created_at: '2026-10-19T09:00:00.000Z',
      expires_at: '2027-01-17T09:00:00.000Z', deleted_at: null, delete_reason: null,
    };
  }
  return null;
}

/**
 * Tagged-Template-Attrappe der Neon-Verbindung. Sie erkennt die drei Abfrageformen
 * aus src/db/generated-images.ts an ihrem SQL-Text und liefert die vorgegebenen
 * Zeilen — inklusive der ID, die bei `WHERE id = ${...}` als Wert ankommt.
 */
const sqlWithValues: ImageSql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const q = strings.join(' ');
  if (q.includes('WHERE id =')) {
    const row = fullRow(String(values[0]));
    return row ? [row] : [];
  }
  if (q.includes('COUNT(*)')) return [{ c: liveRows.length }];
  if (q.includes('SUM(size_bytes)')) return [{ total: '2400000' }];
  if (q.includes('ORDER BY created_at DESC')) return liveRows;
  return [];
}) as unknown as ImageSql;

/** Minimaler In-Memory-Store mit der BlobStore-Schnittstelle. */
const memoryStore = {
  kind: 'memory' as const,
  async put(path: string, bytes: Uint8Array, contentType: string) {
    return { url: `memory://${path}`, contentType, sizeBytes: bytes.byteLength };
  },
  async get(path: string) {
    if (path !== `images/${USER_ID}/${ID_OK}`) return null;
    return { bytes: PNG, contentType: 'image/png', statusCode: 200 };
  },
  async del() { /* no-op */ },
  async list() { return []; },
};

// ── Stubs registrieren, DANN den echten Handler laden ────────────────────────
mock.module(`${BASE}src/api/tracking.ts`, () => ({
  verifySessionSubject: async () => subject,
}));
mock.module(`${BASE}src/api/tracking`, () => ({
  verifySessionSubject: async () => subject,
}));
mock.module(`${BASE}src/db/queries.ts`, () => ({
  ensureUserRow: async () => USER_ID,
}));
mock.module(`${BASE}src/db/index.ts`, () => ({
  getDb: () => sqlWithValues,
}));
mock.module(`${BASE}src/db`, () => ({
  getDb: () => sqlWithValues,
}));
mock.module(`${BASE}src/db/index`, () => ({
  getDb: () => sqlWithValues,
}));
mock.module(`${BASE}src/lib/blob-store.ts`, () => ({
  blobAuthPresent: () => storeConfigured,
  blobStoreOrNull: () => (storeConfigured ? memoryStore : null),
  createVercelBlobStore: () => memoryStore,
  createMemoryBlobStore: () => memoryStore,
}));

const { handleImagesApi } = await import('./src/api/images');

const LIST_URL = 'https://app.example/api/images';
const get = (url: string) => new Request(url, { method: 'GET' });

console.log('=== K4-B UI-Anbindung: API-Vertrag lokal (echter Handler, Stub-Auth/DB/Store) ===');

// ── 1. Liste: 200 + JSON-Meta ────────────────────────────────────────────────
{
  subject = SUBJECT; storeConfigured = true;
  const res = await handleImagesApi(get(LIST_URL), '/api/images');
  ok(res !== null, 'Route greift');
  eq(res!.status, 200, 'Liste → 200');
  eq(res!.headers.get('content-type'), 'application/json', 'Liste ist JSON');
  eq(res!.headers.get('cache-control'), 'private, no-store', 'Liste ist nicht cachebar (private Nutzerdaten)');
  const raw = await res!.text();
  const body = JSON.parse(raw) as Record<string, unknown>;
  eq(body.count, 2, 'count aus der DB');
  eq(body.limit, 200, 'limit aus den Limits (200 je Nutzer)');
  eq(body.liveBytes, 2_400_000, 'liveBytes aus SUM(size_bytes)');
  eq(body.capBytes, 850_000_000, 'capBytes = Default-Deckel 850 MB');
  eq(body.warning, false, 'unter der Warnschwelle ⇒ keine Warnung');
  eq(body.storageConfigured, true, 'Store konfiguriert ⇒ storageConfigured true');
  eq(body.ttlDays, 90, 'ttlDays = 90');
  const images = body.images as Array<Record<string, unknown>>;
  eq(images.length, 2, 'beide lebenden Bilder gelistet');
  eq(images[0].id, ID_OK, 'ID durchgereicht');
  eq(images[0].projectId, 'proj-1', 'projectId durchgereicht (Projektansicht)');
  eq(images[0].sizeLabel, '1.5 MB', 'Größe als Label');
  eq(images[0].prompt, 'Produktfoto einer Tasse', 'Prompt durchgereicht');
  ok(typeof images[0].createdAt === 'string' && images[0].createdAt.includes('T'), 'createdAt als ISO-String');
  ok(typeof images[0].expiresAt === 'string' && images[0].expiresAt.includes('T'), 'expiresAt als ISO-String');
  // Datenschutz-Hausregel: keine Pixel, keine private URL im Client-Body.
  ok(!raw.includes('private.example.invalid'), 'KEINE private Store-URL im Body');
  ok(!raw.includes('blob_path') && !raw.includes('blobPath'), 'kein Blob-Pfad im Body');
  ok(!raw.includes('base64') && !raw.includes('data:image'), 'KEINE Pixel im Body');
}

// ── 2. Auth: ohne Sitzung 401 ────────────────────────────────────────────────
{
  subject = null;
  const res = await handleImagesApi(get(LIST_URL), '/api/images');
  eq(res!.status, 401, 'ohne Sitzung → 401');
  const body = await res!.json() as Record<string, unknown>;
  eq(body.code, 'unauthorized', 'Fehlercode unauthorized');
  subject = SUBJECT;
}

// ── 3. Nicht-UUID → 404 (kein Postgres-Fehler 22P02) ─────────────────────────
{
  const res = await handleImagesApi(get(`${LIST_URL}/kein-uuid`), '/api/images/kein-uuid');
  eq(res!.status, 404, 'ungültige ID → 404');
  eq((await res!.json() as Record<string, unknown>).code, 'invalid_id', 'Fehlercode invalid_id');
}

// ── 4. Store NICHT konfiguriert (Befund) ─────────────────────────────────────
{
  storeConfigured = false;
  const res = await handleImagesApi(get(LIST_URL), '/api/images');
  eq(res!.status, 200, 'BEFUND: Liste liefert auch ohne Store 200 (nicht 503)');
  const body = await res!.json() as Record<string, unknown>;
  eq(body.storageConfigured, false, 'storageConfigured:false macht den Zustand ehrlich sichtbar');
  ok(Array.isArray(body.images), 'die Liste bleibt nutzbar (nur der Download fehlt)');
  // Kontrast: der SCHREIB-Pfad meldet 503 — dort ist der Zweig erreichbar.
  const post = await handleImagesApi(
    new Request(LIST_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }) }),
    '/api/images',
  );
  eq(post!.status, 503, 'POST ohne Store → 503 (fail-closed, keine falsche „gespeichert"-Meldung)');
  eq((await post!.json() as Record<string, unknown>).code, 'storage_unavailable', 'POST-Code ist storage_unavailable');
  storeConfigured = true;
}

// ── 5. Einzelbild: Original-Bytes als attachment ─────────────────────────────
{
  const res = await handleImagesApi(get(`${LIST_URL}/${ID_OK}`), `/api/images/${ID_OK}`);
  eq(res!.status, 200, 'eigenes Bild → 200');
  eq(res!.headers.get('content-type'), 'image/png', 'Content-Type aus dem Store');
  eq(res!.headers.get('content-length'), String(PNG.byteLength), 'Content-Length gesetzt');
  eq(res!.headers.get('cache-control'), 'private, no-store', 'Download nie zwischenspeichern');
  const cd = res!.headers.get('content-disposition') ?? '';
  ok(cd.startsWith('attachment;'), 'Download kommt als attachment (kein Inline-Rendering)');
  ok(cd.includes(`growimo-${ID_OK}.png`), `Dateiname mit ehrlicher Endung (${cd})`);
  const bytes = new Uint8Array(await res!.arrayBuffer());
  eq(bytes.byteLength, PNG.byteLength, 'Original-Bytes vollständig');
  eq(bytes[0], 137, 'PNG-Signatur unverändert (kein Re-Encoding)');
}

// ── 6. Fremdes Bild 403 · unbekannt 404 · ohne Store 404 · falsche Methode 405 ─
{
  const res403 = await handleImagesApi(get(`${LIST_URL}/${ID_FOREIGN}`), `/api/images/${ID_FOREIGN}`);
  eq(res403!.status, 403, 'fremdes Bild → 403');
  eq((await res403!.json() as Record<string, unknown>).code, 'forbidden', 'Fehlercode forbidden');

  const r404 = await handleImagesApi(get(`${LIST_URL}/44444444-4444-4444-8444-444444444444`), '/api/images/44444444-4444-4444-8444-444444444444');
  eq(r404!.status, 404, 'unbekannte ID → 404');

  storeConfigured = false;
  const noStore = await handleImagesApi(get(`${LIST_URL}/${ID_OK}`), `/api/images/${ID_OK}`);
  eq(noStore!.status, 404, 'ohne Store → 404 (kein halber Download)');
  storeConfigured = true;

  const method = await handleImagesApi(new Request(LIST_URL, { method: 'PUT' }), '/api/images');
  eq(method!.status, 405, 'nicht unterstützte Methode → 405');

  const other = await handleImagesApi(get('https://app.example/api/tracking'), '/api/tracking');
  eq(other, null, 'fremder Pfad → Route greift nicht (null)');
}

console.log(`\n${checks - failed}/${checks} Checks grün${failed ? ` — ${failed} FEHLER` : ''}`);
if (failed) { console.error('Fehlgeschlagen:', failures.join(' | ')); process.exit(1); }
console.log('ERGEBNIS: GRÜN (API-Vertrag lokal; keine DB, kein Prod, kein Deploy, keine Kosten)');
