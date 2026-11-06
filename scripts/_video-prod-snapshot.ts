/**
 * VIDEO-TESTUMGEBUNG (2026-11-06) — PROD-Snapshot, ausschließlich LESEND.
 *
 *   bun --env-file=.env run scripts/_video-prod-snapshot.ts <ausgabe.txt>
 *
 * Zweck: belegen, dass die Video-Migration die Produktions-DB NICHT berührt hat
 * (die drei Tabellen existieren dort vorher und nachher nicht) und dass die
 * Tabellenzahl gleich bleibt. Es wird KEIN Statement geschrieben — nur SELECT
 * gegen information_schema.
 */
import { getDb } from '../src/db/index';
import { writeFileSync } from 'node:fs';

const out = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL fehlt');
const dbName = new URL(url).pathname.replace(/^\//, '');

type Tagged = (s: TemplateStringsArray, ...v: unknown[]) => Promise<Record<string, unknown>[]>;
const sql = getDb() as unknown as Tagged & { unsafe: (q: string) => unknown };
const raw = async (text: string) =>
  (await sql`${sql.unsafe(text)}`) as unknown as Record<string, unknown>[];

const tables = await raw(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`,
);
const names = tables.map((r) => String(r.table_name));
const videoTables = names.filter((n) => ['video_jobs', 'generated_videos', 'video_usage_monthly'].includes(n));
const counts = await raw(
  `SELECT (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public') AS tables`,
);

const lines = [
  `Ziel-DB-Name : ${dbName}`,
  `Zeitpunkt    : ${new Date().toISOString()}`,
  `Tabellen     : ${names.length} (${names.join(', ')})`,
  `Video-Tabellen vorhanden: ${videoTables.length === 0 ? 'KEINE' : videoTables.join(', ')}`,
  `information_schema.tables count: ${JSON.stringify(counts[0])}`,
];
const text = lines.join('\n') + '\n';
if (out) writeFileSync(out, text);
console.log(text);
process.exit(0);
