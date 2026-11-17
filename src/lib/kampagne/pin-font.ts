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
// Ob es wirklich gewirkt hat, prüft danach `assertGlyphsRenderable()` in
// pin-render.ts gegen die Glyphen-Coverage aus pin-font-coverage.ts — diese
// Datei behauptet nichts, sie bereitet nur vor.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  PIN_FONT_BOLD_B64,
  PIN_FONT_MONO_BOLD_B64,
  PIN_FONT_MONO_REGULAR_B64,
  PIN_FONT_REGULAR_B64,
  PIN_FONT_SERIF_BOLD_B64,
  PIN_FONT_SERIF_REGULAR_B64,
} from './pin-font-data';
import { PIN_FONT_FAMILY_NAMES, type PinFontId } from './pin-fonts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Familienname, wie er IN der eingebetteten Datei steht (Liberation Sans). */
export const PIN_FONT_FAMILY = PIN_FONT_FAMILY_NAMES.sans;

const BASE = join(tmpdir(), 'growimo-pin-fonts');
const FONT_DIR = join(BASE, 'fonts');
const CACHE_DIR = join(BASE, 'cache');
const CONF = join(BASE, 'fonts.conf');

/**
 * Brand Kit (2026-11-16): alle drei wählbaren Familien liegen im SELBEN
 * fontconfig-Verzeichnis. Ein Wechsel der Schriftwahl braucht damit keinen
 * Neustart und keinen zweiten Konfigurationspfad — es wird nur ein anderer
 * Familienname im SVG gesetzt.
 */
const FILES: { name: string; b64: string; fontId: PinFontId }[] = [
  { name: 'LiberationSans-Regular.ttf', b64: PIN_FONT_REGULAR_B64, fontId: 'sans' },
  { name: 'LiberationSans-Bold.ttf', b64: PIN_FONT_BOLD_B64, fontId: 'sans' },
  { name: 'LiberationSerif-Regular.ttf', b64: PIN_FONT_SERIF_REGULAR_B64, fontId: 'serif' },
  { name: 'LiberationSerif-Bold.ttf', b64: PIN_FONT_SERIF_BOLD_B64, fontId: 'serif' },
  { name: 'LiberationMono-Regular.ttf', b64: PIN_FONT_MONO_REGULAR_B64, fontId: 'mono' },
  { name: 'LiberationMono-Bold.ttf', b64: PIN_FONT_MONO_BOLD_B64, fontId: 'mono' },
];

/** Dateinamen der eingebetteten Schnitte je Familie (Regular, Bold). */
export function pinFontFileNames(fontId: PinFontId): string[] {
  return FILES.filter((f) => f.fontId === fontId).map((f) => f.name);
}

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
