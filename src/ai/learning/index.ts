// ── F10 Persönliche Lernschleife: öffentliche API ────────────────────────────
// Deterministisch (kein LLM, null Kosten), immer ehrlich: ohne Mindest-Stichprobe
// (>= 3 Signale) wird keine Präferenz ausgewiesen — Stichproben-Gate wie F9.
// recordFeedback() speichert Like/Dislike je Asset (Dedupe) und leitet daraus
// das Präferenz-Profil ab; buildLearningProfile() ist die Server-Assembly für
// Dashboard UND Generation-Loop; buildLearningContext() erzeugt den
// Kontext-Block für zukünftige Generierungen (Paket + QuickGenerator).

import type { UserPreferencesView } from '../types';
import type { FeedbackAssetEntry } from '../../db/queries';
import { classifyAsset } from './classify';
import type { AssetClassification } from './classify';
import {
  emptyStoredProfile,
  applyFeedback,
  deriveView,
  emptyView,
  LEARN_RULE_VERSION,
  MIN_FEEDBACK_SIGNALS,
  MIN_DOMINANT_WEIGHT,
  MAX_FEEDBACK_ENTRIES,
  type StoredProfile,
} from './profile';

export { buildLearningContext } from './context';
export type { LearnLang } from './wording';

/** Map a stored DB row to the internal StoredProfile shape. */
function rowToProfile(row: {
  likes: number;
  dislikes: number;
  toneProfile: Record<string, number>;
  formatProfile: Record<string, number>;
  channelAffinity: Record<string, number>;
  feedbackAssets: FeedbackAssetEntry[];
  ruleVersion: number;
} | null): StoredProfile {
  if (!row) return emptyStoredProfile();
  return {
    likes: row.likes,
    dislikes: row.dislikes,
    toneProfile: row.toneProfile ?? {},
    formatProfile: row.formatProfile ?? {},
    channelAffinity: row.channelAffinity ?? {},
    feedbackAssets: row.feedbackAssets ?? [],
    ruleVersion: row.ruleVersion ?? LEARN_RULE_VERSION,
  };
}

export interface RecordFeedbackOptions {
  reason?: string;
  /** Asset-Snapshot für die Klassifikation (Ton/Format/Kanal). */
  title?: string;
  body?: string;
  channel?: string;
}

/**
 * Speichert EIN Feedback-Signal (Like/Dislike) für ein Asset und liefert die
 * aktualisierte Präferenz-View. Nie throw — bei Fehlern null. Die
 * Klassifikation erfolgt aus dem übergebenen Asset-Snapshot (kein DB-Lookup,
 * damit auch frische, noch nicht gespeicherte Inhalte bewertet werden können).
 */
export async function recordFeedback(
  userId: string,
  assetId: string,
  kind: 'like' | 'dislike',
  opts: RecordFeedbackOptions = {},
): Promise<UserPreferencesView | null> {
  try {
    const { qGetUserPreferences, qSaveUserPreferences } = await import('../../db/queries');
    const current = await qGetUserPreferences(userId);
    const profile = rowToProfile(current);
    const classification: AssetClassification = classifyAsset({
      title: opts.title,
      body: opts.body,
      channel: opts.channel ?? '',
    });
    const { profile: next, changed } = applyFeedback(profile, {
      assetId,
      kind,
      classification,
      reason: opts.reason,
      ts: new Date().toISOString(),
    });
    if (!changed) return deriveView(profile);
    await qSaveUserPreferences(userId, next);
    return deriveView(next);
  } catch (err) {
    console.error('[learning] recordFeedback failed:', err);
    return null;
  }
}

/**
 * Server-seitige Assembly: gespeicherte Signale → abgeleitete Präferenz-View.
 * Nie throw (leere View bei Fehlern/keinen Daten). Gemeinsamer Kern für
 * getPreferencesServer (Dashboard) UND den Generation-Loop (Paket +
 * QuickGenerator).
 */
export async function buildLearningProfile(
  userId: string,
): Promise<UserPreferencesView> {
  try {
    const { qGetUserPreferences } = await import('../../db/queries');
    const row = await qGetUserPreferences(userId);
    if (!row) return emptyView();
    return deriveView(rowToProfile(row));
  } catch (err) {
    console.error('[learning] buildLearningProfile failed — returning empty view:', err);
    return emptyView();
  }
}

/** Setzt die Präferenzen des Nutzers zurück (Zeile löschen). */
export async function resetPreferences(userId: string): Promise<boolean> {
  try {
    const { qResetUserPreferences } = await import('../../db/queries');
    return await qResetUserPreferences(userId);
  } catch (err) {
    console.error('[learning] resetPreferences failed:', err);
    return false;
  }
}

export { MIN_FEEDBACK_SIGNALS, MIN_DOMINANT_WEIGHT, MAX_FEEDBACK_ENTRIES };
