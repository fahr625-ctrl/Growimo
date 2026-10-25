import { getDb } from "./index";
import { schemaSQL } from "./schema";
import { splitSqlStatements } from "./sql-split";
import { logTestDbPolicy, testDbPolicy } from "./test-guard";

// ─────────────────────────────────────────────────────────────────────────────
// Schema-Initialisierung (Einmal-Lauf pro Instanz)
// ─────────────────────────────────────────────────────────────────────────────
// Incident 2026-10-20: Der Split lief über `schemaSQL.split(";")`. Ein Semikolon
// in einem `--`-Kommentar (schema.ts, Beta-Ende-Block) riss den Kommentar
// auseinander, das Fragment danach (`BESTEHENDE …`) war kein SQL → Postgres 42601
// → die EINE Transaktion rollte zurück → **jede Migration seit 2026-10-08 kam in
// Produktion nie an** (`generated_images` fehlte live).
//
// Zwei Änderungen daraus:
//   1. Der Split ist Kommentar-/String-bewusst (`splitSqlStatements`).
//   2. Ein Fehlschlag ist NICHT mehr still: er wird laut geloggt, der Zustand
//      wird exportiert (`dbInitState`/`dbSchemaReady`) und die K4-B-Routen
//      antworten FAIL-CLOSED mit 503 statt mit einem 500/200.
//
// Verhalten für Bestandsdeploys bleibt bewusst gleich: initDb() wirft nicht,
// die App rendert weiterhin (Landing Page, Sign-in) — es ändert sich nur die
// Sichtbarkeit des Fehlers.

export type DbInitState =
  | { status: "pending" }
  | { status: "skipped"; reason: "no_database" | "prod_readonly_test" }
  | { status: "ok"; statements: number; at: string }
  | {
      status: "failed";
      at: string;
      code: string | null;
      error: string;
      statements: number;
      issues: string[];
      hint: string;
    };

let state: DbInitState = { status: "pending" };

/** Aktueller Initialisierungszustand (read-only Kopie). */
export function dbInitState(): DbInitState {
  return state;
}

/** Sind die Migrationen nachweislich durchgelaufen? (fail-closed: nur "ok") */
export function dbSchemaReady(): boolean {
  return state.status === "ok";
}

/** Fehlercode eines Postgres-/Treiber-Fehlers, falls vorhanden. */
function errorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") return String(code);
  }
  return null;
}

export async function initDb(): Promise<DbInitState> {
  if (state.status === "ok") return state;

  if (!process.env.DATABASE_URL) {
    state = { status: "skipped", reason: "no_database" };
    console.log("[db] Skipping init — DATABASE_URL not configured.");
    return state;
  }

  // TEST-SUITE-PROD-GUARD (Owner-Auftrag 2026-10-25): Migrationen sind
  // Schreibzugriffe. Läuft eine Repo-Test-Suite auf der PROD-DB (ohne
  // ALLOW_PROD_TESTS=write), wird die Migration hier NICHT ausgeführt — die
  // Suite läuft im Lesemodus weiter und ein echtes Schreib-Statement bricht
  // später fail-closed ab (src/db/test-guard.ts).
  if (testDbPolicy() === "readonly") {
    state = { status: "skipped", reason: "prod_readonly_test" };
    logTestDbPolicy();
    console.warn(
      "[db] Test-Suite auf der PROD-DB: Migrationen werden NICHT ausgeführt (Lesemodus).",
    );
    return state;
  }

  try {
    const sql = getDb();
    // Der Neon-Http-Treiber lehnt Mehrfach-Statements ab ("cannot insert
    // multiple commands into a prepared statement"), deshalb wird der Schematext
    // in einzelne Statements zerlegt und als EINE Transaktion gefahren.
    // Der Split MUSS kommentar-/stringbewusst sein — `split(";")` bricht an
    // Semikolons in `--`-Kommentaren (siehe Kopfkommentar).
    const { statements, issues } = splitSqlStatements(schemaSQL);
    if (issues.length > 0) {
      // Struktur-Probleme im Schematext: laut melden, aber weiterfahren (der
      // Splitter hat sie behandelt; Postgres entscheidet über die Gültigkeit).
      console.warn(
        "[db] Schema split warnings:",
        issues.map((i) => `${i.kind}@${i.line}: ${i.preview}`).join(" | "),
      );
    }
    if (statements.length === 0) {
      throw new Error("Schema split produced 0 statements — refusing to run.");
    }
    await sql.transaction(statements.map((stmt) => sql`${sql.unsafe(stmt)}`));
    state = { status: "ok", statements: statements.length, at: new Date().toISOString() };
    console.log(`[db] Schema initialized successfully (${statements.length} statements).`);
    return state;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = errorCode(err);
    state = {
      status: "failed",
      at: new Date().toISOString(),
      code,
      error: message,
      statements: 0,
      issues: [],
      hint:
        "Migrations have NOT been applied. Diagnose with `bun db-init-split-test.ts` (offline split/parse proof).",
    };
    // Laut und unübersehbar: dieser Fehler bedeutet, dass Schema-Erweiterungen
    // NICHT in der Datenbank angekommen sind.
    console.error(
      "[db] SCHEMA INIT FAILED — migrations did NOT reach the database (code=%s, at=%s): %s",
      code ?? "n/a",
      state.at,
      message,
    );
    console.error("[db] %s", state.hint);
    return state;
  }
}
