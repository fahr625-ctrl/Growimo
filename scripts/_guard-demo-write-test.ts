// ─────────────────────────────────────────────────────────────────────────────
// POSITIVKONTROLLE für den Test-Suite-Prod-Guard (Owner-Auftrag 2026-10-25)
// ─────────────────────────────────────────────────────────────────────────────
// Zweck: beweisen, dass eine Suite, die DURCH den Guard läuft (`getDb()`),
// tatsächlich SCHREIBEN kann, wenn das Ziel erlaubt ist (Demo-DB growimo_demo).
// Gegen die Prod-DB muss genau dieses Skript mit exit 1 VOR dem INSERT abbrechen
// (Negativkontrolle derselben Codezeile).
//
// Der Dateiname endet auf `-test.ts`, damit `isTestProcess()` (src/db/test-guard.ts)
// den Prozess als Repo-Test-Suite erkennt — genau wie die echten Suiten.
//
// Aufruf:
//   DATABASE_URL=<…/growimo_demo> bun run scripts/_guard-demo-write-test.ts
//   DATABASE_URL=<…/neondb>      bun run scripts/_guard-demo-write-test.ts   (→ exit 1)
//
// Schreibt genau EINE synthetische Zeile (user_id 'guard-probe-synthetic') und
// löscht sie im selben Lauf wieder — keine echten Daten, kein Aufräum-Rest.
import { getDb } from '../src/db/index';

const MARK = 'guard-probe-synthetic';
const sql = getDb();

await sql`
  INSERT INTO tracking_events (user_id, event, metadata)
  VALUES (${MARK}, ${'user_registered'}, ${'{}'})
`;
const after = (await sql`SELECT count(*)::int AS c FROM tracking_events WHERE user_id = ${MARK}`) as Array<{ c: number }>;
console.log('PROBE WRITE OK, readback:', after?.[0]?.c, '(expect 1)');

const before = (await sql`SELECT count(*)::int AS c FROM tracking_events WHERE user_id = ${MARK}`) as Array<{ c: number }>;
await sql`DELETE FROM tracking_events WHERE user_id = ${MARK}`;
const cleaned = (await sql`SELECT count(*)::int AS c FROM tracking_events WHERE user_id = ${MARK}`) as Array<{ c: number }>;
console.log('PROBE CLEANUP:', before?.[0]?.c, '→', cleaned?.[0]?.c, '(expect 1 → 0)');
console.log('PROBE ERGEBNIS:', after?.[0]?.c === 1 && cleaned?.[0]?.c === 0 ? 'SCHREIBEN ERLAUBT + AUFGERÄUMT' : 'UNERWARTET');
process.exit(after?.[0]?.c === 1 && cleaned?.[0]?.c === 0 ? 0 : 1);
