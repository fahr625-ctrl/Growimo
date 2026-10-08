// ── FIX-BLOCK 1 (Owner-Auftrag 2026-10-08): EINE Anzeige-Quelle ───────────────
// Die Rest-Anzeige / das Limit-Banner / Kosten-Hinweise werden überall aus
// DERSELBEN Quelle gespeist: dem ServerFn `getSubscriptionStatus`, der seinerseits
// den 8.2-Usage-Guard (`getUsageInfo` → `usage_monthly.count` + Tarif-Limit) liest.
// Vorher gab es daneben einen reinen In-Memory-Zähler im Client-Store
// (`~/store/subscriptions.usageMap`), der bei jedem Seitenaufruf bei 0 begann —
// dadurch konnte ein Banner etwas anderes zeigen als die DB (live belegt: „2 von 5
// verbleibend" während die DB 5/5 hatte).
//
// Dieser Client-Hook ist die EINZIGE Lese-Stelle für Anzeigen. Er lädt:
//   • beim Mount,
//   • bei jeder Routenänderung (/app-Seiten),
//   • bei Fenster-Fokus,
//   • bei jedem `growimo:usage-refresh`-Event (wird nach jeder Generierung und
//     jedem Verbrauch ausgelöst — siehe refreshUsage()).
// Fail-silent: ohne Session/DB-Fehler bleibt `usage === null` und es wird
// NICHTS angezeigt (kein geratener Wert, keine lokale Wahrheit).
// Owner-/Admin-Override: kein Aufruf, keine Anzeige (Vorgabe 8.2 — unsichtbar).
import { useCallback, useEffect, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { getSubscriptionStatus } from '~/stripe/subscription';
import { OWNER_USER_ID } from '~/lib/tracking';
import { hydrateUsageFromServer } from '~/store/subscriptions';

/** Einheitliches Anzeige-Format (identisch zum ServerFn-Feld `usage`). */
export interface ClientUsage {
  used: number;
  remaining: number;
  limit: number;
  planTier: 'free' | 'pro';
}

/** Event, das jede Verbrauchsstelle nach einer Generierung auslöst. */
export const USAGE_REFRESH_EVENT = 'growimo:usage-refresh';

/** Fordert eine Neuladung des Server-Werts an (fire-and-forget). */
export function refreshUsage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new Event(USAGE_REFRESH_EVENT));
  } catch {
    // Anzeige-Refresh darf niemals eine Generierung stören.
  }
}

export interface ServerUsageState {
  /** Server-Wert (DB-identisch) oder null, solange unbekannt/kein Zugriff. */
  usage: ClientUsage | null;
  /** true, solange noch kein Server-Wert vorliegt. */
  loading: boolean;
  /** ist der angemeldete Nutzer der interne Owner-/Admin-Override? */
  isOwner: boolean;
  /** Manuell neu laden (z. B. direkt nach einem Verbrauch). */
  refresh: () => Promise<void>;
}

/**
 * Server-Wahrheit des Monatskontingents für Anzeigen. `userId` = Clerk-ID.
 * Ohne userId (nicht angemeldet) wird nichts geladen.
 */
export function useServerUsage(userId?: string): ServerUsageState {
  const [usage, setUsage] = useState<ClientUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isOwner = userId === OWNER_USER_ID;
  const enabled = Boolean(userId) && !isOwner;

  const load = useCallback(async () => {
    if (!enabled) {
      setUsage(null);
      setLoading(false);
      return;
    }
    try {
      const status = await getSubscriptionStatus();
      const u = status?.usage ?? null;
      setUsage(u ? { used: u.used, remaining: u.remaining, limit: u.limit, planTier: u.planTier } : null);
      // Der Client-Store wird NUR gespiegelt (DB-Wert), damit auch die
      // Vorab-Prüfungen (canGenerate) und Legacy-Fallbacks nicht mehr auf einem
      // eigenständigen lokalen Zähler laufen.
      if (u && userId) hydrateUsageFromServer(userId, u.used, u.planTier);
    } catch {
      // fail-silent: kein Wert ist besser als ein falscher Wert
      setUsage(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled) {
      setUsage(null);
      return;
    }
    setLoading(true);
    void load();
    const onFocus = () => void load();
    const onRefresh = () => void load();
    window.addEventListener('focus', onFocus);
    window.addEventListener(USAGE_REFRESH_EVENT, onRefresh);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(USAGE_REFRESH_EVENT, onRefresh);
    };
    // pathname: nach jeder Navigation neu laden (identische Quelle wie die Banner).
  }, [enabled, pathname, load]);

  return { usage, loading, isOwner, refresh: load };
}
