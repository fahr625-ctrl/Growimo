// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — ein einziger Lade-Ort für `sharp` (natives Modul)
// ─────────────────────────────────────────────────────────────────────────────
// WARUM ES DIESE DATEI GIBT (Befund 2026-11-15, Gate-Lauf):
// `sharp` ist ein natives Modul und darf NIE im Client-Bundle landen. Ein
// LITERALER dynamischer Import — `await import(/* @vite-ignore */ 'sharp')` —
// wird von Vite trotzdem statisch aufgelöst, sobald die Datei aus dem
// Client-Graphen erreichbar ist (die Kampagnen-Seite importiert das
// Server-Modul). Ergebnis: `vite build` bricht ab mit
//   "spawnSync" is not exported by "__vite-browser-external"
// und es gibt gar kein Artefakt.
//
// Deshalb wird der Modulname hier zur Laufzeit gebildet: Vite kann ihn nicht
// auflösen und lässt den Import unangetastet. Node/`bun build --target node`
// lösen ihn zur Laufzeit auf — in der ausgelieferten Vercel-Funktion aus
// `render.func/node_modules/sharp` (siehe build-vercel.sh, Schritt [4/5]).
// ─────────────────────────────────────────────────────────────────────────────

export type SharpFactory = typeof import('sharp').default;

const SHARP_MODULE = 'sharp';

/** Lädt `sharp` erst beim ersten Gebrauch (Native-Binding). */
export async function loadSharp(): Promise<SharpFactory> {
  const mod = (await import(/* @vite-ignore */ SHARP_MODULE)) as {
    default?: SharpFactory;
  } & SharpFactory;
  return (mod.default ?? mod) as SharpFactory;
}
