// ─────────────────────────────────────────────────────────────────────────────
// K4-B — gemeinsamer Server-Bericht für die Bild-Meta-Liste
// ─────────────────────────────────────────────────────────────────────────────
// EINE Quelle für „was hat der Nutzer gespeichert" — benutzt von der Route
// GET /api/images UND (falls je nötig) von einer ServerFn. Enthält bewusst
// KEINE Pixel und KEINE private Store-URL (never leak the blob URL).
//
// Ehrliche Zahlen sind Teil der Hausregel: `count`/`limit`/`liveBytes`/`capBytes`
// kommen aus derselben Abfrage wie die Liste — die UI zeigt keine geratenen Werte.
// `warning` wird nur wahr, wenn die Warnschwelle (Default 700 MB) erreicht und der
// Deckel (Default 850 MB) noch nicht erreicht ist.

import {
  formatBytes,
  resolveImageLimits,
  isGuardWarning,
  toEpochMs,
  type ImageLimits,
} from './generated-images-logic';
import { qCountLiveImages, qListLiveImages, qSumLiveBytes, type ImageSql } from '../db/generated-images';
import { blobAuthPresent } from './blob-store';

export interface OwnImageEntry {
  id: string;
  aspectRatio: string | null;
  sizeBytes: number | null;
  sizeLabel: string;
  prompt: string | null;
  projectId: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface ImageListReport {
  count: number;
  limit: number;
  liveBytes: number;
  liveLabel: string;
  capBytes: number;
  capLabel: string;
  warnBytes: number;
  warning: boolean;
  /** Ist eine Blob-Authentifizierung konfiguriert? (Download nur dann möglich.) */
  storageConfigured: boolean;
  ttlDays: number;
  images: OwnImageEntry[];
}

export interface ImageReportDeps {
  sql?: ImageSql;
  limits?: ImageLimits;
  storageConfigured?: boolean;
  now?: () => Date;
}

function iso(value: string | Date): string {
  const ms = toEpochMs(value);
  return ms === null ? String(value) : new Date(ms).toISOString();
}

/** Meta-Bericht eines Nutzers (keine Pixel, keine URL). */
export async function listOwnImages(
  userId: string,
  limit: number,
  deps: ImageReportDeps = {},
): Promise<ImageListReport> {
  const sql = deps.sql ?? ((await import('../db')).getDb() as unknown as ImageSql);
  const limits = deps.limits ?? resolveImageLimits(process.env);
  const rows = await qListLiveImages(sql, userId, limit);
  const count = await qCountLiveImages(sql, userId);
  const liveBytes = await qSumLiveBytes(sql);
  const storageConfigured = deps.storageConfigured ?? blobAuthPresent(process.env);
  return {
    count,
    limit: limits.maxPerUser,
    liveBytes,
    liveLabel: formatBytes(liveBytes),
    capBytes: limits.globalBytesCap,
    capLabel: limits.globalBytesCap > 0 ? formatBytes(limits.globalBytesCap) : 'aus',
    warnBytes: limits.globalWarnBytes,
    warning: isGuardWarning({
      capBytes: limits.globalBytesCap,
      warnBytes: limits.globalWarnBytes,
      liveBytes,
    }),
    storageConfigured,
    ttlDays: limits.ttlDays,
    images: rows.map((row) => ({
      id: row.id,
      aspectRatio: row.aspectRatio,
      sizeBytes: row.sizeBytes,
      sizeLabel: formatBytes(row.sizeBytes ?? 0),
      prompt: row.prompt,
      projectId: row.projectId,
      createdAt: iso(row.createdAt),
      expiresAt: iso(row.expiresAt),
    })),
  };
}
