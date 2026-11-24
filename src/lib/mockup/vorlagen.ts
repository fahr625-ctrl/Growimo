/**
 * Etsy-Mockup-Vorlagen (2026-11-24) — reine Daten, kein `sharp`.
 *
 * Diese Datei darf im Browser importiert werden (die Seite `/mockups` zeigt die
 * Vorlagen an). Das Komponieren selbst steckt in `compose.ts` (serverseitig).
 *
 * ── Wie die Produktflächen gemessen wurden ─────────────────────────────────
 * Alle Zahlen sind aus dem jeweiligen Vorlagenbild gemessen, nicht geschätzt:
 * je Vorlage wurden Zeilen- und Spaltenprofile über die Graustufen des PNGs
 * gezogen und die stärksten Helligkeitssprünge (Rahmenkante, Passepartout,
 * Papierkante, Tassen-Silhouette, Standlinie) als Kante gelesen. Die Messwerte
 * stehen unten als Stützpunkte. Ergebnis: die beiden Posterflächen sind
 * praktisch achsparallel (kein Perspektivversatz), die Tassenwand ist leicht
 * geneigt und nach unten gebogen.
 *
 * Bilder: `public/mockup-vorlagen/` (Namen unverändert).
 * Rechte: /home/team/shared/MOCKUP-VORLAGEN-NUTZUNGSRECHTE-2026-11-23.md
 */

export type MockupVorlageId =
  | 'poster-schwarz-passepartout'
  | 'poster-eiche'
  | 'tasse-griff-rechts'
  | 'tasse-griff-links';

export interface Punkt {
  x: number;
  y: number;
}

/** Produktfläche als Viereck: oben links, oben rechts, unten rechts, unten links. */
export interface ViereckFlaeche {
  art: 'viereck';
  ecken: readonly [Punkt, Punkt, Punkt, Punkt];
  /** Zusätzliche Verdunklung direkt an der Papierkante (0 = keine), in Pixeln. */
  kantePx: number;
  kanteFaktor: number;
}

/**
 * Tassenwand als Zylinder-Näherung.
 * `wandLinks`/`wandRechts`: Stützpunkte [y, x] der gemessenen Silhouette.
 * `oben`/`unten`: Stützpunkte [x, y] der gemessenen Ober- bzw. Standlinie.
 */
export interface ZylinderFlaeche {
  art: 'zylinder';
  wandLinks: readonly (readonly [number, number])[];
  wandRechts: readonly (readonly [number, number])[];
  oben: readonly (readonly [number, number])[];
  unten: readonly (readonly [number, number])[];
  /** Halber Öffnungswinkel der sichtbaren Wand in Radiant (Krümmung). */
  oeffnung: number;
  /** Helligkeit am Wandrand (1 = keine Wölbung sichtbar). */
  randSchatten: number;
  /** Abstand der Produktfläche von der gemessenen Kante, in Pixeln. */
  rand: { links: number; rechts: number; oben: number; unten: number };
}

export interface MockupVorlage {
  id: MockupVorlageId;
  datei: string;
  name: string;
  produktart: string;
  beschreibung: string;
  breite: number;
  hoehe: number;
  /** Mindestabdeckung: füllt das Design weniger der Fläche, gibt es kein Bild. */
  minAbdeckung: number;
  flaeche: ViereckFlaeche | ZylinderFlaeche;
}

export const MOCKUP_VORLAGEN: readonly MockupVorlage[] = [
  {
    id: 'poster-schwarz-passepartout',
    datei: 'vorlage-1-poster-schwarz-passepartout.png',
    name: 'Poster im schwarzen Rahmen mit Passepartout',
    produktart: 'Poster / Druck',
    beschreibung:
      'Schwarzer Rahmen, helles Passepartout. Die Papierfläche liegt innen und ist achsparallel — gemessene Kanten: links 304, rechts 748, oben 432, unten 1046 px.',
    breite: 1024,
    hoehe: 1536,
    minAbdeckung: 0.55,
    flaeche: {
      art: 'viereck',
      ecken: [
        { x: 304, y: 432 },
        { x: 748, y: 432 },
        { x: 748, y: 1046 },
        { x: 304, y: 1046 },
      ],
      kantePx: 2,
      kanteFaktor: 0.93,
    },
  },
  {
    id: 'poster-eiche',
    datei: 'vorlage-2-poster-eiche.png',
    name: 'Poster im Eichenrahmen',
    produktart: 'Poster / Druck',
    beschreibung:
      'Eichenholzrahmen auf einem Regal. Die Papierfläche liegt innen und ist achsparallel — gemessene Kanten: links 268, rechts 751, oben 147, unten 751 px.',
    breite: 1024,
    hoehe: 1024,
    minAbdeckung: 0.55,
    flaeche: {
      art: 'viereck',
      ecken: [
        { x: 268, y: 147 },
        { x: 751, y: 147 },
        { x: 751, y: 751 },
        { x: 268, y: 751 },
      ],
      kantePx: 2,
      kanteFaktor: 0.93,
    },
  },
  {
    id: 'tasse-griff-rechts',
    datei: 'vorlage-3-tasse-griff-rechts.png',
    name: 'Tasse, Griff rechts',
    produktart: 'Tasse',
    beschreibung:
      'Weiße Tasse auf Holz, Griff rechts. Die Außenwand ist gemessen (Silhouette links 252→261 px, rechts 723→713 px, Oberkante unter dem Rand 275 px, Standlinie 838 px in der Mitte); der Griff bleibt frei.',
    breite: 1024,
    hoehe: 1024,
    minAbdeckung: 0.5,
    flaeche: {
      art: 'zylinder',
      wandLinks: [
        [280, 252],
        [320, 252],
        [400, 253],
        [500, 255],
        [600, 257],
        [700, 259],
        [760, 261],
      ],
      wandRechts: [
        [300, 723],
        [400, 722],
        [600, 716],
        [700, 715],
        [750, 713],
      ],
      oben: [
        [300, 264],
        [340, 269],
        [380, 271],
        [420, 274],
        [460, 274],
        [500, 274],
        [540, 275],
        [580, 275],
        [620, 271],
        [660, 268],
        [700, 260],
      ],
      unten: [
        [300, 802],
        [340, 818],
        [380, 828],
        [420, 834],
        [460, 837],
        [500, 838],
        [540, 836],
        [580, 831],
        [620, 823],
        [660, 810],
        [700, 785],
      ],
      oeffnung: 0.733,
      randSchatten: 0.86,
      rand: { links: 12, rechts: 16, oben: 8, unten: 14 },
    },
  },
  {
    id: 'tasse-griff-links',
    datei: 'vorlage-4-tasse-griff-links.png',
    name: 'Tasse, Griff links',
    produktart: 'Tasse',
    beschreibung:
      'Weiße Tasse auf Stein, Griff links. Die Außenwand ist gemessen (Silhouette links 280→294 px, rechts 819→810 px, Oberkante unter dem Rand 235 px, Standlinie 848 px in der Mitte); der Griff bleibt frei.',
    breite: 1024,
    hoehe: 1024,
    minAbdeckung: 0.5,
    flaeche: {
      art: 'zylinder',
      wandLinks: [
        [240, 287],
        [280, 280],
        [360, 282],
        [400, 288],
        [440, 289],
        [500, 290],
        [560, 291],
        [600, 291],
        [720, 293],
        [760, 294],
      ],
      wandRechts: [
        [500, 819],
        [600, 816],
        [700, 815],
        [750, 816],
      ],
      oben: [
        [340, 222],
        [380, 227],
        [420, 231],
        [460, 233],
        [500, 234],
        [540, 235],
        [580, 234],
        [660, 233],
        [700, 230],
        [740, 226],
      ],
      unten: [
        [300, 795],
        [340, 820],
        [380, 831],
        [420, 839],
        [460, 844],
        [500, 847],
        [540, 848],
        [580, 848],
        [620, 846],
        [660, 842],
        [700, 837],
        [740, 829],
      ],
      oeffnung: 0.733,
      randSchatten: 0.86,
      rand: { links: 18, rechts: 12, oben: 8, unten: 14 },
    },
  },
] as const;

export function findeVorlage(id: string): MockupVorlage | undefined {
  return MOCKUP_VORLAGEN.find((v) => v.id === id);
}
