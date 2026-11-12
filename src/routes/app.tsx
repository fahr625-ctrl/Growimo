import { ROBOTS_PRIVATE, seoHead } from "~/lib/seo";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth, useUser, UserButton, SignOutButton } from "@clerk/clerk-react";
import { isClerkConfigured } from "~/auth/middleware";
import { useTranslation } from "~/i18n";
import LanguageSwitcher from "~/components/LanguageSwitcher";
import FeedbackButton from "~/components/FeedbackButton";
import { ensureUser } from "~/store/projects";
import { OWNER_USER_ID } from "~/lib/tracking";
import { UsageStatus } from "~/components/UsageStatus";

export const Route = createFileRoute("/app")({
  head: () =>
    seoHead({ titleKey: 'meta_app_workspace_title', robots: ROBOTS_PRIVATE }),
  component: AppLayout,
});

// ── BETA-ENDE (Owner-Auftrag 2026-10-08, Phase 10-Vorbereitung) ───────────────
// Das Beta-Access-Gate ist ENTFERNT. Früher prüfte /app die sign-in-E-Mail gegen
// `beta_signups.approved` und zeigte Nicht-Freigeschalteten den Wartelisten-
// Bildschirm (Status `checking` → Spinner, `denied` → Waitlist, `error` → Retry).
// Seit dem Beta-Ende ist die Registrierung öffentlich: JEDER eingeloggte Nutzer
// (gültige Clerk-Session) kommt direkt in die App — ohne Netzwerk-Check, ohne
// Warteliste, ohne Beta-Zeile. Der Zugriffsschutz für Ausgeloggte liegt weiterhin
// in `ProtectedRoute` (Redirect auf /app/sign-in).
//
// Der lebenslange 50-%-Beta-Rabatt bleibt davon unberührt: er wird serverseitig
// in `src/stripe/checkout.ts` über `isBetaUserEmail()` (beta_signups
// approved = true) entschieden und gilt nur für vor dem Public Launch
// registrierte Nutzer — nicht für neue.

function AppLayout() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const { t } = useTranslation();

  // Ensure a `users` row exists in PostgreSQL for the signed-in Clerk user.
  // Hook count stays stable because isClerkConfigured() is a build-time constant
  // (same pattern as AppSidebar below).
  const clerkUser = isClerkConfigured() ? useUser().user : undefined;
  const { isSignedIn } = isClerkConfigured() ? useAuth() : { isSignedIn: false };

  // Public auth pages (sign-in, sign-up) get a minimal layout without sidebar
  const isAuthPage =
    currentPath === "/app/sign-in" || currentPath === "/app/sign-up";

  // Beta welcome page gets full-width minimal layout (no sidebar, no max-w constraint)
  const isBetaWelcome = currentPath === "/app/beta-welcome";

  // Ensure a `users` row exists in PostgreSQL for the signed-in Clerk user.
  // BETA-ENDE (Owner-Auftrag 2026-10-08): läuft jetzt für JEDEN eingeloggten
  // Nutzer — nicht mehr erst nach bestätigter Beta-Freischaltung. Früher hing
  // dieser Effekt an `beta === "approved"`, sodass nur freigeschaltete
  // Beta-Nutzer beim App-Load ihre users-Zeile bekamen; neue Nutzer ohne
  // beta_signups-Zeile wurden erst beim ersten App-Pfad angelegt. Seit der
  // öffentlichen Registrierung legen wir die Zeile für alle an.
  // Hook-Reihenfolge bleibt stabil, weil isClerkConfigured() eine
  // Build-Zeit-Konstante ist.
  useEffect(() => {
    if (!isSignedIn) return;
    if (!clerkUser?.id) return;
    ensureUser(
      clerkUser.id,
      clerkUser.primaryEmailAddress?.emailAddress ?? "",
      clerkUser.fullName ?? clerkUser.firstName ?? "",
    ).catch((err) => {
      console.error("[db] ensureUser failed:", err);
    });
  }, [isSignedIn, clerkUser?.id]);

  // ── Mobil-Drawer (Phase 1) ────────────────────────────────────────────────
  // Bis 2026-11-12 war die Sidebar auf dem Handy ein vollbreiter Block, der sich
  // VOR den Inhalt schob (w-full md:w-64). Jetzt ist sie ein Off-Canvas-Drawer:
  // mobil fest positioniert und eingeklappt, ab md wieder eine statische Spalte.
  const [navOpen, setNavOpen] = useState(false);
  // Navigation schließt sich bei jedem Pfadwechsel (auch Zurück/Vor).
  useEffect(() => {
    setNavOpen(false);
  }, [currentPath]);
  // Escape schließt, Body scrollt nicht mit, solange der Drawer offen ist.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [navOpen]);

  if (isBetaWelcome) {
    return <Outlet />;
  }

  if (isAuthPage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-4">
        <div className="w-full max-w-md">
          {/* Brand logo above auth forms */}
          <div className="mb-8 text-center">
            <Link to="/" className="inline-flex items-center">
              <img src="/logo.png" alt="Growimo" className="h-8 w-auto" />
            </Link>
          </div>
          <Outlet />
        </div>
      </div>
    );
  }

  // BETA-ENDE (Owner 2026-10-08): Hier standen drei blockierende Zweige —
  // `checking` (Dauer-Spinner), `denied` (Warteliste/WaitlistScreen) und
  // `error` (Retry-Bildschirm). Sie sind entfernt: jeder eingeloggte Nutzer
  // landet direkt im App-Layout (Sidebar + Outlet). Der Netzwerk-Check
  // /api/beta-access existiert weiterhin für den Bestands-Rabatt, entscheidet
  // aber nichts mehr über den Zugang.

  return (
    <div className="flex min-h-screen flex-col bg-white md:flex-row">
      {/* Mobile Kopfzeile mit Menü-Knopf — ab md übernimmt die Sidebar */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-gray-100 bg-white px-4 py-3 md:hidden"
        data-testid="mobile-topbar"
      >
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label={t.nav_menu_toggle}
          aria-expanded={navOpen}
          aria-controls="app-sidebar"
          data-testid="mobile-nav-open"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
          </svg>
        </button>
        <Link to="/" className="flex items-center">
          <img src="/logo.png" alt="Growimo" className="h-7 w-auto" />
        </Link>
        <span className="h-9 w-9" aria-hidden="true" />
      </header>

      {/* Backdrop — nur mobil, tippen schließt den Drawer */}
      {navOpen ? (
        <div
          className="fixed inset-0 z-40 bg-gray-900/40 md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
          data-testid="mobile-nav-backdrop"
        />
      ) : null}

      {/* Sidebar / Mobil-Drawer */}
      <AppSidebar open={navOpen} onClose={() => setNavOpen(false)} />
      {/* Main content */}
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-8">
          {isSignedIn && clerkUser?.id ? <UsageStatus userId={clerkUser.id} /> : null}
          <Outlet />
        </div>
      </main>
      <FeedbackButton />
    </div>
  );
}

function AppSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const { t } = useTranslation();

  // Owner-only admin navigation. Rendered as its own section (below) and only
  // when the signed-in Clerk user id equals OWNER_USER_ID (Owner order 2026-10-11).
  const ownerNavItems = [
    { label: t.sidebar_beta_signups, to: "/app/beta-signups", icon: (active: boolean) => <svg className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2m7-8a4 4 0 100-8 4 4 0 000 8zm7-5h4m-2-2v4" /></svg> },
    { label: t.sidebar_owner_admin_tracking, to: "/app/admin-tracking", icon: (active: boolean) => <svg className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12h3.5l2.5 6.5L13 4.5l2.5 7.5H21" /></svg> },
    { label: t.sidebar_owner_admin_analytics, to: "/app/admin-analytics", icon: (active: boolean) => <svg className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 20V11m5 9V4m5 16v-6m5 6V8" /></svg> },
  ];

  // Navigation items — defined inside component to access t
  const navItems = [
    {
      label: t.sidebar_dashboard,
      to: "/app",
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
          />
        </svg>
      ),
    },
    {
      label: t.sidebar_new_strategy,
      to: "/app/new-project",
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      ),
    },
    {
      label: t.sidebar_image_studio,
      to: "/app/image-studio",
      icon: (active: boolean) => (
        <svg className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M4 20l4.586-1.586a2 2 0 00.707-.464L19 8.243a2 2 0 000-2.828l-.415-.415a2 2 0 00-2.828 0L6.05 14.707a2 2 0 00-.464.707L4 20z" />
        </svg>
      ),
    },
    {
      label: t.sidebar_tiktok,
      to: "/app/tiktok",
      icon: (active: boolean) => (
        <svg className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h3m6-6.5V15a6 6 0 01-6 6H9a6 6 0 01-6-6V9a6 6 0 016-6h1.5M18 4v.01M21 6v3a3 3 0 01-3 3h-3a3 3 0 01-3-3V6a3 3 0 013-3h3a3 3 0 013 3z" />
        </svg>
      ),
    },
    {
      label: t.sidebar_content_library,
      to: "/app/content-library",
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
      ),
    },
    {
      label: t.sidebar_pricing,
      to: "/app/pricing",
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    {
      label: t.sidebar_billing,
      to: "/app/billing",
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      ),
    },
    {
      label: t.brand_nav,
      to: "/app/brand",
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"
          />
        </svg>
      ),
    },
    {
      label: t.analytics_nav,
      to: "/app/analytics",
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      ),
    },
    {
      label: t.perf_nav,
      to: "/app/performance",
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
          />
        </svg>
      ),
    },
    {
      label: t.fh_nav,
      to: "/app/feedback",
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
      ),
    },
    {
      label: t.sidebar_settings,
      to: "/app/settings",
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
  ];

  function isActive(to: string): boolean {
    if (to === '/app') return currentPath === '/app' || currentPath === '/app/';
    return currentPath === to;
  }

  // Check Clerk config before calling any Clerk hooks
  if (!isClerkConfigured()) {
    return (
      <aside id="app-sidebar" data-testid="app-sidebar" className={sidebarClass(open)}>
        <SidebarHeader onClose={onClose} />
        {/* Render nav without auth features */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const active = isActive(item.to);
              return (
                <li key={item.label}>
                  <Link
                    to={item.to}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    {item.icon(active)}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <SidebarFooter>
          <div className="flex flex-col gap-2">
            <LanguageSwitcher />
            <span className="text-xs text-gray-400">{t.auth_not_configured}</span>
          </div>
        </SidebarFooter>
      </aside>
    );
  }

  // Safe to use Clerk hooks now
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const isOwner = user?.id === OWNER_USER_ID;

  return (
    <aside id="app-sidebar" data-testid="app-sidebar" className={sidebarClass(open)}>
      <SidebarHeader onClose={onClose} />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const active = isActive(item.to);
            return (
              <li key={item.label}>
                <Link
                  to={item.to}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  {item.icon(active)}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Owner / Administration - nur fuer das Owner-Konto sichtbar */}
        {isOwner ? (
          <div className="mt-5" data-testid="sidebar-owner-section">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {t.sidebar_owner_admin}
            </p>
            <ul className="space-y-1">
              {ownerNavItems.map((item) => {
                const active = isActive(item.to);
                return (
                  <li key={`owner-${item.label}`}>
                    <Link
                      to={item.to}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                        active
                          ? "bg-blue-50 text-blue-700"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      }`}
                    >
                      {item.icon(active)}
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </nav>

      {/* User section */}
      <SidebarFooter>
        <div className="flex flex-col gap-2">
          <LanguageSwitcher />
          {isSignedIn && user ? (
            <div className="flex items-center gap-3">
              <UserButton
                afterSignOutUrl="/"
                appearance={{
                  elements: {
                    userButtonAvatarBox: "h-8 w-8",
                  },
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-700">
                  {user.fullName || user.primaryEmailAddress?.emailAddress || "User"}
                </p>
                <SignOutButton>
                  <button className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                    {t.auth_sign_out}
                  </button>
                </SignOutButton>
              </div>
            </div>
          ) : (
            <Link
              to="/app/sign-in"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-blue-700 hover:to-purple-700"
            >
              {t.auth_sign_in}
            </Link>
          )}
          {/* Rechtstexte (2026-10-23): aus jedem Bereich der App erreichbar.
              2026-10-25 (Owner-Freigabe): AGB + Widerrufsbelehrung ergänzt. */}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
            <a href="/impressum" className="transition-colors hover:text-gray-600">
              {t.footer_imprint}
            </a>
            <a href="/datenschutz" className="transition-colors hover:text-gray-600">
              {t.footer_privacy}
            </a>
            <a href="/agb" className="transition-colors hover:text-gray-600">
              {t.footer_agb}
            </a>
            <a href="/widerruf" className="transition-colors hover:text-gray-600">
              {t.footer_widerruf}
            </a>
          </div>
        </div>
      </SidebarFooter>
    </aside>
  );
}

// Mobil: Off-Canvas-Drawer (eingeklappt per -translate-x-full, Backdrop dahinter),
// ab md: unveränderte statische Spalte mit 16rem Breite.
function sidebarClass(open: boolean): string {
  return [
    "flex flex-col border-r border-gray-100 bg-white",
    "fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto shadow-xl transition-transform duration-200 ease-out",
    open ? "translate-x-0" : "-translate-x-full",
    "md:static md:z-auto md:w-64 md:max-w-none md:shrink-0 md:translate-x-0 md:overflow-visible md:shadow-none md:transition-none",
  ].join(" ");
}

function SidebarHeader({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-4">
      <Link to="/" className="flex items-center">
        <img src="/logo.png" alt="Growimo" className="h-7 w-auto" />
      </Link>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={t.nav_menu_close}
          data-testid="mobile-nav-close"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 md:hidden"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

function SidebarFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-100 px-4 py-4">{children}</div>
  );
}
