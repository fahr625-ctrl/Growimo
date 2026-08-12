// ── F2.1 Feld-Support (pure, client-safe — no heavy imports) ──────────────────
// The UI imports this to decide which issues get a "✨ Automatisch verbessern"
// button. The server module imports it too. Keep this file free of any import
// so the client bundle never pulls in the OpenAI SDK.
//
// Start fields (owner direction 2026-08-12): Pinterest-Titel + Etsy-Beschreibung.
// Extend here for more fields (tags/cta/metaDescription/imagePrompt) — the
// architecture in auto-improve/index.ts is already generic.

export const AUTOIMPROVE_SUPPORTED_FIELDS: Record<string, string[]> = {
  pinterest_pin: ['title'],
  etsy_listing: ['description'],
};

/** true when the field can be auto-improved for this content type (F2.1). */
export function isAutoImproveFieldSupported(contentType: string, field: string): boolean {
  return (AUTOIMPROVE_SUPPORTED_FIELDS[contentType] ?? []).includes(field);
}
