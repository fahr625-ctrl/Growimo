/**
 * K4-B (UI-Anbindung) — Suite für den Client-Zugriff auf die gespeicherten Bilder
 * Aufruf: `bun saved-images-client-test.ts` · Exit 0 = grün.
 *
 * Leitplanken (Auftrag 2026-10-19):
 *  * KEIN echter Server, KEIN Blob-Store, KEIN OpenAI-Aufruf, KEIN Deploy,
 *    KEINE DB-Berührung — `fetch` ist vollständig durch einen Mock ersetzt.
 *  * Geprüft wird der VERTRAG mit `src/api/images.ts`: Liste (JSON-Meta),
 *    Original-Download (attachment-Bytes) und JEDER Fehlerzweig (503
 *    storage_unavailable, 401, 404 alte Version, Netzfehler, kaputtes JSON).
 *  * Dazu die Vereinigung Session ↔ DB (Duplikate nach ID) und die ehrliche
 *    Statuszeile — die Grundlage der UI-Anzeige.
 *
 * Zusätzlich: ein STATISCHER Verdrahtungs-Check (Quelltext-Marker), damit die
 * Suite rot wird, wenn die UI-Anbindung wieder entfernt wird. Er ist ausdrücklich
 * nur ein Textbeweis — die inhaltliche Prüfung ist die Browser-E2E (separat).
 */

import { readFileSync } from 'node:fs';
import {
  SAVED_IMAGES_PATH,
  SAVED_IMAGES_RETRIES,
  SAVED_IMAGES_RETRY_DELAY_MS,
  fetchSavedImageBytes,
  fetchSavedImages,
  fetchSavedImagesWithRetry,
  formatBytesLabel,
  isRetryableSavedImagesFailure,
  isSavedImagesHardError,
  mergeGallery,
  parseSavedImagesReport,
  savedImagePath,
  storageStatusParts,
  type SavedImageEntry,
  type SavedImagesReport,
  type SessionGalleryImage,
} from './src/lib/saved-images-client';
import { imageDownloadExtension, imageDownloadFilename } from './src/lib/image-download';

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

console.log('=== K4-B UI-Anbindung: Client-Suite (Mock-fetch, keine Prod-Berührung) ===');

// ── Fixtures (Form exakt wie generated-images-api.ts) ────────────────────────
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

const entry = (id: string, projectId: string | null, createdAt: string): SavedImageEntry => ({
  id,
  aspectRatio: '2:3',
  sizeBytes: 1_500_000,
  sizeLabel: '1.5 MB',
  prompt: 'Produktfoto einer Tasse',
  projectId,
  createdAt,
  expiresAt: '2027-01-17T10:00:00.000Z',
});

const REPORT: SavedImagesReport = {
  count: 2,
  limit: 200,
  liveBytes: 4_500_000,
  liveLabel: '4.5 MB',
  capBytes: 850_000_000,
  capLabel: '850 MB',
  warnBytes: 700_000_000,
  warning: false,
  storageConfigured: true,
  ttlDays: 90,
  images: [entry(ID_A, 'proj-1', '2026-10-19T10:00:00.000Z'), entry(ID_B, 'proj-2', '2026-10-18T10:00:00.000Z')],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Call { url: string; init: RequestInit | undefined }
function mockFetch(handler: (url: string) => Response | Promise<Response>, calls: Call[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    calls.push({ url, init });
    return await handler(url);
  }) as unknown as typeof fetch;
}

// ── 1. Vertrag: Pfade ────────────────────────────────────────────────────────
eq(SAVED_IMAGES_PATH, '/api/images', 'Sammlungspfad ist /api/images');
eq(savedImagePath(ID_A), `/api/images/${ID_A}`, 'Einzelpfad zeigt auf die Route (nie auf eine Store-URL)');
ok(!savedImagePath('a b').includes(' '), 'ID wird URL-kodiert (kein Leerzeichen im Pfad)');

// ── 2. parseSavedImagesReport ────────────────────────────────────────────────
{
  const parsed = parseSavedImagesReport(REPORT);
  ok(parsed !== null, 'vollständiger Bericht wird akzeptiert');
  eq(parsed?.count, 2, 'count übernommen');
  eq(parsed?.limit, 200, 'limit übernommen');
  eq(parsed?.liveBytes, 4_500_000, 'liveBytes übernommen');
  eq(parsed?.liveLabel, '4.5 MB', 'liveLabel übernommen');
  eq(parsed?.capBytes, 850_000_000, 'capBytes übernommen');
  eq(parsed?.warning, false, 'warning übernommen');
  eq(parsed?.storageConfigured, true, 'storageConfigured übernommen');
  eq(parsed?.ttlDays, 90, 'ttlDays übernommen');
  eq(parsed?.images.length, 2, 'Bildzeilen übernommen');
  eq(parsed?.images[0].projectId, 'proj-1', 'projectId je Bild übernommen');
  eq(parsed?.images[0].sizeLabel, '1.5 MB', 'sizeLabel je Bild übernommen');

  eq(parseSavedImagesReport(null), null, 'null → null (kein stilles Leer)');
  eq(parseSavedImagesReport('nope'), null, 'String → null');
  eq(parseSavedImagesReport({ count: 1 }), null, 'ohne images-Array → null');
  eq(parseSavedImagesReport({ images: [] })?.images.length, 0, 'leeres images-Array ist gültig');

  // Fail-closed: fehlt storageConfigured, gilt „nicht konfiguriert".
  const old = parseSavedImagesReport({ images: [], storageConfigured: undefined });
  eq(old?.storageConfigured, false, 'fehlendes storageConfigured ⇒ false (fail-closed)');
  // Kaputte Zeilen werden verworfen, gute bleiben.
  const mixed = parseSavedImagesReport({ images: [{ id: '' }, { id: ID_C }, 7, null] });
  eq(mixed?.images.length, 1, 'nur brauchbare Zeilen bleiben');
  eq(mixed?.images[0].id, ID_C, 'die brauchbare Zeile ist die erwartete');
  eq(mixed?.images[0].projectId, null, 'fehlende Felder werden null (nicht erfunden)');
}

// ── 3. fetchSavedImages: Erfolg + alle Fehlerzweige ──────────────────────────
{
  const calls: Call[] = [];
  const result = await fetchSavedImages(mockFetch(() => jsonResponse(REPORT), calls), SAVED_IMAGES_PATH);
  eq(result.kind, 'ok', '200 + gültiger Bericht → ok');
  eq(result.kind === 'ok' ? result.report.images.length : -1, 2, 'Liste kommt durch');
  eq(calls[0].url, '/api/images', 'Aufruf geht an GET /api/images');
  eq(calls[0].init?.method, 'GET', 'Methode ist GET');
  eq(calls[0].init?.credentials, 'same-origin', 'Cookie-Auth wie der bestehende POST-Pfad (same-origin)');
}
{
  const r = await fetchSavedImages(mockFetch(() => jsonResponse({ error: 'Bildspeicher ist nicht konfiguriert', code: 'storage_unavailable' }, 503)));
  eq(r.kind, 'storage_unavailable', '503 storage_unavailable → eigener Zweig (ehrlicher Hinweis)');
  eq(r.kind === 'storage_unavailable' ? r.status : 0, 503, 'Status 503 gemeldet');
}
{
  // 503 aus einem anderen Grund darf NICHT als „Store fehlt" verkauft werden.
  const r = await fetchSavedImages(mockFetch(() => jsonResponse({ code: 'maintenance' }, 503)));
  eq(r.kind, 'error', '503 mit fremdem Code → error (kein falscher Store-Hinweis)');
  const empty = await fetchSavedImages(mockFetch(() => new Response('', { status: 503 })));
  eq(empty.kind, 'storage_unavailable', '503 ohne Body (fail-closed Server) → storage_unavailable');
}
{
  const r401 = await fetchSavedImages(mockFetch(() => jsonResponse({ code: 'unauthorized' }, 401)));
  eq(r401.kind, 'unauthorized', '401 → unauthorized');
  const r403 = await fetchSavedImages(mockFetch(() => jsonResponse({}, 403)));
  eq(r403.kind, 'unauthorized', '403 → unauthorized');
  const r404 = await fetchSavedImages(mockFetch(() => new Response('<html>404</html>', { status: 404 })));
  eq(r404.kind, 'error', '404 (Live-Version ohne die Route) → error, kein Panel');
  eq(r404.kind === 'error' ? r404.status : 0, 404, 'Status 404 gemeldet');
  const r500 = await fetchSavedImages(mockFetch(() => jsonResponse({ code: 'boom' }, 500)));
  eq(r500.kind, 'error', '500 → error');
  const rNet = await fetchSavedImages(mockFetch(() => { throw new Error('offline'); }));
  eq(rNet.kind, 'error', 'Netzfehler → error');
  eq(rNet.kind === 'error' ? rNet.status : 1, 0, 'Netzfehler wird als Status 0 gemeldet');
  const rJson = await fetchSavedImages(mockFetch(() => new Response('{kaputt', { status: 200 })));
  eq(rJson.kind, 'error', 'kaputtes JSON → error (nie stilles Leer)');
}

// ── 4. fetchSavedImageBytes: Original über die Route, Endung ehrlich ─────────
{
  const calls: Call[] = [];
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const r = await fetchSavedImageBytes(ID_A, mockFetch(() => new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } }), calls));
  ok(r.ok, 'Download über die Route gelingt');
  eq(r.ok ? r.blob.size : -1, png.byteLength, 'Original-Bytes kommen vollständig an');
  eq(r.ok ? r.contentType : '', 'image/png', 'Content-Type wird übernommen');
  eq(calls[0].url, `/api/images/${ID_A}`, 'Download nutzt GET /api/images/<id> (nie die private Store-URL)');
  eq(calls[0].init?.credentials, 'same-origin', 'Download ist cookie-authentifiziert');
  // Der Dateiname kommt aus dem echten MIME-Typ (K4-A-Logik), nicht geraten.
  eq(imageDownloadFilename(ID_A, r.ok ? r.contentType : ''), `growimo-${ID_A}.png`, 'Dateiname passt zum echten Typ');
  eq(imageDownloadExtension('image/jpeg'), '.jpg', 'JPEG erhält .jpg');
  eq(imageDownloadExtension('image/webp'), '.webp', 'WEBP erhält .webp');
}
{
  const gone = await fetchSavedImageBytes(ID_B, mockFetch(() => jsonResponse({ code: 'expired' }, 410)));
  ok(!gone.ok, '410 (abgelaufen) gilt als Fehlschlag');
  eq(!gone.ok ? gone.status : 0, 410, 'Status 410 gemeldet (kein stiller Nicht-Download)');
  const net = await fetchSavedImageBytes(ID_B, mockFetch(() => { throw new Error('offline'); }));
  eq(!net.ok ? net.status : 1, 0, 'Netzfehler beim Download → Status 0');
}

// ── 5. mergeGallery: Session gewinnt, Duplikate raus, Projektfilter ──────────
{
  const session: SessionGalleryImage[] = [
    { id: ID_A, url: 'data:image/png;base64,AAAA', prompt: 'Session-Prompt', aspectRatio: '2:3', createdAt: new Date('2026-10-19T10:05:00.000Z'), saved: true },
    { id: 'client-uuid-1', url: 'data:image/png;base64,BBBB', prompt: 'Nur Session', aspectRatio: '1:1', createdAt: new Date('2026-10-19T11:00:00.000Z') },
  ];
  const db: SavedImageEntry[] = [
    entry(ID_A, 'proj-1', '2026-10-19T10:00:00.000Z'),
    entry(ID_B, 'proj-1', '2026-10-18T10:00:00.000Z'),
    entry(ID_C, 'proj-2', '2026-10-17T10:00:00.000Z'),
  ];
  const merged = mergeGallery(session, db, { projectId: 'proj-1' });
  eq(merged.length, 3, 'Session (2) + ein reiner DB-Eintrag = 3 (Duplikat entfernt, Filter greift)');
  eq(merged[0].key, ID_A, 'Session-Bild steht vorn');
  eq(merged[0].url, 'data:image/png;base64,AAAA', 'Session-Pixel gewinnen gegen die DB-Zeile');
  eq(merged[0].stored, true, 'Session-Bild mit gespeicherter ID ist als gespeichert markiert');
  eq(merged[0].sizeLabel, '1.5 MB', 'Metadaten kommen aus der DB-Zeile');
  eq(merged[1].url, 'data:image/png;base64,BBBB', 'zweite Session-Karte unverändert');
  eq(merged[1].stored, false, 'Session-Bild ohne DB-Zeile bleibt „nicht gespeichert"');
  eq(merged[2].id, ID_B, 'reiner DB-Eintrag folgt danach');
  eq(merged[2].url, null, 'DB-Eintrag hat KEINE Pixel im Browser (ehrlich)');
  eq(merged[2].stored, true, 'DB-Eintrag ist gespeichert');
  eq(merged[2].projectId, 'proj-1', 'Projektbezug bleibt erhalten');

  const all = mergeGallery(session, db);
  eq(all.length, 4, 'ohne Filter: 2 Session + 2 reine DB-Einträge (proj-1 + proj-2)');
  eq(all[3].id, ID_C, 'reine DB-Einträge sind neueste-zuerst sortiert');

  // Duplikate in der DB-Liste selbst dürfen die Galerie nicht doppeln.
  const withDup = mergeGallery([], [entry(ID_A, null, '2026-10-19T10:00:00.000Z'), entry(ID_B, null, '2026-10-18T10:00:00.000Z')]);
  eq(withDup.filter((e) => e.id === ID_A).length, 1, 'jede ID erscheint höchstens einmal');
  ok(withDup.every((e) => e.stored), 'alle DB-Einträge sind als gespeichert markiert');

  // Nur das done-Event-Flag, keine DB-Zeile: trotzdem „gespeichert" (Server hat es gemeldet).
  const flagOnly = mergeGallery([{ ...session[1], saved: true }], []);
  eq(flagOnly[0].stored, true, 'saved-Flag aus dem done-Event genügt für das Badge');
}

// ── 6. Ehrliche Statuszeile ──────────────────────────────────────────────────
{
  const parts = storageStatusParts(REPORT);
  eq(parts.count, 2, 'Status: gezählte Bilder');
  eq(parts.limit, 200, 'Status: Limit');
  eq(parts.liveLabel, '4.5 MB', 'Status: belegte Bytes (Label vom Server)');
  eq(parts.capped, true, 'Status: Deckel aktiv');
  eq(parts.warning, false, 'Status: keine Warnung');

  const noCap = storageStatusParts({ ...REPORT, capBytes: 0, capLabel: '', warning: true });
  eq(noCap.capped, false, 'Deckel 0 ⇒ nicht gekappt (Guard aus)');
  eq(noCap.warning, true, 'Warnung wird durchgereicht');
  // Fehlt ein Server-Label, wird aus den echten Bytes formatiert — nie geraten.
  const fallback = storageStatusParts({ ...REPORT, liveLabel: '', liveBytes: 2_500_000 });
  eq(fallback.liveLabel, '2.5 MB', 'fehlendes liveLabel wird aus liveBytes gebildet (gleiche Zahl)');
  eq(formatBytesLabel(0), '0 B', '0 Bytes ehrlich als 0 B');
  eq(formatBytesLabel(999), '999 B', 'Bytes unter 1 KB in B');
  eq(formatBytesLabel(850_000_000), '850 MB', '850.000.000 Bytes = 850 MB');
}

// ── 7. Wiederholungsversuch (Live-Fund 2026-10-20) ───────────────────────────
// Belegt: der eigene GET /api/images kam nach einem Reload mit 503 an, derselbe
// Aufruf 11 ms später mit 200. OHNE Wiederholung zeigte die Galerie eine still
// leere Liste („Noch keine Bilder generiert"), obwohl das Bild gespeichert ist.
// Geprüft werden: genau EIN zweiter Versuch, exakte Request-Zahl, Versuchszähler,
// Wartezeit, das Verhalten bei endgültigem Fehlschlag und die Ausnahmen
// (401/403/404 = NICHT wiederholen).

/** fetch-Mock, der die Antworten der Reihe nach liefert (letzte Antwort wiederholt sich). */
function sequencedFetch(steps: Array<() => Response>, calls: Call[]): typeof fetch {
  let index = 0;
  return mockFetch(() => {
    // Jede Antwort wird NEU gebaut: ein Response-Body ist nur einmal lesbar.
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    return step();
  }, calls);
}
const okStep = () => jsonResponse(REPORT);
const storageDownStep = () => jsonResponse({ error: 'Bildspeicher ist nicht konfiguriert', code: 'storage_unavailable' }, 503);
const otherFail503Step = () => jsonResponse({ code: 'upstream_timeout' }, 503);
const error500Step = () => jsonResponse({ code: 'boom' }, 500);
const notFoundStep = () => new Response('<html>404</html>', { status: 404 });

console.log('\n-- 7a. Retry: 1. Call 503, 2. Call 200 → ok, attempts=2, retried=true, 2 Requests --');
{
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const retryNotices: number[] = [];
  const outcome = await fetchSavedImagesWithRetry({
    fetchImpl: sequencedFetch([storageDownStep, okStep], calls),
    sleep: async (ms) => { sleeps.push(ms); },
    onRetry: (attempt) => { retryNotices.push(attempt); },
  });
  eq(outcome.result.kind, 'ok', 'nach dem Wiederholungsversuch ist das Ergebnis ok (keine still leere Galerie)');
  eq(outcome.result.kind === 'ok' ? outcome.result.report.images.length : -1, 2, 'die Bilddaten des 2. Versuchs kommen an');
  eq(outcome.result.kind === 'ok' ? outcome.result.report.images[0].id : '', ID_A, 'die erwartete Bild-ID ist enthalten');
  eq(outcome.attempts, 2, 'attempts=2 (Erstversuch + genau eine Wiederholung)');
  eq(outcome.retried, true, 'retried=true');
  eq(calls.length, 2, 'genau 2 Requests insgesamt');
  eq(sleeps.length, 1, 'genau 1 Wartezeit zwischen den Versuchen');
  eq(sleeps[0], SAVED_IMAGES_RETRY_DELAY_MS, 'Wartezeit = SAVED_IMAGES_RETRY_DELAY_MS');
  eq(retryNotices.join(','), '2', 'onRetry meldet genau den 2. Versuch (UI-Status „wird wiederholt")');
  eq(calls[0].url, '/api/images', '1. Versuch geht an GET /api/images');
  eq(calls[1].url, calls[0].url, 'Wiederholung nutzt denselben Pfad');
  eq(calls[1].init?.credentials, 'same-origin', 'Wiederholung bleibt cookie-authentifiziert');
  eq(isSavedImagesHardError(outcome.result), false, 'ein Erfolg ist kein Fehlerzustand');
}

console.log('-- 7b. Endgültiger Fehlschlag: beide Calls 503 → kein stilles „leer", sichtbarer Fehler --');
{
  // (b1) 503 mit einem FREMDEN Code (Cold-Start/Funktionsfehler) — die Galerie muss
  // einen harten Ladefehler mit „erneut versuchen" zeigen, NICHT „keine Bilder".
  const calls: Call[] = [];
  const outcome = await fetchSavedImagesWithRetry({
    fetchImpl: sequencedFetch([otherFail503Step, otherFail503Step], calls),
    sleep: async () => { /* kein echtes Warten im Test */ },
  });
  ok(outcome.result.kind !== 'ok', 'Ergebnis ist NIE „ok" (kein stilles Leer)');
  eq(outcome.result.kind, 'error', '503 mit fremdem Code bleibt ein harter Fehler');
  eq(outcome.result.kind === 'error' ? outcome.result.status : 0, 503, 'Status 503 bleibt erhalten');
  eq(isSavedImagesHardError(outcome.result), true, 'isSavedImagesHardError=true → sichtbarer Hinweis + Retry-Knopf');
  eq(outcome.attempts, 2, 'attempts=2 (auch beim endgültigen Fehlschlag gezählt)');
  eq(outcome.retried, true, 'retried=true');
  eq(calls.length, 2, 'genau 2 Requests, keine Schleife');

  // (b2) 503 `storage_unavailable` — eigener, ehrlicher Hinweis-Zweig (Amber-Banner).
  // Bewusst KEIN harter Fehler: der Nutzer bekommt eine konkrete Aussage statt
  // eines Fehlerdialogs. Wichtig ist, dass es NICHT als „leer" endet.
  const callsDown: Call[] = [];
  const down = await fetchSavedImagesWithRetry({
    fetchImpl: sequencedFetch([storageDownStep, storageDownStep], callsDown),
    sleep: async () => { /* kein echtes Warten */ },
  });
  eq(down.result.kind, 'storage_unavailable', '2× 503 storage_unavailable → eigener Hinweis-Zweig');
  ok(down.result.kind !== 'ok', 'auch dieser Ausgang ist nie ein stilles „leer"');
  eq(down.attempts, 2, 'attempts=2');
  eq(down.retried, true, 'retried=true');
  eq(callsDown.length, 2, 'genau 2 Requests');

  // (b3) 500 und Netzfehler sind ebenfalls hart und enden nach 2 Versuchen.
  const calls500: Call[] = [];
  const e500 = await fetchSavedImagesWithRetry({
    fetchImpl: sequencedFetch([error500Step, error500Step], calls500),
    sleep: async () => { /* kein echtes Warten */ },
  });
  eq(e500.result.kind, 'error', '2× 500 → error');
  eq(isSavedImagesHardError(e500.result), true, '2× 500 ist ein sichtbarer Fehler');
  eq(e500.attempts, 2, '2× 500 → attempts=2');

  const callsNet: Call[] = [];
  const net = await fetchSavedImagesWithRetry({
    fetchImpl: mockFetch(() => { throw new Error('offline'); }, callsNet),
    sleep: async () => { /* kein echtes Warten */ },
  });
  eq(net.result.kind, 'error', '2× Netzfehler → error');
  eq(net.result.kind === 'error' ? net.result.status : 1, 0, 'Netzfehler bleibt Status 0');
  eq(isSavedImagesHardError(net.result), true, 'Netzfehler ist ein sichtbarer Fehler');
  eq(net.attempts, 2, '2× Netzfehler → attempts=2');
  eq(callsNet.length, 2, 'genau 2 Requests (danach Schluss)');
}

console.log('-- 7c. Regression Erfolgsfall: 1. Call 200 → attempts=1, retried=false, 1 Request --');
{
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const retries: number[] = [];
  const outcome = await fetchSavedImagesWithRetry({
    fetchImpl: sequencedFetch([okStep, okStep], calls),
    sleep: async (ms) => { sleeps.push(ms); },
    onRetry: (attempt) => { retries.push(attempt); },
  });
  eq(outcome.result.kind, 'ok', '200 beim ersten Versuch → ok');
  eq(outcome.attempts, 1, 'attempts=1 (kein Zusatzaufruf im Normalfall)');
  eq(outcome.retried, false, 'retried=false');
  eq(calls.length, 1, 'genau 1 Request (keine Verdopplung des Netzverkehrs)');
  eq(sleeps.length, 0, 'keine Wartezeit im Erfolgsfall');
  eq(retries.length, 0, 'kein Retry-Status im Erfolgsfall');
}

console.log('-- 7d. 401/403/404 werden NICHT wiederholt (attempts=1) --');
{
  const cases: Array<[string, () => Response, number]> = [
    ['401', () => jsonResponse({ code: 'unauthorized' }, 401), 401],
    ['403', () => jsonResponse({}, 403), 403],
    ['404 (Route fehlt in dieser Live-Version)', notFoundStep, 404],
  ];
  for (const [label, step, status] of cases) {
    const calls: Call[] = [];
    const sleeps: number[] = [];
    const outcome = await fetchSavedImagesWithRetry({
      fetchImpl: sequencedFetch([step, okStep], calls), // ein 2. Versuch würde „ok" liefern
      sleep: async (ms) => { sleeps.push(ms); },
    });
    eq(outcome.attempts, 1, `${label}: attempts=1 (nicht wiederholt)`);
    eq(outcome.retried, false, `${label}: retried=false`);
    eq(calls.length, 1, `${label}: genau 1 Request`);
    eq(sleeps.length, 0, `${label}: keine Wartezeit`);
    ok(outcome.result.kind !== 'ok', `${label}: der 2. (gute) Versuch wird bewusst nicht genutzt`);
    eq(outcome.result.kind === 'error' ? outcome.result.status : (outcome.result.kind === 'unauthorized' ? outcome.result.status : 0), status, `${label}: Status bleibt erhalten`);
  }
  eq(isSavedImagesHardError({ kind: 'error', status: 404 }), false, '404 ist KEIN sichtbarer Ladefehler (Version ohne Route)');
  eq(isSavedImagesHardError(null), false, 'ohne Ergebnis kein Fehlerzustand');
}

console.log('-- 7e. Grenzen: Defaults, Abschaltung (Unmount) und Retry-Klassifikation --');
{
  eq(SAVED_IMAGES_RETRIES, 1, 'Default: genau EIN Wiederholungsversuch');
  eq(SAVED_IMAGES_RETRY_DELAY_MS, 1000, 'Default-Wartezeit 1000 ms');
  eq(isRetryableSavedImagesFailure({ kind: 'ok', report: REPORT }), false, 'ok wird nicht wiederholt');
  eq(isRetryableSavedImagesFailure({ kind: 'unauthorized', status: 401 }), false, '401/403 werden nicht wiederholt');
  eq(isRetryableSavedImagesFailure({ kind: 'error', status: 404 }), false, '404 wird nicht wiederholt');
  eq(isRetryableSavedImagesFailure({ kind: 'error', status: 400 }), false, '4xx (außer 401/403/404) wird nicht wiederholt');
  eq(isRetryableSavedImagesFailure({ kind: 'storage_unavailable', status: 503 }), true, '503 storage_unavailable wird wiederholt');
  eq(isRetryableSavedImagesFailure({ kind: 'error', status: 503 }), true, '503 wird wiederholt');
  eq(isRetryableSavedImagesFailure({ kind: 'error', status: 0 }), true, 'Netzfehler (Status 0) wird wiederholt');
  eq(isRetryableSavedImagesFailure({ kind: 'error', status: 502 }), true, '502 wird wiederholt');

  // `retries: 0` schaltet die Wiederholung ab (kein zweiter Request).
  const calls0: Call[] = [];
  const none = await fetchSavedImagesWithRetry({
    fetchImpl: sequencedFetch([storageDownStep, okStep], calls0),
    retries: 0,
    sleep: async () => { /* nie aufgerufen */ },
  });
  eq(none.attempts, 1, 'retries:0 → attempts=1');
  eq(calls0.length, 1, 'retries:0 → genau 1 Request');
  eq(none.retried, false, 'retries:0 → retried=false');

  // Eigenes `delayMs` wird benutzt (kein Backoff, fester Wert).
  const delays: number[] = [];
  await fetchSavedImagesWithRetry({
    fetchImpl: sequencedFetch([storageDownStep, okStep], []),
    delayMs: 7,
    sleep: async (ms) => { delays.push(ms); },
  });
  eq(delays.join(','), '7', 'injizierte Wartezeit = delayMs');

  // Abbruch (Unmount): `shouldContinue=false` verhindert den 2. Versuch.
  const callsAbort: Call[] = [];
  const aborted = await fetchSavedImagesWithRetry({
    fetchImpl: sequencedFetch([storageDownStep, okStep], callsAbort),
    sleep: async () => { /* kein echtes Warten */ },
    shouldContinue: () => false,
  });
  eq(aborted.attempts, 1, 'Unmount vor der Wiederholung → attempts=1');
  eq(callsAbort.length, 1, 'Unmount → kein 2. Request');
  ok(aborted.result.kind !== 'ok', 'Unmount liefert kein erfundenes „ok"');

  // Es wird nie mehr als der Standard-Retry versucht, auch wenn dauerhaft 503 kommt.
  const callsLoop: Call[] = [];
  const loop = await fetchSavedImagesWithRetry({
    fetchImpl: sequencedFetch([storageDownStep], callsLoop),
    sleep: async () => { /* kein echtes Warten */ },
  });
  eq(callsLoop.length, 2, 'dauerhaft 503 → genau 2 Requests (keine Endlosschleife)');
  eq(loop.attempts, 2, 'dauerhaft 503 → attempts=2');
}

// ── 8. Statischer Verdrahtungs-Check (Textbeweis, kein Verhaltenstest) ───────
{
  const studio = readFileSync(new URL('./src/routes/app/image-studio.tsx', import.meta.url), 'utf8');
  ok(studio.includes('useSavedImages('), 'Studio ruft die Meta-Liste ab (useSavedImages)');
  ok(studio.includes('mergeGallery(images'), 'Studio vereinigt Session-Bilder mit den gespeicherten');
  ok(studio.includes('SavedImageCard'), 'Studio zeigt gespeicherte Bilder als Karten');
  ok(studio.includes('savedImages.refresh()'), 'Studio frischt die Liste nach einer Generierung auf');
  ok(studio.includes('saved: result.saved === true'), 'Studio übernimmt das saved-Flag des done-Events');
  ok(studio.includes('result.imageId ?? crypto.randomUUID()'), 'Studio nutzt die Server-ID (Duplikate nach ID vermeidbar)');
  ok(studio.includes("savedImages.result?.kind === 'storage_unavailable'"), 'Studio hat den ehrlichen 503-Zweig');
  // Live-Fund 2026-10-20: sichtbarer Fehlerzustand statt still leerer Galerie.
  ok(studio.includes('image-gallery-load-error'), 'Studio zeigt einen sichtbaren Ladefehler-Hinweis');
  ok(studio.includes('savedImages.failed &&'), 'der Hinweis hängt am harten Fehlerzustand (useSavedImages.failed)');
  ok(studio.includes('data-testid="image-gallery-load-retry"'), 'Studio bietet „Erneut versuchen" an');
  ok(studio.includes('savedImages.failed ? '), 'der Leer-Platzhalter ist bei hartem Fehler unterdrückt (kein „Noch keine Bilder")');

  const project = readFileSync(new URL('./src/routes/app/projects/$projectId.tsx', import.meta.url), 'utf8');
  ok(project.includes('<SavedImagesPanel projectId={project.id} />'), 'Projektseite zeigt gespeicherte Bilder des Projekts');

  const panel = readFileSync(new URL('./src/components/SavedImages.tsx', import.meta.url), 'utf8');
  ok(panel.includes('fetchSavedImageBytes'), 'Download nutzt die Route /api/images/<id>');
  ok(panel.includes('fetchSavedImagesWithRetry('), 'die Galerie lädt MIT Wiederholungsversuch (Live-Fund 2026-10-20)');
  ok(panel.includes('isSavedImagesHardError(result)'), 'die Projektseite zeigt den harten Ladefehler sichtbar');
  ok(panel.includes('saved-images-load-error') && panel.includes('saved-images-load-retry'), 'Projektseite: Hinweis + „erneut versuchen"');
  ok(!/blob\.vercel-storage|\.public\.blob\.|blob\.vercel\.com/.test(panel), 'keine private Store-URL im Client-Code');

  // i18n-Parität der neuen Schlüssel (de + en, je genau einmal).
  const de = readFileSync(new URL('./src/i18n/de.ts', import.meta.url), 'utf8');
  const en = readFileSync(new URL('./src/i18n/en.ts', import.meta.url), 'utf8');
  const keys = [
    'image_studio_saved_title', 'image_studio_saved_badge', 'image_studio_saved_badge_hint',
    'image_studio_saved_status', 'image_studio_saved_status_nocap', 'image_studio_saved_warning',
    'image_studio_saved_unavailable', 'image_studio_saved_not_configured', 'image_studio_saved_download',
    'image_studio_saved_download_failed', 'image_studio_saved_expires', 'image_studio_saved_loading_preview',
    'image_studio_saved_preview_failed', 'image_studio_saved_more', 'proj_saved_images_title',
    'proj_saved_images_empty',
    // Live-Fund 2026-10-20 (sichtbarer Fehlerzustand der Galerie).
    'image_studio_saved_load_failed', 'image_studio_saved_load_retry',
  ];
  for (const key of keys) {
    const deCount = de.split(`  ${key}:`).length - 1;
    const enCount = en.split(`  ${key}:`).length - 1;
    if (deCount !== 1 || enCount !== 1) {
      ok(false, `i18n ${key} (de=${deCount}, en=${enCount})`);
    }
  }
  ok(true, `i18n-Parität geprüft: ${keys.length} Schlüssel in de.ts und en.ts (je genau 1×)`);
}

console.log(`\n${checks - failed}/${checks} Checks grün${failed ? ` — ${failed} FEHLER` : ''}`);
if (failed) { console.error('Fehlgeschlagen:', failures.join(' | ')); process.exit(1); }
console.log('ERGEBNIS: GRÜN (K4-B UI-Anbindung, reine Mock-/Textprüfung, kein Netz, keine Prod-Berührung)');
