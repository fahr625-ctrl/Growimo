import type { Translations } from '~/i18n';

/**
 * Localized relative time label ("3 min ago") for a date or ISO string.
 * Uses the shared dashboard_time_* i18n keys; falls back to formatDate()
 * for dates older than a week.
 */
export function timeAgo(date: Date | string, t: Translations, locale: string = 'de'): string {
  const parsed = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - parsed.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffSecs < 60) return t.dashboard_time_just_now;
  if (diffMins < 60) return t.dashboard_time_min_ago.replace('%d', String(diffMins));
  if (diffHours < 24) return t.dashboard_time_hour_ago.replace('%d', String(diffHours));
  if (diffDays === 1) return t.dashboard_time_yesterday;
  if (diffDays < 7) return t.dashboard_time_day_ago.replace('%d', String(diffDays));
  return formatDate(parsed, locale);
}

/** Locale-aware short date ("12. Aug." / "Aug 12"). */
export function formatDate(date: Date | string, locale: string = 'de'): string {
  const parsed = typeof date === 'string' ? new Date(date) : date;
  return parsed.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  });
}

/** Locale-aware full date with time ("12. August 2026, 10:30"). */
export function formatDateTime(date: Date | string, locale: string = 'de'): string {
  const parsed = typeof date === 'string' ? new Date(date) : date;
  return parsed.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
