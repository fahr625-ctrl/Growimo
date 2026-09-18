// ── Phase 1 (Stabilisierung, C3) — Vorrang-Logik für die Start-Idee ───────────
// Eine explizit mitgegebene Nutzeridee (?idea= bzw. Dashboard-Karte) schlägt
// IMMER den gespeicherten Entwurf. Der Entwurf wird nur genutzt, wenn keine
// frische Idee vorliegt. Der verdrängte Entwurf wird zurückgegeben, damit die UI
// ihn sichtbar anbieten kann („Entwurf wiederherstellen").
//
// Bewusst reine Funktion (kein localStorage/React) → deterministisch testbar.
export interface IdeaResolution {
  /** Der Wert, der ins Eingabefeld gehört. */
  idea: string;
  /** Der verdrängte Entwurf (nur wenn er sich von der frischen Idee unterscheidet), sonst null. */
  overriddenDraft: string | null;
}

export function resolveInitialIdea(
  queryIdea?: string | null,
  draftIdea?: string | null,
): IdeaResolution {
  const fresh = (queryIdea ?? '').trim();
  const draft = (draftIdea ?? '').trim();
  if (fresh) {
    return { idea: fresh, overriddenDraft: draft && draft !== fresh ? draft : null };
  }
  return { idea: draft, overriddenDraft: null };
}
