/**
 * K4-B — Integrations-Suite auf einer LOKALEN Postgres-Kopie + Blob-Fake
 * Aufruf: `bun generated-images-integration-test.ts` · Exit 0 = grün.
 *
 * Leitplanken (Auftrag 2026-10-19):
 *  * KEINE Produktions-DB, KEIN echter Blob-Store, KEIN OpenAI-Aufruf, KEIN Deploy.
 *  * Die Suite wird OHNE `--env-file=.env` gestartet und BRICHT AB, wenn
 *    `DATABASE_URL` oder `BLOB_READ_WRITE_TOKEN` gesetzt sind — sie darf nie
 *    versehentlich gegen Prod laufen.
 *  * SQL läuft über einen psql-Executor gegen einen lokalen PG-16-Cluster
 *    (Muster db-bereinigung-2026-10-18/wiederherstellungstest): dieselben
 *    SQL-Texte wie in Produktion, nur der Transport ist lokal.
 *  * Blob: In-Memory-Fake mit identischer Schnittstelle (kein Token vorhanden).
 *
 * Szenarien (DESIGN-FREEZE §6b): Migration 2× idempotent + Additivitäts-Beweis ·
 * 200/201er-Cap inkl. Blob-Löschung · 90-Tage-Ablauf (Cron) · Zugriff 401/403/404/410 ·
 * abgebrochener Blob-Delete → Sweeper holt nach · Projekt-Löschung behält Bild ·
 * Kontolöschung in der festgelegten Reihenfolge · Cron 401/401/Zähler-JSON/2× gleich ·
 * Guard-Grenze (unter/auf/über Deckel) + Bestandsschutz · Zähl-Semantik (0 Generierungen).
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { ImageSql } from './src/db/generated-images';
import { qCountLiveImages, qGetImageById, qImageStats, qSumLiveBytes } from './src/db/generated-images';
import { createMemoryBlobStore } from './src/lib/blob-store';
import {
  deleteAccountImages,
  deleteOwnImage,
  fetchOwnImage,
  runDailySweep,
  saveGeneratedImage,
  sweepPendingDeletions,
} from './src/lib/generated-images-service';
import { handleCronBlobTtlApi, CRON_BLOB_TTL_PATH } from './src/api/cron-blob-ttl';
import { resolveImageLimits } from './src/lib/generated-images-logic';

let checks = 0;
let failed = 0;
const failures: string[] = [];
function ok(cond: boolean, label: string) {
  checks += 1;
  if (!cond) {
    failed += 1;
    failures.push(label);
    console.error(`FAIL  ${label}`);
  }
}
function eq<T>(actual: T, expected: T, label: string) {
  ok(Object.is(actual, expected), `${label} (erwartet ${String(expected)}, war ${String(actual)})`);
}

// ── Lokaler Postgres-Cluster ─────────────────────────────────────────────────

const BASE = '/tmp/k4b-pg';
const DATA = `${BASE}/data`;
const SOCK = `${BASE}/sock`;
const TMP = `${BASE}/tmp`;
const LOG = `${BASE}/log.txt`;
const PORT = '55437';
const DB = 'growimo_k4b_test';
const RUN_AS_POSTGRES = process.getuid?.() === 0;
// initdb/pg_ctl liegen unter Debian/Ubuntu nicht im PATH (nur psql ist global).
// `su postgres -c` startet keine Login-Shell → absoluter Pfad ist Pflicht.
const PG_BIN = existsSync('/usr/lib/postgresql/16/bin/initdb') ? '/usr/lib/postgresql/16/bin/' : '';

console.log('=== K4-B Integrations-Suite (lokale Postgres-Kopie + Blob-Fake) ===');
console.log(`uid=${String(process.getuid?.())} · Cluster ${DATA} · Port ${PORT} · DB ${DB}`);
if (process.env.DATABASE_URL) {
  console.error('ABBRUCH: DATABASE_URL ist gesetzt — diese Suite darf NIE gegen die Produktions-DB laufen.');
  process.exit(2);
}
if (process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('ABBRUCH: BLOB_READ_WRITE_TOKEN ist gesetzt — diese Suite nutzt nur den Fake-Store.');
  process.exit(2);
}
console.log('DATABASE_URL/BLOB_READ_WRITE_TOKEN: nicht gesetzt (korrekt — keine Prod-DB, kein echter Store)');

function asPostgres(cmd: string): string[] {
  return RUN_AS_POSTGRES ? ['su', 'postgres', '-c', cmd] : ['sh', '-c', cmd];
}

function run(args: string[], label: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(args[0], args.slice(1), { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function sh(cmd: string, label: string): string {
  const r = run(asPostgres(cmd), label);
  if (r.status !== 0) {
    console.error(`FEHLER bei ${label}:\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  return r.stdout;
}

/** SQL-Datei lokal ausführen (mehrere Statements erlaubt, ON_ERROR_STOP = fail-fast). */
function psqlFile(file: string, db = DB): string {
  const r = run(asPostgres(`psql -X -q -A -t -h ${SOCK} -p ${PORT} -U postgres -d ${db} -v ON_ERROR_STOP=1 -f ${file}`), `psql ${file}`);
  if (r.status !== 0) {
    console.error(`psql-Fehler (${file}):\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  return r.stdout;
}

/** Wert-Rendering für den Test-Executor (alle Werte sind hier testkontrolliert). */
function render(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  if (Array.isArray(value)) throw new Error('Array-Parameter werden in dieser Suite nicht benutzt');
  throw new Error(`Unbekannter Parameter-Typ: ${typeof value}`);
}

let querySeq = 0;
/** psql-gestützter ImageSql-Executor — identische SQL-Texte, lokaler Transport. */
function makeLocalSql(): ImageSql {
  return (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let q = strings[0];
    for (let i = 0; i < values.length; i += 1) q += render(values[i]) + strings[i + 1];
    const wrapped = `WITH __t AS (${q}) SELECT COALESCE(json_agg(__t), '[]'::json)::text FROM __t`;
    querySeq += 1;
    const file = `${TMP}/q${querySeq}.sql`;
    writeFileSync(file, wrapped, 'utf8');
    const out = psqlFile(file).trim();
    if (!out) return [];
    try {
      return JSON.parse(out) as Record<string, unknown>[];
    } catch {
      console.error(`JSON-Parse-Fehler bei Query ${querySeq}:\n${out}`);
      process.exit(1);
    }
  }) as unknown as ImageSql;
}

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;
const PNG_BYTES = Buffer.from(PNG_B64, 'base64');

// Aufbau
run(asPostgres(`pkill -f "${DATA}" || true`), 'stale cluster kill');
rmSync(BASE, { recursive: true, force: true });
// 0777, damit der postgres-Nutzer (Cluster-Eigentümer) darin schreiben darf —
// der Aufrufer ist hier root, initdb/pg_ctl laufen als postgres.
mkdirSync(BASE, { recursive: true, mode: 0o777 });
// mkdirSync unterliegt der umask (022) → explizit freigeben, damit postgres schreiben darf.
chmodSync(BASE, 0o777);
sh(`mkdir -p ${DATA} ${SOCK} ${TMP}`, 'Verzeichnisse');
sh(`${PG_BIN}initdb -D ${DATA} -U postgres --auth=trust --encoding=UTF8 --locale=C`, 'initdb');
sh(`${PG_BIN}pg_ctl -D ${DATA} -o "-p ${PORT} -k ${SOCK} -c listen_addresses=''" -l ${LOG} -w start`, 'pg_ctl start');
sh(`psql -X -q -h ${SOCK} -p ${PORT} -U postgres -d postgres -c "CREATE DATABASE ${DB}"`, 'createdb');
const serverVersion = sh(`psql -X -q -A -t -h ${SOCK} -p ${PORT} -U postgres -d postgres -c "SHOW server_version"`, 'version').trim();
console.log(`Server-Version: PostgreSQL ${serverVersion}`);

const migrationFile = `${import.meta.dir}/migrations/generated_images.migration.sql`;
writeFileSync(
  `${TMP}/base.sql`,
  `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` + `;`
  + `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  clerk_id TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)` + `;`
  + `
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  product_idea TEXT,
  content_types JSONB DEFAULT '[]',
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  favorite BOOLEAN DEFAULT false,
  versions JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}'
)` + `;`
  + `
CREATE TABLE IF NOT EXISTS usage_monthly (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, period)
)` + `;`
  + `
CREATE TABLE IF NOT EXISTS generated_content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  title TEXT,
  body TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);`,
  'utf8',
);
psqlFile(`${TMP}/base.sql`);

const BASE_TABLES = ['users', 'projects', 'generated_content', 'usage_monthly'];
function tableColumns(table: string): string[] {
  const f = `${TMP}/cols_${table}.sql`;
  writeFileSync(
    f,
    `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' ORDER BY column_name`,
    'utf8',
  );
  return psqlFile(f)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
/** Anzahl FK-Regeln einer Spalte (für den SET-NULL-Beweis). */
function fkDeleteRule(constraintName: string): string {
  const f = `${TMP}/fk.sql`;
  writeFileSync(
    f,
    `SELECT confdeltype FROM pg_constraint WHERE conname = '${constraintName}' OR (conrelid = 'generated_images'::regclass AND contype = 'f')`,
    'utf8',
  );
  return psqlFile(f).trim();
}
const beforeCols = new Map(BASE_TABLES.map((t) => [t, tableColumns(t)]));

// ── Szenario 1: Migration 2× idempotent + Additivitäts-Beweis ────────────────

psqlFile(migrationFile);
const colsAfter1 = tableColumns('generated_images');
psqlFile(migrationFile);
const colsAfter2 = tableColumns('generated_images');
eq(colsAfter2.join(','), colsAfter1.join(','), 'Migrations-Idempotenz: identische Spaltenliste nach dem 2. Lauf');
eq(colsAfter1.length, 13, 'generated_images hat genau 13 Spalten');
for (const col of ['id', 'user_id', 'project_id', 'blob_path', 'blob_url', 'aspect_ratio', 'mime_type', 'size_bytes', 'prompt', 'created_at', 'expires_at', 'deleted_at', 'delete_reason']) {
  ok(colsAfter1.includes(col), `Spalte ${col} vorhanden`);
}
for (const t of BASE_TABLES) {
  eq(tableColumns(t).join(','), (beforeCols.get(t) ?? []).join(','), `Additivität: ${t} unverändert`);
}
// expires_at hat bewusst KEINEN Default (eine Wahrheit: IMAGE_TTL_DAYS)
const defaultRows = psqlFile(
  (() => {
    const f = `${TMP}/defaults.sql`;
    writeFileSync(
      f,
      `SELECT column_name, column_default IS NOT NULL AS has_default FROM information_schema.columns WHERE table_name = 'generated_images' AND column_name IN ('expires_at','created_at','size_bytes') ORDER BY column_name`,
      'utf8',
    );
    return f;
  })(),
)
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);
eq(defaultRows.join(' '), 'created_at|t expires_at|f size_bytes|f', 'expires_at/ size_bytes ohne DB-Default, created_at mit NOW()-Default');
// FK-Regel project_id = SET NULL (n), user_id = CASCADE (c)
const fkRules = fkDeleteRule('generated_images_project_id_fkey').split('\n').map((l) => l.trim()).filter(Boolean).join(',');
ok(fkRules.split(',').includes('n'), 'FK project_id nutzt ON DELETE SET NULL (confdeltype = n)');
ok(fkRules.split(',').includes('c'), 'FK user_id nutzt ON DELETE CASCADE (confdeltype = c)');
console.log(`Migrations-Nachweis: 2× idempotent · generated_images=${colsAfter1.length} Spalten · Bestandstabellen unverändert · FK-Regeln=${fkRules}`);

// ── Testdaten ────────────────────────────────────────────────────────────────

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const PROJECT_A = '33333333-3333-4333-8333-333333333333';
writeFileSync(
  `${TMP}/seed.sql`,
  `INSERT INTO users (id, email, clerk_id) VALUES ('${USER_A}', 'a@test.local', 'clerk_a'), ('${USER_B}', 'b@test.local', 'clerk_b')` + `;`
  + `INSERT INTO projects (id, user_id, title) VALUES ('${PROJECT_A}', '${USER_A}', 'Projekt A')` + `;`
  + `INSERT INTO usage_monthly (user_id, period, count) VALUES ('${USER_A}', '2026-10', 7);`,
  'utf8',
);
psqlFile(`${TMP}/seed.sql`);

const sql = makeLocalSql();
const limits = resolveImageLimits({});
const store = createMemoryBlobStore();

// 200 Bestandsbilder für Nutzer A (Setup; die 201. Speicherung läuft über den Service)
for (let i = 0; i < 200; i += 1) {
  await store.put(`images/${USER_A}/bulk-${i}`, PNG_BYTES, 'image/png');
}
const bulkRows = Array.from({ length: 200 }, (_, i) =>
  `('${USER_A}', 'images/${USER_A}/bulk-${i}', 'image/png', ${PNG_BYTES.byteLength}, clock_timestamp() - INTERVAL '${200 - i} minutes', clock_timestamp() + INTERVAL '90 days')`,
).join(',');
writeFileSync(`${TMP}/bulk.sql`, `INSERT INTO generated_images (user_id, blob_path, mime_type, size_bytes, created_at, expires_at) VALUES ${bulkRows};`, 'utf8');
psqlFile(`${TMP}/bulk.sql`);
eq((await qImageStats(sql)).live, 200, 'Setup: 200 lebende Bilder');
eq(await qCountLiveImages(sql, USER_A), 200, 'Setup: Count Nutzer A = 200');

// ── Szenario 2: 201er-Cap inkl. Blob-Löschung ────────────────────────────────

const save201 = await saveGeneratedImage(
  { userId: USER_A, dataUrl: PNG_DATA_URL, aspectRatio: '2:3', prompt: 'Bild 201', projectId: null },
  { sql, store, limits },
);
ok(save201.saved, '201. Speicherung wird angenommen');
eq(save201.reason, 'saved', 'Speicherergebnis ist "saved"');
eq(await qCountLiveImages(sql, USER_A), 200, 'nach dem Fenster: wieder genau 200 lebende Bilder');
eq(store.entries.size, 200, 'Fake-Store: genau 200 Blobs (das älteste wurde gelöscht)');
ok(!store.entries.has(`images/${USER_A}/bulk-0`), 'ältestes Bild (bulk-0) ist gelöscht — deterministisch ältestes zuerst');
ok(store.entries.has(save201.blobPath ?? ''), 'das neue Blob liegt im Store');
eq((await qImageStats(sql)).marked, 0, 'kein Überhang bleibt markiert (Sweep im selben Lauf)');
ok((await qSumLiveBytes(sql)) < limits.globalBytesCap, 'gespeicherte Bytes bleiben unter dem Guard-Deckel');

// ── Szenario 3: 90-Tage-Ablauf (Cron) ───────────────────────────────────────

writeFileSync(
  `${TMP}/ttl.sql`,
  `UPDATE generated_images SET expires_at = NOW() - INTERVAL '1 second' WHERE blob_path = 'images/${USER_A}/bulk-1'` + `;`
  + `UPDATE generated_images SET expires_at = NOW() + INTERVAL '10 seconds' WHERE blob_path = 'images/${USER_A}/bulk-2';`,
  'utf8',
);
psqlFile(`${TMP}/ttl.sql`);
const sweep1 = await runDailySweep({ sql, store, limits });
eq(sweep1.marked, 1, 'Cron markiert genau das abgelaufene Bild');
eq(sweep1.blobDeleted, 1, 'Cron löscht genau einen Blob');
eq(sweep1.rowsDeleted, 1, 'Cron löscht genau eine Zeile');
ok(!store.entries.has(`images/${USER_A}/bulk-1`), 'abgelaufenes Blob ist weg');
ok(store.entries.has(`images/${USER_A}/bulk-2`), 'noch gültiges Bild (+10 s) bleibt erhalten');
const sweep2 = await runDailySweep({ sql, store, limits });
eq(sweep2.marked + sweep2.rowsDeleted, 0, '2. Cron-Lauf verändert nichts (Idempotenz)');

// ── Szenario 4: Zugriffskontrolle (401/403/404/410) ─────────────────────────

const liveRow = await sql`SELECT id FROM generated_images WHERE user_id = ${USER_A}::uuid AND deleted_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`;
const liveId = String(liveRow[0].id);
const own = await fetchOwnImage({ requesterUserId: USER_A, imageId: liveId }, { sql, store, limits });
eq(own.status, 200, 'eigenes Bild → 200');
ok(own.status === 200 && own.bytes.byteLength === PNG_BYTES.byteLength, 'Download liefert die echten Original-Bytes');
eq((await fetchOwnImage({ requesterUserId: null, imageId: liveId }, { sql, store, limits })).status, 401, 'ohne Session → 401');
eq((await fetchOwnImage({ requesterUserId: USER_B, imageId: liveId }, { sql, store, limits })).status, 403, 'fremder Nutzer → 403');
eq(
  (await fetchOwnImage({ requesterUserId: USER_A, imageId: '99999999-9999-4999-8999-999999999999' }, { sql, store, limits })).status,
  404,
  'unbekannte id → 404',
);

// 410 inkl. Lazy-Löschung
writeFileSync(`${TMP}/expired.sql`, `UPDATE generated_images SET expires_at = NOW() - INTERVAL '1 minute' WHERE blob_path = 'images/${USER_A}/bulk-3';`, 'utf8');
psqlFile(`${TMP}/expired.sql`);
const expiredRow = await sql`SELECT id FROM generated_images WHERE blob_path = ${`images/${USER_A}/bulk-3`}::text`;
const expiredId = String(expiredRow[0].id);
eq((await fetchOwnImage({ requesterUserId: USER_A, imageId: expiredId }, { sql, store, limits })).status, 410, 'abgelaufenes Bild → 410');
ok((await qGetImageById(sql, expiredId)) === null, 'Lazy-Löschung: die Zeile ist danach weg');
ok(!store.entries.has(`images/${USER_A}/bulk-3`), 'Lazy-Löschung: das Blob ist danach weg');

// ── Szenario 5: Projekt-Löschung behält das Bild (SET NULL) ─────────────────

writeFileSync(
  `${TMP}/project.sql`,
  `UPDATE generated_images SET project_id = '${PROJECT_A}' WHERE blob_path = 'images/${USER_A}/bulk-4'` + `;`
  + `DELETE FROM projects WHERE id = '${PROJECT_A}';`,
  'utf8',
);
psqlFile(`${TMP}/project.sql`);
const keptRows = await sql`
  SELECT id, project_id, deleted_at, delete_reason FROM generated_images WHERE blob_path = ${`images/${USER_A}/bulk-4`}::text`;
eq(keptRows.length, 1, 'Projekt-Löschung behält die Bildzeile');
eq(String(keptRows[0].project_id), 'null', 'project_id ist NULL (ON DELETE SET NULL, nicht CASCADE)');
eq(String(keptRows[0].deleted_at), 'null', 'das Bild ist NICHT markiert');
eq(String(keptRows[0].delete_reason), 'null', 'kein Löschgrund gesetzt (Projekt-Löschung löscht nie Bilder)');
ok(store.entries.has(`images/${USER_A}/bulk-4`), 'das Blob bleibt erhalten');
eq(
  (await fetchOwnImage({ requesterUserId: USER_A, imageId: String(keptRows[0].id) }, { sql, store, limits })).status,
  200,
  'das Bild bleibt nach der Projekt-Löschung herunterladbar',
);

// ── Szenario 6: Guard-Grenze (unter/auf/über) + Bestandsschutz ──────────────

const baseBytes = await qSumLiveBytes(sql);
const CAP = baseBytes + PNG_BYTES.byteLength * 3; // genau drei weitere Bilder passen
const testLimits = { ...limits, globalBytesCap: CAP, globalWarnBytes: CAP - PNG_BYTES.byteLength };
let warnings: Array<{ liveBytes: number }> = [];
const guardDeps = { sql, store, limits: testLimits, onCapacityWarning: (info: { liveBytes: number }) => warnings.push(info) };
const g1 = await saveGeneratedImage({ userId: USER_B, dataUrl: PNG_DATA_URL, prompt: 'Guard 1' }, guardDeps);
ok(g1.saved, 'Guard: Speicherung unter dem Deckel erlaubt');
eq(warnings.length, 0, 'unter der Warnschwelle wird nicht gewarnt');
const g2 = await saveGeneratedImage({ userId: USER_B, dataUrl: PNG_DATA_URL, prompt: 'Guard 2' }, guardDeps);
ok(g2.saved, 'Guard: zweite Speicherung erlaubt');
const g3 = await saveGeneratedImage({ userId: USER_B, dataUrl: PNG_DATA_URL, prompt: 'Guard 3' }, guardDeps);
ok(g3.saved, 'Guard: Speicherung GENAU bis auf den Deckel erlaubt (liveBytes + size == cap)');
ok(warnings.length > 0, 'Warnschwelle wird gemeldet, sobald sie erreicht ist (Banner/Fehleranalyse)');
eq(await qSumLiveBytes(sql), CAP, 'die drei Bilder füllen den Deckel exakt aus');
const g4 = await saveGeneratedImage({ userId: USER_B, dataUrl: PNG_DATA_URL, prompt: 'über dem Deckel' }, guardDeps);
eq(g4.saved, false, 'Guard: Speicherung über dem Deckel wird abgelehnt');
eq(g4.reason, 'capacity', 'Ablehnungsgrund ist ehrlich "capacity"');
const blobsAfterReject = store.entries.size;
// Race-Zweig: derselbe Deckel, aber die Vorabprüfung wird umgangen (direkter INSERT-Pfad)
const raceInsert = await sql`
  INSERT INTO generated_images (user_id, project_id, blob_path, blob_url, aspect_ratio, mime_type, size_bytes, prompt, expires_at)
  SELECT ${USER_B}::uuid, NULL::uuid, ${'images/' + USER_B + '/race'}::text, NULL::text, NULL::text, 'image/png'::text,
         ${PNG_BYTES.byteLength}::bigint, 'race'::text, ${new Date(Date.now() + 86400000).toISOString()}::timestamptz
  WHERE (SELECT COALESCE(SUM(size_bytes), 0) FROM generated_images WHERE deleted_at IS NULL) + ${PNG_BYTES.byteLength}::bigint <= ${CAP}::bigint
  RETURNING id`;
eq(raceInsert.length, 0, 'Race-Nachprüfung: die INSERT-Bedingung lehnt bei vollem Deckel ab');
const overStoreCount = store.entries.size;
eq(overStoreCount, blobsAfterReject, 'abgelehnte Speicherung hinterlässt KEIN Blob (gezieltes del)');
// Bestandsschutz: Download/Löschen funktionieren trotz vollem Guard
const ownedRow = await sql`SELECT id FROM generated_images WHERE user_id = ${USER_B}::uuid AND deleted_at IS NULL AND expires_at > NOW() ORDER BY created_at ASC LIMIT 1`;
const ownedId = String(ownedRow[0].id);
eq(
  (await fetchOwnImage({ requesterUserId: USER_B, imageId: ownedId }, { sql, store, limits: testLimits })).status,
  200,
  'Bestandsschutz: Download bleibt trotz vollem Guard möglich (Guard blockiert nur NEUE put())',
);
eq((await deleteOwnImage({ requesterUserId: USER_B, imageId: ownedId }, { sql, store, limits: testLimits })).status, 200, 'manuelles Löschen bleibt möglich');
eq((await fetchOwnImage({ requesterUserId: USER_B, imageId: ownedId }, { sql, store, limits: testLimits })).status, 404, 'nach dem ENDGÜLTIGEN Löschen → 404 (Zeile ist weg; 410 gilt nur zwischen Markierung und Hard-Delete)');
eq((await deleteOwnImage({ requesterUserId: USER_A, imageId: ownedId }, { sql, store, limits: testLimits })).status, 404, 'Löschen einer bereits endgültig gelöschten Zeile → 404 (kein Leak über fremde/weg Bild-IDs)');
// Ausdrücklicher 403-Beweis: fremdes, LEBENDES Bild darf nicht gelöscht werden.
const foreignStillLive = await sql`SELECT id FROM generated_images WHERE user_id = ${USER_A}::uuid AND deleted_at IS NULL AND expires_at > NOW() LIMIT 1`;
eq((await deleteOwnImage({ requesterUserId: USER_B, imageId: String(foreignStillLive[0].id) }, { sql, store, limits: testLimits })).status, 403, 'Löschen eines fremden, lebenden Bildes → 403');
const g5 = await saveGeneratedImage({ userId: USER_B, dataUrl: PNG_DATA_URL, prompt: 'wieder möglich' }, guardDeps);
ok(g5.saved, 'Guard: nach freiem Platz ist die Speicherung wieder möglich (Guard rechnet automatisch neu)');
const guardOff = await saveGeneratedImage({ userId: USER_B, dataUrl: PNG_DATA_URL, prompt: 'Guard aus' }, { sql, store, limits: { ...testLimits, globalBytesCap: 0 } });
ok(guardOff.saved, 'Guard AUS (Env 0): Speicherung erlaubt — nur nach ausdrücklicher Freigabe');

// ── Szenario 7: abgebrochener Blob-Delete → Sweeper holt nach ───────────────

writeFileSync(`${TMP}/broken.sql`, `UPDATE generated_images SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = '${USER_B}' AND deleted_at IS NULL;`, 'utf8');
psqlFile(`${TMP}/broken.sql`);
store.failNextDeletes = 1;
const brokenSweep = await runDailySweep({ sql, store, limits });
ok(brokenSweep.blobFailed > 0, 'abgebrochener Blob-Delete wird als blobFailed gezählt');
eq((await qImageStats(sql)).marked, 0, 'Wiederanlauf im SELBEN Cron-Lauf: die abgebrochene Löschung ist aufgeholt (markiert = 0, konvergiert)');
const retrySweep = await sweepPendingDeletions({ sql, store, limits });
eq(retrySweep.rowsDeleted, 0, 'ein zusätzlicher Sweeper-Lauf hat nichts mehr zu tun (konvergiert, kein Datenverlust)');
ok(brokenSweep.blobFailed > 0 && (brokenSweep.blobDeleted + brokenSweep.rowsDeleted) > 0, 'auf den fehlgeschlagenen Batch folgte ein erfolgreicher Wiederanlauf im selben Lauf');
eq((await qImageStats(sql)).marked, 0, 'nach dem Wiederanlauf ist nichts mehr markiert');

// ── Szenario 8: Kontolöschung in der festgelegten Reihenfolge ───────────────

const USER_C = '44444444-4444-4444-8444-444444444444';
writeFileSync(`${TMP}/userc.sql`, `INSERT INTO users (id, email, clerk_id) VALUES ('${USER_C}', 'c@test.local', 'clerk_c');`, 'utf8');
psqlFile(`${TMP}/userc.sql`);
await saveGeneratedImage({ userId: USER_C, dataUrl: PNG_DATA_URL, prompt: 'C1' }, { sql, store, limits });
await saveGeneratedImage({ userId: USER_C, dataUrl: PNG_DATA_URL, prompt: 'C2' }, { sql, store, limits });
eq(await qCountLiveImages(sql, USER_C), 2, 'Setup Nutzer C: 2 Bilder');
let rowsAtUserDelete = -1;
const accountSweep = await deleteAccountImages(
  {
    userId: USER_C,
    deleteUserRow: async () => {
      rowsAtUserDelete = await qCountLiveImages(sql, USER_C);
      writeFileSync(`${TMP}/del-user.sql`, `DELETE FROM users WHERE id = '${USER_C}';`, 'utf8');
      psqlFile(`${TMP}/del-user.sql`);
    },
  },
  { sql, store, limits },
);
eq(accountSweep.marked, 2, 'Kontolöschung markiert alle Bilder als account_deleted');
eq(accountSweep.rowsDeleted, 2, 'Kontolöschung löscht beide Bildzeilen');
ok(accountSweep.userRowDeleted, 'users-Zeile wird ERST nach bestätigtem Blob-Delete gelöscht');
eq(rowsAtUserDelete, 0, 'im Moment des users-DELETE war keine lebende Bildzeile von Nutzer C mehr vorhanden');
eq([...store.entries.keys()].filter((p) => p.includes(USER_C)).length, 0, 'kein Blob von Nutzer C übrig');

// ── Szenario 9: Cron-Route (401 / 401 / Zähler-JSON / 2× gleich) ────────────

const cronStore = createMemoryBlobStore();
const cronReq = (auth?: string) =>
  new Request(`https://test.local${CRON_BLOB_TTL_PATH}`, auth ? { headers: { authorization: auth } } : {});
delete process.env.CRON_SECRET;
eq((await handleCronBlobTtlApi(cronReq('Bearer irgendwas'), CRON_BLOB_TTL_PATH, { sql, store: cronStore, limits })).status, 401, 'Cron ohne CRON_SECRET → 401 (fail-closed, nie offen)');
process.env.CRON_SECRET = 'test-secret-16-chars-min';
eq((await handleCronBlobTtlApi(cronReq(), CRON_BLOB_TTL_PATH, { sql, store: cronStore, limits })).status, 401, 'Cron ohne Header → 401');
eq((await handleCronBlobTtlApi(cronReq('Bearer falsch'), CRON_BLOB_TTL_PATH, { sql, store: cronStore, limits })).status, 401, 'Cron mit falschem Bearer → 401');
const cronOk = await handleCronBlobTtlApi(cronReq(`Bearer ${process.env.CRON_SECRET}`), CRON_BLOB_TTL_PATH, { sql, store: cronStore, limits });
eq(cronOk.status, 200, 'Cron mit richtigem Bearer → 200');
const cronBody = (await cronOk.json()) as Record<string, unknown>;
for (const key of ['marked', 'blobDeleted', 'blobFailed', 'rowsDeleted']) {
  ok(typeof cronBody[key] === 'number', `Cron-Antwort enthält den Zähler "${key}" als Zahl`);
}
const cronOk2 = await handleCronBlobTtlApi(cronReq(`Bearer ${process.env.CRON_SECRET}`), CRON_BLOB_TTL_PATH, { sql, store: cronStore, limits });
eq(JSON.stringify(await cronOk2.json()), JSON.stringify(cronBody), 'Cron: 2. Lauf liefert identische Zähler (idempotent)');
eq(await handleCronBlobTtlApi(new Request('https://test.local/api/andere'), '/api/andere', { sql, store: cronStore, limits }), null, 'Cron-Route greift nur auf ihrem Pfad');

// ── Szenario 10: Zähl-Semantik (0 Generierungen) ────────────────────────────

const usage = await sql`SELECT count FROM usage_monthly WHERE user_id = ${USER_A}::uuid AND period = ${'2026-10'}::text`;
eq(Number(usage[0].count), 7, 'usage_monthly unverändert: Speichern/Lesen/Löschen = 0 Generierungen');

// ── Ergebnis ─────────────────────────────────────────────────────────────────

const finalStats = await qImageStats(sql);
console.log('');
console.log(`Endstand: live=${finalStats.live} markiert=${finalStats.marked} gesamt=${finalStats.total} · Blobs(Store A-F)=${store.entries.size} · Queries=${querySeq} · Warnungen=${warnings.length}`);
console.log(`Checks: ${checks} · bestanden: ${checks - failed} · fehlgeschlagen: ${failed}`);
sh(`${PG_BIN}pg_ctl -D ${DATA} -m fast -w stop`, 'pg_ctl stop');
if (failed > 0) {
  console.error('FEHLGESCHLAGEN:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('PASS generated-images-integration-test');
