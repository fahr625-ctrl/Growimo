import { createFileRoute } from '@tanstack/react-router';
import { ROBOTS_PUBLIC, seoHead } from '~/lib/seo';
import { useTranslation } from '~/i18n';
import LegalLayout, {
  LegalLanguageNotice,
  LegalRelated,
} from '~/components/LegalLayout';
import LegalDocument from '~/components/LegalDocument';
import { WIDERRUF_SECTIONS } from '~/lib/legal-docs';
import { LEGAL_LAST_UPDATED } from '~/lib/legal';

export const Route = createFileRoute('/widerruf')({
  head: () => ({
    ...seoHead({
      titleKey: 'legal_widerruf_meta_title',
      robots: ROBOTS_PUBLIC,
      canonical: '/widerruf',
    }),
  }),
  component: WiderrufPage,
});

/**
 * Widerrufsbelehrung inkl. Muster-Widerrufsformular (Owner-Freigabe 2026-10-25).
 *
 * Damit ist die Referenz im Checkout („Einzelheiten regelt die
 * Widerrufsbelehrung", i18n `widerruf_consent_hint`) und in AGB § 11 auflösbar:
 * der Text ist unter dieser Route abrufbar. Inhalt ausschließlich aus
 * `src/lib/legal-docs.ts` (maschinell aus der Freigabe-Fassung übernommen).
 */
export function WiderrufPage() {
  const { t, locale } = useTranslation();

  return (
    <LegalLayout>
      <h1 className="text-2xl font-bold text-gray-900">
        {t.legal_widerruf_title}
      </h1>
      <p className="mt-2 text-xs text-gray-400">
        {t.legal_last_updated_label} {LEGAL_LAST_UPDATED}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-gray-500">
        {t.legal_widerruf_subtitle}
      </p>

      {locale === 'en' ? <LegalLanguageNotice /> : null}

      <LegalDocument sections={WIDERRUF_SECTIONS} />

      <LegalRelated
        links={[
          { label: t.legal_agb_title, href: '/agb' },
          { label: t.footer_privacy, href: '/datenschutz' },
          { label: t.footer_imprint, href: '/impressum' },
        ]}
      />
    </LegalLayout>
  );
}
