/**
 * VIDEO-TESTUMGEBUNG (2026-11-06) — Migration anwenden (NUR growimo_demo).
 *
 *   bun --env-file=/tmp/video/demo.env run scripts/video-migrate.ts
 *
 * Bricht ab, wenn DATABASE_URL nicht auf `growimo_demo` zeigt. Gibt den
 * DB-Namen und die drei Tabellen aus — KEINE Zugangsdaten.
 */
import { getDb } from '../src/db/index';
import { applyVideoMigration, assertDemoDatabase } from '../src/db/video-migration';
import type { VideoSqlLike } from '../src/db/video-migration';

const dbName = assertDemoDatabase(process.env.DATABASE_URL);
console.log('Ziel-DB:', dbName);
const sql = getDb() as unknown as VideoSqlLike;
const result = await applyVideoMigration(sql, process.env.DATABASE_URL);
console.log('Statements:', result.statements);
console.log('Tabellen:', JSON.stringify(result.tables));
const ok = Object.values(result.tables).every(Boolean);
if (!ok) {
  console.error('FEHLER: nicht alle Tabellen wurden angelegt');
  process.exit(1);
}
console.log('OK');
process.exit(0);
