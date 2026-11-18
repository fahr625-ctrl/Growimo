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
// Deshalb zwei Stufen, und beide sind absichtlich getrennt:
//   1. `normalizeModelText` — repariert die harmlose Form GENAU EINMAL
//      (`\"` → `"`, literale `\n`/`\t` → echte Zeichen) und schließt ein
//      offenes deutsches Anführungszeichen am Satzende.
//   2. `hasResidualEscape` — bleibt danach noch ein Backslash stehen, ist der
//      Text NICHT vertrauenswürdig. Er wird nicht weiter „geputzt": der
//      Renderer verweigert das Bild (`PinRenderError` mit `text_escaped`).
//      Fail-closed statt stiller Reparatur, weil ein Backslash in einem
//      Pin-Titel nie eine gewollte Schreibweise ist.
//
// Reines Modul ohne Abhängigkeiten — nutzbar in Server-Pfad (Parser, Renderer)
// und in Tests.
// ─────────────────────────────────────────────────────────────────────────────

/** Deutsche öffnende Anführungszeichen (U+201E). */
const DE_OPEN = '„';
/** Mögliche schließende Zeichen: „deutsch" (U+201C), „englisch" (U+201D), gerade (U+0022). */
const CLOSERS = /["“”]/g;
/**
 * Gliederungszeichen: das Schlusszeichen steht DAVOR („Text", …). Nach einem
 * Satzpunkt steht es DAHINTER („Text.") — deshalb wird sonst einfach angehängt.
 */
const CLAUSE_END = /[,;:]$/;

/**
 * Ein offenes deutsches Anführungszeichen je Zeile sauber schließen.
 * Fehlt das Schlusszeichen, wird es ans Zeilenende gesetzt — nach einem
 * Satzpunkt („Text."), vor einem Komma/Strichpunkt/Doppelpunkt („Text", …).
 * Gibt es mehr Schluss- als Öffnungszeichen, bleibt die Zeile unangetastet
 * (nichts wird erfunden).
 */
function closeGermanQuotes(line: string): string {
  const opens = line.split(DE_OPEN).length - 1;
  const closes = (line.match(CLOSERS) ?? []).length;
  if (opens <= closes) return line;
  let out = line.replace(/\s+$/, '');
  for (let i = opens - closes; i > 0; i--) {
    out = CLAUSE_END.test(out) ? out.replace(CLAUSE_END, '"$&') : `${out}"`;
  }
  return out;
}

/**
 * Text aus einer Modellantwort lesbar machen: Escape-Reste auflösen und
 * deutsche Anführungszeichen schließen. IDEMPOTENT für bereits sauberen Text
 * (er wird Zeichen für Zeichen unverändert zurückgegeben).
 */
export function normalizeModelText(text: string | null | undefined): string {
  if (!text) return '';
  let out = text;
  // 1) Literale Steuer-Escapes aus einer JSON-/JS-Quelle.
  out = out.replace(/\\r\\n|\\n/g, '\n').replace(/\\t/g, ' ');
  // 2) Escape vor Anführungszeichen/Backslash — GENAU EIN Durchlauf. Ein
  //    zweiter Durchlauf würde `\\"` stillschweigend zu `"` machen; genau das
  //    soll der Riegel unten verhindern.
  out = out.replace(/\\(["'`\\])/g, '$1');
  // 3) Offene deutsche Anführungszeichen je Zeile schließen.
  out = out.split('\n').map(closeGermanQuotes).join('\n');
  return out;
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
