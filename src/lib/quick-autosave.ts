// ─────────────────────────────────────────────────────────────────────────────
// Auto-Save nach erfolgreicher Einzel-Generierung (Owner-Entscheid 2026-10-18, K3)
// ─────────────────────────────────────────────────────────────────────────────
// Problem (Launch-Test 2026-10-13, Befund K3): Ein bezahlter Einzel-Output aus
// dem Quick-Generator (Blog / Pinterest / Etsy) lebte ausschließlich im
// React-State von QuickGenerator.tsx. Ohne Klick auf „In Projekt speichern"
// verlor ein Reload das komplette Ergebnis — die verbrauchte Einheit war weg.
//
// Etablierte Muster im Repo (identische Regel, anderer Aufrufer):
//   · src/lib/package-autosave.ts  (Owner-Entscheid 2026-10-01, 5-Kanal-Paket)
//   · src/routes/app/new-project.tsx (Auto-Save direkt nach dem Kachel-Lauf)
//
// Regeln (bewusst streng, damit nie etwas doppelt entsteht):
//   · genau EINMAL pro Lauf — erst wenn der Lauf abgeschlossen ist (Erfolg)
//   · idempotent — ein bereits gespeicherter Lauf (manuell ODER per Auto-Save)
//     wird nie ein zweites Mal gespeichert; der Button bleibt erhalten, erzeugt
//     aber kein zweites Projekt
//   · KEINE Generierung — der Auto-Save nutzt exakt den Pfad von
//     „In Projekt speichern" (store.saveProject → qSaveProject) und läuft nicht
//     durch den usage-guard, erhöht den Zähler also nicht
//   · JEDE Generierung bekommt ein EIGENES Projekt (Owner-Entscheid 2026-10-18);
//     Verbessern und A/B-Varianten schreiben dank gesetztem Projektbezug über
//     updateChannel in DASSELBE Projekt
//
// Die Datei ist bewusst PUR (keine React-/DOM-/DB-Imports): die Entscheidung ist
// damit ohne Browser, ohne Datenbank und ohne Kosten testbar
// (siehe quick-autosave-test.ts).

export interface QuickAutoSaveState {
  /** Der Generierungslauf ist abgeschlossen und hat ein Ergebnis geliefert. */
  runFinished: boolean;
  /** Es gibt wirklich Inhalt zu speichern (body nicht leer). */
  hasContent: boolean;
  /** Manuell gespeichert ODER Auto-Save für diesen Lauf lief bereits. */
  alreadySaved: boolean;
  /** Ein Speichervorgang ist gerade in Arbeit (Duplikat-Schutz). */
  saveInFlight?: boolean;
}

/**
 * Reine Entscheidung: soll für diesen Lauf automatisch gespeichert werden?
 * `false` bei nicht abgeschlossenem Lauf, bei leerem Inhalt, bei bereits
 * gespeichertem Lauf (Idempotenz / kein Überschreiben des manuell gespeicherten
 * Projekts) und während ein Speichervorgang läuft.
 */
export function shouldAutoSaveQuick(state: QuickAutoSaveState): boolean {
  if (!state.runFinished) return false;
  if (state.saveInFlight) return false;
  if (state.alreadySaved) return false;
  return state.hasContent;
}

/** Anzeige-Zustand des Auto-Save-Hinweises neben dem Speichern-Button. */
export type QuickAutoSaveStatus = 'idle' | 'saving' | 'saved';

/** Maximale Länge des Projektnamens (länger wird mit „..." gekürzt). */
export const QUICK_PROJECT_TITLE_MAX = 60;

/**
 * Projektname einer Einzelgenerierung: Kanal-Label + Kurzform der Idee, z. B.
 * „SEO-Blog: Kerzen aus Sojawachs". Das Label kommt aus dem i18n-System
 * (contentTypeLabel → ct_*-Keys), wird also in beiden Sprachen korrekt benannt.
 * Reine Funktion — ohne i18n-/React-Import testbar.
 */
export function quickProjectTitle(
  channelLabel: string,
  productIdea: string,
  maxLength: number = QUICK_PROJECT_TITLE_MAX,
): string {
  const idea = (productIdea ?? '').replace(/\s+/g, ' ').trim();
  const label = (channelLabel ?? '').trim();
  const base = label && idea ? `${label}: ${idea}` : label || idea;
  if (base.length <= maxLength) return base;
  return base.slice(0, Math.max(0, maxLength - 3)).trimEnd() + '...';
}
