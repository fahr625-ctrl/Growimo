/**
 * VIDEO-TESTUMGEBUNG (2026-11-06) — Credit-Semantik (reine Funktionen).
 *
 * KERNREGEL (Owner-Entscheidung, Business Plan + `UMSETZUNGSPLAN.md` Phase 11):
 *   „ein Credit wird nur verbraucht, wenn ein fertiges MP4 bereitsteht;
 *    fertige Einzelclips bleiben kostenlos; kein Credit-Verlust bei
 *    unbrauchbarem Gesamtergebnis."
 *
 * Daraus folgt hier (und NUR das):
 *   · reserviert wird das GANZE Video vor dem ersten Anbieter-Aufruf (§10.3),
 *   · gebucht wird ausschließlich bei `done` **und** vorhandenem fertigen MP4,
 *   · `partial`, `failed`, `expired` und ein bloßes `stitching` ⇒ 0 Credits,
 *     die Reservierung wird vollständig freigegeben,
 *   · Einzelclips kosten nichts (kein Credit pro Clip — anders als die
 *     Teilbuchung in §10.5 des Plans, die der Owner mit dieser Regel ersetzt hat).
 *
 * Keine DB, kein Netz, keine Zeit. Preise sind die BELEGTEN Zahlen aus §9.1
 * (fal-Preisblatt) und §9.7 (Credit-Rechnung).
 */

/** Euro je US-Dollar — belegter EZB-Kurs aus §9.1. */
export const EUR_PER_USD = 0.8876;
/** Gegenwert eines Credits in Euro (19 € / 200 Generierungen, §9.7). */
export const CREDIT_VALUE_EUR = 0.095;
/** Marge-Faktor der Credit-Rechnung (§9.7, Annahme). */
export const CREDIT_MARGIN = 1.4;

/** Belegte Sekundenpreise (USD) je Modell — `TARIFE-UND-KOSTEN.md` / §9.1. */
export const VIDEO_MODEL_PRICES_USD_PER_SECOND: Record<string, number> = {
  'kling-v3-pro': 0.14,
  'kling-v2.5-turbo': 0.07,
  'minimax-h3-max': 0.03,
  'minimax-h3-max-turbo': 0.015,
};

/** Owner-Deckel (§10.6) — bewusst Konstanten, keine Env-Werte. */
export const VIDEO_CLIP_COST_CAP_MICROS = 800_000; // 0,80 € pro Clip
export const VIDEO_MONTH_COST_CAP_MICROS = 3_000_000; // 3,00 € pro Nutzer und Monat
export const VIDEO_CREDITS_PRO = 30; // 30 Credits = ein vollständiges 30-s-Video
export const VIDEO_CREDITS_FREE = 0; // Free bekommt KEIN Video (feste Regel)
export const VIDEO_MAX_PER_DAY = 1;

export class VideoCreditError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'VideoCreditError';
    this.code = code;
  }
}

/** Kosten eines Clips in Euro (ungerundet). */
export function clipCostEur(model: string, seconds: number): number {
  const usd = VIDEO_MODEL_PRICES_USD_PER_SECOND[model];
  if (usd === undefined) {
    throw new VideoCreditError('unknown_model', `Unbekanntes Video-Modell: ${model}`);
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new VideoCreditError('invalid_seconds', `Ungültige Clip-Dauer: ${seconds}`);
  }
  return usd * seconds * EUR_PER_USD;
}

/** Kosten eines Clips in Micro-Euro (für die DB-Spalten `cost_*_micros`). */
export function clipCostMicros(model: string, seconds: number): number {
  return Math.round(clipCostEur(model, seconds) * 1_000_000);
}

/**
 * Credits für EINEN Clip: `ceil(Kosten / 0,095 € × 1,4)` (§9.7).
 * Belegt: v2.5 turbo 10 s ⇒ 10 Credits · v3 pro 10 s ⇒ 19 Credits.
 */
export function creditsForClip(model: string, seconds: number): number {
  const cost = clipCostEur(model, seconds);
  return Math.max(1, Math.ceil((cost / CREDIT_VALUE_EUR) * CREDIT_MARGIN));
}

export interface VideoCreditQuote {
  credits: number;
  costEstimateMicros: number;
  perClip: { index: number; seconds: number; credits: number; costMicros: number }[];
}

/** Angebot für ein ganzes Video (Summe der Clips) — Grundlage des Dialogs. */
export function quoteVideo(model: string, clips: { index: number; seconds: number }[]): VideoCreditQuote {
  const perClip = clips.map((c) => ({
    index: c.index,
    seconds: c.seconds,
    credits: creditsForClip(model, c.seconds),
    costMicros: clipCostMicros(model, c.seconds),
  }));
  return {
    credits: perClip.reduce((a, c) => a + c.credits, 0),
    costEstimateMicros: perClip.reduce((a, c) => a + c.costMicros, 0),
    perClip,
  };
}

/**
 * Tor 4 (§10.4): teurer als 0,80 € pro Clip ⇒ gar nicht erst starten.
 * Gilt OHNE Ausnahme — auch für den Owner (kein `isAdminOverride` hier).
 */
export function assertClipCostCap(model: string, seconds: number): void {
  const micros = clipCostMicros(model, seconds);
  if (micros > VIDEO_CLIP_COST_CAP_MICROS) {
    throw new VideoCreditError(
      'clip_cost_cap',
      `Clip ${seconds}s mit ${model} kostet ${(micros / 1_000_000).toFixed(2)} € — über dem Deckel von 0,80 €`,
    );
  }
}

/**
 * Credit-Limit je Tarif. Der Owner hat KEINE Ausnahme beim Kostendeckel,
 * wohl aber beim Zähler (§10.4).
 */
export function creditLimitFor(tier: 'free' | 'pro' | 'video' | 'video_plus', isOwner = false): number {
  if (tier === 'free') return VIDEO_CREDITS_FREE;
  return isOwner ? Number.POSITIVE_INFINITY : VIDEO_CREDITS_PRO;
}

/** Kostendeckel je Nutzer und Monat — der Owner bekommt hier KEINE Ausnahme. */
export function costCapMicrosFor(_isOwner = false): number {
  return VIDEO_MONTH_COST_CAP_MICROS;
}

/** Darf eine Reservierung überhaupt versucht werden? (Tor 5, §10.4) */
export function canReserve(input: {
  creditsUsed: number;
  creditsReserved: number;
  creditsWanted: number;
  costMicrosUsed: number;
  costMicrosReserved: number;
  costMicrosWanted: number;
  creditLimit: number;
  costCapMicros: number;
}): { ok: true } | { ok: false; code: 'credit_limit' | 'cost_cap'; remainingCredits: number } {
  const remainingCredits = Math.max(0, input.creditLimit - input.creditsUsed - input.creditsReserved);
  if (input.creditsUsed + input.creditsReserved + input.creditsWanted > input.creditLimit) {
    return { ok: false, code: 'credit_limit', remainingCredits };
  }
  if (input.costMicrosUsed + input.costMicrosReserved + input.costMicrosWanted > input.costCapMicros) {
    return { ok: false, code: 'cost_cap', remainingCredits };
  }
  return { ok: true };
}

// ── Die Kernregel: wann wird gebucht? ────────────────────────────────────────
export type VideoJobSettlementState = 'planned' | 'running' | 'stitching' | 'done' | 'partial' | 'failed' | 'expired';

export interface VideoSettlement {
  /** Credits, die jetzt endgültig verbraucht werden. */
  book: number;
  /** Credits, deren Reservierung freigegeben wird. */
  release: number;
  /** Zähler „fertige Videos" (nur bei `done`). */
  videosDone: number;
  /** Kurzschlüssel für Log/UI. */
  reason: 'delivered' | 'partial_clips_free' | 'failed' | 'expired' | 'not_yet';
}

/**
 * DIE Kernregel in einer Funktion.
 *
 * Gebucht wird NUR, wenn der Auftrag `done` ist **und** ein fertiges
 * zusammengefügtes MP4 existiert. Ein `done` ohne MP4 ist ein Programmierfehler
 * (fail-closed: es wird nichts gebucht und nichts freigegeben — der Aufrufer
 * muss den Zustand reparieren).
 */
export function settleVideoJob(input: {
  state: VideoJobSettlementState;
  joinedVideoId: string | null;
  quotedCredits: number;
  deliveredClips: number;
}): VideoSettlement {
  const { state, joinedVideoId, quotedCredits } = input;
  if (!Number.isInteger(quotedCredits) || quotedCredits < 0) {
    throw new VideoCreditError('invalid_credits', `quotedCredits=${quotedCredits}`);
  }
  if (state === 'done') {
    if (!joinedVideoId) {
      throw new VideoCreditError(
        'done_without_video',
        'Zustand done ohne fertiges MP4 — es wird nichts gebucht (fail-closed)',
      );
    }
    return { book: quotedCredits, release: 0, videosDone: 1, reason: 'delivered' };
  }
  if (state === 'partial') {
    // Clips sind geliefert, aber es gibt kein brauchbares Gesamtergebnis
    // ⇒ 0 Credits (Owner-Regel), Reservierung komplett frei.
    return { book: 0, release: quotedCredits, videosDone: 0, reason: 'partial_clips_free' };
  }
  if (state === 'failed' || state === 'expired') {
    return { book: 0, release: quotedCredits, videosDone: 0, reason: state };
  }
  return { book: 0, release: 0, videosDone: 0, reason: 'not_yet' };
}

/** Kurztext für den Dialog (§10.5) — ohne erfundene Zahlen. */
export function settlementMessage(settlement: VideoSettlement, deliveredClips: number): string {
  switch (settlement.reason) {
    case 'delivered':
      return `Dein Video ist fertig. ${settlement.book} Credits wurden verbraucht.`;
    case 'partial_clips_free':
      return `Dein Video konnte nicht fertiggestellt werden. ${deliveredClips} Clip(s) sind fertig und kostenlos herunterladbar — es wurden keine Credits verbraucht.`;
    case 'failed':
      return 'Die Erstellung ist gescheitert. Es wurden keine Credits verbraucht.';
    case 'expired':
      return 'Der Auftrag ist abgelaufen. Es wurden keine Credits verbraucht.';
    default:
      return 'Der Auftrag läuft noch — es wurde noch nichts gebucht.';
  }
}
