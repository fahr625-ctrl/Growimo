// ── Server-side beta-tracking configuration (additive, NO PII in events) ─────
// This is the shared config used by both the client helper (src/lib/tracking-client)
// and the server-side tracking API / server fn. It carries no import side-effects
// so it is safe for the client bundle.
//
// Privacy contract (owner requirement):
//  - Events store ONLY { user_id (Clerk id, TEXT), event, created_at, metadata }.
//  - NO emails, NO avatars, NO names, NO content of projects/postings/images/pins.
//  - metadata is limited to harmless contextual values (channel, aspectRatio,
//    page, source). No content payloads.
export const OWNER_USER_ID = "user_3H2trJXHwzXmJF2XTGQ2PMEwjkD";

// Users whose activity is treated as "internal / test" (the owner's own testing).
// The admin dashboard hides these by default via its "hide own test activity"
// toggle. Hiding is implemented as an exclusion FILTER on the aggregate queries,
// which is the cleanest approach the owner approved ("separat gekennzeichnet
// oder ausgeschlossen — Ausschließen (Filter) ist am saubersten").
export const TEST_USER_IDS: string[] = [OWNER_USER_ID];

// The exact, owner-specified event vocabulary. Keep names stable — they are the
// contract for the admin report and funnel.
export const TRACKED_EVENTS = [
  "user_registered",
  "user_login",
  "project_created",
  "image_studio_opened",
  "image_generated",
  "pinterest_pin_created",
  "package_or_pricing_opened",
  "upgrade_clicked",
  "tiktok_area_opened",
  "tiktok_created",
  "tiktok_diagnosed",
] as const;

export type TrackedEvent = (typeof TRACKED_EVENTS)[number];

export function isTrackedEvent(e: string): e is TrackedEvent {
  return (TRACKED_EVENTS as readonly string[]).includes(e);
}

// The deepest "Erstellung"-proxy stage we actually record. We have NO anonymous
// website-visit event (the existing analytics is localStorage-only and not part
// of this system), so the funnel is defined as registered → project → created
// asset (image generated OR pin created), all real, all server-side/user-scoped.
export const FUNNEL_STAGES = [
  "user_registered",
  "project_created",
  "asset_created",
] as const;
