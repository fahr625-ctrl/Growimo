// ─────────────────────────────────────────────────────────────────────────────
// SQL-Statement-Splitter für `src/db/schema.ts` (Kommentar-/String-bewusst)
// ─────────────────────────────────────────────────────────────────────────────
// Warum diese Datei existiert (Incident 2026-10-20):
//   `initDb()` hat `schemaSQL` mit `split(";")` zerlegt. Ein Semikolon INNERHALB
//   eines `--`-Kommentars (schema.ts, Beta-Ende-Block) zerschnitt den Kommentar,
//   das Folge-Fragment begann mit `BESTEHENDE …` → Postgres 42601 → die EINE
//   Transaktion rollte zurück → **seit 2026-10-08 erreichte keine Migration mehr
//   die Produktion** (die K4-B-Tabelle `generated_images` fehlte live).
//
// Dieser Splitter trennt nur an Semikolons, die in „normalem" Kontext stehen —
// NICHT in `--`-Zeilenkommentaren, `/* … */`-Blockkommentaren, `'…'`-Strings
// (inkl. `''`-Escape), `"…"`-Bezeichnern oder `$tag$ … $tag$`-Dollar-Quotes.
// Führende Kommentare bleiben am folgenden Statement (keine Kommentar-Waisen).
//
// Ein Kommentar-only-Rest am Dateiende wird NICHT als Statement ausgeliefert,
// sondern als Issue gemeldet (er wäre eine leere Query).
// ─────────────────────────────────────────────────────────────────────────────

export type SplitIssueKind = "comment_only_tail" | "unterminated_string" | "unterminated_comment" | "empty_statement";

export interface SplitIssue {
  kind: SplitIssueKind;
  line: number;
  preview: string;
}

export interface SplitResult {
  statements: string[];
  issues: SplitIssue[];
}

const CODE_KEYWORDS = [
  "CREATE",
  "ALTER",
  "DROP",
  "DO",
  "COMMENT",
  "GRANT",
  "REVOKE",
  "INSERT",
  "UPDATE",
  "DELETE",
  "SELECT",
  "WITH",
  "SET",
  "TRUNCATE",
  "ANALYZE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
];

/** Zerlegt SQL in einzelne Statements (Kommentar- und String-bewusst). */
export function splitSqlStatements(input: string): SplitResult {
  const statements: string[] = [];
  const issues: SplitIssue[] = [];

  let buf = "";
  let codeChars = 0; // Zeichen im aktuellen Statement, die KEIN Kommentar sind
  let line = 1;
  let i = 0;

  const dropCommentOnlyBuffer = () => {
    // Nur Kommentare/Whitespace seit dem letzten Statement → verwerfen.
    if (codeChars === 0 && buf.trim().length > 0) {
      issues.push({ kind: "comment_only_tail", line, preview: buf.trim().split("\n")[0].slice(0, 80) });
    }
    buf = "";
    codeChars = 0;
  };

  while (i < input.length) {
    const c = input[i];
    const next = input[i + 1];

    // Zeilenkommentar
    if (c === "-" && next === "-") {
      const end = input.indexOf("\n", i);
      const stop = end === -1 ? input.length : end + 1;
      buf += input.slice(i, stop);
      if (end === -1) i = input.length;
      else {
        i = stop;
        line++;
      }
      continue;
    }

    // Blockkommentar
    if (c === "/" && next === "*") {
      const end = input.indexOf("*/", i + 2);
      if (end === -1) {
        issues.push({ kind: "unterminated_comment", line, preview: buf.trim().slice(-80) });
        buf += input.slice(i);
        break;
      }
      const chunk = input.slice(i, end + 2);
      buf += chunk;
      line += (chunk.match(/\n/g) ?? []).length;
      i = end + 2;
      continue;
    }

    // Einfach-String mit ''-Escape
    if (c === "'") {
      let j = i + 1;
      let closed = false;
      while (j < input.length) {
        if (input[j] === "'") {
          if (input[j + 1] === "'") {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j++;
      }
      const chunk = input.slice(i, closed ? j + 1 : input.length);
      if (!closed) issues.push({ kind: "unterminated_string", line, preview: chunk.slice(0, 80) });
      buf += chunk;
      codeChars += 1;
      line += (chunk.match(/\n/g) ?? []).length;
      i = closed ? j + 1 : input.length;
      continue;
    }

    // Doppelter Bezeichner
    if (c === '"') {
      const end = input.indexOf('"', i + 1);
      const chunk = input.slice(i, end === -1 ? input.length : end + 1);
      buf += chunk;
      codeChars += 1;
      line += (chunk.match(/\n/g) ?? []).length;
      i = end === -1 ? input.length : end + 1;
      continue;
    }

    // Dollar-Quote ($body$ … $body$)
    if (c === "$") {
      const tagMatch = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(input.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = input.indexOf(tag, i + tag.length);
        const chunk = input.slice(i, end === -1 ? input.length : end + tag.length);
        buf += chunk;
        codeChars += 1;
        line += (chunk.match(/\n/g) ?? []).length;
        i = end === -1 ? input.length : end + tag.length;
        continue;
      }
    }

    // Statement-Ende
    if (c === ";") {
      if (codeChars > 0) {
        statements.push(buf.trim());
        buf = "";
        codeChars = 0;
      } else {
        dropCommentOnlyBuffer();
      }
      i++;
      continue;
    }

    if (c === "\n") line++;
    if (!/\s/.test(c)) codeChars++;
    buf += c;
    i++;
  }

  // Rest (ohne abschließendes Semikolon)
  if (buf.trim().length > 0) {
    if (codeChars > 0) statements.push(buf.trim());
    else dropCommentOnlyBuffer();
  }

  return { statements, issues };
}

/**
 * Der ALTE, kaputte Split (`schemaSQL.split(";")`) — nur für die Negativprobe
 * im Test. Nicht im Produktivpfad benutzen.
 */
export function splitSqlStatementsNaive(input: string): string[] {
  return input
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Erstes echtes Wort eines Statements, führende Kommentare übersprungen. */
export function statementHead(statement: string): string {
  const stripped = statement
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
  const m = /^[A-Za-z_]+/.exec(stripped);
  return m ? m[0].toUpperCase() : "";
}

/** Beginnt das Statement mit einem gültigen SQL-Befehl? */
export function startsWithSqlKeyword(statement: string): boolean {
  return CODE_KEYWORDS.includes(statementHead(statement));
}
