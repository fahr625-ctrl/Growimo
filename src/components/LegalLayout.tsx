import type { ReactNode } from 'react';
import { useTranslation } from '~/i18n';
import LanguageSwitcher from '~/components/LanguageSwitcher';

/**
 * Gemeinsames Layout für die Rechtstext-Seiten (/impressum, /datenschutz).
 * Bewusst ohne Clerk-Abhängigkeit und ohne /app-Sidebar: die Seiten sind
 * öffentlich erreichbar (auch ausgeloggt) und werden aus dem Landing-Footer
 * sowie aus dem /app-Bereich verlinkt.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b border-gray-100">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
          <a href="/" className="flex items-center">
            <img src="/logo.png" alt="Growimo" className="h-7 w-auto" />
          </a>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <a
              href="/"
              className="text-sm text-gray-500 transition-colors hover:text-blue-600"
            >
              {t.legal_back_home}
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10">{children}</main>

      <footer className="mt-10 border-t border-gray-100">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-6 text-sm">
          {/* Owner-Freigabe 2026-10-25: alle Rechts-Links vollständig. */}
          <a
            href="/impressum"
            className="text-gray-500 transition-colors hover:text-blue-600"
          >
            {t.footer_imprint}
          </a>
          <a
            href="/datenschutz"
            className="text-gray-500 transition-colors hover:text-blue-600"
          >
            {t.footer_privacy}
          </a>
          <a
            href="/agb"
            className="text-gray-500 transition-colors hover:text-blue-600"
          >
            {t.footer_agb}
          </a>
          <a
            href="/widerruf"
            className="text-gray-500 transition-colors hover:text-blue-600"
          >
            {t.footer_widerruf}
          </a>
          <a
            href="/impressum"
            className="text-gray-500 transition-colors hover:text-blue-600"
          >
            {t.footer_contact}
          </a>
          <span className="ml-auto text-xs text-gray-400">
            {t.footer_copyright}
          </span>
        </div>
      </footer>
    </div>
  );
}

/** Abschnitts-Überschrift im gleichen Stil auf beiden Rechtstext-Seiten. */
export function LegalHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-8 text-lg font-semibold text-gray-900">{children}</h2>
  );
}

/**
 * Hinweis auf den Seiten /agb und /widerruf, wenn die Oberfläche auf Englisch
 * steht. AGB und Widerrufsbelehrung liegen nur auf Deutsch vor (offene
 * Owner-Frage 2026-10-25) — es wird KEINE Übersetzung erfunden. Der Hinweis
 * macht das sichtbar und nennt die maßgebliche Fassung.
 */
export function LegalLanguageNotice() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="legal-language-notice"
      className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4"
    >
      <p className="text-sm font-semibold text-amber-900">
        {t.legal_en_notice_heading}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-amber-800">
        {t.legal_en_notice_body}
      </p>
    </div>
  );
}

/**
 * Querverweise unter einem Rechtstext („Siehe auch"): AGB verweist auf die
 * Widerrufsbelehrung und die Datenschutzerklärung, die Widerrufsbelehrung auf
 * die AGB — die Referenzen im Text sind damit echte Links.
 */
export function LegalRelated({ links }: { links: Array<{ label: string; href: string }> }) {
  const { t } = useTranslation();
  if (links.length === 0) return null;
  return (
    <nav
      data-testid="legal-related"
      className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-100 pt-6 text-sm"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        {t.legal_related_heading}
      </span>
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="text-blue-600 transition-colors hover:underline"
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}

/** Standard-Absatz. */
export function LegalText({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 text-sm leading-relaxed text-gray-600">{children}</p>
  );
}
