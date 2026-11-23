// ── Kostenhinweis an bezahlten Knöpfen (Owner-Regel 2026-11-23) ───────────────
// EINE Anzeige für alle bezahlten Aktionen: „kostet 1 Einheit · 2 von 3 übrig",
// „Kontingent aufgebraucht — Aktion gesperrt" (Knopf zusätzlich deaktiviert) und
// „kostet keine Einheit" (vorhandenes Bild wiederverwenden / Bearbeiten).
//
// Quelle ist ausschließlich der Server-Wert (`useServerUsage` →
// getSubscriptionStatus → usage_monthly), dieselbe Quelle wie Rest-Anzeige und
// Limit-Banner. Ohne Server-Wert wird KEIN Rest geraten — dann steht nur der
// Preis („kostet 1 Einheit").
//
// Der Owner-/Admin-Override (unbegrenzt) sieht ebenfalls nur den Preis, keinen
// Zähler — die Ausnahme bleibt wie in 8.2 unsichtbar.
//
// `useCostState` liefert denselben Zustand für `disabled` am Knopf, damit die
// Sperre VOR dem Klick sichtbar ist (und nicht erst im Stream).
import { useTranslation } from '~/i18n';
import { useServerUsage, type ClientUsage } from '~/lib/usage-client';

export interface CostState {
  usage: ClientUsage | null;
  isOwner: boolean;
  /** Kontingent nachweislich aufgebraucht → Aktion gesperrt. */
  blocked: boolean;
}

/** Zustand für Knopf-Sperre + Anzeige (verbraucht nichts). */
export function useCostState(userId?: string): CostState {
  const { usage, isOwner } = useServerUsage(userId);
  const blocked = Boolean(usage && usage.limit > 0 && usage.remaining <= 0);
  return { usage, isOwner, blocked };
}

/** Grund, warum eine Aktion kostenlos ist. */
export type CostFreeKind = 'reuse' | 'edit';

interface CostHintViewProps {
  state: CostState;
  /** Kostenpflichtig: Anzahl Einheiten (Default 1). */
  units?: number;
  /** Kostenlos: Grund (vorhandenes Bild / Bearbeiten). */
  freeKind?: CostFreeKind;
  className?: string;
  testId?: string;
}

/**
 * Reine Anzeige (kein eigener Server-Aufruf) — für Seiten, die den Zustand
 * schon über `useCostState`/`useServerUsage` halten.
 */
export function CostHintView({ state, units = 1, freeKind, className = '', testId }: CostHintViewProps) {
  const { t } = useTranslation();

  let text: string;
  let tone = 'text-gray-600';

  if (freeKind) {
    const reason = freeKind === 'reuse' ? t.cost_hint_free_reuse : t.cost_hint_free_edit;
    text = `${t.cost_hint_free} ${reason}`;
    tone = 'text-emerald-700';
  } else if (state.blocked) {
    text = t.cost_hint_blocked;
    tone = 'text-red-700 font-semibold';
  } else {
    text = units === 1 ? t.cost_hint_unit_singular : t.cost_hint_unit_plural.replace('%d', String(units));
    // Rest nur, wenn der Server-Wert wirklich da ist (kein geratener Zähler).
    if (state.usage && !state.isOwner) {
      text += ` · ${t.cost_hint_remaining
        .replace('%d', String(state.usage.remaining))
        .replace('%d', String(state.usage.limit))}`;
    }
  }

  return (
    <p
      data-testid={testId}
      data-cost-state={freeKind ? 'free' : state.blocked ? 'blocked' : 'paid'}
      role="status"
      aria-live="polite"
      className={`text-xs leading-snug ${tone} ${className}`.trim()}
    >
      {text}
    </p>
  );
}

interface CostHintProps extends Omit<CostHintViewProps, 'state'> {
  /** Clerk-User-ID des angemeldeten Nutzers. */
  userId?: string;
}

/** Kostenhinweis mit eigenem Server-Wert (für Seiten ohne eigenen Usage-Hook). */
export function CostHint({ userId, ...rest }: CostHintProps) {
  const state = useCostState(userId);
  return <CostHintView state={state} {...rest} />;
}
