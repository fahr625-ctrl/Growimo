import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ClerkAuthProvider } from "~/auth/clerk";
import { I18nProvider, useTranslation } from "~/i18n";

import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Growimo — Create Pinterest Pins, Etsy Mockups & SEO Content with AI" },
      {
        name: "description",
        content:
          "Create Pinterest pins, Etsy mockups, SEO content and complete marketing strategies with AI — in seconds. Start free.",
      },
      { property: "og:title", content: "Growimo — Built for Growth" },
      { property: "og:description", content: "Create Pinterest pins, Etsy mockups and SEO content with AI. Start free." },
      { property: "og:image", content: "/logo.png" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Growimo — Built for Growth" },
      { name: "twitter:description", content: "Create content, improve SEO, and grow your business with one AI-powered workspace." },
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
          <Outlet />
        </ClerkAuthProvider>
      </RootDocument>
    </I18nProvider>
  );
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
      </body>
    </html>
  );
}
