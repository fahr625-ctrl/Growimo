// ─────────────────────────────────────────────────────────────────────────────
// Brand Kit (2026-11-16) — Logo-Vorstufe im Browser
// ─────────────────────────────────────────────────────────────────────────────
// Das Logo wird VOR dem Speichern im Markenprofil verkleinert (dasselbe Muster
// wie `pin-client.ts` für das Foto): längste Kante ≤ 512 px, PNG bei Transparenz,
// sonst JPEG, Data-URL ≤ 300 KB. Der Server rendert das Logo später nur noch
// auf höchstens 26 % der Pin-Breite — 512 px reichen dafür mehrfach.
//
// Größer als 300 KB ⇒ KLARE Meldung. Es wird nichts stillschweigend
// abgeschnitten und nichts stillschweigend verkleinert, was der Nutzer nicht
// sieht. SVG wird abgelehnt: ein SVG müsste erst gerastert werden.
// ─────────────────────────────────────────────────────────────────────────────

/** Längste Kante des gespeicherten Logos. */
export const LOGO_MAX_EDGE = 512;

/** Obergrenze der Data-URL (SPEC §1). */
export const LOGO_MAX_BYTES = 300 * 1024;

/** Akzeptierte Eingabe-MIME-Typen (kein SVG). */
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';

export type LogoErrorCode = 'logo_type' | 'logo_unreadable' | 'logo_too_large';

export type LogoResult =
  | { ok: true; dataUrl: string; width: number; height: number; bytes: number; mime: 'png' | 'jpeg' }
  | { ok: false; code: LogoErrorCode };

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = dataUrl;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

/** Hat die Quelle echte Transparenz? (entscheidet PNG vs. JPEG) */
function hasTransparency(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  try {
    const { data } = ctx.getImageData(0, 0, width, height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) return true;
    }
    return false;
  } catch {
    // Kein Zugriff (z. B. Canvas verunreinigt) — dann lieber PNG (verlustfrei).
    return true;
  }
}

/**
 * Bereitet eine gewählte Datei als Logo-Data-URL vor.
 * Gibt NIE ein zu großes Ergebnis zurück: lieber eine Meldung als ein
 * abgeschnittenes Logo.
 */
export async function prepareLogo(file: File): Promise<LogoResult> {
  const type = (file.type || '').toLowerCase();
  if (type !== 'image/png' && type !== 'image/jpeg' && type !== 'image/webp') {
    return { ok: false, code: 'logo_type' };
  }
  let img: HTMLImageElement;
  try {
    img = await loadImage(await readAsDataUrl(file));
  } catch {
    return { ok: false, code: 'logo_unreadable' };
  }
  const srcW = img.naturalWidth || 0;
  const srcH = img.naturalHeight || 0;
  if (!srcW || !srcH) return { ok: false, code: 'logo_unreadable' };

  const scale = Math.min(1, LOGO_MAX_EDGE / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, code: 'logo_unreadable' };
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const transparent = hasTransparency(ctx, width, height);
  const dataUrl = transparent
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL('image/jpeg', 0.9);
  if (dataUrl.length > LOGO_MAX_BYTES) return { ok: false, code: 'logo_too_large' };

  return {
    ok: true,
    dataUrl,
    width,
    height,
    bytes: dataUrl.length,
    mime: transparent ? 'png' : 'jpeg',
  };
}
