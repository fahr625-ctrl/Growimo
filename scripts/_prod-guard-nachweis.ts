/**
 * PAKET B — Negativ-/Positivkontrolle für den Test-Suite-Prod-Guard.
 *
 * Ablauf:
 *   1. Snapshot der Prod-DB-Zähler (nur SELECT, tagged template).
 *   2. `tracking-test.ts` OHNE Freigabe laufen lassen → muss VOR jedem
 *      Schreibzugriff mit exit ≠ 0 abbrechen.
 *   3. Snapshot erneut → Zähler müssen identisch sein (0 Writes).
 *   4. Positivkontrolle gegen die DEMO-DB (growimo_demo):
 *      a) `scripts/_guard-demo-write-test.ts` schreibt über den GEGUARDETEN
 *         Pfad (`getDb()`) eine synthetische Zeile, liest sie zurück und räumt
 *         sie auf → Schreiben ist bei erlaubtem Ziel nachweislich möglich.
 *      b) dieselbe Datei gegen die PROD-DB → exit 1, Zähler unverändert.
 *      c) die echte Suite `tracking-test.ts` gegen die DEMO-DB → exit 0
 *         (läuft durch, schreibt dort, räumt selbst auf).
 *
 * WICHTIG: Dieses Skript schreibt NIE auf die Prod-DB. Der Negativtest darf
 * ausschliesslich lesen und muss VOR dem Schreiben abbrechen — das ist der Zweck.
 *
 * Aufruf: bun --env-file=.env run scripts/_prod-guard-nachweis.ts
 */
import { neon } from '@neondatabase/serverless';

const PROD = process.env.DATABASE_URL!;
if (!PROD) throw new Error('DATABASE_URL fehlt (bun --env-file=.env run ...)');
const DEMO = PROD.replace(/\/neondb(\?|$)/, '/growimo_demo$1');
if (!/\/growimo_demo(\?|$)/.test(DEMO)) throw new Error('Demo-URL nicht ableitbar');

const TABLES = ['tracking_events', 'analytics_events', 'users', 'usage_monthly', 'usage_events'];

// Zähl-Abfragen als TAGGED TEMPLATE (Fix 2026-10-25): `sql.unsafe(...)` lieferte
// im Neon-HTTP-Treiber kein verwertbares Ergebnis (Zähler kam als -1 zurück, die
// Aussage „0 Writes" war damit nicht gegengelesen). Tabellennamen sind Identifier
// und können nicht als Parameter übergeben werden — daher eine feste Abfrage je
// Tabelle, ohne String-Interpolation.
// `any` bewusst: der generische Neon-Typ (NeonQueryFunction<A,B>) instanziiert
// sonst auf <boolean,boolean> und kollidiert mit neon()s Default <false,false>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COUNT_QUERIES: Record<string, (sql: any) => Promise<unknown>> = {
  tracking_events: (sql) => sql`SELECT count(*)::int AS c FROM tracking_events`,
  analytics_events: (sql) => sql`SELECT count(*)::int AS c FROM analytics_events`,
  users: (sql) => sql`SELECT count(*)::int AS c FROM users`,
  usage_monthly: (sql) => sql`SELECT count(*)::int AS c FROM usage_monthly`,
  usage_events: (sql) => sql`SELECT count(*)::int AS c FROM usage_events`,
};

async function snapshot(url: string) {
  const sql = neon(url);
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const rows = (await COUNT_QUERIES[t](sql)) as Array<{ c: number }>;
    const c = Array.isArray(rows) ? rows[0]?.c : undefined;
    if (typeof c !== 'number') {
      // Fail-closed: ein unlesbarer Zähler ist KEIN Beleg.
      throw new Error(`Zähler für ${t} nicht lesbar: ${JSON.stringify(rows)?.slice(0, 200)}`);
    }
    out[t] = c;
  }
  return out;
}

function run(entry: string, env: Record<string, string>) {
  const proc = Bun.spawnSync({
    cmd: ['bun', 'run', entry],
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const text = `${proc.stdout?.toString() ?? ''}\n${proc.stderr?.toString() ?? ''}`;
  return { code: proc.exitCode ?? -1, text };
}

const before = await snapshot(PROD);
console.log('SNAPSHOT VORHER :', JSON.stringify(before));

// ── 1. NEGATIVKONTROLLE: Suite gegen Prod, ohne Freigabe ────────────────────
const neg = run('tracking-test.ts', { DATABASE_URL: PROD, ALLOW_PROD_TESTS: '' });
console.log('NEGATIV exit    :', neg.code);
const guardHit = /TEST-SUITE-PROD-GUARD/.test(neg.text);
const writeBlocked = /Schreibzugriff auf die PRODUKTIONS-DB blockiert/.test(neg.text);
const ranDelete = /DELETE FROM tracking_events/i.test(neg.text) && !guardHit;
console.log('NEGATIV Guard   :', guardHit, '| Write-Block:', writeBlocked, '| ohne Guard durchgelaufen:', ranDelete);
console.log('--- NEGATIV Ausgabe (letzte 15 Zeilen) ---');
console.log(neg.text.split('\n').slice(-15).join('\n'));

const after = await snapshot(PROD);
console.log('SNAPSHOT NACHHER:', JSON.stringify(after));
const unchanged = TABLES.every((t) => before[t] === after[t]);
console.log('0 PROD-WRITES   :', unchanged, unchanged ? '' : JSON.stringify(
  TABLES.filter((t) => before[t] !== after[t]).map((t) => `${t}: ${before[t]}→${after[t]}`),
));

// ── 2. NEGATIVKONTROLLE derselben Schreib-Zeile über den Guard ──────────────
const probeProd = run('scripts/_guard-demo-write-test.ts', { DATABASE_URL: PROD, ALLOW_PROD_TESTS: '' });
console.log('\nPROBE-PROD exit :', probeProd.code, '| Write-Block:', /Schreibzugriff auf die PRODUKTIONS-DB blockiert/.test(probeProd.text));
console.log('--- PROBE-PROD Ausgabe (letzte 8 Zeilen) ---');
console.log(probeProd.text.split('\n').slice(-8).join('\n'));
const afterProbe = await snapshot(PROD);
const probeUnchanged = TABLES.every((t) => after[t] === afterProbe[t]);
console.log('PROBE-PROD Zähler vor==nach:', probeUnchanged, JSON.stringify(
  TABLES.filter((t) => after[t] !== afterProbe[t]).map((t) => `${t}: ${after[t]}→${afterProbe[t]}`),
));

// ── 3. POSITIVKONTROLLE: gegen die DEMO-DB (dort ist Schreiben erlaubt) ─────
const demoBefore = await snapshot(DEMO);
console.log('\nDEMO VORHER     :', JSON.stringify(demoBefore));

const probeDemo = run('scripts/_guard-demo-write-test.ts', { DATABASE_URL: DEMO, ALLOW_PROD_TESTS: '' });
console.log('PROBE-DEMO exit :', probeDemo.code, '| Guard-Block:', /blockiert/.test(probeDemo.text));
console.log('--- PROBE-DEMO Ausgabe ---');
console.log(probeDemo.text.split('\n').filter(Boolean).slice(-8).join('\n'));
const probeWriteOk = /SCHREIBEN ERLAUBT \+ AUFGERÄUMT/.test(probeDemo.text) && probeDemo.code === 0;

const demoAfterProbe = await snapshot(DEMO);
console.log('DEMO nach Probe :', JSON.stringify(demoAfterProbe), '(Probe räumt selbst auf → unverändert erwartet)');

const pos = run('tracking-test.ts', { DATABASE_URL: DEMO, ALLOW_PROD_TESTS: '' });
console.log('\nPOSITIV (demo) exit:', pos.code, '| Guard aktiv:', /TEST-SUITE-PROD-GUARD/.test(pos.text));
console.log('--- POSITIV Ausgabe (letzte 12 Zeilen) ---');
console.log(pos.text.split('\n').slice(-12).join('\n'));
const demoAfterSuite = await snapshot(DEMO);
console.log('DEMO nach Suite :', JSON.stringify(demoAfterSuite));
const suiteWroteDemo = /Total events for test user: 8/.test(pos.text) && pos.code === 0;

const ok =
  guardHit &&
  writeBlocked &&
  unchanged &&
  neg.code !== 0 &&
  probeProd.code !== 0 &&
  probeUnchanged &&
  probeWriteOk &&
  suiteWroteDemo;
console.log('\nERGEBNIS:', ok ? 'GUARD BESTANDEN' : 'GUARD NICHT BELEGT');
console.log(
  JSON.stringify({
    negativ: { exit: neg.code, guard: guardHit, writeBlocked, zaehlerVorGleichNach: unchanged },
    probeProd: { exit: probeProd.code, zaehlerVorGleichNach: probeUnchanged },
    positivDemo: { probeExit: probeDemo.code, probeSchreibt: probeWriteOk, suiteExit: pos.code, suiteSchreibt: suiteWroteDemo },
  }),
);
process.exit(ok ? 0 : 1);
