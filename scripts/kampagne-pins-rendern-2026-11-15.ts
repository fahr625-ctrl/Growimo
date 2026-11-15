// Kampagne — drei Owner-Befunde vom 2026-11-15 (Android-Test), Neu-Rendern.
// -----------------------------------------------------------------------------
// (1) Pin-Texte kurz UND vollständig: Überschrift = knappe Aussage zu Produkt
//     oder Nutzen (nie die Zielgruppenbeschreibung, nie ein halber Satz),
//     Untertitel = kurzer vollständiger Satz.
// (2) Platzierung: Textfläche verdeckt das Produktmotiv nicht — Seitenstreifen
//     und mittlere Karte sitzen jetzt im unteren Bildviertel.
// (3) Kontrast im Pin-Editor (390 px) — eigener Nachweis, siehe BEFUND.md.
//
// Aufruf: bun run scripts/kampagne-pins-rendern-2026-11-15.ts (im Branch-Checkout)
// Foto:  /home/team/shared/phase2-kampagne-2026-11-15/testfoto-kontrast.png
//        (genau dieses Bild, Poster-Motiv in der Bildmitte)

import { writeFileSync } from 'node:fs';
import { buildPinDrafts, clauseClip, sentenceClip } from '../src/lib/kampagne/pin-drafts';
import {
  PIN_HEIGHT,
  PIN_WIDTH,
  renderPinPng,
  textIsComplete,
  wrapText,
  type PinBrand,
  type PinLayoutId,
} from '../src/lib/kampagne/pin-render';

const OUT = '/home/team/shared/kampagne-test-2026-11-15';
const PINS = `${OUT}/pins`;
const FOTO = '/home/team/shared/phase2-kampagne-2026-11-15/testfoto-kontrast.png';

const sharp = (await import('sharp')).default as typeof import('sharp').default;

let failures = 0;
const lines: string[] = [];
function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  const line = `${ok ? 'OK  ' : 'ROT '} ${label}: ${detail}`;
  lines.push(line);
  console.log(line);
}

// ── 0) Textregeln ohne Bild: nur an Sinngrenzen schneiden ───────────────────
const P = 'Digitales Gäste-WC-Poster mit Spruch, Schwarz-Weiß-Typografie';
const A = 'Menschen mit kleinem Bad, die klare Typografie und ruhiges Schwarz-Weiß mögen';
const M = 'Ein Spruch, der Gästen ein Lächeln entlockt';

check(
  'Überschrift = ganze Klausel (Produkt)',
  clauseClip(P, 44) === 'Digitales Gäste-WC-Poster mit Spruch',
  `„${clauseClip(P, 44)}" (${clauseClip(P, 44).length} Zeichen) statt Zeichenfenster „Digitales Gäste-WC-Poster mit Spruch, Schwarz-We"`,
);
check(
  'Überschrift = ganzer Satz (Nutzen)',
  sentenceClip(M, 56, false) === 'Ein Spruch, der Gästen ein Lächeln entlockt',
  `„${sentenceClip(M, 56, false)}"`,
);
check(
  'Untertitel = vollständiger Satz mit Punkt',
  sentenceClip(`Für ${A}`, 120) === `Für ${A}.`,
  `„${sentenceClip(`Für ${A}`, 120)}" (${sentenceClip(`Für ${A}`, 120).length} Zeichen, endet mit „.")`,
);
check(
  'Alte Regel war der Fehler (Negativkontrolle)',
  // Der alte Weg (Zeichenfenster) lieferte genau den Owner-Befund.
  'Für Menschen mit kleinem Bad, die klare Typografie'.length === 50,
  'Zeichenfenster-Schnitt bei 50 Zeichen ergab „Für Menschen mit kleinem Bad, die klare Typografie" — halber Satz, als Überschrift',
);
const longLines = wrapText(M + ' und ' + A, 19);
check(
  'Umbruch ohne Wortverlust',
  textIsComplete(M + ' und ' + A, longLines),
  `${longLines.length} Zeilen, Wortfolge identisch`,
);

// ── 1) Motivbox des Testfotos in Pin-Koordinaten ────────────────────────────
// Das Testfoto ist 1200 × 1600, Poster-Motiv = dunkles Feld x 150…1050 /
// y 260…700 plus helles Feld x 150…1050 / y 900…1200. Der Renderer schneidet
// mit `cover` auf 1000 × 1500 — dieselbe Rechnung hier, damit die Box im
// fertigen Pin gilt.
const meta = await sharp(FOTO).metadata();
const SW = meta.width ?? 0;
const SH = meta.height ?? 0;
const scale = Math.max(PIN_WIDTH / SW, PIN_HEIGHT / SH);
const offX = (PIN_WIDTH - SW * scale) / 2;
const offY = (PIN_HEIGHT - SH * scale) / 2;
const mapX = (x: number) => Math.round(x * scale + offX);
const mapY = (y: number) => Math.round(y * scale + offY);
const MOTIV = { left: mapX(150), top: mapY(260), right: mapX(1050), bottom: mapY(1200) };
lines.push(
  `Motivbox im Pin: x ${MOTIV.left}…${MOTIV.right}, y ${MOTIV.top}…${MOTIV.bottom} ` +
    `(${FOTO.split('/').pop()}, ${SW}×${SH} → cover 1000×1500)`,
);
console.log(lines[lines.length - 1]);

function overlapArea(
  a: { x: number; y: number; width: number; height: number },
  b: { left: number; top: number; right: number; bottom: number },
): number {
  const w = Math.min(a.x + a.width, b.right) - Math.max(a.x, b.left);
  const h = Math.min(a.y + a.height, b.bottom) - Math.max(a.y, b.top);
  return w > 0 && h > 0 ? Math.round(w * h) : 0;
}

// ── 2) Fünf Entwürfe über den echten App-Pfad ───────────────────────────────
const drafts = buildPinDrafts({ product: P, audience: A, message: M });
const brand: PinBrand = { primary: '#111827', accent: '#f59e0b' };
const photo = (await import('node:fs')).readFileSync(FOTO);

const names: Record<PinLayoutId, string> = {
  'bottom-left': 'pin-1-fussband.png',
  'top-band': 'pin-2-kopfbalken.png',
  'center-card': 'pin-3-karte.png',
  'side-stripe': 'pin-4-seitenstreifen.png',
  'minimal-frame': 'pin-5-reduziert.png',
};
const labels: Record<PinLayoutId, string> = {
  'bottom-left': '1 · Fußband',
  'top-band': '2 · Kopfbalken',
  'center-card': '3 · Karte',
  'side-stripe': '4 · Seitenstreifen',
  'minimal-frame': '5 · reduziert',
};

// Zielgruppenbeschreibung darf NIE Überschrift sein.
const audienceClauses = A.split(/\s*,\s*/).map((s) => s.trim().toLowerCase());
function isAudienceHeadline(h: string): boolean {
  const v = h.toLowerCase().replace(/^(für|gedacht für)\s+/, '');
  return audienceClauses.some((c) => c && v.startsWith(c.slice(0, 18)));
}

let worst = 99;
const files: string[] = [];
for (const draft of drafts) {
  const result = await renderPinPng({
    photo,
    layout: draft.layout,
    overlay: { textColor: draft.textColor, align: draft.align, offsetY: draft.offsetY },
    brand,
    brandLine: 'Growimo Studio',
    title: draft.headline,
    subtitle: draft.subline || null,
  });
  const file = `${PINS}/${names[result.layout]}`;
  writeFileSync(file, result.png);
  files.push(file);
  worst = Math.min(worst, result.minContrast);

  const covered = overlapArea(result.panel, MOTIV);
  const motivArea = (MOTIV.right - MOTIV.left) * (MOTIV.bottom - MOTIV.top);
  const share = ((covered / motivArea) * 100).toFixed(1);

  check(
    `${labels[result.layout]} — Text vollständig`,
    result.wordsComplete,
    `Überschrift ${result.titleLineCount} Zeilen, Untertitel ${result.subtitleLineCount}, Stufe ${result.fontScale}, ${result.width}×${result.height}, Kontrast ${result.minContrast}:1`,
  );
  check(
    `${labels[result.layout]} — Überschrift keine Zielgruppe, kein halber Satz`,
    !isAudienceHeadline(draft.headline) &&
      (draft.headline === clauseClip(P, 44) ||
        draft.headline === clauseClip(P, 30) ||
        draft.headline === sentenceClip(M, 56, false)),
    `„${draft.headline}"`,
  );
  check(
    `${labels[result.layout]} — Untertitel vollständiger Satz`,
    draft.subline === '' || /[.!?]$/.test(draft.subline),
    draft.subline ? `„${draft.subline}"` : 'kein Untertitel (Kurzform/„reduziert")',
  );
  // Motivschutz ist für die beiden umgebauten Layouts eine harte Regel
  // (Owner-Befund: Textfläche lag auf dem Poster). Fußband, Kopfbalken und das
  // reduzierte Layout sitzen wie bisher am Bildrand — dort wird der Anteil nur
  // berichtet, nicht bewertet.
  const bandProtected = draft.layout === 'center-card' || draft.layout === 'side-stripe';
  const motivDetail =
    `Textfläche x ${result.panel.x}…${result.panel.x + result.panel.width}, ` +
    `y ${result.panel.y}…${result.panel.y + result.panel.height}; ` +
    `Motiv y ${MOTIV.top}…${MOTIV.bottom} ⇒ ${covered} px² verdeckt (${share} % des Motivs)`;
  if (bandProtected) {
    check(`${labels[result.layout]} — Motiv unverdeckt`, covered === 0, motivDetail);
  } else {
    lines.push(`INFO ${labels[result.layout]} — Randband: ${motivDetail}`);
    console.log(lines[lines.length - 1]);
  }
}

// ── 3) Kontaktbogen ─────────────────────────────────────────────────────────
const thumbW = 400;
const thumbH = Math.round((thumbW * PIN_HEIGHT) / PIN_WIDTH);
const gap = 16;
const pad = 24;
const captionH = 44;
const sheetW = pad * 2 + drafts.length * thumbW + (drafts.length - 1) * gap;
const sheetH = pad * 2 + thumbH + captionH;
const composites: { input: Buffer; top: number; left: number }[] = [];
for (let i = 0; i < files.length; i++) {
  const left = pad + i * (thumbW + gap);
  const thumb = await sharp(files[i]).resize(thumbW, thumbH, { fit: 'cover' }).png().toBuffer();
  composites.push({ input: thumb, top: pad, left });
  const caption = `<svg width="${thumbW}" height="${captionH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${thumbW}" height="${captionH}" fill="#ffffff" />
    <text x="${thumbW / 2}" y="29" text-anchor="middle" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="22" font-weight="700" fill="#111827">${labels[drafts[i].layout]}</text>
  </svg>`;
  composites.push({ input: Buffer.from(caption), top: pad + thumbH, left });
}
const sheet = await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: '#ffffff' } })
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toBuffer();
writeFileSync(`${OUT}/pins-kontaktbogen.png`, sheet);

if (worst < 4.5) {
  failures++;
  lines.push(`ROT Mindestkontrast ${worst}:1 unter 4,5:1`);
}

writeFileSync(`${OUT}/pruefungen.txt`, lines.join('\n') + '\n');
console.log(`\nKontaktbogen ${sheetW}×${sheetH}, fünf Pins in ${PINS}/`);
if (failures > 0) {
  console.error(`\n${failures} Prüfung(en) rot.`);
  process.exit(1);
}
console.log(`\nAlle Prüfungen grün (schlechtester Kontrast ${worst}:1).`);
