// ── Feedback Hub Store ──────────────────────────────────────────────────────────────
// localStorage-backed store for all feedback types. Each feedback entry is stored
// in a shared array under the key 'growimo_feedback_hub'.

import { trackEvent } from '~/store/analytics';

export type BugCategory = 'Bug' | 'UX' | 'Performance' | 'Sonstiges';
export type RatingValue = 1 | 2 | 3 | 4 | 5;
export type LikeOption = 'pinterest' | 'etsy' | 'seo' | 'social' | 'analysis' | 'dashboard' | 'projects';

export interface RatingFeedback {
  type: 'rating';
  rating: RatingValue;
  comment: string;
  timestamp: string;
}

export interface BugReport {
  type: 'bug';
  title: string;
  description: string;
  category: BugCategory;
  timestamp: string;
}

export interface FeatureRequest {
  type: 'feature';
  title: string;
  description: string;
  why: string;
  timestamp: string;
}

export interface LikesFeedback {
  type: 'likes';
  likes: LikeOption[];
  timestamp: string;
}

export type FeedbackEntry = RatingFeedback | BugReport | FeatureRequest | LikesFeedback;

const STORAGE_KEY = 'growimo_feedback_hub';

// ── Helpers ──────────────────────────────────────────────────────────────────────

function loadEntries(): FeedbackEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as FeedbackEntry[];
  } catch {
    return [];
  }
}

function saveEntries(entries: FeedbackEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage may be full or unavailable
  }
}

// ── Public API ───────────────────────────────────────────────────────────────────

export function getAllFeedback(): FeedbackEntry[] {
  return loadEntries();
}

export function getFeedbackByType(type: string): FeedbackEntry[] {
  return loadEntries().filter((e) => e.type === type);
}

export function saveRating(rating: RatingValue, comment: string): void {
  const entry: RatingFeedback = {
    type: 'rating',
    rating,
    comment,
    timestamp: new Date().toISOString(),
  };
  const entries = loadEntries();
  entries.push(entry);
  saveEntries(entries);
  trackEvent('feedback_submitted', { type: 'rating' });
}

export function saveBugReport(title: string, description: string, category: BugCategory): void {
  const entry: BugReport = {
    type: 'bug',
    title,
    description,
    category,
    timestamp: new Date().toISOString(),
  };
  const entries = loadEntries();
  entries.push(entry);
  saveEntries(entries);
  trackEvent('feedback_submitted', { type: 'bug' });
}

export function saveFeatureRequest(title: string, description: string, why: string): void {
  const entry: FeatureRequest = {
    type: 'feature',
    title,
    description,
    why,
    timestamp: new Date().toISOString(),
  };
  const entries = loadEntries();
  entries.push(entry);
  saveEntries(entries);
  trackEvent('feedback_submitted', { type: 'feature' });
}

export function saveLikes(likes: LikeOption[]): void {
  const entry: LikesFeedback = {
    type: 'likes',
    likes,
    timestamp: new Date().toISOString(),
  };
  const entries = loadEntries();
  entries.push(entry);
  saveEntries(entries);
  trackEvent('feedback_submitted', { type: 'likes' });
}
