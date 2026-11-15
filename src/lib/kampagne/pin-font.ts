// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Kampagne: die eingebettete Schrift für fontconfig bereitstellen
// ─────────────────────────────────────────────────────────────────────────────
// WARUM: librsvg/Pango findet Schriften über fontconfig. In der Vercel-Funktion
// ist kein Schriftverzeichnis vorhanden — ohne eigene Schrift zeichnet librsvg
// für jedes Zeichen ein leeres Kästchen (Befund 2026-11-15). Diese Datei legt
// die eingebettete Schrift in ein beschreibbares Verzeichnis, schreibt eine
// minimale fontconfig-Konfiguration, die NUR dieses Verzeichnis kennt, und
// zeigt fontconfig per `FONTCONFIG_FILE` darauf.
//
// Reihenfolge ist wichtig: `FONTCONFIG_FILE` muss gesetzt sein, BEVOR librsvg
// zum ersten Mal Text zeichnet (fontconfig liest seine Konfiguration einmal).
// Deshalb ruft der Server-Handler `ensurePinFonts()` vor dem ersten Rendern auf.
// Ob es wirklich gewirkt hat, prüft danach `assertFontRenders()` in pin-render.ts
// — diese Datei behauptet nichts, sie bereitet nur vor.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PIN_FONT_BOLD_B64, PIN_FONT_REGULAR_B64 } from './pin-font-data';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Familienname, wie er IN der eingebetteten Datei steht (Liberation Sans). */
export const PIN_FONT_FAMILY = 'Liberation Sans';

const BASE = join(tmpdir(), 'growimo-pin-fonts');
const FONT_DIR = join(BASE, 'fonts');
const CACHE_DIR = join(BASE, 'cache');
const CONF = join(BASE, 'fonts.conf');

const FILES = [
  { name: 'LiberationSans-Regular.ttf', b64: PIN_FONT_REGULAR_B64 },
  { name: 'LiberationSans-Bold.ttf', b64: PIN_FONT_BOLD_B64 },
];

let prepared: Promise<void> | null = null;

/**
 * Legt die Schrift ab und richtet fontconfig darauf ein. Mehrfachaufruf ist
 * billig: nach dem ersten Erfolg wird nur noch das fertige Promise geteilt.
 */
export function ensurePinFonts(): Promise<void> {
  if (!prepared) {
    prepared = prepare().catch((err) => {
      // Nicht dauerhaft merken: der nächste Aufruf darf es erneut versuchen
      // (z. B. wenn /tmp beim ersten Mal voll war).
      prepared = null;
      throw err;
    });
  }
  return prepared;
}

async function prepare(): Promise<void> {
  prepareSync();
}

/**
 * Derselbe Schritt, synchron — gedacht für den Function-Einstieg: fontconfig
 * liest seine Konfiguration, sobald libvips geladen wird. Wer zu spät zeigt,
 * bekommt Tofu. Deshalb steht der Aufruf ganz oben in vercel-entry.ts.
 */
export function prepareSync(): void {
  mkdirSync(FONT_DIR, { recursive: true });
  mkdirSync(CACHE_DIR, { recursive: true });

  for (const file of FILES) {
    const target = join(FONT_DIR, file.name);
    const expected = Buffer.from(file.b64, 'base64');
    // Nur schreiben, wenn die Datei fehlt oder unvollständig ist.
    if (existsSync(target)) {
      try {
        if (readFileSync(target).length === expected.length) continue;
      } catch {
        /* neu schreiben */
      }
    }
    writeFileSync(target, expected);
  }

  const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONT_DIR}</dir>
  <cachedir>${CACHE_DIR}</cachedir>
</fontconfig>
`;
  writeFileSync(CONF, conf);
  process.env.FONTCONFIG_FILE = CONF;
}
