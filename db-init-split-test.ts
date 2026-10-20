// ─────────────────────────────────────────────────────────────────────────────
// DB-INIT-SPLIT — Regressionstest für den Incident vom 2026-10-20
// ─────────────────────────────────────────────────────────────────────────────
// Hintergrund: `initDb()` zerlegte `schemaSQL` mit `split(";")`. Ein Semikolon in
// einem `--`-Kommentar (schema.ts, Beta-Ende-Block) ergab ein Fragment, das mit
// `BESTEHENDE …` beginnt → Postgres 42601 → Transaktion rollte zurück → seit
// 2026-10-08 kam KEINE Migration in Produktion an (K4-B `generated_images` fehlte).
//
// Dieser Test beweist:
//   A. Der NEUE Split (kommentar-/stringbewusst) liefert nur echte Statements,
//      jedes beginnt mit einem gültigen SQL-Befehl; keine Kommentar-Waisen.
//   B. Die NEGATIVPROBE: der ALTE Split bricht nachweislich an Zeile 147.
//   C. schema.ts enthält kein Semikolon mehr in einem Kommentar (Hausregel).
//   D. Splitter-Grundfälle (`;` in Kommentar, String, Dollar-Quote, Block).
//   E. Der 500-Ursachen-Fix: kein blosses '../db'-Importziel mehr (das löst auf
//      die DATEI src/db.ts auf ⇒ `getDb is not a function`), und zur Laufzeit
//      liefert `listOwnImages()` ohne deps.sql den DATABASE_URL-Fehler — nicht
//      den TypeError aus dem Live-Befund.
//   F. initDb() verhält sich ohne DATABASE_URL sauber (skipped, kein Wurf).
//
// Läuft OHNE DB und ohne Netz:  bun db-init-split-test.ts
// Exit 0 nur, wenn alle Checks grün sind.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { schemaSQL } from './src/db/schema';
import {
  splitSqlStatements,
  splitSqlStatementsNaive,
  startsWithSqlKeyword,
  statementHead,
} from './src/db/sql-split';
import { dbInitState, dbSchemaReady, initDb } from './src/db/init';

const ROOT = new URL('.', import.meta.url).pathname.replace(/\/$/, '');

let passed = 0;
let failed = 0;
const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
};

// ── A. Neuer Split: Struktur ────────────────────────────────────────────────
console.log('\n[A] Neuer (kommentar-/stringbewusster) Split von schemaSQL');
const aware = splitSqlStatements(schemaSQL);
const naive = splitSqlStatementsNaive(schemaSQL);
console.log(`  · Statements: neu=${aware.statements.length}, alt=${naive.length}, Zeilen=${schemaSQL.split('\n').length}`);

check(aware.statements.length >= 50, `mindestens 50 Statements (${aware.statements.length})`);
check(aware.issues.length === 0, `keine Split-Issues (${aware.issues.length})`);
check(
  aware.statements.every((s) => startsWithSqlKeyword(s)),
  'jedes Statement beginnt mit einem gültigen SQL-Befehl',
);
const bannedHeads = ['BESTEHENDE', 'DARUNTER', 'NICHT', 'ANGEFASST', 'BEHALTEN', 'ANGE', 'ERBT'];
check(
  aware.statements.every((s) => !bannedHeads.includes(statementHead(s))),
  'kein Fragment beginnt mit einem Kommentarrest (BESTEHENDE/darunter/NICHT/…)',
);
check(
  aware.statements.every((s) => !s.startsWith('--') || s.includes('\nALTER') || s.includes('\nCREATE') || s.trim().split('\n').filter((l) => !l.trim().startsWith('--')).length > 0),
  'keine Kommentar-only-Fragmente',
);
const heads = [...new Set(aware.statements.map(statementHead))].sort();
console.log(`  · Statement-Typen: ${heads.join(', ')}`);

// Die Beta-Ende-Statements müssen als GANZE Statements vorkommen (der Kommentar
// davor darf sie nicht mehr abschneiden).
const hasApprovedDefault = aware.statements.some(
  (s) => /ALTER TABLE beta_signups ALTER COLUMN approved SET DEFAULT false/i.test(s),
);
const hasApprovedAdd = aware.statements.some(
  (s) => /ALTER TABLE beta_signups ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT FALSE/i.test(s),
);
check(hasApprovedAdd, 'Statement "ADD COLUMN approved …" intakt');
check(hasApprovedDefault, 'Statement "ALTER COLUMN approved SET DEFAULT false" intakt');

// ── B. Negativprobe: der ALTE Split bricht (historischer Schematext) ────────
console.log('\n[B] NEGATIVPROBE — der alte Split(";") am historischen Zeile-147-Text');
// Exakt der Beta-Ende-Block, wie er VOR dem Fix in schema.ts stand (Commit vor
// 2026-10-20). Damit bleibt der Nachweis reproduzierbar, auch nachdem die Datei
// repariert ist.
const historic147 = `-- approved on beta_signups (Beta-Ende, Owner 2026-10-08)
-- Ursprünglich: „beta access gate: every signup is auto-approved" (DEFAULT TRUE).
-- Seit dem Beta-Ende ist die Auto-Freischaltung aus: der Default ist FALSE, damit
-- eine (künftige) Zeile ohne explizites approved NIE den lebenslangen Rabatt
-- erbt. Beide Statements sind idempotent; BESTEHENDE Zeilen werden nicht
-- angefasst (kein UPDATE) — die vor dem Public Launch registrierten Nutzer
-- behalten ihre explizite approved = true und damit ihren 50-%-Rabatt.
ALTER TABLE beta_signups ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT FALSE;
ALTER TABLE beta_signups ALTER COLUMN approved SET DEFAULT false;`;
const historicNaive = splitSqlStatementsNaive(historic147);
const historicAware = splitSqlStatements(historic147);
const historicBad = historicNaive.filter((s) => !startsWithSqlKeyword(s));
console.log(`  · alter Split: ${historicNaive.length} Fragmente, davon kaputt: ${historicBad.length}`);
for (const bad of historicBad) console.log(`    → beginnt mit: ${JSON.stringify(bad.split('\n')[0].slice(0, 70))}`);
check(
  historicNaive.length === 3 && historicBad.filter((s) => s.toUpperCase().startsWith('BESTEHENDE')).length === 1,
  'alter Split zerlegt den Block in 3 Fragmente, genau 1 beginnt mit "BESTEHENDE"',
);
check(
  historicBad.some((s) => s.toUpperCase().startsWith('BESTEHENDE')),
  'alter Split bricht exakt an schema.ts:147 (Fragment beginnt mit "BESTEHENDE")',
);
check(historicAware.statements.length === 2, `neuer Split: 2 saubere Statements (${historicAware.statements.length})`);
check(
  historicAware.statements.every((s) => startsWithSqlKeyword(s)),
  'neuer Split: beide Statements der Negativprobe sind gültig',
);
// Und der heutige Schematext: beide Splits sind sauber (Text-Fix greift).
const currentNaiveBad = naive.filter((s) => !startsWithSqlKeyword(s));
console.log(`  · heutiger Schematext: alt=${naive.length} Fragmente, kaputt=${currentNaiveBad.length}`);
check(currentNaiveBad.length === 0, `heutiger Schematext ist auch für split(";") sauber (${currentNaiveBad.length} kaputt)`);
check(naive.length === aware.statements.length, `Statement-Zahl alt/neu identisch (${naive.length}/${aware.statements.length})`);

// ── C. Hausregel: kein Semikolon in Kommentaren von schema.ts ───────────────
console.log('\n[C] schema.ts — keine Semikolons in Kommentaren');
const schemaSrc = readFileSync(join(ROOT, 'src/db/schema.ts'), 'utf8');
const schemaLines = schemaSrc.split('\n');
const lineCommentSemicolons = schemaLines
  .map((line, idx) => ({ line, no: idx + 1 }))
  .filter(({ line }) => /^\s*--/.test(line) && line.includes(';'));
check(
  lineCommentSemicolons.length === 0,
  `keine '--'-Kommentarzeile mit Semikolon (${lineCommentSemicolons.length})`,
);
for (const hit of lineCommentSemicolons) console.log(`    · Zeile ${hit.no}: ${hit.line.slice(0, 90)}`);
const blockComments = [...schemaSrc.matchAll(/\/\*[\s\S]*?\*\//g)];
const blockWithSemicolon = blockComments.filter((m) => m[0].includes(';'));
check(blockWithSemicolon.length === 0, `kein Blockkommentar mit Semikolon (${blockWithSemicolon.length})`);
check(
  !/^\s*--.*idempotent;/.test(schemaSrc),
  'Zeile-147-Formulierung "idempotent; BESTEHENDE" ist umgeschrieben',
);
check(
  schemaLines.some((l) => l.includes('idempotent — BESTEHENDE')),
  'Zeile 147 lautet jetzt "idempotent — BESTEHENDE"',
);

// ── D. Splitter-Grundfälle ─────────────────────────────────────────────────
console.log('\n[D] Splitter-Grundfälle');
const semicolonCases: [string, string, number?][] = [
  ['Semikolon im Zeilenkommentar', '-- Kommentar; mit Semikolon\nCREATE TABLE a (id int);'],
  ['Semikolon im String-Literal', "INSERT INTO t (x) VALUES ('a;b');"],
  ['Semikolon im Escape-String (zwei Hochkommas)', "INSERT INTO t (x) VALUES ('a'';b');"],
  ['Semikolon im Dollar-Quote', 'DO $body$ BEGIN PERFORM 1; END $body$;'],
  ['Semikolon im Blockkommentar', '/* eins; zwei */ CREATE TABLE b (id int);'],
  ['mehrere Statements', 'ALTER TABLE t ADD COLUMN x int; CREATE TABLE c (id int);', 2],
];
for (const [label, sqlText, expected] of semicolonCases) {
  const want = expected ?? 1;
  const r = splitSqlStatements(sqlText);
  check(
    r.statements.length === want && r.statements.every((s) => startsWithSqlKeyword(s)),
    `${label} → ${want} gültige(s) Statement(s)`,
  );
}
const commentTail = splitSqlStatements('CREATE TABLE d (id int);\n-- nur noch Kommentar');
check(commentTail.statements.length === 1, 'Kommentar-Rest am Dateiende wird NICHT als Statement geliefert');
check(
  commentTail.issues.some((i) => i.kind === 'comment_only_tail'),
  'Kommentar-Rest am Dateiende wird als Issue gemeldet',
);

// ── E. 500-Ursache: Importziel + Laufzeit ──────────────────────────────────
console.log('\n[E] Kein blosses "../db"-Importziel (500-Ursache: getDb is not a function)');
const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
};
const srcFiles = walk(join(ROOT, 'src'));
const bareDbSpecifier = /(?:from|import\()\s*['"]\.\.\/db['"]/;
const offenders = srcFiles.filter((f) => bareDbSpecifier.test(readFileSync(f, 'utf8')));
console.log(`  · geprüfte Dateien: ${srcFiles.length}`);
for (const f of offenders) console.log(`    · ${f.replace(ROOT + '/', '')}`);
check(offenders.length === 0, `kein Modul importiert das Verzeichnis als "../db" (${offenders.length} Treffer)`);
check(
  readFileSync(join(ROOT, 'src/db/index.ts'), 'utf8').includes('export function getDb') &&
    readFileSync(join(ROOT, 'src/db.ts'), 'utf8').includes('export const sql'),
  'Hazard dokumentiert: src/db.ts (nur `sql`) liegt NEBEN src/db/index.ts (getDb)',
);

// Laufzeit-Beweis: ohne DATABASE_URL muss der DATABASE_URL-Fehler kommen — nicht
// der TypeError aus dem Live-Befund. (Vor dem Fix: "getDb is not a function".)
const savedDbUrl = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;
try {
  const { listOwnImages } = await import('./src/lib/generated-images-api');
  let msg = '';
  try {
    await listOwnImages('00000000-0000-0000-0000-000000000000', 20);
  } catch (err) {
    msg = err instanceof Error ? err.message : String(err);
  }
  console.log(`  · listOwnImages() ohne deps.sql → ${JSON.stringify(msg)}`);
  check(msg.includes('DATABASE_URL is not set'), 'listOwnImages löst getDb() aus (DATABASE_URL-Fehler)');
  check(!msg.includes('is not a function'), 'kein "getDb is not a function" mehr (Live-500 war genau das)');

  const { saveGeneratedImage } = await import('./src/lib/generated-images-service');
  let msg2 = '';
  try {
    await saveGeneratedImage({ userId: '00000000-0000-0000-0000-000000000000', dataUrl: '', aspectRatio: null, prompt: null, projectId: null });
  } catch (err) {
    msg2 = err instanceof Error ? err.message : String(err);
  }
  console.log(`  · saveGeneratedImage() ohne deps → ${JSON.stringify(msg2)}`);
  check(!msg2.includes('is not a function'), 'saveGeneratedImage löst getDb korrekt auf (kein TypeError)');
} finally {
  if (savedDbUrl !== undefined) process.env.DATABASE_URL = savedDbUrl;
}

// ── F. initDb-Zustand ohne DATABASE_URL ───────────────────────────────────
console.log('\n[F] initDb() ohne DATABASE_URL');
delete process.env.DATABASE_URL;
const state = await initDb();
if (savedDbUrl !== undefined) process.env.DATABASE_URL = savedDbUrl;
check(state.status === 'skipped', `undefined Zustand "skipped" statt Wurf (${state.status})`);
check(dbSchemaReady() === false, 'dbSchemaReady() ist ohne DB-Lauf false (fail-closed)');
check(dbInitState().status === 'skipped', 'dbInitState() spiegelt den Zustand');

// ── Ergebnis ───────────────────────────────────────────────────────────────
console.log(`\n=== db-init-split-test: ${passed} PASS, ${failed} FAIL ===`);
if (failed > 0) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}
process.exit(0);
