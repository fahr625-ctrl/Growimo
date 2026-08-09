import { createFileRoute } from "@tanstack/react-router";
import { SignUp } from "@clerk/clerk-react";
import { isClerkConfigured } from "~/auth/middleware";
import { useEffect } from "react";

export const Route = createFileRoute("/app/sign-up/")({
  component: SignUpPage,
});

function SignUpPage() {
  useEffect(() => {
    try { localStorage.setItem('growimo_pending_track', 'signup'); } catch {}
  }, []);

  if (!isClerkConfigured()) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h2 className="text-xl font-bold text-gray-900">
          Authentifizierung nicht konfiguriert
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          Setze Clerk-Umgebungsvariablen, um die Registrierung zu aktivieren.
        </p>
      </div>
    );
  }

  return (
    <SignUp
      routing="path"
      path="/app/sign-up"
      signInUrl="/app/sign-in"
      fallbackRedirectUrl="/app"
    />
  );
}
