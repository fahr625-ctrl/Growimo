/**
 * VIDEO-TESTUMGEBUNG (2026-11-06) — DB-Operationen des Video-Auftrags.
 *
 * Grundlage: `UMSETZUNGSPLAN.md` §10.3 (reservieren → buchen → freigeben),
 * §4.3 (Doppel-Submit über DB-Lock), §3 (Datenmodell).
 *
 * Zwei Regeln, die hier technisch durchgesetzt werden:
 *   1. Reserviert wird das GANZE Video vor dem ersten Anbieter-Aufruf —
 *      konditional in EINEM Statement, damit zwei parallele Anfragen nicht
 *      beide durchkommen (§10.3).
 *   2. Gebucht wird nur Geliefertes (`bookVideoCredits` wird ausschließlich
 *      nach `settleVideoJob()` mit `reason: 'delivered'` aufgerufen).
 *
 * Die Funktionen nehmen den Neon-Client als Parameter (testbar gegen
 * `growimo_demo`, ohne Modul-Zustand).
 */

export type VideoSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  unsafe: (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

export interface VideoUsageRow {
  user_id: string;
  period: string;
  credits_used: number;
  credits_reserved: number;
  cost_micros: number;
  cost_micros_reserved: number;
  videos_done: number;
  videos_reserved: number;
}

/** Monatsperiode 'YYYY-MM' (UTC) — gleiche Form wie `usage_monthly.period`. */
export function videoPeriod(d: Date = new Date()): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Liest den Video-Zähler (oder null, wenn in diesem Monat noch nichts lief). */
export async function getVideoUsage(
  sql: VideoSql,
  userId: string,
  period: string,
): Promise<VideoUsageRow | null> {
  const rows = await sql`
    SELECT user_id, period, credits_used, credits_reserved, cost_micros,
           cost_micros_reserved, videos_done, videos_reserved
    FROM video_usage_monthly
    WHERE user_id = ${userId} AND period = ${period}
  `;
  return (rows[0] as unknown as VideoUsageRow) ?? null;
}

/**
 * §10.3 Schritt 1 — atomare, konditionale Reservierung des GANZEN Videos.
 * Kein Rückgabewert ⇒ Kontingent ODER Kostendeckel erreicht ⇒ Aufrufer wirft
 * `VideoLimitError` VOR jedem Anbieter-Kontakt.
 */
export async function reserveVideoCredits(
  sql: VideoSql,
  input: {
    userId: string;
    period: string;
    credits: number;
    costMicros: number;
    creditLimit: number;
    costCapMicros: number;
  },
): Promise<VideoUsageRow | null> {
  const rows = await sql`
    INSERT INTO video_usage_monthly (user_id, period, credits_reserved, cost_micros_reserved, videos_reserved)
    VALUES (${input.userId}, ${input.period}, ${input.credits}, ${input.costMicros}, 1)
    ON CONFLICT (user_id, period) DO UPDATE
      SET credits_reserved     = video_usage_monthly.credits_reserved + ${input.credits},
          cost_micros_reserved = video_usage_monthly.cost_micros_reserved + ${input.costMicros},
          videos_reserved      = video_usage_monthly.videos_reserved + 1,
          updated_at = NOW()
      WHERE video_usage_monthly.credits_used + video_usage_monthly.credits_reserved + ${input.credits} <= ${input.creditLimit}
        AND video_usage_monthly.cost_micros + video_usage_monthly.cost_micros_reserved + ${input.costMicros} <= ${input.costCapMicros}
    RETURNING user_id, period, credits_used, credits_reserved, cost_micros,
              cost_micros_reserved, videos_done, videos_reserved
  `;
  return (rows[0] as unknown as VideoUsageRow) ?? null;
}

/**
 * §10.3 Schritt 2 — buchen. NUR nach einem fertigen MP4 (`settleVideoJob` ⇒
 * `delivered`). Verschiebt Reservierung nach Verbrauch.
 */
export async function bookVideoCredits(
  sql: VideoSql,
  input: { userId: string; period: string; credits: number; costMicros: number },
): Promise<VideoUsageRow> {
  const rows = await sql`
    UPDATE video_usage_monthly
       SET credits_reserved     = GREATEST(0, credits_reserved - ${input.credits}),
           credits_used         = credits_used + ${input.credits},
           cost_micros_reserved = GREATEST(0, cost_micros_reserved - ${input.costMicros}),
           cost_micros          = cost_micros + ${input.costMicros},
           videos_done          = videos_done + 1,
           videos_reserved      = GREATEST(0, videos_reserved - 1),
           updated_at = NOW()
     WHERE user_id = ${input.userId} AND period = ${input.period}
    RETURNING user_id, period, credits_used, credits_reserved, cost_micros,
              cost_micros_reserved, videos_done, videos_reserved
  `;
  if (!rows[0]) throw new Error('bookVideoCredits: keine Zählerzeile für diesen Monat');
  return rows[0] as unknown as VideoUsageRow;
}

/**
 * §10.3 Schritt 3 — freigeben (failed/expired/partial). Netto 0, kein
 * Ledger-Eintrag: nur erfolgreiche Läufe schreiben ins Ledger.
 */
export async function releaseVideoCredits(
  sql: VideoSql,
  input: { userId: string; period: string; credits: number; costMicros: number },
): Promise<VideoUsageRow> {
  const rows = await sql`
    UPDATE video_usage_monthly
       SET credits_reserved     = GREATEST(0, credits_reserved - ${input.credits}),
           cost_micros_reserved = GREATEST(0, cost_micros_reserved - ${input.costMicros}),
           videos_reserved      = GREATEST(0, videos_reserved - 1),
           updated_at = NOW()
     WHERE user_id = ${input.userId} AND period = ${input.period}
    RETURNING user_id, period, credits_used, credits_reserved, cost_micros,
              cost_micros_reserved, videos_done, videos_reserved
  `;
  if (!rows[0]) throw new Error('releaseVideoCredits: keine Zählerzeile für diesen Monat');
  return rows[0] as unknown as VideoUsageRow;
}

export interface VideoJobRow {
  id: string;
  user_id: string;
  status: string;
  clips_total: number;
  clips_done: number;
  seconds_total: number;
  credits_quoted: number;
  joined_video_id: string | null;
  error_code: string | null;
}

/** Legt den Auftrag an (§3.1) — `expires_at` kommt vom Aufrufer, nie aus der DB. */
export async function createVideoJob(
  sql: VideoSql,
  input: {
    userId: string;
    source: string;
    planJson: unknown;
    clipsTotal: number;
    secondsTotal: number;
    creditsQuoted: number;
    costEstimateMicros: number;
    provider: string;
    providerModel: string;
    expiresAt: Date;
  },
): Promise<VideoJobRow> {
  const rows = await sql`
    INSERT INTO video_jobs
      (user_id, source, plan_json, status, clips_total, clips_done, seconds_total,
       credits_quoted, cost_estimate_micros, provider, provider_model, expires_at)
    VALUES
      (${input.userId}, ${input.source}, ${JSON.stringify(input.planJson)}::jsonb, 'planned',
       ${input.clipsTotal}, 0, ${input.secondsTotal}, ${input.creditsQuoted},
       ${input.costEstimateMicros}, ${input.provider}, ${input.providerModel}, ${input.expiresAt.toISOString()})
    RETURNING id, user_id, status, clips_total, clips_done, seconds_total, credits_quoted,
              joined_video_id, error_code
  `;
  return rows[0] as unknown as VideoJobRow;
}

/**
 * §4.3 Ebene 1 — der DB-Lock gegen Doppel-Submit. Kein Rückgabewert ⇒ es läuft
 * schon (oder der Auftrag ist nicht mehr `planned`) ⇒ der zweite parallele
 * Request tut NICHTS.
 */
export async function claimVideoJob(sql: VideoSql, jobId: string): Promise<string | null> {
  const rows = await sql`
    UPDATE video_jobs
       SET status = 'running', updated_at = NOW()
     WHERE id = ${jobId} AND status = 'planned'
    RETURNING id
  `;
  return rows[0] ? String((rows[0] as { id: string }).id) : null;
}

/** Setzt Status/Fortschritt eines Auftrags (ein Schritt, ein Update). */
export async function updateVideoJobProgress(
  sql: VideoSql,
  input: { jobId: string; status: string; clipsDone?: number; errorCode?: string | null },
): Promise<VideoJobRow | null> {
  const rows = await sql`
    UPDATE video_jobs
       SET status = ${input.status},
           clips_done = COALESCE(${input.clipsDone ?? null}::int, clips_done),
           error_code = ${input.errorCode ?? null}::text,
           updated_at = NOW()
     WHERE id = ${input.jobId}
    RETURNING id, user_id, status, clips_total, clips_done, seconds_total, credits_quoted,
              joined_video_id, error_code
  `;
  return (rows[0] as unknown as VideoJobRow) ?? null;
}

/** Schreibt eine fertige Datei (Clip oder zusammengefügtes Video, §3.2). */
export async function insertGeneratedVideo(
  sql: VideoSql,
  input: {
    userId: string;
    jobId: string;
    clipIndex: number | null;
    blobPath: string;
    sizeBytes: number;
    durationSeconds: number;
    width: number;
    height: number;
    provider: string;
    providerModel: string;
    providerJobId?: string | null;
    expiresAt: Date;
  },
): Promise<{ id: string }> {
  const rows = await sql`
    INSERT INTO generated_videos
      (user_id, job_id, clip_index, blob_path, content_type, size_bytes, duration_seconds,
       width, height, has_audio, provider, provider_model, provider_job_id, expires_at)
    VALUES
      (${input.userId}, ${input.jobId}, ${input.clipIndex}::int, ${input.blobPath}, 'video/mp4',
       ${input.sizeBytes}, ${input.durationSeconds}, ${input.width}, ${input.height}, false,
       ${input.provider}, ${input.providerModel}, ${input.providerJobId ?? null}::text, ${input.expiresAt.toISOString()})
    RETURNING id
  `;
  return rows[0] as unknown as { id: string };
}

/** Setzt das fertige MP4 am Auftrag (§3.1 `joined_video_id`). */
export async function setJoinedVideo(
  sql: VideoSql,
  jobId: string,
  videoId: string,
): Promise<VideoJobRow | null> {
  const rows = await sql`
    UPDATE video_jobs
       SET joined_video_id = ${videoId}, status = 'done', updated_at = NOW()
     WHERE id = ${jobId}
    RETURNING id, user_id, status, clips_total, clips_done, seconds_total, credits_quoted,
              joined_video_id, error_code
  `;
  return (rows[0] as unknown as VideoJobRow) ?? null;
}

/**
 * Genau EINE zusammengefügte Zeile je Auftrag (§3.2 Index-Lücke).
 * Der Aufrufer prüft das vor dem INSERT — hier nur die Zählung.
 */
export async function countJoinedVideos(sql: VideoSql, jobId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM generated_videos WHERE job_id = ${jobId} AND clip_index IS NULL
  `;
  return Number((rows[0] as { n: number }).n);
}
