// ─────────────────────────────────────────────────────────────────────────────
// Auto-Save nach vollständigem Paket-Lauf (Owner-Entscheid 2026-10-01)
// ─────────────────────────────────────────────────────────────────────────────
// Problem (Demo-E2E vom 2026-10-01, docs/…/BERICHT.md §„projects = 0"): Ein fertig
// generiertes 5-Kanal-Paket lebte ausschließlich im Browser-State. Ohne Klick auf
// „Als Projekt speichern" blieben projects = 0 und generated_content = 0 — ein
// Reload/Verlassen verlor damit das komplette (im Free-Plan: das gesamte
// Monats-)Kontingent. Dieses Modul entscheidet, wann das Ergebnis automatisch
// persistiert wird.
//
// Regeln (bewusst streng, damit nie etwas doppelt entsteht oder überschrieben wird):
//   · genau EINMAL pro Lauf — erst wenn der Lauf vollständig abgeschlossen ist
//     (alle Kanal-Requests settled), nie während Teilergebnisse eintrudeln
//   · idempotent — ein bereits gespeicherter Lauf (manuell ODER per Auto-Save)
//     wird nie ein zweites Mal gespeichert und nie überschrieben
//   · KEINE Generierung — der Auto-Save nutzt exakt den Pfad von
//     „Als Projekt speichern" (store.saveProject → qSaveProject) und läuft nicht
//     durch den usage-guard, erhöht also den Zähler nicht
//
// Die Datei ist bewusst PUR (keine React-/DOM-/DB-Imports): die Entscheidung ist
// damit ohne Browser, ohne Datenbank und ohne Kosten testbar
// (siehe package-autosave-test.ts).

/**
 * Mindestzahl ERFOLGREICH generierter Kanäle, damit überhaupt etwas zu speichern
 * ist. 1 bedeutet: scheitert ein einzelner Kanal, wird der Rest trotzdem gesichert
 * (bereits verbrauchtes Kontingent darf nicht verloren gehen) — gespeichert wird
 * aber nie ein noch laufender Lauf.
 */
export const MIN_SUCCESSFUL_CHANNELS_TO_AUTOSAVE = 1;

export interface PackageAutoSaveState {
  /** Alle Kanal-Requests dieses Laufs sind abgeschlossen (Erfolg ODER Fehler). */
  runFinished: boolean;
  /** Anzahl erfolgreich generierter Kanäle dieses Laufs. */
  successfulChannels: number;
  /** Manuell gespeichert ODER Auto-Save für diesen Lauf lief bereits. */
  alreadySaved: boolean;
  /** Ein Speichervorgang ist gerade in Arbeit (Duplikat-Schutz). */
  saveInFlight?: boolean;
}

/**
 * Reine Entscheidung: soll für diesen Lauf automatisch gespeichert werden?
 * `false` bei unfertigem Lauf (Teilergebnis), bei bereits gespeichertem Lauf
 * (Idempotenz / kein Überschreiben des manuell gespeicherten Projekts), bei
 * laufendem Speichervorgang und wenn kein einziger Kanal erfolgreich war.
 */
export function shouldAutoSavePackage(state: PackageAutoSaveState): boolean {
  if (!state.runFinished) return false;
  if (state.saveInFlight) return false;
  if (state.alreadySaved) return false;
  return state.successfulChannels >= MIN_SUCCESSFUL_CHANNELS_TO_AUTOSAVE;
}

/** Anzeige-Zustand des Hinweises neben dem Speichern-Button. */
export type PackageAutoSaveStatus = 'idle' | 'saving' | 'saved';

/**
 * Merker für das zuletzt (auto-)gespeicherte Paket. Er ist NUR ein UI-Hinweis,
 * damit nach einem Reload sichtbar bleibt, dass das Paket gesichert wurde — die
 * Persistenz selbst liegt in der DB (projects/generated_content).
 */
export const LAST_SAVED_PACKAGE_STORAGE_KEY = 'growimo_package_last_saved';

export interface LastSavedPackage {
  projectId: string;
  title: string;
  savedAt: string;
  /** true = automatisch gespeichert, false = manuell gespeichert. */
  auto: boolean;
}

/** Parst den Merker fail-closed: kaputter/fehlender Speicher ⇒ kein Hinweis. */
export function parseLastSavedPackage(raw: string | null): LastSavedPackage | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<LastSavedPackage>;
  if (typeof d.projectId !== 'string' || d.projectId.length === 0) return null;
  return {
    projectId: d.projectId,
    title: typeof d.title === 'string' ? d.title : '',
    savedAt: typeof d.savedAt === 'string' ? d.savedAt : '',
    auto: d.auto === true,
  };
}
