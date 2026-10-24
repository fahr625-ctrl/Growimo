import { createFileRoute } from '@tanstack/react-router';
import { ROBOTS_PUBLIC, seoHead } from '~/lib/seo';
import { useTranslation } from '~/i18n';
import LegalLayout, { LegalHeading, LegalText } from '~/components/LegalLayout';
import { AnalyticsOptOut } from '~/components/AnalyticsOptOut';
import {
  CONTACT_EMAIL_PLACEHOLDER,
  LEGAL_LAST_UPDATED,
  PROVIDER_CITY,
  PROVIDER_COUNTRY,
  PROVIDER_NAME,
  PROVIDER_STREET,
  contactEmailDisplay,
  hasContactEmail,
} from '~/lib/legal';

export const Route = createFileRoute('/datenschutz')({
  head: () => ({
    ...seoHead({
      titleKey: 'legal_privacy_meta_title',
      robots: ROBOTS_PUBLIC,
      canonical: '/datenschutz',
    }),
  }),
  component: DatenschutzPage,
});

/** Eine Verarbeitung: Überschrift + Sachtext + Rechtsgrundlage + Speicherdauer. */
interface Processing {
  heading: string;
  body: string;
  basis: string;
  retention: string;
}

/**
 * Datenschutzerklärung.
 *
 * Inhaltlich ausschließlich das, was im Code tatsächlich verbaut ist:
 * Clerk (Anmeldung, `__session`), OpenAI (Text/Bild), Stripe (Zahlung),
 * Neon PostgreSQL (Datenhaltung), Vercel (Hosting + Blob-Bildspeicher +
 * aggregierte Web-Analytics), eigene Analyse-/Fehler-Events in
 * `analytics_events` (90 Tage, ohne IP/PII), Besucher-Cookie `growimo_vid`
 * nur mit Einwilligung, localStorage/sessionStorage für Sitzungszustände.
 * Keine erfundenen Prozessoren, keine erfundenen Fristen.
 */
export function DatenschutzPage() {
  const { t } = useTranslation();
  const email = contactEmailDisplay();

  const processings: Processing[] = [
    {
      heading: t.legal_privacy_account_heading,
      body: t.legal_privacy_account_body,
      basis: t.legal_privacy_account_basis,
      retention: t.legal_privacy_account_retention,
    },
    {
      heading: t.legal_privacy_content_heading,
      body: t.legal_privacy_content_body,
      basis: t.legal_privacy_content_basis,
      retention: t.legal_privacy_content_retention,
    },
    {
      heading: t.legal_privacy_ai_heading,
      body: t.legal_privacy_ai_body,
      basis: t.legal_privacy_ai_basis,
      retention: t.legal_privacy_ai_retention,
    },
    {
      heading: t.legal_privacy_usage_heading,
      body: t.legal_privacy_usage_body,
      basis: t.legal_privacy_usage_basis,
      retention: t.legal_privacy_usage_retention,
    },
    {
      heading: t.legal_privacy_payment_heading,
      body: t.legal_privacy_payment_body,
      basis: t.legal_privacy_payment_basis,
      retention: t.legal_privacy_payment_retention,
    },
    {
      heading: t.legal_privacy_images_heading,
      body: t.legal_privacy_images_body,
      basis: t.legal_privacy_images_basis,
      retention: t.legal_privacy_images_retention,
    },
    {
      heading: t.legal_privacy_feedback_heading,
      body: t.legal_privacy_feedback_body,
      basis: t.legal_privacy_feedback_basis,
      retention: t.legal_privacy_feedback_retention,
    },
    {
      heading: t.legal_privacy_analytics_heading,
      body: t.legal_privacy_analytics_body,
      basis: t.legal_privacy_analytics_basis,
      retention: t.legal_privacy_analytics_retention,
    },
    {
      // Owner-Review 2026-10-23: beta_signups (Vorname + E-Mail) ist real
      // vorhanden (src/db/schema.ts) und war im Text nicht beschrieben.
      heading: t.legal_privacy_beta_heading,
      body: t.legal_privacy_beta_body,
      basis: t.legal_privacy_beta_basis,
      retention: t.legal_privacy_beta_retention,
    },
  ];

  const processors: string[] = [
    t.legal_privacy_processor_clerk,
    t.legal_privacy_processor_openai,
    t.legal_privacy_processor_stripe,
    t.legal_privacy_processor_neon,
    t.legal_privacy_processor_vercel,
  ];

  const retentionItems: string[] = [
    t.legal_privacy_retention_account,
    t.legal_privacy_retention_content,
    t.legal_privacy_retention_beta,
    t.legal_privacy_retention_usage,
    t.legal_privacy_retention_analytics,
    t.legal_privacy_retention_visitor_cookie,
    t.legal_privacy_retention_images,
    t.legal_privacy_retention_invoices,
    t.legal_privacy_retention_logs,
  ];

  const rights: string[] = [
    t.legal_privacy_right_access,
    t.legal_privacy_right_rectification,
    t.legal_privacy_right_erasure,
    t.legal_privacy_right_restriction,
    t.legal_privacy_right_portability,
    t.legal_privacy_right_object,
    t.legal_privacy_right_withdraw,
  ];

  return (
    <LegalLayout>
      <h1 className="text-2xl font-bold text-gray-900">{t.legal_privacy_title}</h1>
      <p className="mt-2 text-sm text-gray-500">{t.legal_privacy_subtitle}</p>
      <p className="mt-1 text-xs text-gray-400">
        {t.legal_last_updated_label} {LEGAL_LAST_UPDATED}
      </p>

      {/* 1. Verantwortlicher */}
      <LegalHeading>{t.legal_privacy_controller_heading}</LegalHeading>
      <LegalText>{t.legal_privacy_controller_intro}</LegalText>
      <div className="mt-2 text-sm leading-relaxed text-gray-600" data-testid="legal-controller">
        <p>{PROVIDER_NAME}</p>
        <p>{PROVIDER_STREET}</p>
        <p>{PROVIDER_CITY}</p>
        <p>{PROVIDER_COUNTRY}</p>
        <p className="mt-2">
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
      </div>
      <LegalText>{t.legal_privacy_controller_more}</LegalText>

      {/* 2. Überblick */}
      <LegalHeading>{t.legal_privacy_overview_heading}</LegalHeading>
      <LegalText>{t.legal_privacy_overview_intro}</LegalText>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-600">
        <li>{t.legal_privacy_overview_proc_clerk}</li>
        <li>{t.legal_privacy_overview_proc_openai}</li>
        <li>{t.legal_privacy_overview_proc_stripe}</li>
        <li>{t.legal_privacy_overview_proc_neon}</li>
        <li>{t.legal_privacy_overview_proc_vercel}</li>
      </ul>
      <LegalText>{t.legal_privacy_overview_no_sale}</LegalText>

      {/* 3. Verarbeitungen */}
      <LegalHeading>{t.legal_privacy_data_heading}</LegalHeading>
      {processings.map((p) => (
        <section key={p.heading} className="mt-6">
          <h3 className="text-base font-semibold text-gray-900">{p.heading}</h3>
          <LegalText>{p.body}</LegalText>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            <span className="font-medium text-gray-700">
              {t.legal_privacy_basis_label}:
            </span>{' '}
            {p.basis}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-gray-600">
            <span className="font-medium text-gray-700">
              {t.legal_privacy_retention_label}:
            </span>{' '}
            {p.retention}
          </p>
        </section>
      ))}

      {/* 4. Cookies und lokale Speicherung */}
      <LegalHeading>{t.legal_privacy_cookies_heading}</LegalHeading>
      <h3 className="mt-4 text-base font-semibold text-gray-900">
        {t.legal_privacy_cookies_session_heading}
      </h3>
      <LegalText>{t.legal_privacy_cookies_session_body}</LegalText>
      <h3 className="mt-4 text-base font-semibold text-gray-900">
        {t.legal_privacy_cookies_visitor_heading}
      </h3>
      <LegalText>{t.legal_privacy_cookies_visitor_body}</LegalText>
      {/* Owner-Vorgabe 2026-10-23: einfach zugänglicher Widerruf der
          Analyse-Einwilligung (setzt growimo_analytics_optout). */}
      <AnalyticsOptOut />
      <h3 className="mt-4 text-base font-semibold text-gray-900">
        {t.legal_privacy_cookies_local_heading}
      </h3>
      <LegalText>{t.legal_privacy_cookies_local_body}</LegalText>

      {/* 5. Empfänger */}
      <LegalHeading>{t.legal_privacy_processors_heading}</LegalHeading>
      <LegalText>{t.legal_privacy_processors_intro}</LegalText>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-600">
        {processors.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <LegalText>{t.legal_privacy_processors_dpa}</LegalText>

      {/* 6. Drittländer */}
      <LegalHeading>{t.legal_privacy_third_country_heading}</LegalHeading>
      <LegalText>{t.legal_privacy_third_country_body}</LegalText>

      {/* 7. Speicherdauer */}
      <LegalHeading>{t.legal_privacy_retention_heading}</LegalHeading>
      <LegalText>{t.legal_privacy_retention_intro}</LegalText>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-600">
        {retentionItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <LegalText>{t.legal_privacy_retention_outro}</LegalText>

      {/* 8. Rechte */}
      <LegalHeading>{t.legal_privacy_rights_heading}</LegalHeading>
      <LegalText>{t.legal_privacy_rights_intro}</LegalText>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-600">
        {rights.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <LegalText>{t.legal_privacy_rights_contact}</LegalText>

      {/* 9. Beschwerderecht */}
      <LegalHeading>{t.legal_privacy_complaint_heading}</LegalHeading>
      <LegalText>{t.legal_privacy_complaint_body}</LegalText>

      {/* 10. KI */}
      <LegalHeading>{t.legal_privacy_ai_notice_heading}</LegalHeading>
      <LegalText>{t.legal_privacy_ai_notice_body}</LegalText>

      {/* 11. Datensicherheit */}
      <LegalHeading>{t.legal_privacy_security_heading}</LegalHeading>
      <LegalText>{t.legal_privacy_security_body}</LegalText>

      {/* 12. Änderungen */}
      <LegalHeading>{t.legal_privacy_changes_heading}</LegalHeading>
      <LegalText>{t.legal_privacy_changes_body}</LegalText>

      {/* 13. Kontakt */}
      <LegalHeading>{t.legal_privacy_contact_heading}</LegalHeading>
      <LegalText>{t.legal_privacy_contact_body}</LegalText>
      <div className="mt-2 text-sm leading-relaxed text-gray-600" data-testid="legal-contact">
        <p>{PROVIDER_NAME}</p>
        <p>
          {t.legal_contact_email_label}:{' '}
          {hasContactEmail() ? (
            <a href={`mailto:${email}`} className="text-blue-600 hover:underline">
              {email}
            </a>
          ) : (
            <span>{CONTACT_EMAIL_PLACEHOLDER}</span>
          )}
        </p>
      </div>
    </LegalLayout>
  );
}
