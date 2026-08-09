import { createFileRoute } from "@tanstack/react-router";
import { SignIn } from "@clerk/clerk-react";
import { isClerkConfigured } from "~/auth/middleware";
import { useEffect } from "react";

export const Route = createFileRoute("/app/sign-in/")({
  component: SignInPage,
});

function SignInPage() {
  useEffect(() => {
    try { localStorage.setItem('growimo_pending_track', 'signin'); } catch {}
  }, []);

  if (!isClerkConfigured()) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h2 className="text-xl font-bold text-gray-900">
          Authentifizierung nicht konfiguriert
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          Setze Clerk-Umgebungsvariablen, um die Anmeldung zu aktivieren.
        </p>
      </div>
    );
  }

  return (
    <SignIn
      routing="path"
      path="/app/sign-in"
      signUpUrl="/app/sign-up"
      fallbackRedirectUrl="/app"
    />
  );
}
