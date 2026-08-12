// ── F10 Persönliche Lernschleife: deterministische Präferenz-Ableitung ───────
// Alles REGEL-basiert, kein LLM, null Kosten, immer ehrlich:
//   - Jedes Feedback-Signal (Like/Dislike auf ein Asset) wird MIT seiner
//     Klassifikation (Ton/Format/Kanal) gespeichert.
//   - Profile werden IMMER aus der vollständigen Signal-Liste aggregiert
//     (kein Drift durch Toggles): Like = +1, Dislike = -1 pro Dimension.
//   - Stichproben-Gate (>= 3 Signale): erst ab dem Gate wird eine Präferenz
//     ausgewiesen; zusätzlich braucht die dominante Dimension ein klares
//     Übergewicht (>= 2 Gewicht UND strikt größer als die zweite), damit nie
//     aus Rauschen eine Präferenz erfunden wird.

import type { UserPreferencesView } from '../types';
import type { FeedbackAssetEntry } from '../../db/queries';
import type { AssetClassification } from './classify';

export const MIN_FEEDBACK_SIGNALS = 3;
export const MIN_DOMINANT_WEIGHT = 2;
export const LEARN_RULE_VERSION = 1;
/** Oberes Limit der gespeicherten Signale (älteste fliegen raus). */
export const MAX_FEEDBACK_ENTRIES = 300;

/** Persistierbarer Präferenz-Zustand (entspricht einer user_preferences-Zeile). */
export interface StoredProfile {
  likes: number;
  dislikes: number;
  toneProfile: Record<string, number>;
  formatProfile: Record<string, number>;
  channelAffinity: Record<string, number>;
  feedbackAssets: FeedbackAssetEntry[];
  ruleVersion: number;
}

export function emptyStoredProfile(): StoredProfile {
  return {
    likes: 0,
    dislikes: 0,
    toneProfile: {},
    formatProfile: {},
    channelAffinity: {},
    feedbackAssets: [],
    ruleVersion: LEARN_RULE_VERSION,
  };
}

/** Rechne Profile vollständig aus der Signal-Liste (deterministisch, kein Drift). */
export function aggregate(entries: FeedbackAssetEntry[]): {
  likes: number;
  dislikes: number;
  toneProfile: Record<string, number>;
  formatProfile: Record<string, number>;
  channelAffinity: Record<string, number>;
} {
  const toneProfile: Record<string, number> = {};
  const formatProfile: Record<string, number> = {};
  const channelAffinity: Record<string, number> = {};
  let likes = 0;
  let dislikes = 0;
  for (const e of entries) {
    const dir = e.kind === 'like' ? 1 : -1;
    if (e.kind === 'like') likes++;
    else dislikes++;
    if (e.tone) toneProfile[e.tone] = (toneProfile[e.tone] ?? 0) + dir;
    if (e.format) formatProfile[e.format] = (formatProfile[e.format] ?? 0) + dir;
    if (e.channel) channelAffinity[e.channel] = (channelAffinity[e.channel] ?? 0) + dir;
  }
  return { likes, dislikes, toneProfile, formatProfile, channelAffinity };
}

/**
 * Wende EIN Feedback-Signal an: Dedupe je Asset (gleiches Kind → No-op,
 * anderes Kind → Toggle), sonst anhängen (mit Cap). Danach neu aggregieren.
 * Pure Funktion — speichert nichts.
 */
export function applyFeedback(
  prev: StoredProfile,
  signal: {
    assetId: string;
    kind: 'like' | 'dislike';
    classification: AssetClassification;
    reason?: string;
    ts: string;
  },
): { profile: StoredProfile; changed: boolean } {
  const entries = [...prev.feedbackAssets];
  const idx = entries.findIndex((e) => e.assetId === signal.assetId);
  if (idx >= 0) {
    if (entries[idx].kind === signal.kind) {
      // Gleiches Signal nochmal → kein Doppel-Zählen, Zustand unverändert.
      return { profile: prev, changed: false };
    }
    // Toggle: Kind flippen, gespeicherte Klassifikation bleibt stabil.
    entries[idx] = {
      ...entries[idx],
      kind: signal.kind,
      reason: signal.reason ?? entries[idx].reason,
      ts: signal.ts,
    };
  } else {
    entries.push({
      assetId: signal.assetId,
      kind: signal.kind,
      tone: signal.classification.tone,
      format: signal.classification.format,
      channel: signal.classification.channel,
      reason: signal.reason,
      ts: signal.ts,
    });
    // Cap: älteste Signale verwerfen, damit die Zeile nicht unendlich wächst.
    if (entries.length > MAX_FEEDBACK_ENTRIES) {
      entries.splice(0, entries.length - MAX_FEEDBACK_ENTRIES);
    }
  }
  const agg = aggregate(entries);
  return {
    profile: { ...prev, ...agg, feedbackAssets: entries },
    changed: true,
  };
}

/** Dominante Dimension: Gewicht >= MIN_DOMINANT_WEIGHT UND strikt vor dem Zweiten. */
function dominant(
  weights: Record<string, number>,
): string | null {
  let best: string | null = null;
  let bestW = 0;
  let secondW = 0;
  for (const [key, w] of Object.entries(weights)) {
    if (w > bestW) {
      secondW = bestW;
      bestW = w;
      best = key;
    } else if (w > secondW) {
      secondW = w;
    }
  }
  if (best == null || bestW < MIN_DOMINANT_WEIGHT || bestW <= secondW) return null;
  return best;
}

/** Leere View (nie throw, identischer Vertrag wie F9 emptyOverview). */
export function emptyView(): UserPreferencesView {
  return {
    likes: 0,
    dislikes: 0,
    totalSignals: 0,
    enoughData: false,
    needed: MIN_FEEDBACK_SIGNALS,
    preferredTone: null,
    preferredFormat: null,
    preferredChannel: null,
    toneProfile: {},
    formatProfile: {},
    channelAffinity: {},
    ruleVersion: LEARN_RULE_VERSION,
  };
}

/** Leite die öffentliche Präferenz-View aus dem gespeicherten Zustand ab. */
export function deriveView(profile: StoredProfile): UserPreferencesView {
  const totalSignals = profile.likes + profile.dislikes;
  const enoughData = totalSignals >= MIN_FEEDBACK_SIGNALS;
  // Präferenzen NUR ausweisen, wenn das Stichproben-Gate erreicht ist —
  // sonst würden 1–2 Signale schon steuern (Rauschen statt Muster).
  return {
    likes: profile.likes,
    dislikes: profile.dislikes,
    totalSignals,
    enoughData,
    needed: Math.max(0, MIN_FEEDBACK_SIGNALS - totalSignals),
    preferredTone: enoughData ? ((dominant(profile.toneProfile) as UserPreferencesView['preferredTone']) ?? null) : null,
    preferredFormat: enoughData ? ((dominant(profile.formatProfile) as UserPreferencesView['preferredFormat']) ?? null) : null,
    preferredChannel: enoughData ? dominant(profile.channelAffinity) : null,
    toneProfile: profile.toneProfile,
    formatProfile: profile.formatProfile,
    channelAffinity: profile.channelAffinity,
    ruleVersion: profile.ruleVersion,
  };
}

export type { UserPreferencesView };
