import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

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

/**
 * Etsy-Mockups als Komposition (2026-11-24), nur Vorschau.
 *
 * Je Vorlage stehen Vorlage und komponiertes Ergebnis nebeneinander. Das
 * Ergebnis entsteht in `src/lib/mockup/compose.ts` mit `sharp`: das Design wird
 * perspektivisch in die aus dem Vorlagenbild gemessene Produktfläche gelegt.
 * Kein KI-Aufruf, keine Einheit, nichts veröffentlicht.
 *
 * Die Bilder in `public/mockup-vorschau/` sind die Ausgabe von
 * `scripts/mockup-vorschau.ts` (dieselbe Datei in voller Auflösung liegt in
 * /home/team/shared/mockups-2026-11-24/).
 */
const MESSWERTE: Record<MockupVorlageId, { flaeche: string; abdeckung: string; design: string }> = {
  'poster-schwarz-passepartout': {
    flaeche: '444 × 614 px',
    abdeckung: '92 %',
    design: 'editorial-farbwelt-1000x1500.png',
  },
  'poster-eiche': {
    flaeche: '483 × 604 px',
    abdeckung: '83 %',
    design: 'galerie-farbwelt-1000x1500.png',
  },
  'tasse-griff-rechts': {
    flaeche: '443 × 556 px',
    abdeckung: '84 %',
    design: 'signal-farbwelt-1000x1500.png',
  },
  'tasse-griff-links': {
    flaeche: '509 × 604 px',
    abdeckung: '79 %',
    design: 'kontrast-farbwelt-1000x1500.png',
  },
};

const NAMEN: Record<MockupVorlageId, string> = {
  'poster-schwarz-passepartout': 'mockups_t1_name',
  'poster-eiche': 'mockups_t2_name',
  'tasse-griff-rechts': 'mockups_t3_name',
  'tasse-griff-links': 'mockups_t4_name',
};

function MockupsPage() {
  const { t } = useTranslation();
  const [gross, setGross] = useState<string | null>(null);

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10 text-neutral-900">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold sm:text-3xl">{t.mockups_title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-700">{t.mockups_intro}</p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed font-medium text-neutral-900">
          {t.mockups_note_composition}
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-700">{t.mockups_failclosed}</p>

        <div className="mt-8 grid gap-8">
          {MOCKUP_VORLAGEN.map((vorlage) => {
            const werte = MESSWERTE[vorlage.id];
            const name = t[NAMEN[vorlage.id] as keyof typeof t] as string;
            const produkt = vorlage.flaeche.art === 'zylinder' ? t.mockups_produkt_tasse : t.mockups_produkt_poster;
            return (
              <figure key={vorlage.id} className="rounded-2xl bg-white p-4 shadow-sm">
                <figcaption className="text-base font-semibold">
                  {name}
                  <span className="ml-2 text-sm font-normal text-neutral-500">{produkt}</span>
                </figcaption>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-4">
                  <div>
                    <button
                      type="button"
                      onClick={() => setGross(`/mockup-vorschau/${vorlage.id}-vorlage.png`)}
                      className="block w-full cursor-zoom-in"
                      title={t.mockups_fullsize}
                    >
                      <img
                        src={`/mockup-vorschau/${vorlage.id}-vorlage.png`}
                        alt={`${name} — ${t.mockups_label_template}`}
                        loading="lazy"
                        className="h-auto w-full rounded-lg border border-neutral-200"
                      />
                    </button>
                    <div className="mt-1 text-xs font-medium text-neutral-500">{t.mockups_label_template}</div>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => setGross(`/mockup-vorschau/${vorlage.id}-ergebnis.png`)}
                      className="block w-full cursor-zoom-in"
                      title={t.mockups_fullsize}
                    >
                      <img
                        src={`/mockup-vorschau/${vorlage.id}-ergebnis.png`}
                        alt={`${name} — ${t.mockups_label_result}`}
                        loading="lazy"
                        className="h-auto w-full rounded-lg border border-neutral-200"
                      />
                    </button>
                    <div className="mt-1 text-xs font-medium text-neutral-900">{t.mockups_label_result}</div>
                  </div>
                </div>
                <div className="mt-3 text-xs text-neutral-500">
                  {t.mockups_measured}: {werte.flaeche} · {t.mockups_coverage}: {werte.abdeckung} ·{' '}
                  {t.mockups_design}: {werte.design}
                </div>
              </figure>
            );
          })}
        </div>

        <p className="mt-8 text-xs leading-relaxed text-neutral-500">{t.mockups_free}</p>
      </div>

      {gross ? (
        <div
          role="presentation"
          onClick={() => setGross(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85 p-4"
        >
          <img src={gross} alt={t.mockups_fullsize} className="max-h-full max-w-full rounded-lg" />
        </div>
      ) : null}
    </main>
  );
}
