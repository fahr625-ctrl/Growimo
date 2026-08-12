// ── F6 Strategie-Brief: aufklappbarer optionaler Fragebogen (Chips + Freitext) ─
// Wiederverwendet in QuickGenerator UND Paket-Flow. Der Brief ist optional:
// ohne Antworten verhält sich alles exakt wie bisher. Die Fragen/Optionen
// kommen aus src/ai/strategy-brief/questions.ts — EINE Quelle für UI und
// Prompt-Bau. Antworten leben im Parent (Record<key, value> + key_note für
// Freitext) und werden via onChange zurückgemeldet.

import { useCallback, useState } from 'react';
import { BRIEF_QUESTIONS, noteKeyOf } from '~/ai/strategy-brief/questions';
import type { BriefLang } from '~/ai/strategy-brief/questions';
import { hasBriefAnswers } from '~/ai/strategy-brief';
import { useTranslation } from '~/i18n';

export interface StrategyBriefProps {
  /** Aktuelle Antworten (Parent-State): { audience: 'young_parents', audience_note: '…' } */
  brief: Record<string, string>;
  /** Wird bei jeder Änderung mit dem kompletten neuen Brief aufgerufen. */
  onChange: (brief: Record<string, string>) => void;
  /** UI-Sprache (Optionen/Labels aus questions.ts, zweisprachig). */
  locale: BriefLang;
  /** Akzent-Gradient für Chips (z. B. 'from-blue-500 to-purple-600'). */
  accent?: string;
}

export function StrategyBrief({ brief, onChange, locale, accent = 'from-blue-500 to-purple-600' }: StrategyBriefProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const filled = hasBriefAnswers(brief);

  const toggleChip = useCallback(
    (questionKey: string, value: string) => {
      const next = { ...brief };
      if (next[questionKey] === value) {
        delete next[questionKey];
      } else {
        next[questionKey] = value;
      }
      onChange(next);
    },
    [brief, onChange],
  );

  const updateNote = useCallback(
    (questionKey: string, note: string) => {
      const next = { ...brief };
      if (note.trim()) {
        next[noteKeyOf(questionKey as Parameters<typeof noteKeyOf>[0])] = note;
      } else {
        delete next[noteKeyOf(questionKey as Parameters<typeof noteKeyOf>[0])];
      }
      onChange(next);
    },
    [brief, onChange],
  );

  const resetBrief = useCallback(() => {
    onChange({});
  }, [onChange]);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Header (click to toggle) */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50"
      >
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 text-lg">
          📋
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            {t.brief_title}
            {filled && (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                ✓ {t.brief_filled_badge}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-gray-500">{t.brief_subtitle}</span>
        </span>
        <svg
          className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="space-y-5 border-t border-gray-100 px-5 py-5">
          <p className="text-xs leading-relaxed text-gray-500">{t.brief_benefit}</p>

          {BRIEF_QUESTIONS.map((question) => (
            <div key={question.key}>
              <span className="mb-2 block text-sm font-semibold text-gray-700">
                {question.label[locale]}
                {question.optional && (
                  <span className="ml-1.5 text-xs font-normal text-gray-400">({t.brief_optional})</span>
                )}
              </span>
              <div className="flex flex-wrap gap-2">
                {question.options.map((option) => {
                  const active = brief[question.key] === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => toggleChip(question.key, option.value)}
                      className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-all ${
                        active
                          ? `bg-gradient-to-r ${accent} text-white shadow-sm`
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {option.label[locale]}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                value={brief[noteKeyOf(question.key)] ?? ''}
                onChange={(e) => updateNote(question.key, e.target.value)}
                placeholder={`${t.brief_freetext_placeholder} (${t.brief_optional})`}
                className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/20"
              />
            </div>
          ))}

          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={resetBrief}
              disabled={Object.keys(brief).length === 0}
              className="text-xs font-medium text-gray-400 transition-colors hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.brief_reset}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gray-100 px-4 py-2 text-xs font-semibold text-gray-600 transition-all hover:bg-gray-200"
            >
              {t.brief_skip} →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
