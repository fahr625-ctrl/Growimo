// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Kampagne: Browser-Hilfen für die Pin-Vorschau
// ─────────────────────────────────────────────────────────────────────────────
// Das Foto wird VOR dem Senden an den Server auf Pin-Maß verkleinert (JPEG).
// Grund: der Server rendert 1000 × 1500 — ein 8-MB-Original bringt keinen
// besseren Pin, kostet aber bei jedem Rendern Übertragungszeit und Speicher.
// Das gespeicherte Original bleibt unberührt; das ist nur die Rendervorstufe.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_W = 1000;
const MAX_H = 1500;

/**
 * Verkleinert ein Data-URL-Foto auf höchstens 1000 × 1500 px (JPEG, q 0.88).
 * Kann der Browser nicht skalieren, wird das Original zurückgegeben — der
 * Server prüft das Bild ohnehin selbst.
 */
export async function downscalePhoto(dataUrl: string): Promise<string> {
  if (typeof document === 'undefined' || !dataUrl) return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image_load_failed'));
      el.src = dataUrl;
    });
    const scale = Math.min(1, MAX_W / (img.naturalWidth || MAX_W), MAX_H / (img.naturalHeight || MAX_H));
    if (scale >= 1 && dataUrl.length < 1_200_000) return dataUrl;

    const w = Math.max(1, Math.round((img.naturalWidth || MAX_W) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || MAX_H) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.88);
  } catch {
    return dataUrl;
  }
}
