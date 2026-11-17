// ─────────────────────────────────────────────────────────────────────────────
// Brand Kit (2026-11-17) — GLYPHEN-COVERAGE der eingebetteten Pin-Schriften
// ─────────────────────────────────────────────────────────────────────────────
// WARUM (Befund 2026-11-17, SPEC §9): Die alte Tofu-Prüfung verglich Pixel mit
// dem Ersatzzeichen (.notdef). Das kann nicht funktionieren, weil Pango den
// Codepoint selbst INS Kästchen schreibt — jedes fehlende Zeichen sah dadurch
// wie ein vorhandenes aus, und ein Pin mit sichtbarem Kästchen ging durch.
//
// Jetzt wird NICHT gemessen, sondern GELESEN: die belegten Codepoints stehen
// hier als kompakte Ranges, erzeugt direkt aus den Base64-Bytes, die in
// pin-font-data.ts liegen (Erzeuger: scripts/font-coverage.py, cmap-Formate
// 4/12/6/0, Union aus Regular + Bold). Was hier fehlt, kann die Schrift nicht
// zeichnen — dann gibt es kein Bild, sondern `font_missing`.
//
// Die Tabelle ist NICHT handgepflegt: nach jeder Änderung an den Schriftdaten
// neu erzeugen (python3 scripts/font-coverage.py).
// ─────────────────────────────────────────────────────────────────────────────

import { PIN_FONT_FAMILY_NAMES, type PinFontId } from './pin-fonts';

/** Belegte Codepoints je Familie, als Ranges (hex, `A-B` oder `A`). */
export const PIN_FONT_COVERAGE_RANGES: Record<PinFontId, string> = {
  sans:
    '20-7E,A0-FF,2013-2014,2018-201E,2022,2026,20AC,2192',
  serif:
    '20-7E,A0-FF,2013-2014,2018-201E,2022,2026,20AC,2192',
  mono:
    '20-7E,A0-FF,2013-2014,2018-201E,2022,2026,20AC,2192',
};

function parseRanges(spec: string): ReadonlySet<number> {
  const set = new Set<number>();
  for (const part of spec.split(',')) {
    if (!part) continue;
    const [a, b] = part.split('-');
    const from = Number.parseInt(a, 16);
    const to = b ? Number.parseInt(b, 16) : from;
    for (let cp = from; cp <= to; cp++) set.add(cp);
  }
  return set;
}

/** Coverage als Set — einmal je Familie gebaut, danach nur gelesen. */
export const PIN_FONT_COVERAGE: Record<PinFontId, ReadonlySet<number>> = {
  sans: parseRanges(PIN_FONT_COVERAGE_RANGES.sans),
  serif: parseRanges(PIN_FONT_COVERAGE_RANGES.serif),
  mono: parseRanges(PIN_FONT_COVERAGE_RANGES.mono),
};

/**
 * CSS-Kette → Familie. Die eingebettete Familie steht immer an erster Stelle
 * der Kette; ein unbekannter Wert fällt auf `sans` (Bestandsverhalten).
 */
export function pinFontIdFromFamily(family: string | null | undefined): PinFontId {
  const text = (family ?? '').toLowerCase();
  for (const id of ['serif', 'mono'] as PinFontId[]) {
    if (text.includes(PIN_FONT_FAMILY_NAMES[id].toLowerCase())) return id;
  }
  return 'sans';
}

/** U+Nummer für Meldungen — immer mindestens vier Stellen. */
export function codePointLabel(char: string): string {
  const cp = char.codePointAt(0) ?? 0;
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Zeichen, die die Familie NICHT zeichnen kann. Leerraum und Zeilenumbrüche
 * sind keine Fehler; Ersatzzeichen (U+FFFD) gelten als gewollt.
 */
export function missingGlyphs(
  fontId: PinFontId,
  texts: (string | null | undefined)[],
): { char: string; label: string }[] {
  const coverage = PIN_FONT_COVERAGE[fontId];
  const seen = new Set<string>();
  const missing: { char: string; label: string }[] = [];
  for (const text of texts) {
    for (const char of Array.from(text ?? '')) {
      if (/\s/.test(char)) continue;
      if (char === '\uFFFD') continue;
      if (seen.has(char)) continue;
      seen.add(char);
      if (!coverage.has(char.codePointAt(0)!)) missing.push({ char, label: codePointLabel(char) });
    }
  }
  return missing;
}
