// ─────────────────────────────────────────────────────────────────────────────
// TEST-SUITE-PROD-GUARD (Owner-Auftrag 2026-10-25) — fail-closed
// ─────────────────────────────────────────────────────────────────────────────
// ANLASS: Die Repo-Suite `tracking-test.ts` lief am 2026-10-25 10:02 UTC gegen
// die PROD-DB (`.env` enthält die echte Neon-URL) und löschte als „clean slate"
// die Owner-Tracking-Historie. Repo-Test-Suiten dürfen Produktionsdaten nicht
// verändern können.
//
// MECHANISMUS (ohne Konfiguration, greift automatisch):
//   1. Erkennt der Prozess, dass das EINSTIEGSSKRIPT eine Test-Suite ist
//      (`*-test.ts`, `test-*.ts`, …) oder `GROWIMO_TEST_SUITE=1` gesetzt ist,
//      wird die DATABASE_URL klassifiziert:
//        · localhost/127.0.0.1            → 'allow'    (lokale Wegwerf-DB)
//        · DB-Name in DEMO_DB_NAMES       → 'allow'    (growimo_demo …)
//        · alles andere (Prod-Neon)       → 'readonly' ← FAIL-CLOSED
//   2. In 'readonly' sind SELECT/SHOW/EXPLAIN/WITH erlaubt (Lese-Beweise),
//      JEDES andere Statement beendet den Prozess mit exit 1 und klarer
//      Meldung — es kommt zu KEINEM Schreibzugriff.
//   3. Opt-in: `ALLOW_PROD_TESTS=write` hebt die Sperre auf (nur wenn die Suite
//      ihre eigenen Zeilen aufräumt). `ALLOW_PROD_TESTS=1` bleibt readonly.
//
// Verdrahtet in `src/db/index.ts` (getDb) und `src/db/init.ts` (initDb) — also
// im einzigen Weg, über den Suiten die DB erreichen. Produktionscode ist NICHT
// betroffen (dort ist das Einstiegsskript kein Test-Skript).
// ─────────────────────────────────────────────────────────────────────────────

/** Opt-in-Variable. `1`/`true` = nur Lesen erlaubt, `write` = Schreiben erlaubt. */
export const ALLOW_PROD_TESTS_ENV = 'ALLOW_PROD_TESTS';
/** Explizite Test-Markierung (für Runner, deren Einstiegsskript anders heißt). */
export const TEST_SUITE_ENV = 'GROWIMO_TEST_SUITE';

/** Datenbanknamen, die als Test-/Demo-Ziel gelten (Schreiben erlaubt). */
const DEMO_DB_NAMES = new Set([
  'growimo_demo',
  'growimo_test',
  'growimo_tests',
  'neondb_test',
]);

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|$)/;

/** Nur diese Statement-Arten sind im readonly-Modus erlaubt. */
const READ_ONLY_STATEMENT = /^\s*(select|with|show|explain|values|table)\b/i;

export type TestDbMode = 'allow' | 'readonly';

/**
 * Ist der laufende Prozess eine Repo-Test-Suite? Erkannt am Einstiegsskript
 * (`process.argv[1]`) oder am expliziten Env-Flag. In Produktion (Vercel-Handler,
 * `serve.ts`, `vite dev`) ist beides nicht der Fall.
 */
export function isTestProcess(): boolean {
  if (process.env[TEST_SUITE_ENV] === '1') return true;
  const entry = (process.argv[1] ?? '').split('/').pop() ?? '';
  return (
    /^test[-_].*\.(ts|tsx|mts|js|mjs|cjs)$/.test(entry) ||
    /[-_]test[-_.\w]*\.(ts|tsx|mts|js|mjs|cjs)$/.test(entry) ||
    /[-_]test\.(ts|tsx|mts|js|mjs|cjs)$/.test(entry)
  );
}

function parseDbUrl(url: string): { host: string; dbname: string } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      dbname: parsed.pathname.replace(/^\//, ''),
    };
  } catch {
    return { host: '', dbname: '' };
  }
}

/** Nur für Logs: Host + DB-Name, ohne Zugangsdaten. */
export function describeDbTarget(url: string): string {
  const { host, dbname } = parseDbUrl(url);
  return host ? `${host}/${dbname}` : '(nicht lesbar)';
}

/**
 * Entscheidet, was dieser Prozess mit der DATABASE_URL darf.
 * Ausserhalb eines Test-Prozesses immer 'allow' (Produktionsverhalten unverändert).
 */
export function testDbPolicy(url = process.env.DATABASE_URL): TestDbMode {
  if (!isTestProcess() || !url) return 'allow';
  const { host, dbname } = parseDbUrl(url);
  if (LOCAL_HOSTS.test(host)) return 'allow';
  if (DEMO_DB_NAMES.has(dbname)) return 'allow';
  const optIn = (process.env[ALLOW_PROD_TESTS_ENV] ?? '').trim().toLowerCase();
  if (optIn === 'write') return 'allow';
  // Default für Prod-Ziele: LESEN ja, SCHREIBEN nein (fail-closed).
  return 'readonly';
}

let bannerPrinted = false;

/** Einmalige, unübersehbare Meldung, wenn eine Suite auf Prod läuft. */
export function logTestDbPolicy(url = process.env.DATABASE_URL): void {
  const mode = testDbPolicy(url);
  if (mode === 'allow' || bannerPrinted) return;
  bannerPrinted = true;
  console.warn(
    [
      '',
      '┌──────────────────────────────────────────────────────────────────────┐',
      '│ TEST-SUITE-PROD-GUARD: LESEMODUS auf der Produktions-DB               │',
      '└──────────────────────────────────────────────────────────────────────┘',
      `  Ziel:    ${describeDbTarget(url ?? '')}`,
      '  Erlaubt: SELECT/SHOW/EXPLAIN/WITH. Jedes Schreib-Statement bricht ab.',
      `  Freigabe: ${ALLOW_PROD_TESTS_ENV}=write (nur wenn die Suite selbst aufräumt)`,
      '  Empfohlen: gegen die Demo-DB laufen lassen (DB-Name growimo_demo).',
      '',
    ].join('\n'),
  );
}

/**
 * Prüft EIN Statement. Bricht den Prozess mit exit 1 ab, wenn im readonly-Modus
 * geschrieben würde — fail-closed, bevor irgendetwas die DB erreicht.
 */
export function assertTestStatementAllowed(statement: string): void {
  const mode = testDbPolicy();
  if (mode === 'allow') return;
  const text = String(statement ?? '');
  if (READ_ONLY_STATEMENT.test(text)) return;
  console.error(
    [
      '',
      '✗ TEST-SUITE-PROD-GUARD: Schreibzugriff auf die PRODUKTIONS-DB blockiert.',
      `  Ziel:       ${describeDbTarget(process.env.DATABASE_URL ?? '')}`,
      `  Statement:  ${text.replace(/\s+/g, ' ').trim().slice(0, 160)}`,
      '  Der Prozess wurde VOR dem Schreibzugriff beendet (exit 1).',
      `  Absichtlich erlauben: ${ALLOW_PROD_TESTS_ENV}=write bun run <suite>.ts`,
      '  Oder gegen die Demo-DB laufen lassen (DATABASE_URL auf growimo_demo).',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

type NeonLike = (...args: unknown[]) => unknown;
/**
 * Wickelt den Neon-Client einer Test-Suite so, dass jedes Statement durch
 * `assertTestStatementAllowed` geht. Ausserhalb von Test-Prozessen (oder bei
 * 'allow') wird der Client unverändert zurückgegeben.
 */
export function guardTestClient<T extends NeonLike>(client: T, url?: string): T {
  if (testDbPolicy(url) === 'allow') return client;
  logTestDbPolicy(url);
  return new Proxy(client, {
    apply(target, thisArg, args) {
      const first = args[0];
      // Tagged template: TemplateStringsArray → SQL-Text rekonstruieren.
      const statement = Array.isArray(first) ? first.join(' ? ') : String(first ?? '');
      assertTestStatementAllowed(statement);
      return Reflect.apply(target as NeonLike, thisArg, args);
    },
  }) as T;
}
