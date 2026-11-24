import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { ClerkAuthProvider } from "~/auth/clerk";
import { AnalyticsConsent } from "~/components/AnalyticsConsent";
import { I18nProvider, useTranslation } from "~/i18n";
import { OG_IMAGE_URL } from "~/lib/seo";
import { trackAnalytics } from "~/lib/analytics-client";

import appCss from "~/styles/app.css?url";
import { VercelAnalytics } from "~/components/VercelAnalytics";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // Teil B (2026-11-12): Die Meta-Texte versprechen nur, was gebaut ist.
      // 2026-11-24: Pin-Bilder sind live — über die Kampagne aus eigenem Foto.
      // Etsy-Mockups sind in der Vorschau fertig und werden hier nicht zugesagt.
      { title: "Growimo — Fertige Inhalte für Pinterest, Etsy und TikTok" },
      {
        name: "description",
        content:
          "Growimo macht aus einer Produktidee fertige Inhalte: Pin-Texte für Pinterest, fünf Pin-Bilder aus deinem eigenen Foto, ein Etsy-Listing mit bis zu 13 Tags und ein TikTok-Skript.",
      },
      { property: "og:title", content: "Growimo — Drei fertige Inhalte aus einer Idee" },
      {
        property: "og:description",
        content:
          "Pin-Texte und fünf Pin-Bilder aus deinem eigenen Foto für Pinterest, ein Etsy-Listing mit bis zu 13 Tags und ein TikTok-Skript — fertig zum Kopieren.",
      },
      // FIX-BLOCK 3 (2026-10-08): Social-Images MÜSSEN absolut sein — Crawler
      // lösen relative Pfade nicht gegen die Seite auf. /logo.png liegt als
      // statische Datei in /public und ist im Build-Output vorhanden.
      { property: "og:image", content: OG_IMAGE_URL },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Growimo — Drei fertige Inhalte aus einer Idee" },
      {
        name: "twitter:description",
        content:
          "Pin-Texte für Pinterest, ein Etsy-Listing mit 13 Tags und ein TikTok-Skript — fertig zum Kopieren.",
      },
      { name: "twitter:image", content: OG_IMAGE_URL },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/icon.png" },
      { rel: "apple-touch-icon", href: "/icon.png" },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap",
      },
    ],
  }),
  notFoundComponent: NotFound,
  component: RootComponent,
});

function NotFound() {
  return <I18nProvider><NotFoundInner /></I18nProvider>;
}

function NotFoundInner() {
  const { t } = useTranslation();
  return <div>{t.common_page_not_found}</div>;
}

function RootComponent() {
  return (
    <I18nProvider>
      <RootDocument>
        <ClerkAuthProvider>
          <PageviewTracker />
          <Outlet />
          {/* Consent-Gate (additiv, non-blocking): erscheint nur ohne
              gespeicherte Entscheidung und beeinflusst das bestehende Tracking
              nicht — es steuert ausschließlich die neue Besucherkennung. */}
          <AnalyticsConsent />
        </ClerkAuthProvider>
      </RootDocument>
    </I18nProvider>
  );
}

// Admin-Analytics MVP Phase 1: anonymous pageview on every navigation (also
// logged-out). Fires once per pathname change incl. the initial route; the
// helper fills referrer-host/utm/route itself. Fire-and-forget, never blocks.
function PageviewTracker() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    trackAnalytics("pageview");
  }, [pathname]);
  return null;
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className="scroll-smooth">
      <head>
        <HeadContent />
      </head>
      <body className="font-sans">
        {children}
        <Scripts />
        {/* Widerruf (Owner-Vorgabe 2026-10-23): lädt @vercel/analytics nur
            ohne gesetztes Opt-out (growimo_analytics_optout). */}
        <VercelAnalytics />
      </body>
    </html>
  );
}
