// ─────────────────────────────────────────────────────────────────────────────
// ensureUserRow-E-MAIL — Test-Suite (Owner-Auftrag 2026-10-24 „vorbereiten und
// testen")
//
// Usage (aus der Repo-Wurzel):
//   bun --env-file=.env ensure-user-email-test.ts
//
// KEIN DB-Schreibzugriff, KEIN Netz: der SQL-Executor wird injiziert
// (`ensureUserRow(..., { sql: fake })`), die Session-E-Mail ebenfalls
// (`{ sessionEmail }`). Geprüft werden
//   (a) die reinen Regeln aus src/db/user-email.ts,
//   (b) die drei Owner-Regeln als Verhaltenstabelle,
//   (c) der Generierungs-Pfad über den echten `ensureUserRow`-Code mit Fake-SQL,
//   (d) Quelltext-Belege (SQL-Schutzklausel, Aufrufer ohne E-Mail).
// Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import {
  ANON_EMAIL_DOMAIN,
  decideUserEmail,
  isPlaceholderEmail,
  isRealEmail,
  normalizeEmail,
  placeholderEmailFor,
} from './src/db/user-email';
import { ensureUserRow, type SqlTag } from './src/db/queries';

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

// ── Fake-SQL: zeichnet jede Anweisung auf, liefert geskriptete Antworten ─────
interface FakeScript {
  select?: Record<string, unknown>[];
  upsert?: Record<string, unknown>[];
  throwOnUpsert?: unknown;
  heal?: Record<string, unknown>[];
}
function makeFake(script: FakeScript = {}) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    calls.push({ text, values });
    const trimmed = text.trim();
    if (/^SELECT/i.test(trimmed)) return script.select ?? [];
    if (/INSERT INTO users/i.test(trimmed)) {
      if (script.throwOnUpsert) throw script.throwOnUpsert;
      return script.upsert ?? [{ id: 'uuid-created' }];
    }
    if (/UPDATE users/i.test(trimmed)) return script.heal ?? [];
    return [];
  }) as SqlTag;
  const last = () => calls[calls.length - 1];
  return { sql, calls, last };
}

console.log('=== (a) Platzhalter-Erkennung ===');
check(ANON_EMAIL_DOMAIN === 'growimo.local', 'Platzhalter-Domain ist growimo.local');
check(
  placeholderEmailFor('user_ABC') === 'anon-user_ABC@growimo.local',
  'Platzhalter-Format unverändert (anon-<clerkId>@growimo.local)',
);
check(isPlaceholderEmail('anon-user_ABC@growimo.local'), 'Platzhalter erkannt');
check(isPlaceholderEmail('ANON-User_ABC@Growimo.Local'), 'Platzhalter case-insensitiv erkannt');
check(!isPlaceholderEmail('kunde@example.com'), 'echte E-Mail ist kein Platzhalter');
check(!isPlaceholderEmail(''), 'leerer Wert ist kein Platzhalter');
check(!isPlaceholderEmail(null), 'null ist kein Platzhalter');
check(isRealEmail('kunde@example.com'), 'echte E-Mail → isRealEmail true');
check(!isRealEmail('anon-user_ABC@growimo.local'), 'Platzhalter → isRealEmail false');
check(!isRealEmail(''), 'leer → isRealEmail false');
check(!isRealEmail('keine-mail'), 'ohne @ → isRealEmail false');
check(normalizeEmail('  Kunde@Example.COM  ') === 'Kunde@Example.COM', 'normalize trimmt');
check(normalizeEmail('') === null, 'normalize: leer → null');
check(normalizeEmail(undefined) === null, 'normalize: undefined → null');

console.log('=== (b) Regel 3: Neuanlage setzt die Session-E-Mail direkt ===');
const created = decideUserEmail({
  clerkId: 'user_NEU',
  existingEmail: undefined,
  sessionEmail: 'neu@example.com',
});
check(created.email === 'neu@example.com', 'Neuanlage + Session-E-Mail → echte Adresse');
check(created.source === 'created_with_session_email', 'Quelle: created_with_session_email');
const createdNoMail = decideUserEmail({ clerkId: 'user_NEU2', existingEmail: undefined });
check(
  createdNoMail.email === 'anon-user_NEU2@growimo.local',
  'Regel 4: Neuanlage ohne Session-E-Mail → Platzhalter (kein Crash)',
);
check(createdNoMail.source === 'created_placeholder', 'Quelle: created_placeholder');
const createdProvided = decideUserEmail({
  clerkId: 'user_NEU3',
  existingEmail: undefined,
  providedEmail: 'shell@example.com',
});
check(createdProvided.email === 'shell@example.com', 'Neuanlage mit übergebener E-Mail → diese');

console.log('=== (c) Regel 1: vorhandene ECHTE E-Mail wird NIE überschrieben ===');
const keep = decideUserEmail({
  clerkId: 'user_A',
  existingEmail: 'beta@example.com',
  // Der Generierungs-Pfad bringt weder E-Mail noch Session-Adresse mit:
  sessionEmail: null,
});
check(keep.email === 'beta@example.com', 'Platzhalter-Fall schreibt NICHT über eine echte Adresse');
check(keep.source === 'kept_existing_real', 'Quelle: kept_existing_real');
check(keep.changed === false, 'nichts zu ändern → changed=false');
const keepAgainstProvidedPlaceholder = decideUserEmail({
  clerkId: 'user_A',
  existingEmail: 'beta@example.com',
  providedEmail: 'anon-user_A@growimo.local',
});
check(
  keepAgainstProvidedPlaceholder.email === 'beta@example.com',
  'auch ein explizit übergebener Platzhalter überschreibt keine echte Adresse',
);
const addressChange = decideUserEmail({
  clerkId: 'user_A',
  existingEmail: 'alt@example.com',
  providedEmail: 'neu@example.com',
});
check(addressChange.email === 'neu@example.com', 'echte→echte Adresse: Adresswechsel erlaubt');
check(addressChange.source === 'updated_by_provided_email', 'Quelle: updated_by_provided_email');

console.log('=== (d) Regel 2: Platzhalter wird durch die Session-E-Mail geheilt ===');
const heal = decideUserEmail({
  clerkId: 'user_B',
  existingEmail: 'anon-user_B@growimo.local',
  sessionEmail: 'echt@example.com',
});
check(heal.email === 'echt@example.com', 'Platzhalter → echte Session-E-Mail');
check(heal.source === 'healed_placeholder', 'Quelle: healed_placeholder');
check(heal.healed === true && heal.changed === true, 'healed/changed markiert');
const healNoSession = decideUserEmail({
  clerkId: 'user_B',
  existingEmail: 'anon-user_B@growimo.local',
  sessionEmail: null,
});
check(
  healNoSession.email === 'anon-user_B@growimo.local',
  'ohne Session-E-Mail bleibt der Platzhalter stehen',
);
check(healNoSession.source === 'kept_placeholder', 'Quelle: kept_placeholder');
const fillEmpty = decideUserEmail({
  clerkId: 'user_C',
  existingEmail: null,
  sessionEmail: 'echt@example.com',
});
check(fillEmpty.email === 'echt@example.com', 'leere/NULL-E-Mail wird gefüllt');
check(fillEmpty.source === 'filled_empty_with_session_email', 'Quelle: filled_empty_with_session_email');

console.log('=== (e) Generierungs-Pfad: ensureUserRow OHNE E-Mail-Argument (Fake-SQL) ===');
// (e1) Frischer Nutzer, Session-E-Mail vorhanden → Zeile entsteht MIT echter Adresse.
{
  const f = makeFake({ select: [], upsert: [{ id: 'uuid-new' }] });
  const id = await ensureUserRow('user_FRESH', undefined, undefined, {
    sql: f.sql,
    sessionEmail: 'frisch@example.com',
  });
  check(id === 'uuid-new', 'Neuanlage liefert die users.id');
  check(
    f.last().text.includes('INSERT INTO users') &&
      f.last().values.includes('frisch@example.com'),
    'INSERT schreibt die ECHTE Session-E-Mail (nicht den Platzhalter)',
  );
  check(
    !f.last().values.some((v) => typeof v === 'string' && v.includes('anon-')),
    'kein anon-…-Platzhalter im INSERT',
  );
}
// (e2) Bestandsnutzer mit Platzhalter → Heilung durch die Session-E-Mail.
{
  const f = makeFake({
    select: [{ id: 'uuid-old', email: 'anon-user_HEIL@growimo.local' }],
    upsert: [{ id: 'uuid-old' }],
  });
  const id = await ensureUserRow('user_HEIL', undefined, undefined, {
    sql: f.sql,
    sessionEmail: 'beta-kunde@example.com',
  });
  check(id === 'uuid-old', 'Heilung behält dieselbe users.id (Projekte/Abo bleiben)');
  check(
    f.last().values.includes('beta-kunde@example.com'),
    'Upsert schreibt die echte Session-E-Mail (Heilung)',
  );
}
// (e3) Bestandsnutzer mit ECHTER E-Mail → kein Write, kein Clerk-Aufruf.
{
  const f = makeFake({ select: [{ id: 'uuid-real', email: 'beta@example.com' }] });
  const id = await ensureUserRow('user_REAL', undefined, undefined, { sql: f.sql });
  check(id === 'uuid-real', 'bestehende echte Adresse: users.id unverändert');
  check(f.calls.length === 1, 'nur der SELECT läuft — kein zweiter Write (Schnellpfad)');
  check(
    !f.calls.some((c) => c.text.includes('INSERT INTO users')),
    'kein INSERT/UPDATE auf einer Zeile mit echter Adresse',
  );
}
// (e4) Kein Session-Kontext (Skripte/Tests) → bisheriges Verhalten, kein Crash.
{
  const f = makeFake({ select: [], upsert: [{ id: 'uuid-anon' }] });
  const id = await ensureUserRow('user_OHNE', undefined, undefined, {
    sql: f.sql,
    sessionEmail: null,
  });
  check(id === 'uuid-anon', 'ohne Session-E-Mail: Zeile wird trotzdem angelegt');
  check(
    f.last().values.includes('anon-user_OHNE@growimo.local'),
    'Fallback bleibt der bisherige Platzhalter',
  );
}
// (e5) Explizit übergebene E-Mail (app-shell ensureUser) → unverändert direkt geschrieben.
{
  const f = makeFake({ upsert: [{ id: 'uuid-shell' }] });
  const id = await ensureUserRow('user_SHELL', 'shell@example.com', 'Shell User', { sql: f.sql });
  check(id === 'uuid-shell', 'übergebene E-Mail: users.id kommt zurück');
  check(f.calls.length === 1, 'kein zusätzlicher SELECT bei übergebener E-Mail');
  check(f.last().values.includes('shell@example.com'), 'übergebene E-Mail wird geschrieben');
  check(f.last().values.includes('Shell User'), 'Name wird mitgeschrieben');
}
// (e6) Clerk-Migrations-Pfad (gleiche E-Mail unter anderer clerk_id) bleibt erhalten.
{
  const uniqueErr = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint: 'users_email_key',
  });
  const f = makeFake({
    select: [],
    throwOnUpsert: uniqueErr,
    heal: [{ id: 'uuid-migriert' }],
  });
  const id = await ensureUserRow('user_NEU_ID', 'bestand@example.com', undefined, { sql: f.sql });
  check(id === 'uuid-migriert', 'E-Mail-Unique-Konflikt heilt weiterhin auf die Bestandszeile');
  check(
    f.calls.some((c) => /UPDATE users/i.test(c.text) && c.values.includes('user_NEU_ID')),
    'Heilungs-UPDATE übernimmt die neue clerk_id',
  );
}

console.log('=== (f) Quelltext-Belege ===');
const queriesSrc = read('./src/db/queries.ts');
check(
  queriesSrc.includes("ILIKE 'anon-%@growimo.local'"),
  'SQL-Schutzklausel gegen Platzhalter-Überschreiben vorhanden',
);
check(
  queriesSrc.includes('resolveSessionEmail('),
  'ensureUserRow ermittelt die Session-E-Mail selbst',
);
check(
  queriesSrc.includes("import('../lib/session-email')"),
  'Session-E-Mail kommt aus src/lib/session-email.ts',
);
// Der Befund entstand, weil die Generierungs-/Speicherpfade OHNE E-Mail aufrufen.
const callSites = [
  ['qSaveProject', 'const uid = await ensureUserRow(userId);'],
] as const;
for (const [label, needle] of callSites) {
  check(queriesSrc.includes(needle), `${label} ruft ensureUserRow ohne E-Mail → Fix greift dort`);
}
const imagesSrc = read('./src/api/images.ts');
check(
  imagesSrc.includes('ensureUserRow(subject)'),
  'Bild-Pfad ruft ensureUserRow ohne E-Mail → Fix greift dort',
);
const sessionEmailSrc = read('./src/lib/session-email.ts');
check(
  sessionEmailSrc.includes('CLERK_SECRET_KEY'),
  'Session-E-Mail nutzt die Clerk-Backend-API (CLERK_SECRET_KEY)',
);
check(
  sessionEmailSrc.includes('sub !== id'),
  'Sicherheit: nur die EIGENE Session darf geheilt werden',
);
const trackingSrc = read('./src/api/tracking.ts');
check(
  trackingSrc.includes('export async function verifySessionPayload'),
  'eine gemeinsame JWKS-Verifikation für sub + Claims',
);

console.log('');
console.log(`=== ERGEBNIS: ${passed} PASS, ${failed} FAIL ===`);
if (failed > 0) {
  console.log('Fehlgeschlagen:');
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
console.log('Alle Checks grün.');
