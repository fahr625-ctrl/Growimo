import { ClerkProvider } from "@clerk/clerk-react";
import type { ReactNode } from "react";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";

export function ClerkAuthProvider({ children }: { children: ReactNode }) {
  if (!publishableKey) {
    console.warn(
      "[auth] VITE_CLERK_PUBLISHABLE_KEY is not set — Clerk features will not work.",
    );
    return <>{children}</>;
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/app/sign-in"
      signUpUrl="/app/sign-up"
      afterSignInUrl="/app"
      afterSignUpUrl="/app"
      afterSignOutUrl="/"
      appearance={{
        variables: {
          colorPrimary: "#4f46e5",
          colorTextOnPrimaryBackground: "#ffffff",
        },
        elements: {
          formButtonPrimary:
            "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-sm font-semibold shadow-md",
          card: "shadow-xl border border-gray-100 rounded-2xl",
          headerTitle: "text-gray-900 font-extrabold",
          headerSubtitle: "text-gray-500",
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
