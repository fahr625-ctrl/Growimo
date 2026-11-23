// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Kampagne: Pin-Komposition mit `sharp` (kein generatives Modell)
// ─────────────────────────────────────────────────────────────────────────────
// Das Originalfoto des Nutzers wird auf 1000 × 1500 px beschnitten, mit einer
// Textfläche + Text + optionalem Logo überlagert und als PNG exportiert.
// Es wird NICHTS erfunden und NICHTS generiert: nur das hochgeladene Foto,
// Layout, Text und (falls aktiv) das Markenprofil.
//
// FÜNF LAYOUTS (Phase 2, Pin-Entwürfe): jedes Layout setzt Textposition,
// Ausrichtung, Textfläche und Rahmen anders — damit fünf Pins aus EINEM Foto
// sichtbar unterschiedlich aussehen und nicht fünfmal dasselbe Bild mit
// anderem Wort sind.
//
// LESBARKEIT (2026-11-15, Owner-Befund „zweite Kopfzeile läuft ins Foto"):
// Die Textfläche wird NICHT mehr geschätzt, sondern aus den GEMESSENEN
// Textpixeln abgeleitet:
//   1. Text-Ebene rendern und die Tinten-Bounding-Box messen.
//   2. Die Fläche (Band/Karte/Streifen) so legen, dass sie diese Box mit
//      Sicherheitsabstand vollständig und praktisch DECKEND enthält.
//   3. Hintergrund (Foto + Fläche) und Text zusammensetzen, dann den
//      tatsächlichen WCAG-Kontrast an jedem Kern-Textpixel messen.
//      Reicht er nicht (4,5 : 1), wird GERETTET statt abgelehnt (2026-11-22):
//      der Renderer setzt die besser lesbare Textfarbe mit passender Textfläche
//      und meldet die Anpassung (`contrastNotice`). Gekürzt wird dabei nie.
// Damit kann Schrift nicht mehr mit Bildinhalt kollidieren — auch nicht auf
// einem dunklen, unruhigen Foto.
//
// KEIN WORT WIRD WEGGELASSEN (2026-11-15, Owner-Befund „Untertitel mitten im
// Satz abgeschnitten"): Der Umbruch kennt keine Zeilen-Obergrenze mehr. Passt
// ein Text nicht, wird er ZUERST umgebrochen (auch an vorhandenen Bindestrichen,
// damit ein langes Kompositum nicht die ganze Fläche breit macht) und danach
// verkleinert — nie gekürzt. Nach dem Setzen wird die Wortfolge gegen die
// Eingabe geprüft: fehlt auch nur ein Wort, gibt es KEIN Bild (`text_truncated`).
//
// Fail-closed-Regeln (Phase-2-SPEC §6):
//   • Ausgabe muss nachweislich 1000 × 1500 px PNG sein, sonst Fehler.
//   • Text-Overlay muss nachweislich Pixel zeichnen. Fehlt im Laufzeit-Image
//     eine Schrift, liefert librsvg stillschweigend ein leeres Overlay — genau
//     das wird hier gemessen und als `font_missing` abgebrochen.
//   • Text darf den sicheren Rand nicht überschreiten (`text_overflow`).
//   • Kein Wort darf verloren gehen (`text_truncated`).
//   • Text muss den Mindestkontrast erreichen — sonst wird die Textfarbe
//     automatisch lesbarer gesetzt und die Anpassung gemeldet (2026-11-22).
// ─────────────────────────────────────────────────────────────────────────────

import { loadSharp, type SharpFactory } from './sharp-loader';
import { chooseProductCrop, type ProductCropReport } from './pin-crop-attention';
import { PIN_FONT_FAMILY_NAMES, PIN_FONT_STACKS, isPinFontId, type PinFontId } from './pin-fonts';
import { PIN_FONT_COVERAGE, missingGlyphs, pinFontIdFromFamily } from './pin-font-coverage';
import { findResidualEscape, resolveEscapes } from '~/lib/text-normalize';

export const PIN_WIDTH = 1000;
export const PIN_HEIGHT = 1500;

/** Freie, lizenzsichere Schriftkette (OFL-Systemschriften, keine Downloads). */
// Reihenfolge: zuerst die EINGEBETTETE Schrift (pin-font.ts richtet fontconfig
// darauf ein) — damit der Pin überall gleich aussieht. Die Systemschriften
// danach sind nur Rückfall für die lokale Entwicklung.
export const PIN_FONT_STACK =
  PIN_FONT_STACKS.sans;

/** Mindestkontrast Text ↔ Hintergrund (WCAG AA, normaler Text). */
export const MIN_TEXT_CONTRAST = 4.5;

/** Abstand, den Text zum Pin-Rand halten muss. */
const SAFE_MARGIN = 40;

/**
 * Stufen, in denen die Schrift schrumpft, bis der Text in Rand und Fläche
 * passt. Die Liste reicht bewusst weit hinunter: lieber kleiner setzen als ein
 * Wort weglassen.
 */
const FIT_SCALES = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46, 0.4];

/** Flächenfarben, wenn die Markenfarbe selbst nicht lesbar wäre. */
const PANEL_DARK = '#111827';
const PANEL_LIGHT = '#f8fafc';

/**
 * Deckkraft der Textfläche: 1 = vollständig deckend. Bei 0,97 zeichnet sich ein
 * harter Bildkontrast (schwarz/weiß im Foto) noch als Geistermuster unter der
 * Schrift ab — deshalb keine Transparenz unter dem Text.
 */
const PANEL_OPACITY = 1;

// ── Layouts ──────────────────────────────────────────────────────────────────

export type PinLayoutId =
  | 'bottom-left'
  | 'top-band'
  | 'center-card'
  | 'side-stripe'
  | 'minimal-frame'
  // Zwei Muster (2026-11-23): echte Layout-IDs im Renderer. Sie stehen NICHT
  // in `PIN_LAYOUT_IDS`, damit der laufende Kampagnen-Ablauf weiter genau fünf
  // Entwürfe erzeugt — die drei (bzw. fünf) alten Layouts bleiben unverändert.
  | 'editorial-serif'
  | 'bold-block'
  // Fünf eigenständige Designs (2026-11-23): drei ruhige in der Familie von
  // „editorial-serif", zwei auffällige ohne große Farbflächen. `bold-block` ist
  // dabei ZURÜCKGEBAUT (der Block ist auf Balken + Leiste geschrumpft), nicht
  // verworfen.
  | 'galerie-plaque'
  | 'atelier-nord'
  | 'kontrast-ribbon';

export type PinAlign = 'left' | 'center' | 'right';

/** Reihenfolge = Reihenfolge der fünf Entwürfe in der Oberfläche. */
export const PIN_LAYOUT_IDS: PinLayoutId[] = [
  'bottom-left',
  'top-band',
  'center-card',
  'side-stripe',
  'minimal-frame',
];

/** Die beiden Muster-Layouts (2026-11-23) — eigene Liste, eigener Einstieg. */
export const PIN_MUSTER_LAYOUT_IDS: PinLayoutId[] = ['editorial-serif', 'bold-block'];

/**
 * Die fünf fertigen Pin-Designs (2026-11-23) — Reihenfolge = Reihenfolge in der
 * Galerie und in der Layout-Auswahl. Drei ruhige (Editorial, Galerie, Atelier),
 * zwei auffällige (Signal, Kontrast).
 */
export const PIN_DESIGN_IDS: PinLayoutId[] = [
  'editorial-serif',
  'galerie-plaque',
  'atelier-nord',
  'bold-block',
  'kontrast-ribbon',
];

/** Name je Design — statt „1"–„5" (Owner-Vorgabe 2026-11-23). */
export const PIN_DESIGN_NAMES: Record<string, string> = {
  'editorial-serif': 'Editorial',
  'galerie-plaque': 'Galerie',
  'atelier-nord': 'Atelier',
  'bold-block': 'Signal',
  'kontrast-ribbon': 'Kontrast',
  'bottom-left': 'Klassisch',
  'top-band': 'Kopfband',
  'center-card': 'Karte',
  'side-stripe': 'Seitenstreifen',
  'minimal-frame': 'Reduziert',
};

/** Die fünf alten Layouts (bleiben als Auswahl erhalten, „ausblenden statt löschen"). */
export const PIN_LEGACY_LAYOUT_IDS: PinLayoutId[] = [
  'bottom-left',
  'top-band',
  'center-card',
  'side-stripe',
  'minimal-frame',
];

type ScrimKind =
  | 'bottom-band'
  | 'top-band'
  | 'center-card'
  | 'bottom-corner'
  | 'bottom-band-soft'
  /** Muster A: schmale Creme-Fläche im unteren Drittel + Haarlinie. */
  | 'editorial-slip'
  /** Muster B: kräftiger Farbblock mit schräger Kante ins Bild. */
  | 'bold-block'
  /** Design „Galerie": schwebende helle Karte mit Haarlinien-Rahmen. */
  | 'galerie-plaque'
  /** Design „Atelier": Papierband mit schräger Oberkante, Unterzeile als Eyebrow. */
  | 'atelier-band'
  /** Design „Signal": schwebende dunkle Leiste + schmaler Akzentbalken. */
  | 'signal-bar'
  /** Design „Kontrast": Verlauf von rechts + schmales Akzentband an der Kante. */
  | 'kontrast-ribbon';
type FrameKind = 'inset' | 'rule' | 'none';
type Anchor = 'top' | 'center' | 'bottom';

interface LayoutSpec {
  align: PinAlign;
  anchor: Anchor;
  titleSize: number;
  subtitleSize: number;
  titleChars: number;
  subtitleChars: number;
  marginX: number;
  scrim: ScrimKind;
  frame: FrameKind;
  frameWidth: number;
  /**
   * Schrift des Layouts, wenn das Markenprofil keine wählt (2026-11-23).
   * Ohne Angabe bleibt es bei der bisherigen Sans-Kette — die alten Layouts
   * ändern sich dadurch nicht.
   */
  fontId?: PinFontId;
  /**
   * Eigene Schrift für die UNTERZEILE (2026-11-23). Jedes Design bringt ein
   * eigenes Schriftpaar mit — ohne Angabe gilt die Schrift der Überschrift.
   */
  subtitleFontId?: PinFontId;
  /** Akzentfarbe des Layouts (Haarlinie, Balken, Chip) — Marke schlägt Layout. */
  accentColor?: string;
  /** Akzentbalken über der Textfläche (Design „Signal"). */
  bar?: { width: number; height: number; gap: number; chip: number };
  /** Schmales Akzentband an der Bildkante (Design „Kontrast"). */
  ribbon?: { width: number };
  /** Textfarbe des Layouts, wenn das Overlay keine wählt. */
  textColor?: string;
  /** Flächenfarbe des Layouts, wenn das Markenprofil keine primäre hat. */
  panelColor?: string;
  /** Überschrift in Großbuchstaben setzen (Muster B). */
  uppercase?: boolean;
  /** Unterzeile ÜBER der Überschrift setzen (Eyebrow, Design „Atelier"). */
  subtitleFirst?: boolean;
  /** Sperrung in px je Zeichen (Muster B). */
  letterSpacing?: number;
  /** Haarlinie über der Textfläche (Muster A). */
  hairline?: { width: number; height: number; gap: number };
  /** Schräge der Blockkante in px (Muster B, „Kante ragt ins Bild"). */
  slant?: number;
  /** Zuschnitt am Produkt statt aus `PIN_LAYOUT_CROPS` (2026-11-23). */
  productCrop?: boolean;
  /**
   * Motivschutz (2026-11-15): Die Textfläche darf erst UNTERHALB dieser Höhe
   * beginnen (Anteil der Pin-Höhe). Damit bleibt die Bildmitte — dort sitzt in
   * den allermeisten Fotos das Produktmotiv — unverdeckt. Reicht der Platz
   * nicht, verkleinert der Fit-Lauf die Schrift; gekürzt wird nie.
   */
  bandTopFrac?: number;
  /** Abstand des Textblocks zur Unterkante in px (default 140). */
  bottomInset?: number;
  /**
   * Breitengebunden: die Zeichen pro Zeile bleiben beim Verkleinern KONSTANT.
   * Nötig, wenn die Textfläche eine feste Breite hat (Seitenstreifen) — sonst
   * würde kleiner gesetzte Schrift automatisch mehr Zeichen pro Zeile fassen
   * und die Fläche bliebe trotzdem so breit wie das Foto es zulässt.
   */
  widthBound?: boolean;
  /** Feste Breite der Textfläche (px) — nur bei `bottom-corner`. */
  stripe?: { solid: number; fade: number };
}

const LAYOUTS: Record<PinLayoutId, LayoutSpec> = {
  // 1) Klassisch: Text unten links, geschlossenes Fußband, feiner Markenrahmen.
  'bottom-left': {
    align: 'left',
    anchor: 'bottom',
    titleSize: 76,
    subtitleSize: 40,
    titleChars: 22,
    subtitleChars: 34,
    marginX: 70,
    scrim: 'bottom-band',
    frame: 'inset',
    frameWidth: 6,
  },
  // 2) Kopfbalken: Text oben, geschlossene Fläche, Trennlinie über dem Text.
  'top-band': {
    align: 'left',
    anchor: 'top',
    titleSize: 66,
    subtitleSize: 38,
    titleChars: 24,
    subtitleChars: 36,
    marginX: 70,
    scrim: 'top-band',
    frame: 'rule',
    frameWidth: 8,
  },
  // 3) Karte: gerundete Fläche, zentriert, aber im UNTEREN Bilddrittel — vorher
  //    lag sie mitten auf dem Produktmotiv (Owner-Befund 2026-11-15).
  'center-card': {
    align: 'center',
    anchor: 'bottom',
    titleSize: 60,
    subtitleSize: 34,
    titleChars: 21,
    subtitleChars: 44,
    marginX: 84,
    scrim: 'center-card',
    frame: 'none',
    frameWidth: 0,
    bandTopFrac: 0.75,
    bottomInset: 70,
  },
  // 4) Seitenstreifen: schmale Textfläche am linken Rand, jetzt aber nur im
  //    unteren Viertel (vorher über die volle Höhe — sie nahm dem Foto die
  //    linke Hälfte und dem Poster die Sichtbarkeit). Die Fläche hat eine FESTE
  //    Breite (440 px); die Schrift füllt sie aus, statt darüber hinauszuwachsen.
  'side-stripe': {
    align: 'left',
    anchor: 'bottom',
    titleSize: 56,
    subtitleSize: 30,
    titleChars: 13,
    subtitleChars: 23,
    marginX: 44,
    scrim: 'bottom-corner',
    frame: 'rule',
    frameWidth: 10,
    stripe: { solid: 440, fade: 0 },
    bandTopFrac: 0.75,
    bottomInset: 70,
  },
  // 5) Reduziert: wenig Text, zentriert unten, schmales Band statt Rahmenkarte.
  'minimal-frame': {
    align: 'center',
    anchor: 'bottom',
    titleSize: 58,
    subtitleSize: 32,
    titleChars: 30,
    subtitleChars: 46,
    marginX: 90,
    scrim: 'bottom-band-soft',
    frame: 'inset',
    frameWidth: 3,
  },
  // ── Design 1 — „Editorial" (ruhig, Familie von Muster A) ──────────────────
  // Serif-Überschrift + Sans-Unterzeile, helle Fläche im unteren Drittel, die
  // bis zur Unterkante durchgezogen ist, als einziger Akzent eine Haarlinie.
  // Kein Badge, keine Großbuchstaben, kein Rahmen — die Ruhe ist das Mittel.
  'editorial-serif': {
    align: 'left',
    anchor: 'bottom',
    titleSize: 62,
    subtitleSize: 30,
    titleChars: 20,
    subtitleChars: 30,
    marginX: 90,
    scrim: 'editorial-slip',
    frame: 'none',
    frameWidth: 0,
    fontId: 'serif',
    subtitleFontId: 'sans',
    textColor: '#1E1C19',
    panelColor: '#F7F4EF',
    accentColor: '#2E3338',
    hairline: { width: 220, height: 3, gap: 34 },
    bandTopFrac: 0.6,
    // Owner-Befund an den Mustern: unter der Unterzeile blieb ein großer toter
    // Creme-Bereich. Die Fläche endet jetzt mit normalem Fußabstand.
    bottomInset: 96,
    productCrop: true,
  },
  // ── Design 2 — „Galerie" (ruhig) ──────────────────────────────────────────
  // Sans-Überschrift + Serif-Unterzeile, Text ZENTRIERT auf einer schwebenden
  // weißen Karte mit feinem Rahmen. Die Karte berührt keine Kante — sie liegt
  // wie ein Passepartout auf dem Foto (eigene Flächenform, eigene Aufteilung).
  'galerie-plaque': {
    align: 'center',
    anchor: 'bottom',
    titleSize: 56,
    subtitleSize: 32,
    titleChars: 24,
    subtitleChars: 34,
    marginX: 120,
    scrim: 'galerie-plaque',
    frame: 'none',
    frameWidth: 0,
    fontId: 'sans',
    subtitleFontId: 'serif',
    textColor: '#14181C',
    panelColor: '#FFFFFF',
    accentColor: '#A9B2B8',
    bandTopFrac: 0.58,
    bottomInset: 150,
    productCrop: true,
  },
  // ── Design 3 — „Atelier" (ruhig) ──────────────────────────────────────────
  // Serif-Überschrift + Mono-Eyebrow: die Unterzeile steht ÜBER der Überschrift
  // (eigene Textbehandlung), auf einem Papierband mit schräger Oberkante.
  // Die Unterzeile ist zugleich der einzige Akzent — kein Badge, kein Rahmen.
  'atelier-nord': {
    align: 'left',
    anchor: 'bottom',
    titleSize: 56,
    subtitleSize: 24,
    titleChars: 19,
    subtitleChars: 30,
    marginX: 88,
    scrim: 'atelier-band',
    frame: 'none',
    frameWidth: 0,
    fontId: 'serif',
    subtitleFontId: 'mono',
    subtitleFirst: true,
    textColor: '#1B2126',
    panelColor: '#EEF1F2',
    accentColor: '#6B7780',
    bandTopFrac: 0.6,
    bottomInset: 104,
    productCrop: true,
  },
  // ── Design 4 — „Signal" (auffällig, ZURÜCKGEBAUTER bold-block) ─────────────
  // Der große Farbblock ist weg. Geblieben ist ein ELEMENT: eine schwebende
  // dunkle Leiste (randabständig, nicht randlos) mit einem schmalen Akzentbalken
  // und einem kleinen Quadrat darüber. Fette Sans in Großbuchstaben mit
  // Sperrung, Mono-Unterzeile — werblich, ohne dem Produkt die Fläche zu nehmen.
  'bold-block': {
    align: 'left',
    anchor: 'bottom',
    titleSize: 64,
    subtitleSize: 28,
    titleChars: 17,
    subtitleChars: 30,
    marginX: 84,
    scrim: 'signal-bar',
    frame: 'none',
    frameWidth: 0,
    fontId: 'sans',
    subtitleFontId: 'mono',
    textColor: '#FFFFFF',
    panelColor: '#0E1114',
    accentColor: '#E23D28',
    uppercase: true,
    letterSpacing: 3,
    bar: { width: 120, height: 10, gap: 40, chip: 20 },
    bandTopFrac: 0.55,
    bottomInset: 140,
    productCrop: true,
  },
  // ── Design 5 — „Kontrast" (auffällig) ─────────────────────────────────────
  // Mono-Überschrift in Großbuchstaben, rechtsbündig unten rechts, auf einem
  // Verlauf von der rechten Kante; dort ein schmales Akzentband als einziges
  // Farb-Element. Sans-Unterzeile. Plakativer Kontrast ohne Farbfläche.
  'kontrast-ribbon': {
    align: 'right',
    anchor: 'bottom',
    titleSize: 56,
    subtitleSize: 30,
    titleChars: 19,
    subtitleChars: 30,
    marginX: 88,
    scrim: 'kontrast-ribbon',
    frame: 'none',
    frameWidth: 0,
    fontId: 'mono',
    subtitleFontId: 'sans',
    textColor: '#FFFFFF',
    panelColor: '#12161A',
    accentColor: '#1F6FEB',
    uppercase: true,
    letterSpacing: 1,
    ribbon: { width: 16 },
    bandTopFrac: 0.55,
    bottomInset: 120,
    productCrop: true,
  },
};

export function isPinLayoutId(v: unknown): v is PinLayoutId {
  return typeof v === 'string' && v in LAYOUTS;
}

// ── Bildausschnitt je Layout (2026-11-17) ────────────────────────────────────
// BEFUND: Bis heute wurde das Foto für ALLE fünf Pins identisch zugeschnitten
// (`position: 'centre'`). Fünf Pins aus einem Foto sahen dadurch aus wie ein
// Bild mit fünf Texten. Jedes Layout schneidet jetzt ANDERS zu — als
// deklarative Tabelle direkt neben der Layout-Spezifikation, damit der
// Unterschied prüfbar ist (Test: `scripts/kampagne-basisbild-crops-2026-11-17.ts`).
//
// `zoom` = Vergrößerung vor dem Beschnitt (1 = das ganze 2:3-Bild),
// `focus` = an welcher Kante der Beschnitt sitzt. Beides zusammen ergibt
// einen anderen Bildausschnitt — es wird weiterhin NICHTS erfunden und nichts
// generiert, nur anders zugeschnitten.

export type PinCropFocus =
  | 'centre'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export interface PinCrop {
  /** ≥ 1 und ≤ PIN_CROP_MAX_ZOOM; 1 = volles Bild. */
  zoom: number;
  focus: PinCropFocus;
}

export const PIN_CROP_MAX_ZOOM = 2;
export const PIN_CROP_MIN_ZOOM = 1;

const PIN_CROP_FOCUSES: PinCropFocus[] = [
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

export function isPinCropFocus(v: unknown): v is PinCropFocus {
  return typeof v === 'string' && (PIN_CROP_FOCUSES as readonly string[]).includes(v);
}

/**
 * Zuschnitt je Layout. Die Werte sind absichtlich verschieden in BEIDEN
 * Achsen (Zoom und Anker), damit sich die fünf Pins auch bei einem ruhigen,
 * gleichmäßigen Foto sichtbar unterscheiden:
 *   1 unten links  — volles Bild (das Motiv bleibt ganz)
 *   2 Kopfbalken   — herangezoomt auf die untere Bildhälfte
 *   3 Mittlere Karte — leicht heran, obere Bildhälfte
 *   4 Seitenstreifen — stark heran, rechte Bildhälfte
 *   5 Reduziert    — mittel heran, unten links
 */
export const PIN_LAYOUT_CROPS: Record<PinLayoutId, PinCrop> = {
  'bottom-left': { zoom: 1, focus: 'centre' },
  'top-band': { zoom: 1.35, focus: 'bottom' },
  'center-card': { zoom: 1.15, focus: 'top' },
  'side-stripe': { zoom: 1.6, focus: 'right' },
  'minimal-frame': { zoom: 1.25, focus: 'bottom-left' },
  // Muster A/B (2026-11-23) stehen hier nur als Rückfall: beide schneiden
  // standardmäßig am PRODUKT zu (`productCrop`, pin-crop-attention.ts). Der
  // Eintrag greift, wenn ein Aufrufer den Zuschnitt ausdrücklich abschaltet.
  'editorial-serif': { zoom: 1, focus: 'centre' },
  'bold-block': { zoom: 1, focus: 'centre' },
  'galerie-plaque': { zoom: 1, focus: 'centre' },
  'atelier-nord': { zoom: 1, focus: 'centre' },
  'kontrast-ribbon': { zoom: 1, focus: 'centre' },
};

/** Zuschnitt eines Layouts (unveränderlich kopiert, damit niemand die Tabelle ändert). */
export function layoutCrop(layout: PinLayoutId): PinCrop {
  const crop = PIN_LAYOUT_CROPS[layout] ?? PIN_LAYOUT_CROPS['bottom-left'];
  return { zoom: crop.zoom, focus: crop.focus };
}

/**
 * Zuschnitt prüfen und begrenzen (fail-closed). Ein unbrauchbarer Wert fällt
 * auf den Layout-Standard zurück — nie auf einen erfundenen Ausschnitt.
 */
export function normalizeCrop(input: unknown, fallback: PinCrop): PinCrop {
  const raw = (input ?? null) as Partial<PinCrop> | null;
  if (!raw || typeof raw !== 'object') return { zoom: fallback.zoom, focus: fallback.focus };
  const zoomNum = Number(raw.zoom);
  const zoom = Number.isFinite(zoomNum)
    ? Math.min(PIN_CROP_MAX_ZOOM, Math.max(PIN_CROP_MIN_ZOOM, Math.round(zoomNum * 100) / 100))
    : fallback.zoom;
  const focus = isPinCropFocus(raw.focus) ? raw.focus : fallback.focus;
  return { zoom, focus };
}

/** Ankerpunkt als Anteil (0 = linke/obere Kante, 1 = rechte/untere Kante). */
export function cropAnchor(focus: PinCropFocus): { fx: number; fy: number } {
  const fx = focus.endsWith('left') ? 0 : focus.endsWith('right') ? 1 : 0.5;
  const fy = focus.startsWith('top') ? 0 : focus.startsWith('bottom') ? 1 : 0.5;
  return { fx, fy };
}

/** Ankerpunkt als `sharp`-Position (für den cover-Beschnitt des Ausgangsformats). */
function sharpPosition(focus: PinCropFocus): string {
  switch (focus) {
    case 'top':
      return 'north';
    case 'bottom':
      return 'south';
    case 'left':
      return 'west';
    case 'right':
      return 'east';
    case 'top-left':
      return 'northwest';
    case 'top-right':
      return 'northeast';
    case 'bottom-left':
      return 'southwest';
    case 'bottom-right':
      return 'southeast';
    default:
      return 'centre';
  }
}

/**
 * Foto auf Pin-Maß bringen und dabei den Zuschnitt des Layouts anwenden:
 * erst auf `zoom ×` vergrößert (cover), dann das 1000 × 1500-Fenster am
 * Ankerpunkt herausgeschnitten. EXIF-Rotation wird beachtet.
 */
export async function cropToPinFrame(
  sharp: SharpFactory,
  photo: Uint8Array,
  crop: PinCrop,
): Promise<Buffer> {
  const { fx, fy } = cropAnchor(crop.focus);
  const zoom = Math.min(PIN_CROP_MAX_ZOOM, Math.max(PIN_CROP_MIN_ZOOM, crop.zoom));
  const w = Math.round(PIN_WIDTH * zoom);
  const h = Math.round(PIN_HEIGHT * zoom);
  const resized = await sharp(Buffer.from(photo))
    .rotate()
    .resize(w, h, { fit: 'cover', position: sharpPosition(crop.focus) })
    .png()
    .toBuffer();
  if (w === PIN_WIDTH && h === PIN_HEIGHT) return resized;
  const left = Math.round((w - PIN_WIDTH) * fx);
  const top = Math.round((h - PIN_HEIGHT) * fy);
  return sharp(resized)
    .extract({ left, top, width: PIN_WIDTH, height: PIN_HEIGHT })
    .png()
    .toBuffer();
}

/** Prüft eine Farbe streng (nur #rgb/#rrggbb) — verhindert SVG-Injection. */
export function safeHexColor(value: string | null | undefined, fallback: string): string {
  const v = (value ?? '').trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : fallback;
}

// ── Farb-/Kontrastrechnung (WCAG 2.1) ────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function channelToLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b)
  );
}

function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

function hexLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return relativeLuminance(r, g, b);
}

// ── Öffentliche Eingabe-Typen ────────────────────────────────────────────────

export interface PinBrand {
  /** Primärfarbe (Hex, z. B. #1f2937) — Fläche hinter dem Text. */
  primary?: string | null;
  /** Akzentfarbe (Hex) — Rahmen/Trennlinie. */
  accent?: string | null;
  /** Schriftfamilie (nur OFL-Namen), leer = PIN_FONT_STACK. */
  fontFamily?: string | null;
}

/** Bearbeitbares Overlay je Pin (Text, Position, Farbe, Schrift). */
export interface PinOverlay {
  /** Textfarbe des Overlays (Hex); default #ffffff. */
  textColor?: string | null;
  /** Ausrichtung; default = Layout-Vorgabe. */
  align?: PinAlign | null;
  /** Verschiebung des Textblocks in Anteilen der Pin-Höhe (−0.35 … 0.35). */
  offsetY?: number | null;
  /**
   * Schriftwahl (2026-11-23): Sans/Serif/Mono aus dem Brand Kit. Gilt für
   * Überschrift UND Unterzeile. Leer ⇒ Schriftpaar des Designs.
   */
  fontId?: PinFontId | null;
  /**
   * Flächenfarbe (2026-11-23) — die deckende Fläche hinter dem Text. Leer ⇒
   * Markenfarbe, sonst die Farbe des Designs. Wird der Mindestkontrast nicht
   * erreicht, rettet der Renderer wie bisher statt abzubrechen.
   */
  panelColor?: string | null;
  /** Akzentfarbe (Haarlinie/Balken/Band) — Marke und Layout sind der Rückfall. */
  accentColor?: string | null;
}

export interface PinRenderInput {
  /** Originalfoto des Nutzers (JPEG/PNG/WebP). */
  photo: Uint8Array;
  /** Optionales Logo (PNG/JPEG/WebP; Transparenz wird übernommen). */
  logo?: Uint8Array | null;
  /**
   * @deprecated Brand Kit 2026-11-16: Position und Größe sind jetzt fest
   * (SPEC §3: unten rechts, ≤ 26 % Breite, ≤ 10 % Höhe, 40 px Rand). Die Felder
   * bleiben nur für ältere Aufrufer stehen und werden nicht mehr ausgewertet.
   */
  logoPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** @deprecated siehe `logoPosition`. */
  logoWidth?: number;
  /** Eines der fünf Layouts; default 'bottom-left'. */
  layout?: PinLayoutId;
  /**
   * Bildausschnitt (2026-11-17). Fehlt er, gilt der Zuschnitt des Layouts aus
   * `PIN_LAYOUT_CROPS` — damit schneiden die fünf Pins von sich aus anders zu.
   */
  crop?: PinCrop | null;
  /** Bearbeitbares Overlay (Farbe/Ausrichtung/Position). */
  overlay?: PinOverlay | null;
  /** Kleine Markenzeile (nur wenn das Markenprofil aktiv ist). */
  brandLine?: string | null;
  title: string;
  subtitle?: string | null;
  /** Markenprofil — null/undefined ⇒ neutrale Farben. */
  brand?: PinBrand | null;
}

export class PinRenderError extends Error {
  code:
    | 'no_photo'
    | 'font_missing'
    | 'logo_unreadable'
    | 'text_escaped'
    | 'text_overflow'
    | 'text_truncated'
    | 'contrast_too_low'
    | 'crop_rejected'
    | 'wrong_dimensions'
    | 'render_failed';
  constructor(code: PinRenderError['code'], message: string) {
    super(message);
    this.name = 'PinRenderError';
    this.code = code;
  }
}

/** Lazy: `sharp` wird erst beim ersten Rendern geladen (Native-Binding). */
async function getSharp(): Promise<SharpFactory> {
  return loadSharp();
}

/** XML-Escaping für Text in SVG (sonst bricht jedes „&" oder „<" das Bild). */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Bricht Text in Zeilen — OHNE je ein Wort zu verlieren.
 *
 * Es gibt keine Zeilen-Obergrenze: lieber mehr Zeilen (und danach kleinere
 * Schrift) als ein halber Satz. Ein einzelnes Wort, das breiter als die Zeile
 * ist, wird an einem VORHANDENEN Bindestrich getrennt („Gäste-" / „WC-Poster")
 * — dabei geht kein Zeichen verloren, weil der Bindestrich stehen bleibt.
 */
export function wrapText(text: string, maxCharsPerLine: number): string[] {
  const limit = Math.max(4, Math.round(maxCharsPerLine));
  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    if (word.length > limit) {
      // Zu langes Einzelwort: an vorhandenen Bindestrichen umbrechen.
      let rest = word;
      while (rest.length > limit) {
        const cut = rest.lastIndexOf('-', limit - 1);
        if (cut <= 0) break;
        lines.push(rest.slice(0, cut + 1));
        rest = rest.slice(cut + 1);
      }
      current = rest;
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Vergleichsform: Zeilenumbrüche (auch nach Bindestrich) zählen nicht. */
function normalizeForCompare(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([-/\u2010\u00AD])\s+/g, '$1');
}

/**
 * Prüft, dass die gesetzten Zeilen die Eingabe VOLLSTÄNDIG enthalten: gleiche
 * Wortfolge, gleiche Zeichen. Ein fehlendes Wort ⇒ `false` ⇒ kein Bild.
 */
export function textIsComplete(source: string, lines: string[]): boolean {
  return normalizeForCompare(lines.join(' ')) === normalizeForCompare(source);
}

// ── Messung der Text-Ebene ───────────────────────────────────────────────────

interface InkBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface MeasuredLayer {
  png: Buffer;
  box: InkBox;
  pixels: number;
  raw: Buffer;
  width: number;
  height: number;
  channels: number;
}

/** Rendert eine SVG-Ebene und misst, WO sie tatsächlich Pixel setzt. */
async function measureInk(sharp: SharpFactory, svg: Buffer): Promise<MeasuredLayer> {
  const png = await sharp(svg).png().toBuffer();
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let pixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > 24) {
        pixels++;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  const box: InkBox = right < 0 ? { left: 0, top: 0, right: 0, bottom: 0 } : { left, top, right, bottom };
  return { png, box, pixels, raw: data, width, height, channels };
}

function boxFitsSafeArea(box: InkBox): boolean {
  return (
    box.left >= SAFE_MARGIN &&
    box.right <= PIN_WIDTH - SAFE_MARGIN &&
    box.top >= SAFE_MARGIN &&
    box.bottom <= PIN_HEIGHT - SAFE_MARGIN
  );
}

// ── Schrift-Prüfung: Glyphen-Coverage, KEINE Pixel ──────────────────────────
// BEFUND 2026-11-15: Ohne Schrift zeichnet librsvg für JEDES Zeichen dasselbe
// leere Kästchen — „Text" im Sinne einer Pixelzählung, und doch unlesbar.
//
// BEFUND 2026-11-17 (SPEC §9): Die damalige Folgerung, fehlende Zeichen über
// einen Pixelvergleich mit dem Ersatzzeichen (.notdef) zu erkennen, kann nicht
// greifen: Pango schreibt den Codepoint INS Kästchen. Jedes fehlende Zeichen
// sieht damit anders aus als .notdef und galt als vorhanden — sechs von sechs
// Pins gingen mit sichtbarem Kästchen durch.
//
// Jetzt wird nicht gemessen, sondern GELESEN: pin-font-coverage.ts enthält die
// belegten Codepoints der eingebetteten Schrift, erzeugt aus genau den Bytes,
// die fontconfig bekommt. Jedes Zeichen von Titel, Untertitel und Markenzeile
// wird gegen die Coverage der GEWÄHLTEN Familie geprüft; fehlt eins, gibt es
// kein Bild (`font_missing`, mit Zeichen und U+Nummer).

/**
 * Deterministische Vorprüfung ohne Pixel: ist die eingebettete Schrift in
 * diesem Prozess überhaupt bereitgestellt? `pin-font.ts` legt sie ab und setzt
 * `FONTCONFIG_FILE` — fehlt die Variable, würde Pango Kästchen zeichnen.
 */
function assertFontPrepared(fontId: PinFontId): void {
  if (PIN_FONT_COVERAGE[fontId].size === 0) {
    throw new PinRenderError(
      'font_missing',
      `Für die Schrift „${PIN_FONT_FAMILY_NAMES[fontId]}" ist keine Glyphen-Coverage hinterlegt — es wird nichts geraten.`,
    );
  }
  if (!(process.env.FONTCONFIG_FILE ?? '').trim()) {
    throw new PinRenderError(
      'font_missing',
      `Die eingebettete Schrift „${PIN_FONT_FAMILY_NAMES[fontId]}" ist nicht bereitgestellt (FONTCONFIG_FILE fehlt) — es entstünden leere Kästchen.`,
    );
  }
}

/**
 * Prüft JEDES Zeichen des Pins gegen die Coverage der gewählten Familie.
 * Leerraum und Zeilenumbrüche sind kein Fehler, Ersatzzeichen (U+FFFD) gelten
 * als gewollt. Fehlt ein Zeichen: `font_missing`, kein Bild.
 */
export function assertGlyphsRenderable(
  fontFamily: string | null | undefined,
  texts: (string | null | undefined)[],
): void {
  const fontId = pinFontIdFromFamily(fontFamily);
  assertFontPrepared(fontId);
  const missing = missingGlyphs(fontId, texts);
  if (missing.length > 0) {
    const list = missing.map((m) => `„${m.char}" (${m.label})`).join(', ');
    throw new PinRenderError(
      'font_missing',
      `Die gewählte Schrift „${PIN_FONT_FAMILY_NAMES[fontId]}" hat ${missing.length} Zeichen des Textes nicht (${list}) — es entstünde ein leeres Kästchen. Bitte eine andere Schrift wählen oder das Zeichen ersetzen.`,
    );
  }
}


// ── Geometrie ────────────────────────────────────────────────────────────────

interface TextGeometry {
  spec: LayoutSpec;
  align: PinAlign;
  titleLines: string[];
  subtitleLines: string[];
  titleSize: number;
  subtitleSize: number;
  lineGap: number;
  blockTop: number;
  blockHeight: number;
  ruleY: number;
  x: number;
}

/** Position/Größe des Textblocks für Layout + Overlay + Schriftstufe berechnen. */
function geometry(input: PinRenderInput, scale = 1): TextGeometry {
  const spec = LAYOUTS[input.layout && isPinLayoutId(input.layout) ? input.layout : 'bottom-left'];
  const align: PinAlign =
    input.overlay?.align === 'center' || input.overlay?.align === 'left' || input.overlay?.align === 'right'
      ? input.overlay.align
      : spec.align;

  const titleSize = Math.round(spec.titleSize * scale);
  const subtitleSize = Math.round(spec.subtitleSize * scale);
  const lineGap = Math.round(18 * scale);
  const ruleGap = Math.round(34 * scale);

  // Kleinere Schrift fasst mehr Zeichen pro Zeile — außer bei breitengebundenen
  // Layouts, deren Textfläche eine feste Breite hat.
  const charsFor = (base: number) =>
    spec.widthBound ? base : Math.max(6, Math.round(base / scale));

  const titleLines = wrapText(input.title || '', charsFor(spec.titleChars));
  const subtitleLines = input.subtitle
    ? wrapText(input.subtitle, charsFor(spec.subtitleChars))
    : [];

  const blockHeight =
    titleLines.length * (titleSize + lineGap) +
    (subtitleLines.length ? subtitleLines.length * (subtitleSize + lineGap) + ruleGap : 0);

  let blockTop =
    spec.anchor === 'bottom'
      ? PIN_HEIGHT - (spec.bottomInset ?? 140) - blockHeight
      : spec.anchor === 'top'
        ? 150
        : Math.round((PIN_HEIGHT - blockHeight) / 2);

  const offset = Math.max(-0.35, Math.min(0.35, Number(input.overlay?.offsetY ?? 0) || 0));
  blockTop += Math.round(offset * PIN_HEIGHT);
  blockTop = Math.max(40, Math.min(PIN_HEIGHT - blockHeight - 40, blockTop));

  return {
    spec,
    align,
    titleLines,
    subtitleLines,
    titleSize,
    subtitleSize,
    lineGap,
    blockTop,
    blockHeight,
    ruleY: blockTop + titleLines.length * (titleSize + lineGap) + 8,
    x:
      align === 'center'
        ? Math.round(PIN_WIDTH / 2)
        : align === 'right'
          ? PIN_WIDTH - spec.marginX
          : spec.marginX,
  };
}

/**
 * Schrift für Überschrift und Unterzeile. Reihenfolge: Schriftwahl des Nutzers
 * (2026-11-23, gilt für beide Zeilen) → Markenprofil → Schriftpaar des Designs.
 */
function effectiveFontFamily(brand: PinBrand | null | undefined, spec: LayoutSpec): string {
  return brand?.fontFamily?.trim() || PIN_FONT_STACKS[spec.fontId ?? 'sans'];
}

function effectiveSubtitleFontFamily(
  input: PinRenderInput,
  spec: LayoutSpec,
): string {
  if (isPinFontId(input.overlay?.fontId)) return PIN_FONT_STACKS[input.overlay.fontId];
  if (input.brand?.fontFamily?.trim()) return input.brand.fontFamily.trim();
  return PIN_FONT_STACKS[spec.subtitleFontId ?? spec.fontId ?? 'sans'];
}

/** Nur die Text-Ebene (transparent) — separat renderbar für die Messung. */
function textLayerSvg(input: PinRenderInput, g: TextGeometry): string {
  const brand = input.brand ?? null;
  const fontFamily = isPinFontId(input.overlay?.fontId)
    ? PIN_FONT_STACKS[input.overlay.fontId]
    : effectiveFontFamily(brand, g.spec);
  const subtitleFamily = effectiveSubtitleFontFamily(input, g.spec);
  const color = safeHexColor(input.overlay?.textColor, g.spec.textColor ?? '#ffffff');
  const anchor = g.align === 'center' ? 'middle' : g.align === 'right' ? 'end' : 'start';
  const gap = g.titleSize + g.lineGap;
  // Muster B (2026-11-23): Großbuchstaben + Sperrung. Beides ändert nur die
  // ZEICHNUNG; die geprüfte Wortfolge bleibt die Eingabe (kein Wortverlust).
  const letterspacing = g.spec.letterSpacing
    ? ` letter-spacing="${Math.round(g.spec.letterSpacing * (g.titleSize / g.spec.titleSize))}"`
    : '';
  const shape = (line: string) => (g.spec.uppercase ? line.toLocaleUpperCase('de-DE') : line);

  // 2026-11-23: Bei „Eyebrow"-Designs (Atelier) steht die Unterzeile ÜBER der
  // Überschrift. Die Höhe des Blocks bleibt dieselbe — nur die Reihenfolge der
  // Zeilen dreht sich. Kein Wort wird dabei anders gesetzt.
  const subGap = g.subtitleSize + g.lineGap;
  const ruleGapScaled = Math.round(34 * (g.titleSize / g.spec.titleSize));
  const eyebrow = g.spec.subtitleFirst === true;
  const titleStartY = eyebrow
    ? g.blockTop + g.subtitleLines.length * subGap + ruleGapScaled + g.titleSize
    : g.blockTop + g.titleSize;
  const subtitleStartY = eyebrow
    ? g.blockTop + g.subtitleSize
    : g.blockTop + g.titleLines.length * gap + ruleGapScaled + g.subtitleSize;

  const titleTspans = g.titleLines
    .map(
      (line, i) =>
        `<tspan x="${g.x}" y="${titleStartY + i * gap}">${esc(shape(line))}</tspan>`,
    )
    .join('');

  const subtitleTspans = g.subtitleLines
    .map(
      (line, i) =>
        `<tspan x="${g.x}" y="${subtitleStartY + i * subGap}">${esc(line)}</tspan>`,
    )
    .join('');

  return `<svg width="${PIN_WIDTH}" height="${PIN_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <text font-family='${esc(fontFamily)}' font-size="${g.titleSize}" font-weight="700" fill="${color}" text-anchor="${anchor}"${letterspacing}>${titleTspans}</text>
  ${subtitleTspans ? `<text font-family='${esc(subtitleFamily)}' font-size="${g.subtitleSize}" font-weight="400" fill="${color}" fill-opacity="0.94" text-anchor="${anchor}">${subtitleTspans}</text>` : ''}
</svg>`;
}

/** Kleine Markenzeile (Markenprofil aktiv) — separat, damit die Textmessung sauber bleibt. */
function brandLineSvg(input: PinRenderInput, g: TextGeometry, fontSize = 30): string | null {
  const text = (input.brandLine ?? '').trim();
  if (!text) return null;
  const fontFamily = input.brand?.fontFamily?.trim() || PIN_FONT_STACK;
  const accent = safeHexColor(input.brand?.accent, '#ffffff');
  // Gegenüber dem Textblock, damit sich nichts überlagert.
  const y = g.spec.anchor === 'top' ? PIN_HEIGHT - 60 : 90;
  return `<svg width="${PIN_WIDTH}" height="${PIN_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <text x="${Math.round(PIN_WIDTH / 2)}" y="${y}" text-anchor="middle" font-family='${esc(fontFamily)}' font-size="${fontSize}" font-weight="600" fill="${accent}" fill-opacity="0.95">${esc(text)}</text>
</svg>`;
}

/**
 * Wählt die Flächenfarbe: die Markenfarbe, wenn sie gegen die Textfarbe lesbar
 * ist — sonst die dunkle bzw. helle neutrale Fläche. So bleibt der Text IMMER
 * lesbar, ohne dass eine unlesbare Markenfarbe das Pin blockiert.
 */
function pickPanelColor(brandPrimary: string, textColor: string, layoutDefault: string = PANEL_DARK): string {
  const textLum = hexLuminance(textColor);
  const candidates = [brandPrimary, layoutDefault, PANEL_DARK, PANEL_LIGHT];
  let best = candidates[0];
  let bestRatio = 0;
  for (const candidate of candidates) {
    const ratio = contrastRatio(hexLuminance(candidate), textLum);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  return best;
}

/**
 * Ersatz-Textfarben für den Rettungsfall (2026-11-22): hell und dunkel, damit
 * zu jedem Hintergrund eine lesbare Variante existiert. Sortiert wird nach der
 * Lesbarkeit, die diese Farbe MIT ihrer passenden Textfläche erreicht — die
 * erste Variante ist also die beste, nicht eine willkürliche.
 */
const RESCUE_TEXT_COLORS = ['#ffffff', '#111827', '#f8fafc', '#000000'];

function readableTextColors(requested: string, brandPrimary: string, layoutDefault: string = PANEL_DARK): string[] {
  const wanted = requested.toLowerCase();
  return RESCUE_TEXT_COLORS.filter((candidate) => candidate !== wanted)
    .map((candidate) => ({
      candidate,
      ratio: contrastRatio(
        hexLuminance(pickPanelColor(brandPrimary, candidate, layoutDefault)),
        hexLuminance(candidate),
      ),
    }))
    .sort((a, b) => b.ratio - a.ratio)
    .map((entry) => entry.candidate);
}

/** Kontrastwert für Klartext: deutsches Komma, höchstens zwei Nachkommastellen. */
function contrastText(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded).replace('.', ',');
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fläche um die gemessene Textbox (Sicherheitsabstand), auf das Pin begrenzt. */
function panelRect(box: InkBox, padX: number, padY: number): Rect {
  const x = Math.max(0, box.left - padX);
  const y = Math.max(0, box.top - padY);
  return {
    x,
    y,
    width: Math.min(PIN_WIDTH, box.right + padX) - x,
    height: Math.min(PIN_HEIGHT, box.bottom + padY) - y,
  };
}

/**
 * Textfläche + Markenrahmen. Die Fläche wird aus der GEMESSENEN Textbox
 * abgeleitet und deckt sie vollständig ab — dadurch kann Schrift nicht mehr
 * über Bildinhalt laufen. Jedes Layout bekommt eine andere Form.
 */
function scrimLayerSvg(
  input: PinRenderInput,
  g: TextGeometry,
  panel: Rect,
  brandBox: InkBox | null,
  panelColor: string,
): string {
  const accent = safeHexColor(
    input.overlay?.accentColor ?? input.brand?.accent,
    g.spec.accentColor ?? '#ffffff',
  );
  const frame = g.spec.frame;
  const fill = `fill="${panelColor}"`;

  const frameSvg =
    frame === 'inset'
      ? `<rect x="12" y="12" width="${PIN_WIDTH - 24}" height="${PIN_HEIGHT - 24}" fill="none" stroke="${accent}" stroke-width="${g.spec.frameWidth}" stroke-opacity="0.9" />`
      : '';

  // Verlauf zum weichen Auslaufen der Kante (0 → volle Deckkraft).
  const fade = (id: string, x1: number, y1: number, x2: number, y2: number, fromY: number) => `
    <defs><linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
      <stop offset="0%" stop-color="${panelColor}" stop-opacity="0" />
      <stop offset="100%" stop-color="${panelColor}" stop-opacity="${PANEL_OPACITY}" />
    </linearGradient></defs>
    <rect x="0" y="${fromY}" width="${PIN_WIDTH}" height="${Math.round(panel.y - fromY)}" fill="url(#${id})" />`;

  let body = '';
  if (g.spec.scrim === 'bottom-band' || g.spec.scrim === 'bottom-band-soft') {
    // Fußband: Verlauf oben (weich) + deckende Fläche unter der Textbox.
    const fadeFrom = Math.max(0, panel.y - (g.spec.scrim === 'bottom-band' ? 160 : 190));
    body =
      (panel.y > fadeFrom ? fade('gFade', 0, 0, 0, 1, fadeFrom) : '') +
      `<rect x="0" y="${Math.round(panel.y)}" width="${PIN_WIDTH}" height="${PIN_HEIGHT - Math.round(panel.y)}" ${fill} fill-opacity="${PANEL_OPACITY}" />`;
  } else if (g.spec.scrim === 'top-band') {
    // Kopfbalken: deckende Fläche oben + Verlauf nach unten.
    const solidTo = Math.round(panel.y + panel.height);
    body =
      `<rect x="0" y="0" width="${PIN_WIDTH}" height="${solidTo}" ${fill} fill-opacity="${PANEL_OPACITY}" />` +
      `<defs><linearGradient id="gFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${panelColor}" stop-opacity="${PANEL_OPACITY}" />
        <stop offset="100%" stop-color="${panelColor}" stop-opacity="0" />
      </linearGradient></defs>` +
      `<rect x="0" y="${solidTo}" width="${PIN_WIDTH}" height="200" fill="url(#gFade)" />`;
  } else if (g.spec.scrim === 'center-card') {
    // Karte: rundum Sicherheitsabstand, deckend.
    const card = panelRect(
      { left: panel.x, top: panel.y, right: panel.x + panel.width, bottom: panel.y + panel.height },
      0,
      0,
    );
    body =
      `<rect x="${Math.round(card.x)}" y="${Math.round(card.y)}" width="${Math.round(card.width)}" height="${Math.round(card.height)}" rx="36" ${fill} fill-opacity="${PANEL_OPACITY}" />`;
  } else if (g.spec.scrim === 'editorial-slip') {
    // Muster A (2026-11-23): schmales Creme-Band im unteren Drittel, darüber
    // ein sanfter Verlauf (kein harter Schnitt), und als einziger Akzent eine
    // feine Haarlinie. Kein Rahmen, kein Badge, keine Großbuchstaben — die
    // Ruhe ist das Gestaltungsmittel, die Fläche deckt den unteren Rand
    // vollständig ab (keine leere Ecke).
    const hairline = g.spec.hairline ?? { width: 220, height: 3, gap: 34 };
    const slipTop = Math.max(0, Math.round(panel.y));
    const fadeFrom = Math.max(0, slipTop - 170);
    const lineY = Math.max(SAFE_MARGIN, slipTop - hairline.gap);
    const lineColor = safeHexColor(g.spec.textColor, '#22201C');
    body =
      (slipTop > fadeFrom ? fade('gEdFade', 0, 0, 0, 1, fadeFrom) : '') +
      `<rect x="0" y="${slipTop}" width="${PIN_WIDTH}" height="${PIN_HEIGHT - slipTop}" ${fill} fill-opacity="${PANEL_OPACITY}" />` +
      `<rect x="${g.spec.marginX}" y="${lineY}" width="${hairline.width}" height="${hairline.height}" fill="${lineColor}" />`;
  } else if (g.spec.scrim === 'galerie-plaque') {
    // Design „Galerie" (2026-11-23): schwebende helle Karte, die KEINE Kante
    // berührt — ein Passepartout auf dem Foto, mit einer feinen zweiten Linie
    // innen. Eigene Flächenform: kein Band, kein Streifen, keine Ecke.
    const cardX = 64;
    const cardW = PIN_WIDTH - 2 * cardX;
    const cardTop = Math.max(SAFE_MARGIN, Math.round(panel.y) - 34);
    const cardBottom = Math.min(
      PIN_HEIGHT - 64,
      Math.round(panel.y + panel.height) + 34,
    );
    body =
      `<rect x="${cardX}" y="${cardTop}" width="${cardW}" height="${cardBottom - cardTop}" ${fill} fill-opacity="${PANEL_OPACITY}" />` +
      `<rect x="${cardX + 12}" y="${cardTop + 12}" width="${cardW - 24}" height="${Math.max(2, cardBottom - cardTop - 24)}" fill="none" stroke="${accent}" stroke-width="2" stroke-opacity="0.85" />`;
  } else if (g.spec.scrim === 'atelier-band') {
    // Design „Atelier" (2026-11-23): Papierband mit SCHRÄGER Oberkante — eine
    // eigene Flächenform zwischen Band (Editorial) und Leiste (Signal). Darüber
    // ein kurzer Akzentstrich, der die Eyebrow-Zeile einleitet.
    const slant = 90;
    const bandTopLeft = Math.max(slant + SAFE_MARGIN, Math.round(panel.y) - 26);
    const accentY = Math.max(SAFE_MARGIN, bandTopLeft - 46);
    body =
      `<polygon points="0,${bandTopLeft} ${PIN_WIDTH},${bandTopLeft - slant} ${PIN_WIDTH},${PIN_HEIGHT} 0,${PIN_HEIGHT}" ${fill} fill-opacity="${PANEL_OPACITY}" />` +
      `<rect x="${g.spec.marginX}" y="${accentY}" width="64" height="5" fill="${accent}" />`;
  } else if (g.spec.scrim === 'signal-bar') {
    // Design „Signal" (2026-11-23, zurückgebauter bold-block): KEIN großer
    // Farbblock mehr. Eine randabständige, schwebende dunkle Leiste trägt den
    // Text; das einzige Farbelement ist ein schmaler Balken mit Quadrat.
    const bar = g.spec.bar ?? { width: 120, height: 10, gap: 40, chip: 20 };
    const inset = 40;
    const stripTop = Math.max(SAFE_MARGIN, Math.round(panel.y) - 58);
    // Die Leiste umschließt den Text mit normalem Abstand und schwebt über dem
    // unteren Rand — kein toter Bereich unter der Unterzeile, keine Fläche, die
    // dem Produkt die Aufmerksamkeit nimmt.
    const stripBottom = Math.min(
      PIN_HEIGHT - inset,
      Math.round(panel.y + panel.height) + 48,
    );
    const barY = Math.max(SAFE_MARGIN, stripTop + 32);
    body =
      `<rect x="${inset}" y="${stripTop}" width="${PIN_WIDTH - 2 * inset}" height="${Math.max(80, stripBottom - stripTop)}" ${fill} fill-opacity="${PANEL_OPACITY}" />` +
      `<rect x="${inset + 44}" y="${barY}" width="${bar.width}" height="${bar.height}" fill="${accent}" />` +
      `<rect x="${inset + 44 + bar.width + 20}" y="${barY - Math.round((bar.chip - bar.height) / 2)}" width="${bar.chip}" height="${bar.chip}" fill="${accent}" />`;
  } else if (g.spec.scrim === 'kontrast-ribbon') {
    // Design „Kontrast" (2026-11-23): weicher dunkler Verlauf in der unteren
    // rechten Ecke (kein harter Rand) + ein schmales Akzentband an der rechten
    // Bildkante im Bereich des Textes. Farbe nur als Kante, nicht als Fläche.
    const ribbon = g.spec.ribbon ?? { width: 16 };
    const gx1 = Math.max(0, Math.round(panel.x) - 260);
    const gy1 = Math.max(0, Math.round(panel.y) - 260);
    body =
      `<defs><linearGradient id="gKr" gradientUnits="userSpaceOnUse" x1="${gx1}" y1="${gy1}" x2="${PIN_WIDTH - 40}" y2="${PIN_HEIGHT - 40}">
        <stop offset="0%" stop-color="${panelColor}" stop-opacity="0" />
        <stop offset="62%" stop-color="${panelColor}" stop-opacity="${PANEL_OPACITY}" />
        <stop offset="100%" stop-color="${panelColor}" stop-opacity="${PANEL_OPACITY}" />
      </linearGradient></defs>` +
      `<rect x="0" y="0" width="${PIN_WIDTH}" height="${PIN_HEIGHT}" fill="url(#gKr)" />` +
      `<rect x="${PIN_WIDTH - ribbon.width}" y="0" width="${ribbon.width}" height="${PIN_HEIGHT}" fill="${accent}" />`;
  } else {
    // Seitenstreifen im unteren Bildviertel: FESTE Breite, Höhe ab der
    // gemessenen Textbox bis zur Unterkante. Der senkrechte Akzentbalken links
    // hält den Streifen-Charakter, ohne dem Foto die Mitte zu nehmen.
    const stripe = g.spec.stripe ?? { solid: 440, fade: 0 };
    const solidW = Math.min(PIN_WIDTH, stripe.solid);
    const blockTop = Math.max(0, Math.round(panel.y));
    body =
      `<rect x="0" y="${blockTop}" width="${solidW}" height="${PIN_HEIGHT - blockTop}" ${fill} fill-opacity="${PANEL_OPACITY}" />` +
      `<rect x="0" y="${blockTop}" width="${g.spec.frameWidth}" height="${PIN_HEIGHT - blockTop}" fill="${accent}" />`;
  }

  // Markenzeile bekommt eine eigene kleine Fläche (gleiche Deckkraft).
  const brandPlate = brandBox
    ? (() => {
        const plate = panelRect(brandBox, 26, 14);
        return `<rect x="${Math.round(plate.x)}" y="${Math.round(plate.y)}" width="${Math.round(plate.width)}" height="${Math.round(plate.height)}" rx="14" ${fill} fill-opacity="${PANEL_OPACITY}" />`;
      })()
    : '';

  // Trennlinie über dem Untertitel (Layouts mit `rule`) — Akzentfarbe.
  const ruleSvg =
    frame === 'rule' && g.subtitleLines.length
      ? `<rect x="${g.align === 'center' ? Math.round(PIN_WIDTH / 2) - 60 : g.spec.marginX}" y="${Math.round(g.ruleY)}" width="120" height="${g.spec.frameWidth}" fill="${accent}" />`
      : '';

  return `<svg width="${PIN_WIDTH}" height="${PIN_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  ${body}
  ${brandPlate}
  ${ruleSvg}
  ${frameSvg}
</svg>`;
}

// ── Kontrastmessung am fertigen Hintergrund ──────────────────────────────────

interface ContrastReport {
  min: number;
  mean: number;
  samples: number;
}

/**
 * Misst den TATSÄCHLICHEN Kontrast: jeder Kern-Textpixel (Alpha ≥ 200) wird
 * über den fertigen Hintergrund (Foto + Fläche) gelegt und mit genau diesem
 * Hintergrundpixel verglichen. Das ist die Zahl, die der Betrachter sieht.
 */
function measureContrast(
  bg: { raw: Buffer; channels: number },
  layers: MeasuredLayer[],
): ContrastReport {
  let min = Number.POSITIVE_INFINITY;
  let sum = 0;
  let samples = 0;
  for (const layer of layers) {
    const px = layer.width * layer.height;
    for (let p = 0; p < px; p++) {
      const si = p * layer.channels;
      const alpha = layer.raw[si + 3];
      if (alpha < 200) continue;
      const bi = p * bg.channels;
      const br = bg.raw[bi];
      const bgc = bg.raw[bi + 1];
      const bb = bg.raw[bi + 2];
      const a = alpha / 255;
      const tr = a * layer.raw[si] + (1 - a) * br;
      const tg = a * layer.raw[si + 1] + (1 - a) * bgc;
      const tb = a * layer.raw[si + 2] + (1 - a) * bb;
      const ratio = contrastRatio(
        relativeLuminance(tr, tg, tb),
        relativeLuminance(br, bgc, bb),
      );
      if (ratio < min) min = ratio;
      sum += ratio;
      samples++;
    }
  }
  return {
    min: samples > 0 ? Math.round(min * 100) / 100 : 0,
    mean: samples > 0 ? Math.round((sum / samples) * 100) / 100 : 0,
    samples,
  };
}

export interface PinRenderResult {
  png: Buffer;
  width: number;
  height: number;
  bytes: number;
  /** Deckende Pixel der Text-Ebene — Beleg, dass die Schrift gegriffen hat. */
  textPixels: number;
  /** Gemessener Mindestkontrast Text ↔ Hintergrund (WCAG). */
  minContrast: number;
  /** Tatsächlich gesetzte Textfarbe (kann von der gewählten abweichen). */
  textColor: string;
  /** Gewählte Textfarbe — unverändert durchgereicht. */
  requestedTextColor: string;
  /** Mindestkontrast der GEWÄHLTEN Farbe, vor der Rettung. */
  requestedContrast: number;
  /** Deckende Textfläche, die tatsächlich gesetzt wurde. */
  panelColor: string;
  /** true = die Textfarbe wurde automatisch lesbarer gemacht. */
  contrastAdjusted: boolean;
  /** Klartext für die Oberfläche (null = nichts angepasst). */
  contrastNotice: string | null;
  /** Verwendete Schriftstufe (1 = volle Größe). */
  fontScale: number;
  /** Gesetzte Zeilen — Beleg, dass der Text vollständig untergebracht ist. */
  titleLineCount: number;
  subtitleLineCount: number;
  /** Wortfolge vollständig? (harte Regel — bei `false` gäbe es kein Bild). */
  wordsComplete: boolean;
  /** Laufzeit-Angaben für den Artefakt-Beleg. */
  sharpVersion: string;
  libvips: string;
  /** Das tatsächlich verwendete Layout. */
  layout: PinLayoutId;
  /** Der tatsächlich verwendete Bildausschnitt — Beleg, dass er nicht für alle gleich ist. */
  crop: PinCrop;
  /**
   * Zuschnitt am Produkt (2026-11-23): erkannter Motivbereich, beide Regeln und
   * jeder geprüfte Kandidat. null = dieses Layout schneidet aus der Tabelle zu.
   */
  productCrop: ProductCropReport | null;
  /** Deckende Textfläche (Foto-Koordinaten) — Beleg für den Motivschutz. */
  panel: Rect;
  /** Logoplatzierung im Pin (null = kein Logo) — Beleg für die SPEC-Grenzen. */
  logo: { top: number; left: number; width: number; height: number } | null;
}

// ── Logo (Brand Kit 2026-11-16) ──────────────────────────────────────────────

/** Grenzen aus SPEC §3: 26 % der Breite, 10 % der Höhe, 40 px Rand. */
const LOGO_MAX_WIDTH = Math.round(PIN_WIDTH * 0.26); // 260 px
const LOGO_MAX_HEIGHT = Math.round(PIN_HEIGHT * 0.1); // 150 px
const LOGO_MARGIN = 40;

function overlapsInk(rect: Rect, box: InkBox): boolean {
  return (
    rect.x < box.right && rect.x + rect.width > box.left && rect.y < box.bottom && rect.y + rect.height > box.top
  );
}

/**
 * Logo auf Pin-Maß bringen und platzieren: unten rechts, 40 px Rand, ÜBER Foto
 * und Textfläche. Das Seitenverhältnis bleibt erhalten (fit: inside), das Logo
 * wird nie vergrößert. Kollidiert es mit dem Text oder der Markenzeile, wandert
 * es nach OBEN aus dem Weg — Lesbarkeit vor Zierde, aber ohne die Ecke zu
 * verlassen. Ist das Logo nicht lesbar, gibt es einen Fehler (kein stilles
 * Weglassen).
 */
async function placeLogo(
  sharp: SharpFactory,
  logo: Uint8Array,
  obstacles: (InkBox | null)[],
): Promise<{ png: Buffer; top: number; left: number; width: number; height: number }> {
  let png: Buffer;
  try {
    png = await sharp(Buffer.from(logo))
      .rotate()
      .resize({
        width: LOGO_MAX_WIDTH,
        height: LOGO_MAX_HEIGHT,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  } catch (err) {
    throw new PinRenderError(
      'logo_unreadable',
      `Das Logo ist nicht lesbar (${(err as Error).message}). Bitte als PNG, JPEG oder WebP erneut hochladen.`,
    );
  }
  const meta = await sharp(png)
    .metadata()
    .catch(() => null);
  const width = meta?.width ?? 0;
  const height = meta?.height ?? 0;
  if (!width || !height) {
    throw new PinRenderError(
      'logo_unreadable',
      'Das Logo hat keine lesbaren Maße. Bitte als PNG, JPEG oder WebP erneut hochladen.',
    );
  }

  const left = PIN_WIDTH - width - LOGO_MARGIN;
  let top = PIN_HEIGHT - height - LOGO_MARGIN;
  const boxes = obstacles.filter((b): b is InkBox => b !== null);
  for (let step = 0; step < 8; step++) {
    const hit = boxes.find((box) => overlapsInk({ x: left, y: top, width, height }, box));
    if (!hit) break;
    top = hit.top - height - 16;
    if (top < LOGO_MARGIN) {
      top = LOGO_MARGIN;
      break;
    }
  }
  return { png, top: Math.max(0, Math.round(top)), left: Math.max(0, Math.round(left)), width, height };
}

/**
 * Rendert EIN Pin: Foto (cover, 1000×1500) + Textfläche + Text + optional Logo.
 * Wirft `PinRenderError`, wenn das Ergebnis nicht belegbar ein 1000×1500-PNG ist,
 * der Text nicht gezeichnet wurde (fehlende Schrift im Laufzeit-Image), aus dem
 * sicheren Rand läuft oder den Mindestkontrast nicht erreicht.
 */
export async function renderPinPng(input: PinRenderInput): Promise<PinRenderResult> {
  if (!input.photo || input.photo.length === 0) {
    throw new PinRenderError('no_photo', 'Kein Foto übergeben.');
  }
  // 0a) Escape-Reste (2026-11-18, Befund „… einzigartig\"" und mehrfach escaped):
  //     Ein Backslash, der UNMITTELBAR vor einem Anführungszeichen steht, ist
  //     ein Escape-Rest ohne Wortinhalt — er wird entfernt, das Bild entsteht
  //     (nichts geht verloren). Was danach noch an Backslashes übrig ist
  //     (mitten im Wort, vor einem Leerzeichen), ist NICHT vertrauenswürdig:
  //     der Renderer setzt die Zeichen wörtlich, der Nutzer bekäme den
  //     Backslash mitgeliefert, ohne es zu merken. Also: kein Bild, klare
  //     Meldung (fail-closed). Die volle Reparatur passiert vorher in
  //     `normalizeModelText`.
  input = {
    ...input,
    title: resolveEscapes(input.title) ?? '',
    subtitle: resolveEscapes(input.subtitle),
    brandLine: resolveEscapes(input.brandLine),
  };
  const escaped = findResidualEscape([input.title, input.subtitle, input.brandLine]);
  if (escaped !== null) {
    throw new PinRenderError(
      'text_escaped',
      `Der Text enthält einen Escape-Rest (Backslash) und wird nicht ins Bild gesetzt: ${escaped.slice(0, 80)}`,
    );
  }
  const sharp = await getSharp();
  const versions = (sharp as unknown as { versions?: Record<string, string> }).versions ?? {};
  const layout: PinLayoutId = input.layout && isPinLayoutId(input.layout) ? input.layout : 'bottom-left';
  const layoutSpec = LAYOUTS[layout];
  // 0) Erst prüfen, dass die Schrift überhaupt Zeichen zeichnet — und zwar
  //    GEGEN DIE GEWÄHLTE FAMILIE (Brand Kit 2026-11-16). Ohne diesen Nachweis
  //    entstünde ein Pin voller leerer Kästchen (Tofu) — ein Bild, das wie ein
  //    Ergebnis aussieht und keines ist. Geprüft wird der ECHTE Text: fehlt
  //    auch nur ein Zeichen in der Familie, gibt es kein Bild.
  //    Seit 2026-11-23 zählt die Schrift, die das LAYOUT setzt (Muster A:
  //    Serif), wenn das Markenprofil keine wählt — sonst würde die falsche
  //    Familie geprüft.
  const effectiveFamily = isPinFontId(input.overlay?.fontId)
    ? PIN_FONT_STACKS[input.overlay.fontId]
    : effectiveFontFamily(input.brand, layoutSpec);
  // 2026-11-23: Jedes Design hat ein eigenes Schriftpaar. Geprüft wird jede
  // Familie gegen GENAU den Text, den sie setzt — sonst ginge ein fehlendes
  // Zeichen der Unterzeile durch, weil die Überschrift es hat.
  assertGlyphsRenderable(effectiveFamily, [input.title, input.brandLine]);
  assertGlyphsRenderable(effectiveSubtitleFontFamily(input, layoutSpec), [input.subtitle]);

  // 1) Text-Ebene rendern, messen und — falls nötig — verkleinern, bis sie in
  //    den sicheren Rand UND (bei breitengebundenen Layouts) in die Textfläche
  //    passt. Die Messung ist die Grundlage der Textfläche. Gekürzt wird nie:
  //    passt der Text in keiner Stufe, gibt es kein Bild.
  //    DIESELBE Funktion prüft seit 2026-11-18 auch VOR dem KI-Aufruf
  //    (`checkPinTextFit`) — Prüfung und Bild können nicht auseinanderlaufen.
  const fit = await fitTextLayer(sharp, { ...input, layout });
  if (!fit.ok) throw new PinRenderError(fit.code, fit.message);
  const geometryUsed = fit.geometry;
  const textLayer = fit.layer;
  const fontScale = fit.scale;

  // 1b) Harte Regel: kein Wort darf fehlen. Geprüft wird die tatsächlich
  //     gesetzte Wortfolge gegen die Eingabe — nicht die Absicht.
  if (
    !textIsComplete(input.title || '', geometryUsed.titleLines) ||
    (input.subtitle ? !textIsComplete(input.subtitle, geometryUsed.subtitleLines) : false)
  ) {
    throw new PinRenderError(
      'text_truncated',
      'Der Text würde unvollständig gesetzt — es fehlen Wörter. Kein Bild.',
    );
  }

  // 2) Markenzeile messen (eigene Fläche) — bei Bedarf verkleinern, nie kürzen.
  let brandSvg = brandLineSvg(input, geometryUsed);
  let brandLayer = brandSvg ? await measureInk(sharp, Buffer.from(brandSvg)) : null;
  if (brandSvg && brandLayer) {
    const maxBrandWidth = PIN_WIDTH - 120;
    const brandWidth = brandLayer.box.right - brandLayer.box.left;
    if (brandWidth > maxBrandWidth) {
      const smaller = Math.max(14, Math.round(30 * (maxBrandWidth / brandWidth)));
      brandSvg = brandLineSvg(input, geometryUsed, smaller);
      brandLayer = brandSvg ? await measureInk(sharp, Buffer.from(brandSvg)) : null;
    }
  }

  // 3) Fläche aus der gemessenen Textbox — deckend, mit Sicherheitsabstand.
  //    Textfarbe und Flächenfarbe kommen seit 2026-11-23 aus dem Layout, wenn
  //    weder Overlay noch Markenprofil eine wählen (Muster A: Anthrazit auf
  //    Creme, Muster B: Weiß auf kräftigem Rot).
  const requestedTextColor = safeHexColor(
    input.overlay?.textColor,
    layoutSpec.textColor ?? '#ffffff',
  );
  const layoutPanel = safeHexColor(layoutSpec.panelColor, PANEL_DARK);
  const brandPrimary = safeHexColor(input.brand?.primary, layoutPanel);
  /**
   * Flächenfarbe bestimmen (2026-11-23). Reihenfolge:
   *   1. die vom Nutzer gewählte Flächenfarbe (`overlay.panelColor`),
   *   2. die Markenfarbe aus dem Brand Kit (`brand.primary`),
   *   3. die Farbe des Designs,
   * jeweils nur, wenn sie den Mindestkontrast zur Textfarbe erreicht. Sonst —
   * und wie bisher bei den alten Layouts ohne eigene Farbe — gewinnt die Farbe
   * mit dem höchsten Kontrast (dunkel/hell als Rettung). Nichts wird geraten.
   */
  const panelColorFor = (textColor: string): string => {
    const textLum = hexLuminance(textColor);
    const readable = (candidate: string | null | undefined) =>
      !!candidate && contrastRatio(hexLuminance(candidate), textLum) >= MIN_TEXT_CONTRAST;
    const chosenPanel = safeHexColor(input.overlay?.panelColor, '');
    if (readable(chosenPanel)) return chosenPanel;
    if (readable(brandPrimary)) return brandPrimary;
    const own = layoutSpec.panelColor ? layoutPanel : null;
    if (readable(own)) return own as string;
    return pickPanelColor(brandPrimary, textColor, layoutPanel);
  };

  const padX = Math.round(28 + geometryUsed.titleSize * 0.18);
  const padY = Math.round(26 + geometryUsed.titleSize * 0.12);
  const panel = panelRect(textLayer.box, padX, padY);

  // 4) Foto auf das Pin-Format bringen (EXIF-Rotation beachten) — mit dem
  //    Zuschnitt DIESES Layouts (2026-11-17). Vorher lag für alle fünf Pins
  //    derselbe Ausschnitt (`position: 'centre'`) hier, deshalb sahen die fünf
  //    Pins wie ein Bild mit fünf Texten aus.
  //    Seit 2026-11-23 schneiden die Muster A/B am PRODUKT zu: `productCrop`
  //    misst Aufmerksamkeit + Leerfläche und prüft beide Regeln; erfüllt kein
  //    Kandidat beide, gibt es kein Bild (fail-closed).
  let productCropReport: ProductCropReport | null = null;
  let crop: PinCrop;
  if (!input.crop && layoutSpec.productCrop) {
    productCropReport = await chooseProductCrop(sharp, input.photo, { panel });
    if (!productCropReport.ok) {
      throw new PinRenderError('crop_rejected', productCropReport.note);
    }
    crop = normalizeCrop(productCropReport.crop, layoutCrop(layout));
  } else {
    crop = normalizeCrop(input.crop, layoutCrop(layout));
  }
  const base = await cropToPinFrame(sharp, input.photo, crop);

  /**
   * 5) Text + Fläche für EINE Textfarbe zusammensetzen und den Kontrast am
   *    FERTIGEN Hintergrund messen (Foto + Fläche). Aufgerufen wird das für die
   *    gewählte Farbe und — nur wenn ihr Kontrast nicht reicht — für die
   *    besser lesbaren Varianten.
   */
  const composeWith = async (color: string) => {
    const layer =
      color === requestedTextColor
        ? textLayer
        : await measureInk(
            sharp,
            Buffer.from(
              textLayerSvg(
                { ...input, overlay: { ...(input.overlay ?? {}), textColor: color } },
                geometryUsed,
              ),
            ),
          );
    const panelColor = panelColorFor(color);
    const scrimPng = await sharp(
      Buffer.from(scrimLayerSvg(input, geometryUsed, panel, brandLayer?.box ?? null, panelColor)),
    )
      .png()
      .toBuffer();
    const bgPng = await sharp(base)
      .composite([{ input: scrimPng, top: 0, left: 0 }])
      .png()
      .toBuffer();
    const { data, info } = await sharp(bgPng)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const contrast = measureContrast(
      { raw: data, channels: info.channels },
      brandLayer ? [layer, brandLayer] : [layer],
    );
    return { color, layer, panelColor, scrimPng, contrast };
  };

  // 5) Kontrast: RETTEN statt ablehnen (2026-11-22, Owner-Regel „Bild einmal
  //    berechnet, Bearbeiten frei"). Reicht die gewählte Textfarbe nicht, gibt
  //    es KEINEN Abbruch und kein verlorenes Bild: der Renderer setzt die
  //    besser lesbare Variante (nächstbessere Textfarbe + passende Textfläche)
  //    und meldet das sichtbar. Die Überschrift wird dabei NIE gekürzt — sie
  //    ist zu diesem Zeitpunkt bereits vollständig gesetzt und geprüft.
  let chosen = await composeWith(requestedTextColor);
  const requestedContrast = chosen.contrast.min;
  if (chosen.contrast.min < MIN_TEXT_CONTRAST) {
    for (const candidate of readableTextColors(requestedTextColor, brandPrimary, layoutPanel)) {
      const next = await composeWith(candidate);
      if (next.contrast.min > chosen.contrast.min) chosen = next;
      if (chosen.contrast.min >= MIN_TEXT_CONTRAST) break;
    }
  }
  const textColor = chosen.color;
  const panelColor = chosen.panelColor;
  const scrimPng = chosen.scrimPng;
  const contrast = chosen.contrast;
  const textLayerUsed = chosen.layer;
  const contrastAdjusted = textColor.toLowerCase() !== requestedTextColor.toLowerCase();
  const contrastNotice = contrastAdjusted
    ? contrast.min >= MIN_TEXT_CONTRAST
      ? `Kontrast angepasst, damit der Text lesbar bleibt: die gewählte Textfarbe ${requestedTextColor.toUpperCase()} erreichte ${contrastText(requestedContrast)}:1 (nötig ${contrastText(MIN_TEXT_CONTRAST)}:1), gesetzt wurde ${textColor.toUpperCase()} mit ${contrastText(contrast.min)}:1.`
      : `Kontrast angepasst, damit der Text lesbar bleibt: auch die besser lesbare Textfarbe ${textColor.toUpperCase()} erreicht nur ${contrastText(contrast.min)}:1 (nötig ${contrastText(MIN_TEXT_CONTRAST)}:1). Bitte ein anderes Layout oder einen anderen Bildausschnitt wählen.`
    : null;

  // 6) Endbild zusammensetzen.
  const layers: { input: Buffer; top: number; left: number }[] = [
    { input: scrimPng, top: 0, left: 0 },
    { input: textLayerUsed.png, top: 0, left: 0 },
  ];
  if (brandLayer) layers.push({ input: brandLayer.png, top: 0, left: 0 });

  /** Tatsächliche Logoplatzierung im Pin — Beleg für die SPEC-Grenzen. */
  let logoPlacement: { top: number; left: number; width: number; height: number } | null = null;

  // 6b) Optionales Logo (Brand Kit 2026-11-16). Regeln der SPEC §3:
  //     Seitenverhältnis erhalten, höchstens 26 % der Pin-Breite und 10 % der
  //     Pin-Höhe, Rand 40 px, unten rechts, ÜBER Foto und Textfläche.
  //     Ein unlesbares Logo ist ein Fehler und wird NICHT stillschweigend
  //     weggelassen — sonst behauptet der Pin eine Marke, die nicht drauf ist.
  if (input.logo && input.logo.length > 0) {
    const placed = await placeLogo(sharp, input.logo, [textLayer.box, brandLayer?.box ?? null]);
    logoPlacement = { top: placed.top, left: placed.left, width: placed.width, height: placed.height };
    layers.push({ input: placed.png, top: placed.top, left: placed.left });
  }

  let png: Buffer;
  try {
    png = await sharp(base).composite(layers).png({ compressionLevel: 9 }).toBuffer();
  } catch (err) {
    throw new PinRenderError('render_failed', (err as Error).message);
  }

  // 7) Ausgabe fail-closed prüfen: 1000 × 1500 PNG, sonst kein Ergebnis.
  const outMeta = await sharp(png).metadata();
  if (outMeta.format !== 'png' || outMeta.width !== PIN_WIDTH || outMeta.height !== PIN_HEIGHT) {
    throw new PinRenderError(
      'wrong_dimensions',
      `Ausgabe ist ${outMeta.format} ${outMeta.width}×${outMeta.height}, erwartet png ${PIN_WIDTH}×${PIN_HEIGHT}.`,
    );
  }

  return {
    png,
    width: PIN_WIDTH,
    height: PIN_HEIGHT,
    bytes: png.length,
    textPixels: textLayerUsed.pixels,
    minContrast: contrast.min,
    textColor,
    requestedTextColor,
    requestedContrast,
    panelColor,
    contrastAdjusted,
    contrastNotice,
    fontScale,
    titleLineCount: geometryUsed.titleLines.length,
    subtitleLineCount: geometryUsed.subtitleLines.length,
    wordsComplete:
      textIsComplete(input.title || '', geometryUsed.titleLines) &&
      (input.subtitle ? textIsComplete(input.subtitle, geometryUsed.subtitleLines) : true),
    sharpVersion: String(versions.sharp ?? 'unbekannt'),
    libvips: String(versions.vips ?? 'unbekannt'),
    layout,
    crop,
    productCrop: productCropReport,
    panel,
    logo: logoPlacement,
  };
}


// ── Gemeinsame Text-Passungs-Prüfung (2026-11-18) ────────────────────────────
// ANLASS: 3 von 4 Läufen des Knopfs „Pin-Bild erstellen" lieferten kein Bild
// (`text_overflow`), obwohl das KI-Bild bereits erzeugt und bezahlt war.
//
// Deshalb läuft DIESER Mess-Lauf jetzt VOR dem KI-Aufruf. Es ist derselbe, den
// `renderPinPng` beim Setzen des Textes ausführt (`fitTextLayer`) — es gibt
// kein zweites, abweichendes Verfahren, das auseinanderlaufen könnte.
//
// Die Prüfung erzeugt KEIN Bild, kostet nichts und bucht keine Einheit.

/** Text-Felder, die die Passung bestimmen (Foto/Kontrast spielen keine Rolle). */
export type PinTextInput = Pick<
  PinRenderInput,
  'title' | 'subtitle' | 'layout' | 'brand' | 'brandLine' | 'overlay'
>;

export type PinTextFitCode =
  | 'ok'
  | 'text_overflow'
  | 'text_escaped'
  | 'font_missing'
  | 'text_truncated';

export interface PinTextFitInput {
  title: string;
  subtitle?: string | null;
  layout: PinLayoutId;
  brand?: PinBrand | null;
  brandLine?: string | null;
  /** Schriftwahl des Nutzers (2026-11-23) — sie ändert die Messung. */
  fontId?: PinFontId | null;
}

export interface PinTextFitResult {
  /** Passt der Text auf das gewählte Layout? */
  fits: boolean;
  code: PinTextFitCode;
  /** Klartext-Grund (derselbe Wortlaut wie der Renderer-Fehler), sonst null. */
  message: string | null;
  /** Schriftstufe, auf der der Text passt (1 = volle Größe). */
  scale: number | null;
  titleLineCount: number;
  /** Der tatsächlich geprüfte Text (Escape-Reste aufgelöst). */
  checkedTitle: string;
  /**
   * Kürzungsvorschlag: die LÄNGSTE Fassung an Wortgrenze, die nachweislich
   * passt — deterministisch bestimmt, ohne KI-Aufruf. null = kein Vorschlag
   * möglich (einzelnes Wort, oder selbst ein Wort passt nicht).
   */
  suggestion: string | null;
}

type FitOutcome =
  | { ok: true; geometry: TextGeometry; layer: MeasuredLayer; scale: number }
  | { ok: false; code: 'font_missing' | 'text_overflow'; message: string };

/**
 * Der eine Mess-Lauf: sucht die größte Schriftstufe, auf der der Text in den
 * sicheren Rand UND in die Textfläche des Layouts passt. Gibt bei „passt nicht"
 * den Grund zurück, statt zu werfen — damit die Vorabprüfung ihn anzeigen kann.
 */
async function fitTextLayer(sharp: SharpFactory, input: PinTextInput): Promise<FitOutcome> {
  for (const scale of FIT_SCALES) {
    const g = geometry({ ...input, layout: input.layout } as PinRenderInput, scale);
    const measured = await measureInk(sharp, Buffer.from(textLayerSvg(input as PinRenderInput, g)));
    if (measured.pixels < 200) {
      return {
        ok: false,
        code: 'font_missing',
        message: `Text-Overlay zeichnet nichts (${measured.pixels} Pixel) — im Laufzeit-Image fehlt eine Schrift.`,
      };
    }
    const padX = Math.round(28 + g.titleSize * 0.18);
    const padY = Math.round(26 + g.titleSize * 0.12);
    const insideStripe = g.spec.stripe ? measured.box.right + padX <= g.spec.stripe.solid - 6 : true;
    // Motivschutz: die Fläche (Textbox + Sicherheitsabstand) muss vollständig
    // unterhalb der Bandgrenze liegen — sonst nächste, kleinere Schriftstufe.
    const bandTop = g.spec.bandTopFrac ? Math.round(PIN_HEIGHT * g.spec.bandTopFrac) : 0;
    const insideBand = measured.box.top - padY >= bandTop;
    if (boxFitsSafeArea(measured.box) && insideStripe && insideBand) {
      return { ok: true, geometry: g, layer: measured, scale };
    }
  }
  return {
    ok: false,
    code: 'text_overflow',
    message:
      'Der Text passt auch verkleinert nicht in den sicheren Rand oder in die Textfläche des Pins.',
  };
}

/** Passt dieser Text vollständig gesetzt (kein Wort verloren) aufs Layout? */
async function textFitsCompletely(sharp: SharpFactory, input: PinTextInput): Promise<boolean> {
  const outcome = await fitTextLayer(sharp, input);
  if (!outcome.ok) return false;
  return (
    textIsComplete(input.title || '', outcome.geometry.titleLines) &&
    (input.subtitle ? textIsComplete(input.subtitle, outcome.geometry.subtitleLines) : true)
  );
}

/**
 * Kürzungsvorschlag: längste Fassung des Titels, die an einer WORTGRENZE endet
 * und nachweislich passt. Binärsuche; das Ergebnis wird zum Schluss noch einmal
 * gemessen — der zurückgegebene Text passt also immer selbst.
 */
async function longestFittingPrefix(
  sharp: SharpFactory,
  input: PinTextInput,
): Promise<string | null> {
  const words = (input.title || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length < 2) return null;
  let lo = 1;
  let hi = words.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = words.slice(0, mid).join(' ');
    if (await textFitsCompletely(sharp, { ...input, title: candidate })) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 1) return null;
  const raw = words.slice(0, best).join(' ');
  // Ein Satzzeichen/Bindestrich am Ende ist kein Inhalt — weg damit, aber nur
  // wenn die gekürzte Fassung danach nachweislich weiterhin passt.
  const trimmed = raw.replace(/[\s,;:.–—-]+$/u, '').trim();
  if (trimmed && trimmed !== raw && (await textFitsCompletely(sharp, { ...input, title: trimmed }))) {
    return trimmed;
  }
  return raw;
}

/**
 * Vorabprüfung des Pin-Textes gegen das GEWÄHLTE Layout — VOR jedem KI-Aufruf.
 * Prüft in derselben Reihenfolge wie `renderPinPng`: Escape-Reste, Schrift-
 * Coverage, Passung, Wortvollständigkeit. Kein Bild, keine Einheit, keine Kosten.
 */
export async function checkPinTextFit(input: PinTextFitInput): Promise<PinTextFitResult> {
  const layout: PinLayoutId = isPinLayoutId(input.layout) ? input.layout : 'bottom-left';
  const title = resolveEscapes(input.title) ?? '';
  const subtitle = resolveEscapes(input.subtitle);
  const brandLine = resolveEscapes(input.brandLine);
  const brand = input.brand ?? null;
  const base: PinTextInput = {
    title,
    subtitle,
    brandLine,
    brand,
    layout,
    overlay: { fontId: input.fontId ?? null },
  };

  const blocked = (
    code: PinTextFitCode,
    message: string | null,
    suggestion: string | null = null,
  ): PinTextFitResult => ({
    fits: false,
    code,
    message,
    scale: null,
    titleLineCount: 0,
    checkedTitle: title,
    suggestion,
  });

  if (!title.trim()) return blocked('text_overflow', 'Der Pin hat keinen Text.');

  // Escape-Reste: derselbe fail-closed-Riegel wie im Renderer.
  const escaped = findResidualEscape([title, subtitle, brandLine]);
  if (escaped !== null) {
    return blocked(
      'text_escaped',
      `Der Text enthält einen Escape-Rest (Backslash) und wird nicht ins Bild gesetzt: ${escaped.slice(0, 80)}`,
    );
  }

  // Die Schrift wird vom Aufrufer bereitgestellt (pin-server.ts, im Handler —
  // ein Import von pin-font hier würde die Client-Bündelung mit node:fs
  // brechen). `assertGlyphsRenderable` prüft, dass sie wirklich da ist.
  const sharp = await getSharp();

  // Schrift-Coverage: fehlt ein Zeichen, entstünden leere Kästchen.
  // Geprüft wird jede Familie gegen den Text, den sie setzt (2026-11-23:
  // eigene Schriftpaare je Design, Schriftwahl des Nutzers gilt für beide).
  try {
    const spec = LAYOUTS[layout];
    const titleFamily = isPinFontId(input.fontId)
      ? PIN_FONT_STACKS[input.fontId]
      : effectiveFontFamily(brand, spec);
    assertGlyphsRenderable(titleFamily, [title, brandLine]);
    assertGlyphsRenderable(effectiveSubtitleFontFamily(base as PinRenderInput, spec), [subtitle]);
  } catch (err) {
    return blocked('font_missing', (err as Error).message);
  }

  const outcome = await fitTextLayer(sharp, base);
  if (outcome.ok) {
    const complete =
      textIsComplete(title, outcome.geometry.titleLines) &&
      (subtitle ? textIsComplete(subtitle, outcome.geometry.subtitleLines) : true);
    if (!complete) {
      return blocked(
        'text_truncated',
        'Der Text würde unvollständig gesetzt — es fehlen Wörter. Kein Bild.',
      );
    }
    return {
      fits: true,
      code: 'ok',
      message: null,
      scale: outcome.scale,
      titleLineCount: outcome.geometry.titleLines.length,
      checkedTitle: title,
      suggestion: null,
    };
  }

  const suggestion =
    outcome.code === 'text_overflow' ? await longestFittingPrefix(sharp, base) : null;
  return blocked(outcome.code, outcome.message, suggestion);
}
