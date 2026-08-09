/**
 * Returns whether Clerk auth is available (publishable key is set).
 * Use this to conditionally render auth-dependent UI.
 */
export function isClerkConfigured(): boolean {
  return Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
}
