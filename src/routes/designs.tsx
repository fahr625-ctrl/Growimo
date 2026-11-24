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
 * Fünf Pin-Designs, Runde 2 (2026-11-24).
 *
 * Alle Bilder sind echte Renderer-Ausgaben (`renderPinPng`, sharp,
 * deterministisch): kein KI-Aufruf, keine Einheit, 0 €, nichts live.
 * Jedes Design steht auf denselben drei vorhandenen Produktbildern (Kerze,
 * Poster im Rahmen, Tasse). Poster und Tasse sind Kompositionen aus eigenen
 * Vorlagen (`composeMockup`): das Grundbild liegt im Passepartout bzw. auf der
 * gemessenen Tassenwand — kein KI-Aufruf, 0 €. Die Tasse ergibt für ALLE fünf
 * Designs kein Bild: der Zuschnitt verletzt die Regel „leere Fläche ≤ 30 %"
 * (bestes Fenster mit vollständiger Tasse: 33,5 % gemessen) — fail-closed,
 * dokumentiert statt gelockert.
 */
interface Variante {
  label: string;
  datei: string;
}

interface Design {
  id: string;
  name: string;
  art: 'ruhig' | 'auffällig';
  beschreibung: string;
  schrift: string;
  farbwelt: string;
  position: string;
  flaeche: string;
  produktarten: string;
  /** Kerze, Poster, Tasse — in dieser Reihenfolge. */
  bilder: (Variante | null)[];
  /** Vorher/Nachher nur für Signal und Kontrast. */
  vorher?: { titel: string; werte: string[] };
  zusatz?: Variante;
}

const KERZE = { label: 'Kerze', datei: 'kerze' };
const POSTER = { label: 'Poster im Rahmen', datei: 'poster' };

const DESIGNS: Design[] = [
  {
    id: 'editorial',
    name: 'Editorial',
    art: 'ruhig',
    beschreibung:
      'Serif-Überschrift mit Sans-Unterzeile auf einer hellen Fläche im unteren Drittel; einziger Akzent ist eine feine Haarlinie. Kein Rahmen, keine Großbuchstaben.',
    schrift: 'Serif + Sans',
    farbwelt: 'helle Fläche, dunkler Text, Akzent Graphit',
    position: 'unten links, Fläche bis zur Unterkante',
    flaeche: 'randloses Band mit weichem Verlauf oben + Haarlinie',
    produktarten: 'Schmuck, Keramik, Kosmetik, Prints, digitale Downloads',
    bilder: [
      { ...KERZE, datei: 'editorial-kerze-1000x1500.png' },
      { ...POSTER, datei: 'editorial-poster-1000x1500.png' },
      null,
    ],
  },
  {
    id: 'galerie',
    name: 'Galerie',
    art: 'ruhig',
    beschreibung:
      'Sans-Überschrift mit Serif-Unterzeile, zentriert auf einer schwebenden weißen Karte mit feiner Innenlinie — wie ein Passepartout auf dem Foto.',
    schrift: 'Sans + Serif',
    farbwelt: 'weiße Karte, dunkler Text, Akzent Kühlgrau',
    position: 'unten mittig, Karte berührt keine Kante',
    flaeche: 'schwebende Karte mit Haarlinien-Rahmen',
    produktarten: 'Prints, Fotokunst, digitale Downloads, Schmuck, Keramik',
    bilder: [
      { ...KERZE, datei: 'galerie-kerze-1000x1500.png' },
      { ...POSTER, datei: 'galerie-poster-1000x1500.png' },
      null,
    ],
  },
  {
    id: 'atelier',
    name: 'Atelier',
    art: 'ruhig',
    beschreibung:
      'Serif-Überschrift mit Mono-Eyebrow: die Unterzeile steht über der Überschrift, auf einem Papierband mit schräger Oberkante. Ein kurzer Akzentstrich leitet die Zeile ein.',
    schrift: 'Serif + Mono (Unterzeile als Eyebrow)',
    farbwelt: 'kühles Papier, dunkler Text, Akzent Blaugrau',
    position: 'unten links, Unterzeile ÜBER der Überschrift',
    flaeche: 'Papierband mit schräger Oberkante + Akzentstrich',
    produktarten: 'Keramik, Möbel, Taschen, Werkstatt- und Manufaktur-Produkte',
    bilder: [
      { ...KERZE, datei: 'atelier-kerze-1000x1500.png' },
      { ...POSTER, datei: 'atelier-poster-1000x1500.png' },
      null,
    ],
  },
  {
    id: 'signal',
    name: 'Signal',
    art: 'auffällig',
    beschreibung:
      'Fette Sans in Großbuchstaben mit Sperrung und Mono-Unterzeile auf einer schwebenden dunklen Leiste, die nur noch so breit ist wie der Text. Das einzige Farbelement ist ein dünner Akzentbalken mit Quadrat.',
    schrift: 'Sans in Großbuchstaben + Mono',
    farbwelt: 'dunkle Leiste, weiße Schrift, Akzent Signalrot',
    position: 'unten links, Leiste folgt dem Text statt der Bildbreite',
    flaeche: 'schwebende Leiste in Textbreite, ohne Kante + dünner Balken',
    produktarten: 'Kleidung, Kosmetik, Socken, Deko mit klarer Botschaft',
    bilder: [
      { ...KERZE, datei: 'signal-kerze-1000x1500.png' },
      { ...POSTER, datei: 'signal-poster-1000x1500.png' },
      null,
    ],
    vorher: {
      titel: 'Runde 2: Kasten kleiner, Schrift führt',
      werte: [
        'Kastenfläche: 31,1 % der Pin-Fläche (920 × 507 px, volle Breite) → 15,6 % (538 × 436 px, Textbreite)',
        'Innenabstand 24/20 px, Abstand zum Bildrand 56 px — der Rand ist größer als der Kastenrand',
        'Kontrast Text/Kasten unverändert 11,74 : 1 (vorher wie nachher, Schwelle 4,5 : 1)',
        'Akzentbalken 120 × 10 px → 96 × 7 px, Quadrat 20 → 14 px',
      ],
    },
    zusatz: { label: 'Andere Farbwelt (Beleg der Anpassbarkeit)', datei: 'signal-kerze-palette-1000x1500.png' },
  },
  {
    id: 'kontrast',
    name: 'Kontrast',
    art: 'auffällig',
    beschreibung:
      'Mono-Überschrift in Großbuchstaben, rechtsbündig unten rechts auf einer dunklen Fläche, die nur an Ober- und linkem Rand kurz ausläuft; an der rechten Bildkante ein schmales Akzentband. Die Bildmitte bleibt frei.',
    schrift: 'Mono in Großbuchstaben + Sans',
    farbwelt: 'dunkle Fläche (88 % Deckkraft), weiße Schrift, Akzent Blau',
    position: 'unten rechts, rechtsbündig',
    flaeche: 'kurze Auslaufkante oben/links statt Ganzbild-Verlauf + Band',
    produktarten: 'Prints, Poster, digitale Downloads, Streetwear, Gadgets',
    bilder: [
      { ...KERZE, datei: 'kontrast-kerze-1000x1500.png' },
      { ...POSTER, datei: 'kontrast-poster-1000x1500.png' },
      null,
    ],
    vorher: {
      titel: 'Runde 2: Verlauf zurückgenommen, Produkt bleibt hell',
      werte: [
        'Helligkeit im Produktbereich: vorher −27,5 % gegenüber dem Quellbild → nachher 0,1 % (Grenze −12 %)',
        'Fläche: 51,9 % der Pin-Fläche (Verlauf über das ganze Bild) → 20,3 %',
        'Kontrast Text/Fläche: 5,29 : 1 → 9,71 : 1 (Deckkraft 88 %, Schwelle 4,5 : 1)',
      ],
    },
    zusatz: { label: 'Andere Farbwelt (Beleg der Anpassbarkeit)', datei: 'kontrast-kerze-palette-1000x1500.png' },
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
          Einheit, nichts veröffentlicht. Derselbe Text bei allen Bildern, damit der Unterschied an
          der Gestaltung liegt: „Deine Idee, fertig für Pinterest" mit „In wenigen Klicks zum
          eigenen Pin." — bewusst ohne Material-, Herstellungs- oder Mengenangaben.
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-700">
          Jedes Design steht auf drei <strong>vorhandenen</strong> Produktbildern: Kerze, Poster im
          Rahmen, Tasse. Der Zuschnitt wird am Produkt gemessen; verletzt ein Ausschnitt eine Regel
          (Produkt nicht vollständig oder mehr als 30 Prozent leere Fläche), entsteht kein Bild.
        </p>

        <div className="mt-8 space-y-10">
          {DESIGNS.map((d) => (
            <section key={d.id} className="rounded-2xl bg-white p-4 shadow-sm">
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
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-700">{d.beschreibung}</p>

              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                {d.bilder.map((variante, i) => (
                  <figure key={variante?.datei ?? `leer-${i}`}>
                    {variante ? (
                      <button
                        type="button"
                        onClick={() => setGross(variante.datei)}
                        className="block w-full cursor-zoom-in"
                        title="Groß ansehen"
                      >
                        <img
                          src={`/design-bilder-neu/${variante.datei}`}
                          alt={`${d.name} auf ${variante.label}`}
                          width={1000}
                          height={1500}
                          className="h-auto w-full rounded-lg"
                        />
                      </button>
                    ) : (
                      <div className="flex aspect-[2/3] items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4 text-center text-[12px] leading-relaxed text-neutral-600">
                        Tasse: kein Bild. Die Tasse ist vollständig im Bild, aber das beste Fenster lässt
                        33,5 % leere Fläche (Grenze 30 %) — fail-closed.
                      </div>
                    )}
                    <figcaption className="mt-1 text-[11px] text-neutral-500">
                      {variante ? variante.label : 'Tasse — verworfen'}
                    </figcaption>
                  </figure>
                ))}
              </div>

              {d.vorher ? (
                <div className="mt-4 rounded-xl bg-neutral-50 p-3">
                  <p className="text-[13px] font-semibold text-neutral-900">{d.vorher.titel}</p>
                  <ul className="mt-1 list-disc pl-5 text-[13px] leading-relaxed text-neutral-700">
                    {d.vorher.werte.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {d.zusatz ? (
                <figure className="mt-4 max-w-[220px]">
                  <button
                    type="button"
                    onClick={() => setGross(d.zusatz!.datei)}
                    className="block w-full cursor-zoom-in"
                    title="Groß ansehen"
                  >
                    <img
                      src={`/design-bilder-neu/${d.zusatz.datei}`}
                      alt={`${d.name} in anderer Farbwelt`}
                      width={1000}
                      height={1500}
                      className="h-auto w-full rounded-lg"
                    />
                  </button>
                  <figcaption className="mt-1 text-[11px] text-neutral-500">{d.zusatz.label}</figcaption>
                </figure>
              ) : null}

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
            src={`/design-bilder-neu/${gross}`}
            alt="Pin-Design in voller Größe"
            className="max-h-full max-w-full rounded-lg"
          />
        </div>
      ) : null}
    </main>
  );
}
