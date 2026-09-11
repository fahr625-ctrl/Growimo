// ── TikTok todayIdea — Content-Richtungen (Owner-Vorgabe, verbindlich) ───────
// Katalog der 10 möglichen Content-Richtungen für „Was soll ich heute posten?".
// Die Richtung wird in CODE gewählt (deterministisch) und als VERBINDLICHES Feld
// in den Nutzer-Prompt injiziert — nicht dem LLM-Zufall überlassen. Die Katalog-
// Reihenfolge ist zugleich die Rotationsreihenfolge: Bei einer erneuten
// Generierung wird die zuletzt verwendete Richtung ausgeschlossen und die
// NÄCHSTE Katalog-Richtung gewählt (keine direkte Wiederholung derselben
// Richtung hintereinander, deterministisch & ohne History-Speicherung).
//
// Dieses Modul ist bewusst dependency-frei (pure), damit es sowohl serverseitig
// (src/ai/tiktok.ts, src/ai/server.ts) als auch clientseitig
// (src/routes/app/tiktok.tsx) importiert werden kann.

/** Verbindlicher Richtungs-Katalog (de, kanonisch) — Reihenfolge = Rotation. */
export const TIKTOK_IDEA_DIRECTIONS = [
  'Problem/Lösung',
  'Konkreter Tipp',
  'Häufiger Fehler',
  'Überraschende Erkenntnis',
  'Vorher/Nachher',
  'Experiment',
  'Storytelling',
  'Mythos',
  'Checkliste',
  'Ergebnis',
] as const;

export type TikTokIdeaDirection = (typeof TIKTOK_IDEA_DIRECTIONS)[number];

/** Englische Entsprechung je Richtung (für den en-System-/User-Prompt). */
export const TIKTOK_DIRECTION_EN: Record<TikTokIdeaDirection, string> = {
  'Problem/Lösung': 'Problem/Solution',
  'Konkreter Tipp': 'Concrete Tip',
  'Häufiger Fehler': 'Common Mistake',
  'Überraschende Erkenntnis': 'Surprising Insight',
  'Vorher/Nachher': 'Before/After',
  'Experiment': 'Experiment',
  'Storytelling': 'Storytelling',
  'Mythos': 'Myth',
  'Checkliste': 'Checklist',
  'Ergebnis': 'Result/Outcome',
};

export function isTiktokIdeaDirection(v: unknown): v is TikTokIdeaDirection {
  return typeof v === 'string' && (TIKTOK_IDEA_DIRECTIONS as readonly string[]).includes(v);
}

/** Deterministische Richtungs-Auswahl für todayIdea.
 *  - previousDirection (letzte verwendete Richtung) → ausgeschlossen, es wird
 *    die NÄCHSTE Katalog-Richtung gewählt (Rotation, wrap-around nach der
 *    letzten Richtung). Dadurch nehmen zwei aufeinanderfolgende Generierungen
 *    garantiert unterschiedliche Richtungen — ohne History-Speicherung.
 *  - fehlt/ungültig → Katalog-Start (erste Richtung).
 *  Fallback ohne Client-Änderung: Wenn der Client nichts sendet, wählt der
 *  Server deterministisch Katalog-Start; sobald ein Client previousDirection
 *  mitschickt, rotiert die Auswahl. */
export function pickTodayIdeaDirection(previousDirection?: string): TikTokIdeaDirection {
  if (isTiktokIdeaDirection(previousDirection)) {
    const idx = TIKTOK_IDEA_DIRECTIONS.indexOf(previousDirection);
    return TIKTOK_IDEA_DIRECTIONS[(idx + 1) % TIKTOK_IDEA_DIRECTIONS.length];
  }
  return TIKTOK_IDEA_DIRECTIONS[0];
}

/** Lokalisierte Richtungs-Bezeichnung (de = kanonisch, en = Übersetzung). */
export function tiktokDirectionLabel(dir: TikTokIdeaDirection, de: boolean): string {
  return de ? dir : (TIKTOK_DIRECTION_EN[dir] ?? dir);
}