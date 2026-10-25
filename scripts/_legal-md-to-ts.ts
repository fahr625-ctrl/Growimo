/**
 * Interner Konverter: Freigabe-Fassung (Markdown) → strukturierter TS-Inhalt.
 *
 * Zweck: Die Rechtstexte der AGB und der Widerrufsbelehrung existieren als
 * Freigabe-Dokumente in Markdown (`/home/team/shared/rechtstexte-freigabe-*`).
 * Damit die App-Seiten /agb und /widerruf **denselben Wortlaut** zeigen und
 * niemand den Vertragstext von Hand abtippt (Tippfehler-Risiko), wird der Text
 * hier maschinell übernommen.
 *
 * Was der Konverter BEWUSST entfernt (Redaktions-Artefakte, kein Vertragstext):
 *   * `> …`-Blockquotes  → interne STATUS-/OFFEN-Kästen für das Owner-Review
 *   * `⟨…⟩`-Marker       → Änderungs-/Korrekturvermerke (⟨2026-10-23 KORRIGIERT⟩)
 *   * `*(Bisherige Fassung: …)*` → Redaktions-Notizen zur alten Formulierung
 * Was er behält: Absätze, Listen, Tabellen, Unterstriche des Musterformulars.
 *
 * Lauf:  bun scripts/_legal-md-to-ts.ts <input.md> <EXPORT_NAME>
 * Ausgabe auf stdout → in `src/lib/legal-docs.ts` einsetzen.
 */

import { readFileSync } from 'node:fs';

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'blank' };

interface Section {
  id: string;
  title: string;
  blocks: Block[];
}

/** Redaktions-Artefakte entfernen, Markdown-Betonung auflösen. */
function clean(input: string): string {
  return input
    // `*(Bisherige Fassung: …)*` — Hinweis auf die alte Formulierung
    .replace(/\*\(Bisherige Fassung[\s\S]*?\)\*/g, '')
    // `⟨…⟩` — Änderungs-/Korrekturvermerke (auch mehrzeilig)
    .replace(/⟨[^⟩]*⟩/gs, '')
    // `**fett**` → Text
    .replace(/\*\*/g, '')
    // `*(…)*` → (…)
    .replace(/\*\(/g, '(')
    .replace(/\)\*/g, ')')
    // Fußnoten-Marker `(\*)` → `(*)`
    .replace(/\\\*/g, '*')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parse(md: string): Section[] {
  const lines = md.split('\n');
  // Front-Matter (Titel/Stand/Anbieterblock) bis zur ersten `---`-Zeile
  // überspringen — die Anbieterdaten kommen in der App aus `src/lib/legal.ts`.
  const firstRule = lines.findIndex((l) => l.trim() === '---');
  const body = firstRule >= 0 ? lines.slice(firstRule + 1) : lines;

  const sections: Section[] = [];
  let current: Section | null = null;
  let para: string[] = [];
  let list: string[] | null = null;
  let table: string[][] | null = null;

  const flush = () => {
    if (!current) return;
    if (para.length > 0) {
      // `---`-Trennlinien sind Satzzeichen des Dokuments, kein Inhalt.
      const lines = para.filter((l) => l.trim() !== '---');
      // Kurze Zeilen (Anschrift-/Kontaktblöcke) bleiben zeilenweise: in der
      // Quelle stehen sie ohne Leerzeile untereinander, zusammengezogen wären
      // sie unlesbar. Normale Absätze sind länger und werden zusammengefasst.
      const shortBlock =
        lines.length >= 2 && lines.every((l) => l.trim().length <= 40);
      const texts = shortBlock ? lines : [lines.join(' ')];
      for (const raw of texts) {
        const text = clean(raw);
        if (text.length === 0) continue;
        current.blocks.push(
          /^_{5,}$/.test(text) ? { kind: 'blank' } : { kind: 'p', text },
        );
      }
      para = [];
    }
    if (list && list.length > 0) {
      const items = list.map(clean).filter((i) => i.length > 0);
      if (items.length > 0) current.blocks.push({ kind: 'list', items });
    }
    list = null;
    if (table && table.length > 1) {
      const [head, ...rows] = table;
      current.blocks.push({ kind: 'table', head, rows });
    }
    table = null;
  };

  for (const rawLine of body) {
    const line = rawLine.replace(/\s+$/, '');

    // Interne Status-/OFFEN-Kästen: nie Teil des veröffentlichten Textes.
    if (line.trimStart().startsWith('>')) continue;

    if (line.startsWith('## ')) {
      flush();
      const title = clean(line.slice(3));
      current = { id: slug(title), title, blocks: [] };
      sections.push(current);
      continue;
    }
    if (line.startsWith('# ')) continue; // Dokumenttitel → Seitentitel
    if (!current) continue;

    if (line.trim() === '') {
      flush();
      continue;
    }

    if (line.trimStart().startsWith('|')) {
      if (para.length > 0 || list) flush();
      const cells = line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());
      if (cells.every((c) => /^-{2,}$/.test(c) || c === '')) continue; // Trennzeile
      table = table ?? [];
      table.push(cells.map(clean));
      continue;
    }

    if (line.startsWith('- ')) {
      if (para.length > 0) flush();
      table = table ?? null;
      list = list ?? [];
      list.push(line.slice(2));
      continue;
    }

    // Fortsetzungszeile einer Liste (eingerückt, kein neuer Punkt)
    if (list && /^\s{2,}\S/.test(rawLine) && para.length === 0) {
      list[list.length - 1] += ' ' + line.trim();
      continue;
    }

    if (table) flush();
    para.push(line.trim());
  }
  flush();

  return sections.filter((s) => s.blocks.length > 0);
}

const [inputPath, exportName] = process.argv.slice(2);
if (!inputPath || !exportName) {
  console.error('usage: bun scripts/_legal-md-to-ts.ts <input.md> <EXPORT_NAME>');
  process.exit(2);
}

const sections = parse(readFileSync(inputPath, 'utf8'));
const json = JSON.stringify(sections, null, 2);
console.log(`export const ${exportName}: LegalSection[] = ${json};`);
console.error(`[legal-md-to-ts] ${inputPath} → ${sections.length} Abschnitte`);
