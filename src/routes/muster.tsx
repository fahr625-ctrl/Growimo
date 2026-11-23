import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/muster')({
  head: () => ({
    meta: [
      { title: 'Pin-Muster A und B — Growimo' },
      { name: 'robots', content: 'noindex,follow' },
    ],
  }),
  component: MusterPage,
});

/**
 * Zwei Pin-Muster zur Auswahl (2026-11-23).
 *
 * Die vier Bilder sind echte Renderer-Ausgaben (`renderPinPng`, kein KI-Aufruf,
 * 0 €): Muster A „editorial-ruhig" und Muster B „plakativ-werblich", jeweils aus
 * denselben zwei Kampagnen-Bildern. Bewusst eine schlichte Ansichtsseite ohne
 * App-Rahmen: der Owner soll die Bilder groß und zoombar sehen und sich für
 * eines entscheiden.
 */
const BILDER: {
  datei: string;
  muster: string;
  beschreibung: string;
  quelle: string;
  zuschnitt: string;
}[] = [
  {
    datei: 'A-editorial-ruhig-quelle-1.png',
    muster: 'A — editorial-ruhig',
    beschreibung: 'Serif-Überschrift, Creme und Anthrazit, eine feine Haarlinie, sanfter Verlauf im unteren Drittel.',
    quelle: 'Kampagne-Pin 3, Foto-Bereich',
    zuschnitt: 'Motiv vollständig, Zuschnitt 1,15× von unten',
  },
  {
    datei: 'A-editorial-ruhig-quelle-2.png',
    muster: 'A — editorial-ruhig',
    beschreibung: 'Serif-Überschrift, Creme und Anthrazit, eine feine Haarlinie, sanfter Verlauf im unteren Drittel.',
    quelle: 'Kampagne-Grundbild 18.11.',
    zuschnitt: 'Motiv vollständig, volles Bild',
  },
  {
    datei: 'B-plakativ-werblich-quelle-1.png',
    muster: 'B — plakativ-werblich',
    beschreibung: 'Fette Sans, Überschrift in Großbuchstaben mit Sperrung, kräftiger Farbblock mit schräger Kante, Badge.',
    quelle: 'Kampagne-Pin 3, Foto-Bereich',
    zuschnitt: 'Motiv vollständig, Zuschnitt 1,15× von unten',
  },
  {
    datei: 'B-plakativ-werblich-quelle-2.png',
    muster: 'B — plakativ-werblich',
    beschreibung: 'Fette Sans, Überschrift in Großbuchstaben mit Sperrung, kräftiger Farbblock mit schräger Kante, Badge.',
    quelle: 'Kampagne-Grundbild 18.11.',
    zuschnitt: 'Motiv vollständig, volles Bild',
  },
];

function MusterPage() {
  const [gross, setGross] = useState<string | null>(null);

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10 text-neutral-900">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold sm:text-3xl">Zwei Pin-Muster zur Auswahl</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-700">
          Beide Muster sind echte Ausgaben des Pin-Renderers — kein KI-Aufruf, keine Einheit, nichts
          veröffentlicht. Jedes Bild ist 1000 × 1500 px. Der Text ist bei beiden derselbe, damit der
          Unterschied an der Gestaltung liegt: „Handgegossene Sojawachs-Kerzen im Glas" mit „Ein Licht
          für den Feierabend."
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-700">
          Zuschnitt: Das Produkt bleibt vollständig im Bild, und keine leere Fläche über 30 Prozent
          der sichtbaren Fläche — beides wird vor dem Rendern geprüft, ein verletzter Ausschnitt wird
          verworfen.
        </p>

        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          {BILDER.map((bild) => (
            <figure key={bild.datei} className="rounded-2xl bg-white p-4 shadow-sm">
              <button
                type="button"
                onClick={() => setGross(bild.datei)}
                className="block w-full cursor-zoom-in"
                title="Groß ansehen"
              >
                <img
                  src={`/muster-bilder/${bild.datei}`}
                  alt={`${bild.muster}: ${bild.beschreibung}`}
                  width={1000}
                  height={1500}
                  className="h-auto w-full rounded-lg"
                />
              </button>
              <figcaption className="mt-3 text-sm">
                <div className="font-semibold">{bild.muster}</div>
                <div className="mt-1 text-neutral-700">{bild.beschreibung}</div>
                <div className="mt-1 text-neutral-500">
                  Quelle: {bild.quelle} · {bild.zuschnitt}
                </div>
                <a
                  href={`/muster-bilder/${bild.datei}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-neutral-900 underline"
                >
                  In voller Größe öffnen
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>

      {gross ? (
        <div
          role="presentation"
          onClick={() => setGross(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85 p-4"
        >
          <img
            src={`/muster-bilder/${gross}`}
            alt="Pin-Muster in voller Größe"
            className="max-h-full max-w-full rounded-lg"
          />
        </div>
      ) : null}
    </main>
  );
}
