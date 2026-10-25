import { createFileRoute } from '@tanstack/react-router';
import { ROBOTS_PUBLIC, seoHead } from '~/lib/seo';
import { useTranslation } from '~/i18n';
import LegalLayout, {
  LegalLanguageNotice,
  LegalRelated,
} from '~/components/LegalLayout';
import LegalDocument from '~/components/LegalDocument';
import { AGB_SECTIONS } from '~/lib/legal-docs';
import { LEGAL_LAST_UPDATED } from '~/lib/legal';

export const Route = createFileRoute('/agb')({
  head: () => ({
    ...seoHead({
      titleKey: 'legal_agb_meta_title',
      robots: ROBOTS_PUBLIC,
      canonical: '/agb',
    }),
  }),
  component: AgbPage,
});

/**
 * Allgemeine Geschäftsbedingungen (Owner-Freigabe 2026-10-25).
 *
 * Der Vertragstext steht ausschließlich in `src/lib/legal-docs.ts` und ist
 * maschinell aus der Freigabe-Fassung übernommen (kein zweiter Wortlaut).
 * Betreiber-Angaben (Name/Anschrift/E-Mail) stammen aus `src/lib/legal.ts`.
 *
 * Die AGB verweist in § 1 Abs. 4 und § 11 auf Datenschutzerklärung und
 * Widerrufsbelehrung — beide sind jetzt echte Routen (`/datenschutz`,
 * `/widerruf`), die Querverweise stehen zusätzlich unter dem Text.
 */
export function AgbPage() {
  const { t, locale } = useTranslation();

  return (
    <LegalLayout>
      <h1 className="text-2xl font-bold text-gray-900">{t.legal_agb_title}</h1>
      <p className="mt-2 text-xs text-gray-400">
        {t.legal_last_updated_label} {LEGAL_LAST_UPDATED}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-gray-500">
        {t.legal_agb_subtitle}
      </p>

      {locale === 'en' ? <LegalLanguageNotice /> : null}

      <LegalDocument sections={AGB_SECTIONS} />

      <LegalRelated
        links={[
          { label: t.legal_widerruf_title, href: '/widerruf' },
          { label: t.footer_privacy, href: '/datenschutz' },
          { label: t.footer_imprint, href: '/impressum' },
        ]}
      />
    </LegalLayout>
  );
}
