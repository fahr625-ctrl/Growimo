// ─────────────────────────────────────────────────────────────────────────────
// Brand Kit (2026-11-16) — Schriftauswahl: die kuratierte Liste
// ─────────────────────────────────────────────────────────────────────────────
// Der Nutzer wählt in der Oberfläche eine von drei Familien. Bewusst eine
// KURATIERTE Liste statt freiem Font-Upload: jede Familie ist lizenzsicher
// (SIL OFL 1.1 / Bitstream-Vera-Lizenz), liegt eingebettet im Servermodul
// (pin-font.ts richtet fontconfig darauf ein) und ist auf denselben Zeichensatz
// beschnitten. Damit sieht der Pin im Browser, im PNG und im ZIP gleich aus —
// ohne Web-Font-Download im Client und ohne Fremdlizenz-Risiko.
//
// Diese Datei enthält NUR Namen und CSS-Ketten (kein Base64), damit sie auch
// von pin-render.ts importiert werden kann, ohne die Schriftdaten zu ziehen.
// ─────────────────────────────────────────────────────────────────────────────

/** Wählbare Schrift. `''` und `'sans'` = das bisherige Verhalten. */
export type PinFontId = 'sans' | 'serif' | 'mono';

/** Reihenfolge = Reihenfolge in der Oberfläche. */
export const PIN_FONT_IDS: PinFontId[] = ['sans', 'serif', 'mono'];

/**
 * CSS-Kette je Familie. Die eingebettete Schrift steht immer zuerst — die
 * Systemschriften danach sind nur Rückfall für die lokale Entwicklung.
 * `sans` ist ZEICHENGLEICH zur bisherigen Kette (Bestandsverhalten: ohne
 * Schriftwahl muss der Pin Byte für Byte derselbe bleiben).
 */
export const PIN_FONT_STACKS: Record<PinFontId, string> = {
  sans: '"Liberation Sans", "DejaVu Sans", "Noto Sans", Arial, Helvetica, sans-serif',
  serif: '"Liberation Serif", "DejaVu Serif", Georgia, "Times New Roman", serif',
  mono: '"Liberation Mono", "DejaVu Sans Mono", "Courier New", Courier, monospace',
};

/** Familienname, wie er IN den eingebetteten Dateien steht. */
export const PIN_FONT_FAMILY_NAMES: Record<PinFontId, string> = {
  sans: 'Liberation Sans',
  serif: 'Liberation Serif',
  mono: 'Liberation Mono',
};

/** Ist der Wert eine wählbare Schrift? (leer/unbekannt ⇒ false) */
export function isPinFontId(value: unknown): value is PinFontId {
  return value === 'sans' || value === 'serif' || value === 'mono';
}

/**
 * Schriftwahl → CSS-Kette. Leer, unbekannt oder `sans` ergibt die bisherige
 * Kette; ein unbekannter Wert wird NICHT geraten, sondern fällt auf Standard.
 */
export function pinFontStack(fontId: string | null | undefined): string {
  return isPinFontId(fontId) ? PIN_FONT_STACKS[fontId] : PIN_FONT_STACKS.sans;
}
