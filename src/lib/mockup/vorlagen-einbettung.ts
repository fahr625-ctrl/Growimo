/**
 * Vorlagen für `composeMockup` zur Laufzeit bereitstellen (2026-11-24).
 *
 * `composeMockup` liest die Vorlage aus einem Verzeichnis. Im Vercel-Artefakt
 * liegt `public/` nicht im Funktionsordner — deshalb kommen die Bytes aus
 * `vorlagen-daten.ts` (erzeugt von `scripts/mockup-vorlagen-einbetten.ts`) und
 * werden beim ersten Aufruf in den tmp-Ordner geschrieben. Derselbe Weg wie bei
 * den Schriften (`pin-font.ts`): einmal schreiben, danach nur noch lesen.
 *
 * Die Maße sind die der Originale (1024 × 1024 px); die in `vorlagen.ts`
 * gemessenen Produktflächen gelten unverändert.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MOCKUP_VORLAGEN_EINGEBETTET } from './vorlagen-daten';
import type { MockupVorlage, MockupVorlageId } from './vorlagen';

let bereit: string | null = null;

/** Verzeichnis mit den eingebetteten Vorlagen; legt es beim ersten Aufruf an. */
export function mockupVorlagenVerzeichnis(): string {
  if (bereit) return bereit;
  const ziel = path.join(tmpdir(), 'growimo-mockup-vorlagen');
  mkdirSync(ziel, { recursive: true });
  for (const vorlage of MOCKUP_VORLAGEN_EINGEBETTET) {
    const datei = path.join(ziel, vorlage.datei);
    const bytes = Buffer.from(vorlage.b64, 'base64');
    if (existsSync(datei)) {
      try {
        if (readFileSync(datei).length === bytes.length) continue;
      } catch {
        /* unvollständig — neu schreiben */
      }
    }
    writeFileSync(datei, bytes);
  }
  bereit = ziel;
  return ziel;
}

/**
 * Katalog-Eintrag mit dem Dateinamen der eingebetteten Kopie. Fehlt die
 * Einbettung, gibt es `null` — der Aufrufer bricht dann fail-closed ab.
 */
export function eingebetteteVorlage(vorlage: MockupVorlage): MockupVorlage | null {
  const eintrag = MOCKUP_VORLAGEN_EINGEBETTET.find((v) => v.id === vorlage.id);
  if (!eintrag) return null;
  return { ...vorlage, datei: eintrag.datei };
}

export function eingebetteteVorlagenIds(): MockupVorlageId[] {
  return MOCKUP_VORLAGEN_EINGEBETTET.map((v) => v.id);
}
