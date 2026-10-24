// ─────────────────────────────────────────────────────────────────────────────
// KONTO-LÖSCHUNG (Selbstbedienung) — ENTWURF 2026-10-24, NICHT AKTIV
// ─────────────────────────────────────────────────────────────────────────────
// STATUS: ENTWURF. Nichts hiervon ist geroutet, nichts ist deployed. Der
// ServerFn in `delete-account.ts` ist zusätzlich per Env-Flag hart abgeschaltet
// (Default: aus) — ein versehentlicher Aufruf endet mit einem Fehler, nicht mit
// einer Löschung. Freigabe durch den Owner ist Voraussetzung.
//
// Dieses Modul ist ABSICHTLICH frei von I/O: es beschreibt nur, WAS in welcher
// Reihenfolge gelöscht werden muss und WARUM. Die Ausführung steht in
// `delete-account.ts`; die Begründung im Entwurfsordner
// (KONTOLOESCHUNG-KONZEPT.md).
// ─────────────────────────────────────────────────────────────────────────────

/** Env-Flag: nur exakt 'true' aktiviert die Löschung (fail-closed). */
export const ACCOUNT_DELETE_FLAG = 'ACCOUNT_DELETE_ENABLED' as const;

/**
 * Bestätigungswort gegen Fehlklicks. Bewusst ein Wort, das man nicht aus
 * Versehen tippt, und ohne Umlaut-Eingabefalle (Umschreibungen erlaubt).
 */
export const ACCOUNT_DELETE_CONFIRMATION_WORD = 'LOESCHEN' as const;
export const ACCOUNT_DELETE_CONFIRMATION_ALIASES = [
  'LÖSCHEN',
  'loeschen',
  'löschen',
] as const;

/** Ist die Selbstbedienungs-Löschung freigeschaltet? Default: nein. */
export function isAccountDeletionEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return String(env[ACCOUNT_DELETE_FLAG] ?? '').trim().toLowerCase() === 'true';
}

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

export type AccountDeletionErrorCode =
  | 'account_deletion_disabled'
  | 'no_session'
  | 'confirmation_mismatch';

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
    throw new AccountDeletionError(
      'no_session',
      'Keine gültige Sitzung — bitte erneut anmelden.',
    );
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
  const steps: DeletionStep[] = [];

  steps.push({
    id: 'stripe_cancel_subscription',
    kind: 'external',
    target: 'Stripe Subscription',
    reason:
      'Ein laufendes Abo würde nach der Kontolöschung weiter abbuchen, ohne dass eine Zuordnung existiert.',
    blocking: input.hasSubscription,
  });
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
