import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "~/i18n";
import { useState, useEffect, useCallback } from "react";

export const Route = createFileRoute("/app/beta-welcome")({
  component: BetaWelcomePage,
});

const STORAGE_KEY = "growimo_beta_checklist";
const CHECKLIST_ITEMS = 4;

function loadChecklist(): boolean[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length === CHECKLIST_ITEMS) {
        return parsed.map((v) => Boolean(v));
      }
    }
  } catch {
    // ignore
  }
  return [false, false, false, false];
}

function saveChecklist(state: boolean[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

const checklistKeys = [
  "beta_checklist_1",
  "beta_checklist_2",
  "beta_checklist_3",
  "beta_checklist_4",
] as const;

const benefitIcons = ["🎁", "💬", "🏷️", "🚀"];
const benefitTitleKeys = [
  "beta_benefit1_title",
  "beta_benefit2_title",
  "beta_benefit3_title",
  "beta_benefit4_title",
] as const;
const benefitTextKeys = [
  "beta_benefit1_text",
  "beta_benefit2_text",
  "beta_benefit3_text",
  "beta_benefit4_text",
] as const;

function BetaWelcomePage() {
  const { t } = useTranslation();
  const [checked, setChecked] = useState<boolean[]>(loadChecklist);

  useEffect(() => {
    saveChecklist(checked);
  }, [checked]);

  const toggleItem = useCallback((index: number) => {
    setChecked((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  }, []);

  const checkedCount = checked.filter(Boolean).length;
  const progressPercent = (checkedCount / CHECKLIST_ITEMS) * 100;
  const allDone = checkedCount === CHECKLIST_ITEMS;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-white to-gray-50">
      {/* Subtle background decoration */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-blue-100/40 blur-3xl" />
        <div className="absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-purple-100/30 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-3xl px-4 py-16 sm:py-20">
        {/* ── Section 1: Header ──────────────────────────────────────── */}
        <div className="mb-12 text-center">
          <h1 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">
            {t.beta_welcome_title}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-500">
            {t.beta_welcome_subtitle}
          </p>
        </div>

        {/* ── Section 2: Benefit Cards ───────────────────────────────── */}
        <div className="mb-16 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {benefitTitleKeys.map((titleKey, i) => (
            <div
              key={titleKey}
              className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <div className="mb-3 text-3xl">{benefitIcons[i]}</div>
              <h3 className="text-lg font-semibold text-gray-900">
                {t[titleKey]}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {t[benefitTextKeys[i]]}
              </p>
            </div>
          ))}
        </div>

        {/* ── Section 3: Checklist with Progress ─────────────────────── */}
        <div className="mb-16">
          <h2 className="mb-6 text-center text-xl font-bold text-gray-900">
            {t.beta_checklist_title}
          </h2>

          {/* Progress bar */}
          <div className="mb-6 flex items-center gap-3">
            <div className="h-3 flex-1 rounded-full bg-gray-200">
              <div
                className="h-3 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-sm font-semibold text-gray-600 tabular-nums">
              {progressPercent}% {t.beta_checklist_done}
            </span>
          </div>

          {/* Checklist items */}
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            {checklistKeys.map((key, i) => {
              const isChecked = checked[i];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleItem(i)}
                  className={`flex w-full items-center gap-4 px-5 py-3 text-left transition ${
                    i < CHECKLIST_ITEMS - 1 ? "border-b border-gray-100" : ""
                  }`}
                >
                  {/* Custom checkbox */}
                  <div
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition ${
                      isChecked
                        ? "border-blue-500 bg-blue-500"
                        : "border-gray-200 bg-white hover:border-blue-300"
                    }`}
                  >
                    {isChecked && (
                      <svg
                        className="h-3 w-3 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>
                  <span
                    className={`text-sm font-medium transition ${
                      isChecked
                        ? "text-gray-400 line-through"
                        : "text-gray-700"
                    }`}
                  >
                    {t[key]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* All done celebration */}
          {allDone && (
            <div className="mt-6 animate-bounce text-center text-lg font-semibold text-blue-600">
              {t.beta_checklist_all_done}
            </div>
          )}
        </div>

        {/* ── Section 4: CTA ─────────────────────────────────────────── */}
        <div className="text-center">
          <Link
            to="/app"
            className="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-8 py-4 text-lg font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl hover:from-blue-700 hover:to-purple-700 sm:w-auto"
          >
            {t.beta_welcome_cta}
          </Link>
          <p className="mt-4 text-sm text-gray-400">
            {t.beta_footer_note}
          </p>
        </div>
      </div>
    </div>
  );
}
