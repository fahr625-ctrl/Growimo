import { createFileRoute } from "@tanstack/react-router";
import { SignUp } from "@clerk/clerk-react";
import { isClerkConfigured } from "~/auth/middleware";

// Catch-all route for Clerk sub-paths like /app/sign-up/verify-email-address, etc.
export const Route = createFileRoute("/app/sign-up/$")({
  component: SignUpCatchAll,
});

function SignUpCatchAll() {
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
