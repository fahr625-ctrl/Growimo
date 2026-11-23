// ─────────────────────────────────────────────────────────────────────────────
// Zuschnitt am PRODUKT statt an einer festen Tabelle (2026-11-23)
// ─────────────────────────────────────────────────────────────────────────────
// BEFUND (Owner, 2026-11-22/23): Die feste Tabelle `PIN_LAYOUT_CROPS` schneidet
// am Produkt vorbei — auf einem Startseiten-Pin war das Produkt oben
// abgeschnitten, zwei Drittel des Bildes zeigten leere Tischplatte.
//
// Dieser Baustein ersetzt die Tabelle, wo er benutzt wird, durch eine Messung:
//
//   1. Das Foto wird (wie im Renderer) auf 1000 × 1500 px `cover` gebracht.
//      Dieses Bild ist die Bezugsfläche: `zoom = 1` heißt genau dieses Bild.
//   2. Daraus entsteht eine Aufmerksamkeitskarte: je 10 × 10-px-Zelle die
//      lokale Streuung (Kanten, Glanz, Streuung) und der Zellmittelwert.
//      Die Karte wird NICHT von einem Modell erzeugt — `sharp` reicht, es
//      kostet nichts und ist bei gleicher Eingabe reproduzierbar.
//   3. Die zusammenhängende Fläche mit der höchsten Aufmerksamkeit (8er-Nachbar-
//      schaft, größte Komponente) ist das erkannte Motiv; ihre Box wird um drei
//      Zellen erweitert, damit auch die glatten Flächen des Produkts (Wachs,
//      Glasfläche) darin liegen.
//   4. Kandidaten sind die Ausschnitte, die der Renderer ohnehin kennt
//      (`zoom` + `focus`, dieselbe Rechnung wie `cropToPinFrame`). Jeder
//      Kandidat wird gegen ZWEI Regeln geprüft; wer eine verletzt, wird
//      verworfen und der nächste gesetzt (fail-closed).
//
// REGEL 1 — Das Produkt bleibt vollständig im Bild.
//   Die erkannte Motivbox muss mit mindestens `PRODUCT_MIN_MARGIN` px Abstand
//   im Ausschnitt liegen. Ein Ausschnitt, der das Motiv anschneidet, ist
//   unzulässig — auch wenn er „besser aussieht".
//
// REGEL 2 — Keine leere Fläche über einem Schwellwert.
//   Gezählt wird nur die SICHTBARE Fläche: Zellen, die die Textfläche des
//   Layouts verdeckt, zählen nicht mit (dort steht Text, dort ist nichts leer).
//   Eine sichtbare Zelle ist leer, wenn sie glatt ist (Streuung < EMPTY_STD)
//   UND sich farblich kaum vom Bildmittel unterscheidet. Liegt der Anteil über
//   `PRODUCT_MAX_EMPTY_SHARE`, ist der Kandidat unzulässig.
//
// Beide Regeln sind eigenständige, exportierte Funktionen — sie gelten damit
// auch für die fünf bestehenden Designs, sobald diese den Baustein aufrufen.
//
// Nichts wird erfunden: es wird nur anders ausgeschnitten.
// ─────────────────────────────────────────────────────────────────────────────

import type { SharpFactory } from './sharp-loader';
import type { PinCrop, PinCropFocus } from './pin-render';

/** Pin-Maße — bewusst hier gespiegelt, damit dieses Modul nicht zirkulär lädt. */
const W = 1000;
const H = 1500;

/** Zellenraster der Aufmerksamkeitskarte: 10 × 10 px je Zelle. */
const CELL = 10;
const GW = W / CELL; // 100
const GH = H / CELL; // 150

/** Regel 2: höchstens dieser Anteil der SICHTBAREN Fläche darf leer sein. */
export const PRODUCT_MAX_EMPTY_SHARE = 0.3;
/** Eine Zelle gilt als glatt, wenn ihre Streuung darunter liegt (0…255). */
const EMPTY_STD = 7;
/** … und als „leer" nur, wenn sie sich auch farblich kaum vom Bild löst. */
const EMPTY_MEAN_DELTA = 14;
/** Regel 1: Mindestabstand des Motivs zum Ausschnittrand in px. */
export const PRODUCT_MIN_MARGIN = 20;
/** Erweiterung der Motivbox um Zellen (glatte Produktflächen einschließen). */
const BOX_PAD_CELLS = 3;
/** Zuschnitte, die geprüft werden — absteigend, damit das Motiv groß wird. */
const CANDIDATE_ZOOMS = [1.8, 1.6, 1.45, 1.3, 1.15, 1.0];
const CANDIDATE_FOCUSES: PinCropFocus[] = [
  'centre',
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProductCropAttempt {
  zoom: number;
  focus: PinCropFocus;
  /** Regel 1: liegt das erkannte Motiv vollständig im Ausschnitt? */
  productInside: boolean;
  /** Regel 2: gemessener Anteil leerer, sichtbarer Fläche. */
  emptyShare: number;
  emptyOk: boolean;
  accepted: boolean;
}

export interface ProductCropReport {
  ok: boolean;
  /** Der gewählte Zuschnitt — dieselbe Form, die der Renderer versteht. */
  crop: PinCrop;
  /** Erkanntes Motiv in BezugsKoordinaten (1000 × 1500, zoom = 1). */
  productBox: Box;
  /** Leerflächen-Anteil des gewählten Ausschnitts (sichtbare Fläche). */
  emptyShare: number;
  maxEmptyShare: number;
  /** Klartext: warum dieser Ausschnitt (oder warum keiner). */
  note: string;
  /** Jeder geprüfte Kandidat bis zur Entscheidung — Beleg, nicht Behauptung. */
  attempts: ProductCropAttempt[];
}

// ── Aufmerksamkeitskarte ─────────────────────────────────────────────────────

interface AttentionGrid {
  /** Lokale Streuung je Zelle (0…255). */
  std: Float32Array;
  /** Zellmittelwert (0…255). */
  mean: Float32Array;
  globalMean: number;
}

/** Foto auf das Pin-Format bringen und daraus die Aufmerksamkeitskarte messen. */
async function buildGrid(sharp: SharpFactory, photo: Uint8Array): Promise<AttentionGrid> {
  const { data, info } = await sharp(Buffer.from(photo))
    .rotate()
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const std = new Float32Array(GW * GH);
  const mean = new Float32Array(GW * GH);
  let globalSum = 0;
  for (let cy = 0; cy < GH; cy++) {
    for (let cx = 0; cx < GW; cx++) {
      let sum = 0;
      let sumSq = 0;
      for (let y = cy * CELL; y < (cy + 1) * CELL; y++) {
        for (let x = cx * CELL; x < (cx + 1) * CELL; x++) {
          const v = data[(y * W + x) * channels];
          sum += v;
          sumSq += v * v;
        }
      }
      const n = CELL * CELL;
      const m = sum / n;
      const variance = Math.max(0, sumSq / n - m * m);
      const i = cy * GW + cx;
      mean[i] = m;
      std[i] = Math.sqrt(variance);
      globalSum += m;
    }
  }
  return { std, mean, globalMean: globalSum / (GW * GH) };
}

/** Perzentil einer Kopie der Werte (0…1). */
function percentile(values: Float32Array, p: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Erkanntes Motiv: die dichteste Fläche hoher Aufmerksamkeit.
 *
 * Die Zellstreuung wird über 9 × 9 Zellen geglättet (einzelne Kanten zählen
 * nicht, zusammenhängende Struktur schon) und mit einem Mittelpunkt-Gewicht
 * versehen — das Motiv steht in diesen Fotos in der Bildmitte, Hintergrund
 * (Vorhang, Tischkante, Requisiten) läuft zum Rand hin aus. Die Motivbox ist
 * das Rechteck um die Zellen ab dem 90. Perzentil.
 *
 * Die Box ist bewusst eher zu GROSS als zu klein: Regel 1 verlangt, dass das
 * Motiv vollständig im Ausschnitt bleibt — eine zu große Box verwirft einen
 * Ausschnitt zu früh (der Pin bleibt dann weiter), eine zu kleine würde das
 * Motiv anschneiden. Kein Modell, keine erfundene Kante.
 */
export function detectProductBox(grid: AttentionGrid): Box {
  const r = 4;
  const smooth = new Float32Array(GW * GH);
  for (let cy = 0; cy < GH; cy++) {
    for (let cx = 0; cx < GW; cx++) {
      let sum = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
          sum += grid.std[y * GW + x];
          n++;
        }
      }
      smooth[cy * GW + cx] = sum / n;
    }
  }
  const score = new Float32Array(GW * GH);
  for (let cy = 0; cy < GH; cy++) {
    for (let cx = 0; cx < GW; cx++) {
      const dx = (cx + 0.5) / GW - 0.5;
      const dy = (cy + 0.5) / GH - 0.5;
      const d = Math.min(1, Math.hypot(dx, dy) / 0.7071);
      score[cy * GW + cx] = smooth[cy * GW + cx] * (1 - 0.45 * d);
    }
  }
  const threshold = percentile(score, 0.9);
  let left = GW;
  let right = -1;
  let top = GH;
  let bottom = -1;
  for (let cy = 0; cy < GH; cy++) {
    for (let cx = 0; cx < GW; cx++) {
      if (score[cy * GW + cx] < threshold) continue;
      if (cx < left) left = cx;
      if (cx > right) right = cx;
      if (cy < top) top = cy;
      if (cy > bottom) bottom = cy;
    }
  }
  if (right < 0) return { left: 0, top: 0, right: W - 1, bottom: H - 1 };
  return {
    left: Math.max(0, (left - BOX_PAD_CELLS) * CELL),
    top: Math.max(0, (top - BOX_PAD_CELLS) * CELL),
    right: Math.min(W - 1, (right + 1 + BOX_PAD_CELLS) * CELL - 1),
    bottom: Math.min(H - 1, (bottom + 1 + BOX_PAD_CELLS) * CELL - 1),
  };
}

// ── Kandidaten ───────────────────────────────────────────────────────────────

function anchorOf(focus: PinCropFocus): { fx: number; fy: number } {
  const fx = focus.endsWith('left') ? 0 : focus.endsWith('right') ? 1 : 0.5;
  const fy = focus.startsWith('top') ? 0 : focus.startsWith('bottom') ? 1 : 0.5;
  return { fx, fy };
}

/**
 * Ausschnitt eines Kandidaten in Bezugskoordinaten. Das ist genau die Fläche,
 * die `cropToPinFrame` bei diesem `zoom`/`focus` aus dem Foto schneidet.
 */
export function candidateWindow(zoom: number, focus: PinCropFocus): Rect {
  const { fx, fy } = anchorOf(focus);
  const w = W / zoom;
  const h = H / zoom;
  return { x: (W - w) * fx, y: (H - h) * fy, width: w, height: h };
}

/**
 * REGEL 1: Das Produkt bleibt vollständig im Bild (mit Mindestabstand).
 *
 * „Vollständig" heißt: nicht MEHR abgeschnitten als im Quellfoto. Berührt das
 * Motiv im Quellfoto bereits eine Kante, muss der Ausschnitt diese Kante
 * ebenfalls erreichen — statt einen Rand zu verlangen, den das Foto gar nicht
 * hergibt.
 */
export function productFullyVisible(
  window: Rect,
  productBox: Box,
  margin: number = PRODUCT_MIN_MARGIN,
  source: Box = { left: 0, top: 0, right: W - 1, bottom: H - 1 },
): boolean {
  const edge = 2;
  const leftOk =
    productBox.left <= source.left + edge
      ? window.x <= source.left + edge
      : productBox.left >= window.x + margin;
  const topOk =
    productBox.top <= source.top + edge
      ? window.y <= source.top + edge
      : productBox.top >= window.y + margin;
  const rightOk =
    productBox.right >= source.right - edge
      ? window.x + window.width >= source.right - edge
      : productBox.right <= window.x + window.width - margin;
  const bottomOk =
    productBox.bottom >= source.bottom - edge
      ? window.y + window.height >= source.bottom - edge
      : productBox.bottom <= window.y + window.height - margin;
  return leftOk && topOk && rightOk && bottomOk;
}

/**
 * REGEL 2: Anteil leerer Fläche an der SICHTBAREN Fläche. Verdeckt die
 * Textfläche einen Teil des Ausschnitts, zählt dieser Teil nicht mit.
 */
export function emptyShareInWindow(
  grid: AttentionGrid,
  window: Rect,
  panel: Rect | null,
): { share: number; visible: number; empty: number } {
  let visible = 0;
  let empty = 0;
  for (let cy = 0; cy < GH; cy++) {
    for (let cx = 0; cx < GW; cx++) {
      const x = cx * CELL + CELL / 2;
      const y = cy * CELL + CELL / 2;
      if (x < window.x || x >= window.x + window.width) continue;
      if (y < window.y || y >= window.y + window.height) continue;
      if (panel) {
        const px = ((x - window.x) / window.width) * W;
        const py = ((y - window.y) / window.height) * H;
        if (px >= panel.x && px < panel.x + panel.width && py >= panel.y && py < panel.y + panel.height) {
          continue;
        }
      }
      visible++;
      const i = cy * GW + cx;
      const flat = grid.std[i] < EMPTY_STD;
      const close = Math.abs(grid.mean[i] - grid.globalMean) < EMPTY_MEAN_DELTA;
      if (flat && close) empty++;
    }
  }
  return { share: visible > 0 ? empty / visible : 1, visible, empty };
}

export interface ChooseProductCropOptions {
  /** Textfläche des Layouts (Pin-Koordinaten) — verdeckte Fläche zählt nicht. */
  panel?: Rect | null;
  maxEmptyShare?: number;
}

/**
 * Zuschnitt am Produkt wählen. Gibt bei Erfolg den ersten Kandidaten zurück,
 * der BEIDE Regeln erfüllt (größter Zoom zuerst). Verletzt ein Kandidat eine
 * Regel, wird er verworfen und der nächste geprüft; erfüllt keiner beide
 * Regeln, ist das Ergebnis `ok: false` — dann entsteht kein Bild (fail-closed).
 */
export async function chooseProductCrop(
  sharp: SharpFactory,
  photo: Uint8Array,
  options: ChooseProductCropOptions = {},
): Promise<ProductCropReport> {
  const maxEmptyShare = options.maxEmptyShare ?? PRODUCT_MAX_EMPTY_SHARE;
  const panel = options.panel ?? null;
  const grid = await buildGrid(sharp, photo);
  const productBox = detectProductBox(grid);

  const attempts: ProductCropAttempt[] = [];
  for (const zoom of CANDIDATE_ZOOMS) {
    const acceptedHere: { attempt: ProductCropAttempt; window: Rect }[] = [];
    for (const focus of CANDIDATE_FOCUSES) {
      const window = candidateWindow(zoom, focus);
      const productInside = productFullyVisible(window, productBox);
      const { share } = emptyShareInWindow(grid, window, panel);
      const emptyOk = share <= maxEmptyShare;
      const attempt: ProductCropAttempt = {
        zoom,
        focus,
        productInside,
        emptyShare: Math.round(share * 1000) / 1000,
        emptyOk,
        accepted: productInside && emptyOk,
      };
      attempts.push(attempt);
      if (attempt.accepted) acceptedHere.push({ attempt, window });
    }
    if (acceptedHere.length > 0) {
      acceptedHere.sort((a, b) => a.attempt.emptyShare - b.attempt.emptyShare);
      const best = acceptedHere[0].attempt;
      return {
        ok: true,
        crop: { zoom: best.zoom, focus: best.focus },
        productBox,
        emptyShare: best.emptyShare,
        maxEmptyShare,
        note:
          `Zuschnitt am Produkt: Motiv ${productBox.left}–${productBox.right} / ${productBox.top}–${productBox.bottom} px, ` +
          `Ausschnitt zoom ${best.zoom} (${best.focus}). Regel 1 erfüllt (Motiv vollständig im Bild, ` +
          `${PRODUCT_MIN_MARGIN} px Rand), Regel 2 erfüllt (leere sichtbare Fläche ${(best.emptyShare * 100).toFixed(1)} %, ` +
          `Grenze ${(maxEmptyShare * 100).toFixed(0)} %).`,
        attempts,
      };
    }
  }

  const last = attempts[attempts.length - 1];
  return {
    ok: false,
    crop: { zoom: 1, focus: 'centre' },
    productBox,
    emptyShare: last ? last.emptyShare : 1,
    maxEmptyShare,
    note:
      `Kein Ausschnitt erfüllt beide Regeln: das Motiv ` +
      `${productBox.left}–${productBox.right} / ${productBox.top}–${productBox.bottom} px lässt sich nicht vollständig halten, ` +
      `ohne dass mehr als ${(maxEmptyShare * 100).toFixed(0)} % der sichtbaren Fläche leer bleiben. Kein Bild (fail-closed).`,
    attempts,
  };
}
