// ─────────────────────────────────────────────────────────────────────────────
// „Fehler ohne Ergebnis kostet nichts" — gezielte Prüfung OHNE KI-Aufruf.
// Owner-Freigabe 2026-11-13 (Weg 1), Prüfpunkt vor dem Deploy.
//
// Lauf gegen die DEMO-DB (growimo_demo), nie gegen Prod:
//   bun --env-file=/tmp/hotfix-demo.env kontingent-ohne-ergebnis-test.ts
//
// Geprüft wird der ECHTE Serverpfad (src/ai/stream.ts + src/lib/usage-guard.ts):
//   A) Das Ergebnis erreicht die Verbindung NICHT (emit → false):
//      releaseGeneration greift, der Zähler bleibt unverändert.
//   B) Gegenprobe: wird geliefert (emit → true), sinkt das Kontingent um genau 1
//      — sonst wäre A nur „es passiert nie etwas" und kein Beweis.
//   C) Client-Fehlerpfad löscht kein bereits geliefertes Ergebnis mehr
//      (Quelltext-Assertion auf src/routes/app/new-project.tsx).
// Kein Anbieteraufruf: der Kanal-Runner ist ein Stub.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { runStrategyStream } from './src/ai/stream';
import type { StreamEvent } from './src/ai/stream';
import type { ContentResult, ContentType } from './src/ai/types';
import { getDb } from './src/db/index';
import { initDb } from './src/db/init';
import { ensureUserRow, qGetUsage } from './src/db/queries';
import { FREE_ONCE_PERIOD } from './src/lib/usage-guard';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(cond: boolean, label: string, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ PASS: ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const CLERK_ID = `hotfix-kein-verbrauch-${Date.now().toString(36)}`;
const sql = getDb();

function stubResult(ct: ContentType): ContentResult {
  return {
    contentType: ct,
    title: 'Testtitel',
    body: 'Testtext',
    metadata: {},
    score: 0,
    target: 0,
  } as unknown as ContentResult;
}

async function main() {
  await initDb();

  // [0] Ziel-DB belegen — nicht der URL glauben, der DB glauben.
  const dbRows = await sql`SELECT current_database() AS db`;
  const dbName = String(dbRows[0].db);
  check(dbName === 'growimo_demo', `[0] Ziel-DB ist growimo_demo (ist: ${dbName})`);

  // Synthetischer Testnutzer (Free, Kontingent 3, Periode 'once').
  await ensureUserRow(CLERK_ID, `${CLERK_ID}@example.invalid`, 'Hotfix Test');
  const before0 = await qGetUsage(CLERK_ID, FREE_ONCE_PERIOD);
  check(before0 === 0, `[1] Testnutzer startet bei 0 Einheiten (ist: ${before0})`);

  // ── Fall A: Ergebnis erreicht die Verbindung NICHT ────────────────────────
  const seenA: StreamEvent[] = [];
  const emitDropped = (event: StreamEvent): boolean => {
    seenA.push(event);
    // Nur das Ergebnis „verliert" die Verbindung; alles andere geht durch.
    return event.type !== 'result';
  };
  const beforeA = await qGetUsage(CLERK_ID, FREE_ONCE_PERIOD);
  await runStrategyStream([{ contentType: 'pinterest', productIdea: 'Testprodukt' }], emitDropped, {
    userId: CLERK_ID,
    runner: async (req) => stubResult(req.contentType),
  });
  const afterA = await qGetUsage(CLERK_ID, FREE_ONCE_PERIOD);
  check(
    seenA.some((e) => e.type === 'result'),
    '[A1] Ergebnis wurde erzeugt und dem Client zugestellt versucht (result-Event vorhanden)',
  );
  check(
    afterA === beforeA,
    `[A2] Fehler ohne Ergebnis kostet KEINE Einheit (vorher ${beforeA}, nachher ${afterA})`,
    `Zähler stieg um ${afterA - beforeA}`,
  );

  // ── Fall B: Gegenprobe — geliefert = genau eine Einheit ───────────────────
  const emitDelivered = (): boolean => true;
  const beforeB = await qGetUsage(CLERK_ID, FREE_ONCE_PERIOD);
  await runStrategyStream([{ contentType: 'pinterest', productIdea: 'Testprodukt' }], emitDelivered, {
    userId: CLERK_ID,
    runner: async (req) => stubResult(req.contentType),
  });
  const afterB = await qGetUsage(CLERK_ID, FREE_ONCE_PERIOD);
  check(
    afterB - beforeB === 1,
    `[B1] Gegenprobe: geliefertes Ergebnis kostet GENAU 1 Einheit (vorher ${beforeB}, nachher ${afterB})`,
    `Differenz ${afterB - beforeB}`,
  );

  // ── Fall C: Client löscht kein geliefertes Ergebnis mehr ──────────────────
  const src = readFileSync('src/routes/app/new-project.tsx', 'utf8');
  // Den catch-Block des Generierungs-Fehlerpfads exakt ausschneiden (Klammern
  // zählen) — „kein setResults([]) irgendwo" wäre falsch, der Reset-Knopf und
  // der Start einer NEUEN Generierung dürfen weiterhin leeren.
  const marker = src.indexOf('isQuotaExhaustedError(error)');
  const blockEnd = (from: number): number => {
    const braceOpen = src.indexOf('{', from);
    let depth = 0;
    for (let i = braceOpen; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  };
  // Der INNERE catch (stringifyError) endet vor dem Marker — gesucht ist der
  // umschliessende catch des Generierungs-Fehlerpfads.
  let catchBlock = '';
  if (marker > 0) {
    const starts: number[] = [];
    for (let i = src.indexOf('} catch'); i >= 0; i = src.indexOf('} catch', i + 1)) starts.push(i);
    const enclosing = starts.filter((s) => s < marker && blockEnd(s) > marker).pop();
    if (enclosing !== undefined) {
      const open = src.indexOf('{', enclosing);
      catchBlock = src.slice(open, blockEnd(enclosing) + 1);
    }
  }
  // Kommentarzeilen ausblenden — der Fix nennt `setResults([])` im Kommentar,
  // geprüft wird der AUSGEFÜHRTE Code.
  const catchCode = catchBlock
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  check(
    catchCode.length > 0 && !catchCode.includes('setResults([])'),
    '[C1] Generierungs-Fehlerpfad (catch) löscht kein geliefertes Ergebnis mehr',
    catchCode.length === 0 ? 'catch-Block nicht gefunden' : 'setResults([]) im catch',
  );
  check(
    catchCode.includes('results_generation_failed'),
    '[C1b] … und zeigt stattdessen die echte Fehlermeldung',
  );
  check(
    src.includes('results_save_failed'),
    '[C2] Speicherfehler hat einen eigenen Pfad (Hinweis results_save_failed) statt Löschung',
  );
  const declIdx = src.indexOf('const channelErrors');
  const streamIdx = src.indexOf('if (isStreamGenerateEnabled())');
  check(
    declIdx >= 0 && streamIdx >= 0 && declIdx < streamIdx,
    '[C3] channelErrors steht AUSSERHALB des Stream-Zweigs (Ursache des ReferenceError)',
    `decl@${declIdx} stream@${streamIdx}`,
  );

  console.log(`\nERGEBNIS: ${passed} PASS / ${failed} FAIL`);
  if (failed > 0) console.log(`Fehlgeschlagen: ${failures.join(' | ')}`);
}

try {
  await main();
} catch (err) {
  failed += 1;
  console.error('ABBRUCH:', err instanceof Error ? err.message : err);
} finally {
  // Testdaten restlos entfernen (Demo-DB).
  try {
    const rows = await sql`SELECT id FROM users WHERE clerk_id = ${CLERK_ID}`;
    if (rows.length > 0) {
      const uid = rows[0].id;
      await sql`DELETE FROM usage_events WHERE user_id = ${uid}`;
      await sql`DELETE FROM usage_monthly WHERE user_id = ${uid}`;
      await sql`DELETE FROM users WHERE id = ${uid}`;
    }
    const rest = await sql`SELECT count(*)::int AS n FROM users WHERE clerk_id = ${CLERK_ID}`;
    console.log(`Aufgeräumt: ${rest[0].n} Restzeilen für den Testnutzer.`);
  } catch (cleanupErr) {
    console.error('Aufräumen fehlgeschlagen:', cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    failed += 1;
  }
  process.exit(failed === 0 ? 0 : 1);
}
