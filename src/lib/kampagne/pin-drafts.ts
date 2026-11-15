// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Kampagne: fünf Pin-Entwürfe aus EINEM Foto
// ─────────────────────────────────────────────────────────────────────────────
// Fünf Layouts × fünf Botschaften. Beides wird AUSSCHLIESSLICH aus den
// Nutzerangaben gebildet (Produkt, Zielgruppe, Kernbotschaft) — es gibt keine
// KI im Spiel und es wird nichts erfunden: keine Größen, Formate, Materialien,
// keine Versprechen. Neutrale Verbindungswörter („Für", „Gedacht für") sind
// Sprache, keine Behauptung über das Produkt.
//
// Jeder Entwurf ist im UI einzeln bearbeitbar (Overlay-Text, Position, Farbe,
// Titel, Beschreibung) — die hier erzeugten Werte sind der Startpunkt.
// ─────────────────────────────────────────────────────────────────────────────

import { isPinLayoutId, safeHexColor, type PinAlign, type PinLayoutId } from './pin-render';

/** Pinterest-Grenzen (belegt 2026-11-11): Titel 100, Beschreibung 800. */
export const PIN_TITLE_MAX = 100;
export const PIN_DESCRIPTION_MAX = 800;
export const PIN_HEADLINE_MAX = 90;
export const PIN_SUBLINE_MAX = 120;

export interface PinDraft {
  /** Stabile Kennung ('pin-1' … 'pin-5'). */
  id: string;
  layout: PinLayoutId;
  /** Overlay-Haupttext. */
  headline: string;
  /** Overlay-Untertext (darf leer sein). */
  subline: string;
  /** Textfarbe des Overlays (Hex). */
  textColor: string;
  /** Ausrichtung des Overlays. */
  align: PinAlign;
  /** Vertikale Verschiebung (−0.35 … 0.35 der Pin-Höhe). */
  offsetY: number;
  /** Pinterest-Titel (≤ 100 Zeichen). */
  title: string;
  /** Pinterest-Beschreibung (≤ 800 Zeichen). */
  description: string;
}

export interface PinSource {
  product: string;
  audience: string;
  message: string;
}

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Wörter, die am Ende nichts mehr aussagen — nach dem Kürzen entfernen. */
const DANGLING = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einen', 'einem',
  'und', 'oder', 'aber', 'für', 'mit', 'ohne', 'in', 'im', 'am', 'an', 'auf', 'aus',
  'bei', 'zu', 'zum', 'zur', 'von', 'vom', 'ist', 'sind', 'wird', 'werden', 'sich',
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'of', 'to', 'in', 'on', 'at', 'is',
]);

/** Hängende Füllwörter/Satzzeichen am Ende entfernen. */
function trimDangling(text: string): string {
  let parts = clean(text).replace(/[,;:\-–—]+$/, '').split(' ').filter(Boolean);
  while (parts.length > 1) {
    const last = parts[parts.length - 1].toLowerCase().replace(/[,;:]+$/, '');
    if (DANGLING.has(last)) parts = parts.slice(0, -1);
    else break;
  }
  return parts.join(' ').replace(/[,;:\-–—]+$/, '');
}

/** Auf `max` Zeichen kürzen — an Wortgrenzen, ohne hängende Füllwörter. */
function clip(text: string, max: number): string {
  const v = clean(text);
  if (v.length <= max) return trimDangling(v);
  const cut = v.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Kein brauchbarer Schnittpunkt ⇒ das (lange) Wort bleibt ganz.
  const base = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return trimDangling(base);
}

/** Satzende garantieren (vermeidet „….." wenn der Nutzer schon punktet). */
function sentence(text: string): string {
  const v = clean(text);
  if (!v) return '';
  return /[.!?]$/.test(v) ? v : `${v}.`;
}

/**
 * Fünf Entwürfe: gleiche Quelle, unterschiedliche Layouts UND unterschiedliche
 * Botschaften. Die fünf Paare sind bewusst verschieden:
 *  1 Produkt → Kernbotschaft   2 Kernbotschaft → Produkt   3 Zielgruppe → Botschaft
 *  4 Kurzform (Produkt) → Zielgruppe   5 Kernbotschaft → Zielgruppe
 */
export function buildPinDrafts(source: PinSource): PinDraft[] {
  const P = clean(source.product);
  const A = clean(source.audience);
  const M = clean(source.message);

  // Textmengen passend zur Kapazität des jeweiligen Layouts
  // (Zeichen pro Zeile × Zeilen — siehe LAYOUTS in pin-render.ts).
  const pHead = clip(P, 60); // 3 Zeilen à 22
  const pShort = clip(P, 34); // große Typo im Seitenstreifen
  const pSub = clip(P, 68); // 2 Zeilen à 34/36
  const mHead = clip(M, 60);
  const mSub = clip(M, 58);
  const aHead = A ? clip(`Für ${A}`, 52) : pHead;
  const aSub = clip(A, 44);

  const titleFor = (...parts: string[]): string =>
    clip(parts.filter(Boolean).join(' – '), PIN_TITLE_MAX);

  return [
    // 1 — Produkt-Fokus, klassisch unten links.
    {
      id: 'pin-1',
      layout: 'bottom-left',
      headline: pHead || mHead,
      subline: mSub || clip(A, 60),
      textColor: '#ffffff',
      align: 'left',
      offsetY: 0,
      title: titleFor(pHead, A ? clip(A, 30) : ''),
      description: clip(
        [sentence(P), sentence(M), A ? `Für ${sentence(A)}` : ''].filter(Boolean).join(' '),
        PIN_DESCRIPTION_MAX,
      ),
    },
    // 2 — Kernbotschaft im Kopfbalken.
    {
      id: 'pin-2',
      layout: 'top-band',
      headline: mHead || pHead,
      subline: pSub,
      textColor: '#ffffff',
      align: 'left',
      offsetY: 0,
      title: titleFor(M ? clip(M, 50) : '', pHead),
      description: clip(
        [sentence(M) || sentence(P), sentence(P), A ? `Gedacht für ${sentence(A)}` : '']
          .filter(Boolean)
          .join(' '),
        PIN_DESCRIPTION_MAX,
      ),
    },
    // 3 — Zielgruppe, zentriert in der Karte.
    {
      id: 'pin-3',
      layout: 'center-card',
      headline: aHead,
      subline: mSub || pSub,
      textColor: '#ffffff',
      align: 'center',
      offsetY: 0,
      title: titleFor(pHead, M ? clip(M, 40) : ''),
      description: clip(
        [A ? `Für ${sentence(A)}` : '', sentence(P), sentence(M)].filter(Boolean).join(' '),
        PIN_DESCRIPTION_MAX,
      ),
    },
    // 4 — Kurzform: große Typografie im Seitenstreifen, wenig Text.
    {
      id: 'pin-4',
      layout: 'side-stripe',
      headline: pShort || clip(M, 30),
      subline: aSub,
      textColor: '#ffffff',
      align: 'left',
      offsetY: 0,
      title: titleFor(pShort, A ? clip(A, 34) : ''),
      description: clip(
        [sentence(P), A ? sentence(A) : '', sentence(M)].filter(Boolean).join(' '),
        PIN_DESCRIPTION_MAX,
      ),
    },
    // 5 — Kernbotschaft + Zielgruppe, reduziert unten.
    {
      id: 'pin-5',
      layout: 'minimal-frame',
      headline: mHead || pHead,
      subline: A ? clip(`Für ${A}`, 80) : pSub,
      textColor: '#ffffff',
      align: 'center',
      offsetY: 0,
      title: titleFor(M ? clip(M, 45) : pHead, pHead),
      description: clip(
        [sentence(M), sentence(P), A ? `Für ${sentence(A)}` : ''].filter(Boolean).join(' '),
        PIN_DESCRIPTION_MAX,
      ),
    },
  ];
}

function clampOffset(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-0.35, Math.min(0.35, Math.round(n * 100) / 100));
}

/**
 * Entwürfe aus dem Client prüfen und begrenzen (fail-closed, keine
 * ungeprüften Werte in DB oder Renderer). Reihenfolge und Layout bleiben
 * erhalten, fehlende Felder werden aufgefüllt.
 */
export function sanitizePinDrafts(input: unknown, source?: PinSource): PinDraft[] {
  if (!Array.isArray(input)) return [];
  const fallback = source ? buildPinDrafts(source) : [];
  const out: PinDraft[] = [];
  for (let i = 0; i < input.length && i < 5; i++) {
    const raw = (input[i] ?? {}) as Partial<PinDraft>;
    const base = fallback[i];
    const layout: PinLayoutId = isPinLayoutId(raw.layout)
      ? raw.layout
      : (base?.layout ?? 'bottom-left');
    const align: PinAlign = raw.align === 'center' ? 'center' : raw.align === 'left' ? 'left' : (base?.align ?? 'left');
    out.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 24) : `pin-${i + 1}`,
      layout,
      headline: clip(typeof raw.headline === 'string' ? raw.headline : (base?.headline ?? ''), PIN_HEADLINE_MAX),
      subline: clip(typeof raw.subline === 'string' ? raw.subline : (base?.subline ?? ''), PIN_SUBLINE_MAX),
      textColor: safeHexColor(typeof raw.textColor === 'string' ? raw.textColor : null, '#ffffff'),
      align,
      offsetY: clampOffset(raw.offsetY),
      title: clip(typeof raw.title === 'string' ? raw.title : (base?.title ?? ''), PIN_TITLE_MAX),
      description: clip(
        typeof raw.description === 'string' ? raw.description : (base?.description ?? ''),
        PIN_DESCRIPTION_MAX,
      ),
    });
  }
  return out;
}
