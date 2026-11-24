/**
 * Erzeugt `src/lib/mockup/vorlagen-daten.ts` aus den freigegebenen Vorlagen.
 *
 * Aufruf:  bun scripts/mockup-vorlagen-einbetten.ts
 *
 * Warum überhaupt einbetten? `composeMockup` liest die Vorlage von der Platte.
 * Im Vercel-Funktionsartefakt gibt es kein `public/` (die Dateien liegen dort im
 * CDN, nicht im Funktionsordner) — ein Plattenpfad würde im Betrieb fail-closed
 * mit „Vorlage fehlt" abbrechen, obwohl die Datei existiert. Deshalb derselbe Weg
 * wie bei den Schriften (`src/lib/kampagne/pin-font-data.ts`): die Bytes liegen
 * im Server-Bundle und werden zur Laufzeit in den tmp-Ordner geschrieben.
 *
 * Die eingebetteten Kopien sind mit `sharp` aus den Originalen erzeugt: gleiche
 * Maße (1024 × 1024 px), JPEG q92 — die gemessenen Produktflächen in
 * `vorlagen.ts` gelten unverändert. Die Originale in `public/mockup-vorlagen/`
 * bleiben unangetastet und werden weiter ausgeliefert.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import { MOCKUP_VORLAGEN } from '../src/lib/mockup/vorlagen';

const JPEG_QUALITY = 92;
const ZIEL = path.join(process.cwd(), 'src', 'lib', 'mockup', 'vorlagen-daten.ts');

interface Eintrag {
  id: string;
  datei: string;
  breite: number;
  hoehe: number;
  quellDatei: string;
  quellBytes: number;
  quellSha256: string;
  jpegBytes: number;
  b64: string;
}

const eintraege: Eintrag[] = [];

for (const vorlage of MOCKUP_VORLAGEN) {
  const quelle = path.join(process.cwd(), 'public', 'mockup-vorlagen', vorlage.datei);
  const roh = readFileSync(quelle);
  const jpeg = await sharp(roh).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
  const meta = await sharp(jpeg).metadata();
  if (meta.width !== vorlage.breite || meta.height !== vorlage.hoehe) {
    throw new Error(
      `${vorlage.datei}: eingebettete Kopie hat ${String(meta.width)} × ${String(meta.height)} px, erwartet ${String(vorlage.breite)} × ${String(vorlage.hoehe)} px.`,
    );
  }
  eintraege.push({
    id: vorlage.id,
    datei: `${vorlage.id}.jpg`,
    breite: vorlage.breite,
    hoehe: vorlage.hoehe,
    quellDatei: vorlage.datei,
    quellBytes: statSync(quelle).size,
    quellSha256: createHash('sha256').update(roh).digest('hex'),
    jpegBytes: jpeg.length,
    b64: jpeg.toString('base64'),
  });
  console.log(`${vorlage.id}: ${String(jpeg.length)} B (Quelle ${String(statSync(quelle).size)} B)`);
}

const kopf = `/**
 * AUTOMATISCH ERZEUGT — nicht von Hand ändern.
 * Erzeugt von \`scripts/mockup-vorlagen-einbetten.ts\` aus den freigegebenen
 * Vorlagen in \`public/mockup-vorlagen/\` (sharp, JPEG q${String(JPEG_QUALITY)}, gleiche Maße).
 *
 * Grund: im Vercel-Funktionsartefakt liegt kein \`public/\` — ohne eingebettete
 * Bytes wäre \`composeMockup\` im Betrieb fail-closed „Vorlage fehlt".
 * Die Maße sind unverändert, die gemessenen Produktflächen gelten also weiter.
 */

import type { MockupVorlageId } from './vorlagen';

export interface EingebetteteVorlage {
  id: MockupVorlageId;
  /** Dateiname im Laufzeit-Ordner (Inhalt: JPEG, Maße wie das Original). */
  datei: string;
  breite: number;
  hoehe: number;
  /** Original in \`public/mockup-vorlagen/\` — Herkunft des eingebetteten Bildes. */
  quellDatei: string;
  quellBytes: number;
  quellSha256: string;
  jpegBytes: number;
  /** JPEG-Bytes als Base64. */
  b64: string;
}

export const MOCKUP_VORLAGEN_EINGEBETTET: readonly EingebetteteVorlage[] = [
`;

const koerper = eintraege
  .map(
    (e) => `  {
    id: '${e.id}',
    datei: '${e.datei}',
    breite: ${String(e.breite)},
    hoehe: ${String(e.hoehe)},
    quellDatei: '${e.quellDatei}',
    quellBytes: ${String(e.quellBytes)},
    quellSha256: '${e.quellSha256}',
    jpegBytes: ${String(e.jpegBytes)},
    b64:
      '${e.b64}',
  },`,
  )
  .join('\n');

writeFileSync(ZIEL, `${kopf}${koerper}\n] as const;\n`, 'utf8');
console.log(`geschrieben: ${ZIEL}`);
