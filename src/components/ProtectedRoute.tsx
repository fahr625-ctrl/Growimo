import { useAuth } from "@clerk/clerk-react";
import type { ReactNode } from "react";
import { isClerkConfigured } from "~/auth/middleware";
import { useTranslation } from "~/i18n";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  // If Clerk is not configured, show a friendly message
  if (!isClerkConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 text-2xl font-bold text-white">
            G
          </div>
          <h2 className="mt-6 text-xl font-bold text-gray-900">
            {t.auth_not_configured}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            {t.auth_not_configured_desc.split('VITE_CLERK_PUBLISHABLE_KEY')[0]}
            <code className="rounded bg-gray-100 px-1 py-0.5 text-xs text-blue-600">VITE_CLERK_PUBLISHABLE_KEY</code>
            {t.auth_not_configured_desc.split('VITE_CLERK_PUBLISHABLE_KEY')[1]?.split('CLERK_SECRET_KEY')[0] || ' '}
            <code className="rounded bg-gray-100 px-1 py-0.5 text-xs text-blue-600">CLERK_SECRET_KEY</code>
            {t.auth_not_configured_desc.split('CLERK_SECRET_KEY')[1] || ''}
          </p>
        </div>
      </div>
    );
  }

  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
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

  if (!isSignedIn) {
    if (typeof window !== "undefined") {
      window.location.href = "/app/sign-in";
    }
    return null;
  }

  return <>{children}</>;
}
