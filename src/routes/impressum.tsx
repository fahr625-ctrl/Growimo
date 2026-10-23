import { createFileRoute } from '@tanstack/react-router';
import { ROBOTS_PUBLIC, seoHead } from '~/lib/seo';
import { useTranslation } from '~/i18n';
import LegalLayout, { LegalHeading, LegalText } from '~/components/LegalLayout';
import {
  CONTACT_EMAIL_PLACEHOLDER,
  LEGAL_LAST_UPDATED,
  PROVIDER_CITY,
  PROVIDER_COUNTRY,
  PROVIDER_NAME,
  PROVIDER_STREET,
  VAT_DISCLAIMER,
  VAT_ID,
  WEBSITE_URL,
  contactEmailDisplay,
  hasContactEmail,
  hasVatInfo,
} from '~/lib/legal';

export const Route = createFileRoute('/impressum')({
  head: () => ({
    ...seoHead({
      titleKey: 'legal_imprint_meta_title',
      robots: ROBOTS_PUBLIC,
      canonical: '/impressum',
    }),
  }),
  component: ImpressumPage,
});

/**
 * Impressum — Angaben gemäß § 5 DDG.
 *
 * Alle Betreiber-Angaben kommen aus `src/lib/legal.ts` (EINZIGE Quelle).
 * Es wird NICHTS erfunden: keine Telefonnummer, keine USt-IdNr., kein
 * Handelsregistereintrag. Der Umsatzsteuer-Abschnitt erscheint nur, wenn in
 * der Legal-Config tatsächlich eine Angabe hinterlegt ist (`hasVatInfo()`).
 */
export function ImpressumPage() {
  const { t } = useTranslation();
  const email = contactEmailDisplay();

  return (
    <LegalLayout>
      <h1 className="text-2xl font-bold text-gray-900">{t.legal_imprint_title}</h1>
      <p className="mt-2 text-xs text-gray-400">
        {t.legal_last_updated_label} {LEGAL_LAST_UPDATED}
      </p>

      <LegalHeading>{t.legal_imprint_ddg_heading}</LegalHeading>

      <div className="mt-3 text-sm leading-relaxed text-gray-600" data-testid="legal-provider">
        <p className="font-medium text-gray-900">{t.legal_imprint_provider_heading}</p>
        <p>{PROVIDER_NAME}</p>
        <p>{PROVIDER_STREET}</p>
        <p>{PROVIDER_CITY}</p>
        <p>{PROVIDER_COUNTRY}</p>
      </div>

      <div className="mt-6 text-sm leading-relaxed text-gray-600">
        <p className="font-medium text-gray-900">{t.legal_imprint_contact_heading}</p>
        <p>
          {t.legal_contact_email_label}:{' '}
          {hasContactEmail() ? (
            <a href={`mailto:${email}`} className="text-blue-600 hover:underline">
              {email}
            </a>
          ) : (
            <span data-testid="legal-contact-email-placeholder">
              {CONTACT_EMAIL_PLACEHOLDER}
            </span>
          )}
        </p>
        <p>
          {t.legal_website_label}:{' '}
          <a
            href={WEBSITE_URL}
            className="text-blue-600 hover:underline"
            rel="noopener noreferrer"
          >
            {WEBSITE_URL}
          </a>
        </p>
      </div>

      <LegalHeading>{t.legal_imprint_responsible_heading}</LegalHeading>
      <LegalText>{t.legal_imprint_responsible_intro}</LegalText>
      <div className="mt-2 text-sm leading-relaxed text-gray-600">
        <p>{PROVIDER_NAME}</p>
        <p>{PROVIDER_STREET}</p>
        <p>{PROVIDER_CITY}</p>
        <p>{PROVIDER_COUNTRY}</p>
      </div>

      <LegalHeading>{t.legal_imprint_vsb_heading}</LegalHeading>
      <LegalText>{t.legal_imprint_vsb_text}</LegalText>

      {hasVatInfo() ? (
        <>
          <LegalHeading>{t.legal_imprint_vat_heading}</LegalHeading>
          {VAT_ID.trim().length > 0 ? (
            <LegalText>
              {t.legal_imprint_vat_id_label}: {VAT_ID}
            </LegalText>
          ) : null}
          {VAT_DISCLAIMER.trim().length > 0 ? (
            <LegalText>{VAT_DISCLAIMER}</LegalText>
          ) : null}
        </>
      ) : null}
    </LegalLayout>
  );
}
