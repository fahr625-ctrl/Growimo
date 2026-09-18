/**
 * Phase 3 (Stabilisierung) — Ergebnis-Persistenz der TikTok-Werkstatt.
 *
 * Ursache C5: Das TikTok-Ergebnis lebte NUR im React-State
 * (`routes/app/tiktok.tsx`). Jeder Bereichswechsel, jedes Browser-„Zurück“
 * und jeder Reload verwarf es — bei dem von Phase 3 geforderten Workflow
 * („TikTok erstellen → Bild-Studio → Bild erzeugen → zurück → nächstes Bild“)
 * musste der Nutzer die TikTok-Generierung dadurch erneut bezahlen.
 *
 * Lösung (KISS, bewusst KEINE DB-Persistenz): eine Kopie des letzten
 * Ergebnisses in `sessionStorage` — pro Tab/Session flüchtig, klein
 * (Text im KB-Bereich; Bild-Daten-URLs werden NICHT persistiert),
 * mit Versionsfeld + TTL, damit alte/defekte Einträge nie crashen.
 *
 * Reine, testbare Funktionen (sessionStorage-Zugriffe gekapselt).
 */
import type { TikTokMode, TikTokResult } from '~/ai/tiktok';

/** sessionStorage-Schlüssel des zuletzt erzeugten TikTok-Ergebnisses. */
export const TIKTOK_RESULT_KEY = 'growimo_tiktok_last_result';
/** Format-Version — ein fremder/alter Eintrag wird ignoriert statt interpretiert. */
export const TIKTOK_RESULT_VERSION = 1;
/** TTL: 12 h. sessionStorage ist ohnehin pro Tab flüchtig; die TTL schützt
 *  zusätzlich gegen extrem lange offene Tabs und veraltete Ergebnisse. */
export const TIKTOK_RESULT_TTL_MS = 12 * 60 * 60 * 1000;

export interface StoredTikTokResult {
  version: number;
  mode: TikTokMode;
  result: TikTokResult;
  savedAt: number;
}

const MODES: TikTokMode[] = ['todayIdea', 'concept', 'diagnose'];

/** Serialisiert das Ergebnis versioniert (reine Funktion, testbar). */
export function serializeTikTokResult(
  mode: TikTokMode,
  result: TikTokResult,
  now: number = Date.now(),
): string {
  const payload: StoredTikTokResult = { version: TIKTOK_RESULT_VERSION, mode, result, savedAt: now };
  return JSON.stringify(payload);
}

/**
 * Liest + validiert einen gespeicherten Eintrag. Gibt null zurück bei
 * fehlendem/defektem Eintrag, falscher Version, unbekanntem Modus, leerem
 * Ergebnis oder abgelaufener TTL — der Aufrufer fällt dann auf den
 * normalen (leeren) Startzustand zurück, nie auf einen Crash.
 */
export function parseTikTokResult(
  raw: string | null,
  now: number = Date.now(),
  ttlMs: number = TIKTOK_RESULT_TTL_MS,
): { mode: TikTokMode; result: TikTokResult } | null {
  if (!raw) return null;
  let parsed: Partial<StoredTikTokResult>;
  try {
    parsed = JSON.parse(raw) as Partial<StoredTikTokResult>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.version !== TIKTOK_RESULT_VERSION) return null;
  const mode = parsed.mode;
  if (typeof mode !== 'string' || !MODES.includes(mode as TikTokMode)) return null;
  if (typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt)) return null;
  if (Number.isFinite(ttlMs) && ttlMs > 0 && now - parsed.savedAt > ttlMs) return null;
  const result = parsed.result;
  if (!result || typeof result !== 'object') return null;
  if (typeof (result as { mode?: unknown }).mode !== 'string') return null;
  return { mode: mode as TikTokMode, result };
}

/** Schreibt das Ergebnis in den sessionStorage (nie blockierend). */
export function saveTikTokResult(mode: TikTokMode, result: TikTokResult, now: number = Date.now()): void {
  try {
    sessionStorage.setItem(TIKTOK_RESULT_KEY, serializeTikTokResult(mode, result, now));
  } catch {
    /* sessionStorage nicht verfügbar (Privacy-Modus) — Ergebnis bleibt im State */
  }
}

/** Liest das gespeicherte Ergebnis (null = nichts Brauchbares da). */
export function readTikTokResult(
  now: number = Date.now(),
): { mode: TikTokMode; result: TikTokResult } | null {
  try {
    return parseTikTokResult(sessionStorage.getItem(TIKTOK_RESULT_KEY), now);
  } catch {
    return null;
  }
}

/** Entfernt den gespeicherten Eintrag (bewusster „Neue Session“-Klick). */
export function clearTikTokResult(): void {
  try {
    sessionStorage.removeItem(TIKTOK_RESULT_KEY);
  } catch {
    /* sessionStorage nicht verfügbar */
  }
}
