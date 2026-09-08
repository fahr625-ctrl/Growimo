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
import { I18nProvider, useTranslation } from "~/i18n";
import { trackAnalytics } from "~/lib/analytics-client";

import appCss from "~/styles/app.css?url";
import { Analytics } from "@vercel/analytics/react";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Growimo — Pinterest Pins, Etsy-Mockups & SEO-Content mit KI erstellen" },
      {
        name: "description",
        content:
          "Erstelle Pinterest Pins, Etsy-Mockups, SEO-Content und komplette Marketing-Strategien mit KI — in Sekunden. Jetzt kostenlos starten.",
      },
      { property: "og:title", content: "Growimo — Gebaut für Wachstum" },
      { property: "og:description", content: "Erstelle Pinterest Pins, Etsy-Mockups und SEO-Content mit KI. Jetzt kostenlos starten." },
      { property: "og:image", content: "/logo.png" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Growimo — Gebaut für Wachstum" },
      { name: "twitter:description", content: "Erstelle Content, verbessere SEO und wachse mit deinem Business — mit einem KI-gestützten Arbeitsbereich." },
      { name: "twitter:image", content: "/logo.png" },
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
        <Analytics />
      </body>
    </html>
  );
}
