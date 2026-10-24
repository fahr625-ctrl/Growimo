// ─────────────────────────────────────────────────────────────────────────────
// SELBSTBEDIENUNGS-KONTO-LÖSCHUNG — ENTWURF 2026-10-24, NICHT AKTIV
// ─────────────────────────────────────────────────────────────────────────────
// STATUS: ENTWURF. Dieser ServerFn ist NICHT geroutet, NICHT in der UI
// eingebunden und per Env-Flag hart abgeschaltet (`ACCOUNT_DELETE_ENABLED`,
// Default aus → jeder Aufruf endet mit `account_deletion_disabled`).
// Erst nach ausdrücklicher Owner-Freigabe: Flag setzen, Route/UI bauen,
// Konzeptpunkte aus KONTOLOESCHUNG-KONZEPT.md abarbeiten.
//
// Drei unabhängige Gates, alle fail-closed:
//   1. Flag (`ACCOUNT_DELETE_ENABLED=true`)   → sonst nichts.
//   2. Session (ausschließlich aus dem Cookie, NIE aus dem Payload) → sonst nichts.
//   3. Bestätigungswort „LOESCHEN"            → sonst nichts.
//
// Reihenfolge: siehe `buildDeletionPlan()` — externe Systeme ZUERST, weil nach
// dem Löschen der `users`-Zeile Subscription-ID und Blob-Pfade nicht mehr
// zuordenbar wären.
// ─────────────────────────────────────────────────────────────────────────────
import { createServerFn } from '@tanstack/react-start';
import {
  AccountDeletionError,
  BETA_SIGNUP_POLICY_DEFAULT,
  assertAccountDeletionAllowed,
  blockingStepsBeforeDbDelete,
  buildDeletionPlan,
  isAccountDeletionEnabled,
  type BetaSignupPolicy,
} from './deletion-plan';

/** Injizierbare Außenwelt — im Test durch Fakes ersetzbar, produktiv echt. */
export interface DeleteAccountDeps {
  cancelSubscription: (clerkUserId: string) => Promise<void>;
  deleteBlobs: (blobPaths: string[]) => Promise<void>;
  deleteClerkUser: (clerkUserId: string) => Promise<void>;
  /** HMAC-Pseudonym der Clerk-ID (für analytics_events); null = nicht ableitbar. */
  pseudonymFor: (clerkUserId: string) => Promise<string | null>;
}

export interface DeletionResult {
  clerkUserId: string;
  steps: string[];
  deletedImages: number;
  betaSignupPolicy: BetaSignupPolicy;
}

/**
 * Führt die Löschung aus. Exportiert, damit die Tests sie mit Fakes und einer
 * Wegwerf-DB aufrufen können — der ServerFn unten ist nur die Hülle.
 */
export async function runAccountDeletion(
  clerkUserId: string,
  deps: DeleteAccountDeps,
  policy: BetaSignupPolicy = BETA_SIGNUP_POLICY_DEFAULT,
): Promise<DeletionResult> {
  const { getDb } = await import('../db/index');
  const sql = getDb();
  const steps: string[] = [];

  // ── Ist-Zustand einsammeln (VOR jeder Löschung) ───────────────────────────
  const userRows = await sql`
    SELECT id, email FROM users WHERE clerk_id = ${clerkUserId} LIMIT 1
  `;
  const userUuid = userRows.length > 0 ? String(userRows[0].id) : null;
  const userEmail = userRows.length > 0 && userRows[0].email ? String(userRows[0].email) : null;

  const subRows = userUuid
    ? await sql`SELECT stripe_subscription_id FROM subscriptions
                 WHERE user_id = ${userUuid}::uuid AND stripe_subscription_id IS NOT NULL`
    : [];
  const hasSubscription = subRows.length > 0;

  const imageRows = userUuid
    ? await sql`SELECT blob_path FROM generated_images
                 WHERE user_id = ${userUuid}::uuid AND deleted_at IS NULL`
    : [];
  const blobPaths = imageRows.map((r) => String((r as { blob_path: unknown }).blob_path));

  const betaRows = userEmail
    ? await sql`SELECT id FROM beta_signups WHERE LOWER(email) = ${userEmail.toLowerCase()} LIMIT 1`
    : [];

  const plan = buildDeletionPlan({
    hasSubscription,
    liveImageCount: blobPaths.length,
    hasBetaSignup: betaRows.length > 0,
  });

  // ── 1. Externe, BLOCKIERENDE Schritte: Abo beenden ────────────────────────
  // Muss vor dem DB-Löschen passieren: sonst bucht ein laufendes Abo weiter,
  // ohne dass eine Zuordnung zum Konto existiert.
  if (hasSubscription) {
    await deps.cancelSubscription(clerkUserId);
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

  // ── 2. Blobs physisch löschen (nicht blockierend) ────────────────────────
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

  // ── 3. Tabellen ohne Fremdschlüssel (TEXT-Clerk-ID) ──────────────────────
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

  // ── 4. beta_signups — offene Owner-Entscheidung ──────────────────────────
  if (policy === 'delete' && userEmail) {
    await sql`DELETE FROM beta_signups WHERE LOWER(email) = ${userEmail.toLowerCase()}`;
    steps.push('beta_signup_deleted');
  } else if (betaRows.length > 0) {
    steps.push('beta_signup_kept');
  }

  // ── 5. users → CASCADE (projects, content, subscriptions, usage_monthly,
  //       generated_images, publish_plan, performance_entries, preferences) ─
  if (userUuid) {
    await sql`DELETE FROM users WHERE id = ${userUuid}::uuid`;
    steps.push('delete_user_row');
  }

  // ── 6. Clerk-Nutzer löschen — ZULETZT und BLOCKIEREND ───────────────────
  // Bliebe er bestehen, würde der nächste Login über ensureUserRow() sofort
  // ein neues Konto anlegen (inkl. 3 frischer Free-Generierungen).
  await deps.deleteClerkUser(clerkUserId);
  steps.push('clerk_delete_user');

  return {
    clerkUserId,
    steps,
    deletedImages: blobPaths.length,
    betaSignupPolicy: policy,
  };
}

/**
 * ServerFn-Hülle. NICHT geroutet, NICHT in der UI verwendet.
 * `confirmation` ist das vom Nutzer getippte Bestätigungswort.
 */
export const deleteAccount = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const d = data as { confirmation?: unknown };
    return { confirmation: d?.confirmation };
  })
  .handler(async ({ data }) => {
    // Identität NUR aus der Session (kein Payload-Fallback — sonst könnte
    // jeder fremde Konten löschen).
    const { resolveUserIdFromServerFn } = await import('../lib/usage-guard');
    const sessionUserId = await resolveUserIdFromServerFn(undefined);

    const clerkUserId = assertAccountDeletionAllowed({
      clerkUserId: sessionUserId,
      confirmation: data.confirmation,
      enabled: isAccountDeletionEnabled(),
    });

    // Produktiv-Abhängigkeiten. Bewusst erst hier geladen (Code ist inaktiv,
    // solange das Flag aus ist — dann wird nichts davon importiert).
    const deps: DeleteAccountDeps = {
      cancelSubscription: async (id) => {
        const secretKey = process.env.STRIPE_SECRET_KEY;
        if (!secretKey) throw new Error('Stripe is not configured');
        const { default: Stripe } = await import('stripe');
        const stripe = new Stripe(secretKey);
        const { qGetSubscriptionForUser } = await import('../db/queries');
        const row = await qGetSubscriptionForUser(id);
        if (row?.stripeSubscriptionId) {
          await stripe.subscriptions.cancel(row.stripeSubscriptionId);
        }
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

    return runAccountDeletion(clerkUserId, deps);
  });

export { AccountDeletionError };
