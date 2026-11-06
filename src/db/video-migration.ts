/**
 * VIDEO-TESTUMGEBUNG (2026-11-06) — Migration + Rollback, NUR auf `growimo_demo`.
 *
 * HARTE SPERRE (Auftrag): jede Anwendung des Video-Schemas prüft VORHER den
 * Datenbanknamen aus `DATABASE_URL`. Steht dort nicht `growimo_demo`, bricht die
 * Funktion ab, ohne ein einziges Statement abzusenden. Damit kann ein falsch
 * gesetztes `DATABASE_URL` (z. B. Prod-Neon) keinen Schaden anrichten — der
 * Test-Suite-Guard in `src/db/test-guard.ts` ist die zweite, unabhängige Schicht.
 */

import { splitSqlStatements } from './sql-split';
import { VIDEO_SCHEMA_TABLE_NAMES, videoRollbackSQL, videoSchemaSQL } from './video-schema';

/** Der EINZIGE erlaubte Ziel-Datenbankname in dieser Runde. */
export const VIDEO_DEMO_DB_NAME = 'growimo_demo';

export class VideoMigrationGuardError extends Error {
  readonly code = 'video_migration_guard';
  constructor(message: string) {
    super(message);
    this.name = 'VideoMigrationGuardError';
  }
}

/**
 * Prüft die Ziel-DB. Gibt den DB-Namen zurück oder wirft.
 * Kein `console.log` der URL — nur der Name wird ausgegeben.
 */
export function assertDemoDatabase(url: string | undefined | null): string {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    throw new VideoMigrationGuardError('DATABASE_URL ist nicht gesetzt');
  }
  let dbName: string;
  try {
    dbName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new VideoMigrationGuardError('DATABASE_URL ist keine gültige URL');
  }
  if (dbName !== VIDEO_DEMO_DB_NAME) {
    throw new VideoMigrationGuardError(
      `Video-Migration verweigert: Ziel-DB ist '${dbName}', erlaubt ist ausschließlich '${VIDEO_DEMO_DB_NAME}'. Es wurde nichts geändert.`,
    );
  }
  return dbName;
}

/**
 * Der Neon-Client dieser Repo-Version führt ROH-TEXT nur über den Tagged-
 * Template-Weg aus: `sql`${sql.unsafe(text)}`` (so macht es auch `init.ts`).
 * `sql.unsafe(text)` allein liefert ein Query-Objekt, KEINE Zeilen.
 */
export type VideoSqlLike = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  unsafe: (query: string) => unknown;
  transaction?: (queries: unknown[]) => Promise<unknown>;
};

/** Führt einen SQL-Text ohne Parameter aus (nur für Konstanten-SQL). */
async function runRaw(sql: VideoSqlLike, text: string): Promise<Record<string, unknown>[]> {
  return (await sql`${sql.unsafe(text)}`) as Record<string, unknown>[];
}

/** Welche der drei Video-Tabellen existieren? (read-only) */
export async function videoSchemaStatus(sql: VideoSqlLike): Promise<Record<string, boolean>> {
  const list = VIDEO_SCHEMA_TABLE_NAMES.map((t) => `'${t}'`).join(',');
  const rows = await runRaw(
    sql,
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${list})`,
  );
  const present = new Set(rows.map((r) => String((r as { table_name: string }).table_name)));
  return Object.fromEntries(VIDEO_SCHEMA_TABLE_NAMES.map((t) => [t, present.has(t)]));
}

/**
 * Wendet das Video-Schema an. Idempotent: ein zweiter Lauf ändert nichts und
 * wirft nicht (alle Statements sind `IF NOT EXISTS` / `IF EXISTS`).
 */
export async function applyVideoMigration(
  sql: VideoSqlLike,
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<{ statements: number; tables: Record<string, boolean> }> {
  assertDemoDatabase(databaseUrl);
  const { statements, issues } = splitSqlStatements(videoSchemaSQL);
  if (statements.length === 0) {
    throw new VideoMigrationGuardError('Schema-Split ergab 0 Statements — Abbruch (fail-closed)');
  }
  if (issues.length > 0) {
    throw new VideoMigrationGuardError(
      `Schema-Split meldet Probleme: ${issues.map((i) => `${i.kind}@${i.line}`).join(', ')}`,
    );
  }
  if (sql.transaction) {
    // Wie `init.ts`: EINE Transaktion, Statements als Tagged Templates.
    await sql.transaction(statements.map((stmt) => sql`${sql.unsafe(stmt)}`));
  } else {
    for (const stmt of statements) await runRaw(sql, stmt);
  }
  return { statements: statements.length, tables: await videoSchemaStatus(sql) };
}

/** Nimmt das Video-Schema zurück (nur die drei neuen Tabellen). */
export async function rollbackVideoMigration(
  sql: VideoSqlLike,
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<{ statements: number; tables: Record<string, boolean> }> {
  assertDemoDatabase(databaseUrl);
  const { statements } = splitSqlStatements(videoRollbackSQL);
  if (sql.transaction) {
    // Wie `init.ts`: EINE Transaktion, Statements als Tagged Templates.
    await sql.transaction(statements.map((stmt) => sql`${sql.unsafe(stmt)}`));
  } else {
    for (const stmt of statements) await runRaw(sql, stmt);
  }
  return { statements: statements.length, tables: await videoSchemaStatus(sql) };
}
