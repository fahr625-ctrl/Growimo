// ─────────────────────────────────────────────────────────────────────────────
// Test: Rest-Escape im Pin-Titel (2026-11-18)
// ─────────────────────────────────────────────────────────────────────────────
// Usage (aus der Repo-Wurzel):
//   bun pin-titel-escape-test.ts
//
// Belegt genau den Befund aus dem Vorschau-E2E (Ablauf 1): Die Überschrift des
// fertigen Pins stand wörtlich als
//   „Sojawachs-Kerzen für entspannte Abende — handgefertigt und einzigartig\"
// im Ergebnis — mit Backslash vor dem schließenden Anführungszeichen.
//
// Geprüft wird:
//   1. `parseResponse` liefert den Titel OHNE Backslash (und der kopierbare
//      Pin-Text ebenso).
//   2. Offene deutsche Anführungszeichen werden geschlossen.
//   3. Die Normalisierung ist idempotent (sauberer Text bleibt unverändert).
//   4. Fail-closed: `renderPinPng` verweigert ein Bild, in dem noch ein
//      Escape-Rest steckt (`PinRenderError` mit `text_escaped`).
//   5. Negativkontrolle: der bereinigte Titel löst den Riegel NICHT aus.
//
// Kein DB-Zugriff, kein Netzwerk, kein KI-Aufruf.
// Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import { parseResponse } from './src/ai/providers/openai';
import { PinRenderError, renderPinPng } from './src/lib/kampagne/pin-render';
import {
  findResidualEscape,
  hasResidualEscape,
  normalizeModelText,
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

// Der Befund, ZEICHENGENAU: Backslash + gerades Schlusszeichen am Ende.
const BEFUND_TITEL = '„Sojawachs-Kerzen für entspannte Abende — handgefertigt und einzigartig\\"';
// Was daraus werden muss: deutsches Schlusszeichen, kein Backslash.
const ERWARTET_TITEL = '„Sojawachs-Kerzen für entspannte Abende — handgefertigt und einzigartig"';

// Modellantwort, wie sie im Klartext ankommt (mehrere Sektionen, damit der
// Parser wirklich den Titel-Abschnitt ausliest).
const ROHANTWORT = [
  `1. SEO Pin-Titel: ${BEFUND_TITEL}`,
  '2. Pin-Beschreibung: Handgegossene Sojawachs-Kerzen für ruhige Abende.',
  '3. Fokus-Keywords: sojawachs, kerzen, entspannung',
  '4. Hashtags: #kerzen #sojawachs',
].join('\n');

console.log('Befund-Titel (roh):', BEFUND_TITEL);
check('Befund-Titel enthält wirklich einen Backslash', hasResidualEscape(BEFUND_TITEL));

// ── 1. Parser: Titel und kopierbarer Text ohne Escape-Rest ──────────────────
const parsed = parseResponse('pinterest_pin', ROHANTWORT);
console.log('Geparster Titel:', parsed.title);
check('1a Titel ohne Rest-Escape', !hasResidualEscape(parsed.title), parsed.title);
check('1b Titel ist der erwartete Text', parsed.title === ERWARTET_TITEL, parsed.title);
check('1c Titel schließt mit deutschem Schlusszeichen', parsed.title.endsWith('"'));
check('1d Pin-Text (Body) ohne Rest-Escape', !hasResidualEscape(parsed.body));

// ── 2. Deutsche Anführungszeichen sauber schließen ──────────────────────────
check(
  '2a offenes „ wird am Satzende geschlossen',
  normalizeModelText('„Kerzen für ruhige Abende') === '„Kerzen für ruhige Abende"',
  normalizeModelText('„Kerzen für ruhige Abende'),
);
check(
  '2b Schlusszeichen steht VOR dem Satzpunkt',
  normalizeModelText('„Kerzen für ruhige Abende.') === '„Kerzen für ruhige Abende."',
  normalizeModelText('„Kerzen für ruhige Abende.'),
);
check(
  '2c geschlossene Anführungszeichen bleiben unangetastet',
  normalizeModelText('„Kerzen für ruhige Abende"') === '„Kerzen für ruhige Abende"',
);
check(
  '2d literales \\n wird zum Zeilenumbruch',
  normalizeModelText('Zeile 1\\nZeile 2') === 'Zeile 1\nZeile 2',
);

// ── 3. Idempotenz ───────────────────────────────────────────────────────────
const einmal = normalizeModelText(ROHANTWORT);
const zweimal = normalizeModelText(einmal);
check('3 Normalisierung ist idempotent', einmal === zweimal);

// ── 4. Fail-closed-Riegel im Renderer ───────────────────────────────────────
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

await riegel('4a Titel mit Rest-Escape ⇒ kein Bild', BEFUND_TITEL, null);
await riegel('4b Escape im Untertitel ⇒ kein Bild', ERWARTET_TITEL, 'Text mit \\" Rest');
await riegel('4c doppelter Backslash ⇒ kein Bild', 'Titel mit \\\\ Rest', null);

// ── 5. Negativkontrolle: sauberer Text löst den Riegel nicht aus ────────────
check('5a bereinigter Titel hat keinen Rest-Escape', !hasResidualEscape(ERWARTET_TITEL));
check(
  '5b findResidualEscape meldet nichts für sauberen Text',
  findResidualEscape([ERWARTET_TITEL, 'Untertitel ohne Backslash', null]) === null,
);
// Ein sauberer Titel darf NICHT an `text_escaped` scheitern — er geht weiter
// bis zur Foto-/Schriftprüfung (die hier mit einem Dummy-Foto endet).
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
