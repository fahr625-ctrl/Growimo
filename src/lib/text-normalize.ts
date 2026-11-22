// ─────────────────────────────────────────────────────────────────────────────
// Text-Normalisierung nach dem Auslesen einer Modellantwort (2026-11-18)
// ─────────────────────────────────────────────────────────────────────────────
// BEFUND (Vorschau, Ablauf 1, 2026-11-18): Die Überschrift des fertigen Pins
// lautete wörtlich
//   „Sojawachs-Kerzen für entspannte Abende — handgefertigt und einzigartig\"
// also mit einem Backslash vor dem schließenden Anführungszeichen. Der Rest
// entsteht beim AUSLESEN der Modellantwort (JSON-Escape bleibt im Klartext
// stehen), nicht im Renderer. Betroffen war nicht nur das Bild, sondern auch
// der kopierbare Pinterest-Text: ein Nutzer hätte den Backslash mitkopiert.
//
// Nachtrag (Vorschau, Ablauf 1 mit dem ersten Fix, 2026-11-18): Die Antwort kam
// diesmal MEHRFACH escaped an — im Titel standen DREI Backslashes vor dem
// schließenden Anführungszeichen. Ein einzelner Durchlauf löst nur eine Ebene
// auf, danach blieb ein Backslash stehen und der Renderer verweigerte das Bild
// (`text_escaped`), obwohl der Inhalt völlig in Ordnung war.
//
// Deshalb drei Stufen, absichtlich getrennt:
//   1. `normalizeModelText` — löst Escape-Reste WIEDERHOLT auf (`\"` → `"`,
//      literale `\n`/`\t` → echte Zeichen), höchstens `MAX_ESCAPE_PASSES`
//      Durchläufe und Abbruch, sobald sich nichts mehr ändert. Danach wird ein
//      Backslash, der unmittelbar vor einem Anführungszeichen steht, entfernt
//      (`resolveEscapes`): das ist ein Escape-Rest und kein Wortinhalt —
//      es geht nichts verloren, also kein Grund, dem Nutzer das Bild zu
//      verweigern. Zuletzt wird ein offenes deutsches Anführungszeichen
//      geschlossen.
//   2. `hasResidualEscape` — bleibt danach noch ein Backslash stehen (mitten im
//      Wort, vor einem Leerzeichen, hinter einem Buchstaben), ist der Text
//      NICHT vertrauenswürdig. Er wird nicht weiter „geputzt": der Renderer
//      verweigert das Bild (`PinRenderError` mit `text_escaped`). Fail-closed
//      statt stiller Reparatur, weil ein Backslash mitten im Wort nie eine
//      gewollte Schreibweise ist.
//
// Reines Modul ohne Abhängigkeiten — nutzbar in Server-Pfad (Parser, Renderer)
// und in Tests.
// ─────────────────────────────────────────────────────────────────────────────

/** Deutsche öffnende Anführungszeichen (U+201E). */
const DE_OPEN = '„';
/** Deutsches schließendes Anführungszeichen (U+201C) — das Paar zu „. */
const DE_CLOSE = '\u201C';
/** Mögliche schließende Zeichen: deutsch (U+201C), englisch (U+201D), gerade (U+0022). */
const CLOSERS = /["“”]/g;
/**
 * Schlusszeichen, die NICHT deutsch sind: gerade und englisches
 * Anführungszeichen. Sie werden zum deutschen Schlusszeichen, sobald die Zeile
 * mit „ öffnet (Befund 2026-11-22: „…" sah im fertigen Pin inkonsistent aus).
 */
const FOREIGN_CLOSERS = /["”]/g;
/**
 * Gliederungszeichen: das Schlusszeichen steht DAVOR („Text", …). Nach einem
 * Satzpunkt steht es DAHINTER („Text.") — deshalb wird sonst einfach angehängt.
 */
const CLAUSE_END = /[,;:]$/;

/**
 * Wie oft Escape-Reste höchstens aufgelöst werden. Drei Durchläufe decken
 * einfach, doppelt und dreifach escaped ab; danach bricht die Schleife ab,
 * sobald sich nichts mehr ändert (und spätestens hier, damit ein Text mit
 * sehr vielen Backslashes nicht endlos weiterläuft).
 */
export const MAX_ESCAPE_PASSES = 3;

/** Ein Escape vor Anführungszeichen oder Backslash (`\"`, `\'`, `\\`, …). */
const ESCAPED_CHAR = /\\(["'`\\])/g;
/**
 * Ein Backslash UNMITTELBAR vor einem Anführungszeichen. Das ist ein
 * Escape-Rest ohne Wortinhalt — er wird entfernt, statt das Bild zu verweigern.
 */
const QUOTE_ESCAPE = /\\(?=["'`„“”])/g;

/**
 * Löst Escape-Reste auf: WIEDERHOLT (`\\"` → `\"` → `"`, literale `\n`/`\t` →
 * echte Zeichen), höchstens `MAX_ESCAPE_PASSES` Durchläufe, Abbruch sobald sich
 * nichts mehr ändert. Danach wird ein Backslash, der unmittelbar vor einem
 * Anführungszeichen steht, entfernt: das ist ein Escape-Rest ohne Wortinhalt —
 * es geht nichts verloren, also kein Grund, dem Nutzer das Bild zu verweigern.
 * Backslashes mitten im Wort bleiben stehen (darüber entscheidet der Riegel).
 * `null`/`undefined` bleiben `null` (der Renderer unterscheidet „kein
 * Untertitel" von „leerer Untertitel").
 */
export function resolveEscapes(text: string): string;
export function resolveEscapes(text: string | null | undefined): string | null;
export function resolveEscapes(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  let out = text;
  for (let pass = 0; pass < MAX_ESCAPE_PASSES; pass++) {
    const next = out
      // Erst die Backslash-Paare (`\\` → `\`), damit aus `\\n` im nächsten
      // Schritt ein echter Zeilenumbruch wird.
      .replace(ESCAPED_CHAR, '$1')
      .replace(/\\r\\n|\\n/g, '\n')
      .replace(/\\t/g, ' ');
    if (next === out) break;
    out = next;
  }
  return out.replace(QUOTE_ESCAPE, '');
}

/**
 * Deutsche Anführungszeichen einer Zeile sauber schließen (2026-11-22).
 *
 * Zwei Schritte, in dieser Reihenfolge:
 *   1. Öffnet die Zeile mit „ (U+201E), wird jedes gerade `"` und jedes
 *      englische `"` (U+201D) zum deutschen Schlusszeichen `"` (U+201C). Der
 *      Wortlaut bleibt Zeichen für Zeichen gleich — es ändert sich nur die
 *      Form des Schlusszeichens, und es entsteht KEIN Backslash (kein
 *      Escape-Rest).
 *   2. Fehlt danach ein Schlusszeichen, wird es ans Zeilenende gesetzt — nach
 *      einem Satzpunkt („Text."), vor einem Komma/Strichpunkt/Doppelpunkt
 *      („Text", …).
 * Gibt es mehr Schluss- als Öffnungszeichen, wird nichts angehängt (nichts
 * wird erfunden).
 */
function closeGermanQuotes(line: string): string {
  const opens = line.split(DE_OPEN).length - 1;
  if (opens === 0) return line;
  const out = line.replace(FOREIGN_CLOSERS, DE_CLOSE);
  const closes = (out.match(CLOSERS) ?? []).length;
  if (opens <= closes) return out;
  let closed = out.replace(/\s+$/, '');
  for (let i = opens - closes; i > 0; i--) {
    closed = CLAUSE_END.test(closed)
      ? closed.replace(CLAUSE_END, `${DE_CLOSE}$&`)
      : `${closed}${DE_CLOSE}`;
  }
  return closed;
}

/**
 * Text aus einer Modellantwort lesbar machen: Escape-Reste auflösen und
 * deutsche Anführungszeichen schließen. IDEMPOTENT für bereits sauberen Text
 * (er wird Zeichen für Zeichen unverändert zurückgegeben).
 */
export function normalizeModelText(text: string | null | undefined): string {
  if (!text) return '';
  // 1) Escape-Reste wiederholt auflösen (ein-, zwei-, dreifach escaped) und
  //    einen Backslash vor einem Anführungszeichen entfernen.
  // 2) Offene deutsche Anführungszeichen je Zeile schließen.
  const out = resolveEscapes(text) ?? '';
  return out.split('\n').map(closeGermanQuotes).join('\n');
}

/**
 * Steckt nach der Normalisierung noch ein Backslash im Text? Dann ist der
 * Text nicht vertrauenswürdig und darf nicht ins Bild (fail-closed).
 */
export function hasResidualEscape(text: string | null | undefined): boolean {
  return /\\/.test(text ?? '');
}

/**
 * Erster Text mit Rest-Escape — für Fehlermeldungen, die die Stelle benennen.
 * `null`, wenn alles sauber ist.
 */
export function findResidualEscape(
  values: Array<string | null | undefined>,
): string | null {
  for (const value of values) {
    if (hasResidualEscape(value)) return String(value);
  }
  return null;
}
