/**
 * VIDEO-TESTUMGEBUNG (2026-11-06) — Datenmodell für Video (NUR Demo-DB).
 *
 * Grundlage: `UMSETZUNGSPLAN.md` §3.1 (`video_jobs`), §3.2 (`generated_videos`),
 * §3.3 (`video_usage_monthly`).
 *
 * ── WARUM DIESE DATEI NICHT IN `src/db/schema.ts` STEHT ─────────────────────
 * `schema.ts` wird von `initDb()` bei JEDEM App-Start angewendet — auch in
 * Produktion. Der Auftrag erlaubt Änderungen AUSSCHLIESSLICH auf `growimo_demo`
 * („keine Änderung an der Prod-DB"). Deshalb liegt das Video-Schema getrennt
 * und wird nur von `scripts/video-migrate.ts` angewendet, das die Ziel-DB
 * vorher prüft (DB-Name muss `growimo_demo` sein, sonst Abbruch).
 *
 * Diese Datei enthält KEIN SQL-Kommentar-Sonderzeichen-Problem: sie wird NICHT
 * vom `splitSqlStatements`-Splitter von `init.ts` zerlegt, sondern von
 * `applyVideoMigration()` (siehe `video-migration.ts`) — der Splitter ist
 * derselbe, deshalb gilt die Repo-Regel trotzdem: kein Semikolon in
 * `--`-Kommentaren.
 */

export const VIDEO_SCHEMA_TABLE_NAMES = [
  'video_jobs',
  'generated_videos',
  'video_usage_monthly',
] as const;

export type VideoSchemaTableName = (typeof VIDEO_SCHEMA_TABLE_NAMES)[number];

/**
 * Additiv, idempotent (`IF NOT EXISTS`). Reihenfolge ist wichtig:
 * `generated_videos.job_id` referenziert `video_jobs.id`, und
 * `video_jobs.joined_video_id` referenziert `generated_videos.id` — deshalb wird
 * der zweite Fremdschlüssel NACH dem Anlegen beider Tabellen gesetzt.
 */
export const videoSchemaSQL = `
-- ── video_jobs: der Auftrag (§3.1) ───────────────────────────────────────────
-- user_id ist users.id (UUID, CASCADE) — NICHT die Clerk-ID. Die Clerk-ID
-- traegt nur video_usage_monthly (wie usage_monthly und usage_events).
-- expires_at hat BEWUSST KEINEN DB-Default: der Wert kommt aus der Anwendung
-- (VIDEO_JOB_MAX_MINUTES), damit es nur EINE Wahrheit gibt. Fehlt er, scheitert
-- das INSERT laut statt still nie zu loeschen (fail-closed).
CREATE TABLE IF NOT EXISTS video_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  plan_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  clips_total INTEGER NOT NULL,
  clips_done INTEGER NOT NULL DEFAULT 0,
  seconds_total INTEGER NOT NULL,
  credits_quoted INTEGER NOT NULL,
  cost_estimate_micros BIGINT NOT NULL,
  cost_micros BIGINT,
  provider TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  joined_video_id UUID,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT video_jobs_status_check CHECK (
    status IN ('planned', 'running', 'stitching', 'done', 'partial', 'failed', 'expired')
  ),
  CONSTRAINT video_jobs_clips_check CHECK (clips_total >= 1 AND clips_total <= 3),
  CONSTRAINT video_jobs_clips_done_check CHECK (clips_done >= 0 AND clips_done <= clips_total),
  CONSTRAINT video_jobs_credits_check CHECK (credits_quoted >= 0),
  CONSTRAINT video_jobs_cost_check CHECK (cost_estimate_micros >= 0)
);
CREATE INDEX IF NOT EXISTS idx_video_jobs_user_created ON video_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs (status, created_at);
-- Hoechstens EIN laufender Auftrag je Nutzer (§4.3) — als partieller Index
-- durchgesetzt, damit zwei parallele Anfragen nicht beide starten koennen.
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_jobs_one_active_per_user
  ON video_jobs (user_id)
  WHERE status IN ('planned', 'running', 'stitching');

-- ── generated_videos: die Dateien (§3.2) ─────────────────────────────────────
-- clip_index 0..n-1 = Einzelclip, NULL = zusammengefuegtes Video.
-- Die Eindeutigkeit des zusammengefuegten Videos (genau eine NULL-Zeile je
-- Auftrag) prueft der Server, NICHT der Index: NULL zaehlt in Postgres als
-- eigener Wert, ein partieller Unique-Index auf clip_index deckt das nicht ab.
CREATE TABLE IF NOT EXISTS generated_videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES video_jobs(id) ON DELETE CASCADE,
  clip_index INTEGER,
  blob_path TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'video/mp4',
  size_bytes BIGINT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  has_audio BOOLEAN NOT NULL DEFAULT false,
  provider TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  provider_job_id TEXT,
  seed BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT generated_videos_clip_index_check CHECK (clip_index IS NULL OR clip_index >= 0),
  CONSTRAINT generated_videos_size_check CHECK (size_bytes >= 0),
  CONSTRAINT generated_videos_duration_check CHECK (duration_seconds > 0),
  CONSTRAINT generated_videos_dimensions_check CHECK (width > 0 AND height > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_videos_job_clip
  ON generated_videos (job_id, clip_index);
CREATE INDEX IF NOT EXISTS idx_generated_videos_user ON generated_videos (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_videos_expires ON generated_videos (expires_at);

-- Der zweite Fremdschluessel wird NACH generated_videos gesetzt (Zirkelbezug).
ALTER TABLE video_jobs DROP CONSTRAINT IF EXISTS video_jobs_joined_video_fk;
ALTER TABLE video_jobs ADD CONSTRAINT video_jobs_joined_video_fk
  FOREIGN KEY (joined_video_id) REFERENCES generated_videos(id) ON DELETE SET NULL;

-- ── video_usage_monthly: der eigene Zaehler (§3.3) ───────────────────────────
-- user_id ist die CLERK-ID als TEXT (wie usage_monthly) — bewusst ohne FK,
-- damit der Zaehler ein Loeschen des users-Datensatzes uebersteht und nicht
-- versehentlich mitgeloescht wird. Video kann usage_monthly NICHT beruehren.
CREATE TABLE IF NOT EXISTS video_usage_monthly (
  user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0,
  credits_reserved INTEGER NOT NULL DEFAULT 0,
  cost_micros BIGINT NOT NULL DEFAULT 0,
  cost_micros_reserved BIGINT NOT NULL DEFAULT 0,
  videos_done INTEGER NOT NULL DEFAULT 0,
  videos_reserved INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, period),
  CONSTRAINT video_usage_monthly_nonnegative CHECK (
    credits_used >= 0 AND credits_reserved >= 0 AND videos_done >= 0 AND videos_reserved >= 0
    AND cost_micros >= 0 AND cost_micros_reserved >= 0
  )
);
`;

/**
 * Rücknahme (Rollback) — löscht NUR die drei neuen Tabellen. Keine bestehende
 * Tabelle wird angefasst. Reihenfolge: erst der Fremdschlüssel-Zirkel, dann die
 * Tabellen.
 */
export const videoRollbackSQL = `
ALTER TABLE IF EXISTS video_jobs DROP CONSTRAINT IF EXISTS video_jobs_joined_video_fk;
DROP TABLE IF EXISTS video_usage_monthly;
DROP TABLE IF EXISTS generated_videos;
DROP TABLE IF EXISTS video_jobs;
`;
