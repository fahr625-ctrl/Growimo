/**
 * POST /api/mockup?vorlage=<id> — Etsy-Mockup komponieren (2026-11-24, Vorschau).
 *
 * Body: die Bytes des Designs (image/png, image/jpeg, image/webp) — ROH, nicht
 * als Data-URL und nicht als Base64. Grund: das Vercel-Body-Limit liegt bei
 * 4,5 MB; als Data-URL sind dieselben Bytes 33 % größer, und ein 2,8-MB-PNG
 * sprengt die Grenze schon vor dem Renderer (Befund 2026-11-19 beim Pin-Render).
 * Deshalb: `fetch('/api/mockup?vorlage=…', { method: 'POST', body: blob })`.
 *
 * Antwort: das komponierte PNG (`composeMockup`, `sharp`) plus Messwerte in
 * Kopfzeilen. Kein KI-Aufruf, keine Einheit, 0 €.
 *
 * Fail-closed: unbekannte Vorlage, fehlende Vorlagen-Einbettung, unlesbares
 * Design, zu großes Design oder ein Design, das die Fläche nicht füllt ⇒ kein
 * Bild, sondern eine Meldung im Klartext (JSON `{ fehler }`).
 */

import { createFileRoute } from '@tanstack/react-router';
import sharp from 'sharp';

import { MockupFehler, composeMockup } from '../../lib/mockup/compose';
import { MOCKUP_VORLAGEN, findeVorlage } from '../../lib/mockup/vorlagen';
import { eingebetteteVorlage, mockupVorlagenVerzeichnis } from '../../lib/mockup/vorlagen-einbettung';

/** Obergrenze des Request-Bodys. Gemessen: 4,4 Mio. Zeichen kamen durch, 4,6 nicht. */
export const MOCKUP_BODY_LIMIT_BYTES = 4_400_000;

/** Obergrenze der Design-Pixel (Schutz vor Speicherlast beim Dekodieren). */
const MAX_DESIGN_PIXEL = 40_000_000;

function fehler(status: number, code: string, text: string): Response {
  return new Response(JSON.stringify({ fehler: text, code }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function mb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1).replace('.', ',');
}

export const Route = createFileRoute('/api/mockup')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const id = new URL(request.url).searchParams.get('vorlage') ?? '';
        const katalog = findeVorlage(id);
        if (!katalog) {
          return fehler(
            400,
            'vorlage',
            `Unbekannte Vorlage „${id}". Bekannt: ${MOCKUP_VORLAGEN.map((v) => v.id).join(', ')}. Kein Mockup.`,
          );
        }

        const angekuendigt = Number(request.headers.get('content-length') ?? '0');
        if (Number.isFinite(angekuendigt) && angekuendigt > MOCKUP_BODY_LIMIT_BYTES) {
          return fehler(
            413,
            'limit',
            `Die Datei ist zu groß (${mb(angekuendigt)} MB). Erlaubt sind 4,4 MB. Kein Mockup.`,
          );
        }

        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(await request.arrayBuffer());
        } catch {
          return fehler(400, 'design', 'Die Datei kam nicht vollständig an. Kein Mockup.');
        }
        if (bytes.byteLength === 0) {
          return fehler(400, 'design', 'Es kam keine Datei an. Kein Mockup.');
        }
        if (bytes.byteLength > MOCKUP_BODY_LIMIT_BYTES) {
          return fehler(
            413,
            'limit',
            `Die Datei ist zu groß (${mb(bytes.byteLength)} MB). Erlaubt sind 4,4 MB. Kein Mockup.`,
          );
        }

        try {
          const meta = await sharp(bytes).metadata();
          if (!meta.width || !meta.height) {
            return fehler(422, 'design', 'Die Datei hat keine lesbare Bildgröße. Kein Mockup.');
          }
          if (meta.width * meta.height > MAX_DESIGN_PIXEL) {
            return fehler(
              422,
              'design',
              `Das Design ist zu groß (${String(meta.width)} × ${String(meta.height)} px). Erlaubt sind 40 Megapixel. Kein Mockup.`,
            );
          }
        } catch {
          return fehler(422, 'design', 'Die Datei ist kein lesbares Bild (PNG, JPG oder WebP). Kein Mockup.');
        }

        const vorlageDef = eingebetteteVorlage(katalog);
        if (!vorlageDef) {
          return fehler(
            500,
            'vorlage',
            `Die Vorlage „${katalog.name}" ist im Build nicht eingebettet. Kein Mockup.`,
          );
        }

        try {
          const ergebnis = await composeMockup({
            vorlage: katalog.id,
            vorlageDef,
            vorlagenVerzeichnis: mockupVorlagenVerzeichnis(),
            design: bytes,
          });
          return new Response(new Uint8Array(ergebnis.png), {
            status: 200,
            headers: {
              'Content-Type': 'image/png',
              'Content-Disposition': `inline; filename="mockup-${katalog.id}.png"`,
              'Cache-Control': 'no-store',
              // Messwerte für die Oberfläche — dieselben Zahlen, die das Bild belegen.
              'X-Mockup-Abdeckung': ergebnis.abdeckung.toFixed(4),
              'X-Mockup-Flaeche': `${String(ergebnis.flaechePx.breite)}x${String(ergebnis.flaechePx.hoehe)}`,
              'X-Mockup-Masse': `${String(ergebnis.breite)}x${String(ergebnis.hoehe)}`,
            },
          });
        } catch (error) {
          if (error instanceof MockupFehler) {
            return fehler(422, 'compose', error.message);
          }
          return fehler(500, 'server', 'Das Mockup konnte nicht gerechnet werden. Kein Bild.');
        }
      },
      GET: () =>
        fehler(405, 'method', 'Diese Adresse nimmt nur POST mit den Bild-Bytes des Designs an.'),
    },
  },
});
