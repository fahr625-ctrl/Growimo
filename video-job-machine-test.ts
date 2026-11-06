// ─────────────────────────────────────────────────────────────────────────────
// VIDEO-TESTUMGEBUNG (2026-11-06) — Poll-Zustandsmaschine (§4) + Credit-Semantik
// (§10.3/§10.5, Owner-Regel „Credit nur bei fertigem MP4")
// ─────────────────────────────────────────────────────────────────────────────
//   bun video-job-machine-test.ts
//
// Kein DB, kein Netz, keine echte Zeit: `now` wird übergeben, „10 Minuten
// später" ist ein Zahlenwert. Der Happy Path läuft gegen den FakeVideoProvider.
// ─────────────────────────────────────────────────────────────────────────────
import { FakeVideoProvider } from "./src/ai/video/fake-provider";
import type { VideoClipRequest } from "./src/ai/video/types";
import {
  VIDEO_ADVANCE_LOCK_MS,
  VIDEO_JOB_MAX_MINUTES,
  VIDEO_MAX_POLLS_PER_CLIP,
  VIDEO_POLL_INTERVAL_MS,
  VideoJobTransitionError,
  canTransition,
  claimForAdvance,
  createJobSnapshot,
  deliveredClipCount,
  isJobExpired,
  nextStep,
  pollThrottle,
  recordClipStored,
  recordExpired,
  recordJoined,
  recordStatus,
  recordStitchFailure,
  recordStop,
  recordSubmit,
  type VideoJobSnapshot,
} from "./src/lib/video-job-machine";
import {
  CREDIT_VALUE_EUR,
  VIDEO_CLIP_COST_CAP_MICROS,
  VIDEO_CREDITS_FREE,
  VIDEO_CREDITS_PRO,
  VIDEO_MONTH_COST_CAP_MICROS,
  VideoCreditError,
  assertClipCostCap,
  canReserve,
  clipCostMicros,
  costCapMicrosFor,
  creditLimitFor,
  creditsForClip,
  quoteVideo,
  settleVideoJob,
  settlementMessage,
} from "./src/lib/video-credits";

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

function throwsCode(name: string, fn: () => unknown, code: string): void {
  try {
    fn();
    check(name, false, "es wurde NICHT geworfen");
  } catch (err) {
    const actual = err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined;
    check(name, actual === code, `Code ${String(actual)} statt ${code} (${(err as Error).message})`);
  }
}

const T0 = 1_700_000_000_000; // fester Startpunkt — keine Systemuhr
const clipRequest = (id: string, seconds = 8): VideoClipRequest => ({
  prompt: `photorealistic cinematic footage\nSzene ${id}`,
  durationSeconds: seconds,
  resolution: "720p",
  audio: false,
  multiShot: false,
  externalTaskId: id,
});

console.log("— video-job-machine-test (§4, §10) —\n");

// ── A. Übergänge (§4.4) ─────────────────────────────────────────────────────
console.log("[A] Statusübergänge");
eq("planned → running erlaubt", canTransition("planned", "running"), true);
eq("planned → done verboten", canTransition("planned", "done"), false);
eq("running → stitching erlaubt", canTransition("running", "stitching"), true);
eq("running → partial erlaubt", canTransition("running", "partial"), true);
eq("stitching → done erlaubt", canTransition("stitching", "done"), true);
eq("stitching → partial erlaubt", canTransition("stitching", "partial"), true);
eq("done ist Endzustand", canTransition("done", "running"), false);
eq("partial ist Endzustand", canTransition("partial", "done"), false);
eq("failed ist Endzustand", canTransition("failed", "running"), false);
eq("jeder Zustand → expired", ["planned", "running", "stitching"].every((s) => canTransition(s as never, "expired")), true);
throwsCode(
  "ungültiger Übergang wirft invalid_transition",
  () => recordJoined(createJobSnapshot({ id: "j", clipsTotal: 2, now: T0 }), "vid", T0),
  "invalid_transition",
);
throwsCode(
  "clipsTotal 0 ⇒ abgelehnt",
  () => createJobSnapshot({ id: "j", clipsTotal: 0, now: T0 }),
  "invalid_clips_total",
);
throwsCode(
  "clipsTotal 4 ⇒ abgelehnt (kein stiller 4. Clip)",
  () => createJobSnapshot({ id: "j", clipsTotal: 4, now: T0 }),
  "invalid_clips_total",
);

// ── B. Happy Path 3 Clips gegen den Fake-Anbieter ───────────────────────────
console.log("\n[B] Happy Path: 3 Clips → stitching → done (Fake-Anbieter)");
{
  const provider = new FakeVideoProvider({ pollsUntilDone: 2 });
  let job = createJobSnapshot({ id: "job-1", clipsTotal: 3, now: T0 });
  let now = T0;
  const storedBytes: number[] = [];
  let guard = 0;
  let stepKinds: string[] = [];
  while (guard < 200) {
    guard += 1;
    const step = nextStep(job, now);
    stepKinds.push(step.kind);
    if (step.kind === "submit") {
      const { providerJobId } = await provider.submit(clipRequest(`clip-${step.clipIndex}`));
      job = recordSubmit(job, step.clipIndex, providerJobId, now);
    } else if (step.kind === "poll") {
      const status = await provider.status(step.providerJobId);
      job = recordStatus(job, step.clipIndex, status.state, now, status.errorCode ?? null);
    } else if (step.kind === "fetch") {
      const result = await provider.fetchResult(step.providerJobId);
      storedBytes.push(result.bytes.length);
      job = recordClipStored(job, step.clipIndex, now);
    } else if (step.kind === "stitch") {
      job = recordJoined(job, "video-joined-1", now);
    } else if (step.kind === "complete") {
      break;
    } else {
      check("Happy Path: unerwarteter Schritt", false, JSON.stringify(step));
      break;
    }
    now += VIDEO_POLL_INTERVAL_MS; // Client-Poll-Takt
  }
  eq("Endzustand ist done", job.state, "done");
  eq("alle 3 Clips gespeichert", deliveredClipCount(job), 3);
  eq("joinedVideoId gesetzt", job.joinedVideoId, "video-joined-1");
  eq("3 Clips wurden abgeholt", storedBytes.length, 3);
  check("kein Schritt wurde wiederholt (kein Doppel-Submit)", stepKinds.filter((k) => k === "submit").length === 3, stepKinds.join(","));
  check("Reihenfolge: submit → poll → fetch je Clip", stepKinds.join(",").startsWith("submit,poll,poll,fetch,submit"), stepKinds.join(","));
  eq("genau ein stitch", stepKinds.filter((k) => k === "stitch").length, 1);
  eq("Anbieter: 3 submits", provider.calls.submit, 3);
}

// ── C. Drosselung + Doppel-Submit-Sperre (§4.3) ─────────────────────────────
console.log("\n[C] Drosselung und parallele Requests");
{
  let job = createJobSnapshot({ id: "job-2", clipsTotal: 2, now: T0 });
  eq("erster Schritt ohne Sperre", claimForAdvance(job, T0), { claimed: true });
  job = recordSubmit(job, 0, "p-0", T0);
  const second = claimForAdvance(job, T0 + 1_000);
  eq("zweiter Request 1 s später ⇒ locked", second.claimed, false);
  eq("… mit Wartezeit", second.claimed === false ? second.reason : "x", "locked");
  check("… Wartezeit ist plausibel", second.claimed === false && second.retryInMs === VIDEO_ADVANCE_LOCK_MS - 1_000);
  eq("nach dem Sperrfenster wieder frei", claimForAdvance(job, T0 + VIDEO_ADVANCE_LOCK_MS), { claimed: true });

  const throttled = pollThrottle(job, T0 + 1_000);
  eq("Poll-Drosselung greift (5-s-Fenster)", throttled.allowed, false);
  eq("Drosselung nach 5 s vorbei", pollThrottle(job, T0 + VIDEO_POLL_INTERVAL_MS).allowed, true);
  eq("nextStep liefert 'throttled' im Fenster", nextStep(job, T0 + 1_000).kind, "throttled");

  throwsCode(
    "zweiter Submit für denselben Clip ⇒ retry_budget_exhausted (kein Auto-Retry)",
    () => recordSubmit(job, 0, "p-0-zweiter", T0 + VIDEO_ADVANCE_LOCK_MS),
    "retry_budget_exhausted",
  );
  const terminal = recordStop(job, "failed", "clip_failed", T0 + 20_000);
  eq("terminaler Auftrag lässt keinen Schritt mehr zu", claimForAdvance(terminal, T0 + 999_999).claimed, false);
  eq("nextStep auf terminalem Auftrag ⇒ stop", nextStep(terminal, T0 + 999_999).kind, "stop");
}

// ── D. Fehlerpfade (§10.5) ─────────────────────────────────────────────────
console.log("\n[D] Fehlerpfade: Clip 1 scheitert / Clip 2 scheitert / Zusammenfügen scheitert");
{
  // Fall A — Clip 1 scheitert ⇒ failed, 0 Clips geliefert
  let job = createJobSnapshot({ id: "job-A", clipsTotal: 3, now: T0 });
  job = recordSubmit(job, 0, "p-0", T0);
  job = recordStatus(job, 0, "failed", T0 + 5_000, "provider_safety_block");
  const stepA = nextStep(job, T0 + 10_000);
  eq("Fall A: nächster Schritt ist 'stop'", stepA.kind, "stop");
  eq("Fall A: Zielzustand failed (kein Clip fertig)", stepA.kind === "stop" ? stepA.state : "", "failed");
  eq("Fall A: Grund ist der Anbieter-Code", stepA.kind === "stop" ? stepA.reason : "", "provider_safety_block");
  const stoppedA = recordStop(job, "failed", "provider_safety_block", T0 + 10_000);
  eq("Fall A: 0 gelieferte Clips", deliveredClipCount(stoppedA), 0);

  // Fall B — Clip 2 von 3 scheitert ⇒ partial, Clip 1 bleibt
  let jobB = createJobSnapshot({ id: "job-B", clipsTotal: 3, now: T0 });
  jobB = recordSubmit(jobB, 0, "p-0", T0);
  jobB = recordStatus(jobB, 0, "succeeded", T0 + 5_000);
  jobB = recordClipStored(jobB, 0, T0 + 6_000);
  jobB = recordSubmit(jobB, 1, "p-1", T0 + 7_000);
  jobB = recordStatus(jobB, 1, "failed", T0 + 12_000, "provider_timeout");
  const stepB = nextStep(jobB, T0 + 20_000);
  eq("Fall B: Zielzustand partial", stepB.kind === "stop" ? stepB.state : "", "partial");
  const stoppedB = recordStop(jobB, "partial", "provider_timeout", T0 + 20_000);
  eq("Fall B: Clip 1 bleibt geliefert", deliveredClipCount(stoppedB), 1);
  eq("Fall B: Clip 3 wurde NIE gestartet", stoppedB.clips[2].submits, 0);

  // Fall C — alle Clips fertig, Zusammenfügen scheitert ⇒ partial, Clips bleiben
  let jobC = createJobSnapshot({ id: "job-C", clipsTotal: 2, now: T0 });
  jobC = recordSubmit(jobC, 0, "p-0", T0);
  jobC = recordStatus(jobC, 0, "succeeded", T0 + 1_000);
  jobC = recordClipStored(jobC, 0, T0 + 2_000);
  jobC = recordSubmit(jobC, 1, "p-1", T0 + 3_000);
  jobC = recordStatus(jobC, 1, "succeeded", T0 + 4_000);
  jobC = recordClipStored(jobC, 1, T0 + 5_000);
  eq("Fall C: nach dem letzten Clip ⇒ stitching", jobC.state, "stitching");
  eq("Fall C: nächster Schritt ist 'stitch'", nextStep(jobC, T0 + 10_000).kind, "stitch");
  const partialC = recordStitchFailure(jobC, "stitch_failed", T0 + 10_000);
  eq("Fall C: Zustand partial", partialC.state, "partial");
  eq("Fall C: beide Clips bleiben", deliveredClipCount(partialC), 2);
  eq("Fall C: kein joinedVideoId", partialC.joinedVideoId, null);
}

// ── E. Lebensdauer und Poll-Budget (§4.5) ──────────────────────────────────
console.log("\n[E] Lebensdauer / Budgets");
{
  const job = createJobSnapshot({ id: "job-E", clipsTotal: 1, now: T0 });
  eq(`nicht abgelaufen nach ${VIDEO_JOB_MAX_MINUTES - 1} min`, isJobExpired(job, T0 + (VIDEO_JOB_MAX_MINUTES - 1) * 60_000), false);
  eq(`abgelaufen nach ${VIDEO_JOB_MAX_MINUTES + 1} min`, isJobExpired(job, T0 + (VIDEO_JOB_MAX_MINUTES + 1) * 60_000), true);
  eq("nextStep liefert 'expire'", nextStep(job, T0 + (VIDEO_JOB_MAX_MINUTES + 1) * 60_000).kind, "expire");
  const expired = recordExpired(job, T0 + (VIDEO_JOB_MAX_MINUTES + 1) * 60_000);
  eq("Zustand expired", expired.state, "expired");
  eq("expired ist terminal", claimForAdvance(expired, T0 + 10_000_000).claimed, false);

  let hanging = createJobSnapshot({ id: "job-H", clipsTotal: 1, now: T0 });
  hanging = recordSubmit(hanging, 0, "p-0", T0);
  let now = T0;
  for (let i = 0; i < VIDEO_MAX_POLLS_PER_CLIP; i += 1) {
    now += VIDEO_POLL_INTERVAL_MS;
    hanging = recordStatus(hanging, 0, "processing", now);
  }
  const overBudget = nextStep(hanging, now + VIDEO_POLL_INTERVAL_MS);
  eq("Poll-Budget erschöpft ⇒ stop", overBudget.kind, "stop");
  eq("… mit Grund poll_budget_exhausted", overBudget.kind === "stop" ? overBudget.reason : "", "poll_budget_exhausted");
}

// ── F. Credit-Semantik: die Kernregel ──────────────────────────────────────
console.log("\n[F] Credits — nur ein fertiges MP4 kostet");
eq("v2.5 turbo 10 s ⇒ 10 Credits (§9.7)", creditsForClip("kling-v2.5-turbo", 10), 10);
eq("v3 pro 10 s ⇒ 19 Credits (§9.7)", creditsForClip("kling-v3-pro", 10), 19);
eq("MiniMax h3-max 10 s ⇒ 4 Credits", creditsForClip("minimax-h3-max", 10), 4);
eq("MiniMax turbo 10 s ⇒ 2 Credits", creditsForClip("minimax-h3-max-turbo", 10), 2);
eq(
  "20 s Video (2 × 10 s, v2.5) ⇒ 20 Credits",
  quoteVideo("kling-v2.5-turbo", [{ index: 0, seconds: 10 }, { index: 1, seconds: 10 }]).credits,
  20,
);
eq(
  "30 s Video (3 × 10 s, v2.5) ⇒ 30 Credits = Pro-Kontingent",
  quoteVideo("kling-v2.5-turbo", [0, 1, 2].map((i) => ({ index: i, seconds: 10 }))).credits,
  VIDEO_CREDITS_PRO,
);
eq("Credit-Gegenwert ist 0,095 €", CREDIT_VALUE_EUR, 0.095);
eq(
  "10-s-v2.5-Clip kostet 0,62 € (belegt)",
  Math.round(clipCostMicros("kling-v2.5-turbo", 10) / 10_000) / 100,
  0.62,
);
throwsCode("unbekanntes Modell ⇒ unknown_model", () => creditsForClip("sora-2", 10), "unknown_model");

console.log("\n[F2] settleVideoJob — die Kernregel");
eq(
  "done MIT fertigem MP4 ⇒ volle Credits gebucht",
  settleVideoJob({ state: "done", joinedVideoId: "vid-1", quotedCredits: 30, deliveredClips: 3 }),
  { book: 30, release: 0, videosDone: 1, reason: "delivered" },
);
eq(
  "partial (Zusammenfügen gescheitert) ⇒ 0 Credits, alles frei",
  settleVideoJob({ state: "partial", joinedVideoId: null, quotedCredits: 30, deliveredClips: 3 }),
  { book: 0, release: 30, videosDone: 0, reason: "partial_clips_free" },
);
eq(
  "failed (Clip 1 gescheitert) ⇒ 0 Credits, alles frei",
  settleVideoJob({ state: "failed", joinedVideoId: null, quotedCredits: 30, deliveredClips: 0 }),
  { book: 0, release: 30, videosDone: 0, reason: "failed" },
);
eq(
  "expired ⇒ 0 Credits, alles frei",
  settleVideoJob({ state: "expired", joinedVideoId: null, quotedCredits: 20, deliveredClips: 1 }),
  { book: 0, release: 20, videosDone: 0, reason: "expired" },
);
eq(
  "stitching (noch nicht fertig) ⇒ noch nichts buchen, nichts freigeben",
  settleVideoJob({ state: "stitching", joinedVideoId: null, quotedCredits: 30, deliveredClips: 3 }),
  { book: 0, release: 0, videosDone: 0, reason: "not_yet" },
);
throwsCode(
  "done OHNE MP4 ⇒ fail-closed (done_without_video)",
  () => settleVideoJob({ state: "done", joinedVideoId: null, quotedCredits: 30, deliveredClips: 3 }),
  "done_without_video",
);
check(
  "Meldung bei partial sagt: keine Credits verbraucht",
  settlementMessage({ book: 0, release: 30, videosDone: 0, reason: "partial_clips_free" }, 3).includes(
    "keine Credits verbraucht",
  ),
);
check(
  "Meldung bei delivered nennt die Credit-Zahl",
  settlementMessage({ book: 30, release: 0, videosDone: 1, reason: "delivered" }, 3).includes("30 Credits"),
);

console.log("\n[F3] Deckel (§10.6) — Owner bekommt KEINE Kosten-Ausnahme");
eq("Free: 0 Credits (kein Video)", creditLimitFor("free"), VIDEO_CREDITS_FREE);
eq("Pro: 30 Credits", creditLimitFor("pro"), VIDEO_CREDITS_PRO);
eq("Owner: Zähler ausgesetzt", creditLimitFor("pro", true), Number.POSITIVE_INFINITY);
eq("Owner: Kostendeckel unverändert 3,00 €", costCapMicrosFor(true), VIDEO_MONTH_COST_CAP_MICROS);
eq("Owner = Nicht-Owner beim Kostendeckel", costCapMicrosFor(true), costCapMicrosFor(false));
eq("Clip-Deckel ist 0,80 €", VIDEO_CLIP_COST_CAP_MICROS, 800_000);
eq("v2.5 10 s liegt unter dem Clip-Deckel", (assertClipCostCap("kling-v2.5-turbo", 10), true), true);
throwsCode(
  "v3 pro 10 s (1,24 €) reißt den Clip-Deckel ⇒ clip_cost_cap",
  () => assertClipCostCap("kling-v3-pro", 10),
  "clip_cost_cap",
);
eq(
  "Reservierung im Rahmen ⇒ ok",
  canReserve({
    creditsUsed: 0,
    creditsReserved: 0,
    creditsWanted: 30,
    costMicrosUsed: 0,
    costMicrosReserved: 0,
    costMicrosWanted: 1_890_000,
    creditLimit: 30,
    costCapMicros: 3_000_000,
  }),
  { ok: true },
);
eq(
  "zweites Video im Monat ⇒ credit_limit",
  canReserve({
    creditsUsed: 30,
    creditsReserved: 0,
    creditsWanted: 30,
    costMicrosUsed: 1_890_000,
    costMicrosReserved: 0,
    costMicrosWanted: 1_890_000,
    creditLimit: 30,
    costCapMicros: 3_000_000,
  }).ok,
  false,
);
eq(
  "Owner mit ausgesetztem Zähler reißt TROTZDEM den Kostendeckel",
  canReserve({
    creditsUsed: 0,
    creditsReserved: 0,
    creditsWanted: 30,
    costMicrosUsed: 3_000_000,
    costMicrosReserved: 0,
    costMicrosWanted: 1_890_000,
    creditLimit: creditLimitFor("pro", true),
    costCapMicros: costCapMicrosFor(true),
  }),
  { ok: false, code: "cost_cap", remainingCredits: Number.POSITIVE_INFINITY },
);

// ── G. Zusammenspiel: Job + Credits ────────────────────────────────────────
console.log("\n[G] Zusammenspiel: Zustand → Buchung");
{
  const quote = quoteVideo("kling-v2.5-turbo", [
    { index: 0, seconds: 10 },
    { index: 1, seconds: 10 },
    { index: 2, seconds: 10 },
  ]);
  let job: VideoJobSnapshot = createJobSnapshot({ id: "job-G", clipsTotal: 3, now: T0 });
  eq("während planned: nichts gebucht", settleVideoJob({ state: job.state, joinedVideoId: job.joinedVideoId, quotedCredits: quote.credits, deliveredClips: deliveredClipCount(job) }).book, 0);
  job = recordSubmit(job, 0, "p-0", T0);
  job = recordStatus(job, 0, "succeeded", T0 + 1_000);
  job = recordClipStored(job, 0, T0 + 2_000);
  const afterClip1 = settleVideoJob({ state: job.state, joinedVideoId: job.joinedVideoId, quotedCredits: quote.credits, deliveredClips: deliveredClipCount(job) });
  eq("nach Clip 1 (ohne Gesamtergebnis): 0 Credits", afterClip1.book, 0);
  eq("… und keine Freigabe (läuft weiter)", afterClip1.release, 0);
  eq("… Meldung: noch nichts gebucht", settlementMessage(afterClip1, 1).includes("noch nichts gebucht"), true);
  const failedLater = recordStop(job, "partial", "provider_timeout", T0 + 3_000);
  const settled = settleVideoJob({ state: failedLater.state, joinedVideoId: failedLater.joinedVideoId, quotedCredits: quote.credits, deliveredClips: deliveredClipCount(failedLater) });
  eq("Abbruch nach Clip 1: 0 Credits verbraucht", settled.book, 0);
  eq("… Reservierung komplett frei", settled.release, quote.credits);
  eq("… 1 Clip bleibt kostenlos herunterladbar", deliveredClipCount(failedLater), 1);
}

// ── Ergebnis ───────────────────────────────────────────────────────────────
console.log(`\n— Ergebnis: ${pass} PASS, ${fail} FAIL —`);
if (fail > 0) {
  console.log("Fehlgeschlagen:");
  for (const f of failures) console.log("  · " + f);
  process.exit(1);
}
process.exit(0);
