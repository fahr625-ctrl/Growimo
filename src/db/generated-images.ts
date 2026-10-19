// ─────────────────────────────────────────────────────────────────────────────
// K4-B — DB-Zugriffe für `generated_images` (nur SQL, keine Entscheidungen)
// ─────────────────────────────────────────────────────────────────────────────
// Bewusst getrennt von der Logik (src/lib/generated-images-logic.ts) und von der
// Orchestrierung (src/lib/generated-images-service.ts):
//
//  * Jede Funktion führt GENAU EIN Statement aus. Damit ist jede Markierung
//    automatisch „eine Transaktion" (Design-Freeze §3.0) und der Executor kann
//    für Tests gegen eine LOKALE Postgres-Kopie ausgetauscht werden (psql-Muster
//    aus db-bereinigung-2026-10-18/wiederherstellungstest) — dieselben SQL-Texte,
//    kein zweites SQL.
//  * `user_id` ist `users.id` (UUID), NICHT die Clerk-ID (dokumentierte Falle).
//  * Kein `list()` im Hot Path: der Sweep liest Pfade aus der DB (spart Advanced
//    Operations im Hobby-Kontingent, HOBBY-PRUEFUNG §3).
//  * Kein `SELECT *`: die Blob-URL verlässt die Serverseite nie.

/** Ausführbarer SQL-Executor (Default: Neon-HTTP-Treiber aus src/db/index.ts). */
export type ImageSql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

export interface GeneratedImageRow {
  id: string;
  user_id: string;
  project_id: string | null;
  blob_path: string;
  blob_url: string | null;
  aspect_ratio: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  prompt: string | null;
  created_at: string | Date;
  expires_at: string | Date;
  deleted_at: string | Date | null;
  delete_reason: string | null;
}

export interface LiveImageRow {
  id: string;
  aspectRatio: string | null;
  sizeBytes: number | null;
  prompt: string | null;
  projectId: string | null;
  createdAt: string | Date;
  expiresAt: string | Date;
}

/** Zeilen-Adapter: Neon liefert Strings für BIGINT — hier einmal zentral. */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toLiveImageRow(row: Record<string, unknown>): LiveImageRow {
  return {
    id: String(row.id),
    aspectRatio: row.aspect_ratio == null ? null : String(row.aspect_ratio),
    sizeBytes: num(row.size_bytes),
    prompt: row.prompt == null ? null : String(row.prompt),
    projectId: row.project_id == null ? null : String(row.project_id),
    createdAt: row.created_at as string | Date,
    expiresAt: row.expires_at as string | Date,
  };
}

// ── Lesen ────────────────────────────────────────────────────────────────────

/** Lebende Bilder eines Nutzers, neueste zuerst (Galerie-Liste, keine Pixel). */
export async function qListLiveImages(
  sql: ImageSql,
  userId: string,
  limit: number,
): Promise<LiveImageRow[]> {
  const rows = await sql`
    SELECT id, aspect_ratio, size_bytes, prompt, project_id, created_at, expires_at
    FROM generated_images
    WHERE user_id = ${userId}::uuid
      AND deleted_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}::int
  `;
  return rows.map(toLiveImageRow);
}

/** Anzahl lebender Bilder (Cap-Anzeige). */
export async function qCountLiveImages(sql: ImageSql, userId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS c
    FROM generated_images
    WHERE user_id = ${userId}::uuid AND deleted_at IS NULL
  `;
  return num(rows[0]?.c) ?? 0;
}

/** Summe der lebenden Bytes (Basis des globalen Guards). */
export async function qSumLiveBytes(sql: ImageSql): Promise<number> {
  const rows = await sql`
    SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total
    FROM generated_images
    WHERE deleted_at IS NULL
  `;
  return num(rows[0]?.total) ?? 0;
}

/** Fenster-Kandidaten aufsteigend (created_at ASC, id ASC) — deterministisch. */
export async function qWindowCandidates(
  sql: ImageSql,
  userId: string,
): Promise<Array<{ id: string; createdAt: string | Date; blobPath: string }>> {
  const rows = await sql`
    SELECT id, created_at, blob_path
    FROM generated_images
    WHERE user_id = ${userId}::uuid AND deleted_at IS NULL
    ORDER BY created_at ASC, id ASC
  `;
  return rows.map((r) => ({
    id: String(r.id),
    createdAt: r.created_at as string | Date,
    blobPath: String(r.blob_path),
  }));
}

/** Eine Zeile per ID — OHNE Nutzerfilter (für 403- vs. 404-Unterscheidung). */
export async function qGetImageById(
  sql: ImageSql,
  imageId: string,
): Promise<GeneratedImageRow | null> {
  const rows = await sql`
    SELECT id, user_id, project_id, blob_path, blob_url, aspect_ratio, mime_type,
           size_bytes, prompt, created_at, expires_at, deleted_at, delete_reason
    FROM generated_images
    WHERE id = ${imageId}::uuid
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return rows[0] as unknown as GeneratedImageRow;
}

/** Markierte Zeilen, deren Blob-Delete noch aussteht (Wiederanlauf-Sweeper). */
export async function qPendingDeletionRows(
  sql: ImageSql,
  limit: number,
): Promise<Array<{ id: string; blobPath: string }>> {
  const rows = await sql`
    SELECT id, blob_path
    FROM generated_images
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at ASC, id ASC
    LIMIT ${limit}::int
  `;
  return rows.map((r) => ({ id: String(r.id), blobPath: String(r.blob_path) }));
}

// ── Schreiben ────────────────────────────────────────────────────────────────

export interface InsertImageArgs {
  userId: string;
  projectId: string | null;
  blobPath: string;
  blobUrl: string | null;
  aspectRatio: string | null;
  mimeType: string | null;
  sizeBytes: number;
  prompt: string | null;
  expiresAt: Date;
  /** Guard-Deckel in Bytes; `<= 0` schaltet die Prüfung ab (Guard AUS). */
  capBytes: number;
}

/**
 * INSERT mit Guard-NACHPRÜFUNG IN DERSELBEN ANWEISUNG (Race-Schutz, Design-
 * Freeze §3c). Ein Statement = eine Transaktion. Drei Ausgänge:
 *   • Zeile zurück     → gespeichert
 *   • 0 Zeilen + Pfad existiert schon → Duplikat (Idempotenz)
 *   • 0 Zeilen + Pfad neu             → Guard hat abgelehnt (Aufrufer löscht den
 *                                       soeben hochgeladenen Blob gezielt)
 */
export async function qInsertImage(
  sql: ImageSql,
  args: InsertImageArgs,
): Promise<{ id: string } | null> {
  const rows = await sql`
    INSERT INTO generated_images
      (user_id, project_id, blob_path, blob_url, aspect_ratio, mime_type, size_bytes, prompt, expires_at)
    SELECT ${args.userId}::uuid,
           ${args.projectId}::uuid,
           ${args.blobPath}::text,
           ${args.blobUrl}::text,
           ${args.aspectRatio}::text,
           ${args.mimeType}::text,
           ${args.sizeBytes}::bigint,
           ${args.prompt}::text,
           ${args.expiresAt.toISOString()}::timestamptz
    WHERE ${args.capBytes}::bigint <= 0
       OR (SELECT COALESCE(SUM(size_bytes), 0) FROM generated_images WHERE deleted_at IS NULL)
          + ${args.sizeBytes}::bigint <= ${args.capBytes}::bigint
    ON CONFLICT (blob_path) DO NOTHING
    RETURNING id
  `;
  return rows[0] ? { id: String(rows[0].id) } : null;
}

export async function qExistsBlobPath(sql: ImageSql, blobPath: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 AS ok FROM generated_images WHERE blob_path = ${blobPath}::text LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Überhang des Sliding Window markieren — EIN Statement, deterministisch.
 *
 * Δ gegenüber DESIGN-FREEZE §3a (BEFUND aus der Integrations-Suite, korrigiert):
 * Die Design-Vorlage formulierte `ORDER BY created_at ASC, id ASC OFFSET 200`.
 * Das ist die FALSCHE Richtung: die ersten 200 aufsteigend sind die ÄLTESTEN —
 * `OFFSET 200` liefert damit alles AUSSER den ältesten 200, also die NEUESTEN.
 * Ein Testlauf hat genau das bewiesen (das frisch gespeicherte Bild wurde sofort
 * wieder markiert und gelöscht, das älteste blieb stehen). Richtig ist die
 * Fensterung von der NEUESTEN Seite: `ORDER BY created_at DESC, id DESC
 * OFFSET 200` = die neuesten 200 behalten, alles Ältere markieren. Damit gilt
 * genau die Semantik der reinen Funktion `selectOverflow()` (ältestes zuerst).
 */
export async function qMarkWindowOverflow(
  sql: ImageSql,
  userId: string,
  maxPerUser: number,
): Promise<Array<{ id: string; blobPath: string }>> {
  const rows = await sql`
    UPDATE generated_images
    SET deleted_at = NOW(), delete_reason = 'cap_200'
    WHERE id IN (
      SELECT id FROM generated_images
      WHERE user_id = ${userId}::uuid AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
      OFFSET ${maxPerUser}::int
    )
    AND deleted_at IS NULL
    RETURNING id, blob_path
  `;
  return rows.map((r) => ({ id: String(r.id), blobPath: String(r.blob_path) }));
}

/** Abgelaufene Bilder markieren (täglicher Cron + Lazy-Pfad). */
export async function qMarkExpired(
  sql: ImageSql,
  limit: number,
): Promise<Array<{ id: string; blobPath: string }>> {
  const rows = await sql`
    UPDATE generated_images
    SET deleted_at = NOW(), delete_reason = 'ttl_90d'
    WHERE id IN (
      SELECT id FROM generated_images
      WHERE expires_at <= NOW() AND deleted_at IS NULL
      ORDER BY expires_at ASC, id ASC
      LIMIT ${limit}::int
    )
    RETURNING id, blob_path
  `;
  return rows.map((r) => ({ id: String(r.id), blobPath: String(r.blob_path) }));
}

/** EIN Bild markieren (manuelles Löschen bzw. Lazy-Ablauf). Nur eigener Nutzer. */
export async function qMarkImage(
  sql: ImageSql,
  args: { imageId: string; userId: string; reason: string },
): Promise<Array<{ id: string; blobPath: string }>> {
  const rows = await sql`
    UPDATE generated_images
    SET deleted_at = NOW(), delete_reason = ${args.reason}::text
    WHERE id = ${args.imageId}::uuid
      AND user_id = ${args.userId}::uuid
      AND deleted_at IS NULL
    RETURNING id, blob_path
  `;
  return rows.map((r) => ({ id: String(r.id), blobPath: String(r.blob_path) }));
}

/** Alle Bilder eines Nutzers markieren (Kontolöschung, Schritt 1). */
export async function qMarkAllUserImages(
  sql: ImageSql,
  userId: string,
): Promise<Array<{ id: string; blobPath: string }>> {
  const rows = await sql`
    UPDATE generated_images
    SET deleted_at = NOW(), delete_reason = 'account_deleted'
    WHERE user_id = ${userId}::uuid AND deleted_at IS NULL
    RETURNING id, blob_path
  `;
  return rows.map((r) => ({ id: String(r.id), blobPath: String(r.blob_path) }));
}

/**
 * Bestätigte Zeile hart löschen (Schritt 3). Bedingung `deleted_at IS NOT NULL`
 * macht den Aufruf idempotent und verhindert, dass ein lebendes Bild je über
 * diesen Pfad verschwindet.
 */
export async function qDeleteMarkedRow(sql: ImageSql, imageId: string): Promise<number> {
  const rows = await sql`
    DELETE FROM generated_images
    WHERE id = ${imageId}::uuid AND deleted_at IS NOT NULL
    RETURNING id
  `;
  return rows.length;
}

/** Diagnose: lebend/markiert/gesamt + Bytes (Testprotokoll, read-only). */
export async function qImageStats(sql: ImageSql): Promise<{
  live: number;
  marked: number;
  total: number;
  liveBytes: number;
}> {
  const rows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS live,
      COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS marked,
      COUNT(*)::int AS total,
      COALESCE(SUM(size_bytes) FILTER (WHERE deleted_at IS NULL), 0)::bigint AS live_bytes
    FROM generated_images
  `;
  const row = rows[0] ?? {};
  return {
    live: num(row.live) ?? 0,
    marked: num(row.marked) ?? 0,
    total: num(row.total) ?? 0,
    liveBytes: num(row.live_bytes) ?? 0,
  };
}
