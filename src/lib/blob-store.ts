// ─────────────────────────────────────────────────────────────────────────────
// K4-B — Blob-Adapterschicht (Owner-Freigabe 2026-10-19)
// ─────────────────────────────────────────────────────────────────────────────
// Warum ein Adapter: die Speicherlogik (Guard, Sliding Window, TTL, Sweep) muss
// ohne echten Store testbar sein, und die Anwendung darf ohne Store-Konfiguration
// NICHT stillschweigend „gespeichert" melden. Deshalb genau DREI Implementierungen
// hinter EINER Schnittstelle:
//
//   1. `createVercelBlobStore()`  — echt (@vercel/blob, Access `private`), wird
//      nur benutzt, wenn eine Blob-Authentifizierung vorhanden ist.
//   2. `createMemoryBlobStore()`  — In-Memory-Fake für Tests (gleiche API).
//   3. kein Store (`blobStoreOrNull() === null`) — die Routen antworten dann
//      FAIL-CLOSED mit 503 statt eines falschen Erfolgs.
//
// Authentifizierung (Design-Freeze §5a): Vercel setzt beim Verbinden eines Stores
// `BLOB_STORE_ID` (+ `VERCEL_OIDC_TOKEN`, OIDC ist der dokumentierte Default).
// `BLOB_READ_WRITE_TOKEN` bleibt die Absicherung für Preview/lokale Läufe. Kein
// Secret steht in dieser Datei — nur die NAMEN der Variablen werden gelesen.

export interface BlobStorePutResult {
  /** Kanonische URL des gespeicherten Blobs (privat — nie an den Client geben). */
  url: string;
  contentType: string | null;
  sizeBytes: number | null;
}

export interface BlobStoreGetResult {
  bytes: Uint8Array;
  contentType: string | null;
  /** Optionaler ETag/Statuscode der Quelle (nur zur Diagnose). */
  etag?: string | null;
  statusCode: number;
}

export interface BlobStore {
  readonly kind: 'vercel-blob' | 'memory' | 'unconfigured';
  put(path: string, bytes: Uint8Array, contentType: string): Promise<BlobStorePutResult>;
  get(path: string): Promise<BlobStoreGetResult | null>;
  /** Löscht Pfade; ein bereits fehlender Pfad ist ein No-Op (idempotent). */
  del(paths: string[]): Promise<void>;
  /** Nur für den einmaligen Orphan-Check — NICHT im Hot Path (kostet Ops). */
  list(prefix: string): Promise<string[]>;
}

/** Ist überhaupt eine Blob-Authentifizierung konfiguriert? (fail-closed) */
export function blobAuthPresent(env: Record<string, string | undefined> = {}): boolean {
  const token = (env.BLOB_READ_WRITE_TOKEN ?? '').trim();
  if (token) return true;
  const storeId = (env.BLOB_STORE_ID ?? '').trim();
  const oidc = (env.VERCEL_OIDC_TOKEN ?? '').trim();
  return Boolean(storeId && oidc);
}

/** Echter Vercel-Blob-Store (privater Access). Nur mit vorhandener Auth nutzen. */
export function createVercelBlobStore(): BlobStore {
  const load = async () => {
    const mod = await import('@vercel/blob');
    return mod;
  };
  return {
    kind: 'vercel-blob',
    async put(path, bytes, contentType) {
      const { put } = await load();
      const result = await put(path, Buffer.from(bytes), {
        access: 'private',
        // Der Pfad ist bereits deterministisch (images/<userId>/<uuid>) — kein
        // Zufallssuffix, sonst wäre UNIQUE(blob_path) wirkungslos.
        addRandomSuffix: false,
        contentType,
      });
      return {
        url: result.url,
        contentType: result.contentType ?? contentType,
        sizeBytes: bytes.byteLength,
      };
    },
    async get(path) {
      const { get } = await load();
      const result = await get(path, { access: 'private' });
      if (!result || result.statusCode !== 200 || !result.stream) {
        return result && result.statusCode !== 200 ? null : null;
      }
      const reader = result.stream.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
        }
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return {
        bytes,
        contentType: result.blob?.contentType ?? null,
        etag: result.blob?.etag ?? null,
        statusCode: 200,
      };
    },
    async del(paths) {
      if (paths.length === 0) return;
      const { del } = await load();
      await del(paths);
    },
    async list(prefix) {
      const { list } = await load();
      const out: string[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await list({ prefix, cursor, limit: 1000 });
        for (const blob of page.blobs ?? []) out.push(blob.pathname);
        if (!page.hasMore || !page.cursor) break;
        cursor = page.cursor;
      }
      return out;
    },
  };
}

/**
 * In-Memory-Fake mit IDENTISCHER Schnittstelle (Tests). Bewusst im Speicher:
 * die Phase-2b-Tests haben keinen echten Store und dürfen keinen anlegen.
 * `list()` sortiert stabil, `del()` ist idempotent — wie der echte Store.
 */
export function createMemoryBlobStore(seed: Record<string, { bytes: Uint8Array; contentType: string }> = {}): BlobStore & {
  /** Inventar (Pfad → Größe) — nur für Test-Nachweise. */
  readonly entries: Map<string, { bytes: Uint8Array; contentType: string }>;
  /** Zähler der Fehlversuche (für „abgebrochener Blob-Delete"-Szenarien). */
  failNextDeletes: number;
  deleteAttempts: number;
} {
  const store = new Map<string, { bytes: Uint8Array; contentType: string }>();
  for (const [path, value] of Object.entries(seed)) store.set(path, value);
  return {
    kind: 'memory',
    entries: store,
    failNextDeletes: 0,
    deleteAttempts: 0,
    async put(path, bytes, contentType) {
      store.set(path, { bytes, contentType });
      return {
        url: `https://memory.private.blob.invalid/${path}`,
        contentType,
        sizeBytes: bytes.byteLength,
      };
    },
    async get(path) {
      const hit = store.get(path);
      if (!hit) return null;
      return { bytes: hit.bytes, contentType: hit.contentType, statusCode: 200 };
    },
    async del(paths) {
      this.deleteAttempts += paths.length;
      if (this.failNextDeletes > 0) {
        this.failNextDeletes -= 1;
        throw new Error('memory blob store: simulated delete failure');
      }
      for (const path of paths) store.delete(path);
    },
    async list(prefix) {
      return [...store.keys()].filter((p) => p.startsWith(prefix)).sort();
    },
  };
}

/**
 * Der Store der Anwendung — `null`, wenn keine Auth konfiguriert ist. Aufrufer
 * MÜSSEN dann 503 + ehrliche Meldung liefern (nie stilles „gespeichert").
 */
export function blobStoreOrNull(env: Record<string, string | undefined> = {}): BlobStore | null {
  if (!blobAuthPresent(env)) return null;
  return createVercelBlobStore();
}
