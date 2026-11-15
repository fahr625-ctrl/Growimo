// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Kampagne: Speichern / Wiederöffnen (ServerFn + Repo)
// ─────────────────────────────────────────────────────────────────────────────
// Reihenfolge (Dauerregel „erst speichern, dann buchen" ist hier trivial, weil
// Speichern NICHTS kostet — es wird keine Einheit gebucht und keine KI gerufen):
//   1. Session aus dem Cookie (fail-closed, keine Identität ⇒ kein Schreibvorgang)
//   2. Eingabe prüfen (validateCampaignDraft)
//   3. Foto serverseitig auf Pin-Maß verkleinern (sharp, kein KI-Bild)
//   4. Schreiben, danach LESEND zurückgeben — der Client zeigt nur, was
//      nachweislich in der DB steht.
//
// Identität: `users.id` (UUID) ist der Fremdschlüssel — NICHT die Clerk-ID
// (gleiche Falle wie bei generated_images).
// ─────────────────────────────────────────────────────────────────────────────

import { createServerFn } from '@tanstack/react-start';
import {
  CAMPAIGN_LIMITS,
  deriveCampaignName,
  isCampaignOption,
  parseImageDataUrl,
  validateCampaignDraft,
  type CampaignDraft,
  type CampaignOption,
} from './campaign';
import { loadSharp } from './sharp-loader';

/** SQL-Executor (Neon-Tag). Injizierbar, damit Tests keinen Prod-Schreibzugriff brauchen. */
export type CampaignSqlTag = (
  strings: TemplateStringsArray,
  ...params: unknown[]
) => Promise<Record<string, unknown>[]>;

export interface CampaignSummary {
  id: string;
  name: string;
  option: CampaignOption;
  product: string;
  updatedAt: string;
  hasPhoto: boolean;
  brandApplied: boolean;
}

export interface CampaignRecord extends CampaignSummary {
  audience: string;
  message: string;
  targetUrl: string;
  /** Originalfoto als Data-URL (null bei „Nur Etsy"). */
  photoDataUrl: string | null;
  createdAt: string;
}

export class CampaignError extends Error {
  code: 'unauthorized' | 'invalid_input' | 'photo_unprocessable' | 'not_found' | 'db';
  errors?: string[];
  constructor(code: CampaignError['code'], message: string, errors?: string[]) {
    super(message);
    this.name = 'CampaignError';
    this.code = code;
    this.errors = errors;
  }
}

interface PreparedPhoto {
  mime: string;
  base64: string;
  width: number;
  height: number;
}

/**
 * Verkleinert das hochgeladene Originalfoto auf höchstens 1000 × 1500 px
 * (JPEG). Fail-closed: unlesbare Bilder werden abgewiesen statt gespeichert.
 */
export async function prepareCampaignPhoto(dataUrl: string): Promise<PreparedPhoto> {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) throw new CampaignError('invalid_input', 'Foto ist kein lesbares Bild.', ['photo_invalid']);
  if (parsed.bytes > CAMPAIGN_LIMITS.photoMaxBytes) {
    throw new CampaignError('invalid_input', 'Foto ist zu groß.', ['photo_too_large']);
  }
  try {
    const sharp = await loadSharp();
    const buf = await sharp(Buffer.from(parsed.base64, 'base64'))
      .rotate()
      .resize({
        width: CAMPAIGN_LIMITS.photoMaxWidth,
        height: CAMPAIGN_LIMITS.photoMaxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer();
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) {
      throw new Error('Bild ohne Maße');
    }
    return { mime: 'image/jpeg', base64: buf.toString('base64'), width: meta.width, height: meta.height };
  } catch (err) {
    throw new CampaignError(
      'photo_unprocessable',
      `Foto konnte nicht verarbeitet werden: ${(err as Error).message}`,
      ['photo_unprocessable'],
    );
  }
}

function toSummary(row: Record<string, unknown>): CampaignSummary {
  return {
    id: String(row.id),
    name: row.name == null ? '' : String(row.name),
    option: (isCampaignOption(row.option) ? row.option : 'pinterest') as CampaignOption,
    product: row.product == null ? '' : String(row.product),
    updatedAt: row.updated_at == null ? new Date(0).toISOString() : String(row.updated_at),
    hasPhoto: row.photo_data != null && String(row.photo_data).length > 0,
    brandApplied: row.brand_applied === true,
  };
}

function toRecord(row: Record<string, unknown>): CampaignRecord {
  const photo = row.photo_data == null ? '' : String(row.photo_data);
  const mime = row.photo_mime == null ? 'image/jpeg' : String(row.photo_mime);
  return {
    ...toSummary(row),
    audience: row.audience == null ? '' : String(row.audience),
    message: row.message == null ? '' : String(row.message),
    targetUrl: row.target_url == null ? '' : String(row.target_url),
    photoDataUrl: photo ? `data:${mime};base64,${photo}` : null,
    createdAt: row.created_at == null ? new Date(0).toISOString() : String(row.created_at),
  };
}

// ── Repo (DB-Zugriffe, ohne Session-Logik) ───────────────────────────────────

export async function insertCampaign(
  userId: string,
  draft: CampaignDraft,
  photo: PreparedPhoto | null,
  sql: CampaignSqlTag,
): Promise<string> {
  const rows = await sql`
    INSERT INTO campaigns
      (user_id, name, option, product, audience, message, target_url,
       photo_mime, photo_data, photo_width, photo_height, brand_applied, pins, etsy)
    VALUES
      (${userId}, ${deriveCampaignName(draft)}, ${draft.option}, ${draft.product.trim()},
       ${(draft.audience ?? '').trim() || null}, ${(draft.message ?? '').trim() || null},
       ${(draft.targetUrl ?? '').trim() || null},
       ${photo ? photo.mime : null}, ${photo ? photo.base64 : null},
       ${photo ? photo.width : null}, ${photo ? photo.height : null},
       ${draft.brandApplied === true}, ${JSON.stringify([])}::jsonb, ${null}::jsonb)
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (id == null) throw new CampaignError('db', 'Kampagne wurde nicht gespeichert.');
  return String(id);
}

export async function updateCampaign(
  userId: string,
  id: string,
  draft: CampaignDraft,
  photo: PreparedPhoto | null,
  sql: CampaignSqlTag,
): Promise<boolean> {
  const rows = await sql`
    UPDATE campaigns SET
      name = ${deriveCampaignName(draft)},
      option = ${draft.option},
      product = ${draft.product.trim()},
      audience = ${(draft.audience ?? '').trim() || null},
      message = ${(draft.message ?? '').trim() || null},
      target_url = ${(draft.targetUrl ?? '').trim() || null},
      photo_mime = COALESCE(${photo ? photo.mime : null}, photo_mime),
      photo_data = COALESCE(${photo ? photo.base64 : null}, photo_data),
      photo_width = COALESCE(${photo ? photo.width : null}, photo_width),
      photo_height = COALESCE(${photo ? photo.height : null}, photo_height),
      brand_applied = ${draft.brandApplied === true},
      updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function listCampaigns(
  userId: string,
  sql: CampaignSqlTag,
): Promise<CampaignSummary[]> {
  const rows = await sql`
    SELECT id, name, option, product, updated_at, photo_data, brand_applied
    FROM campaigns
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
    LIMIT 50
  `;
  return rows.map(toSummary);
}

export async function readCampaign(
  userId: string,
  id: string,
  sql: CampaignSqlTag,
): Promise<CampaignRecord | null> {
  const rows = await sql`
    SELECT id, name, option, product, audience, message, target_url,
           photo_mime, photo_data, brand_applied, created_at, updated_at
    FROM campaigns
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  `;
  return rows.length > 0 ? toRecord(rows[0]) : null;
}

// ── ServerFn-Hüllen (Session → users.id) ─────────────────────────────────────

async function resolveCampaignUserId(): Promise<string> {
  const { requireUserIdFromServerFn } = await import('~/lib/usage-guard');
  const clerkId = await requireUserIdFromServerFn();
  const { ensureUserRow } = await import('~/db/queries');
  return await ensureUserRow(clerkId);
}

async function defaultSql(): Promise<CampaignSqlTag> {
  const { getDb } = await import('~/db/index');
  return getDb() as unknown as CampaignSqlTag;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kampagne anlegen oder aktualisieren. Gibt den LESEND geprüften Stand zurück. */
export const saveCampaignServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input as CampaignDraft)
  .handler(async ({ data }): Promise<CampaignRecord> => {
    const check = validateCampaignDraft(data);
    if (!check.ok) throw new CampaignError('invalid_input', 'Eingabe unvollständig.', check.errors);

    const userId = await resolveCampaignUserId();
    const sql = await defaultSql();
    const photo = data.photoDataUrl ? await prepareCampaignPhoto(data.photoDataUrl) : null;

    let id: string;
    if (data.id && UUID_RE.test(data.id)) {
      const updated = await updateCampaign(userId, data.id, data, photo, sql);
      if (!updated) throw new CampaignError('not_found', 'Kampagne nicht gefunden.');
      id = data.id;
    } else {
      id = await insertCampaign(userId, data, photo, sql);
    }

    // Leseprüfung: der Client bekommt nur, was wirklich in der DB steht.
    const saved = await readCampaign(userId, id, sql);
    if (!saved) throw new CampaignError('db', 'Kampagne nicht lesbar nach dem Speichern.');
    return saved;
  });

/** Gespeicherte Kampagnen (neueste zuerst). */
export const listCampaignsServer = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CampaignSummary[]> => {
    const userId = await resolveCampaignUserId();
    const sql = await defaultSql();
    return listCampaigns(userId, sql);
  },
);

/** Eine Kampagne vollständig wieder öffnen (inkl. Foto). */
export const getCampaignServer = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const id = (input as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new CampaignError('invalid_input', 'Ungültige Kampagnen-ID.');
    }
    return { id };
  })
  .handler(async ({ data }): Promise<CampaignRecord | null> => {
    const userId = await resolveCampaignUserId();
    const sql = await defaultSql();
    return readCampaign(userId, data.id, sql);
  });
