// ─────────────────────────────────────────────────────────────────────────────
// KONTO-LÖSCHUNG (Selbstbedienung) — Test-Suite (2026-10-24)
//   Owner-Entscheidung 2026-10-24: „einbauen. Bei laufenden bezahlten
//   Abonnements eine Auswahl zwischen sofortiger Löschung und Löschung zum Ende
//   des bezahlten Zeitraums. Vorher deutlich über Datenverlust und mögliche
//   Auswirkungen auf den Abonnementvertrag informieren."
//
// Usage (aus der Repo-Wurzel):
//   bun --env-file=.env kontoloeschung-entwurf-test.ts
//
// KEIN DB-Schreibzugriff, KEIN Stripe-/Clerk-/Blob-Aufruf: der SQL-Executor und
// alle Außenwelt-Abhängigkeiten werden injiziert (Fakes). Geprüft werden
// Regeln, Auswahl-Logik, Warnhinweise, Gate gegen Fremd-Löschung,
// Bestätigungswort, die Reihenfolge der Aufrufe (Stripe → DB → Clerk) und die
// Quelltext-Belege für Route/Trigger.
// Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import {
  ACCOUNT_DELETE_CONFIRMATION_WORD,
  ACCOUNT_DELETE_FLAG,
  ACCOUNT_DELETE_LOSS_ITEMS,
  AccountDeletionError,
  BETA_SIGNUP_POLICY_DEFAULT,
  assertAccountDeletionAllowed,
  availableDeletionOptions,
  blockingStepsBeforeDbDelete,
  buildDeletionPlan,
  confirmationMatches,
  deletionModeNoticeKeys,
  isAccountDeletionEnabled,
  parseDeletionMode,
  resolveDeletionMode,
} from './src/account/deletion-plan';
import {
  maybeExecuteScheduledDeletion,
  productionDeletionDeps,
  runAccountDeletion,
  runScheduledAccountDeletions,
  type DeleteAccountDeps,
  type SqlTag,
} from './src/account/deletion-runner';
import { analyticsPseudonymFor } from './src/lib/analytics-pseudonym';

let passed = 0;
let failed = 0;
const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ PASS: ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ FAIL: ${label}`);
  }
};
const read = (p: string) => readFileSync(p, 'utf8');
const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return 'no_throw';
  } catch (err) {
    return err instanceof AccountDeletionError ? err.code : `other:${String(err)}`;
  }
};

// ── Fake-SQL: zeichnet jede Anweisung in `order` auf ────────────────────────
function makeFakeSql(
  opts: {
    hasSubscription?: boolean;
    blobCount?: number;
    dueRows?: number[];
    pending?: boolean;
    /** beta_signups-Zeile vorhanden? (Fix A2: muss mitgelöscht werden) */
    betaSignup?: boolean;
    /** E-Mail in der users-Zeile; `null` = kein Wert (Platzhalter-/Anonymkonto) */
    userEmail?: string | null;
  } = {},
) {
  const order: string[] = [];
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ text, values });
    if (/SELECT id, email FROM users/i.test(text)) {
      order.push('db:select_users');
      return [
        {
          id: 'uuid-user',
          email: opts.userEmail === undefined ? 'kunde@example.com' : opts.userEmail,
        },
      ];
    }
    if (/SELECT stripe_subscription_id FROM subscriptions/i.test(text)) {
      order.push('db:select_subs');
      return opts.hasSubscription === false ? [] : [{ stripe_subscription_id: 'sub_123' }];
    }
    if (/SELECT blob_path FROM generated_images/i.test(text)) {
      order.push('db:select_images');
      const n = opts.blobCount ?? 0;
      return Array.from({ length: n }, (_, i) => ({ blob_path: `blob-${i}` }));
    }
    if (/SELECT id FROM beta_signups/i.test(text)) {
      order.push('db:select_beta');
      return opts.betaSignup ? [{ id: 'beta-1' }] : [];
    }
    if (/SELECT clerk_user_id FROM account_deletion_requests/i.test(text)) {
      order.push('db:select_requests');
      if (opts.dueRows) return opts.dueRows.map((i) => ({ clerk_user_id: `user_${i}` }));
      return opts.pending ? [{ clerk_user_id: 'user_1' }] : [];
    }
    if (/INSERT INTO account_deletion_requests/i.test(text)) {
      order.push('db:insert_request');
      return [{ id: 'req-1' }];
    }
    if (/UPDATE account_deletion_requests/i.test(text)) {
      order.push('db:close_request');
      return [];
    }
    const del = text.match(/DELETE FROM (\w+)/i);
    if (del) {
      order.push(`db:delete_${del[1]}`);
      return [];
    }
    order.push('db:other');
    return [];
  }) as SqlTag;
  return { sql, order, calls, valuesOf: () => order.slice() };
}

function makeDeps(
  order: string[],
  sql: SqlTag,
  overrides: Partial<DeleteAccountDeps> = {},
): DeleteAccountDeps {
  return {
    cancelSubscriptionNow: async () => {
      order.push('stripe:cancel_now');
    },
    cancelSubscriptionAtPeriodEnd: async () => {
      order.push('stripe:cancel_at_period_end');
      return { periodEnd: '2026-11-30T00:00:00.000Z' };
    },
    deleteBlobs: async (paths) => {
      order.push(`blob:delete(${paths.length})`);
    },
    deleteClerkUser: async () => {
      order.push('clerk:delete');
    },
    pseudonymFor: async () => 'pseudonym-test-fix1',
    sql,
    now: () => new Date('2026-10-24T12:00:00.000Z'),
    ...overrides,
  };
}

console.log('=== (a) Flag: Kill-Switch, Default AN (Vorschau sichtbar) ===');
check(ACCOUNT_DELETE_FLAG === 'ACCOUNT_DELETE_ENABLED', 'Flag-Name dokumentiert');
check(isAccountDeletionEnabled({}) === true, 'ohne Env → AN (Preview zeigt die Funktion)');
check(
  isAccountDeletionEnabled({ ACCOUNT_DELETE_ENABLED: undefined }) === true,
  'undefined → AN',
);
check(isAccountDeletionEnabled({ ACCOUNT_DELETE_ENABLED: '' }) === true, 'leer → AN');
check(isAccountDeletionEnabled({ ACCOUNT_DELETE_ENABLED: 'true' }) === true, "'true' → AN");
check(isAccountDeletionEnabled({ ACCOUNT_DELETE_ENABLED: 'false' }) === false, "'false' → AUS (Kill-Switch)");
check(isAccountDeletionEnabled({ ACCOUNT_DELETE_ENABLED: ' FALSE ' }) === false, "' FALSE ' → AUS");
check(isAccountDeletionEnabled({ ACCOUNT_DELETE_ENABLED: '0' }) === false, "'0' → AUS");
check(isAccountDeletionEnabled({ ACCOUNT_DELETE_ENABLED: 'off' }) === false, "'off' → AUS");
check(isAccountDeletionEnabled({ ACCOUNT_DELETE_ENABLED: 'no' }) === false, "'no' → AUS");

console.log('=== (b) Bestätigungswort ===');
check(confirmationMatches(ACCOUNT_DELETE_CONFIRMATION_WORD), 'LOESCHEN akzeptiert');
check(confirmationMatches('löschen'), 'löschen (Umlaut, klein) akzeptiert');
check(confirmationMatches('LÖSCHEN'), 'LÖSCHEN akzeptiert');
check(confirmationMatches('  Loeschen  '), 'Leerzeichen + gemischte Schreibung akzeptiert');
check(!confirmationMatches('ja'), "'ja' abgelehnt");
check(!confirmationMatches(''), 'leer abgelehnt');
check(!confirmationMatches(null), 'null abgelehnt');
check(!confirmationMatches(undefined), 'undefined abgelehnt');

console.log('=== (c) Gate: drei unabhängige Sperren ===');
check(
  codeOf(() =>
    assertAccountDeletionAllowed({
      clerkUserId: 'user_X',
      confirmation: 'LOESCHEN',
      enabled: false,
    }),
  ) === 'account_deletion_disabled',
  'Kill-Switch aus → account_deletion_disabled (auch bei korrektem Wort)',
);
check(
  codeOf(() =>
    assertAccountDeletionAllowed({ clerkUserId: null, confirmation: 'LOESCHEN', enabled: true }),
  ) === 'no_session',
  'ohne Session → no_session',
);
check(
  codeOf(() =>
    assertAccountDeletionAllowed({
      clerkUserId: 'anonymous',
      confirmation: 'LOESCHEN',
      enabled: true,
    }),
  ) === 'no_session',
  "'anonymous' → no_session",
);
check(
  codeOf(() =>
    assertAccountDeletionAllowed({
      clerkUserId: 'user_X',
      confirmation: 'bitte',
      enabled: true,
    }),
  ) === 'confirmation_mismatch',
  'falsches Wort → confirmation_mismatch (serverseitig)',
);
let returned: string | null = null;
try {
  returned = assertAccountDeletionAllowed({
    clerkUserId: 'user_X',
    confirmation: 'LOESCHEN',
    enabled: true,
  });
} catch {
  returned = null;
}
check(returned === 'user_X', 'alle Gates offen → Session-UserId wird zurückgegeben');

console.log('=== (d) Auswahl-Logik: Abo aktiv → beide Wege, sonst nur sofort ===');
check(
  JSON.stringify(availableDeletionOptions({ hasActivePaidSubscription: true })) ===
    JSON.stringify(['immediate', 'period_end']),
  'aktives bezahltes Abo → BEIDE Optionen',
);
check(
  JSON.stringify(availableDeletionOptions({ hasActivePaidSubscription: false })) ===
    JSON.stringify(['immediate']),
  'kein Abo → NUR sofort (keine irreführende Auswahl)',
);
check(parseDeletionMode('immediate') === 'immediate', "parse 'immediate'");
check(parseDeletionMode(' PERIOD_END ') === 'period_end', "parse 'period_end' (trim/case)");
check(parseDeletionMode('spaeter') === null, 'unbekannter Modus → null');
check(parseDeletionMode(undefined) === null, 'undefined → null');
check(
  resolveDeletionMode({ requested: 'period_end', hasActivePaidSubscription: true }) ===
    'period_end',
  'Abo aktiv + period_end → erlaubt',
);
check(
  codeOf(() => resolveDeletionMode({ requested: 'period_end', hasActivePaidSubscription: false })) ===
    'mode_not_available',
  'kein Abo + period_end → mode_not_available',
);
check(
  codeOf(() => resolveDeletionMode({ requested: 'quatsch', hasActivePaidSubscription: true })) ===
    'mode_invalid',
  'unbekannter Modus → mode_invalid',
);
check(
  codeOf(() => resolveDeletionMode({ requested: undefined, hasActivePaidSubscription: true })) ===
    'mode_invalid',
  'fehlender Modus → mode_invalid (fail-closed)',
);

console.log('=== (e) Warnhinweise (Owner: deutlich über Datenverlust informieren) ===');
check(ACCOUNT_DELETE_LOSS_ITEMS.length >= 6, 'mindestens 6 Verlust-Punkte');
for (const item of [
  'projects_and_content',
  'generated_images',
  'saved_preferences',
  'usage_and_history',
  'generation_quota',
  'account_access',
]) {
  check((ACCOUNT_DELETE_LOSS_ITEMS as readonly string[]).includes(item), `Verlust-Punkt: ${item}`);
}
check(
  deletionModeNoticeKeys('immediate').includes('subscription_ends_immediately'),
  'sofort: Abo endet sofort (Hinweis)',
);
check(
  deletionModeNoticeKeys('immediate').includes('access_ends_immediately'),
  'sofort: Zugriff endet sofort (Hinweis)',
);
check(
  deletionModeNoticeKeys('period_end').includes('access_until_period_end'),
  'Periodenende: Zugriff bleibt bis zum Ende (Hinweis)',
);
check(
  deletionModeNoticeKeys('period_end').includes('no_prorated_refund'),
  'beide: keine automatische anteilige Erstattung (neutral formuliert)',
);
const i18nDe = read('./src/i18n/de.ts');
const i18nEn = read('./src/i18n/en.ts');
for (const key of [
  'account_delete_warning_heading',
  'account_delete_warning_intro',
  'account_delete_loss_generated_images',
  'account_delete_notice_no_prorated_refund',
  'account_delete_confirm_hint',
]) {
  check(i18nDe.includes(`${key}:`), `DE-Text vorhanden: ${key}`);
  check(i18nEn.includes(`${key}:`), `EN-Text vorhanden: ${key}`);
}

console.log('=== (f) Löschplan: Reihenfolge, beide Varianten ===');
const planNow = buildDeletionPlan({
  hasSubscription: true,
  liveImageCount: 3,
  hasBetaSignup: true,
  mode: 'immediate',
});
const idsNow = planNow.map((s) => s.id);
const idxNow = (id: string) => idsNow.indexOf(id);
check(idxNow('stripe_cancel_subscription') === 0, 'sofort: Stripe-Kündigung ist Schritt 1');
check(
  idxNow('stripe_cancel_subscription') < idxNow('delete_user_row'),
  'Abo wird VOR der users-Zeile beendet (sonst bucht es ohne Zuordnung weiter)',
);
check(
  idxNow('blob_delete_images') < idxNow('delete_user_row'),
  'Blobs werden VOR der users-Zeile gelöscht (Pfade danach nicht mehr ermittelbar)',
);
check(idxNow('clerk_delete_user') === idsNow.length - 1, 'Clerk-Löschung ist der LETZTE Schritt');
check(idxNow('delete_user_row') < idxNow('clerk_delete_user'), 'users-Zeile vor Clerk-Nutzer');
for (const t of [
  'delete_usage_events',
  'delete_tracking_events',
  'delete_generation_throttle',
  'delete_analytics_events',
  'delete_beta_signup',
  'delete_user_row',
  'clerk_delete_user',
]) {
  check(idsNow.includes(t), `Schritt vorhanden: ${t}`);
}
check(
  BETA_SIGNUP_POLICY_DEFAULT === 'delete',
  'beta_signups: Default ist LÖSCHEN (Owner-Entscheidung 2026-10-25)',
);
check(
  planNow.find((s) => s.id === 'delete_beta_signup')?.blocking === true,
  'beta_signups-Löschung ist blockierend (kein stiller Skip)',
);
check(
  planNow.find((s) => s.id === 'delete_usage_events')?.reason.includes('TEXT') === true,
  'Begründung nennt den fehlenden Fremdschlüssel (TEXT-Clerk-ID)',
);
const planLater = buildDeletionPlan({
  hasSubscription: true,
  liveImageCount: 1,
  hasBetaSignup: false,
  mode: 'period_end',
});
const idsLater = planLater.map((s) => s.id);
check(
  idsLater.includes('stripe_cancel_at_period_end'),
  'Periodenende: cancel_at_period_end statt sofortiger Kündigung',
);
check(!idsLater.includes('stripe_cancel_subscription'), 'Periodenende: KEINE sofortige Kündigung');
check(
  idsLater.includes('schedule_deletion_request') &&
    planLater.find((s) => s.id === 'schedule_deletion_request')?.deferred === true,
  'Periodenende: Löschung wird vorgemerkt (deferred)',
);
check(
  planLater.findIndex((s) => s.id === 'schedule_deletion_request') <
    planLater.findIndex((s) => s.id === 'delete_user_row'),
  'Vormerkung liegt VOR der users-Zeile im Plan',
);
const planNoSub = buildDeletionPlan({
  hasSubscription: false,
  liveImageCount: 0,
  hasBetaSignup: false,
});
check(
  planNoSub.find((s) => s.id === 'stripe_cancel_subscription')?.blocking === false,
  'ohne Abo ist die Stripe-Kündigung nicht blockierend',
);
const blockingNow = blockingStepsBeforeDbDelete(planNow);
check(
  blockingNow.length === 2 &&
    blockingNow[0].id === 'stripe_cancel_subscription' &&
    blockingNow[1].id === 'blob_delete_images',
  'zwei blockierende externe Schritte vor der DB-Löschung (Stripe + Blobs, Fix C2)',
);
check(
  buildDeletionPlan({ hasSubscription: true, liveImageCount: 0, hasBetaSignup: false }).find(
    (s) => s.id === 'blob_delete_images',
  )?.blocking === false,
  'ohne Bilder ist die Blob-Löschung nicht blockierend',
);

console.log('=== (g) Ausführung: Stripe VOR DB VOR Clerk (Fakes) ===');
{
  const fake = makeFakeSql({ hasSubscription: true, blobCount: 2 });
  const deps = makeDeps(fake.order, fake.sql);
  const result = await runAccountDeletion('user_1', deps, { mode: 'immediate' });
  const o = fake.order;
  check(result.scheduled === false, 'sofort: nichts vorgemerkt');
  check(o.includes('stripe:cancel_now'), 'Abo wurde beendet');
  check(o.includes('blob:delete(2)'), 'beide Blobs wurden physisch gelöscht');
  check(
    o.indexOf('stripe:cancel_now') < o.indexOf('db:delete_users'),
    'REIHENFOLGE: Stripe-Kündigung VOR dem Löschen der users-Zeile',
  );
  check(
    o.indexOf('blob:delete(2)') < o.indexOf('db:delete_users'),
    'REIHENFOLGE: Blobs VOR der users-Zeile',
  );
  check(
    o.indexOf('db:delete_users') < o.indexOf('clerk:delete'),
    'REIHENFOLGE: users-Zeile VOR der Clerk-Löschung',
  );
  check(o.indexOf('stripe:cancel_now') < o.indexOf('clerk:delete'), 'Stripe VOR Clerk');
  for (const step of [
    'delete_usage_events',
    'delete_tracking_events',
    'delete_generation_throttle',
    'delete_user_row',
    'clerk_delete_user',
  ]) {
    check(result.steps.includes(step), `Schritt ausgeführt: ${step}`);
  }
  check(result.deletedImages === 2, 'Rückgabe nennt die Anzahl gelöschter Bilder');
}
{
  // Ohne Abo: keine Stripe-Aktion, aber volle Löschung.
  const fake = makeFakeSql({ hasSubscription: false, blobCount: 0 });
  const deps = makeDeps(fake.order, fake.sql);
  const result = await runAccountDeletion('user_2', deps, { mode: 'immediate' });
  check(!fake.order.includes('stripe:cancel_now'), 'ohne Abo: kein Stripe-Aufruf');
  check(result.steps.includes('delete_user_row'), 'ohne Abo: users-Zeile wird gelöscht');
  check(fake.order.includes('clerk:delete'), 'ohne Abo: Clerk-Nutzer wird gelöscht');
}

console.log('=== (h) Periodenende: NICHT sofort löschen, sondern vormerken ===');
{
  const fake = makeFakeSql({ hasSubscription: true, blobCount: 3 });
  const deps = makeDeps(fake.order, fake.sql);
  const result = await runAccountDeletion('user_3', deps, { mode: 'period_end' });
  check(result.scheduled === true, 'period_end: scheduled = true');
  check(result.scheduledFor === '2026-11-30T00:00:00.000Z', 'Periodenende wird zurückgegeben');
  check(fake.order.includes('stripe:cancel_at_period_end'), 'cancel_at_period_end wurde gesetzt');
  check(fake.order.includes('db:insert_request'), 'Vormerkung wurde geschrieben');
  check(!fake.order.some((o) => o === 'db:delete_users'), 'period_end: KEINE users-Löschung jetzt');
  check(!fake.order.some((o) => o.startsWith('db:delete_')), 'period_end: KEINE Tabellen-Löschung jetzt');
  check(!fake.order.includes('clerk:delete'), 'period_end: KEIN Clerk-Löschen jetzt');
  check(!fake.order.includes('blob:delete(3)'), 'period_end: KEINE Blob-Löschung jetzt');
}
{
  // period_end ohne Abo → fail-closed (sonst Vormerkung, die nie fällig wird).
  const fake = makeFakeSql({ hasSubscription: false });
  const deps = makeDeps(fake.order, fake.sql);
  let code = 'no_throw';
  try {
    await runAccountDeletion('user_4', deps, { mode: 'period_end' });
  } catch (err) {
    code = err instanceof AccountDeletionError ? err.code : 'other';
  }
  check(code === 'mode_not_available', 'period_end ohne Abo → mode_not_available (nichts gelöscht)');
  check(!fake.order.includes('db:insert_request'), 'keine Vormerkung bei fehlendem Abo');
}

console.log('=== (i) Trigger: Webhook und Cron führen die Vormerkung aus ===');
{
  const fake = makeFakeSql({ hasSubscription: true, blobCount: 0, pending: true });
  const deps = makeDeps(fake.order, fake.sql);
  const executed = await maybeExecuteScheduledDeletion('user_5', deps);
  check(executed === true, 'Webhook-Trigger: fällige Vormerkung wird ausgeführt');
  check(fake.order.includes('clerk:delete'), 'Webhook-Trigger: vollständige Löschung gelaufen');
}
{
  const fake = makeFakeSql({ hasSubscription: true, blobCount: 0, pending: false });
  const deps = makeDeps(fake.order, fake.sql);
  const executed = await maybeExecuteScheduledDeletion('user_6', deps);
  check(executed === false, 'Webhook-Trigger: ohne Vormerkung passiert nichts');
  check(!fake.order.includes('clerk:delete'), 'Webhook-Trigger: kein Konto gelöscht');
}
{
  const fake = makeFakeSql({ hasSubscription: true, blobCount: 0, dueRows: [1, 2] });
  const deps = makeDeps(fake.order, fake.sql);
  const res = await runScheduledAccountDeletions(deps);
  check(res.due === 2, 'Cron-Trigger: zwei fällige Vormerkungen gefunden');
  check(res.executed === 2, 'Cron-Trigger: beide ausgeführt');
  check(res.failed === 0, 'Cron-Trigger: keine Fehler');
}

console.log('=== (i2) FIX 1 / C1: analytics_events werden wirklich gelöscht ===');
{
  const SALT = 'test-salt-fix1';
  const prevSalt = process.env.ANALYTICS_SALT;
  process.env.ANALYTICS_SALT = SALT;
  const clerkId = 'user_FIX1abc';
  // Unabhängig nachgerechnet (nicht über die getestete Funktion):
  const expected = createHmac('sha256', SALT).update(clerkId).digest('hex');

  check(
    analyticsPseudonymFor(clerkId) === expected,
    'kanonische Funktion = HMAC-SHA256(Salt, Clerk-ID) hex (unabhängig nachgerechnet)',
  );
  check(
    analyticsPseudonymFor(clerkId)?.length === 64 &&
      analyticsPseudonymFor(clerkId) === analyticsPseudonymFor(clerkId),
    'Pseudonym ist deterministisch und 64 Hex-Zeichen lang',
  );
  check(
    analyticsPseudonymFor('user_other') !== analyticsPseudonymFor(clerkId),
    'andere Clerk-ID → anderes Pseudonym',
  );
  check(analyticsPseudonymFor(null) === null, 'ohne Clerk-ID → null');

  // Produktiv-Deps MÜSSEN exakt dieses Pseudonym liefern (Kern des Fixes:
  // vorher lieferte der dynamische Lookup immer null).
  const prodPseudo = await productionDeletionDeps().pseudonymFor(clerkId);
  check(
    prodPseudo === expected,
    'productionDeletionDeps().pseudonymFor liefert dasselbe Pseudonym wie die Schreibseite',
  );

  const fake = makeFakeSql({ hasSubscription: false, blobCount: 0 });
  const deps = makeDeps(fake.order, fake.sql, {
    pseudonymFor: async (id) => analyticsPseudonymFor(id),
  });
  const result = await runAccountDeletion(clerkId, deps, { mode: 'immediate' });
  const delCall = fake.calls.find((c) => /DELETE FROM analytics_events/i.test(c.text));
  check(Boolean(delCall), 'DELETE FROM analytics_events wird tatsächlich abgesetzt');
  check(
    delCall?.values?.[0] === expected,
    'DELETE nutzt exakt das Pseudonym, das die Schreibseite berechnet',
  );
  check(
    result.steps.includes('delete_analytics_events'),
    'Schritt delete_analytics_events erscheint im Ergebnis',
  );

  // Ohne Salt: kein stiller Skip — und kein Abbruch der Kontolöschung.
  delete process.env.ANALYTICS_SALT;
  const fake2 = makeFakeSql({ hasSubscription: false, blobCount: 0 });
  const deps2 = makeDeps(fake2.order, fake2.sql, {
    pseudonymFor: async (id) => analyticsPseudonymFor(id),
  });
  const result2 = await runAccountDeletion('user_nosalt', deps2, { mode: 'immediate' });
  check(
    !fake2.calls.some((c) => /DELETE FROM analytics_events/i.test(c.text)),
    'ohne Salt: kein DELETE (es wird nichts Falsches gelöscht)',
  );
  check(
    result2.steps.includes('delete_analytics_events_skipped_no_pseudonym'),
    'ohne Salt: Schritt wird ausdrücklich als übersprungen ausgewiesen (kein stiller Skip)',
  );
  check(
    result2.steps.includes('clerk_delete_user'),
    'ohne Salt: Löschung läuft trotzdem durch (Konto bleibt löschbar)',
  );

  if (prevSalt === undefined) delete process.env.ANALYTICS_SALT;
  else process.env.ANALYTICS_SALT = prevSalt;
}

console.log('=== (i3) FIX 2 / C2: Blob-Löschung blockierend, VOR der DB-Kaskade ===');
{
  const fake = makeFakeSql({ hasSubscription: false, blobCount: 2 });
  const deps = makeDeps(fake.order, fake.sql, {
    deleteBlobs: async () => {
      throw new Error('blob store 500');
    },
  });
  let err = '';
  try {
    await runAccountDeletion('user_blobfail', deps, { mode: 'immediate' });
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check(
    err.includes('blob store 500'),
    'fehlgeschlagenes del() bricht den Lauf ab (kein stilles Weiterlaufen)',
  );
  check(!fake.order.includes('db:delete_users'), 'users-Zeile bleibt erhalten (Kaskade nicht gelaufen)');
  check(
    !fake.order.some((o) => o.startsWith('db:delete_')),
    'keine einzige Tabellen-Löschung nach dem Blob-Fehler (Wiederholung möglich)',
  );
  check(!fake.order.includes('clerk:delete'), 'Clerk-Nutzer bleibt erhalten (Lauf wiederholbar)');
}
{
  const fake = makeFakeSql({ hasSubscription: false, blobCount: 2 });
  const deps = makeDeps(fake.order, fake.sql);
  await runAccountDeletion('user_blobok', deps, { mode: 'immediate' });
  const firstDbDelete = fake.order.findIndex((o) => o.startsWith('db:delete_'));
  check(
    fake.order.indexOf('blob:delete(2)') > -1 &&
      firstDbDelete > -1 &&
      fake.order.indexOf('blob:delete(2)') < firstDbDelete,
    'Blobs sind VOR der ersten Tabellen-Löschung physisch entfernt',
  );
}

console.log('=== (i4) FIX 3 / A2: beta_signups-Zeile wird mitgelöscht ===');
{
  const fake = makeFakeSql({ hasSubscription: false, blobCount: 0, betaSignup: true });
  const deps = makeDeps(fake.order, fake.sql);
  const result = await runAccountDeletion('user_beta', deps, { mode: 'immediate' });
  const call = fake.calls.find((c) => /DELETE FROM beta_signups/i.test(c.text));
  check(Boolean(call), 'DELETE FROM beta_signups wird abgesetzt (Default-Policy)');
  check(
    call?.values?.[0] === 'kunde@example.com',
    'Löschung nutzt die VOR dem users-Delete gemerkte E-Mail',
  );
  check(result.steps.includes('beta_signup_deleted'), 'Schritt beta_signup_deleted im Ergebnis');
  check(
    fake.order.indexOf('db:delete_beta_signups') < fake.order.indexOf('db:delete_users'),
    'beta_signups wird VOR der users-Zeile gelöscht (E-Mail noch ermittelbar)',
  );
}
{
  const fake = makeFakeSql({
    hasSubscription: false,
    blobCount: 0,
    betaSignup: true,
    userEmail: 'Kunde@Example.COM',
  });
  const deps = makeDeps(fake.order, fake.sql);
  await runAccountDeletion('user_beta2', deps, { mode: 'immediate' });
  const call = fake.calls.find((c) => /DELETE FROM beta_signups/i.test(c.text));
  check(
    call?.values?.[0] === 'kunde@example.com',
    'E-Mail wird case-insensitiv gematcht (LOWER), passend zum SELECT',
  );
}
{
  const fake = makeFakeSql({ hasSubscription: false, blobCount: 0, betaSignup: false });
  const deps = makeDeps(fake.order, fake.sql);
  const result = await runAccountDeletion('user_beta3', deps, { mode: 'immediate' });
  check(
    result.steps.includes('beta_signup_none_found'),
    'ohne Treffer: kein Fehler, sichtbarer Schritt beta_signup_none_found',
  );
}
{
  // Testkonto mit Platzhalter-Adresse: matcht nichts — harmlos, kein Fehler.
  const fake = makeFakeSql({
    hasSubscription: false,
    blobCount: 0,
    betaSignup: false,
    userEmail: 'anon-user_x@growimo.local',
  });
  const deps = makeDeps(fake.order, fake.sql);
  const result = await runAccountDeletion('user_beta4', deps, { mode: 'immediate' });
  check(
    result.steps.includes('clerk_delete_user') && result.steps.includes('delete_user_row'),
    'Platzhalter-Adresse (anon-…@growimo.local): Löschung läuft vollständig durch',
  );
}
{
  const fake = makeFakeSql({ hasSubscription: false, blobCount: 0, userEmail: null });
  const deps = makeDeps(fake.order, fake.sql);
  const result = await runAccountDeletion('user_beta5', deps, { mode: 'immediate' });
  check(
    result.steps.includes('beta_signup_skipped_no_email'),
    'ohne E-Mail in users: sichtbarer Schritt beta_signup_skipped_no_email (kein stiller Skip)',
  );
  check(
    !fake.calls.some((c) => /DELETE FROM beta_signups/i.test(c.text)),
    'ohne E-Mail: kein ungefiltertes DELETE',
  );
}
{
  const fake = makeFakeSql({ hasSubscription: false, blobCount: 0, betaSignup: true });
  const deps = makeDeps(fake.order, fake.sql);
  const result = await runAccountDeletion('user_beta6', deps, {
    mode: 'immediate',
    policy: 'keep',
  });
  check(
    !fake.calls.some((c) => /DELETE FROM beta_signups/i.test(c.text)),
    "policy 'keep' (nur noch ausdrücklich): beta_signups bleibt",
  );
  check(result.steps.includes('beta_signup_kept'), "policy 'keep': Schritt beta_signup_kept im Ergebnis");
}

console.log('=== (j) Quelltext: Route, Link, ServerFn nur aus der Session ===');
const src = read('./src/account/delete-account.ts');
check(src.includes('resolveUserIdFromServerFn()'), 'UserId kommt aus der Session');
check(!/data\.userId/.test(src), 'ServerFn liest KEINE userId aus dem Payload');
check(src.includes('isAccountDeletionEnabled()'), 'ServerFn prüft das Flag selbst');
check(src.includes('assertAccountDeletionAllowed('), 'ServerFn nutzt die gemeinsame Gate-Funktion');
check(
  src.lastIndexOf('assertAccountDeletionAllowed(') <
    src.lastIndexOf('runAccountDeletion(clerkUserId'),
  'Gate läuft VOR jeder Löschlogik',
);
check(src.includes('resolveDeletionMode('), 'ServerFn prüft die gewählte Variante serverseitig');

const runner = read('./src/account/deletion-runner.ts');
for (const dep of ['cancelSubscriptionNow', 'cancelSubscriptionAtPeriodEnd', 'deleteBlobs', 'deleteClerkUser', 'pseudonymFor']) {
  check(runner.includes(dep), `Dependency vorhanden: ${dep}`);
}
check(runner.includes('CLERK_SECRET_KEY'), 'Clerk-Löschung braucht CLERK_SECRET_KEY');
check(runner.includes("'@vercel/blob'"), 'Blob-Löschung nutzt @vercel/blob del()');
check(runner.includes('betaSignupPolicy'), 'Rückgabe dokumentiert die beta_signups-Policy');
// Fix C1 (2026-10-25): EINE Pseudonym-Implementierung für beide Seiten.
const pseudonymMod = read('./src/lib/analytics-pseudonym.ts');
check(
  pseudonymMod.includes("createHmac('sha256', salt)") &&
    pseudonymMod.includes("digest('hex')"),
  'kanonische HMAC-Implementierung liegt in src/lib/analytics-pseudonym.ts',
);
const writeSide = read('./src/api/analytics.ts');
check(writeSide.includes('analyticsPseudonymFor'), 'Analytics-Schreibseite nutzt dieselbe Funktion');
check(!/createHmac\(/.test(writeSide), 'Schreibseite hat KEINE eigene HMAC-Kopie mehr (keine Drift)');
check(runner.includes('analyticsPseudonymFor'), 'Runner nutzt die echte Pseudonym-Funktion');
check(
  !/import\s*\(?\s*['"]\.\.\/lib\/tracking['"]/.test(runner),
  'kein dynamischer Lookup in lib/tracking mehr (C1)',
);
check(
  !/Blob-Löschung fehlgeschlagen/.test(runner),
  'Blob-Fehler werden NICHT mehr geschluckt (C2)',
);
check(
  runner.includes('cancel_at_period_end: true'),
  'Periodenende nutzt Stripe cancel_at_period_end',
);
check(
  runner.includes('export async function runScheduledAccountDeletions'),
  'Cron-Trigger als exportierte Funktion vorhanden',
);
check(
  runner.includes('export async function maybeExecuteScheduledDeletion'),
  'Webhook-Trigger als exportierte Funktion vorhanden',
);

// Route + sichtbarer Link (Owner: „In /app eine erreichbare Seite/Sektion").
check(existsSync('./src/routes/app/konto-loeschen.tsx'), 'Route /app/konto-loeschen existiert');
const routeSrc = read('./src/routes/app/konto-loeschen.tsx');
check(routeSrc.includes("createFileRoute('/app/konto-loeschen')"), 'Route ist registriert');
check(routeSrc.includes('getAccountDeletionInfo'), 'Seite fragt den Server-Status ab');
check(routeSrc.includes('deleteAccount('), 'Seite ruft den Lösch-ServerFn auf');
check(routeSrc.includes('type="radio"'), 'Auswahl sofort vs. Periodenende als Radio');
check(routeSrc.includes('data-testid="account-delete-loss-list"'), 'Warnliste gerendert');
check(routeSrc.includes('data-testid="account-delete-confirm-input"'), 'Bestätigungswort-Feld gerendert');
check(
  routeSrc.includes('options.length > 1'),
  'Auswahl erscheint NUR wenn der Server beide Optionen anbietet',
);
const settingsSrc = read('./src/routes/app/settings.tsx');
check(settingsSrc.includes('to="/app/konto-loeschen"'), 'Link in den Einstellungen vorhanden');
check(settingsSrc.includes('settings_delete_account'), 'Einstellungs-Sektion mit i18n-Text');

// Trigger-Verdrahtung (Cron + Webhook).
const cronSrc = read('./src/api/cron-blob-ttl.ts');
check(cronSrc.includes('runScheduledAccountDeletions'), 'Cron ruft die fälligen Löschungen auf');
const webhookSrc = read('./src/api/stripe-webhook.ts');
check(
  webhookSrc.includes('maybeExecuteScheduledDeletion'),
  'Webhook customer.subscription.deleted löst die Vormerkung aus',
);
check(
  webhookSrc.indexOf('maybeExecuteScheduledDeletion') >
    webhookSrc.indexOf('customer.subscription.deleted'),
  'Webhook-Trigger sitzt im deleted-Zweig',
);

// Schema: Tabelle für die Vormerkung.
const schemaSrc = read('./src/db/schema.ts');
check(schemaSrc.includes('CREATE TABLE IF NOT EXISTS account_deletion_requests'), 'Tabelle account_deletion_requests im Schema');
check(schemaSrc.includes('idx_account_deletion_requests_due'), 'Index für fällige Vormerkungen');

// Keine Route darf den ServerFn mit fremder Identität aufrufen.
const routeDir = './src/routes';
const routeFiles: string[] = [];
const walk = (dir: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else routeFiles.push(p);
  }
};
walk(routeDir);
const withPayloadId = routeFiles.filter(
  (f) => /deleteAccount\(/.test(read(f)) && /data:\s*\{[^}]*userId/.test(read(f)),
);
check(
  withPayloadId.length === 0,
  `keine Route schickt eine userId an den Lösch-ServerFn (${routeFiles.length} Dateien geprüft)`,
);

console.log('');
console.log(`=== ERGEBNIS: ${passed} PASS, ${failed} FAIL ===`);
if (failed > 0) {
  console.log('Fehlgeschlagen:');
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
console.log('Alle Checks grün.');
