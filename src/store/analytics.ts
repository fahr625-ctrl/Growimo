// ── Anonymous Event Tracking System ───────────────────────────────────────────────
// localStorage-based, GDPR-friendly by design: no external services, no personal
// data, no cookies beyond localStorage, no IP logging, no fingerprinting.
// Pure client-side only.

export type AnalyticsEvent =
  | 'signup'
  | 'signin'
  | 'strategy_created'
  | 'strategy_regenerated'
  | 'content_exported'
  | 'project_saved'
  | 'feedback_submitted'
  | 'onboarding_completed'
  | 'onboarding_skipped'
  | 'brand_profile_saved';

export interface AnalyticsEntry {
  event: AnalyticsEvent;
  timestamp: string; // ISO
  metadata?: Record<string, string>;
}

export interface AnalyticsStats {
  totalEvents: number;
  eventCounts: Record<AnalyticsEvent, number>;
  uniqueDays: number;
  firstEventDate: string | null;
  lastEventDate: string | null;
}

const EVENTS_KEY = 'growimo_analytics_events';
const OPTOUT_KEY = 'growimo_analytics_optout';

// ── Helpers ──────────────────────────────────────────────────────────────────────

function loadEvents(): AnalyticsEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(EVENTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AnalyticsEntry[];
  } catch {
    return [];
  }
}

function saveEvents(events: AnalyticsEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  } catch {
    // localStorage may be full or unavailable
  }
}

// ── Public API ───────────────────────────────────────────────────────────────────

export function isAnalyticsEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(OPTOUT_KEY) !== 'true';
  } catch {
    return false;
  }
}

export function setAnalyticsEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (enabled) {
      localStorage.removeItem(OPTOUT_KEY);
    } else {
      localStorage.setItem(OPTOUT_KEY, 'true');
    }
  } catch {
    // ignore
  }
}

export function trackEvent(
  event: AnalyticsEvent,
  metadata?: Record<string, string>,
): void {
  if (!isAnalyticsEnabled()) return;

  const entry: AnalyticsEntry = {
    event,
    timestamp: new Date().toISOString(),
    metadata,
  };

  const events = loadEvents();
  events.push(entry);
  saveEvents(events);
}

export function getEvents(): AnalyticsEntry[] {
  return loadEvents();
}

export function getEventCount(event: AnalyticsEvent): number {
  return loadEvents().filter((e) => e.event === event).length;
}

export function getUniqueDays(): number {
  const events = loadEvents();
  const days = new Set<string>();
  for (const e of events) {
    days.add(e.timestamp.slice(0, 10)); // YYYY-MM-DD
  }
  return days.size;
}

export function getStats(): AnalyticsStats {
  const events = loadEvents();
  const eventCounts: Record<string, number> = {};

  let firstEventDate: string | null = null;
  let lastEventDate: string | null = null;

  for (const e of events) {
    eventCounts[e.event] = (eventCounts[e.event] || 0) + 1;

    const datePart = e.timestamp.slice(0, 10);
    if (!firstEventDate || datePart < firstEventDate) firstEventDate = datePart;
    if (!lastEventDate || datePart > lastEventDate) lastEventDate = datePart;
  }

  // Fill in zero counts for all known event types
  const allTypes: AnalyticsEvent[] = [
    'signup', 'signin', 'strategy_created', 'strategy_regenerated',
    'content_exported', 'project_saved', 'feedback_submitted',
    'onboarding_completed', 'onboarding_skipped', 'brand_profile_saved',
  ];
  const fullCounts = {} as Record<AnalyticsEvent, number>;
  for (const t of allTypes) {
    fullCounts[t] = eventCounts[t] || 0;
  }

  return {
    totalEvents: events.length,
    eventCounts: fullCounts,
    uniqueDays: getUniqueDays(),
    firstEventDate,
    lastEventDate,
  };
}

export function clearAnalytics(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(EVENTS_KEY);
  } catch {
    // ignore
  }
}
