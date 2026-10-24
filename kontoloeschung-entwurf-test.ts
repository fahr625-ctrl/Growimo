// ─────────────────────────────────────────────────────────────────────────────
// KONTO-LÖSCHUNG (Selbstbedienung) — Test-Suite (ENTWURF 2026-10-24)
//   Owner-Entscheidungspunkt 4: „aktuellen Stand korrekt beschreiben +
//   Selbstbedienungslösung separat vorbereiten".
//
// Usage (aus der Repo-Wurzel):
//   bun --env-file=.env kontoloeschung-entwurf-test.ts
//
// Kein DB-Schreibzugriff, kein Stripe-/Clerk-/Blob-Aufruf: geprüft wird die
// reine Planungs- und Gate-Logik plus per Quelltext-Assertion, dass der
// ServerFn NICHT geroutet und standardmäßig abgeschaltet ist.
// Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCOUNT_DELETE_CONFIRMATION_WORD,
  ACCOUNT_DELETE_FLAG,
  AccountDeletionError,
  assertAccountDeletionAllowed,
  blockingStepsBeforeDbDelete,
  buildDeletionPlan,
  confirmationMatches,
  isAccountDeletionEnabled,
} from './src/account/deletion-plan';

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

console.log('=== (a) Flag: standardmäßig AUS (fail-closed) ===');
check(ACCOUNT_DELETE_FLAG === 'ACCOUNT_DELETE_ENABLED', 'Flag-Name dokumentiert');
check(isAccountDeletionEnabled({}) === false, 'ohne Env → aus');
check(
  isAccountDeletionEnabled({ ACCOUNT_DELETE_ENABLED: undefined }) === false,
  'undefined → aus',
);
check(isAccountDeletionEnabled({ ACCOUNT_DELETE_ENABLED: '' }) === false, 'leer → aus');
check(isAccountDeletionEnabled({ ACCOUNT_DELETE_ENABLED: '1' }) === false, "'1' → aus (nur exakt true)");
check(isAccountDeletionEnabled({ ACCOUNT_DELETE_ENABLED: 'yes' }) === false, "'yes' → aus");
check(isAccountDeletionEnabled({ ACCOUNT_DELETE_ENABLED: 'true' }) === true, "'true' → an");
check(isAccountDeletionEnabled({ ACCOUNT_DELETE_ENABLED: ' TRUE ' }) === true, "' TRUE ' → an");

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
  'Flag aus → account_deletion_disabled (auch bei korrektem Wort)',
);
check(
  codeOf(() =>
    assertAccountDeletionAllowed({
      clerkUserId: null,
      confirmation: 'LOESCHEN',
      enabled: true,
    }),
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
  'falsches Wort → confirmation_mismatch',
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

console.log('=== (d) Löschplan: Reihenfolge und Vollständigkeit ===');
const plan = buildDeletionPlan({
  hasSubscription: true,
  liveImageCount: 3,
  hasBetaSignup: true,
});
const ids = plan.map((s) => s.id);
const idx = (id: string) => ids.indexOf(id);
check(idx('stripe_cancel_subscription') === 0, 'Stripe-Kündigung ist Schritt 1');
check(
  idx('stripe_cancel_subscription') < idx('delete_user_row'),
  'Abo wird VOR der users-Zeile beendet (sonst bucht es ohne Zuordnung weiter)',
);
check(
  idx('blob_delete_images') < idx('delete_user_row'),
  'Blobs werden VOR der users-Zeile gelöscht (Pfade danach nicht mehr ermittelbar)',
);
check(
  idx('clerk_delete_user') === ids.length - 1,
  'Clerk-Löschung ist der LETZTE Schritt',
);
check(idx('delete_user_row') < idx('clerk_delete_user'), 'users-Zeile vor Clerk-Nutzer');
for (const t of [
  'delete_usage_events',
  'delete_tracking_events',
  'delete_generation_throttle',
  'delete_analytics_events',
  'beta_signup_policy',
  'delete_user_row',
  'clerk_delete_user',
]) {
  check(ids.includes(t), `Schritt vorhanden: ${t}`);
}
check(
  plan.find((s) => s.id === 'beta_signup_policy')?.ownerDecision === true,
  'beta_signups ist als OFFENE Owner-Entscheidung markiert',
);
check(
  plan.find((s) => s.id === 'delete_usage_events')?.reason.includes('TEXT') === true,
  'Begründung nennt den fehlenden Fremdschlüssel (TEXT-Clerk-ID)',
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
check(
  blockingStepsBeforeDbDelete(plan).length === 1 &&
    blockingStepsBeforeDbDelete(plan)[0].id === 'stripe_cancel_subscription',
  'genau ein blockierender externer Schritt vor der DB-Löschung',
);

console.log('=== (e) Quelltext: ServerFn nicht geroutet, Identität nur aus Session ===');
const src = read('./src/account/delete-account.ts');
check(
  src.includes('resolveUserIdFromServerFn(undefined)'),
  'UserId wird aus der Session aufgelöst (kein Payload-Fallback)',
);
check(!/data\.userId/.test(src), 'ServerFn liest KEINE userId aus dem Payload');
check(
  src.includes('isAccountDeletionEnabled()'),
  'ServerFn prüft das Flag selbst',
);
check(
  src.includes('assertAccountDeletionAllowed('),
  'ServerFn nutzt die gemeinsame Gate-Funktion',
);
check(
  src.lastIndexOf('assertAccountDeletionAllowed(') <
    src.lastIndexOf('runAccountDeletion(clerkUserId, deps)'),
  'Gate läuft VOR jeder Löschlogik',
);

// Keine Route/keine UI darf den ServerFn verwenden.
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
const routRefs = routeFiles.filter((f) => /deleteAccount|delete-account/.test(read(f)));
check(routRefs.length === 0, `keine Route importiert den Lösch-ServerFn (${routeFiles.length} Dateien geprüft)`);
check(!existsSync('./src/routes/app/konto-loeschen.tsx'), 'keine Route /app/konto-loeschen vorhanden');

console.log('=== (f) Abhängigkeiten, die eine echte Löschung braucht ===');
for (const dep of ['cancelSubscription', 'deleteBlobs', 'deleteClerkUser', 'pseudonymFor']) {
  check(src.includes(dep), `Dependency vorhanden: ${dep}`);
}
check(
  src.includes('CLERK_SECRET_KEY'),
  'Clerk-Löschung braucht CLERK_SECRET_KEY (Env-Anforderung dokumentiert)',
);
check(
  src.includes("'@vercel/blob'"),
  'Blob-Löschung nutzt @vercel/blob del()',
);
check(
  src.includes('betaSignupPolicy'),
  'Rückgabe dokumentiert die beta_signups-Policy',
);

console.log('');
console.log(`=== ERGEBNIS: ${passed} PASS, ${failed} FAIL ===`);
if (failed > 0) {
  console.log('Fehlgeschlagen:');
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
console.log('Alle Checks grün.');
