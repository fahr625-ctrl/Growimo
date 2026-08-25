import { createServerFn } from '@tanstack/react-start';
import type { ContentType } from '~/ai/types';
import { trackEvent } from '~/store/analytics';
import { track } from '~/lib/tracking-client';
import type { RawContent, RawProject } from '~/db/queries';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  userId: string;
  title: string;
  productIdea: string;
  contentTypes: ContentType[];
  status: 'completed';
  createdAt: Date;
  favorite: boolean;
  versions: StoredContent[][];
  /** Optional project-level metadata (F6: metadata.brief). */
  metadata?: Record<string, unknown>;
}

export interface StoredContent {
  id: string;
  projectId: string;
  contentType: ContentType;
  title: string;
  body: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

// ── Re-export ContentType for consumers that need it ────────────────────────────
export type { ContentType };

// ── Server function (single dispatcher, runs SQL server-side) ──────────────────
// Mirrors the `src/ai/server.ts` pattern: the handler lazy-imports the SQL layer
// so it never lands in the client bundle. `process.env.DATABASE_URL` is only
// available server-side — client code never touches the database directly.

const projectsApiServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = input as { op: string; args: unknown[] };
    if (!d || typeof d !== 'object' || typeof (d as { op?: unknown }).op !== 'string') {
      throw new Error('invalid projects API payload');
    }
    return d;
  })
  .handler(async ({ data }) => {
    const q = await import('~/db/queries');
    switch (data.op) {
      case 'ensureUser': {
        const [clerkId, email, name] = data.args as [string, string | undefined, string | undefined];
        return q.qEnsureUser(clerkId, email, name);
      }
      case 'saveProject': {
        const [userId, project, contents] = data.args as [
          string,
          Parameters<typeof q.qSaveProject>[1],
          Parameters<typeof q.qSaveProject>[2],
        ];
        return q.qSaveProject(userId, project, contents);
      }
      case 'getProjectsByUser': {
        return q.qGetProjectsByUser(data.args[0] as string);
      }
      case 'getProject': {
        return q.qGetProject(data.args[0] as string);
      }
      case 'getProjectContent': {
        return q.qGetProjectContent(data.args[0] as string);
      }
      case 'getAllContentByUser': {
        return q.qGetAllContentByUser(data.args[0] as string);
      }
      case 'getRecentProjects': {
        const [userId, limit] = data.args as [string, number];
        return q.qGetRecentProjects(userId, limit);
      }
      case 'getStats': {
        return q.qGetStats(data.args[0] as string);
      }
      case 'toggleFavorite': {
        return q.qToggleFavorite(data.args[0] as string);
      }
      case 'getFavoriteProjects': {
        return q.qGetFavoriteProjects(data.args[0] as string);
      }
      case 'duplicateProject': {
        const [projectId, userId] = data.args as [string, string];
        return q.qDuplicateProject(projectId, userId);
      }
      case 'updateChannel': {
        const [projectId, contentType, newContent] = data.args as [
          string,
          ContentType,
          { title: string; body: string; metadata?: Record<string, unknown> },
        ];
        return q.qUpdateChannel(projectId, contentType, newContent);
      }
      case 'addVersion': {
        const [projectId, contents] = data.args as [
          string,
          { contentType: ContentType; title: string; body: string; metadata?: Record<string, unknown> }[],
        ];
        return q.qAddVersion(projectId, contents);
      }
      case 'setProjectVersion': {
        const [projectId, versionIndex] = data.args as [string, number];
        return q.qSetProjectVersion(projectId, versionIndex);
      }
      case 'deleteProject': {
        return q.qDeleteProject(data.args[0] as string);
      }
      case 'searchProjects': {
        const [userId, query] = data.args as [string, string];
        return q.qSearchProjects(userId, query);
      }
      default:
        throw new Error(`unknown projects API op: ${String((data as { op?: unknown }).op)}`);
    }
  });

async function callApi<T>(op: string, args: unknown[]): Promise<T> {
  return projectsApiServer({ data: { op, args } }) as Promise<T>;
}

// ── Denormalization (server sends ISO strings; components expect Date) ────────

function toContent(raw: RawContent): StoredContent {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
  };
}

function toProject(raw: RawProject): Project {
  return {
    id: raw.id,
    userId: raw.userId,
    title: raw.title,
    productIdea: raw.productIdea,
    contentTypes: Array.isArray(raw.contentTypes) ? raw.contentTypes : [],
    status: (raw.status as Project['status']) || 'completed',
    createdAt: new Date(raw.createdAt),
    favorite: Boolean(raw.favorite),
    versions: Array.isArray(raw.versions)
      ? raw.versions.map((v) => (Array.isArray(v) ? v.map(toContent) : []))
      : [],
    metadata: raw.metadata,
  };
}

// ── Public API (all async — backed by PostgreSQL) ─────────────────────────────

/** Ensure a users row exists for this Clerk user (or the anonymous fallback). */
export function ensureUser(clerkId: string, email?: string, name?: string): Promise<string> {
  return callApi<string>('ensureUser', [clerkId, email, name]);
}

export async function saveProject(
  userId: string,
  project: Omit<Project, 'id' | 'createdAt' | 'favorite' | 'versions'>,
  contents: Omit<StoredContent, 'id' | 'projectId' | 'createdAt'>[],
): Promise<Project> {
  const raw = await callApi<{ project: RawProject; contents: RawContent[] }>('saveProject', [
    userId,
    project,
    contents,
  ]);
  // Track project save
  try { trackEvent('project_saved'); } catch { /* ignore */ }
  // Server-side beta-tracking (additive): a project was truly persisted.
  try { track('project_created', userId); } catch { /* ignore */ }
  return toProject(raw.project);
}

export function getProjectsByUser(userId: string): Promise<Project[]> {
  return callApi<RawProject[]>('getProjectsByUser', [userId]).then((rows) =>
    rows.map(toProject),
  );
}

export async function getProject(projectId: string): Promise<Project | undefined> {
  const raw = await callApi<RawProject | null>('getProject', [projectId]);
  return raw ? toProject(raw) : undefined;
}

export async function getProjectContent(projectId: string): Promise<StoredContent[]> {
  const raw = await callApi<RawContent[]>('getProjectContent', [projectId]);
  return raw.map(toContent);
}

export async function getAllContentByUser(
  userId: string,
): Promise<(StoredContent & { projectTitle: string })[]> {
  const raw = await callApi<(RawContent & { projectTitle: string })[]>(
    'getAllContentByUser',
    [userId],
  );
  return raw.map((r) => ({ ...toContent(r), projectTitle: r.projectTitle }));
}

export function getRecentProjects(userId: string, limit: number): Promise<Project[]> {
  return callApi<RawProject[]>('getRecentProjects', [userId, limit]).then((rows) =>
    rows.map(toProject),
  );
}

export async function getStats(userId: string): Promise<{
  projectCount: number;
  contentCount: number;
  distinctTypes: number;
}> {
  return callApi('getStats', [userId]);
}

// ── Favorites ──────────────────────────────────────────────────────────────────

export async function toggleFavorite(projectId: string): Promise<Project | undefined> {
  const raw = await callApi<RawProject | null>('toggleFavorite', [projectId]);
  return raw ? toProject(raw) : undefined;
}

export function getFavoriteProjects(userId: string): Promise<Project[]> {
  return callApi<RawProject[]>('getFavoriteProjects', [userId]).then((rows) =>
    rows.map(toProject),
  );
}

// ── Duplicate ──────────────────────────────────────────────────────────────────

export async function duplicateProject(
  projectId: string,
  userId: string,
): Promise<Project | undefined> {
  const raw = await callApi<RawProject | null>('duplicateProject', [projectId, userId]);
  return raw ? toProject(raw) : undefined;
}

// ── Update single channel ──────────────────────────────────────────────────────

export async function updateChannel(
  projectId: string,
  contentType: ContentType,
  newContent: Omit<StoredContent, 'id' | 'projectId' | 'createdAt' | 'contentType'>,
): Promise<StoredContent | undefined> {
  const raw = await callApi<RawContent | null>('updateChannel', [projectId, contentType, newContent]);
  return raw ? toContent(raw) : undefined;
}

// ── Versions ───────────────────────────────────────────────────────────────────

export async function addVersion(
  projectId: string,
  contents: Omit<StoredContent, 'id' | 'projectId' | 'createdAt'>[],
): Promise<Project | undefined> {
  const raw = await callApi<RawProject | null>('addVersion', [projectId, contents]);
  return raw ? toProject(raw) : undefined;
}

export async function setProjectVersion(
  projectId: string,
  versionIndex: number,
): Promise<StoredContent[] | undefined> {
  const raw = await callApi<RawContent[] | null>('setProjectVersion', [projectId, versionIndex]);
  return raw ? raw.map(toContent) : undefined;
}

// ── Delete ─────────────────────────────────────────────────────────────────────

export function deleteProject(projectId: string): Promise<boolean> {
  return callApi<boolean>('deleteProject', [projectId]);
}

// ── Search ─────────────────────────────────────────────────────────────────────

export function searchProjects(userId: string, query: string): Promise<Project[]> {
  return callApi<RawProject[]>('searchProjects', [userId, query]).then((rows) =>
    rows.map(toProject),
  );
}
