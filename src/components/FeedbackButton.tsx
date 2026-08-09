import { useState, useCallback } from 'react';
import { useTranslation } from '~/i18n';
import { trackEvent } from '~/store/analytics';

const FEEDBACK_KEY = 'growimo_feedback';

export default function FeedbackButton() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState('');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(() => {
    if (text.trim().length < 3) {
      setError('Bitte gib mindestens 3 Zeichen ein.');
      return;
    }

    const feedback = {
      text: text.trim(),
      email: email.trim() || undefined,
      timestamp: new Date().toISOString(),
    };

    try {
      const existing = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '[]');
      existing.push(feedback);
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify(existing));
    } catch {
      // ignore storage errors
    }

    trackEvent('feedback_submitted');
    setSubmitted(true);
    setError('');
    setText('');
    setEmail('');

    // Auto-close after 3 seconds
    setTimeout(() => {
      setIsOpen(false);
      setSubmitted(false);
    }, 3000);
  }, [text, email]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setSubmitted(false);
    setError('');
  }, []);

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-200 transition-all duration-300 hover:shadow-xl hover:scale-105 group ${
          isOpen ? 'opacity-0 pointer-events-none' : 'animate-pulse-slow'
        }`}
        title={t.feedback_button}
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        {/* Tooltip on hover */}
        <span className="absolute right-14 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-xl bg-gray-900 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 pointer-events-none">
          {t.feedback_button}
        </span>
      </button>

      {/* Feedback Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fadeIn">
          <div className="mx-4 w-full max-w-md animate-fadeIn rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            {/* Header */}
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  {t.feedback_title}
                </h3>
                <p className="mt-0.5 text-sm text-gray-500">
                  {t.feedback_subtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {submitted ? (
              <div className="rounded-xl bg-emerald-50 px-4 py-6 text-center">
                <span className="text-3xl">✅</span>
                <p className="mt-2 text-sm font-medium text-emerald-800">
                  {t.feedback_success}
                </p>
              </div>
            ) : (
              <>
                {/* Text input */}
                <div className="mb-4">
                  <textarea
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      if (error) setError('');
                    }}
                    placeholder={t.feedback_placeholder}
                    rows={4}
                    className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  {error && (
                    <p className="mt-1 text-xs text-red-500">{error}</p>
                  )}
                </div>

                {/* Email input */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-medium text-gray-600">
                    {t.feedback_email_label}{' '}
                    <span className="text-gray-400">
                      {t.feedback_email_optional}
                    </span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="deine@email.de"
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                {/* GDPR note */}
                <p className="mb-4 text-[11px] leading-relaxed text-gray-400">
                  {t.feedback_gdpr}
                </p>

                {/* Submit */}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={text.trim().length < 3}
                  className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t.feedback_submit}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
