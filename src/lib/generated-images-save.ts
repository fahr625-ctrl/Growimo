// ─────────────────────────────────────────────────────────────────────────────
// K4-B — Identitätsauflösung für die Bildspeicherung (fail-soft)
// ─────────────────────────────────────────────────────────────────────────────
// `generated_images.user_id` erwartet die `users.id` (UUID) — NICHT die Clerk-ID
// (Dokumentierte Falle, DESIGN-FREEZE §4: usage_monthly/usage_events speichern
// TEXT-Clerk-IDs, generated_images speichert die UUID).
//
// Anders als in den HTTP-Routen (die fail-closed 401 antworten) ist diese
// Funktion FAIL-SOFT: sie wird im Bild-Erzeugungspfad aufgerufen, wo die
// bezahlte Generierung schon gelaufen ist. Fehlt die users-Zeile oder ist die DB
// kurz nicht erreichbar, wird NICHT gespeichert — der Lauf und das Bild in der
// Sitzung bleiben aber unversehrt (Hausregel: kein stiller Verlust eines
// bezahlten Outputs).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** clerk_id → users.id (UUID) oder `null` (dann wird nicht gespeichert). */
export async function tryResolveUserId(clerkId: string | null | undefined): Promise<string | null> {
  if (!clerkId) return null;
  try {
    const { ensureUserRow } = await import('../db/queries');
    const id = await ensureUserRow(clerkId);
    return UUID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}
