// ─────────────────────────────────────────────────────────────────────────────
// Test: Rest-Escape im Pin-Titel (2026-11-18, mehrfach escaped)
// ─────────────────────────────────────────────────────────────────────────────
// Usage (aus der Repo-Wurzel):
//   bun pin-titel-escape-test.ts
//
// Belegt den Befund aus dem Vorschau-E2E (Ablauf 1, zweite Runde): Die
// Überschrift des fertigen Pins stand wörtlich als
//   „Sojawachs-Kerzen für entspannte Abende — deine Oase zuhause\\\"
// im Ergebnis — DREI Backslashes vor dem schließenden Anführungszeichen. Ein
// einzelner Normalisierungs-Durchlauf löste nur eine Ebene auf, danach blieb ein
// Backslash stehen und `renderPinPng` verweigerte das Bild (`text_escaped`).
//
// Geprüft wird:
//   1. `parseResponse` liefert den Titel OHNE Backslash — für einfach, doppelt
//      und dreifach escaped (und der kopierbare Pin-Text ebenso).
//   2. `normalizeModelText` löst ein-, zwei- und dreifach escaped auf, ist
//      begrenzt (Abbruch bei keiner Änderung) und idempotent.
//   3. Ein Backslash unmittelbar vor einem Anführungszeichen wird entfernt
//      (`resolveEscapes`) — das Bild entsteht, statt verweigert zu werden.
//   4. Fail-closed bleibt für Backslashes MITTEN im Wort (`PinRenderError`
//      mit `text_escaped`).
//   5. Negativkontrolle: sauberer Text löst den Riegel nicht aus.
//
// Kein DB-Zugriff, kein Netzwerk, kein KI-Aufruf.
// Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import { parseResponse } from './src/ai/providers/openai';
import { PinRenderError, renderPinPng } from './src/lib/kampagne/pin-render';
import {
  MAX_ESCAPE_PASSES,
  findResidualEscape,
  hasResidualEscape,
  normalizeModelText,
  resolveEscapes,
} from './src/lib/text-normalize';

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Die Befunde, ZEICHENGENAU: n Backslashes + gerades Schlusszeichen am Ende.
const BEFUND_EINFACH = '„Sojawachs-Kerzen für entspannte Abende — handgefertigt und einzigartig\\"';
const BEFUND_DOPPELT = '„Sojawachs-Kerzen für entspannte Abende — handgefertigt und einzigartig\\\\"';
const BEFUND_DREIFACH = '„Sojawachs-Kerzen für entspannte Abende — deine Oase zuhause\\\\\\"';
// Was daraus werden muss: deutsches Schlusszeichen, kein Backslash.
const ERWARTET_TITEL = '„Sojawachs-Kerzen für entspannte Abende — handgefertigt und einzigartig"';
const ERWARTET_DREIFACH = '„Sojawachs-Kerzen für entspannte Abende — deine Oase zuhause"';

console.log('Befund-Titel (dreifach, roh):', BEFUND_DREIFACH);
check('Befund-Titel enthält wirklich Backslashes', hasResidualEscape(BEFUND_DREIFACH));
check(
  'Befund-Titel trägt genau drei Backslashes',
  (BEFUND_DREIFACH.match(/\\/g) ?? []).length === 3,
  String((BEFUND_DREIFACH.match(/\\/g) ?? []).length),
);

// ── 1. Parser: Titel und kopierbarer Text ohne Escape-Rest ──────────────────
function rohantwort(titel: string): string {
  return [
    `1. SEO Pin-Titel: ${titel}`,
    '2. Pin-Beschreibung: Handgegossene Sojawachs-Kerzen für ruhige Abende.',
    '3. Fokus-Keywords: sojawachs, kerzen, entspannung',
    '4. Hashtags: #kerzen #sojawachs',
  ].join('\n');
}

const faelle: Array<{ name: string; roh: string; erwartet: string }> = [
  { name: 'einfach escaped', roh: BEFUND_EINFACH, erwartet: ERWARTET_TITEL },
  { name: 'doppelt escaped', roh: BEFUND_DOPPELT, erwartet: ERWARTET_TITEL },
  { name: 'dreifach escaped', roh: BEFUND_DREIFACH, erwartet: ERWARTET_DREIFACH },
];
for (const fall of faelle) {
  const parsed = parseResponse('pinterest_pin', rohantwort(fall.roh));
  console.log(`Geparster Titel (${fall.name}):`, parsed.title);
  check(`1a ${fall.name}: Titel ohne Rest-Escape`, !hasResidualEscape(parsed.title), parsed.title);
  check(`1b ${fall.name}: Titel ist der erwartete Text`, parsed.title === fall.erwartet, parsed.title);
  check(`1c ${fall.name}: Titel schließt mit Anführungszeichen`, parsed.title.endsWith('"'));
  check(`1d ${fall.name}: Pin-Text (Body) ohne Rest-Escape`, !hasResidualEscape(parsed.body));
}

// ── 2. Normalisierung: wiederholt, begrenzt, idempotent ─────────────────────
check(
  '2a einfach escaped wird aufgelöst',
  normalizeModelText(BEFUND_EINFACH) === ERWARTET_TITEL,
  normalizeModelText(BEFUND_EINFACH),
);
check(
  '2b doppelt escaped wird aufgelöst',
  normalizeModelText(BEFUND_DOPPELT) === ERWARTET_TITEL,
  normalizeModelText(BEFUND_DOPPELT),
);
check(
  '2c dreifach escaped wird aufgelöst',
  normalizeModelText(BEFUND_DREIFACH) === ERWARTET_DREIFACH,
  normalizeModelText(BEFUND_DREIFACH),
);
check(
  '2d Normalisierung ist begrenzt (Abbruch bei keiner Änderung)',
  MAX_ESCAPE_PASSES >= 3 && MAX_ESCAPE_PASSES <= 5,
  String(MAX_ESCAPE_PASSES),
);
check(
  '2e literales \\n wird zum Zeilenumbruch',
  normalizeModelText('Zeile 1\\nZeile 2') === 'Zeile 1\nZeile 2',
);
check(
  '2f auch doppelt escaped \\\\n wird zum Zeilenumbruch',
  normalizeModelText('Zeile 1\\\\nZeile 2') === 'Zeile 1\nZeile 2',
  JSON.stringify(normalizeModelText('Zeile 1\\\\nZeile 2')),
);
check(
  '2g offenes „ wird am Satzende geschlossen',
  normalizeModelText('„Kerzen für ruhige Abende') === '„Kerzen für ruhige Abende"',
);
check(
  '2h Schlusszeichen steht VOR dem Satzpunkt',
  normalizeModelText('„Kerzen für ruhige Abende.') === '„Kerzen für ruhige Abende."',
);
const einmal = normalizeModelText(rohantwort(BEFUND_DREIFACH));
const zweimal = normalizeModelText(einmal);
check('2i Normalisierung ist idempotent', einmal === zweimal);

// ── 3. Backslash vor Anführungszeichen: entfernen statt verweigern ──────────
check(
  '3a resolveEscapes entfernt den Backslash vor dem Schlusszeichen',
  resolveEscapes('Text\\"') === 'Text"',
  resolveEscapes('Text\\"'),
);
check('3b Text ohne Backslash bleibt unverändert', resolveEscapes('Text "zitat"') === 'Text "zitat"');
check('3c null bleibt null (kein Untertitel)', resolveEscapes(null) === null);
check(
  '3d Backslash MITTEN im Wort bleibt stehen',
  resolveEscapes('Ker\\zen') === 'Ker\\zen',
  resolveEscapes('Ker\\zen'),
);

// ── 4. Fail-closed-Riegel bleibt für Backslashes mitten im Wort ─────────────
const DUMMY_FOTO = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
async function riegel(code: string, titel: string, untertitel: string | null): Promise<void> {
  try {
    await renderPinPng({
      photo: DUMMY_FOTO,
      layout: 'bottom-left',
      title: titel,
      subtitle: untertitel,
    });
    check(code, false, 'kein Fehler — der Riegel hat nicht gegriffen');
  } catch (err) {
    const isPinError = err instanceof PinRenderError;
    check(
      code,
      isPinError && err.code === 'text_escaped',
      isPinError ? `code=${err.code}` : String(err),
    );
  }
}

await riegel('4a Backslash mitten im Titel-Wort ⇒ kein Bild', 'Ker\\zen für Abende', null);
await riegel('4b doppelter Backslash mitten im Wort ⇒ kein Bild', 'Titel mit \\\\ Rest', null);
await riegel('4c Backslash im Untertitel mitten im Wort ⇒ kein Bild', ERWARTET_TITEL, 'Text mit \\ Rest');

// Ein Backslash VOR einem Anführungszeichen ist dagegen kein Grund, das Bild zu
// verweigern: der Renderer entfernt ihn und rendert weiter (er scheitert hier
// höchstens an den Dummy-Foto-Bytes, NICHT an `text_escaped`).
for (const [code, titel] of [
  ['4d Backslash vor dem Schlusszeichen ⇒ Bild wird nicht verweigert', BEFUND_EINFACH],
  ['4e drei Backslashes vor dem Schlusszeichen ⇒ Bild wird nicht verweigert', BEFUND_DREIFACH],
] as Array<[string, string]>) {
  try {
    await renderPinPng({ photo: DUMMY_FOTO, layout: 'bottom-left', title: titel });
    check(code, false, 'unerwartet: kein Fehler');
  } catch (err) {
    const pinCode = err instanceof PinRenderError ? err.code : 'other';
    check(code, pinCode !== 'text_escaped', `code=${pinCode}`);
  }
}

// ── 5. Negativkontrolle: sauberer Text löst den Riegel nicht aus ────────────
check('5a bereinigter Titel hat keinen Rest-Escape', !hasResidualEscape(ERWARTET_TITEL));
check(
  '5b findResidualEscape meldet nichts für sauberen Text',
  findResidualEscape([ERWARTET_TITEL, 'Untertitel ohne Backslash', null]) === null,
);
try {
  await renderPinPng({ photo: DUMMY_FOTO, layout: 'bottom-left', title: ERWARTET_TITEL });
  check('5c sauberer Titel erreicht den Riegel nicht', false, 'unerwartet: kein Fehler');
} catch (err) {
  const code = err instanceof PinRenderError ? err.code : 'other';
  check('5c sauberer Titel scheitert NICHT an text_escaped', code !== 'text_escaped', `code=${code}`);
}

if (failures > 0) {
  console.error(`\n${failures} Check(s) rot.`);
  process.exit(1);
}
console.log('\nAlle Checks grün.');
