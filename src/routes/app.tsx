import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth, useUser, UserButton, SignOutButton } from "@clerk/clerk-react";
import { isClerkConfigured } from "~/auth/middleware";
import { useTranslation } from "~/i18n";
import LanguageSwitcher from "~/components/LanguageSwitcher";
import FeedbackButton from "~/components/FeedbackButton";
import { ensureUser } from "~/store/projects";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const { t } = useTranslation();

  // Ensure a `users` row exists in PostgreSQL for the signed-in Clerk user.
  // Hook count stays stable because isClerkConfigured() is a build-time constant
  // (same pattern as AppSidebar below).
  const clerkUser = isClerkConfigured() ? useUser().user : undefined;
  const { isSignedIn, isLoaded } = isClerkConfigured() ? useAuth() : { isSignedIn: false, isLoaded: true };

  // Public auth pages (sign-in, sign-up) get a minimal layout without sidebar
  const isAuthPage =
    currentPath === "/app/sign-in" || currentPath === "/app/sign-up";

  // Beta welcome page gets full-width minimal layout (no sidebar, no max-w constraint)
  const isBetaWelcome = currentPath === "/app/beta-welcome";

  // ── Beta access gate ────────────────────────────────────────────────────────
  // Every beta signup is auto-approved; this gate checks the signed-in user's
  // email against the approved list before showing the app.
  const [beta, setBeta] = useState<'checking' | 'approved' | 'denied' | 'error'>('checking');
  const [checkVersion, setCheckVersion] = useState(0);
  const checkedEmailRef = useRef<string | null>(null);

  const email = clerkUser?.primaryEmailAddress?.emailAddress ?? "";

  useEffect(() => {
    if (!isLoaded || isAuthPage || isBetaWelcome || !isSignedIn || !email) return;
    // Avoid re-checking the same email on every render/navigation
    if (checkedEmailRef.current === email) return;
    checkedEmailRef.current = email;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/beta-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const d = await res.json().catch(() => null);
        if (cancelled) return;
        if (d && typeof d.approved === "boolean") setBeta(d.approved ? "approved" : "denied");
        else setBeta("error");
      } catch {
        if (!cancelled) setBeta("error");
      }
    })();
    return () => { cancelled = true; };
  }, [isLoaded, isAuthPage, isBetaWelcome, isSignedIn, email, checkVersion]);

  const retryAccessCheck = () => {
    checkedEmailRef.current = null;
    setBeta("checking");
    setCheckVersion(v => v + 1);
  };

  // Ensure a `users` row exists in PostgreSQL for the signed-in Clerk user.
  // Only runs once the user's email is confirmed beta-approved.
  useEffect(() => {
    if (beta !== "approved") return;
    if (!clerkUser?.id) return;
    ensureUser(
      clerkUser.id,
      clerkUser.primaryEmailAddress?.emailAddress ?? "",
      clerkUser.fullName ?? clerkUser.firstName ?? "",
    ).catch((err) => {
      console.error("[db] ensureUser failed:", err);
    });
  }, [beta, clerkUser?.id]);

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

  // Signed in: wait for the beta access check before showing anything
  if (isSignedIn && beta === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex items-center gap-3 text-gray-500">
          <svg
            className="h-6 w-6 animate-spin text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-sm font-medium">{t.common_loading}</span>
        </div>
      </div>
    );
  }

  // Signed in but not beta-approved: show the waitlist screen
  if (isSignedIn && beta === "denied") {
    return <WaitlistScreen />;
  }

  // Signed in but the access check itself failed: offer a retry
  if (isSignedIn && beta === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-bold text-gray-900">{t.beta_access_error_title}</h2>
          <p className="mt-2 text-sm text-gray-500">{t.beta_access_error_text}</p>
          <button
            onClick={retryAccessCheck}
            className="mt-6 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-2.5 font-semibold text-white shadow-sm transition-all hover:from-blue-700 hover:to-purple-700"
          >
            {t.beta_access_retry}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white md:flex-row">
      {/* Sidebar */}
      <AppSidebar />
      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <Outlet />
        </div>
      </main>
      <FeedbackButton />
    </div>
  );
}

function WaitlistScreen() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-xl">
        <img src="/logo.png" alt="Growimo" className="mx-auto h-10 w-auto" />
        <h2 className="mt-6 text-2xl font-bold text-gray-900">{t.beta_waitlist_title}</h2>
        <p className="mt-3 leading-relaxed text-gray-500">{t.beta_waitlist_text}</p>
        <Link
          to="/"
          className="mt-7 inline-block w-full rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-3 font-semibold text-white shadow-lg transition-all hover:from-blue-700 hover:to-purple-700"
        >
          {t.beta_waitlist_cta}
        </Link>
        <div className="mt-5">
          <SignOutButton>
            <button className="text-sm text-gray-400 transition-colors hover:text-gray-600">
              {t.auth_sign_out}
            </button>
          </SignOutButton>
        </div>
      </div>
    </div>
  );
}

function AppSidebar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const { t } = useTranslation();

  // Navigation items — defined inside component to access t
  const navItems = [
    { label: t.sidebar_beta_signups, to: "/app/beta-signups", icon: (active: boolean) => <svg className={`h-5 w-5 ${active ? "text-blue-600" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2m7-8a4 4 0 100-8 4 4 0 000 8zm7-5h4m-2-2v4" /></svg> },

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
      <aside className="flex w-full shrink-0 flex-col border-b border-gray-100 bg-white md:w-64 md:border-b-0 md:border-r">
        <SidebarHeader />
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

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-gray-100 bg-white md:w-64 md:border-b-0 md:border-r">
      <SidebarHeader />

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
        </div>
      </SidebarFooter>
    </aside>
  );
}

function SidebarHeader() {
  return (
    <div className="border-b border-gray-100 px-5 py-4">
      <Link to="/" className="flex items-center">
        <img src="/logo.png" alt="Growimo" className="h-7 w-auto" />
      </Link>
    </div>
  );
}

function SidebarFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-100 px-4 py-4">{children}</div>
  );
}
