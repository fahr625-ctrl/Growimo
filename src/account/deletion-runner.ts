// ─────────────────────────────────────────────────────────────────────────────
// KONTO-LÖSCHUNG — AUSFÜHRUNG (I/O-Orchestrierung, 2026-10-24)
// ─────────────────────────────────────────────────────────────────────────────
// Dieses Modul enthält die Lösch-Logik und ist bewusst FREI von
// `createServerFn` (damit es im Cron/Webhook importierbar und mit Fakes
// testbar ist). Die ServerFn-Hülle steht in `delete-account.ts`.
//
// REIHENFOLGE (fachlich erzwungen, siehe deletion-plan.ts):
//   Stripe (Abo beenden)  →  Blobs  →  Tabellen ohne FK  →  users (CASCADE)
//   →  Clerk-User ZULETZT.
//
// ZWEI LÖSCH-VARIANTEN (Owner-Entscheidung 2026-10-24):
//   · immediate  : Abo sofort beenden, Daten sofort löschen.
//   · period_end : `cancel_at_period_end` bei Stripe setzen, Löschung in
//                  `account_deletion_requests` vormerken (status 'pending',
//                  scheduled_for = Periodenende) und zum Periodenende
//                  ausführen. Zwei Trigger, beide vorhanden:
//                    1. Stripe-Webhook `customer.subscription.deleted`
//                       (src/api/stripe-webhook.ts → maybeExecuteScheduledDeletion)
//                    2. Täglicher Cron `/api/cron/blob-ttl`
//                       (src/api/cron-blob-ttl.ts → runScheduledAccountDeletions)
//                  Der Cron ist das Sicherheitsnetz: geht der Webhook verloren,
//                  wird spätestens im nächsten Tageslauf gelöscht.
// ─────────────────────────────────────────────────────────────────────────────
import {
  BETA_SIGNUP_POLICY_DEFAULT,
  AccountDeletionError,
  blockingStepsBeforeDbDelete,
  buildDeletionPlan,
  type AccountDeletionMode,
  type BetaSignupPolicy,
} from './deletion-plan';

/** Minimaler SQL-Executor (Neon-Tag-Funktion); Tests injizieren einen Fake. */
export type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

/** Injizierbare Außenwelt — im Test durch Fakes ersetzbar, produktiv echt. */
export interface DeleteAccountDeps {
  /** Sofortige Beendigung des Abos (Stripe `subscriptions.cancel`). */
  cancelSubscriptionNow: (clerkUserId: string) => Promise<void>;
  /**
   * Kündigung zum Periodenende (Stripe `cancel_at_period_end`).
   * Rückgabe: Periodenende als ISO-String, falls Stripe es liefert.
   */
  cancelSubscriptionAtPeriodEnd: (
    clerkUserId: string,
  ) => Promise<{ periodEnd: string | null }>;
  deleteBlobs: (blobPaths: string[]) => Promise<void>;
  deleteClerkUser: (clerkUserId: string) => Promise<void>;
  /** HMAC-Pseudonym der Clerk-ID (für analytics_events); null = nicht ableitbar. */
  pseudonymFor: (clerkUserId: string) => Promise<string | null>;
  /** DB-Executor (Tests). Default: `getDb()`. */
  sql?: SqlTag;
  /** Uhr (Tests). Default: `new Date()`. */
  now?: () => Date;
}

export interface DeletionResult {
  clerkUserId: string;
  mode: AccountDeletionMode;
  /** true = nur vorgemerkt (Periodenende), es wurde NOCH nichts gelöscht. */
  scheduled: boolean;
  /** Zeitpunkt der geplanten Löschung (ISO) — nur bei `scheduled`. */
  scheduledFor: string | null;
  steps: string[];
  deletedImages: number;
  betaSignupPolicy: BetaSignupPolicy;
}

export interface RunDeletionOptions {
  mode?: AccountDeletionMode;
  policy?: BetaSignupPolicy;
}

async function resolveSql(deps: DeleteAccountDeps): Promise<SqlTag> {
  if (deps.sql) return deps.sql;
  const { getDb } = await import('../db/index');
  return getDb() as unknown as SqlTag;
}

/** Ist-Zustand einsammeln (VOR jeder Löschung). */
async function collectState(sql: SqlTag, clerkUserId: string) {
  const userRows = await sql`SELECT id, email FROM users WHERE clerk_id = ${clerkUserId} LIMIT 1`;
  const userUuid = userRows.length > 0 ? String(userRows[0].id) : null;
  const userEmail =
    userRows.length > 0 && userRows[0].email ? String(userRows[0].email) : null;

  const subRows = userUuid
    ? await sql`SELECT stripe_subscription_id FROM subscriptions
                 WHERE user_id = ${userUuid}::uuid AND stripe_subscription_id IS NOT NULL`
    : [];
  const hasSubscription = subRows.length > 0;
  const subscriptionId =
    subRows.length > 0 ? String(subRows[0].stripe_subscription_id ?? '') || null : null;

  const imageRows = userUuid
    ? await sql`SELECT blob_path FROM generated_images
                 WHERE user_id = ${userUuid}::uuid AND deleted_at IS NULL`
    : [];
  const blobPaths = imageRows.map((r) => String(r.blob_path));

  const betaRows = userEmail
    ? await sql`SELECT id FROM beta_signups WHERE LOWER(email) = ${userEmail.toLowerCase()} LIMIT 1`
    : [];

  return { userUuid, userEmail, hasSubscription, subscriptionId, blobPaths, betaRows };
}

/**
 * Führt die Löschung aus — oder merkt sie zum Periodenende vor.
 * Exportiert, damit Tests sie mit Fakes und einer Wegwerf-DB aufrufen können.
 */
export async function runAccountDeletion(
  clerkUserId: string,
  deps: DeleteAccountDeps,
  options: RunDeletionOptions = {},
): Promise<DeletionResult> {
  const mode: AccountDeletionMode = options.mode ?? 'immediate';
  const policy: BetaSignupPolicy = options.policy ?? BETA_SIGNUP_POLICY_DEFAULT;
  const sql = await resolveSql(deps);
  const now = deps.now ? deps.now() : new Date();
  const steps: string[] = [];

  const state = await collectState(sql, clerkUserId);
  const { userUuid, userEmail, hasSubscription, subscriptionId, blobPaths, betaRows } = state;

  const plan = buildDeletionPlan({
    hasSubscription,
    liveImageCount: blobPaths.length,
    hasBetaSignup: betaRows.length > 0,
    mode,
  });

  // ── Variante „zum Ende des bezahlten Zeitraums" ───────────────────────────
  // Hier wird NICHTS gelöscht: Abo auf Periodenende kündigen + Vormerkung
  // schreiben. Die eigentliche Löschung läuft über die zwei Trigger oben.
  if (mode === 'period_end') {
    if (!hasSubscription) {
      // Kein aktives Abo → diese Variante ist sinnlos und wird abgelehnt
      // (fail-closed, sonst entstünde eine Vormerkung, die nie fällig wird).
      throw new AccountDeletionError(
        'mode_not_available',
        'Diese Variante ist für dein Konto nicht verfügbar (kein aktives bezahltes Abo).',
      );
    }
    const { periodEnd } = await deps.cancelSubscriptionAtPeriodEnd(clerkUserId);
    steps.push('stripe_cancel_at_period_end');

    const scheduledFor = periodEnd ? new Date(periodEnd) : null;
    await sql`
      INSERT INTO account_deletion_requests
        (clerk_user_id, mode, status, stripe_subscription_id, scheduled_for, requested_at)
      VALUES (${clerkUserId}, ${'period_end'}, ${'pending'}, ${subscriptionId},
              ${scheduledFor ? scheduledFor.toISOString() : null}::timestamptz,
              ${now.toISOString()}::timestamptz)
      ON CONFLICT (clerk_user_id) DO UPDATE
        SET mode = EXCLUDED.mode,
            status = 'pending',
            stripe_subscription_id = EXCLUDED.stripe_subscription_id,
            scheduled_for = EXCLUDED.scheduled_for,
            requested_at = EXCLUDED.requested_at,
            cancelled_at = NULL,
            executed_at = NULL
    `;
    steps.push('schedule_deletion_request');

    return {
      clerkUserId,
      mode,
      scheduled: true,
      scheduledFor: scheduledFor ? scheduledFor.toISOString() : null,
      steps,
      deletedImages: 0,
      betaSignupPolicy: policy,
    };
  }

  // ── Variante „sofort" ─────────────────────────────────────────────────────
  // 1. Externe, BLOCKIERENDE Schritte: Abo beenden.
  //    Muss vor dem DB-Löschen passieren: sonst bucht ein laufendes Abo weiter,
  //    ohne dass eine Zuordnung zum Konto existiert.
  if (hasSubscription) {
    await deps.cancelSubscriptionNow(clerkUserId);
    steps.push('stripe_cancel_subscription');
  }

  // Kontrolle aus dem Plan: Jeder blockierende externe Schritt VOR der
  // DB-Löschung muss tatsächlich gelaufen sein — sonst wird nichts gelöscht.
  const mustRun = blockingStepsBeforeDbDelete(plan);
  const missing = mustRun.filter((s) => !steps.includes(s.id));
  if (missing.length > 0) {
    throw new Error(
      `Kontolöschung abgebrochen — Pflichtschritt fehlt: ${missing.map((s) => s.id).join(', ')}`,
    );
  }

  // 2. Blobs physisch löschen (nicht blockierend).
  if (blobPaths.length > 0) {
    try {
      await deps.deleteBlobs(blobPaths);
      steps.push('blob_delete_images');
    } catch (err) {
      // Nicht blockierend: die DB-Zeilen verschwinden trotzdem, der
      // TTL-Sweeper (delete_reason 'account_deleted') räumt den Rest.
      console.error('[account-delete] Blob-Löschung fehlgeschlagen:', err);
    }
  }

  // 3. Tabellen ohne Fremdschlüssel (TEXT-Clerk-ID).
  await sql`DELETE FROM usage_events WHERE user_id = ${clerkUserId}`;
  steps.push('delete_usage_events');
  await sql`DELETE FROM tracking_events WHERE user_id = ${clerkUserId}`;
  steps.push('delete_tracking_events');
  await sql`DELETE FROM generation_throttle WHERE user_id = ${clerkUserId}`;
  steps.push('delete_generation_throttle');

  const pseudonym = await deps.pseudonymFor(clerkUserId).catch(() => null);
  if (pseudonym) {
    await sql`DELETE FROM analytics_events WHERE user_pseudonym = ${pseudonym}`;
    steps.push('delete_analytics_events');
  }

  // 4. beta_signups — offene Owner-Entscheidung.
  if (policy === 'delete' && userEmail) {
    await sql`DELETE FROM beta_signups WHERE LOWER(email) = ${userEmail.toLowerCase()}`;
    steps.push('beta_signup_deleted');
  } else if (betaRows.length > 0) {
    steps.push('beta_signup_kept');
  }

  // 5. users → CASCADE (projects, content, subscriptions, usage_monthly,
  //    generated_images, publish_plan, performance_entries, preferences).
  if (userUuid) {
    await sql`DELETE FROM users WHERE id = ${userUuid}::uuid`;
    steps.push('delete_user_row');
  }

  // 6. Offene Vormerkung schließen (falls es eine gab).
  await sql`UPDATE account_deletion_requests
                SET status = 'executed', executed_at = ${now.toISOString()}::timestamptz
              WHERE clerk_user_id = ${clerkUserId} AND status = 'pending'`;
  steps.push('close_deletion_request');

  // 7. Clerk-Nutzer löschen — ZULETZT und BLOCKIEREND.
  //    Bliebe er bestehen, würde der nächste Login über ensureUserRow() sofort
  //    ein neues Konto anlegen (inkl. 3 frischer Free-Generierungen).
  await deps.deleteClerkUser(clerkUserId);
  steps.push('clerk_delete_user');

  return {
    clerkUserId,
    mode,
    scheduled: false,
    scheduledFor: null,
    steps,
    deletedImages: blobPaths.length,
    betaSignupPolicy: policy,
  };
}

/**
 * Trigger 1 — Stripe-Webhook `customer.subscription.deleted`.
 * Führt eine vorgemerkte Periodenende-Löschung sofort aus (der bezahlte
 * Zeitraum ist abgelaufen). Gibt `true` zurück, wenn etwas gelöscht wurde.
 * Fail-soft: ein Fehler hier darf den Webhook nicht 500 werden lassen.
 */
export async function maybeExecuteScheduledDeletion(
  clerkUserId: string,
  deps: DeleteAccountDeps,
): Promise<boolean> {
  const sql = await resolveSql(deps);
  const rows = await sql`
    SELECT clerk_user_id FROM account_deletion_requests
     WHERE clerk_user_id = ${clerkUserId} AND status = 'pending' AND mode = 'period_end'
     LIMIT 1
  `;
  if (rows.length === 0) return false;
  await runAccountDeletion(clerkUserId, deps, { mode: 'immediate' });
  return true;
}

export interface ScheduledDeletionRunResult {
  due: number;
  executed: number;
  failed: number;
  errors: string[];
}

/**
 * Trigger 2 — täglicher Cron (Sicherheitsnetz).
 * Führt alle fälligen Vormerkungen aus (`status = 'pending'` und
 * `scheduled_for <= jetzt`). Ein Fehler pro Konto bricht den Lauf NICHT ab.
 */
export async function runScheduledAccountDeletions(
  deps: DeleteAccountDeps,
  opts: { limit?: number } = {},
): Promise<ScheduledDeletionRunResult> {
  const sql = await resolveSql(deps);
  const now = deps.now ? deps.now() : new Date();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  const rows = await sql`
    SELECT clerk_user_id FROM account_deletion_requests
     WHERE status = 'pending'
       AND mode = 'period_end'
       AND scheduled_for IS NOT NULL
       AND scheduled_for <= ${now.toISOString()}::timestamptz
     ORDER BY scheduled_for ASC
     LIMIT ${limit}
  `;

  const result: ScheduledDeletionRunResult = {
    due: rows.length,
    executed: 0,
    failed: 0,
    errors: [],
  };

  for (const row of rows) {
    const clerkUserId = String(row.clerk_user_id ?? '');
    if (!clerkUserId) continue;
    try {
      await runAccountDeletion(clerkUserId, deps, { mode: 'immediate' });
      result.executed += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push(`${clerkUserId}: ${err instanceof Error ? err.message : String(err)}`);
      console.error('[account-delete] geplante Löschung fehlgeschlagen:', clerkUserId, err);
    }
  }
  return result;
}

/**
 * Produktiv-Abhängigkeiten (Stripe/Blob/Clerk). Bewusst erst hier geladen —
 * ein nicht ausgeführtes Löschen importiert nichts davon.
 */
export function productionDeletionDeps(): DeleteAccountDeps {
  return {
    cancelSubscriptionNow: async (clerkUserId) => {
      const secretKey = process.env.STRIPE_SECRET_KEY;
      if (!secretKey) throw new Error('Stripe is not configured');
      const { default: Stripe } = await import('stripe');
      const stripe = new Stripe(secretKey);
      const { qGetSubscriptionForUser } = await import('../db/queries');
      const row = await qGetSubscriptionForUser(clerkUserId);
      if (row?.stripeSubscriptionId) {
        await stripe.subscriptions.cancel(row.stripeSubscriptionId);
      }
    },
    cancelSubscriptionAtPeriodEnd: async (clerkUserId) => {
      const secretKey = process.env.STRIPE_SECRET_KEY;
      if (!secretKey) throw new Error('Stripe is not configured');
      const { default: Stripe } = await import('stripe');
      const stripe = new Stripe(secretKey);
      const { qGetSubscriptionForUser } = await import('../db/queries');
      const row = await qGetSubscriptionForUser(clerkUserId);
      if (!row?.stripeSubscriptionId) return { periodEnd: null };
      const updated = await stripe.subscriptions.update(row.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      // dahlia: current_period_end liegt am Subscription-ITEM, nicht am Objekt.
      const items = (updated as unknown as {
        items?: { data?: { current_period_end?: number }[] };
        current_period_end?: number;
      });
      const epoch =
        items?.items?.data?.[0]?.current_period_end ?? items?.current_period_end ?? null;
      return { periodEnd: epoch ? new Date(epoch * 1000).toISOString() : null };
    },
    deleteBlobs: async (paths) => {
      const { del } = await import('@vercel/blob');
      await del(paths);
    },
    deleteClerkUser: async (id) => {
      const secret = process.env.CLERK_SECRET_KEY;
      if (!secret) throw new Error('CLERK_SECRET_KEY is not configured');
      const res = await fetch(`https://api.clerk.com/v1/users/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Clerk user deletion failed (${res.status})`);
      }
    },
    pseudonymFor: async (id) => {
      try {
        const mod = (await import('../lib/tracking')) as Record<string, unknown>;
        const fn = mod.pseudonymForUser ?? mod.userPseudonym;
        if (typeof fn === 'function') {
          const value = await (fn as (x: string) => unknown)(id);
          return typeof value === 'string' && value ? value : null;
        }
        return null;
      } catch {
        return null;
      }
    },
  };
}
