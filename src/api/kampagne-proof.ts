// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Nachweis-Route für `sharp` im Vercel-Runtime (SPEC §6)
// ─────────────────────────────────────────────────────────────────────────────
// Zweck: belegen, dass die AUSGELIEFERTE Funktion (dieselbe Datei, die als
// `.vercel/output/functions/render.func/index.mjs` gebaut wird) importieren,
// skalieren, Text + Bild überlagern und PNG exportieren kann.
//
//   GET /api/kampagne/proof      → JSON-Belegkörper (Zahlen, Versionen, Dauer)
//   GET /api/kampagne/proof.png  → das erzeugte 1000 × 1500-PNG
//
// Das Grundbild wird hier aus Vektoren erzeugt (Verlauf + Formen) — es ist KEIN
// KI-Bild und kostet nichts. Es ersetzt nur das Nutzerfoto für den Nachweis.
// Kein Auth-Gate: die Route gibt nichts über Nutzer preis, schreibt nichts und
// liest nichts aus der DB.
// ─────────────────────────────────────────────────────────────────────────────

import { PinRenderError, renderPinPng } from '../lib/kampagne/pin-render';
import { loadSharp } from '../lib/kampagne/sharp-loader';

export const KAMPAGNE_PROOF_PATH = '/api/kampagne/proof';
export const KAMPAGNE_PROOF_PNG_PATH = '/api/kampagne/proof.png';

/** Synthetisches Grundbild (Verlauf + Formen) — kein KI-Bild, keine Kosten. */
async function syntheticPhoto(): Promise<Buffer> {
  const sharp = await loadSharp();
  const svg = `<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e3a8a"/><stop offset="55%" stop-color="#0f766e"/><stop offset="100%" stop-color="#78350f"/>
    </linearGradient></defs>
    <rect width="1200" height="1200" fill="url(#bg)"/>
    <circle cx="380" cy="360" r="230" fill="#f8fafc" fill-opacity="0.25"/>
    <circle cx="860" cy="760" r="300" fill="#0ea5e9" fill-opacity="0.22"/>
    <rect x="0" y="980" width="1200" height="220" fill="#111827" fill-opacity="0.35"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

/** Synthetisches Logo (geometrisch, damit kein Font nötig ist). */
async function syntheticLogo(): Promise<Buffer> {
  const sharp = await loadSharp();
  const svg = `<svg width="320" height="320" xmlns="http://www.w3.org/2000/svg">
    <circle cx="160" cy="160" r="150" fill="#ffffff" fill-opacity="0.92"/>
    <path d="M100 200 L160 90 L220 200 Z" fill="#0f766e"/>
    <rect x="140" y="200" width="40" height="40" fill="#111827"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function handleKampagneProofApi(
  req: Request,
  pathname: string,
): Promise<Response | null> {
  const wantsPng = pathname === KAMPAGNE_PROOF_PNG_PATH;
  if (!wantsPng && pathname !== KAMPAGNE_PROOF_PATH) return null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const startedAt = Date.now();
  try {
    const [photo, logo] = await Promise.all([syntheticPhoto(), syntheticLogo()]);
    const result = await renderPinPng({
      photo,
      logo,
      logoPosition: 'bottom-right',
      logoWidth: 160,
      title: 'Kampagnen-Pin aus eigenem Foto',
      subtitle: '1000 x 1500 px, PNG, Text und Logo als Overlay',
    });

    if (wantsPng) {
      return new Response(new Uint8Array(result.png), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(result.bytes),
          'Cache-Control': 'no-store',
          'X-Growimo-Pin-Width': String(result.width),
          'X-Growimo-Pin-Height': String(result.height),
          'X-Growimo-Pin-Bytes': String(result.bytes),
        },
      });
    }

    return json({
      ok: true,
      // Beweispunkte der SPEC: Import, Resize, Text-/Bild-Overlay, PNG-Export
      steps: ['import', 'resize', 'text-overlay', 'image-overlay', 'png-export'],
      sharpVersion: result.sharpVersion,
      libvips: result.libvips,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      textPixels: result.textPixels,
      durationMs: Date.now() - startedAt,
      nodeVersion: process.version,
    });
  } catch (err) {
    const code = err instanceof PinRenderError ? err.code : 'unexpected';
    const message = err instanceof Error ? err.message : String(err);
    console.error('[kampagne] Pin-Nachweis fehlgeschlagen', code, message);
    return json({ ok: false, code, message, durationMs: Date.now() - startedAt }, 500);
  }
}
