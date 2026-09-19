/**
 * Phase 4.1 (C6/A7) — Navigation/History deterministisch machen.
 *
 * Zwei konkrete Probleme, die hier gelöst werden:
 *
 * 1. **Reload / Browser-Zurück nach einem Vollseiten-Reload:** Das Beta-Gate in
 *    `routes/app.tsx` startet immer im Zustand `checking` und zeigt so lange
 *    „Lädt...“, obwohl derselbe Nutzer Sekunden vorher schon freigeschaltet war.
 *    Der zuletzt bestätigte Zustand (`approved`) wird deshalb kurzzeitig in
 *    `sessionStorage` gespiegelt (`BETA_ACCESS_CACHE_TTL_MS`), damit ein Reload
 *    oder ein Zurück-Sprung sofort die App zeigt statt eines Spinners.
 *
 * 2. **bfcache-Rückkehr (`pageshow` mit `persisted === true`):** Kommt die Seite
 *    aus dem Back/Forward-Cache zurück, darf der Gate-Zustand NICHT neu geprüft
 *    werden (die Prüfung lief vorher schon) — `approved` bleibt `approved`.
 *    Timer, die während des Einfrierens der Seite abgelaufen sind, können
 *    fälschlich `error` gesetzt haben; in diesem Fall wird die Prüfung genau
 *    einmal neu angestoßen statt einen Fehlerbildschirm zu zeigen.
 *
 * Bewusst NUR `approved` wird gecacht: ein zwischenzeitlich vom Owner
 * freigeschalteter Nutzer darf nicht minutenlang die Warteliste sehen.
 *
 * Alle Funktionen sind rein bzw. greifen gekapselt auf `sessionStorage` zu und
 * liefern bei fehlendem/defektem Speicher (SSR, private mode, Fremd-JSON) sicher
 * `null` — die Aufrufer fallen dann auf das normale Prüfen zurück.
 */

export const BETA_ACCESS_CACHE_VERSION = 1;
export const BETA_ACCESS_CACHE_KEY = 'growimo_beta_access_v1';
/** Kurz halten: nur Reload/Zurück-Sprünge sollen davon profitieren. */
export const BETA_ACCESS_CACHE_TTL_MS = 5 * 60 * 1_000;

export type BetaAccessState = 'approved' | 'denied';

export interface BetaAccessCacheEntry {
  version: number;
  email: string;
  state: BetaAccessState;
  at: number;
}

/** bfcache-Rückkehr? (Back/Forward-Cache, Seite wurde nicht neu geladen) */
export function isBfcacheReturn(
  event: { persisted?: boolean } | null | undefined,
): boolean {
  return event?.persisted === true;
}

/** Soll ein bereits bekannter Gate-Zustand bei der bfcache-Rückkehr erhalten bleiben? */
export function shouldKeepBetaState(event: { persisted?: boolean } | null | undefined): boolean {
  return isBfcacheReturn(event);
}

/** Soll nach der bfcache-Rückkehr neu geprüft werden (Timer lief während des Einfrierens)? */
export function shouldRecheckOnReturn(
  event: { persisted?: boolean } | null | undefined,
  state: 'checking' | BetaAccessState | 'error',
): boolean {
  return isBfcacheReturn(event) && state === 'error';
}

/** Serialisiert einen Cache-Eintrag (ausgelagert, damit es testbar ist). */
export function encodeBetaAccessEntry(
  email: string,
  state: BetaAccessState,
  at: number,
): string {
  const entry: BetaAccessCacheEntry = {
    version: BETA_ACCESS_CACHE_VERSION,
    email: email.trim().toLowerCase(),
    state,
    at,
  };
  return JSON.stringify(entry);
}

/**
 * Liest einen Cache-Eintrag und gibt den Zustand nur zurück, wenn Version,
 * E-Mail und TTL passen. `denied` wird nie zurückgegeben (s. Modulkommentar).
 */
export function decodeBetaAccessEntry(
  raw: string | null | undefined,
  email: string,
  now: number = Date.now(),
  ttlMs: number = BETA_ACCESS_CACHE_TTL_MS,
): BetaAccessState | null {
  if (!raw || !email) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const e = parsed as Partial<BetaAccessCacheEntry>;
  if (e.version !== BETA_ACCESS_CACHE_VERSION) return null;
  if (typeof e.email !== 'string' || e.email !== email.trim().toLowerCase()) return null;
  if (e.state !== 'approved') return null;
  if (typeof e.at !== 'number' || !Number.isFinite(e.at)) return null;
  if (now - e.at > ttlMs || now < e.at) return null;
  return 'approved';
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    // Zugriff kann in restriktiven Browsermodi werfen.
    return null;
  }
}

/** Kurzzeitig gemerkter, bestätigter Gate-Zustand (oder null). */
export function readBetaAccessCache(
  email: string,
  now: number = Date.now(),
): BetaAccessState | null {
  const s = storage();
  if (!s) return null;
  let raw: string | null = null;
  try {
    raw = s.getItem(BETA_ACCESS_CACHE_KEY);
  } catch {
    return null;
  }
  return decodeBetaAccessEntry(raw, email, now);
}

/** Bestätigten Zustand spiegeln. Fehler beim Schreiben werden geschluckt. */
export function writeBetaAccessCache(
  email: string,
  state: BetaAccessState,
  now: number = Date.now(),
): void {
  const s = storage();
  if (!s || !email) return;
  try {
    s.setItem(BETA_ACCESS_CACHE_KEY, encodeBetaAccessEntry(email, state, now));
  } catch {
    /* voller/deaktivierter sessionStorage — kein Gate-Blocker */
  }
}

/** Cache löschen (z. B. beim Abmelden oder wenn die Prüfung „denied“ liefert). */
export function clearBetaAccessCache(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(BETA_ACCESS_CACHE_KEY);
  } catch {
    /* s. o. */
  }
}
