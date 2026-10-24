// ─────────────────────────────────────────────────────────────────────────────
// KONTO-LÖSCHUNG (Selbstbedienung) — REGELN UND LÖSCHPLAN (2026-10-24)
// ─────────────────────────────────────────────────────────────────────────────
// Owner-Entscheidung 2026-10-24: „einbauen. Bei laufenden bezahlten Abonnements
// eine Auswahl zwischen sofortiger Löschung und Löschung zum Ende des bezahlten
// Zeitraums. Vorher deutlich über Datenverlust und mögliche Auswirkungen auf
// den Abonnementvertrag informieren."
//
// Dieses Modul ist ABSICHTLICH frei von I/O: es beschreibt nur, WER löschen
// darf, WELCHE Optionen es gibt und WAS in welcher Reihenfolge gelöscht werden
// muss. Die Ausführung steht in `deletion-runner.ts`, die ServerFn-Hülle in
// `delete-account.ts`, die Begründung im Entwurfsordner
// (KONTOLOESCHUNG-KONZEPT.md).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Env-Flag `ACCOUNT_DELETE_ENABLED` — ab 2026-10-24 ein KILL-SWITCH.
 *
 * SEMANTIK-WECHSEL (dokumentiert, Owner-Auftrag 2026-10-24): Vorher war der
 * Default AUS. Damit die Funktion in der Vorschau (Preview-Build) ohne Extra-
 * Env sichtbar ist, ist der Default jetzt AN. Ausgeschaltet wird nur durch ein
 * ausdrückliches `false`/`0`/`off`/`no`. In Produktion wird die Funktion damit
 * erst mit dem nächsten Production-Deploy erreichbar — die Entscheidung darüber
 * trifft der Owner bei der Freigabe (es wurde KEINE Vercel-Env geändert).
 */
export const ACCOUNT_DELETE_FLAG = 'ACCOUNT_DELETE_ENABLED' as const;

/** Ist die Selbstbedienungs-Löschung freigeschaltet? Default: JA (Kill-Switch). */
export function isAccountDeletionEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = String(env[ACCOUNT_DELETE_FLAG] ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off' || raw === 'no') return false;
  return true;
}

/**
 * Bestätigungswort gegen Fehlklicks. Bewusst ein Wort, das man nicht aus
 * Versehen tippt, und ohne Umlaut-Eingabefalle (Umschreibungen erlaubt).
 */
export const ACCOUNT_DELETE_CONFIRMATION_WORD = 'LOESCHEN' as const;
export const ACCOUNT_DELETE_CONFIRMATION_ALIASES = ['LÖSCHEN', 'loeschen', 'löschen'] as const;

/** Bestätigungswort korrekt? (case-insensitiv, Umlaut-Varianten erlaubt) */
export function confirmationMatches(input: unknown): boolean {
  const value = String(input ?? '').trim();
  if (!value) return false;
  const normalized = value.toUpperCase();
  return (
    normalized === ACCOUNT_DELETE_CONFIRMATION_WORD ||
    ACCOUNT_DELETE_CONFIRMATION_ALIASES.some((a) => a.toUpperCase() === normalized)
  );
}

// ── Lösch-Modus ──────────────────────────────────────────────────────────────

/**
 * `immediate`  — Abo wird sofort beendet, Daten werden sofort gelöscht.
 * `period_end` — Abo wird zum Ende des bezahlten Zeitraums beendet, Zugriff
 *                bleibt bis dahin bestehen, die Löschung läuft zum selben
 *                Zeitpunkt (Trigger: Stripe-Webhook `customer.subscription.
 *                deleted` und zusätzlich der tägliche Cron als Sicherheitsnetz).
 */
export type AccountDeletionMode = 'immediate' | 'period_end';

export const ACCOUNT_DELETION_MODES: readonly AccountDeletionMode[] = [
  'immediate',
  'period_end',
] as const;

/** Roh-Wert aus dem Client → Modus, oder null wenn ungültig (fail-closed). */
export function parseDeletionMode(value: unknown): AccountDeletionMode | null {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'immediate' || raw === 'period_end') return raw;
  return null;
}

/**
 * Welche Optionen darf die UI anbieten?
 *   · aktives bezahltes Abo → BEIDE Wege (Owner-Vorgabe 2026-10-24),
 *   · sonst                → NUR sofort (keine irreführende Auswahl).
 */
export function availableDeletionOptions(input: {
  hasActivePaidSubscription: boolean;
}): AccountDeletionMode[] {
  return input.hasActivePaidSubscription ? ['immediate', 'period_end'] : ['immediate'];
}

export type AccountDeletionErrorCode =
  | 'account_deletion_disabled'
  | 'no_session'
  | 'confirmation_mismatch'
  | 'mode_invalid'
  | 'mode_not_available';

export class AccountDeletionError extends Error {
  code: AccountDeletionErrorCode;
  constructor(code: AccountDeletionErrorCode, message: string) {
    super(message);
    this.name = 'AccountDeletionError';
    this.code = code;
  }
}

/**
 * Vorprüfung des Lösch-Wunsches. Bewusst OHNE Payload-UserId: die Identität
 * kommt AUSSCHLIESSLICH aus der Server-Session (sonst könnte jeder fremde
 * Konten löschen).
 */
export function assertAccountDeletionAllowed(input: {
  clerkUserId: string | null | undefined;
  confirmation: unknown;
  enabled: boolean;
}): string {
  if (!input.enabled) {
    throw new AccountDeletionError(
      'account_deletion_disabled',
      'Die Kontolöschung ist derzeit nicht freigeschaltet.',
    );
  }
  const userId = String(input.clerkUserId ?? '').trim();
  if (!userId || userId === 'anonymous') {
    throw new AccountDeletionError('no_session', 'Keine gültige Sitzung — bitte erneut anmelden.');
  }
  if (!confirmationMatches(input.confirmation)) {
    throw new AccountDeletionError(
      'confirmation_mismatch',
      `Zur Bestätigung bitte "${ACCOUNT_DELETE_CONFIRMATION_WORD}" eingeben.`,
    );
  }
  return userId;
}

/**
 * Serverseitige Prüfung der gewählten Variante. Der Client darf `period_end`
 * NICHT behaupten, wenn gar kein aktives Abo existiert (sonst entstünde eine
 * „Löschung", die nie ausgeführt würde).
 */
export function resolveDeletionMode(input: {
  requested: unknown;
  hasActivePaidSubscription: boolean;
}): AccountDeletionMode {
  const parsed = parseDeletionMode(input.requested);
  if (!parsed) {
    throw new AccountDeletionError(
      'mode_invalid',
      'Unbekannte Lösch-Variante. Bitte wähle „sofort" oder „zum Ende des bezahlten Zeitraums".',
    );
  }
  if (!availableDeletionOptions(input).includes(parsed)) {
    throw new AccountDeletionError(
      'mode_not_available',
      'Diese Variante ist für dein Konto nicht verfügbar (kein aktives bezahltes Abo).',
    );
  }
  return parsed;
}

/**
 * Was mit `beta_signups` passiert, ist eine OFFENE Owner-Entscheidung:
 *  - 'keep'   : Rabatt-Nachweis bleibt (der Nutzer behält seinen Anspruch auch
 *               nach Konto-Neuanlage mit derselben E-Mail). Datenschutzrechtlich
 *               ist die Zeile dann zu löschen, wenn kein Vertrag mehr besteht —
 *               juristisch zu klären.
 *  - 'delete' : Zeile wird mitgelöscht → Rabatt endet mit dem Konto.
 * Bis zur Entscheidung gilt 'keep' (nichts wird stillschweigend gelöscht).
 */
export type BetaSignupPolicy = 'keep' | 'delete';
export const BETA_SIGNUP_POLICY_DEFAULT: BetaSignupPolicy = 'keep';

export interface DeletionPlanInput {
  /** Existiert eine (auch gekündigte) Stripe-Subscription? */
  hasSubscription: boolean;
  /** Anzahl noch nicht gelöschter Bilder (Blobs müssen physisch weg). */
  liveImageCount: number;
  /** Gibt es eine beta_signups-Zeile zu dieser E-Mail? */
  hasBetaSignup: boolean;
  /** Lösch-Variante (Default: sofort). */
  mode?: AccountDeletionMode;
}

export interface DeletionStep {
  /** Stabile ID für Tests/Logs. */
  id: string;
  kind: 'external' | 'db';
  /** Betroffenes System/Objekt. */
  target: string;
  /** Warum dieser Schritt nötig ist. */
  reason: string;
  /** Muss der Schritt erfolgreich sein, damit gelöscht werden darf? */
  blocking: boolean;
  /** Wartet dieser Schritt auf eine Owner-Entscheidung? */
  ownerDecision?: boolean;
  /** Läuft der Schritt erst zum Periodenende (nicht jetzt)? */
  deferred?: boolean;
}

/**
 * Reihenfolge ist fachlich erzwungen, nicht beliebig:
 *  1. Externe Abhängigkeiten ZUERST (Stripe, Blobs, Clerk) — nach dem Löschen
 *     der `users`-Zeile gäbe es keinen Weg mehr, die Subscription-ID oder die
 *     Blob-Pfade zuzuordnen. Eine weiterlaufende Stripe-Subscription würde
 *     nach der Löschung ohne Zuordnung weiter abbuchen.
 *  2. Danach die Tabellen OHNE Fremdschlüssel (TEXT-Clerk-IDs) — die cascade
 *     erfasst sie nicht.
 *  3. Zuletzt `users` — die Kaskade räumt projects, generated_content,
 *     subscriptions, publish_plan, performance_entries, user_preferences,
 *     usage_monthly und generated_images ab.
 *  4. Ganz zuletzt der Clerk-Nutzer: bliebe er bestehen, würde der nächste
 *     Login über `ensureUserRow()` sofort wieder eine `users`-Zeile anlegen —
 *     das Konto wäre „auferstanden" (inkl. 3 frischer Free-Generierungen).
 */
export function buildDeletionPlan(input: DeletionPlanInput): DeletionStep[] {
  const mode: AccountDeletionMode = input.mode ?? 'immediate';
  const steps: DeletionStep[] = [];

  if (mode === 'period_end') {
    steps.push({
      id: 'stripe_cancel_at_period_end',
      kind: 'external',
      target: 'Stripe Subscription (cancel_at_period_end)',
      reason:
        'Das Abo wird zum Ende des bezahlten Zeitraums beendet. Bis dahin bleibt der Zugriff bestehen, es wird nichts anteilig erstattet (keine automatische Erstattung).',
      blocking: input.hasSubscription,
    });
    steps.push({
      id: 'schedule_deletion_request',
      kind: 'db',
      target: 'account_deletion_requests',
      reason:
        'Merkt die Löschung zum Periodenende vor. Ausgeführt wird sie vom Stripe-Webhook customer.subscription.deleted, zusätzlich vom täglichen Cron als Sicherheitsnetz.',
      blocking: true,
      deferred: true,
    });
  } else {
    steps.push({
      id: 'stripe_cancel_subscription',
      kind: 'external',
      target: 'Stripe Subscription',
      reason:
        'Ein laufendes Abo würde nach der Kontolöschung weiter abbuchen, ohne dass eine Zuordnung existiert.',
      blocking: input.hasSubscription,
    });
  }

  steps.push({
    id: 'stripe_delete_customer',
    kind: 'external',
    target: 'Stripe Customer',
    reason:
      'Löscht die Kundendaten bei Stripe (Art. 17 DSGVO). Rechnungen bleiben bei Stripe und sind gesetzlich aufzubewahren (§ 147 AO) — sie werden NICHT gelöscht.',
    blocking: false,
  });
  steps.push({
    id: 'blob_delete_images',
    kind: 'external',
    target: `Vercel Blob (${input.liveImageCount} Bild(er))`,
    reason:
      'Objektspeicher-Dateien verschwinden nicht durch das Löschen der DB-Zeilen — sie müssen physisch entfernt werden.',
    blocking: false,
  });
  steps.push({
    id: 'delete_usage_events',
    kind: 'db',
    target: 'usage_events',
    reason:
      'user_id ist die Clerk-ID als TEXT ohne Fremdschlüssel — die Kaskade erfasst diese Zeilen nicht.',
    blocking: true,
  });
  steps.push({
    id: 'delete_tracking_events',
    kind: 'db',
    target: 'tracking_events',
    reason: 'Ebenfalls TEXT-Clerk-ID ohne Fremdschlüssel.',
    blocking: true,
  });
  steps.push({
    id: 'delete_generation_throttle',
    kind: 'db',
    target: 'generation_throttle',
    reason: 'Ebenfalls TEXT-Clerk-ID ohne Fremdschlüssel.',
    blocking: true,
  });
  steps.push({
    id: 'delete_analytics_events',
    kind: 'db',
    target: 'analytics_events',
    reason:
      'Reichweiten-Events tragen nur ein Pseudonym (HMAC der Clerk-ID). Löschbar nur, wenn das Pseudonym serverseitig neu berechnet wird.',
    blocking: false,
  });
  steps.push({
    id: 'beta_signup_policy',
    kind: 'db',
    target: 'beta_signups',
    reason:
      'Die Rabatt-Berechtigung hängt an der E-Mail-Adresse, nicht am Konto. Ob die Zeile mitgelöscht wird, ist eine offene Entscheidung.',
    blocking: false,
    ownerDecision: true,
  });
  steps.push({
    id: 'delete_user_row',
    kind: 'db',
    target: 'users (+ CASCADE)',
    reason:
      'Löscht users und über die Kaskade projects, generated_content, subscriptions, publish_plan, performance_entries, user_preferences, usage_monthly, generated_images.',
    blocking: true,
  });
  steps.push({
    id: 'clerk_delete_user',
    kind: 'external',
    target: 'Clerk User',
    reason:
      'Ohne Löschung im Identitätsdienst bleibt der Login bestehen und ensureUserRow() legt beim nächsten Aufruf sofort ein neues Konto an (inkl. frischer Free-Generierungen).',
    blocking: true,
  });

  return steps;
}

/**
 * Nur die Schritte, die VOR dem Löschen der `users`-Zeile zwingend erfolgreich
 * sein müssen (externe, blockierende Schritte). Die Clerk-Löschung läuft
 * bewusst NACH der DB-Löschung und zählt deshalb nicht dazu.
 */
export function blockingStepsBeforeDbDelete(plan: DeletionStep[]): DeletionStep[] {
  const dbDeleteIdx = plan.findIndex((s) => s.id === 'delete_user_row');
  const limit = dbDeleteIdx === -1 ? plan.length : dbDeleteIdx;
  return plan.slice(0, limit).filter((s) => s.blocking && s.kind === 'external');
}

/**
 * Was der Nutzer VOR der Bestätigung sehen muss (Owner: „vorher deutlich über
 * Datenverlust und mögliche Auswirkungen auf den Abonnementvertrag
 * informieren"). Diese Liste ist die einzige Quelle für die Warnhinweise der
 * UI — dadurch ist sie testbar und kann nicht still verkürzt werden.
 */
export const ACCOUNT_DELETE_LOSS_ITEMS = [
  'projects_and_content',
  'generated_images',
  'saved_preferences',
  'usage_and_history',
  'generation_quota',
  'account_access',
] as const;
export type AccountDeleteLossItem = (typeof ACCOUNT_DELETE_LOSS_ITEMS)[number];

/** Zusätzliche Hinweise je Lösch-Variante (Abo-Auswirkung, keine Erstattung). */
export function deletionModeNoticeKeys(mode: AccountDeletionMode): string[] {
  return mode === 'period_end'
    ? ['subscription_ends_at_period_end', 'access_until_period_end', 'no_prorated_refund']
    : ['subscription_ends_immediately', 'access_ends_immediately', 'no_prorated_refund'];
}
