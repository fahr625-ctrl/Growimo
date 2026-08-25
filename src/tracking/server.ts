// ── Server-side tracking server-fn (additive, fire-and-forget) ──────────────
// Mirrors the src/ai/server.ts createServerFn pattern. The client sends a small
// payload { event, userId, metadata }; TanStack strips the { data: ... } wrapper
// so the validator receives the payload directly. Writing is intentionally
// fire-and-forget and NEVER throws to the client, so a tracking hiccup can never
// break the actual feature flow.
import { createServerFn } from "@tanstack/react-start";
import { qInsertTrackingEvent } from "~/db/queries";
import {
  OWNER_USER_ID,
  isTrackedEvent,
  type TrackedEvent,
} from "~/lib/tracking";

export const trackEventServer = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const d = input as {
      event: string;
      userId: string;
      metadata?: Record<string, unknown>;
    };
    if (!d || typeof d !== "object") throw new Error("invalid tracking payload");
    if (typeof d.event !== "string" || !isTrackedEvent(d.event)) {
      throw new Error("unknown tracking event");
    }
    if (typeof d.userId !== "string" || !d.userId) {
      throw new Error("userId required");
    }
    const metadata =
      d.metadata && typeof d.metadata === "object" && !Array.isArray(d.metadata)
        ? (d.metadata as Record<string, unknown>)
        : {};
    return { event: d.event, userId: d.userId, metadata };
  })
  .handler(async ({ data }) => {
    try {
      await qInsertTrackingEvent(data.userId, data.event, data.metadata);
    } catch (err) {
      // Never surface tracking errors to the caller.
      console.error("[tracking] write failed:", err);
      return { ok: false };
    }
    // Admin-Benachrichtigung (intern) bei Registrierung eines ANDEREN Nutzers:
    // Nur informativ (user_id + Zeitstempel), KEIN Kontakt zum neuen Nutzer und
    // KEINE Owner-Aktivität. Kanal: dieselbe JSONL-Notification-Queue wie der
    // bestehende Beta-Signup-Flow (/home/team/shared/beta-notifications.jsonl).
    if (data.event === "user_registered" && data.userId !== OWNER_USER_ID) {
      try {
        const fs = await import("fs");
        fs.appendFileSync(
          "/home/team/shared/beta-notifications.jsonl",
          JSON.stringify({
            kind: "new_beta_user",
            user_id: data.userId,
            ts: new Date().toISOString(),
          }) + "\n",
        );
        console.log(
          `[tracking] admin-notify: new beta user registered (${data.userId})`,
        );
      } catch (err) {
        // Queue file unavticable (e.g. read-only/ephemeral FS on Vercel) — the
        // event itself is already recorded; notification is best-effort.
        console.error("[tracking] admin-notify failed:", err);
      }
    }
    return { ok: true };
  });

export type { TrackedEvent };
