// ── Server-only SQL layer for projects & generated content ────────────────────
// This module must ONLY be imported from `createServerFn()` handlers or API
// routes — never from client code. It reads `process.env.DATABASE_URL`, which
// only exists on the server.
//
// All returned `created_at` values are coerced to ISO strings (the TanStack
// Start serializer does not round-trip Date objects reliably; the client-facing
// store layer converts them back to `Date`).
import { getDb } from "./index";
import type { ContentType } from "~/ai/types";

// ── Row shapes (already JSON-safe) ────────────────────────────────────────────

export interface RawContent {
  id: string;
  projectId: string;
  contentType: ContentType;
  title: string;
  body: string;
  createdAt: string; // ISO string
  metadata?: Record<string, unknown>;
}

export interface RawProject {
  id: string;
  userId: string;
  title: string;
  productIdea: string;
  contentTypes: ContentType[];
  status: string;
  createdAt: string; // ISO string
  favorite: boolean;
  versions: RawContent[][];
  /** Optional project-level metadata (F6 Strategie-Brief unter metadata.brief). */
  metadata?: Record<string, unknown>;
}

export interface RawStats {
  projectCount: number;
  contentCount: number;
  distinctTypes: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse a possibly-stringified JSONB value. */
function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function isoString(value: unknown): string {
  if (value == null) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

/**
 * Resolve a clerk_id (or the "anonymous" fallback) to the users table UUID.
 * Creates the user row on first use so the app works even before the app-shell
 * `ensureUser` effect has run.
 */
export async function ensureUserRow(
  clerkId: string,
  email?: string,
  name?: string,
): Promise<string> {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO users (clerk_id, email, name)
    VALUES (
      ${clerkId},
      ${email && email.trim() ? email.trim() : `anon-${clerkId}@growimo.local`},
      ${name && name.trim() ? name.trim() : null}
    )
    ON CONFLICT (clerk_id) DO UPDATE
      SET email = EXCLUDED.email,
          name = EXCLUDED.name,
          updated_at = NOW()
    RETURNING id
  `;
  return String(rows[0].id);
}

/** Returns the users UUID for a clerk_id, or null if the user has no row yet. */
async function resolveUserId(clerkId: string): Promise<string | null> {
  const sql = getDb();
  const rows = await sql`SELECT id FROM users WHERE clerk_id = ${clerkId} LIMIT 1`;
  return rows.length > 0 ? String(rows[0].id) : null;
}

// ── Mapping ───────────────────────────────────────────────────────────────────

export function mapContentRow(row: Record<string, unknown>): RawContent {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    contentType: row.content_type as ContentType,
    title: row.title == null ? "" : String(row.title),
    body: row.body == null ? "" : String(row.body),
    createdAt: isoString(row.created_at),
    metadata: parseJson<Record<string, unknown> | undefined>(row.metadata, undefined),
  };
}

export function mapProjectRow(row: Record<string, unknown>): RawProject {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    productIdea: row.product_idea == null ? "" : String(row.product_idea),
    contentTypes: parseJson<ContentType[]>(row.content_types, []),
    status: row.status == null ? "completed" : String(row.status),
    createdAt: isoString(row.created_at),
    favorite: Boolean(row.favorite),
    versions: (parseJson<RawContent[][]>(row.versions, []) ?? []).map((version) =>
      (version ?? []).map((c) => ({
        ...c,
        createdAt: isoString(c?.createdAt),
      })),
    ),
    metadata: parseJson<Record<string, unknown> | undefined>(row.metadata, undefined),
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function qEnsureUser(
  clerkId: string,
  email?: string,
  name?: string,
): Promise<string> {
  return ensureUserRow(clerkId, email, name);
}

export async function qSaveProject(
  userId: string,
  project: {
    title: string;
    productIdea: string;
    contentTypes: ContentType[];
    status: string;
    /** Optional project-level metadata (F6: metadata.brief). */
    metadata?: Record<string, unknown>;
  },
  contents: {
    contentType: ContentType;
    title: string;
    body: string;
    metadata?: Record<string, unknown>;
  }[],
): Promise<{ project: RawProject; contents: RawContent[] }> {
  const sql = getDb();
  const uid = await ensureUserRow(userId);

  // versions history starts with the initial content snapshot (mirrors the
  // previous in-memory behaviour: versions[0] === first saved contents).
  const versionsSnapshot = contents.map((c) => ({
    contentType: c.contentType,
    title: c.title,
    body: c.body,
    metadata: c.metadata ?? {},
  }));

  const projectRows = await sql`
    INSERT INTO projects (user_id, title, product_idea, content_types, status, favorite, versions, metadata)
    VALUES (
      ${uid},
      ${project.title},
      ${project.productIdea},
      ${JSON.stringify(project.contentTypes)},
      ${project.status},
      false,
      ${JSON.stringify([versionsSnapshot])},
      ${JSON.stringify(project.metadata ?? {})}
    )
    RETURNING *
  `;
  const projectRow = projectRows[0];

  const savedContents: RawContent[] = [];
  for (const c of contents) {
    const contentRows = await sql`
      INSERT INTO generated_content (project_id, user_id, content_type, title, body, metadata)
      VALUES (
        ${projectRow.id},
        ${uid},
        ${c.contentType},
        ${c.title},
        ${c.body},
        ${JSON.stringify(c.metadata ?? {})}
      )
      RETURNING *
    `;
    savedContents.push(mapContentRow(contentRows[0]));
  }

  const rawProject = mapProjectRow(projectRow);
  return { project: rawProject, contents: savedContents };
}

export async function qGetProjectsByUser(userId: string): Promise<RawProject[]> {
  const uid = await resolveUserId(userId);
  if (!uid) return [];
  const sql = getDb();
  const rows = await sql`
    SELECT p.*, u.clerk_id AS user_clerk_id
    FROM projects p
    JOIN users u ON p.user_id = u.id
    WHERE u.id = ${uid}
    ORDER BY p.created_at DESC
  `;
  return rows.map((r) => {
    const mapped = mapProjectRow(r);
    mapped.userId = String(r.user_clerk_id ?? userId);
    return mapped;
  });
}

export async function qGetProject(projectId: string): Promise<RawProject | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT p.*, u.clerk_id AS user_clerk_id
    FROM projects p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = ${projectId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const mapped = mapProjectRow(rows[0]);
  mapped.userId = String(rows[0].user_clerk_id);
  return mapped;
}

export async function qGetProjectContent(projectId: string): Promise<RawContent[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM generated_content
    WHERE project_id = ${projectId}
    ORDER BY created_at ASC
  `;
  return rows.map(mapContentRow);
}

export async function qGetAllContentByUser(
  userId: string,
): Promise<(RawContent & { projectTitle: string })[]> {
  const uid = await resolveUserId(userId);
  if (!uid) return [];
  const sql = getDb();
  const rows = await sql`
    SELECT gc.*, p.title AS project_title
    FROM generated_content gc
    JOIN projects p ON gc.project_id = p.id
    WHERE gc.user_id = ${uid}
    ORDER BY gc.created_at DESC
  `;
  return rows.map((r) => ({ ...mapContentRow(r), projectTitle: String(r.project_title ?? "") }));
}

export async function qGetRecentProjects(
  userId: string,
  limit: number,
): Promise<RawProject[]> {
  const uid = await resolveUserId(userId);
  if (!uid) return [];
  const sql = getDb();
  const rows = await sql`
    SELECT p.*, u.clerk_id AS user_clerk_id
    FROM projects p
    JOIN users u ON p.user_id = u.id
    WHERE u.id = ${uid}
    ORDER BY p.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => {
    const mapped = mapProjectRow(r);
    mapped.userId = String(r.user_clerk_id ?? userId);
    return mapped;
  });
}

export async function qGetStats(userId: string): Promise<RawStats> {
  const uid = await resolveUserId(userId);
  if (!uid) {
    return { projectCount: 0, contentCount: 0, distinctTypes: 0 };
  }
  const sql = getDb();
  const [projectCountRows, contentCountRows, typeRows] = await Promise.all([
    sql`SELECT COUNT(*) AS n FROM projects WHERE user_id = ${uid}`,
    sql`SELECT COUNT(*) AS n FROM generated_content WHERE user_id = ${uid}`,
    sql`SELECT DISTINCT content_type FROM generated_content WHERE user_id = ${uid}`,
  ]);
  return {
    projectCount: Number(projectCountRows[0]?.n ?? 0),
    contentCount: Number(contentCountRows[0]?.n ?? 0),
    distinctTypes: typeRows.length,
  };
}

export async function qToggleFavorite(projectId: string): Promise<RawProject | null> {
  const sql = getDb();
  const rows = await sql`
    UPDATE projects SET favorite = NOT favorite, updated_at = NOW()
    WHERE id = ${projectId}
    RETURNING *
  `;
  if (rows.length === 0) return null;
  return mapProjectRow(rows[0]);
}

export async function qGetFavoriteProjects(userId: string): Promise<RawProject[]> {
  const uid = await resolveUserId(userId);
  if (!uid) return [];
  const sql = getDb();
  const rows = await sql`
    SELECT p.*, u.clerk_id AS user_clerk_id
    FROM projects p
    JOIN users u ON p.user_id = u.id
    WHERE u.id = ${uid} AND p.favorite = true
    ORDER BY p.created_at DESC
  `;
  return rows.map((r) => {
    const mapped = mapProjectRow(r);
    mapped.userId = String(r.user_clerk_id ?? userId);
    return mapped;
  });
}

export async function qDuplicateProject(
  projectId: string,
  userId: string,
): Promise<RawProject | null> {
  const sql = getDb();
  const uid = await ensureUserRow(userId);
  const existingRows = await sql`
    SELECT * FROM projects WHERE id = ${projectId} LIMIT 1
  `;
  if (existingRows.length === 0) return null;
  const existing = existingRows[0];

  const contentsRows = await sql`
    SELECT * FROM generated_content WHERE project_id = ${projectId}
  `;
  const contents = contentsRows.map(mapContentRow);

  // Deep-clone versions history with new ids (mirrors in-memory behaviour).
  const existingVersions = parseJson<RawContent[][]>(existing.versions, []);
  const clonedVersions = existingVersions.map((version) =>
    (version ?? []).map((c) => ({
      contentType: c.contentType,
      title: c.title,
      body: c.body,
      metadata: c.metadata ?? {},
    })),
  );

  const newProjectRows = await sql`
    INSERT INTO projects (user_id, title, product_idea, content_types, status, favorite, versions)
    VALUES (
      ${uid},
      ${String(existing.title) + " (Kopie)"},
      ${existing.product_idea},
      ${JSON.stringify(parseJson<ContentType[]>(existing.content_types, []))},
      ${existing.status ?? "completed"},
      false,
      ${JSON.stringify(clonedVersions)}
    )
    RETURNING *
  `;
  const newProjectRow = newProjectRows[0];

  for (const c of contents) {
    await sql`
      INSERT INTO generated_content (project_id, user_id, content_type, title, body, metadata)
      VALUES (
        ${newProjectRow.id},
        ${uid},
        ${c.contentType},
        ${c.title},
        ${c.body},
        ${JSON.stringify(c.metadata ?? {})}
      )
    `;
  }

  return mapProjectRow(newProjectRow);
}

export async function qUpdateChannel(
  projectId: string,
  contentType: ContentType,
  newContent: { title: string; body: string; metadata?: Record<string, unknown> },
): Promise<RawContent | null> {
  const sql = getDb();
  const projectRows = await sql`
    SELECT * FROM projects WHERE id = ${projectId} LIMIT 1
  `;
  if (projectRows.length === 0) return null;
  const projectRow = projectRows[0];

  const existing = await sql`
    SELECT * FROM generated_content
    WHERE project_id = ${projectId} AND content_type = ${contentType}
    LIMIT 1
  `;

  let row: Record<string, unknown>;
  if (existing.length > 0) {
    const updated = await sql`
      UPDATE generated_content
      SET title = ${newContent.title}, body = ${newContent.body}, metadata = ${JSON.stringify(newContent.metadata ?? {})}
      WHERE id = ${existing[0].id}
      RETURNING *
    `;
    row = updated[0];
  } else {
    const inserted = await sql`
      INSERT INTO generated_content (project_id, user_id, content_type, title, body, metadata)
      VALUES (
        ${projectId},
        ${projectRow.user_id},
        ${contentType},
        ${newContent.title},
        ${newContent.body},
        ${JSON.stringify(newContent.metadata ?? {})}
      )
      RETURNING *
    `;
    row = inserted[0];
    // Add the new channel to the project's content_types list
    const currentTypes = parseJson<ContentType[]>(projectRow.content_types, []);
    if (!currentTypes.includes(contentType)) {
      await sql`
        UPDATE projects SET content_types = ${JSON.stringify([...currentTypes, contentType])}, updated_at = NOW()
        WHERE id = ${projectId}
      `;
    }
  }
  return mapContentRow(row);
}

export async function qAddVersion(
  projectId: string,
  contents: {
    contentType: ContentType;
    title: string;
    body: string;
    metadata?: Record<string, unknown>;
  }[],
): Promise<RawProject | null> {
  const sql = getDb();
  const projectRows = await sql`
    SELECT * FROM projects WHERE id = ${projectId} LIMIT 1
  `;
  if (projectRows.length === 0) return null;
  const projectRow = projectRows[0];

  // Capture current content as an old version, then replace it.
  const currentRows = await sql`
    SELECT * FROM generated_content WHERE project_id = ${projectId}
  `;
  const currentContents = currentRows.map(mapContentRow);
  const currentVersions = parseJson<RawContent[][]>(projectRow.versions, []);
  const newVersions = [...currentVersions, currentContents];

  // Replace current content (delete + reinsert keeps ids fresh, mirrors in-memory)
  await sql`DELETE FROM generated_content WHERE project_id = ${projectId}`;
  for (const c of contents) {
    await sql`
      INSERT INTO generated_content (project_id, user_id, content_type, title, body, metadata)
      VALUES (${projectId}, ${projectRow.user_id}, ${c.contentType}, ${c.title}, ${c.body}, ${JSON.stringify(c.metadata ?? {})})
    `;
  }

  const updated = await sql`
    UPDATE projects SET versions = ${JSON.stringify(newVersions)}, updated_at = NOW()
    WHERE id = ${projectId}
    RETURNING *
  `;
  return mapProjectRow(updated[0]);
}

export async function qSetProjectVersion(
  projectId: string,
  versionIndex: number,
): Promise<RawContent[] | null> {
  const sql = getDb();
  const projectRows = await sql`
    SELECT * FROM projects WHERE id = ${projectId} LIMIT 1
  `;
  if (projectRows.length === 0) return null;
  const projectRow = projectRows[0];

  const versions = parseJson<RawContent[][]>(projectRow.versions, []);
  if (versionIndex < 0 || versionIndex >= versions.length) return null;
  const versionContents = versions[versionIndex] ?? [];

  // Replace current content with the version snapshot
  await sql`DELETE FROM generated_content WHERE project_id = ${projectId}`;
  for (const c of versionContents) {
    await sql`
      INSERT INTO generated_content (project_id, user_id, content_type, title, body, metadata)
      VALUES (${projectId}, ${projectRow.user_id}, ${c.contentType}, ${c.title}, ${c.body}, ${JSON.stringify(c.metadata ?? {})})
    `;
  }
  return versionContents;
}

export async function qDeleteProject(projectId: string): Promise<boolean> {
  const sql = getDb();
  const rows = await sql`DELETE FROM projects WHERE id = ${projectId} RETURNING id`;
  return rows.length > 0;
}

export async function qSearchProjects(
  userId: string,
  query: string,
): Promise<RawProject[]> {
  const uid = await resolveUserId(userId);
  if (!uid) return [];
  if (!query.trim()) return qGetProjectsByUser(userId);
  const sql = getDb();
  const rows = await sql`
    SELECT p.*, u.clerk_id AS user_clerk_id
    FROM projects p
    JOIN users u ON p.user_id = u.id
    WHERE u.id = ${uid} AND (p.title ILIKE ${`%${query}%`} OR p.product_idea ILIKE ${`%${query}%`})
    ORDER BY p.created_at DESC
  `;
  return rows.map((r) => {
    const mapped = mapProjectRow(r);
    mapped.userId = String(r.user_clerk_id ?? userId);
    return mapped;
  });
}

// ── F8 Veröffentlichungs-Kalender (publish_plan table) ───────────────────────
export interface PublishPlanRow {
  id: string;
  userId: string;
  projectId: string;
  assetId: string;
  channel: string;
  scheduledDate: string; // YYYY-MM-DD
  priorityScore: number;
  rank: number;
  bestTime: string | null;
  tasks: { id: string; label: string; done: boolean }[];
  title: string | null;
  rationale: string | null;
  createdAt: string;
  updatedAt: string;
}
function mapPublishPlanRow(row: Record<string, unknown>): PublishPlanRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: String(row.project_id),
    assetId: String(row.asset_id),
    channel: String(row.channel),
    scheduledDate:
      row.scheduled_date instanceof Date
        ? dateKeyFromDate(row.scheduled_date)
        : String(row.scheduled_date).slice(0, 10),
    priorityScore: Number(row.priority_score ?? 0),
    rank: Number(row.rank ?? 0),
    bestTime: row.best_time == null ? null : String(row.best_time),
    tasks: parseJson(row.tasks, []),
    title: row.title == null ? null : String(row.title),
    rationale: row.rationale == null ? null : String(row.rationale),
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  };
}
function dateKeyFromDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
/** Upsert the full plan: each item keyed by (user_id, asset_id). */
export async function qSavePublishPlan(
  userId: string,
  items: Array<{
    assetId: string;
    projectId: string;
    channel: string;
    scheduledDate: string;
    priorityScore: number;
    rank: number;
    bestTime: string;
    tasks: unknown[];
    title: string;
    rationale: string;
  }>,
): Promise<PublishPlanRow[]> {
  const uid = await resolveUserId(userId);
  if (!uid) return [];
  const sql = getDb();
  for (const item of items) {
    await sql`
      INSERT INTO publish_plan
        (user_id, project_id, asset_id, channel, scheduled_date, priority_score, rank, best_time, tasks, title, rationale)
      VALUES (
        ${uid}, ${item.projectId}, ${item.assetId}, ${item.channel},
        ${item.scheduledDate}, ${item.priorityScore}, ${item.rank}, ${item.bestTime},
        ${JSON.stringify(item.tasks)}, ${item.title}, ${item.rationale}
      )
      ON CONFLICT (user_id, asset_id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        channel = EXCLUDED.channel,
        scheduled_date = EXCLUDED.scheduled_date,
        priority_score = EXCLUDED.priority_score,
        rank = EXCLUDED.rank,
        best_time = EXCLUDED.best_time,
        tasks = EXCLUDED.tasks,
        title = EXCLUDED.title,
        rationale = EXCLUDED.rationale,
        updated_at = NOW()
    `;
  }
  return qGetPublishPlan(userId);
}
/** Read the stored plan for a user, ordered by date + priority. */
export async function qGetPublishPlan(userId: string): Promise<PublishPlanRow[]> {
  const uid = await resolveUserId(userId);
  if (!uid) return [];
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM publish_plan
    WHERE user_id = ${uid}
    ORDER BY scheduled_date ASC, priority_score DESC, rank ASC
  `;
  return rows.map(mapPublishPlanRow);
}
/** Flip one task's done state (persisted). Returns the updated row or null. */
export async function qUpdatePublishTask(
  userId: string,
  assetId: string,
  taskId: string,
  done: boolean,
): Promise<PublishPlanRow | null> {
  const uid = await resolveUserId(userId);
  if (!uid) return null;
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM publish_plan WHERE user_id = ${uid} AND asset_id = ${assetId} LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  const tasks = parseJson<{ id: string; label: string; done: boolean }[]>(row.tasks, []);
  const next = tasks.map((t) => (t.id === taskId ? { ...t, done: Boolean(done) } : t));
  const updated = await sql`
    UPDATE publish_plan
    SET tasks = ${JSON.stringify(next)}, updated_at = NOW()
    WHERE id = ${row.id}
    RETURNING *
  `;
  if (updated.length === 0) return null;
  return mapPublishPlanRow(updated[0]);
}
