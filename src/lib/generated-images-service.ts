// ─────────────────────────────────────────────────────────────────────────────
// K4-B — Orchestrierung der dauerhaften Bildspeicherung (Owner 2026-10-19)
// ─────────────────────────────────────────────────────────────────────────────
// Diese Datei verbindet die drei Bausteine zu den verbindlichen Abläufen aus
// DESIGN-FREEZE §3. Sie trifft selbst keine SQL- und keine Byte-Entscheidungen —
// sie ruft nur Logik (generated-images-logic.ts), DB (db/generated-images.ts)
// und Store (lib/blob-store.ts) in der festgelegten REIHENFOLGE auf.
//
// Kernregeln (bewusst als Code, nicht als Kommentar):
//  * Markieren ist EIN Statement (eine Transaktion), Blob-Delete ist NICHT Teil
//    einer DB-Transaktion → Mark-and-sweep in drei Schritten (§3.0).
//  * Der Guard prüft VOR dem Upload (ehrliche Meldung) UND in derselben Anweisung
//    wie das INSERT (Race). Bei Ablehnung wird GENAU der soeben hochgeladene Blob
//    wieder gelöscht — nie ein fremder.
//  * Der Guard blockiert NUR neue `put()`. Lese-/Download-Pfade und bestehende
//    Bilder werden NIE angefasst (Owner-Freigabe: Bestand bleibt herunterladbar).
//  * Kein `list()` im Hot Path.
//  * 0 Generierungen: Speichern/Lesen/Löschen/Sweep berühren `usage_monthly` nie.

import {
  capPrompt,
  computeExpiresAt,
  decodeImageDataUrl,
  guardDecision,
  isExpired,
  isGuardWarning,
  buildBlobPath,
  type ImageLimits,
} from './generated-images-logic';
import {
  qCountLiveImages,
  qDeleteMarkedRow,
  qExistsBlobPath,
  qGetImageById,
  qImageStats,
  qInsertImage,
  qMarkAllUserImages,
  qMarkExpired,
  qMarkImage,
  qMarkWindowOverflow,
  qPendingDeletionRows,
  qSumLiveBytes,
  qWindowCandidates,
  type ImageSql,
} from '../db/generated-images';
import type { BlobStore } from './blob-store';

/** Batch-Größe für Blob-Löschungen (Rate-Limit-Schonung, Design-Freeze §5 Nr. 9). */
export const BLOB_DELETE_BATCH = 50;
/** Obergrenze der TTL-Markierung pro Cron-Lauf. */
export const TTL_SWEEP_LIMIT = 2000;

export interface ImageServiceDeps {
  sql?: ImageSql;
  store?: BlobStore | null;
  limits?: ImageLimits;
  now?: () => Date;
  /** Meldet die Guard-Warnschwelle (Banner/Fehleranalyse). Absichtlich injizierbar. */
  onCapacityWarning?: (info: { liveBytes: number; capBytes: number; warnBytes: number }) => void;
}

interface ResolvedDeps {
  sql: ImageSql;
  store: BlobStore | null;
  limits: ImageLimits;
  now: () => Date;
}

async function resolveDeps(deps: ImageServiceDeps): Promise<ResolvedDeps> {
  const { getDb } = await import('../db');
  const { resolveImageLimits } = await import('./generated-images-logic');
  const { blobStoreOrNull } = await import('./blob-store');
  return {
    sql: deps.sql ?? (getDb() as unknown as ImageSql),
    store: deps.store !== undefined ? deps.store : blobStoreOrNull(process.env),
    limits: deps.limits ?? resolveImageLimits(process.env),
    now: deps.now ?? (() => new Date()),
  };
}

// ── Speichern (Bild-Erzeugungspfad) ─────────────────────────────────────────

export type SaveReason = 'saved' | 'capacity' | 'unavailable' | 'invalid' | 'duplicate' | 'error';

export interface SaveImageArgs {
  /** `users.id` (UUID) — NICHT die Clerk-ID. */
  userId: string;
  /** Original-Bild als `data:image/...;base64,...` (das Ergebnis der Generierung). */
  dataUrl: string;
  aspectRatio?: string | null;
  prompt?: string | null;
  projectId?: string | null;
  /** Für deterministische Tests / Idempotenz-Nachweis. */
  fileId?: string;
}

export interface SaveImageResult {
  saved: boolean;
  reason: SaveReason;
  /** `generated_images.id` — nur, wenn wirklich gespeichert wurde. */
  imageId?: string;
  blobPath?: string;
  sizeBytes?: number;
  expiresAt?: string;
  /** Ehrliche Zahlen für die UI (Cap/Warnung), immer gefüllt. */
  count?: number;
  countLimit?: number;
  liveBytes?: number;
  capBytes?: number;
  warning?: boolean;
}

/**
 * Speichert ein erzeugtes Original dauerhaft.
 * Reihenfolge: Bytes prüfen → Guard (VOR dem Upload) → `put()` → INSERT mit
 * Guard-Nachprüfung → bei Ablehnung/Konflikt gezieltes `del()` → Fenster
 * durchsetzen (Überhang markieren + sweepen).
 */
export async function saveGeneratedImage(
  args: SaveImageArgs,
  deps: ImageServiceDeps = {},
): Promise<SaveImageResult> {
  const d = await resolveDeps(deps);
  const limits = d.limits;

  const decoded = decodeImageDataUrl(args.dataUrl);
  if (!decoded) {
    return { saved: false, reason: 'invalid', capBytes: limits.globalBytesCap };
  }
  if (!d.store) {
    // Fail-closed: keine Blob-Authentifizierung ⇒ ehrliche Meldung, nichts gespeichert.
    return { saved: false, reason: 'unavailable', sizeBytes: decoded.bytes.byteLength, capBytes: limits.globalBytesCap };
  }

  const sizeBytes = decoded.bytes.byteLength;
  const liveBytesBefore = await qSumLiveBytes(d.sql);
  const countBefore = await qCountLiveImages(d.sql, args.userId);

  // Warnschwelle: Banner + Fehleranalyse — VOR der ersten Ablehnung eines zahlenden
  // Kunden (Design-Freeze §1). Reine Beobachtung, keine Wirkung auf die Speicherung.
  if (isGuardWarning({ capBytes: limits.globalBytesCap, warnBytes: limits.globalWarnBytes, liveBytes: liveBytesBefore })) {
    try {
      deps.onCapacityWarning?.({ liveBytes: liveBytesBefore, capBytes: limits.globalBytesCap, warnBytes: limits.globalWarnBytes });
    } catch {
      /* Warnung darf nie blockieren */
    }
  }

  // Guard VOR dem Upload (spart Kosten und gibt den Grund ehrlich zurück).
  if (guardDecision({ capBytes: limits.globalBytesCap, liveBytes: liveBytesBefore, newSizeBytes: sizeBytes }) === 'capacity') {
    return {
      saved: false,
      reason: 'capacity',
      sizeBytes,
      count: countBefore,
      countLimit: limits.maxPerUser,
      liveBytes: liveBytesBefore,
      capBytes: limits.globalBytesCap,
      warning: true,
    };
  }

  const fileId = args.fileId ?? crypto.randomUUID();
  const blobPath = buildBlobPath(args.userId, fileId);
  const expiresAt = computeExpiresAt(d.now(), limits.ttlDays);

  let putResult: { url: string } | null = null;
  try {
    putResult = await d.store.put(blobPath, decoded.bytes, decoded.mimeType);
  } catch {
    return { saved: false, reason: 'error', sizeBytes, capBytes: limits.globalBytesCap };
  }

  const inserted = await qInsertImage(d.sql, {
    userId: args.userId,
    projectId: args.projectId ?? null,
    blobPath,
    blobUrl: putResult.url ?? null,
    aspectRatio: args.aspectRatio ?? null,
    mimeType: decoded.mimeType,
    sizeBytes,
    prompt: capPrompt(args.prompt),
    expiresAt,
    capBytes: limits.globalBytesCap,
  });

  if (!inserted) {
    // Zwei mögliche Ausgänge: Duplikat (Pfad existiert) oder Guard-Ablehnung im
    // Race. In beiden Fällen wird der GERADE hochgeladene Blob gezielt entfernt —
    // fremde Bilder sind nie betroffen.
    const duplicate = await qExistsBlobPath(d.sql, blobPath);
    if (!duplicate) {
      try {
        await d.store.del([blobPath]);
      } catch {
        /* der Wiederanlauf-Sweeper hat hier nichts zu tun: es gibt keine Zeile */
      }
    }
    return {
      saved: false,
      reason: duplicate ? 'duplicate' : 'capacity',
      sizeBytes,
      count: countBefore,
      countLimit: limits.maxPerUser,
      liveBytes: await qSumLiveBytes(d.sql),
      capBytes: limits.globalBytesCap,
    };
  }

  // Sliding Window durchsetzen (Überhang markieren → Blob löschen → Zeile löschen).
  // Ein fehlgeschlagener Blob-Delete hier ist NICHT kritisch: die Markierung
  // bleibt stehen und der Wiederanlauf-Sweeper holt sie nach.
  await enforceWindow(args.userId, d);

  const liveBytesAfter = await qSumLiveBytes(d.sql);
  return {
    saved: true,
    reason: 'saved',
    imageId: inserted.id,
    blobPath,
    sizeBytes,
    expiresAt: expiresAt.toISOString(),
    count: await qCountLiveImages(d.sql, args.userId),
    countLimit: limits.maxPerUser,
    liveBytes: liveBytesAfter,
    capBytes: limits.globalBytesCap,
    warning: isGuardWarning({ capBytes: limits.globalBytesCap, warnBytes: limits.globalWarnBytes, liveBytes: liveBytesAfter }),
  };
}

// ── Sweeps ──────────────────────────────────────────────────────────────────

export interface SweepResult {
  marked: number;
  blobDeleted: number;
  blobFailed: number;
  rowsDeleted: number;
}

/**
 * Schritt 2+3 für eine Liste markierter Zeilen: Blob löschen (Batches, idempotent)
 * und NUR die bestätigten Zeilen hart löschen. Ein Fehlversuch lässt die
 * Markierung stehen — der nächste Lauf holt sie nach (Wiederanlauf).
 */
async function deleteBlobsAndRows(
  rows: Array<{ id: string; blobPath: string }>,
  d: ResolvedDeps,
): Promise<{ blobDeleted: number; blobFailed: number; rowsDeleted: number }> {
  let blobDeleted = 0;
  let blobFailed = 0;
  let rowsDeleted = 0;
  if (!d.store || rows.length === 0) return { blobDeleted, blobFailed, rowsDeleted };

  for (let i = 0; i < rows.length; i += BLOB_DELETE_BATCH) {
    const batch = rows.slice(i, i + BLOB_DELETE_BATCH);
    try {
      await d.store.del(batch.map((r) => r.blobPath));
      blobDeleted += batch.length;
      for (const row of batch) rowsDeleted += await qDeleteMarkedRow(d.sql, row.id);
    } catch {
      // Batch fehlgeschlagen: Markierungen bleiben bestehen, Zeilen bleiben stehen.
      blobFailed += batch.length;
    }
  }
  return { blobDeleted, blobFailed, rowsDeleted };
}

/** Wiederanlauf: alle noch offenen Markierungen abarbeiten (Cron-Schritt 2+3). */
export async function sweepPendingDeletions(
  deps: ImageServiceDeps = {},
  limit = 500,
): Promise<SweepResult> {
  const d = await resolveDeps(deps);
  const rows = await qPendingDeletionRows(d.sql, limit);
  const counters = await deleteBlobsAndRows(rows, d);
  return { marked: 0, ...counters };
}

/** Sliding-Window-Überhang eines Nutzers markieren und abarbeiten. */
export async function enforceWindow(
  userId: string,
  deps: ImageServiceDeps = {},
): Promise<SweepResult> {
  const d = await resolveDeps(deps);
  const marked = await qMarkWindowOverflow(d.sql, userId, d.limits.maxPerUser);
  const counters = await deleteBlobsAndRows(marked, d);
  return { marked: marked.length, ...counters };
}

/**
 * Tageslauf (Cron): abgelaufene Bilder markieren, löschen und danach IMMER den
 * Wiederanlauf fahren (auch wenn nichts abgelaufen ist — ein früherer
 * abgebrochener `del()` wird so garantiert nachgeholt).
 */
export async function runDailySweep(deps: ImageServiceDeps = {}): Promise<SweepResult & { stats: Awaited<ReturnType<typeof qImageStats>> }> {
  const d = await resolveDeps(deps);
  const expired = await qMarkExpired(d.sql, TTL_SWEEP_LIMIT);
  const expiredCounters = await deleteBlobsAndRows(expired, d);
  const retry = await sweepPendingDeletions({ ...deps, sql: d.sql, store: d.store, limits: d.limits, now: d.now });
  const stats = await qImageStats(d.sql);
  return {
    marked: expired.length,
    blobDeleted: expiredCounters.blobDeleted + retry.blobDeleted,
    blobFailed: expiredCounters.blobFailed + retry.blobFailed,
    rowsDeleted: expiredCounters.rowsDeleted + retry.rowsDeleted,
    stats,
  };
}

// ── Zugriff (Download / Lazy-Ablauf / Löschen) ───────────────────────────────

export type FetchImageOutcome =
  | { status: 401 | 403 | 404 | 410; reason?: 'capacity' | 'expired' | 'deleted' | 'forbidden' | 'missing' | 'unauthorized' }
  | { status: 200; bytes: Uint8Array; contentType: string; sizeBytes: number | null; expired: false };

/**
 * Original eines Bildes laden. Verbindliche Reihenfolge (Design-Freeze §4):
 * 401 ohne Session · 403 fremd · 404 fehlt · 410 abgelaufen/gelöscht (mit
 * LAZY-Löschung) · 200 mit echten Bytes/Content-Type.
 * Ein abgelaufenes Bild wird beim Zugriff markiert und gelöscht — der Nutzer
 * sieht nie ein kaputtes Bild, sondern eine klare Aussage.
 */
export async function fetchOwnImage(args: {
  requesterUserId: string | null;
  imageId: string;
}, deps: ImageServiceDeps = {}): Promise<FetchImageOutcome> {
  const d = await resolveDeps(deps);
  if (!args.requesterUserId) return { status: 401, reason: 'unauthorized' };

  const row = await qGetImageById(d.sql, args.imageId);
  if (!row) return { status: 404, reason: 'missing' };
  // Fremdes Bild: 403 — auch wenn es abgelaufen wäre (keine Information leaken).
  if (row.user_id !== args.requesterUserId) return { status: 403, reason: 'forbidden' };
  if (row.deleted_at) return { status: 410, reason: 'deleted' };

  if (isExpired(row.expires_at, d.now().getTime())) {
    // Lazy-Löschung: markieren → Blob löschen → Zeile löschen. Fehler hier
    // dürfen die 410-Antwort nicht verhindern (der Cron holt es nach).
    try {
      const marked = await qMarkImage(d.sql, { imageId: row.id, userId: row.user_id, reason: 'ttl_90d' });
      await deleteBlobsAndRows(marked, d);
    } catch {
      /* Wiederanlauf übernimmt */
    }
    return { status: 410, reason: 'expired' };
  }

  if (!d.store) return { status: 404, reason: 'missing' };
  try {
    const blob = await d.store.get(row.blob_path);
    if (!blob) return { status: 404, reason: 'missing' };
    return {
      status: 200,
      bytes: blob.bytes,
      contentType: blob.contentType ?? row.mime_type ?? 'application/octet-stream',
      sizeBytes: row.size_bytes,
      expired: false,
    };
  } catch {
    return { status: 404, reason: 'missing' };
  }
}

/** Nutzer löscht sein eigenes Bild (manuell). 0 Generierungen. */
export async function deleteOwnImage(args: {
  requesterUserId: string | null;
  imageId: string;
}, deps: ImageServiceDeps = {}): Promise<{ status: 401 | 403 | 404 | 410 | 200; reason?: string }> {
  const d = await resolveDeps(deps);
  if (!args.requesterUserId) return { status: 401, reason: 'unauthorized' };
  const row = await qGetImageById(d.sql, args.imageId);
  if (!row) return { status: 404, reason: 'missing' };
  if (row.user_id !== args.requesterUserId) return { status: 403, reason: 'forbidden' };
  if (row.deleted_at) return { status: 410, reason: 'deleted' };
  const marked = await qMarkImage(d.sql, { imageId: row.id, userId: row.user_id, reason: 'manual' });
  await deleteBlobsAndRows(marked, d);
  return { status: 200 };
}

/**
 * Kontolöschung (Art. 17, Owner-Entscheidung d) — verbindliche Reihenfolge:
 * 1) alle Bilder markieren (`account_deleted`) 2) Blobs in Batches löschen
 * (Wiederanlauf-fähig) 3) Bildzeilen löschen 4) ERST DANACH die `users`-Zeile
 * (CASCADE räumt den Rest) 5) optionaler Orphan-Check (einmalig, manuell).
 * Die Funktion hier macht die Schritte 1–3 und liefert die Zähler für das
 * Protokoll (nur Zahlen, keine Inhalte).
 */
export async function deleteAccountImages(args: {
  userId: string;
  /** Schritt 4: wird NUR aufgerufen, wenn alle Bildzeilen wirklich gelöscht sind. */
  deleteUserRow?: () => Promise<void>;
}, deps: ImageServiceDeps = {}): Promise<SweepResult & { userRowDeleted: boolean }> {
  const d = await resolveDeps(deps);
  const marked = await qMarkAllUserImages(d.sql, args.userId);
  const counters = await deleteBlobsAndRows(marked, d);
  let userRowDeleted = false;
  // Fail-closed: die users-Zeile fällt nur, wenn keine markierte Zeile mehr übrig
  // ist. Sonst würde die CASCADE die Bildzeilen löschen, ohne dass der Blob
  // bestätigt gelöscht wurde (Pixel-Leiche mit DB-Verlust).
  if (args.deleteUserRow && counters.rowsDeleted === marked.length) {
    await args.deleteUserRow();
    userRowDeleted = true;
  }
  return { marked: marked.length, ...counters, userRowDeleted };
}

/**
 * Einmaliger Orphan-Check (manuell, NICHT im Hot Path — `list()` kostet
 * Advanced Operations im Hobby-Kontingent).
 */
export async function orphanCheck(
  userId: string,
  deps: ImageServiceDeps = {},
): Promise<{ orphans: string[] }> {
  const d = await resolveDeps(deps);
  if (!d.store) return { orphans: [] };
  const { blobPrefixForUser } = await import('./generated-images-logic');
  const paths = await d.store.list(blobPrefixForUser(userId));
  const known = new Set((await qWindowCandidates(d.sql, userId)).map((r) => r.blobPath));
  const pending = new Set((await qPendingDeletionRows(d.sql, 1000)).map((r) => r.blobPath));
  return { orphans: paths.filter((p) => !known.has(p) && !pending.has(p)) };
}
