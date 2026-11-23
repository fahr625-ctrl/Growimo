import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/designs')({
  head: () => ({
    meta: [
      { title: 'Fünf Pin-Designs — Growimo' },
      { name: 'robots', content: 'noindex,follow' },
    ],
  }),
  component: DesignsPage,
});

/**
 * Fünf eigenständige Pin-Designs (2026-11-23).
 *
 * Alle Bilder sind echte Renderer-Ausgaben (`renderPinPng`, sharp,
 * deterministisch): kein KI-Aufruf, keine Einheit, 0 €, nichts live. Je Design
 * steht das Bild in seiner eigenen Farbwelt UND dieselbe Gestaltung in einer
 * neutralen Farbwelt (Anthrazit/Weiß) daneben — der Nachweis, dass die
 * Gestaltung nicht an einer warmen Kerzen-Palette hängt.
 */
interface Design {
  datei: string;
  name: string;
  art: 'ruhig' | 'auffällig';
  beschreibung: string;
  produktarten: string;
  schrift: string;
  farbwelt: string;
  position: string;
  flaeche: string;
}

const DESIGNS: Design[] = [
  {
    datei: 'editorial',
    name: 'Editorial',
    art: 'ruhig',
    beschreibung:
      'Serif-Überschrift mit Sans-Unterzeile auf einer hellen Fläche im unteren Drittel; einziger Akzent ist eine feine Haarlinie. Kein Rahmen, keine Großbuchstaben.',
    produktarten: 'Schmuck, Keramik, Kosmetik, Prints, digitale Downloads',
    schrift: 'Serif + Sans',
    farbwelt: 'helle Fläche, dunkler Text, Akzent Graphit',
    position: 'unten links, Fläche bis zur Unterkante',
    flaeche: 'randloses Band mit weichem Verlauf oben + Haarlinie',
  },
  {
    datei: 'galerie',
    name: 'Galerie',
    art: 'ruhig',
    beschreibung:
      'Sans-Überschrift mit Serif-Unterzeile, zentriert auf einer schwebenden weißen Karte mit feiner Innenlinie — wie ein Passepartout auf dem Foto.',
    produktarten: 'Prints, Fotokunst, digitale Downloads, Schmuck, Keramik',
    schrift: 'Sans + Serif',
    farbwelt: 'weiße Karte, dunkler Text, Akzent Kühlgrau',
    position: 'unten mittig, Karte berührt keine Kante',
    flaeche: 'schwebende Karte mit Haarlinien-Rahmen',
  },
  {
    datei: 'atelier',
    name: 'Atelier',
    art: 'ruhig',
    beschreibung:
      'Serif-Überschrift mit Mono-Eyebrow: die Unterzeile steht über der Überschrift, auf einem Papierband mit schräger Oberkante. Ein kurzer Akzentstrich leitet die Zeile ein.',
    produktarten: 'Keramik, Möbel, Taschen, Werkstatt- und Manufaktur-Produkte',
    schrift: 'Serif + Mono (Unterzeile als Eyebrow)',
    farbwelt: 'kühles Papier, dunkler Text, Akzent Blaugrau',
    position: 'unten links, Unterzeile ÜBER der Überschrift',
    flaeche: 'Papierband mit schräger Oberkante + Akzentstrich',
  },
  {
    datei: 'signal',
    name: 'Signal',
    art: 'auffällig',
    beschreibung:
      'Fette Sans in Großbuchstaben mit Sperrung und Mono-Unterzeile auf einer schwebenden dunklen Leiste. Das einzige Farbelement ist ein schmaler Akzentbalken mit Quadrat — der frühere große Farbblock ist weg.',
    produktarten: 'Kleidung, Kosmetik, Socken, Deko mit klarer Botschaft',
    schrift: 'Sans in Großbuchstaben + Mono',
    farbwelt: 'dunkle Leiste, weiße Schrift, Akzent Signalrot',
    position: 'unten links, Leiste randabständig und schwebend',
    flaeche: 'schwebende Leiste + Balken und Quadrat (kein Block)',
  },
  {
    datei: 'kontrast',
    name: 'Kontrast',
    art: 'auffällig',
    beschreibung:
      'Mono-Überschrift in Großbuchstaben, rechtsbündig unten rechts auf einem weichen dunklen Verlauf in der Ecke; an der rechten Bildkante ein schmales Akzentband. Plakativ, ohne Farbfläche.',
    produktarten: 'Prints, Poster, digitale Downloads, Streetwear, Gadgets',
    schrift: 'Mono in Großbuchstaben + Sans',
    farbwelt: 'dunkler Eckverlauf, weiße Schrift, Akzent Blau',
    position: 'unten rechts, rechtsbündig',
    flaeche: 'weicher Eckverlauf ohne harte Kante + Band an der Bildkante',
  },
];

function DesignsPage() {
  const [gross, setGross] = useState<string | null>(null);

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10 text-neutral-900">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold sm:text-3xl">Fünf Pin-Designs</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-700">
          Alle Bilder sind echte Ausgaben des Pin-Renderers (1000 × 1500 px): kein KI-Aufruf, keine
          Einheit, nichts veröffentlicht. Derselbe Text bei allen fünf, damit der Unterschied an der
          Gestaltung liegt: „Handgefertigte Unikate aus der Werkstatt" mit „Jedes Stück ein
          Einzelstück."
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-700">
          Je Design steht rechts die <strong>neutrale Farbwelt-Probe</strong> (Anthrazit/Weiß, ohne
          jeden warmen Ton) — sie zeigt, dass die Gestaltung nicht an einer Kerzen-Palette hängt.
          Zuschnitt: Das Produkt bleibt vollständig im Bild, keine leere Fläche über 30 Prozent;
          verletzt ein Ausschnitt eine Regel, wird er verworfen.
        </p>

        <div className="mt-8 space-y-10">
          {DESIGNS.map((d) => (
            <section key={d.datei} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-bold">{d.name}</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    d.art === 'ruhig' ? 'bg-neutral-100 text-neutral-600' : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {d.art}
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-700">
                {d.beschreibung}
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {(['farbwelt', 'neutral'] as const).map((variante) => {
                  const datei = `${d.datei}-${variante}-1000x1500.png`;
                  return (
                    <figure key={datei}>
                      <button
                        type="button"
                        onClick={() => setGross(datei)}
                        className="block w-full cursor-zoom-in"
                        title="Groß ansehen"
                      >
                        <img
                          src={`/design-bilder/${datei}`}
                          alt={`${d.name} (${variante === 'neutral' ? 'neutrale Farbwelt' : 'eigene Farbwelt'})`}
                          width={1000}
                          height={1500}
                          className="h-auto w-full rounded-lg"
                        />
                      </button>
                      <figcaption className="mt-1 text-[11px] text-neutral-500">
                        {variante === 'neutral' ? 'Neutrale Farbwelt-Probe (Anthrazit/Weiß)' : 'Eigene Farbwelt des Designs'}
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
              <dl className="mt-3 grid gap-1 text-[13px] text-neutral-700 sm:grid-cols-2">
                <div>
                  <dt className="inline font-semibold">Schriftpaar: </dt>
                  <dd className="inline">{d.schrift}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Farbwelt: </dt>
                  <dd className="inline">{d.farbwelt}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Textposition: </dt>
                  <dd className="inline">{d.position}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Flächenform: </dt>
                  <dd className="inline">{d.flaeche}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="inline font-semibold">Gedacht für: </dt>
                  <dd className="inline">{d.produktarten}</dd>
                </div>
              </dl>
            </section>
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
            src={`/design-bilder/${gross}`}
            alt="Pin-Design in voller Größe"
            className="max-h-full max-w-full rounded-lg"
          />
        </div>
      ) : null}
    </main>
  );
}
