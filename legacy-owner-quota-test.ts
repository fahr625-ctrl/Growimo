// ─────────────────────────────────────────────────────────────────────────────
// legacy-owner-quota-test.ts — dauerhafter Schutz der Owner-Maßnahme (b)
// Lauf: `bun legacy-owner-quota-test.ts`  · Exit 0 = grün. KEINE DB, KEIN Netz.
// ─────────────────────────────────────────────────────────────────────────────
// OWNER-ENTSCHEIDUNG 2026-10-26 (Zugriffs-Forensik), zwei getrennte Maßnahmen:
//
//   (a) Das ALT-Konto des Owners aus der Development-Instanz
//       (`user_3H2trJXHwzXmJF2XTGQ2PMEwjkD`, 24 der 65 Analytics-Generierungen)
//       wird im Admin-Bericht als „eigene Tests" AUSGEFILTERT. Umsetzung:
//       LEGACY_OWNER_CLERK_IDS (src/lib/owner-id.ts) → TEST_USER_IDS
//       (src/lib/tracking.ts).
//
//   (b) Dasselbe Alt-Konto bleibt ein NORMALER FREE-NUTZER: Kontingent 3
//       (einmalig), KEIN Quota-Override, KEINE Sonderbehandlung.
//
// Der Fehler, den diese Suite für immer verhindern soll: die beiden Listen
// zusammenlegen (oder TEST_USER_IDS in einem Quota-Pfad konsultieren). Dann
// bekäme das Alt-Konto über den Analytics-Filter einen unbegrenzten Override —
// genau das Gegenteil der Owner-Entscheidung. Warum das leicht passiert: der
// Pre-Deploy-Gate prüft die ID nur als STRING im Bundle (Kriterium (d)) und
// kann Listen-Zugehörigkeit grundsätzlich nicht unterscheiden. Diese Suite
// schließt genau diese Lücke.
//
// Aufbau: die echten Guard-Funktionen (src/lib/usage-guard.ts) laufen gegen
// STUBS (kein Neon, kein Clerk, kein Schreibzugriff irgendwo) — der Zähler ist
// ein In-Memory-Objekt mit derselben konditionalen Increment-Semantik wie
// qIncrementUsage (INSERT … WHERE count < limit → null am Limit).
// `mock` kommt aus Bun. Das Repo hat kein `@types/bun` — dieselbe Situation wie in
// image-streaming-test.ts / saved-images-api-local-test.ts. Deshalb hier bewusst
// stillgelegt, damit diese Datei den tsc-Stand (Baseline) NICHT verändert.
// @ts-ignore — bun:test ist zur Laufzeit (bun) vorhanden
import { mock } from 'bun:test';
import { readFileSync } from 'node:fs';

const BASE = new URL('./', import.meta.url).pathname;

// ── Fake-Zustand (nur im Prozessspeicher) ────────────────────────────────────
const LEGACY_OWNER_ID = 'user_3H2trJXHwzXmJF2XTGQ2PMEwjkD';
const FREE_USER_ID = 'guard-fake-free-user';

type Counters = Map<string, number>; // key = `${userId}|${period}`
const counters: Counters = new Map();
const usageEvents: Array<{ userId: string; action: string; period: string; countAfter: number; limit: number }> = [];
const calls: string[] = [];
const key = (u: string, p: string) => `${u}|${p}`;
const getCount = (u: string, p: string) => counters.get(key(u, p)) ?? 0;

// Ein Stub-Factory für BEIDE Specifier (`…/queries` und `…/queries.ts`) — Bun
// löst beide auf dieselbe Datei auf, und die ZULETZT registrierte Fassung
// gewinnt. Deshalb hier EINE Funktion für beide, sonst überschreibt ein
// vereinfachter Zweit-Stub die echte Zähl-Semantik (schon einmal passiert).
const queriesStub = () => ({
  qGetPlanTier: async (userId: string) => {
    calls.push(`qGetPlanTier:${userId}`);
    return 'free'; // alle Fake-Nutzer sind Free — auch das Alt-Owner-Konto (Maßnahme b)
  },
  qGetUsage: async (userId: string, period: string) => getCount(userId, period),
  qGetRemaining: async (userId: string, period: string, limit: number) => {
    calls.push(`qGetRemaining:${userId}:${period}`);
    return Math.max(limit - getCount(userId, period), 0);
  },
  // Konditionales Increment wie in src/db/queries.ts: null, wenn das Limit erreicht ist.
  qIncrementUsage: async (userId: string, period: string, limit: number) => {
    calls.push(`qIncrementUsage:${userId}:${period}:${limit}`);
    const cur = getCount(userId, period);
    if (cur >= limit) return null;
    counters.set(key(userId, period), cur + 1);
    return cur + 1;
  },
  qReleaseUsage: async (userId: string, period: string) => {
    calls.push(`qReleaseUsage:${userId}:${period}`);
    counters.set(key(userId, period), Math.max(getCount(userId, period) - 1, 0));
  },
  qInsertUsageEvent: async (
    userId: string,
    ev: { action: string; period: string; countAfter: number; limit: number },
  ) => {
    calls.push(`qInsertUsageEvent:${userId}`);
    usageEvents.push({
      userId, action: ev.action, period: ev.period, countAfter: ev.countAfter, limit: ev.limit,
    });
  },
  qTryThrottle: async (userId: string) => {
    calls.push(`qTryThrottle:${userId}`);
    return true;
  },
});
mock.module(`${BASE}src/db/queries.ts`, queriesStub);
mock.module(`${BASE}src/db/queries`, queriesStub);

// Kein Clerk/JWKS, kein Netz: die Sitzungsprüfung ist hier nicht der Prüfgegenstand.
mock.module(`${BASE}src/api/tracking.ts`, () => ({ verifySessionSubject: async () => null }));
mock.module(`${BASE}src/api/tracking`, () => ({ verifySessionSubject: async () => null }));

// ── Mini-Harness ─────────────────────────────────────────────────────────────
let checks = 0;
let failures = 0;
const failLines: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  checks += 1;
  if (cond) {
    console.log(`  ✓ PASS: ${name}`);
  } else {
    failures += 1;
    failLines.push(name);
    console.log(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('=== Owner-Maßnahme (b): Alt-Owner-Konto ist Free-Nutzer, kein Quota-Override ===');

  // ── 1. Listen-Semantik: AUSFILTERN ≠ ÜBERSTEUERN ───────────────────────────
  const { TEST_USER_IDS, OWNER_USER_ID } = await import('./src/lib/tracking');
  const { LEGACY_OWNER_CLERK_IDS, OWNER_CLERK_ID } = await import('./src/lib/owner-id');
  const guard = await import('./src/lib/usage-guard');

  console.log('\n1) Listen: Alt-ID im Analytics-Filter, NICHT im Quota-Override');
  check(
    'LEGACY_OWNER_CLERK_IDS enthält die Alt-Owner-ID der Dev-Instanz',
    LEGACY_OWNER_CLERK_IDS.includes(LEGACY_OWNER_ID),
    `Inhalt: ${JSON.stringify(LEGACY_OWNER_CLERK_IDS)}`,
  );
  check(
    'TEST_USER_IDS (Analytics-Filter) enthält die Alt-Owner-ID',
    TEST_USER_IDS.includes(LEGACY_OWNER_ID),
    `Inhalt: ${JSON.stringify(TEST_USER_IDS)}`,
  );
  check(
    'TEST_USER_IDS enthält weiterhin die aktuelle Prod-Owner-ID',
    TEST_USER_IDS.includes(OWNER_CLERK_ID) && OWNER_USER_ID === OWNER_CLERK_ID,
  );
  check(
    'ADMIN_OVERRIDE_USER_IDS enthält die Alt-Owner-ID NICHT (Maßnahme b)',
    !guard.ADMIN_OVERRIDE_USER_IDS.has(LEGACY_OWNER_ID),
    `Override-Liste: ${JSON.stringify([...guard.ADMIN_OVERRIDE_USER_IDS])}`,
  );
  check(
    'isAdminOverride(Alt-Owner-ID) === false',
    guard.isAdminOverride(LEGACY_OWNER_ID) === false,
  );
  // Positivkontrolle: der Override-Mechanismus selbst ist intakt — er greift nur
  // für das AKTUELLE Owner-Konto, nicht für die Alt-ID.
  check(
    'Positivkontrolle: ADMIN_OVERRIDE_USER_IDS enthält die aktuelle Owner-ID',
    guard.ADMIN_OVERRIDE_USER_IDS.has(OWNER_CLERK_ID),
  );
  check(
    'Positivkontrolle: isAdminOverride(aktuelle Owner-ID) === true',
    guard.isAdminOverride(OWNER_CLERK_ID) === true,
  );
  check(
    'Override-Liste besteht aus genau 1 Eintrag (Alt-ID kann nicht „dazugerutscht" sein)',
    guard.ADMIN_OVERRIDE_USER_IDS.size === 1,
    `size=${guard.ADMIN_OVERRIDE_USER_IDS.size}`,
  );
  check(
    'Free-Limit ist 3 und Free-Periode ist die einmalige Pseudo-Periode "once"',
    guard.limitForPlan('free') === 3 &&
      guard.FREE_ONCE_PERIOD === 'once' &&
      guard.usagePeriodForPlan('free') === 'once',
    `limit=${guard.limitForPlan('free')} period=${guard.usagePeriodForPlan('free')}`,
  );
  check(
    'Free-Nutzerin-Periode ist NICHT der Monats-Rollover der Alt-Zeile',
    guard.usagePeriodForPlan('free') !== guard.currentPeriod(),
  );

  // ── 2. Verhalten: der Alt-ID-Nutzer verbraucht wie jede Free-Nutzerin ──────
  console.log('\n2) Laufzeit: withGenerationGuard mit der Alt-Owner-ID (Free, Fakes)');
  counters.clear();
  calls.length = 0;

  let okRuns = 0;
  let fourthError: unknown = null;
  for (let i = 1; i <= 4; i += 1) {
    try {
      await guard.withGenerationGuard(LEGACY_OWNER_ID, async () => `ergebnis-${i}`, 'de', {
        action: 'generate_content',
        detail: 'fake',
      });
      okRuns += 1;
    } catch (err) {
      fourthError = err;
    }
  }
  check('die ersten 3 Generierungen laufen durch (Limit 3 wird gewährt)', okRuns === 3, `okRuns=${okRuns}`);
  check(
    'die 4. Generierung wirft UsageLimitError (NICHT unbegrenzt)',
    fourthError instanceof guard.UsageLimitError,
    fourthError ? String(fourthError) : 'kein Fehler geworfen',
  );
  const limitErr = fourthError as InstanceType<typeof guard.UsageLimitError> | null;
  check('UsageLimitError nennt limit=3 und planTier=free', limitErr?.limit === 3 && limitErr?.planTier === 'free',
    `limit=${limitErr?.limit} planTier=${limitErr?.planTier}`);
  check(
    'Zähler der Alt-ID steht danach exakt auf 3 (kein Bypass, kein Extra-Verbrauch)',
    getCount(LEGACY_OWNER_ID, guard.FREE_ONCE_PERIOD) === 3,
    `count=${getCount(LEGACY_OWNER_ID, guard.FREE_ONCE_PERIOD)}`,
  );
  check(
    'die Guard-Pfade haben die DB/Quota-Schicht tatsächlich konsultiert (kein Override-Kurzschluss)',
    calls.some((c) => c.startsWith(`qGetPlanTier:${LEGACY_OWNER_ID}`)) &&
      calls.some((c) => c.startsWith(`qIncrementUsage:${LEGACY_OWNER_ID}:once`)),
    `calls=${calls.slice(0, 6).join(' ')}`,
  );
  check(
    'usage_events-Ledger: genau 3 Einträge, alle mit limit=3 (Owner-Override schriebe 0)',
    usageEvents.length === 3 && usageEvents.every((e) => e.limit === 3 && e.period === 'once'),
    `events=${JSON.stringify(usageEvents)}`,
  );

  // assertCanGenerate (Early-Fail-Pfad) verhält sich identisch.
  const assertErr = await guard
    .assertCanGenerate(LEGACY_OWNER_ID)
    .then(() => null)
    .catch((e: unknown) => e);
  check(
    'assertCanGenerate(Alt-ID) wirft bei erschöpftem Kontingent UsageLimitError',
    assertErr instanceof guard.UsageLimitError,
    assertErr ? String(assertErr) : 'kein Fehler geworfen',
  );

  // recordGeneration (Einzel-Pfad) ebenfalls.
  const recErr = await guard
    .recordGeneration(LEGACY_OWNER_ID, 'de', { action: 'image' })
    .then(() => null)
    .catch((e: unknown) => e);
  check(
    'recordGeneration(Alt-ID) wirft bei erschöpftem Kontingent UsageLimitError',
    recErr instanceof guard.UsageLimitError,
    recErr ? String(recErr) : 'kein Fehler geworfen',
  );

  // Normale Free-Nutzerin als Kontrollgruppe: identisches Verhalten.
  counters.clear();
  let freeRuns = 0;
  for (let i = 1; i <= 4; i += 1) {
    try {
      await guard.withGenerationGuard(FREE_USER_ID, async () => i);
      freeRuns += 1;
    } catch {
      /* erwartet beim 4. Lauf */
    }
  }
  check(
    'Kontrollgruppe: normale Free-Nutzerin hat dasselbe Limit 3 (Alt-ID ist nicht schlechter gestellt)',
    freeRuns === 3 && getCount(FREE_USER_ID, guard.FREE_ONCE_PERIOD) === 3,
    `freeRuns=${freeRuns} count=${getCount(FREE_USER_ID, guard.FREE_ONCE_PERIOD)}`,
  );

  // ── 3. Struktur: kein Quota-Pfad konsultiert TEST_USER_IDS ─────────────────
  console.log('\n3) Quellcode: TEST_USER_IDS nur im Analytics-Filter, nie im Quota-Pfad');
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  // Erlaubte Konsumenten des Analytics-Filters (Ausschluss-Semantik).
  const ALLOWED_TEST_USER_IDS_CONSUMERS = new Set([
    'src/lib/tracking.ts', // Definition
    'src/lib/owner-id.ts', // Definition der Legacy-Liste (nur Kommentar-Erwähnung)
    'src/db/admin-analytics.ts', // EXCL/EXCLP-Ausschluss in den Aggregaten
    'src/api/tracking.ts', // hideOwnerTest in der Tracking-API
  ]);
  // Quota-/Usage-Pfade: hier darf TEST_USER_IDS NIE auftauchen.
  const QUOTA_PATH_FILES = [
    'src/lib/usage-guard.ts',
    'src/lib/usage-client.ts',
    'src/db/queries.ts',
    'src/ai/server.ts',
    'src/ai/stream.ts',
    'src/ai/package/package.ts',
    'src/ai/strategy-tiles.ts',
    'src/api/generate-stream.ts',
    'src/api/image-stream.ts',
  ];
  for (const f of QUOTA_PATH_FILES) {
    let src = '';
    try {
      src = read(f);
    } catch {
      check(`${f}: Datei lesbar`, false, 'Datei nicht gefunden');
      continue;
    }
    const hits = (src.match(/TEST_USER_IDS|LEGACY_OWNER_CLERK_IDS/g) ?? []).length;
    check(`${f}: kein TEST_USER_IDS/LEGACY_OWNER_CLERK_IDS im Quota-Pfad`, hits === 0, `${hits} Treffer`);
  }
  // Kein weiterer Konsument außerhalb der Allowlist (verhindert schleichendes Einwachsen).
  const { readdirSync, statSync } = await import('node:fs');
  const allSources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(new URL(dir, import.meta.url))) {
      const rel = `${dir.replace(/\/$/, '')}/${entry}`;
      const full = new URL(rel, import.meta.url);
      if (statSync(full).isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(entry)) allSources.push(rel);
    }
  };
  walk('src');
  const unexpected = allSources.filter((f) => {
    if (ALLOWED_TEST_USER_IDS_CONSUMERS.has(f)) return false;
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    return /TEST_USER_IDS|LEGACY_OWNER_CLERK_IDS/.test(src);
  });
  check(
    'kein unerwarteter Konsument von TEST_USER_IDS/LEGACY_OWNER_CLERK_IDS in src/',
    unexpected.length === 0,
    unexpected.join(', '),
  );
  // Der Analytics-Filter nutzt die Liste ausschließlich als AUSSCHLUSS.
  const adminAnalytics = read('src/db/admin-analytics.ts');
  const usageGuard = read('src/lib/usage-guard.ts');
  check(
    'admin-analytics.ts verwendet TEST_USER_IDS als Ausschluss (EXCL/EXCLP + excludedPseudonyms)',
    adminAnalytics.includes('EXCL') && adminAnalytics.includes('excludedPseudonyms'),
  );
  check(
    'admin-analytics.ts importiert NICHT aus dem Quota-Guard (Trennung der Listen)',
    !adminAnalytics.includes('usage-guard'),
  );
  check(
    'usage-guard.ts definiert den Override nur aus OWNER_CLERK_ID',
    /ADMIN_OVERRIDE_USER_IDS: ReadonlySet<string> = new Set\(\[\s*(?:\/\/[^\n]*\n\s*)*OWNER_CLERK_ID,\s*\]\)/.test(
      usageGuard,
    ),
    'Konstruktion von ADMIN_OVERRIDE_USER_IDS nicht wie erwartet',
  );

  // ── Ergebnis ───────────────────────────────────────────────────────────────
  console.log('\n--------------------------------------------------------------');
  console.log(`Checks: ${checks} · FAIL: ${failures}`);
  if (failures > 0) {
    console.log('FAILS:\n - ' + failLines.join('\n - '));
    console.log('ERGEBNIS: ROT');
    process.exit(1);
  }
  console.log('ERGEBNIS: GRÜN — Alt-Owner-Konto bleibt Free (Limit 3), Filter ≠ Override.');
}

await main();
