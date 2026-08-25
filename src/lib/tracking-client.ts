// Client-side helper for the server-side beta-tracking (fire-and-forget).
// NOTE: src/store/analytics.ts (existing localStorage analytics) stays untouched —
// this is the SEPARATE server-side system with user-scoped events.
import { trackEventServer } from "~/tracking/server";
import type { TrackedEvent } from "./tracking";

/**
 * Record a beta-tracking event. Fire-and-forget: never throws, never blocks the
 * calling feature. `userId` is the Clerk user id from useUser() (already-authorized
 * session); writing trusts the client (the admin REPORT is protected server-side
 * via Clerk-session verification in /api/admin-tracking).
 */
export function track(
  event: TrackedEvent,
  userId?: string | null,
  metadata?: Record<string, unknown>,
): void {
  if (!userId) return;
  try {
    void trackEventServer({ data: { event, userId, metadata } }).catch(() => {
      /* tracking must never surface errors */
    });
  } catch {
    /* tracking must never surface errors */
  }
}