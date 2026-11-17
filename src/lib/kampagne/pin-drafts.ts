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

import {
  isPinLayoutId,
  layoutCrop,
  normalizeCrop,
  safeHexColor,
  type PinAlign,
  type PinCrop,
  type PinLayoutId,
} from './pin-render';

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
  /**
   * Eigener Bildausschnitt (2026-11-17). `null`/fehlt = der Zuschnitt des
   * Layouts (`PIN_LAYOUT_CROPS`) gilt. So sind die fünf Pins von sich aus
   * verschieden, und der Nutzer kann je Pin nachjustieren.
   */
  crop?: PinCrop | null;
}

export interface PinSource {
  product: string;
  audience: string;
  message: string;
}

export function clean(text: string | null | undefined): string {
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
export function clip(text: string, max: number): string {
  const v = clean(text);
  if (v.length <= max) return trimDangling(v);
  const cut = v.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Kein brauchbarer Schnittpunkt ⇒ das (lange) Wort bleibt ganz.
  const base = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return trimDangling(base);
}

/** Satzende garantieren (vermeidet „….." wenn der Nutzer schon punktet). */
export function sentence(text: string): string {
  const v = clean(text);
  if (!v) return '';
  return /[.!?]$/.test(v) ? v : `${v}.`;
}

// ── Vollständige Gedanken statt Zeichenfenster (2026-11-15) ──────────────────
// Owner-Befund: „Für Menschen mit kleinem Bad, die klare Typografie" stand als
// Pin-Überschrift — die Zielgruppenbeschreibung UND ein halber Satz. Ursache war
// ein Zeichenfenster (`clip`), das mitten im Gedanken schneidet. Deshalb gibt es
// für Pin-Texte jetzt zwei Bausteine, die nur an SINNGRENZEN schneiden:
//   • `clauseClip`   — ganze Teilstücke (Komma/Semikolon/Gedankenstrich),
//   • `sentenceClip` — ganze Sätze, immer mit Satzzeichen abgeschlossen.
// Reicht schon das erste Teilstück nicht, wird es TROTZDEM ganz genommen: ein
// langer vollständiger Gedanke ist besser als ein kurzer halber. Der Renderer
// bricht um und verkleinert, statt zu kürzen.

/** Grenzen zwischen Teilstücken eines Satzes. */
const CLAUSE_SEP = /\s*[,;:–—]\s*/;

/** Zerlegt in Teilstücke an Komma, Semikolon, Doppelpunkt, Gedankenstrich. */
function splitClauses(text: string): string[] {
  return clean(text)
    .split(CLAUSE_SEP)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Der längste Anfang aus VOLLSTÄNDIGEN Teilstücken, der in `max` Zeichen passt.
 * Nie ein halbes Teilstück — notfalls das erste Teilstück ganz.
 */
export function clauseClip(text: string, max: number): string {
  const v = clean(text);
  if (!v) return '';
  if (v.length <= max) return trimDangling(v);
  const parts = splitClauses(v);
  let out = '';
  for (const part of parts) {
    const candidate = out ? `${out}, ${part}` : part;
    if (candidate.length > max) break;
    out = candidate;
  }
  return out || parts[0] || trimDangling(v);
}

/**
 * Ganze Sätze, die in `max` Zeichen passen — immer mit Satzzeichen am Ende.
 * `keepPeriod: false` für Überschriften (dort steht kein Schlusspunkt).
 * Passt kein ganzer Satz, bleibt der erste Satz vollständig stehen.
 */
export function sentenceClip(text: string, max: number, keepPeriod = true): string {
  const v = clean(text);
  if (!v) return '';
  const full = /[.!?]$/.test(v) ? v : `${v}.`;
  const take = (s: string) => (keepPeriod ? s : s.replace(/[.!?]+$/, ''));
  if (full.length <= max) return take(full);
  const sentences = full.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()).filter(Boolean) ?? [full];
  let out = '';
  for (const s of sentences) {
    const candidate = out ? `${out} ${s}` : s;
    if (candidate.length > max) break;
    out = candidate;
  }
  return take(out || sentences[0]);
}

/**
 * Fünf Entwürfe: gleiche Quelle, unterschiedliche Layouts UND unterschiedliche
 * Botschaften. Jede Überschrift ist eine knappe Aussage zu Produkt oder Nutzen,
 * jeder Untertitel ein vollständiger Satz. Die Zielgruppe steht NIE in der
 * Überschrift (Owner-Befund 2026-11-15) — höchstens als vollständiger Satz im
 * Untertitel.
 *  1 Produkt → Nutzen            2 Nutzen → Zielgruppe
 *  3 Produkt → Zielgruppe        4 Produkt (Kurzform, ohne Untertitel)
 *  5 Nutzen ohne Untertitel (reduziert)
 */
export function buildPinDrafts(source: PinSource): PinDraft[] {
  const P = clean(source.product);
  const A = clean(source.audience);
  const M = clean(source.message);

  // Überschriften: ganze Teilstücke des Nutzertexts, nie ein Zeichenfenster.
  // „Digitales Gäste-WC-Poster mit Spruch, Schwarz-Weiß-Typografie" ⇒
  // „Digitales Gäste-WC-Poster mit Spruch" (36 Zeichen, vollständig).
  const pHead = clauseClip(P, 44);
  // Nutzen-Überschrift: der ganze Satz aus der Kernbotschaft, ohne Schlusspunkt.
  const mHead = sentenceClip(M, 56, false);
  // Untertitel: immer ein vollständiger Satz mit Satzzeichen.
  const mSub = sentenceClip(M, 68);
  const aSub = A ? sentenceClip(`Für ${A}`, PIN_SUBLINE_MAX) : '';

  const titleFor = (...parts: string[]): string =>
    clauseClip(parts.filter(Boolean).join(' – '), PIN_TITLE_MAX);

  return [
    // 1 — Produkt + Nutzen, klassisch unten links.
    {
      id: 'pin-1',
      layout: 'bottom-left',
      headline: pHead || mHead,
      subline: mSub || aSub,
      textColor: '#ffffff',
      align: 'left',
      offsetY: 0,
      title: titleFor(pHead, A ? clauseClip(A, 34) : ''),
      description: clip(
        [sentence(P), sentence(M), A ? `Für ${sentence(A)}` : ''].filter(Boolean).join(' '),
        PIN_DESCRIPTION_MAX,
      ),
    },
    // 2 — Nutzen im Kopfbalken, Zielgruppe als Satz darunter.
    {
      id: 'pin-2',
      layout: 'top-band',
      headline: mHead || pHead,
      subline: aSub || mSub,
      textColor: '#ffffff',
      align: 'left',
      offsetY: 0,
      title: titleFor(mHead, pHead),
      description: clip(
        [sentence(M) || sentence(P), sentence(P), A ? `Gedacht für ${sentence(A)}` : '']
          .filter(Boolean)
          .join(' '),
        PIN_DESCRIPTION_MAX,
      ),
    },
    // 3 — Produkt in der Karte, Zielgruppe als Satz darunter.
    {
      id: 'pin-3',
      layout: 'center-card',
      headline: pHead || mHead,
      subline: aSub || mSub,
      textColor: '#ffffff',
      align: 'center',
      offsetY: 0,
      title: titleFor(pHead, M ? clauseClip(M, 40) : ''),
      description: clip(
        [A ? `Für ${sentence(A)}` : '', sentence(P), sentence(M)].filter(Boolean).join(' '),
        PIN_DESCRIPTION_MAX,
      ),
    },
    // 4 — Kurzform: nur die Produkt-Aussage, große Typografie im Streifen.
    {
      id: 'pin-4',
      layout: 'side-stripe',
      headline: pHead || mHead,
      subline: '',
      textColor: '#ffffff',
      align: 'left',
      offsetY: 0,
      title: titleFor(pHead, A ? clauseClip(A, 34) : ''),
      description: clip(
        [sentence(P), A ? sentence(A) : '', sentence(M)].filter(Boolean).join(' '),
        PIN_DESCRIPTION_MAX,
      ),
    },
    // 5 — Reduziert: nur die Nutzen-Aussage, kein Untertitel.
    {
      id: 'pin-5',
      layout: 'minimal-frame',
      headline: mHead || pHead,
      subline: '',
      textColor: '#ffffff',
      align: 'center',
      offsetY: 0,
      title: titleFor(mHead, pHead),
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
      // Zuschnitt: nur prüfen, nie erfinden. Fehlt/ungültig ⇒ null ⇒ der
      // Zuschnitt des (ggf. neu gewählten) Layouts gilt.
      crop: raw.crop ? normalizeCrop(raw.crop, layoutCrop(layout)) : null,
    });
  }
  return out;
}
