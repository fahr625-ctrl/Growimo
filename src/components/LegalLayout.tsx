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

/** Standard-Absatz. */
export function LegalText({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 text-sm leading-relaxed text-gray-600">{children}</p>
  );
}
