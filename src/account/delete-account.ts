// ─────────────────────────────────────────────────────────────────────────────
// SELBSTBEDIENUNGS-KONTO-LÖSCHUNG — ServerFn-Hülle (2026-10-24)
// ─────────────────────────────────────────────────────────────────────────────
// Diese Datei ist NUR die Hülle: Validierung, Identität, Aufruf. Die Logik
// steht in `deletion-runner.ts`, die Regeln in `deletion-plan.ts`.
//
// Drei unabhängige Gates, alle fail-closed:
//   1. Flag `ACCOUNT_DELETE_ENABLED` — Kill-Switch, Default AN (Owner-Auftrag
//      2026-10-24, damit die Funktion in der Vorschau sichtbar ist). Abschalten
//      mit `ACCOUNT_DELETE_ENABLED=false`.
//   2. Session (ausschließlich aus dem Cookie, NIE aus dem Payload) → sonst nichts.
//   3. Bestätigungswort „LOESCHEN" (serverseitig geprüft) → sonst nichts.
//
// Owner-Konto: wird NICHT gesperrt (der Owner muss die Funktion testen können),
// aber die Bestätigungswort-Prüfung gilt für alle gleich.
// ─────────────────────────────────────────────────────────────────────────────
import { createServerFn } from '@tanstack/react-start';
import {
  ACCOUNT_DELETE_CONFIRMATION_WORD,
  ACCOUNT_DELETE_FLAG,
  ACCOUNT_DELETE_LOSS_ITEMS,
  AccountDeletionError,
  assertAccountDeletionAllowed,
  availableDeletionOptions,
  deletionModeNoticeKeys,
  isAccountDeletionEnabled,
  resolveDeletionMode,
  type AccountDeletionMode,
} from './deletion-plan';
import {
  productionDeletionDeps,
  runAccountDeletion,
  type DeletionResult,
} from './deletion-runner';

export interface AccountDeletionInfo {
  /** Ist die Funktion freigeschaltet (Kill-Switch)? */
  enabled: boolean;
  /** Name des Flags (für Betrieb/Doku in der UI). */
  flag: string;
  /** Angemeldet? Ohne Session gibt es keine Löschung. */
  signedIn: boolean;
  /** Aktives bezahltes Abo? Entscheidet über die Auswahl-Möglichkeiten. */
  hasActivePaidSubscription: boolean;
  /** Ende des bezahlten Zeitraums (ISO) — nur bei aktivem Abo. */
  currentPeriodEnd: string | null;
  /** Welche Varianten die UI anbieten darf. */
  options: AccountDeletionMode[];
  /** Serverseitig erwartetes Bestätigungswort (damit die UI nichts anderes zeigt). */
  confirmationWord: string;
  /** Pflicht-Warnhinweise (Schlüssel der i18n-Texte). */
  lossItems: string[];
  /** Zusätzliche Hinweise je Variante (Schlüssel der i18n-Texte). */
  modeNotices: Record<AccountDeletionMode, string[]>;
}

/**
 * Statusabfrage für die Lösch-Seite. Verbraucht nichts, löscht nichts.
 * Fail-closed: ohne Session/DB → `signedIn: false`, keine Optionen.
 */
export const getAccountDeletionInfo = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AccountDeletionInfo> => {
    const enabled = isAccountDeletionEnabled();
    const base: AccountDeletionInfo = {
      enabled,
      flag: ACCOUNT_DELETE_FLAG,
      signedIn: false,
      hasActivePaidSubscription: false,
      currentPeriodEnd: null,
      options: ['immediate'],
      confirmationWord: ACCOUNT_DELETE_CONFIRMATION_WORD,
      lossItems: [...ACCOUNT_DELETE_LOSS_ITEMS],
      modeNotices: {
        immediate: deletionModeNoticeKeys('immediate'),
        period_end: deletionModeNoticeKeys('period_end'),
      },
    };

    let clerkUserId: string | null = null;
    try {
      const { resolveUserIdFromServerFn } = await import('../lib/usage-guard');
      clerkUserId = await resolveUserIdFromServerFn();
    } catch {
      clerkUserId = null;
    }
    if (!clerkUserId) return base;

    try {
      const { qGetSubscriptionForUser } = await import('../db/queries');
      const row = await qGetSubscriptionForUser(clerkUserId);
      const hasActivePaidSubscription = Boolean(
        row &&
          row.planTier === 'pro' &&
          row.status === 'active' &&
          row.stripeSubscriptionId,
      );
      return {
        ...base,
        signedIn: true,
        hasActivePaidSubscription,
        currentPeriodEnd: row?.currentPeriodEnd
          ? row.currentPeriodEnd.toISOString()
          : null,
        options: availableDeletionOptions({ hasActivePaidSubscription }),
      };
    } catch {
      // Kein DB-Zugriff → nur der sofortige Weg, kein Absturz.
      return { ...base, signedIn: true };
    }
  },
);

/**
 * Führt die Kontolöschung aus.
 * `confirmation` ist das vom Nutzer getippte Bestätigungswort, `mode` die
 * gewählte Variante ('immediate' | 'period_end').
 */
export const deleteAccount = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const d = data as { confirmation?: unknown; mode?: unknown };
    return { confirmation: d?.confirmation, mode: d?.mode };
  })
  .handler(async ({ data }): Promise<DeletionResult> => {
    // Identität NUR aus der Session (kein Payload-Fallback — sonst könnte
    // jeder fremde Konten löschen).
    const { resolveUserIdFromServerFn } = await import('../lib/usage-guard');
    const sessionUserId = await resolveUserIdFromServerFn();

    const clerkUserId = assertAccountDeletionAllowed({
      clerkUserId: sessionUserId,
      confirmation: data.confirmation,
      enabled: isAccountDeletionEnabled(),
    });

    // Aktives Abo serverseitig bestimmen — der Client darf `period_end` nicht
    // behaupten, wenn gar kein Abo existiert.
    let hasActivePaidSubscription = false;
    try {
      const { qGetSubscriptionForUser } = await import('../db/queries');
      const row = await qGetSubscriptionForUser(clerkUserId);
      hasActivePaidSubscription = Boolean(
        row && row.planTier === 'pro' && row.status === 'active' && row.stripeSubscriptionId,
      );
    } catch {
      hasActivePaidSubscription = false;
    }

    const mode = resolveDeletionMode({
      requested: data.mode ?? 'immediate',
      hasActivePaidSubscription,
    });

    return runAccountDeletion(clerkUserId, productionDeletionDeps(), { mode });
  });

export { AccountDeletionError };
