import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { MOCKUP_VORLAGEN, type MockupVorlageId } from '../lib/mockup/vorlagen';
import { useTranslation } from '../i18n';

export const Route = createFileRoute('/mockups')({
  head: () => ({
    meta: [
      { title: 'Etsy-Mockups — Growimo' },
      { name: 'robots', content: 'noindex,follow' },
    ],
  }),
  component: MockupsPage,
});

/** Obergrenze wie im Handler (`src/routes/api/mockup.ts`) — 4,5-MB-Body-Limit. */
const MAX_BYTES = 4_400_000;

/** Längste Kante, auf die im Browser verkleinert wird, wenn eine Datei zu groß ist. */
const MAX_KANTE = 1600;

/** Vorhandene Design-Bilder aus `public/design-bilder-neu/` (nichts Neues erzeugt). */
const DESIGNS: readonly { datei: string; design: string; produkt: 'kerze' | 'poster' }[] = [
  { datei: 'editorial-kerze-1000x1500.png', design: 'Editorial', produkt: 'kerze' },
  { datei: 'editorial-poster-1000x1500.png', design: 'Editorial', produkt: 'poster' },
  { datei: 'atelier-kerze-1000x1500.png', design: 'Atelier', produkt: 'kerze' },
  { datei: 'atelier-poster-1000x1500.png', design: 'Atelier', produkt: 'poster' },
  { datei: 'galerie-kerze-1000x1500.png', design: 'Galerie', produkt: 'kerze' },
  { datei: 'galerie-poster-1000x1500.png', design: 'Galerie', produkt: 'poster' },
  { datei: 'signal-kerze-1000x1500.png', design: 'Signal', produkt: 'kerze' },
  { datei: 'signal-kerze-palette-1000x1500.png', design: 'Signal Palette', produkt: 'kerze' },
  { datei: 'signal-poster-1000x1500.png', design: 'Signal', produkt: 'poster' },
  { datei: 'kontrast-kerze-1000x1500.png', design: 'Kontrast', produkt: 'kerze' },
  { datei: 'kontrast-kerze-palette-1000x1500.png', design: 'Kontrast Palette', produkt: 'kerze' },
  { datei: 'kontrast-poster-1000x1500.png', design: 'Kontrast', produkt: 'poster' },
];

/** Kurzname je Vorlage (die langen Namen stehen weiter in `vorlagen.ts`). */
const VORLAGE_KURZ: Record<MockupVorlageId, string> = {
  'poster-schwarz-passepartout': 'mockups_vorlage_passepartout',
  'poster-eiche': 'mockups_vorlage_eiche',
  'tasse-griff-rechts': 'mockups_vorlage_tasse_hell',
  'tasse-griff-links': 'mockups_vorlage_tasse_dunkel',
};

type Quelle =
  | { art: 'vorhanden'; datei: string; name: string }
  | { art: 'eigen'; datei: File; name: string; vorschau: string };

interface Ergebnis {
  url: string;
  dateiname: string;
  abdeckung: string;
  flaeche: string;
}

function mb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1).replace('.', ',');
}

/** Verkleinert eine zu große Datei im Browser — ohne sie als Data-URL zu verschicken. */
async function begrenze(blob: Blob, zuGross: string, keinCanvas: string): Promise<Blob> {
  if (blob.size <= MAX_BYTES) return blob;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error(zuGross.replace('%s', mb(blob.size)));
  }
  const faktor = Math.min(1, MAX_KANTE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * faktor));
  canvas.height = Math.max(1, Math.round(bitmap.height * faktor));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error(keinCanvas);
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const neu = await new Promise<Blob | null>((fertig) => canvas.toBlob(fertig, 'image/jpeg', 0.92));
  if (!neu) throw new Error(keinCanvas);
  if (neu.size > MAX_BYTES) throw new Error(zuGross.replace('%s', mb(neu.size)));
  return neu;
}

/**
 * Etsy-Mockup-Ablauf (2026-11-24, nur Vorschau).
 *
 * Design wählen (vorhandenes Bild oder eigene Datei) → Vorlage wählen →
 * komponieren lassen. Das Ergebnis entsteht in `src/lib/mockup/compose.ts` mit
 * `sharp`: das Design wird in die aus dem Vorlagenfoto gemessene Produktfläche
 * gelegt und mit dem Foto verrechnet. Kein KI-Aufruf, keine Einheit, 0 €.
 *
 * Die Design-Bytes gehen roh an `POST /api/mockup` (kein Data-URL-Umweg) und
 * werden dort gegen das 4,5-MB-Body-Limit geprüft; zu große Dateien werden
 * vorher im Browser verkleinert.
 */
function MockupsPage() {
  const { t } = useTranslation();
  const [art, setArt] = useState<'vorhanden' | 'eigen'>('vorhanden');
  const [quelle, setQuelle] = useState<Quelle | null>(null);
  const [vorlage, setVorlage] = useState<MockupVorlageId | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [ergebnis, setErgebnis] = useState<Ergebnis | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const laufRef = useRef(false);
  const dateiRef = useRef<HTMLInputElement>(null);
  const vorschauRef = useRef<string | null>(null);
  const ergebnisRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (vorschauRef.current) URL.revokeObjectURL(vorschauRef.current);
      if (ergebnisRef.current) URL.revokeObjectURL(ergebnisRef.current);
    },
    [],
  );

  const designName = useCallback(
    (d: { design: string; produkt: 'kerze' | 'poster' }) =>
      `${d.design} · ${d.produkt === 'kerze' ? t.mockups_design_kerze : t.mockups_design_poster}`,
    [t],
  );

  function waehleVorhanden(datei: string, name: string) {
    if (vorschauRef.current) {
      URL.revokeObjectURL(vorschauRef.current);
      vorschauRef.current = null;
    }
    setQuelle({ art: 'vorhanden', datei, name });
    setFehler(null);
  }

  function waehleDatei(datei: File | null) {
    if (!datei) return;
    if (vorschauRef.current) URL.revokeObjectURL(vorschauRef.current);
    const vorschau = URL.createObjectURL(datei);
    vorschauRef.current = vorschau;
    setQuelle({ art: 'eigen', datei, name: datei.name, vorschau });
    setFehler(null);
  }

  async function erstellen() {
    if (laufRef.current) return;
    if (!quelle || !vorlage) {
      setFehler(t.mockups_need_choice);
      return;
    }
    laufRef.current = true;
    setLaeuft(true);
    setFehler(null);
    try {
      const roh =
        quelle.art === 'vorhanden'
          ? await fetch(`/design-bilder-neu/${quelle.datei}`).then(async (antwort) => {
              if (!antwort.ok) throw new Error(t.mockups_error_design_load);
              return antwort.blob();
            })
          : quelle.datei;
      const bytes = await begrenze(roh, t.mockups_error_too_large, t.mockups_error_no_canvas);

      const antwort = await fetch(`/api/mockup?vorlage=${encodeURIComponent(vorlage)}`, {
        method: 'POST',
        headers: { 'Content-Type': bytes.type || 'application/octet-stream' },
        body: bytes,
      });
      if (!antwort.ok) {
        let text = t.mockups_error_generic;
        try {
          const daten = (await antwort.json()) as { fehler?: string };
          if (daten?.fehler) text = daten.fehler;
        } catch {
          /* keine JSON-Antwort — generische Meldung bleibt */
        }
        throw new Error(text);
      }
      const png = await antwort.blob();
      const url = URL.createObjectURL(png);
      if (ergebnisRef.current) URL.revokeObjectURL(ergebnisRef.current);
      ergebnisRef.current = url;
      const sicher = quelle.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/\.(png|jpe?g|webp)$/i, '');
      setErgebnis({
        url,
        dateiname: `mockup-${vorlage}-${sicher || 'design'}.png`,
        abdeckung: antwort.headers.get('X-Mockup-Abdeckung') ?? '',
        flaeche: antwort.headers.get('X-Mockup-Flaeche') ?? '',
      });
    } catch (error) {
      setErgebnis(null);
      setFehler(error instanceof Error ? error.message : t.mockups_error_generic);
    } finally {
      laufRef.current = false;
      setLaeuft(false);
    }
  }

  const bereit = Boolean(quelle && vorlage) && !laeuft;

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-8 text-neutral-900 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold sm:text-3xl">{t.mockups_flow_title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-700">{t.mockups_flow_intro}</p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed font-medium text-neutral-900">
          {t.mockups_note_composition}
        </p>

        <ol className="mt-8 grid gap-5">
          {/* ── 1 · Design ─────────────────────────────────────────────── */}
          <li className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-semibold sm:text-lg">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white">
                1
              </span>
              {t.mockups_step_design}
            </h2>

            <div className="mt-3 inline-flex rounded-full bg-neutral-100 p-1 text-sm">
              <button
                type="button"
                onClick={() => setArt('vorhanden')}
                aria-pressed={art === 'vorhanden'}
                className={`rounded-full px-3 py-1.5 font-medium ${
                  art === 'vorhanden' ? 'bg-white shadow-sm' : 'text-neutral-600'
                }`}
              >
                {t.mockups_source_existing}
              </button>
              <button
                type="button"
                onClick={() => setArt('eigen')}
                aria-pressed={art === 'eigen'}
                className={`rounded-full px-3 py-1.5 font-medium ${
                  art === 'eigen' ? 'bg-white shadow-sm' : 'text-neutral-600'
                }`}
              >
                {t.mockups_source_upload}
              </button>
            </div>

            {art === 'vorhanden' ? (
              <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {DESIGNS.map((d) => {
                  const name = designName(d);
                  const gewaehlt = quelle?.art === 'vorhanden' && quelle.datei === d.datei;
                  return (
                    <li key={d.datei}>
                      <button
                        type="button"
                        onClick={() => waehleVorhanden(d.datei, name)}
                        aria-pressed={gewaehlt}
                        className={`block w-full overflow-hidden rounded-lg border text-left ${
                          gewaehlt ? 'border-neutral-900 ring-2 ring-neutral-900' : 'border-neutral-200'
                        }`}
                      >
                        <img
                          src={`/design-bilder-neu/${d.datei}`}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="aspect-[2/3] w-full object-cover"
                        />
                        <span className="block px-1.5 py-1 text-[11px] leading-tight text-neutral-600">{name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  ref={dateiRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => waehleDatei(e.target.files?.[0] ?? null)}
                  className="sr-only"
                  id="mockup-datei"
                />
                <button
                  type="button"
                  onClick={() => dateiRef.current?.click()}
                  className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50"
                >
                  {t.mockups_upload_cta}
                </button>
                {quelle?.art === 'eigen' ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={quelle.vorschau}
                      alt={quelle.name}
                      className="h-16 w-12 rounded border border-neutral-200 object-cover"
                    />
                    <span className="text-sm break-all text-neutral-700">{quelle.name}</span>
                  </div>
                ) : (
                  <span className="text-sm text-neutral-500">{t.mockups_upload_none}</span>
                )}
                <p className="text-xs text-neutral-500 sm:ml-auto sm:max-w-xs">{t.mockups_upload_hint}</p>
              </div>
            )}
          </li>

          {/* ── 2 · Vorlage ────────────────────────────────────────────── */}
          <li className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-semibold sm:text-lg">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white">
                2
              </span>
              {t.mockups_step_vorlage}
            </h2>
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
              {MOCKUP_VORLAGEN.map((v) => {
                const gewaehlt = vorlage === v.id;
                const kurz = t[VORLAGE_KURZ[v.id] as keyof typeof t] as string;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setVorlage(v.id);
                        setFehler(null);
                      }}
                      aria-pressed={gewaehlt}
                      className={`block w-full overflow-hidden rounded-lg border text-left ${
                        gewaehlt ? 'border-neutral-900 ring-2 ring-neutral-900' : 'border-neutral-200'
                      }`}
                    >
                      <img
                        src={`/mockup-vorschau/${v.id}-vorlage.png`}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="aspect-square w-full bg-neutral-100 object-cover"
                      />
                      <span className="block px-2 py-1.5">
                        <span className="block text-sm font-medium">{kurz}</span>
                        <span className="block text-[11px] text-neutral-500">{v.name}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>

          {/* ── 3 · Ergebnis ───────────────────────────────────────────── */}
          <li className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-semibold sm:text-lg">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white">
                3
              </span>
              {t.mockups_step_result}
            </h2>

            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => void erstellen()}
                disabled={!bereit}
                className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {laeuft ? t.mockups_creating : t.mockups_create}
              </button>
              <p className="text-xs text-neutral-500">{t.mockups_free}</p>
            </div>

            {fehler ? (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {fehler}
              </p>
            ) : null}

            {ergebnis ? (
              <figure className="mt-4">
                <img
                  src={ergebnis.url}
                  alt={t.mockups_label_result}
                  className="mx-auto block h-auto w-full max-w-[900px] rounded-lg border border-neutral-200"
                />
                <figcaption className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs text-neutral-500">
                    {t.mockups_result_hint}
                    {ergebnis.flaeche
                      ? ` · ${t.mockups_measured}: ${ergebnis.flaeche.replace('x', ' × ')} px`
                      : ''}
                    {ergebnis.abdeckung
                      ? ` · ${t.mockups_coverage}: ${Math.round(Number(ergebnis.abdeckung) * 100)} %`
                      : ''}
                  </span>
                  <a
                    href={ergebnis.url}
                    download={ergebnis.dateiname}
                    className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
                  >
                    {t.mockups_download}
                  </a>
                </figcaption>
              </figure>
            ) : null}
          </li>
        </ol>

        {/* ── Hinweise nach Produktart ─────────────────────────────────── */}
        <section className="mt-8 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-base font-semibold sm:text-lg">{t.mockups_hinweise_title}</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-sm font-medium">{t.mockups_hinweis_handgefertigt_titel}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-neutral-600">
                {t.mockups_hinweis_handgefertigt}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium">{t.mockups_hinweis_pod_titel}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-neutral-600">{t.mockups_hinweis_pod}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium">{t.mockups_hinweis_digital_titel}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-neutral-600">{t.mockups_hinweis_digital}</dd>
            </div>
          </dl>
        </section>

        {/* ── Bisherige Beispiele (aufklappbar, nichts gelöscht) ───────── */}
        <details className="mt-6 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
          <summary className="cursor-pointer text-sm font-medium text-neutral-700">
            {t.mockups_gallery_toggle}
          </summary>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MOCKUP_VORLAGEN.map((v) => (
              <li key={v.id}>
                <img
                  src={`/mockup-vorschau/${v.id}-ergebnis.png`}
                  alt={`${v.name} — ${t.mockups_label_result}`}
                  loading="lazy"
                  decoding="async"
                  className="w-full rounded-lg border border-neutral-200"
                />
                <span className="mt-1 block text-[11px] text-neutral-500">{v.name}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </main>
  );
}
