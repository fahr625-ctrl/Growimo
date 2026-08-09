import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation } from '~/i18n';
import {
  saveRating,
  saveBugReport,
  saveFeatureRequest,
  saveLikes,
  type BugCategory,
  type RatingValue,
  type LikeOption,
} from '~/store/feedback';

export const Route = createFileRoute('/app/feedback')({
  component: FeedbackPage,
});

function FeedbackPage() {
  return (
    <ProtectedRoute>
      <FeedbackContent />
    </ProtectedRoute>
  );
}

// ── Star Rating Section ─────────────────────────────────────────────────────────

function RatingSection() {
  const { t } = useTranslation();
  const [rating, setRating] = useState<RatingValue | null>(null);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!rating) return;
    saveRating(rating, comment);
    setSubmitted(true);
  };

  const handleReset = () => {
    setRating(null);
    setHoverRating(0);
    setComment('');
    setSubmitted(false);
  };

  if (submitted) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">{t.fh_rating_title}</h2>
        <div className="mt-4 flex flex-col items-center justify-center py-6 text-center">
          <span className="text-2xl text-green-600 font-semibold">{t.fh_rating_success}</span>
          <button
            onClick={handleReset}
            className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            {t.fh_reset}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-gray-900">{t.fh_rating_title}</h2>
      <div className="mt-4 flex items-center gap-1">
        {([1, 2, 3, 4, 5] as RatingValue[]).map((star) => {
          const filled = star <= (hoverRating || rating || 0);
          return (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              className={`text-3xl transition-all cursor-pointer hover:scale-110 ${
                filled ? 'text-amber-400' : 'text-gray-300'
              }`}
              aria-label={`${star} Stern${star > 1 ? 'e' : ''}`}
            >
              {filled ? '★' : '☆'}
            </button>
          );
        })}
      </div>
      {rating && (
        <p className="mt-2 text-sm text-gray-600">
          {t.fh_rating_label.replace('X', String(rating))}
        </p>
      )}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={300}
        rows={3}
        placeholder={t.fh_rating_placeholder}
        className="mt-4 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-400 resize-vertical min-h-[100px]"
      />
      <p className="mt-1 text-xs text-gray-400 text-right">{comment.length}/300</p>
      <button
        onClick={handleSubmit}
        disabled={!rating}
        className="mt-3 w-full rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-blue-600 hover:to-purple-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {t.fh_rating_submit}
      </button>
    </div>
  );
}

// ── Bug Report Section ──────────────────────────────────────────────────────────

function BugReportSection() {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<BugCategory>('Bug');
  const [submitted, setSubmitted] = useState(false);

  const isValid = title.trim().length > 0 && description.trim().length >= 10;

  const handleSubmit = () => {
    if (!isValid) return;
    saveBugReport(title.trim(), description.trim(), category);
    setSubmitted(true);
  };

  const handleReset = () => {
    setTitle('');
    setDescription('');
    setCategory('Bug');
    setSubmitted(false);
  };

  if (submitted) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">{t.fh_bug_title}</h2>
        <div className="mt-4 flex flex-col items-center justify-center py-6 text-center">
          <span className="text-2xl text-green-600 font-semibold">{t.fh_bug_success}</span>
          <button
            onClick={handleReset}
            className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            {t.fh_reset}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-gray-900">{t.fh_bug_title}</h2>
      <div className="mt-4 space-y-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t.fh_bug_title_label}
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-400"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder={t.fh_bug_description_label}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-400 resize-vertical min-h-[100px]"
        />
        <p className="text-xs text-gray-400 text-right -mt-2">{description.length}/500</p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t.fh_bug_category_label}</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as BugCategory)}
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-400 bg-white"
          >
            <option value="Bug">{t.fh_bug_category_bug}</option>
            <option value="UX">{t.fh_bug_category_ux}</option>
            <option value="Performance">{t.fh_bug_category_perf}</option>
            <option value="Sonstiges">{t.fh_bug_category_other}</option>
          </select>
        </div>
        <button
          onClick={handleSubmit}
          disabled={!isValid}
          className="w-full rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-blue-600 hover:to-purple-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t.fh_bug_submit}
        </button>
      </div>
    </div>
  );
}

// ── Feature Request Section ─────────────────────────────────────────────────────

function FeatureRequestSection() {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [why, setWhy] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const isValid = title.trim().length > 0 && description.trim().length >= 10 && why.trim().length >= 10;

  const handleSubmit = () => {
    if (!isValid) return;
    saveFeatureRequest(title.trim(), description.trim(), why.trim());
    setSubmitted(true);
  };

  const handleReset = () => {
    setTitle('');
    setDescription('');
    setWhy('');
    setSubmitted(false);
  };

  if (submitted) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">{t.fh_feature_title}</h2>
        <div className="mt-4 flex flex-col items-center justify-center py-6 text-center">
          <span className="text-2xl text-green-600 font-semibold">{t.fh_feature_success}</span>
          <button
            onClick={handleReset}
            className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            {t.fh_reset}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-gray-900">{t.fh_feature_title}</h2>
      <div className="mt-4 space-y-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t.fh_feature_title_label}
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-400"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder={t.fh_feature_description_label}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-400 resize-vertical min-h-[100px]"
        />
        <p className="text-xs text-gray-400 text-right -mt-2">{description.length}/500</p>
        <textarea
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          maxLength={300}
          rows={3}
          placeholder={t.fh_feature_why_label}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-400 resize-vertical min-h-[100px]"
        />
        <p className="text-xs text-gray-400 text-right -mt-2">{why.length}/300</p>
        <button
          onClick={handleSubmit}
          disabled={!isValid}
          className="w-full rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-blue-600 hover:to-purple-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t.fh_feature_submit}
        </button>
      </div>
    </div>
  );
}

// ── Likes Section ───────────────────────────────────────────────────────────────

const LIKE_OPTIONS: { key: LikeOption; labelKey: string }[] = [
  { key: 'pinterest', labelKey: 'fh_likes_pinterest' },
  { key: 'etsy', labelKey: 'fh_likes_etsy' },
  { key: 'seo', labelKey: 'fh_likes_seo' },
  { key: 'social', labelKey: 'fh_likes_social' },
  { key: 'analysis', labelKey: 'fh_likes_analysis' },
  { key: 'dashboard', labelKey: 'fh_likes_dashboard' },
  { key: 'projects', labelKey: 'fh_likes_projects' },
];

function LikesSection() {
  const { t } = useTranslation();
  const [likes, setLikes] = useState<Set<LikeOption>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const toggleLike = (option: LikeOption) => {
    setLikes((prev) => {
      const next = new Set(prev);
      if (next.has(option)) {
        next.delete(option);
      } else {
        next.add(option);
      }
      return next;
    });
  };

  const handleSubmit = () => {
    saveLikes(Array.from(likes));
    setSubmitted(true);
  };

  const handleReset = () => {
    setLikes(new Set());
    setSubmitted(false);
  };

  if (submitted) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">{t.fh_likes_title}</h2>
        <div className="mt-4 flex flex-col items-center justify-center py-6 text-center">
          <span className="text-2xl text-green-600 font-semibold">{t.fh_likes_success}</span>
          <button
            onClick={handleReset}
            className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            {t.fh_reset}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-gray-900">{t.fh_likes_title}</h2>
      <div className="mt-4 grid grid-cols-1 gap-2">
        {LIKE_OPTIONS.map(({ key, labelKey }) => {
          const checked = likes.has(key);
          return (
            <label
              key={key}
              className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 cursor-pointer transition-all ${
                checked
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-200'
              }`}
            >
              <div
                className={`flex h-5 w-5 items-center justify-center rounded border-2 flex-shrink-0 transition-all ${
                  checked
                    ? 'border-blue-500 bg-blue-500'
                    : 'border-gray-200 bg-white'
                }`}
              >
                {checked && (
                  <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleLike(key)}
                className="sr-only"
              />
              <span className="text-sm text-gray-700 select-none">{t[labelKey as keyof typeof t]}</span>
            </label>
          );
        })}
      </div>
      <button
        onClick={handleSubmit}
        className="mt-4 w-full rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-blue-600 hover:to-purple-700"
      >
        {t.fh_likes_submit}
      </button>
    </div>
  );
}

// ── Main Feedback Content ───────────────────────────────────────────────────────

function FeedbackContent() {
  const { t } = useTranslation();

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-gray-900">{t.fh_title}</h1>
        <p className="mt-1 text-sm text-gray-500">{t.fh_subtitle}</p>
      </div>

      {/* 2×2 Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Top-left: Rating */}
        <RatingSection />

        {/* Top-right: Bug Report */}
        <BugReportSection />

        {/* Bottom-left: Feature Request */}
        <FeatureRequestSection />

        {/* Bottom-right: Likes */}
        <LikesSection />
      </div>
    </div>
  );
}
