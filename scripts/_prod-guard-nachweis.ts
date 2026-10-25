/**
 * PAKET B — Negativ-/Positivkontrolle für den Test-Suite-Prod-Guard.
 *
 * Ablauf:
 *   1. Snapshot der Prod-DB-Zähler (nur SELECT).
 *   2. `tracking-test.ts` OHNE Freigabe laufen lassen → muss VOR jedem
 *      Schreibzugriff mit exit ≠ 0 abbrechen.
 *   3. Snapshot erneut → Zähler müssen identisch sein (0 Writes).
 *   4. Positivkontrolle: dieselbe Suite gegen die DEMO-DB (growimo_demo) →
 *      läuft durch (dort ist Schreiben erlaubt, die Suite räumt selbst auf).
 */
import { neon } from '@neondatabase/serverless';

const PROD = process.env.DATABASE_URL!;
if (!PROD) throw new Error('DATABASE_URL fehlt (bun --env-file=.env run ...)');
const DEMO = PROD.replace(/\/neondb(\?|$)/, '/growimo_demo$1');
if (!/\/growimo_demo(\?|$)/.test(DEMO)) throw new Error('Demo-URL nicht ableitbar');

const TABLES = ['tracking_events', 'analytics_events', 'users', 'usage_monthly', 'usage_events'];

async function snapshot(url: string) {
  const sql = neon(url);
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const rows = (await sql.unsafe(`SELECT count(*)::int AS c FROM ${t}`)) as Array<{ c: number }>;
    out[t] = rows[0]?.c ?? -1;
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

// Positivkontrolle: Freigabe write auf der PROD-DB ist bewusst NICHT getestet
// (die Suite löscht Zeilen echter Nutzer). Stattdessen Demo-DB.
const pos = run('tracking-test.ts', { DATABASE_URL: DEMO, ALLOW_PROD_TESTS: '' });
console.log('POSITIV (demo) exit:', pos.code, '| Guard aktiv:', /TEST-SUITE-PROD-GUARD/.test(pos.text));
console.log('--- POSITIV Ausgabe (letzte 12 Zeilen) ---');
console.log(pos.text.split('\n').slice(-12).join('\n'));

const ok = guardHit && writeBlocked && unchanged && neg.code !== 0 && pos.code === 0;
console.log('\nERGEBNIS:', ok ? 'GUARD BESTANDEN' : 'GUARD NICHT BELEGT');
process.exit(ok ? 0 : 1);
