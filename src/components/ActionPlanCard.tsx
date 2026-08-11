import { useEffect, useMemo, useState } from 'react';
import type { ContentType } from '~/ai/types';
import { buildActionPlan } from '~/ai/action-plans';
import { useTranslation } from '~/i18n';

export interface ActionPlanAsset {
  channel: ContentType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

/**
 * F5 Kanal-Aktionspläne: collapsible "🚀 Aktionsplan" section under an asset /
 * score card. The plan is computed synchronously client-side (pure function,
 * no LLM, no server call) and rendered as numbered steps with checkboxes
 * (local state). Each step shows the action bold, the detail normal and the
 * done criterion as "✓ Fertig, wenn: …". Renders nothing for channels without
 * a plan builder (social, newsletter, …).
 */
export function ActionPlanCard({ asset }: { asset: ActionPlanAsset }) {
  const { t } = useTranslation();
  const plan = useMemo(
    () =>
      buildActionPlan({
        channel: asset.channel,
        title: asset.title,
        body: asset.body,
        metadata: asset.metadata ?? {},
      }),
    [asset.channel, asset.title, asset.body, asset.metadata],
  );
  const [expanded, setExpanded] = useState(false);
  const [checked, setChecked] = useState<boolean[]>([]);

  // Reset checkboxes whenever a (new) plan is built — e.g. after "Verbessern"
  // swapped in improved content, the old checkmarks must not carry over.
  useEffect(() => {
    setChecked(plan ? plan.plan.map(() => false) : []);
  }, [plan]);

  if (!plan || plan.plan.length === 0) return null;

  const doneCount = checked.filter(Boolean).length;
  const allDone = plan.plan.length > 0 && doneCount === plan.plan.length;
  const toggle = (idx: number) =>
    setChecked((prev) => prev.map((v, i) => (i === idx ? !v : v)));

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-br from-white to-emerald-50/40">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-emerald-50/60"
      >
        <span className="flex-shrink-0 text-lg">🚀</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900">{t.action_plan_title}</p>
          <p className="truncate text-xs text-gray-500">{t.action_plan_subtitle}</p>
        </div>
        {doneCount > 0 && (
          <span
            className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
              allDone ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            {t.action_plan_progress.replace('%d1', String(doneCount)).replace('%d2', String(plan.plan.length))}
          </span>
        )}
        <svg
          className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-emerald-100 px-4 py-3">
          <ol className="space-y-2.5">
            {plan.plan.map((s, idx) => {
              const done = checked[idx] ?? false;
              return (
                <li
                  key={`${s.step}-${s.action}`}
                  className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                    done
                      ? 'border-emerald-200 bg-emerald-50/70'
                      : 'border-gray-100 bg-white'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(idx)}
                    aria-pressed={done}
                    className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-all ${
                      done
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-gray-300 bg-white text-transparent hover:border-emerald-400'
                    }`}
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-gray-900">{s.action}</span>
                      {done && (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                          ✓
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm leading-relaxed text-gray-700">{s.detail}</p>
                    <p className="mt-1 text-xs font-medium text-emerald-700">
                      ✓ {t.action_plan_done_label} <span className="font-normal text-gray-600">{s.doneCriteria}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 flex items-center justify-between">
            {allDone ? (
              <p className="text-sm font-semibold text-emerald-700">{t.action_plan_all_done}</p>
            ) : (
              <span className="text-xs text-gray-400">
                {t.action_plan_progress.replace('%d1', String(doneCount)).replace('%d2', String(plan.plan.length))}
              </span>
            )}
            {doneCount > 0 && (
              <button
                type="button"
                onClick={() => setChecked(plan.plan.map(() => false))}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50"
              >
                {t.action_plan_reset}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
