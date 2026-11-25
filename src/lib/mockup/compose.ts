/**
 * Etsy-Mockup per Komposition (2026-11-24) — kein KI-Aufruf, 0 €.
 *
 * Ein echtes Design wird perspektivisch in die gemessene Produktfläche der
 * Vorlage gelegt und mit dem Foto verrechnet (Multiply). Kein generatives
 * Modell: was im Mockup zu sehen ist, ist das Design selbst.
 *
 * Ablauf: Vorlage lesen → Produktfläche prüfen → Design formatfüllend
 * („contain“, nie beschnitten) mittig in die Fläche legen → den Rest der Fläche
 * mit dem Papierton des Designs füllen → per Rückprojektion auf die Fläche
 * abbilden → PNG.
 *
 * Warum der Rest gefüllt wird: die Passepartout-Öffnung ist 444 × 614 px
 * (0,723), ein Pin-Design ist 2:3 (0,667). Formatfüllend bleibt rechts und
 * links ein Streifen übrig, in dem sonst die Vorlagenkante durchscheint — eine
 * sichtbare Naht neben dem Druck. Der Streifen bekommt deshalb die Randfarbe
 * des Designs (Median der äußersten Spalte/Zeile), verrechnet wie das Design
 * selbst. Nichts wird beschnitten.
 *
 * Fail-closed: fehlt die Vorlage, ist das Design unlesbar oder füllt es die
 * Fläche nicht ausreichend, gibt es **kein Bild** und einen klaren Fehler.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

import {
  MOCKUP_VORLAGEN,
  findeVorlage,
  type MockupVorlage,
  type MockupVorlageId,
  type Punkt,
  type ViereckFlaeche,
  type ZylinderFlaeche,
} from './vorlagen';

/** Klarer Fehlertext für die Oberfläche — nie ein halbes Bild. */
export class MockupFehler extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MockupFehler';
  }
}

export interface ComposeEingabe {
  vorlage: MockupVorlageId;
  /** Pfad zum Design-PNG oder das Bild selbst. */
  design: string | Uint8Array;
  /** Vorlagen-Verzeichnis überschreiben (sonst `public/mockup-vorlagen`). */
  vorlagenVerzeichnis?: string;
  /**
   * Vorlage direkt übergeben — für eine gemessene Fläche, die nicht im Katalog
   * der Seite `/mockups` steht (z. B. das Hochformat-Tassenfoto vom 24.11.).
   * Fehlt das Feld, gilt `vorlage` als Katalog-Kennung.
   */
  vorlageDef?: MockupVorlage;
}

export interface ComposeErgebnis {
  png: Buffer;
  breite: number;
  hoehe: number;
  /** Anteil der Produktfläche, den das Design einnimmt (0–1). */
  abdeckung: number;
  /** Gemessene Fläche in Vorlagenkoordinaten (Beleg für die Oberfläche). */
  flaechePx: { breite: number; hoehe: number };
}

type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

type Rgb = readonly [number, number, number];

// ── Vorlagen-Verzeichnis ─────────────────────────────────────────────────────

export function vorlagenVerzeichnis(): string {
  return path.join(process.cwd(), 'public', 'mockup-vorlagen');
}

async function ladeVorlagePng(
  vorlage: MockupVorlage,
  verzeichnis: string,
): Promise<{ breite: number; hoehe: number; rgb: Uint8Array }> {
  const datei = path.join(verzeichnis, vorlage.datei);
  if (!existsSync(datei)) {
    throw new MockupFehler(
      `Vorlage fehlt: ${vorlage.datei}. Ohne Vorlage entsteht kein Mockup.`,
    );
  }
  const { data, info } = await sharp(datei)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== vorlage.breite || info.height !== vorlage.hoehe) {
    throw new MockupFehler(
      `Vorlage ${vorlage.datei} hat ${info.width} × ${info.height} px, erwartet ${vorlage.breite} × ${vorlage.hoehe} px. Kein Bild.`,
    );
  }
  return { breite: info.width, hoehe: info.height, rgb: new Uint8Array(data) };
}

async function ladeDesign(
  quelle: string | Uint8Array,
): Promise<{ breite: number; hoehe: number; bild: Buffer }> {
  let rohdaten: Buffer;
  try {
    rohdaten = typeof quelle === 'string' ? await readFile(quelle) : Buffer.from(quelle);
  } catch {
    throw new MockupFehler(
      typeof quelle === 'string'
        ? `Design nicht lesbar: ${quelle}. Kein Bild.`
        : 'Design nicht lesbar. Kein Bild.',
    );
  }
  try {
    const meta = await sharp(rohdaten).metadata();
    if (!meta.width || !meta.height) {
      throw new MockupFehler('Design hat keine lesbare Größe. Kein Bild.');
    }
    return { breite: meta.width, hoehe: meta.height, bild: rohdaten };
  } catch (fehler) {
    if (fehler instanceof MockupFehler) throw fehler;
    throw new MockupFehler('Design nicht lesbar (kein gültiges Bild). Kein Bild.');
  }
}

// ── Geometrie-Hilfen ────────────────────────────────────────────────────────

function invertiere3x3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) {
    throw new MockupFehler('Produktfläche ist entartet (Fläche 0). Kein Bild.');
  }
  const s = 1 / det;
  return [
    A * s, (c * h - b * i) * s, (b * f - c * e) * s,
    B * s, (a * i - c * g) * s, (c * d - a * f) * s,
    C * s, (b * g - a * h) * s, (a * e - b * d) * s,
  ];
}

/** Homographie Quadrat (u,v) → Viereck (tl, tr, br, bl). */
function homographieQuadrat(ecken: readonly [Punkt, Punkt, Punkt, Punkt]): Mat3 {
  const [p0, p1, p2, p3] = ecken;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
  }
  const nenner = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(nenner) < 1e-12) {
    throw new MockupFehler('Produktfläche ist entartet (Fläche 0). Kein Bild.');
  }
  const g = (dx3 * dy2 - dx2 * dy3) / nenner;
  const h = (dx1 * dy3 - dx3 * dy1) / nenner;
  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1,
  ];
}

function interpoliere(stuetzpunkte: readonly (readonly [number, number])[], x: number): number {
  if (stuetzpunkte.length === 0) return 0;
  const erste = stuetzpunkte[0];
  const letzte = stuetzpunkte[stuetzpunkte.length - 1];
  if (x <= erste[0]) return erste[1];
  if (x >= letzte[0]) return letzte[1];
  for (let i = 1; i < stuetzpunkte.length; i++) {
    const [x1, y1] = stuetzpunkte[i];
    const [x0, y0] = stuetzpunkte[i - 1];
    if (x <= x1) {
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return letzte[1];
}

// ── Produktflächen-Abtastung ────────────────────────────────────────────────

interface Flaeche {
  /** Bounding-Box der nutzbaren Fläche in Vorlagenkoordinaten. */
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  /** (x,y) → (u,v) in der Fläche; null = außerhalb. */
  nachUV: (x: number, y: number) => { u: number; v: number; schatten: number } | null;
}

function viereckFlaeche(f: ViereckFlaeche): Flaeche {
  const H = homographieQuadrat(f.ecken);
  const Hinv = invertiere3x3(H);
  const xs = f.ecken.map((p) => p.x);
  const ys = f.ecken.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  return {
    xMin,
    yMin,
    xMax,
    yMax,
    nachUV(x, y) {
      const w = Hinv[6] * x + Hinv[7] * y + Hinv[8];
      if (Math.abs(w) < 1e-12) return null;
      const u = (Hinv[0] * x + Hinv[1] * y + Hinv[2]) / w;
      const v = (Hinv[3] * x + Hinv[4] * y + Hinv[5]) / w;
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      // Papierkante: die letzten Pixel minimal abdunkeln, damit das Design sitzt.
      const abstandPx = Math.min(u, 1 - u) * (xMax - xMin);
      const abstandPxY = Math.min(v, 1 - v) * (yMax - yMin);
      const rand = Math.min(abstandPx, abstandPxY);
      const schatten =
        f.kantePx > 0 && rand < f.kantePx
          ? f.kanteFaktor + (1 - f.kanteFaktor) * (rand / f.kantePx)
          : 1;
      return { u, v, schatten };
    },
  };
}

function zylinderFlaeche(f: ZylinderFlaeche): Flaeche {
  const { rand, oeffnung, randSchatten } = f;
  const sinO = Math.sin(oeffnung);
  // Nutzbare Spanne je y (links/rechts) und je x (oben/unten), schon mit Rand.
  const linksBei = (y: number) => interpoliere(f.wandLinks, y) + rand.links;
  const rechtsBei = (y: number) => interpoliere(f.wandRechts, y) - rand.rechts;
  const obenBei = (x: number) => interpoliere(f.oben, x) + rand.oben;
  const untenBei = (x: number) => interpoliere(f.unten, x) - rand.unten;

  const yStart = f.wandLinks[0][0];
  const yEnde = f.wandLinks[f.wandLinks.length - 1][0];
  const xStart = f.oben[0][0];
  const xEnde = f.oben[f.oben.length - 1][0];

  let xMin = Infinity;
  let xMax = -Infinity;
  for (const y of [yStart, (yStart + yEnde) / 2, yEnde]) {
    xMin = Math.min(xMin, rechtsBei(y), linksBei(y));
    xMax = Math.max(xMax, rechtsBei(y), linksBei(y));
  }
  // Die Silhouette ist außerhalb der Stützpunkte konstant fortgesetzt.
  for (let y = yStart; y <= yEnde; y += 10) {
    xMin = Math.min(xMin, linksBei(y));
    xMax = Math.max(xMax, rechtsBei(y));
  }
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let x = xStart; x <= xEnde; x += 10) {
    yMin = Math.min(yMin, obenBei(x));
    yMax = Math.max(yMax, untenBei(x));
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) {
    throw new MockupFehler('Produktfläche der Tasse konnte nicht gelesen werden. Kein Bild.');
  }

  return {
    xMin,
    yMin,
    xMax,
    yMax,
    nachUV(x, y) {
      const xl = linksBei(y);
      const xr = rechtsBei(y);
      if (x < xl || x > xr) return null;
      const cx = (xl + xr) / 2;
      const halb = (xr - xl) / 2;
      if (halb <= 0) return null;
      // Zylinder: gleiche Winkel-Schritte liegen außen enger zusammen.
      const s = Math.max(-1, Math.min(1, ((x - cx) / halb) * sinO));
      const u = (Math.asin(s) / oeffnung + 1) / 2;
      const oben = obenBei(x);
      const unten = untenBei(x);
      if (unten - oben < 8) return null;
      const v = (y - oben) / (unten - oben);
      if (v < 0 || v > 1) return null;
      const winkel = (2 * u - 1) * oeffnung;
      const schatten = randSchatten + (1 - randSchatten) * Math.cos(winkel);
      return { u, v, schatten };
    },
  };
}

function baueFlaeche(vorlage: MockupVorlage): Flaeche {
  return vorlage.flaeche.art === 'viereck'
    ? viereckFlaeche(vorlage.flaeche)
    : zylinderFlaeche(vorlage.flaeche);
}

// ── Papierton ───────────────────────────────────────────────────────────────

/**
 * Randfarbe des Designs: Median der äußersten Spalte bzw. Zeile (1–3 px tief).
 * Median statt Mittelwert, damit einzelne helle/dunkle Pixel die Farbe nicht
 * verschieben. Je Seite getrennt, damit ein Design mit ungleichem Rand keinen
 * falschen Ton in den Streifen zieht.
 */
function medianRand(
  rgb: Uint8Array,
  breite: number,
  hoehe: number,
  seite: 'links' | 'rechts' | 'oben' | 'unten',
): Rgb {
  const tiefe = Math.max(1, Math.min(3, Math.floor(Math.min(breite, hoehe) / 100)));
  const werte: number[][] = [[], [], []];
  if (seite === 'links' || seite === 'rechts') {
    for (let t = 0; t < tiefe; t++) {
      const x = seite === 'links' ? t : breite - 1 - t;
      for (let y = 0; y < hoehe; y++) {
        const i = (y * breite + x) * 3;
        werte[0]!.push(rgb[i]!);
        werte[1]!.push(rgb[i + 1]!);
        werte[2]!.push(rgb[i + 2]!);
      }
    }
  } else {
    for (let t = 0; t < tiefe; t++) {
      const y = seite === 'oben' ? t : hoehe - 1 - t;
      for (let x = 0; x < breite; x++) {
        const i = (y * breite + x) * 3;
        werte[0]!.push(rgb[i]!);
        werte[1]!.push(rgb[i + 1]!);
        werte[2]!.push(rgb[i + 2]!);
      }
    }
  }
  const mitte = (v: number[]): number => {
    const sortiert = [...v].sort((a, b) => a - b);
    return sortiert[Math.floor(sortiert.length / 2)] ?? 0;
  };
  return [mitte(werte[0]!), mitte(werte[1]!), mitte(werte[2]!)];
}

// ── Komposition ─────────────────────────────────────────────────────────────

/** Formatfüllende (nie beschneidende) Platzierung des Designs in der Fläche. */
export function platziere(
  flaecheBreite: number,
  flaecheHoehe: number,
  designBreite: number,
  designHoehe: number,
): { breite: number; hoehe: number; offX: number; offY: number; abdeckung: number } {
  const designSeite = designBreite / designHoehe;
  const flaecheSeite = flaecheBreite / flaecheHoehe;
  let breite: number;
  let hoehe: number;
  if (designSeite >= flaecheSeite) {
    breite = flaecheBreite;
    hoehe = Math.round(flaecheBreite / designSeite);
  } else {
    hoehe = flaecheHoehe;
    breite = Math.round(flaecheHoehe * designSeite);
  }
  breite = Math.max(1, Math.min(flaecheBreite, breite));
  hoehe = Math.max(1, Math.min(flaecheHoehe, hoehe));
  return {
    breite,
    hoehe,
    offX: Math.round((flaecheBreite - breite) / 2),
    offY: Math.round((flaecheHoehe - hoehe) / 2),
    abdeckung: (breite * hoehe) / (flaecheBreite * flaecheHoehe),
  };
}

export async function composeMockup(eingabe: ComposeEingabe): Promise<ComposeErgebnis> {
  const vorlage = eingabe.vorlageDef ?? findeVorlage(eingabe.vorlage);
  if (!vorlage) {
    throw new MockupFehler(
      `Unbekannte Vorlage „${String(eingabe.vorlage)}“. Bekannt: ${MOCKUP_VORLAGEN.map((v) => v.id).join(', ')}.`,
    );
  }

  const verzeichnis = eingabe.vorlagenVerzeichnis ?? vorlagenVerzeichnis();
  const grund = await ladeVorlagePng(vorlage, verzeichnis);
  const design = await ladeDesign(eingabe.design);
  const flaeche = baueFlaeche(vorlage);

  const flaechenBreite = Math.round(flaeche.xMax - flaeche.xMin);
  const flaechenHoehe = Math.round(flaeche.yMax - flaeche.yMin);
  if (flaechenBreite < 40 || flaechenHoehe < 40) {
    throw new MockupFehler(
      `Produktfläche in ${vorlage.datei} ist zu klein (${flaechenBreite} × ${flaechenHoehe} px). Kein Bild.`,
    );
  }

  const platz = platziere(flaechenBreite, flaechenHoehe, design.breite, design.hoehe);
  if (platz.abdeckung < vorlage.minAbdeckung) {
    throw new MockupFehler(
      `Design passt nicht in die Produktfläche: es füllt nur ${Math.round(platz.abdeckung * 100)} % ` +
        `(mindestens ${Math.round(vorlage.minAbdeckung * 100)} % nötig). Kein Bild.`,
    );
  }

  // Design in der Platzierungsgröße vorbereiten (einmal skalieren, dann abtasten).
  const { data: designRgb, info: designInfo } = await sharp(design.bild)
    .resize(platz.breite, platz.hoehe, { fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (designInfo.width !== platz.breite || designInfo.height !== platz.hoehe) {
    throw new MockupFehler('Design konnte nicht auf die Produktfläche skaliert werden. Kein Bild.');
  }

  const { breite, hoehe, rgb } = grund;
  const ausgabe = new Uint8Array(rgb);
  const stichproben = 3; // 3×3-Deckung gegen harte Kanten
  const k = 0.96; // Multiply-Anteil: 0,96 lässt 4 % Fotostruktur durch
  // Weiche Kante: die letzten Pixel des Designs laufen aus, damit es wie Druck
  // auf Papier/Keramik sitzt und nicht wie ein aufgeklebtes Rechteck.
  const federPx = 3;

  const xVon = Math.max(0, Math.floor(flaeche.xMin));
  const xBis = Math.min(breite - 1, Math.ceil(flaeche.xMax));
  const yVon = Math.max(0, Math.floor(flaeche.yMin));
  const yBis = Math.min(hoehe - 1, Math.ceil(flaeche.yMax));

  // Papierton des Designs je Seite — füllt den Rest der Produktfläche.
  const papierton = {
    links: medianRand(designRgb, designInfo.width, designInfo.height, 'links'),
    rechts: medianRand(designRgb, designInfo.width, designInfo.height, 'rechts'),
    oben: medianRand(designRgb, designInfo.width, designInfo.height, 'oben'),
    unten: medianRand(designRgb, designInfo.width, designInfo.height, 'unten'),
  };

  /**
   * Papierton an der Stelle (flX, flY) der Fläche: gewichtet nach Abstand zur
   * jeweiligen Designkante. Im Streifen links zieht also die linke Randfarbe,
   * im Streifen rechts die rechte; unter dem Design entsteht ein weicher
   * Übergang, der die weiche Designkante nahtlos fortsetzt.
   */
  function papierTon(flX: number, flY: number): Rgb {
    const gl = 1 / (1 + Math.abs(flX - platz.offX)) ** 2;
    const gr = 1 / (1 + Math.abs(platz.offX + platz.breite - flX)) ** 2;
    const go = 1 / (1 + Math.abs(flY - platz.offY)) ** 2;
    const gu = 1 / (1 + Math.abs(platz.offY + platz.hoehe - flY)) ** 2;
    const summe = gl + gr + go + gu;
    if (summe <= 0) return papierton.links;
    return [
      (papierton.links[0] * gl + papierton.rechts[0] * gr + papierton.oben[0] * go + papierton.unten[0] * gu) / summe,
      (papierton.links[1] * gl + papierton.rechts[1] * gr + papierton.oben[1] * go + papierton.unten[1] * gu) / summe,
      (papierton.links[2] * gl + papierton.rechts[2] * gr + papierton.oben[2] * go + papierton.unten[2] * gu) / summe,
    ];
  }

  // ── 1 · Papier: die ganze Produktfläche mit dem Papierton des Designs ──────
  // Ohne diesen Schritt bliebe neben einem 2:3-Design in einer 0,723-Öffnung
  // ein Streifen Vorlagenkante stehen (sichtbare Naht an der Rahmenseite).
  for (let y = yVon; y <= yBis; y++) {
    for (let x = xVon; x <= xBis; x++) {
      const mitte = flaeche.nachUV(x + 0.5, y + 0.5);
      if (!mitte) continue;
      let deckung = 0;
      for (let sy = 0; sy < stichproben; sy++) {
        for (let sx = 0; sx < stichproben; sx++) {
          if (flaeche.nachUV(x + (sx + 0.5) / stichproben, y + (sy + 0.5) / stichproben)) {
            deckung += 1 / (stichproben * stichproben);
          }
        }
      }
      if (deckung === 0) continue;

      const flX = mitte.u * flaechenBreite;
      const flY = mitte.v * flaechenHoehe;
      const ton = papierTon(flX, flY);
      const ziel = (y * breite + x) * 3;
      for (let c = 0; c < 3; c++) {
        const basis = rgb[ziel + c]!;
        const multipliziert = (basis * ton[c]!) / 255;
        const gemischt = basis * (1 - k) + multipliziert * k;
        const mitSchatten = Math.max(0, Math.min(255, gemischt * mitte.schatten));
        ausgabe[ziel + c] = Math.round(basis + (mitSchatten - basis) * deckung);
      }
    }
  }

  // ── 2 · Design in der Platzierung (mittig, formatfüllend, nie beschnitten) ─
  for (let y = yVon; y <= yBis; y++) {
    for (let x = xVon; x <= xBis; x++) {
      let deckung = 0;
      const treffer: { u: number; v: number; schatten: number }[] = [];
      for (let sy = 0; sy < stichproben; sy++) {
        for (let sx = 0; sx < stichproben; sx++) {
          const p = flaeche.nachUV(x + (sx + 0.5) / stichproben, y + (sy + 0.5) / stichproben);
          if (p) {
            deckung += 1 / (stichproben * stichproben);
            treffer.push(p);
          }
        }
      }
      if (deckung === 0 || treffer.length === 0) continue;

      const mitte = treffer[Math.floor(treffer.length / 2)]!;
      // Fläche → Design: (u,v) der Fläche auf die platzierte Designfläche legen.
      const flX = mitte.u * flaechenBreite;
      const flY = mitte.v * flaechenHoehe;
      const du = ((flX - platz.offX) / platz.breite) * designInfo.width;
      const dv = ((flY - platz.offY) / platz.hoehe) * designInfo.height;
      if (du < 0 || dv < 0 || du > designInfo.width - 1 || dv > designInfo.height - 1) continue;

      // Abstand zum Designrand in Flächen-Pixeln → weiche Kante.
      const randAbstand = Math.min(
        flX - platz.offX,
        platz.offX + platz.breite - flX,
        flY - platz.offY,
        platz.offY + platz.hoehe - flY,
      );
      const feder = randAbstand >= federPx ? 1 : Math.max(0, randAbstand / federPx);
      const deckungMitRand = deckung * feder;
      if (deckungMitRand <= 0) continue;

      const px = Math.max(0, Math.min(designInfo.width - 1, du));
      const py = Math.max(0, Math.min(designInfo.height - 1, dv));
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const x1 = Math.min(designInfo.width - 1, x0 + 1);
      const y1 = Math.min(designInfo.height - 1, y0 + 1);
      const fx = px - x0;
      const fy = py - y0;
      const i00 = (y0 * designInfo.width + x0) * 3;
      const i10 = (y0 * designInfo.width + x1) * 3;
      const i01 = (y1 * designInfo.width + x0) * 3;
      const i11 = (y1 * designInfo.width + x1) * 3;

      const ziel = (y * breite + x) * 3;
      const schatten = mitte.schatten;
      for (let c = 0; c < 3; c++) {
        const obenMisch = designRgb[i00 + c]! * (1 - fx) + designRgb[i10 + c]! * fx;
        const untenMisch = designRgb[i01 + c]! * (1 - fx) + designRgb[i11 + c]! * fx;
        const designWert = obenMisch * (1 - fy) + untenMisch * fy;
        const basis = rgb[ziel + c]!;
        const multipliziert = (basis * designWert) / 255;
        const gemischt = basis * (1 - k) + multipliziert * k;
        const mitSchatten = Math.max(0, Math.min(255, gemischt * schatten));
        // Aus dem Papierton (Schritt 1) ins Design überblenden — nicht aus der
        // Vorlage, sonst bliebe an der weichen Kante eine Zeile Vorlagenfarbe.
        const untergrund = ausgabe[ziel + c]!;
        ausgabe[ziel + c] = Math.round(untergrund + (mitSchatten - untergrund) * deckungMitRand);
      }
    }
  }

  const png = await sharp(Buffer.from(ausgabe), { raw: { width: breite, height: hoehe, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return {
    png,
    breite,
    hoehe,
    abdeckung: platz.abdeckung,
    flaechePx: { breite: flaechenBreite, hoehe: flaechenHoehe },
  };
}
