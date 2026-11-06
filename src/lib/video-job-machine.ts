/**
 * VIDEO-TESTUMGEBUNG (2026-11-06) — Zustandsmaschine des Video-Auftrags.
 *
 * Grundlage: `UMSETZUNGSPLAN.md` §4 (Job-Modell), §4.3 (Doppel-Submit),
 * §4.4 (Statusübergänge), §4.5 (verwaiste Aufträge), §10.5 (Teilfehler).
 *
 * ANTRIIEB: der CLIENT pollt eine ServerFn, die pro Aufruf GENAU EINEN Schritt
 * tut (Submit, Status prüfen, Ergebnis holen, nächsten Clip starten,
 * zusammenfügen). KEIN Cron, kein Webhook, kein Dauerläufer (§4.1).
 *
 * HARTE REGEL DIESER DATEI: keine DB, kein Netz, keine eigene Zeit — `now` wird
 * immer übergeben. Damit ist jeder Übergang ohne Timer und ohne Datenbank
 * prüfbar (und ein Test kann „10 Minuten später" in einem Mikrosekunden-Schritt
 * simulieren).
 */

export type VideoJobState =
  | 'planned'
  | 'running'
  | 'stitching'
  | 'done'
  | 'partial'
  | 'failed'
  | 'expired';

export type VideoClipState =
  | 'pending' // noch nicht gestartet
  | 'submitted' // Anbieter hat den Auftrag angenommen
  | 'processing' // Anbieter rechnet
  | 'succeeded' // Anbieter meldet fertig (Ergebnis noch nicht abgeholt)
  | 'stored' // Bytes liegen bei uns (Blob/DB) — zählt als „fertig"
  | 'failed';

/** §4.5: harte Lebensdauer eines Auftrags. */
export const VIDEO_JOB_MAX_MINUTES = 45;
/** Drosselung: der Client darf frühestens alle 5 s einen Schritt anfordern. */
export const VIDEO_POLL_INTERVAL_MS = 5_000;
/** Sperrfenster gegen parallele Requests auf denselben Auftrag. */
export const VIDEO_ADVANCE_LOCK_MS = 15_000;
/** Höchstens so viele Status-Abfragen pro Clip (10 min bei 5 s). */
export const VIDEO_MAX_POLLS_PER_CLIP = 120;
/** §2.4: GENAU EIN Anbieter-Aufruf pro Clip und Bestätigung — kein Auto-Retry. */
export const VIDEO_MAX_SUBMITS_PER_CLIP = 1;

export interface VideoClipProgress {
  state: VideoClipState;
  providerJobId: string | null;
  submits: number;
  polls: number;
  errorCode: string | null;
}

export interface VideoJobSnapshot {
  id: string;
  state: VideoJobState;
  clips: VideoClipProgress[];
  /** ms seit Epoche — injiziert, nie aus der Systemuhr gelesen. */
  createdAt: number;
  updatedAt: number;
  /** Zeitpunkt des letzten `advance` (Drosselung + Sperrfenster). */
  lastAdvanceAt: number | null;
  joinedVideoId: string | null;
  errorCode: string | null;
}

export class VideoJobTransitionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'VideoJobTransitionError';
    this.code = code;
  }
}

// ── Übergänge (§4.4) ─────────────────────────────────────────────────────────
const TRANSITIONS: Record<VideoJobState, VideoJobState[]> = {
  planned: ['running', 'expired'],
  running: ['running', 'stitching', 'partial', 'failed', 'expired'],
  stitching: ['stitching', 'done', 'partial', 'failed', 'expired'],
  done: [],
  partial: [],
  failed: [],
  expired: [],
};

export const TERMINAL_JOB_STATES: readonly VideoJobState[] = ['done', 'partial', 'failed', 'expired'];

export function isTerminalJobState(state: VideoJobState): boolean {
  return TERMINAL_JOB_STATES.includes(state);
}

export function canTransition(from: VideoJobState, to: VideoJobState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Erzeugt einen neuen Auftrag im Zustand `planned` (§4.4 Zeile 1). */
export function createJobSnapshot(input: {
  id: string;
  clipsTotal: number;
  now: number;
}): VideoJobSnapshot {
  if (!Number.isInteger(input.clipsTotal) || input.clipsTotal < 1 || input.clipsTotal > 3) {
    throw new VideoJobTransitionError('invalid_clips_total', `clipsTotal=${input.clipsTotal} ist nicht 1..3`);
  }
  return {
    id: input.id,
    state: 'planned',
    clips: Array.from({ length: input.clipsTotal }, () => ({
      state: 'pending' as VideoClipState,
      providerJobId: null,
      submits: 0,
      polls: 0,
      errorCode: null,
    })),
    createdAt: input.now,
    updatedAt: input.now,
    lastAdvanceAt: null,
    joinedVideoId: null,
    errorCode: null,
  };
}

function withState(
  snapshot: VideoJobSnapshot,
  to: VideoJobState,
  now: number,
  patch: Partial<VideoJobSnapshot> = {},
): VideoJobSnapshot {
  if (snapshot.state !== to && !canTransition(snapshot.state, to)) {
    throw new VideoJobTransitionError(
      'invalid_transition',
      `Übergang ${snapshot.state} → ${to} ist nicht erlaubt`,
    );
  }
  return { ...snapshot, ...patch, state: to, updatedAt: now };
}

// ── Abbruch-/Retry-Grenzen ───────────────────────────────────────────────────

/** §4.5: Lebensdauer überschritten? */
export function isJobExpired(snapshot: VideoJobSnapshot, now: number): boolean {
  return now - snapshot.createdAt > VIDEO_JOB_MAX_MINUTES * 60_000;
}

/**
 * Drosselung: darf jetzt ein Schritt laufen?
 * Gibt `retryInMs = 0` zurück, wenn ja.
 */
export function pollThrottle(snapshot: VideoJobSnapshot, now: number): { allowed: boolean; retryInMs: number } {
  if (snapshot.lastAdvanceAt === null) return { allowed: true, retryInMs: 0 };
  const elapsed = now - snapshot.lastAdvanceAt;
  if (elapsed >= VIDEO_POLL_INTERVAL_MS) return { allowed: true, retryInMs: 0 };
  return { allowed: false, retryInMs: VIDEO_POLL_INTERVAL_MS - elapsed };
}

/**
 * Doppel-Submit-Sperre auf Logikebene (§4.3): ein zweiter paralleler Request
 * innerhalb des Sperrfensters darf NICHTS tun. Die zweite Ebene ist der
 * DB-Lock (`UPDATE … WHERE status='planned'`, siehe `src/db/video.ts`).
 */
export function claimForAdvance(
  snapshot: VideoJobSnapshot,
  now: number,
): { claimed: true } | { claimed: false; reason: 'terminal' | 'locked'; retryInMs: number } {
  if (isTerminalJobState(snapshot.state)) {
    return { claimed: false, reason: 'terminal', retryInMs: 0 };
  }
  if (snapshot.lastAdvanceAt !== null && now - snapshot.lastAdvanceAt < VIDEO_ADVANCE_LOCK_MS) {
    return { claimed: false, reason: 'locked', retryInMs: VIDEO_ADVANCE_LOCK_MS - (now - snapshot.lastAdvanceAt) };
  }
  return { claimed: true };
}

// ── Der nächste Schritt ──────────────────────────────────────────────────────
export type VideoAdvanceStep =
  | { kind: 'expire' }
  | { kind: 'throttled'; retryInMs: number }
  | { kind: 'stop'; state: 'failed' | 'partial'; reason: string }
  | { kind: 'submit'; clipIndex: number }
  | { kind: 'poll'; clipIndex: number; providerJobId: string }
  | { kind: 'fetch'; clipIndex: number; providerJobId: string }
  | { kind: 'stitch' }
  | { kind: 'complete' };

/**
 * Bestimmt GENAU EINEN nächsten Schritt. Reihenfolge ist Teil des Vertrags:
 * 1. Lebensdauer, 2. Drosselung, 3. erster offener Clip von links,
 * 4. Zusammenfügen, 5. fertig.
 */
export function nextStep(snapshot: VideoJobSnapshot, now: number): VideoAdvanceStep {
  if (isJobExpired(snapshot, now)) return { kind: 'expire' };
  if (isTerminalJobState(snapshot.state)) {
    // `done` ist kein Abbruch: der Auftrag ist fertig, es gibt nichts mehr zu tun.
    if (snapshot.state === 'done') return { kind: 'complete' };
    return {
      kind: 'stop',
      state: snapshot.state === 'partial' ? 'partial' : 'failed',
      reason: 'terminal',
    };
  }
  const throttle = pollThrottle(snapshot, now);
  if (!throttle.allowed) return { kind: 'throttled', retryInMs: throttle.retryInMs };

  for (let i = 0; i < snapshot.clips.length; i += 1) {
    const clip = snapshot.clips[i];
    switch (clip.state) {
      case 'pending':
        // §2.4: kein zweiter Submit. Ist das Budget aufgebraucht, ist der Clip
        // endgültig gescheitert — kein stiller Auto-Retry.
        if (clip.submits >= VIDEO_MAX_SUBMITS_PER_CLIP) {
          return { kind: 'stop', state: snapshot.clips.some((c) => c.state === 'stored') ? 'partial' : 'failed', reason: 'retry_budget_exhausted' };
        }
        return { kind: 'submit', clipIndex: i };
      case 'submitted':
      case 'processing':
        if (clip.polls >= VIDEO_MAX_POLLS_PER_CLIP) {
          return { kind: 'stop', state: snapshot.clips.some((c) => c.state === 'stored') ? 'partial' : 'failed', reason: 'poll_budget_exhausted' };
        }
        if (!clip.providerJobId) {
          return { kind: 'stop', state: snapshot.clips.some((c) => c.state === 'stored') ? 'partial' : 'failed', reason: 'missing_provider_job_id' };
        }
        return { kind: 'poll', clipIndex: i, providerJobId: clip.providerJobId };
      case 'succeeded':
        if (!clip.providerJobId) {
          return { kind: 'stop', state: snapshot.clips.some((c) => c.state === 'stored') ? 'partial' : 'failed', reason: 'missing_provider_job_id' };
        }
        return { kind: 'fetch', clipIndex: i, providerJobId: clip.providerJobId };
      case 'failed':
        // §10.5: Kette stoppt SOFORT. Nichts wird weiter aufgerufen.
        return {
          kind: 'stop',
          state: snapshot.clips.some((c) => c.state === 'stored') ? 'partial' : 'failed',
          reason: clip.errorCode ?? 'clip_failed',
        };
      case 'stored':
        continue;
      default:
        return { kind: 'stop', state: 'failed', reason: `unknown_clip_state:${String(clip.state)}` };
    }
  }

  if (snapshot.clips.every((c) => c.state === 'stored')) {
    return snapshot.joinedVideoId ? { kind: 'complete' } : { kind: 'stitch' };
  }
  return { kind: 'stop', state: 'failed', reason: 'no_progress_possible' };
}

// ── Ereignisse (jeweils EIN Schritt) ────────────────────────────────────────

/** Ein Anbieter-Aufruf wurde gemacht. Zweiter Submit ⇒ Fehler (Budget 1). */
export function recordSubmit(
  snapshot: VideoJobSnapshot,
  clipIndex: number,
  providerJobId: string,
  now: number,
): VideoJobSnapshot {
  const clip = snapshot.clips[clipIndex];
  if (!clip) throw new VideoJobTransitionError('unknown_clip', `Clip ${clipIndex} existiert nicht`);
  if (clip.submits >= VIDEO_MAX_SUBMITS_PER_CLIP) {
    throw new VideoJobTransitionError(
      'retry_budget_exhausted',
      `Clip ${clipIndex} wurde bereits ${clip.submits}× gestartet — kein automatischer Zweitversuch (§2.4)`,
    );
  }
  const clips = snapshot.clips.map((c, i) =>
    i === clipIndex
      ? { ...c, state: 'submitted' as VideoClipState, providerJobId, submits: c.submits + 1, errorCode: null }
      : c,
  );
  const state: VideoJobState = snapshot.state === 'planned' ? 'running' : snapshot.state;
  return withState(snapshot, state, now, { clips, lastAdvanceAt: now });
}

/** Ergebnis einer Status-Abfrage. */
export function recordStatus(
  snapshot: VideoJobSnapshot,
  clipIndex: number,
  status: 'submitted' | 'processing' | 'succeeded' | 'failed',
  now: number,
  errorCode: string | null = null,
): VideoJobSnapshot {
  const clip = snapshot.clips[clipIndex];
  if (!clip) throw new VideoJobTransitionError('unknown_clip', `Clip ${clipIndex} existiert nicht`);
  const nextClip: VideoClipProgress =
    status === 'failed'
      ? { ...clip, state: 'failed', polls: clip.polls + 1, errorCode: errorCode ?? 'provider_failed' }
      : {
          ...clip,
          state: status === 'succeeded' ? 'succeeded' : status,
          polls: clip.polls + 1,
          errorCode: null,
        };
  const clips = snapshot.clips.map((c, i) => (i === clipIndex ? nextClip : c));
  return withState(snapshot, snapshot.state === 'planned' ? 'running' : snapshot.state, now, {
    clips,
    lastAdvanceAt: now,
  });
}

/** Ergebnis-Bytes liegen bei uns (Blob/DB-Zeile geschrieben). */
export function recordClipStored(snapshot: VideoJobSnapshot, clipIndex: number, now: number): VideoJobSnapshot {
  const clip = snapshot.clips[clipIndex];
  if (!clip) throw new VideoJobTransitionError('unknown_clip', `Clip ${clipIndex} existiert nicht`);
  if (clip.state !== 'succeeded' && clip.state !== 'stored') {
    throw new VideoJobTransitionError(
      'clip_not_ready',
      `Clip ${clipIndex} ist im Zustand ${clip.state} — Bytes dürfen nicht gespeichert werden`,
    );
  }
  const clips = snapshot.clips.map((c, i) => (i === clipIndex ? { ...c, state: 'stored' as VideoClipState } : c));
  const allStored = clips.every((c) => c.state === 'stored');
  const state: VideoJobState = allStored && snapshot.state === 'running' ? 'stitching' : snapshot.state;
  return withState(snapshot, state, now, { clips, lastAdvanceAt: now });
}

/** Zusammenfügen erfolgreich ⇒ das fertige MP4 existiert. */
export function recordJoined(snapshot: VideoJobSnapshot, joinedVideoId: string, now: number): VideoJobSnapshot {
  if (!joinedVideoId) throw new VideoJobTransitionError('missing_video_id', 'joinedVideoId fehlt');
  return withState(snapshot, 'done', now, { joinedVideoId, lastAdvanceAt: now });
}

/**
 * Zusammenfügen gescheitert ⇒ `partial`: die Clips bleiben, „Zusammensetzen"
 * ist kostenlos wiederholbar (§10.5 Fall C, §7.6).
 */
export function recordStitchFailure(snapshot: VideoJobSnapshot, reason: string, now: number): VideoJobSnapshot {
  return withState(snapshot, 'partial', now, { errorCode: reason, lastAdvanceAt: now });
}

/** Kette stoppen (Clip gescheitert / Budget erschöpft). */
export function recordStop(
  snapshot: VideoJobSnapshot,
  state: 'failed' | 'partial',
  reason: string,
  now: number,
): VideoJobSnapshot {
  return withState(snapshot, state, now, { errorCode: reason, lastAdvanceAt: now });
}

/** Lebensdauer abgelaufen ⇒ `expired` (§4.5). */
export function recordExpired(snapshot: VideoJobSnapshot, now: number): VideoJobSnapshot {
  return withState(snapshot, 'expired', now, { errorCode: 'expired', lastAdvanceAt: now });
}

/** Wie viele Clips sind fertig geliefert? (Grundlage der Credit-Buchung) */
export function deliveredClipCount(snapshot: VideoJobSnapshot): number {
  return snapshot.clips.filter((c) => c.state === 'stored').length;
}
