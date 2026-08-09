import { getDb } from "./index";
import { schemaSQL } from "./schema";

let initialized = false;

export async function initDb(): Promise<void> {
  if (initialized) return;

  try {
    const sql = getDb();
    // The Neon HTTP driver rejects multi-statement strings ("cannot insert
    // multiple commands into a prepared statement"), so split the schema into
    // individual statements and run them as a single non-interactive
    // transaction. No statement in schemaSQL contains a semicolon inside a
    // string literal or comment, so splitting on ';' is safe.
    const statements = schemaSQL
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    await sql.transaction(statements.map((stmt) => sql`${sql.unsafe(stmt)}`));
    initialized = true;
    console.log("[db] Schema initialized successfully.");
  } catch (err) {
    // If DATABASE_URL isn't set yet, log and continue — the app
    // can still render the UI (landing page, sign-in, etc.).
    if (
      err instanceof Error &&
      err.message.includes("DATABASE_URL is not set")
    ) {
      console.log("[db] Skipping init — DATABASE_URL not configured.");
      return;
    }
    console.error("[db] Schema initialization failed:", err);
  }
}
