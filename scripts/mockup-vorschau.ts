/**
 * Erzeugt die Mockup-Belege (2026-11-24): je Vorlage eine Komposition.
 * Kein KI-Aufruf, 0 €. Aufruf: `bun scripts/mockup-vorschau.ts`
 *
 * Schreibt:
 *  - volle Auflösung → /home/team/shared/mockups-2026-11-24/
 *  - Seiten-Vorschauen (max. 700 px breit) → public/mockup-vorschau/
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

import { composeMockup } from '../src/lib/mockup/compose';
import { MOCKUP_VORLAGEN, type MockupVorlageId } from '../src/lib/mockup/vorlagen';

const BELEG_DIR = '/home/team/shared/mockups-2026-11-24';
const VORSCHAU_DIR = path.join(process.cwd(), 'public', 'mockup-vorschau');
const DESIGN_DIR = path.join(process.cwd(), 'public', 'design-bilder-neu');

const ZUORDNUNG: { vorlage: MockupVorlageId; design: string }[] = [
  { vorlage: 'poster-schwarz-passepartout', design: 'editorial-kerze-1000x1500.png' },
  { vorlage: 'poster-eiche', design: 'galerie-kerze-1000x1500.png' },
  { vorlage: 'tasse-griff-rechts', design: 'signal-kerze-1000x1500.png' },
  { vorlage: 'tasse-griff-links', design: 'kontrast-kerze-1000x1500.png' },
];

await mkdir(BELEG_DIR, { recursive: true });
await mkdir(VORSCHAU_DIR, { recursive: true });

const bericht: Record<string, unknown>[] = [];

for (const eintrag of ZUORDNUNG) {
  const vorlage = MOCKUP_VORLAGEN.find((v) => v.id === eintrag.vorlage);
  if (!vorlage) throw new Error(`Vorlage unbekannt: ${eintrag.vorlage}`);
  const designPfad = path.join(DESIGN_DIR, eintrag.design);

  const ergebnis = await composeMockup({ vorlage: eintrag.vorlage, design: designPfad });

  const belegDatei = path.join(BELEG_DIR, `${vorlage.id}.png`);
  await writeFile(belegDatei, ergebnis.png);

  await sharp(ergebnis.png)
    .resize({ width: 700, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(path.join(VORSCHAU_DIR, `${vorlage.id}-ergebnis.png`));

  await sharp(path.join(process.cwd(), 'public', 'mockup-vorlagen', vorlage.datei))
    .resize({ width: 700, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(path.join(VORSCHAU_DIR, `${vorlage.id}-vorlage.png`));

  bericht.push({
    vorlage: vorlage.id,
    design: eintrag.design,
    abdeckung: Math.round(ergebnis.abdeckung * 1000) / 10,
    flaechePx: ergebnis.flaechePx,
    ausgabe: `${ergebnis.breite} × ${ergebnis.hoehe}`,
    beleg: belegDatei,
    bytes: ergebnis.png.length,
  });
}

console.log(JSON.stringify(bericht, null, 2));
