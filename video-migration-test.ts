// ─────────────────────────────────────────────────────────────────────────────
// VIDEO-TESTUMGEBUNG (2026-11-06) — Migration + Datenmodell gegen growimo_demo
// ─────────────────────────────────────────────────────────────────────────────
//   bun --env-file=/tmp/video/demo.env video-migration-test.ts
//
// Was hier bewiesen wird:
//   [A] Die harte Demo-Sperre (jede andere DB ⇒ Abbruch, kein Statement)
//   [B] Migration idempotent (2× anwenden ⇒ gleicher Zustand), Spalten/Indizes/Checks
//   [C] Datenmodell funktioniert: Job, DB-Lock gegen Doppel-Submit, Clip-Zeilen,
//       Unique-Index, CASCADE, Zähler (reservieren → buchen / freigeben)
//   [D] Rollback nimmt NUR die drei neuen Tabellen zurück, Re-Apply geht wieder
//   [E] Aufräumen: keine Zeile bleibt zurück
//
// Die Suite schreibt AUSSCHLIESSLICH in `growimo_demo` und räumt ihre eigenen
// Zeilen wieder auf (synthetischer Nutzer mit erkennbarer Clerk-ID).
// ─────────────────────────────────────────────────────────────────────────────
import { getDb } from "./src/db/index";
import {
  VIDEO_DEMO_DB_NAME,
  VideoMigrationGuardError,
  applyVideoMigration,
  assertDemoDatabase,
  rollbackVideoMigration,
  videoSchemaStatus,
} from "./src/db/video-migration";
import { VIDEO_SCHEMA_TABLE_NAMES } from "./src/db/video-schema";
import {
  bookVideoCredits,
  claimVideoJob,
  countJoinedVideos,
  createVideoJob,
  getVideoUsage,
  insertGeneratedVideo,
  releaseVideoCredits,
  reserveVideoCredits,
  setJoinedVideo,
  videoPeriod,
  type VideoSql,
} from "./src/db/video";
import { VIDEO_CREDITS_PRO, VIDEO_MONTH_COST_CAP_MICROS, quoteVideo, settleVideoJob } from "./src/lib/video-credits";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass += 1;
    console.log(`  ✓ PASS: ${name}`);
  } else {
    fail += 1;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(actual)}`);
}

async function throwsCode(name: string, fn: () => Promise<unknown> | unknown, code: string): Promise<void> {
  try {
    await fn();
    check(name, false, "es wurde NICHT geworfen");
  } catch (err) {
    const actual = err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined;
    check(name, actual === code, `Code ${String(actual)} statt ${code} (${(err as Error).message})`);
  }
}

/** Postgres-Fehlercode (23505 = unique_violation, 23514 = check_violation). */
function pgCode(err: unknown): string | undefined {
  return err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : undefined;
}

async function expectPgError(name: string, fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    check(name, false, `kein Fehler (erwartet ${code})`);
  } catch (err) {
    const actual = pgCode(err);
    check(name, actual === code, `Postgres-Code ${String(actual)} statt ${code} (${(err as Error).message})`);
  }
}

const RUN = `vid-${Date.now().toString(36)}`;
const CLERK_ID = `video-test-${RUN}`;

async function main(): Promise<void> {
  console.log("— video-migration-test (growimo_demo) —\n");

  // ── [A] Demo-Sperre ───────────────────────────────────────────────────────
  console.log("[A] Demo-Sperre (fail-closed)");
  const demoUrl = process.env.DATABASE_URL;
  eq("Ziel-DB ist growimo_demo", assertDemoDatabase(demoUrl), VIDEO_DEMO_DB_NAME);
  await throwsCode(
    "Prod-URL (neondb) ⇒ Guard wirft",
    () => assertDemoDatabase("postgresql://u:p@h.aws.neon.tech/neondb?sslmode=require"),
    "video_migration_guard",
  );
  await throwsCode(
    "fremde DB ⇒ Guard wirft",
    () => assertDemoDatabase("postgresql://u:p@h/growimo_prod"),
    "video_migration_guard",
  );
  await throwsCode("fehlende URL ⇒ Guard wirft", () => assertDemoDatabase(undefined), "video_migration_guard");
  check("Fehlertyp ist VideoMigrationGuardError", (() => {
    try {
      assertDemoDatabase("postgresql://u:p@h/neondb");
      return false;
    } catch (err) {
      return err instanceof VideoMigrationGuardError;
    }
  })());

  const sql = getDb() as unknown as VideoSql;
  /** Roher SQL-Text (nur Konstanten-SQL) — Neon führt Text nur als Tagged Template aus. */
  const raw = async (text: string): Promise<Record<string, unknown>[]> =>
    (await (sql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<Record<string, unknown>[]>)`${(sql as unknown as { unsafe: (q: string) => unknown }).unsafe(text)}`);

  // ── [B] Migration ─────────────────────────────────────────────────────────
  console.log("\n[B] Migration (idempotent)");
  const before = await videoSchemaStatus(sql as never);
  console.log("    Zustand vorher:", JSON.stringify(before));
  const first = await applyVideoMigration(sql as never, demoUrl);
  console.log(`    Lauf 1: ${first.statements} Statements`);
  eq("nach Lauf 1 existieren alle drei Tabellen", first.tables, {
    video_jobs: true,
    generated_videos: true,
    video_usage_monthly: true,
  });
  const second = await applyVideoMigration(sql as never, demoUrl);
  console.log(`    Lauf 2: ${second.statements} Statements`);
  eq("Lauf 2 ändert nichts (idempotent)", second.tables, first.tables);
  eq("Statement-Zahl ist stabil", second.statements, first.statements);

  const columns = (await raw(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name IN ('video_jobs','generated_videos','video_usage_monthly')`,
  )) as unknown as { table_name: string; column_name: string; data_type: string }[];
  const col = (t: string, c: string) => columns.find((x) => x.table_name === t && x.column_name === c);
  check("video_jobs.plan_json ist jsonb", col("video_jobs", "plan_json")?.data_type === "jsonb");
  check("video_jobs.user_id ist uuid", col("video_jobs", "user_id")?.data_type === "uuid");
  check("video_usage_monthly.user_id ist TEXT (Clerk-ID)", col("video_usage_monthly", "user_id")?.data_type === "text");
  check("generated_videos.clip_index ist nullable INTEGER", col("generated_videos", "clip_index")?.data_type === "integer");
  check("video_jobs.expires_at ist NOT NULL", ((await raw(
    `SELECT is_nullable FROM information_schema.columns WHERE table_name='video_jobs' AND column_name='expires_at'`,
  )) as unknown as { is_nullable: string }[])[0]?.is_nullable === "NO");

  const indexes = (await raw(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('video_jobs','generated_videos','video_usage_monthly')`,
  )) as unknown as { indexname: string }[];
  const indexNames = indexes.map((i) => i.indexname);
  for (const expected of [
    "idx_video_jobs_user_created",
    "idx_video_jobs_status",
    "idx_video_jobs_one_active_per_user",
    "idx_generated_videos_job_clip",
    "idx_generated_videos_user",
    "idx_generated_videos_expires",
  ]) {
    check(`Index ${expected} existiert`, indexNames.includes(expected), indexNames.join(","));
  }
  const fks = (await raw(
    `SELECT conname FROM pg_constraint WHERE contype='f' AND conrelid IN ('video_jobs'::regclass,'generated_videos'::regclass)`,
  )) as unknown as { conname: string }[];
  const fkNames = fks.map((f) => f.conname);
  check("FK video_jobs.joined_video_id existiert (Zirkelbezug)", fkNames.includes("video_jobs_joined_video_fk"), fkNames.join(","));
  check("FK generated_videos.job_id existiert", fkNames.some((n) => n.includes("job_id")), fkNames.join(","));

  // ── [C] Datenmodell ───────────────────────────────────────────────────────
  console.log("\n[C] Datenmodell: Job, Doppel-Submit-Lock, Dateien, Zähler");
  const userRows = (await sql`
    INSERT INTO users (email, clerk_id, name)
    VALUES (${`${RUN}@video-test.invalid`}, ${CLERK_ID}, ${"Video-Testnutzer"})
    RETURNING id
  `) as unknown as { id: string }[];
  const userId = userRows[0].id;
  check("synthetischer Nutzer angelegt", typeof userId === "string" && userId.length === 36);

  const quote = quoteVideo("kling-v2.5-turbo", [
    { index: 0, seconds: 8 },
    { index: 1, seconds: 8 },
    { index: 2, seconds: 4 },
  ]);
  const period = videoPeriod();
  const expiresAt = new Date(Date.now() + 45 * 60_000);

  // Zähler: reservieren → buchen (nur bei fertigem MP4)
  const reserved = await reserveVideoCredits(sql, {
    userId: CLERK_ID,
    period,
    credits: quote.credits,
    costMicros: quote.costEstimateMicros,
    creditLimit: VIDEO_CREDITS_PRO,
    costCapMicros: VIDEO_MONTH_COST_CAP_MICROS,
  });
  check("Reservierung des ganzen Videos gelingt", reserved !== null);
  eq("reservierte Credits = Angebot", reserved?.credits_reserved, quote.credits);
  eq("gebuchte Credits noch 0", reserved?.credits_used, 0);

  const refused = await reserveVideoCredits(sql, {
    userId: CLERK_ID,
    period,
    credits: quote.credits,
    costMicros: quote.costEstimateMicros,
    creditLimit: VIDEO_CREDITS_PRO,
    costCapMicros: VIDEO_MONTH_COST_CAP_MICROS,
  });
  eq("zweite Reservierung über dem Limit ⇒ kein Rückgabewert (fail-closed)", refused, null);
  const afterRefusal = await getVideoUsage(sql, CLERK_ID, period);
  eq("… und der Zähler ist unverändert", afterRefusal?.credits_reserved, quote.credits);

  const job = await createVideoJob(sql, {
    userId,
    source: "tiktok-concept",
    planJson: { clips: [{ seconds: 8 }, { seconds: 8 }, { seconds: 4 }], total: 20 },
    clipsTotal: 3,
    secondsTotal: 20,
    creditsQuoted: quote.credits,
    costEstimateMicros: quote.costEstimateMicros,
    provider: "fake",
    providerModel: "fake-test-video-1",
    expiresAt,
  });
  eq("Job angelegt im Zustand planned", job.status, "planned");

  const claim1 = await claimVideoJob(sql, job.id);
  eq("erster claim gewinnt den Lock", claim1, job.id);
  const claim2 = await claimVideoJob(sql, job.id);
  eq("zweiter claim (paralleler Request) bekommt NICHTS", claim2, null);

  await expectPgError(
    "zweiter aktiver Auftrag desselben Nutzers ⇒ unique violation (ein laufender Auftrag)",
    () =>
      createVideoJob(sql, {
        userId,
        source: "tiktok-concept",
        planJson: {},
        clipsTotal: 1,
        secondsTotal: 5,
        creditsQuoted: 5,
        costEstimateMicros: 100_000,
        provider: "fake",
        providerModel: "fake-test-video-1",
        expiresAt,
      }),
    "23505",
  );

  const clip0 = await insertGeneratedVideo(sql, {
    userId,
    jobId: job.id,
    clipIndex: 0,
    blobPath: `video-test/${RUN}/clip-0.mp4`,
    sizeBytes: 16384,
    durationSeconds: 8,
    width: 720,
    height: 1280,
    provider: "fake",
    providerModel: "fake-test-video-1",
    providerJobId: "fake-job-0",
    expiresAt,
  });
  check("Clip 0 geschrieben", typeof clip0.id === "string");
  await expectPgError(
    "gleicher clip_index ein zweites Mal ⇒ unique violation (1 Blob = 1 Zeile)",
    () =>
      insertGeneratedVideo(sql, {
        userId,
        jobId: job.id,
        clipIndex: 0,
        blobPath: `video-test/${RUN}/clip-0b.mp4`,
        sizeBytes: 1000,
        durationSeconds: 8,
        width: 720,
        height: 1280,
        provider: "fake",
        providerModel: "fake-test-video-1",
        expiresAt,
      }),
    "23505",
  );
  await expectPgError(
    "Dauer 0 ⇒ check violation",
    () =>
      insertGeneratedVideo(sql, {
        userId,
        jobId: job.id,
        clipIndex: 1,
        blobPath: `video-test/${RUN}/clip-1.mp4`,
        sizeBytes: 1000,
        durationSeconds: 0,
        width: 720,
        height: 1280,
        provider: "fake",
        providerModel: "fake-test-video-1",
        expiresAt,
      }),
    "23514",
  );

  const joined = await insertGeneratedVideo(sql, {
    userId,
    jobId: job.id,
    clipIndex: null,
    blobPath: `video-test/${RUN}/joined.mp4`,
    sizeBytes: 32768,
    durationSeconds: 20,
    width: 720,
    height: 1280,
    provider: "fake",
    providerModel: "fake-test-video-1",
    expiresAt,
  });
  eq("genau eine zusammengefügte Zeile", await countJoinedVideos(sql, job.id), 1);
  const done = await setJoinedVideo(sql, job.id, joined.id);
  eq("Job ist done mit joined_video_id", { status: done?.status, joined: done?.joined_video_id }, { status: "done", joined: joined.id });

  // Buchung nach der Owner-Regel
  const settlement = settleVideoJob({
    state: "done",
    joinedVideoId: done?.joined_video_id ?? null,
    quotedCredits: quote.credits,
    deliveredClips: 3,
  });
  eq("Settlement: delivered ⇒ volle Credits", settlement.book, quote.credits);
  const booked = await bookVideoCredits(sql, {
    userId: CLERK_ID,
    period,
    credits: settlement.book,
    costMicros: quote.costEstimateMicros,
  });
  eq("nach dem Buchen: credits_used = Angebot", booked.credits_used, quote.credits);
  eq("nach dem Buchen: keine Reservierung mehr", booked.credits_reserved, 0);
  eq("videos_done = 1", booked.videos_done, 1);

  // Freigabe-Pfad (partial): eigene Periode, damit der Zähler eindeutig bleibt
  const partialPeriod = `${period}-partial`;
  await reserveVideoCredits(sql, {
    userId: CLERK_ID,
    period: partialPeriod,
    credits: 20,
    costMicros: 1_240_000,
    creditLimit: VIDEO_CREDITS_PRO,
    costCapMicros: VIDEO_MONTH_COST_CAP_MICROS,
  });
  const released = await releaseVideoCredits(sql, {
    userId: CLERK_ID,
    period: partialPeriod,
    credits: 20,
    costMicros: 1_240_000,
  });
  eq("Freigabe: Reservierung zurück auf 0", released.credits_reserved, 0);
  eq("Freigabe: NICHTS gebucht (partial kostet keine Credits)", released.credits_used, 0);
  eq("Freigabe: kein fertiges Video gezählt", released.videos_done, 0);

  // CASCADE: Nutzer löschen ⇒ Job + Dateien weg, Zähler bleibt (bewusst ohne FK)
  await sql`DELETE FROM users WHERE id = ${userId}`;
  const leftover = (await sql`
    SELECT (SELECT COUNT(*)::int FROM video_jobs WHERE id = ${job.id}) AS jobs,
           (SELECT COUNT(*)::int FROM generated_videos WHERE job_id = ${job.id}) AS files
  `) as unknown as { jobs: number; files: number }[];
  eq("Kontolöschung nimmt Job und Dateien mit (CASCADE)", leftover[0], { jobs: 0, files: 0 });
  const usageAfterDelete = await getVideoUsage(sql, CLERK_ID, period);
  check("Zähler überlebt die Kontolöschung (bewusst ohne FK, wie usage_monthly)", usageAfterDelete !== null);

  // Aufräumen des Zählers (eigene Zeilen)
  await sql`DELETE FROM video_usage_monthly WHERE user_id = ${CLERK_ID}`;

  // ── [D] Rollback ──────────────────────────────────────────────────────────
  console.log("\n[D] Rollback (nur die drei neuen Tabellen)");
  const existingTables = (await raw(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`,
  )) as unknown as { n: number }[];
  const rolledBack = await rollbackVideoMigration(sql as never, demoUrl);
  console.log(`    Rollback: ${rolledBack.statements} Statements`);
  eq("nach Rollback sind alle drei Tabellen weg", rolledBack.tables, {
    video_jobs: false,
    generated_videos: false,
    video_usage_monthly: false,
  });
  const afterDrop = (await raw(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`,
  )) as unknown as { n: number }[];
  eq("Rollback hat NUR die drei neuen Tabellen entfernt", existingTables[0].n - afterDrop[0].n, 3);
  await throwsCode(
    "Rollback auf falscher DB ⇒ Guard wirft",
    () => rollbackVideoMigration(sql as never, "postgresql://u:p@h/neondb"),
    "video_migration_guard",
  );

  const reapplied = await applyVideoMigration(sql as never, demoUrl);
  eq("erneutes Anwenden nach Rollback ⇒ alle drei Tabellen wieder da", reapplied.tables, {
    video_jobs: true,
    generated_videos: true,
    video_usage_monthly: true,
  });

  // ── [E] Aufräumen ─────────────────────────────────────────────────────────
  console.log("\n[E] Aufräumen");
  const counts = (await raw(
    `SELECT (SELECT COUNT(*)::int FROM video_jobs) AS jobs,
            (SELECT COUNT(*)::int FROM generated_videos) AS files,
            (SELECT COUNT(*)::int FROM video_usage_monthly) AS usage`,
  )) as unknown as { jobs: number; files: number; usage: number }[];
  eq("keine Restzeilen in den Video-Tabellen", counts[0], { jobs: 0, files: 0, usage: 0 });
  const userLeft = (await sql`SELECT COUNT(*)::int AS n FROM users WHERE clerk_id = ${CLERK_ID}`) as unknown as {
    n: number;
  }[];
  eq("synthetischer Nutzer ist entfernt", userLeft[0].n, 0);

  console.log(`\n— Ergebnis: ${pass} PASS, ${fail} FAIL —`);
  if (fail > 0) {
    console.log("Fehlgeschlagen:");
    for (const f of failures) console.log("  · " + f);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("ABBRUCH:", err instanceof Error ? err.message : String(err));
  process.exit(2);
});
