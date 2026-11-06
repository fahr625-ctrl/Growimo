/**
 * VIDEO-TESTUMGEBUNG (2026-11-06) — Rollback (NUR growimo_demo).
 *
 *   bun --env-file=/tmp/video/demo.env run scripts/video-rollback.ts
 *
 * Nimmt ausschließlich die drei neuen Tabellen zurück (video_jobs,
 * generated_videos, video_usage_monthly). Keine bestehende Tabelle wird
 * angefasst. Bricht ab, wenn DATABASE_URL nicht auf `growimo_demo` zeigt.
 */
import { getDb } from '../src/db/index';
import { assertDemoDatabase, rollbackVideoMigration } from '../src/db/video-migration';
import type { VideoSqlLike } from '../src/db/video-migration';

const dbName = assertDemoDatabase(process.env.DATABASE_URL);
console.log('Ziel-DB:', dbName);
const sql = getDb() as unknown as VideoSqlLike;
const result = await rollbackVideoMigration(sql, process.env.DATABASE_URL);
console.log('Statements:', result.statements);
console.log('Tabellen:', JSON.stringify(result.tables));
const gone = Object.values(result.tables).every((v) => v === false);
if (!gone) {
  console.error('FEHLER: mindestens eine Tabelle existiert noch');
  process.exit(1);
}
console.log('OK (Rollback vollständig)');
process.exit(0);
