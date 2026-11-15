import { readFileSync, writeFileSync } from 'node:fs';

const jobs: Array<[string, string, string]> = [
  [
    'src/i18n/de.ts',
    "    'Die Verbindung zum Server wurde unterbrochen — die Antwort kam nicht an. Es wurde keine Generierung abgezogen. Bitte versuche es gleich noch einmal.',",
    "    'Die Verbindung zum Server wurde unterbrochen, bevor das Ergebnis ankam. Es wurde keine Einheit abgezogen. Ein fertiges Ergebnis steht möglicherweise schon in der Inhaltsbibliothek — dort nachsehen, sonst erneut versuchen.',",
  ],
  [
    'src/i18n/en.ts',
    "    'The connection to the server was interrupted — the response never arrived. No generation was used up. Please try again in a moment.',",
    "    'The connection to the server was interrupted before the result arrived. No generation was used up. A finished result may already be in the content library — check there, otherwise try again.',",
  ],
];

for (const [file, from, to] of jobs) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes(from)) {
    console.log('MISS', file);
    continue;
  }
  writeFileSync(file, src.replace(from, to));
  console.log('OK', file);
}
