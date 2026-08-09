import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from '~/i18n';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ParsedTask {
  text: string;
  priority: 'Sehr hoch' | 'Hoch' | 'Mittel' | 'Niedrig';
  time: string;
  impact: string;
  reason: string;
  done: boolean;
}

interface CategoryMap {
  today: number[];    // task indices (0-based)
  thisWeek: number[];
  optional: number[];
}

interface ParsedMission {
  missionTitle: string;
  progress: number;
  tasks: ParsedTask[];
  biggestLever: string;
  currentScore: number;
  expectedScore: number;
  categories: CategoryMap;
}

// ── Priority color helpers ─────────────────────────────────────────────────────

function priorityBadgeColor(priority: string) {
  switch (priority) {
    case 'Sehr hoch': return 'bg-red-100 text-red-700 border-red-200';
    case 'Hoch': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'Mittel': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'Niedrig': return 'bg-gray-100 text-gray-600 border-gray-200';
    default: return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

// ── Parser ─────────────────────────────────────────────────────────────────────

function parseMission(missionText: string): ParsedMission | null {
  try {
    // Mission title
    const titleMatch = missionText.match(/\*\*Mission des Tages:\*\*\s*(.+?)(?:\n|$)/);
    const missionTitle = titleMatch?.[1]?.trim() ?? '';

    // Progress
    const progressMatch = missionText.match(/\*\*Fortschritt:\*\*\s*(\d+)\s*\/\s*100/);
    const progress = progressMatch ? parseInt(progressMatch[1]) : 0;

    // Tasks
    const tasks: ParsedTask[] = [];
    const taskRegex = /-\s*\[ \]\s*\*\*(.+?)\*\*\s*\|\s*Priorität:\s*(Sehr hoch|Hoch|Mittel|Niedrig)\s*\|\s*⏱\s*(.+?)\s*\|\s*Wirkung:\s*(★+[★☆]*)\s*\|\s*(.+?)(?:\n|$)/g;
    let taskMatch;
    while ((taskMatch = taskRegex.exec(missionText)) !== null) {
      tasks.push({
        text: taskMatch[1].trim(),
        priority: taskMatch[2] as ParsedTask['priority'],
        time: taskMatch[3].trim(),
        impact: taskMatch[4].trim(),
        reason: taskMatch[5].trim(),
        done: false,
      });
    }

    // Biggest lever
    const leverMatch = missionText.match(/\*\*Größter Hebel heute:\*\*\s*(.+?)(?:\n\*\*|$)/s);
    const biggestLever = leverMatch?.[1]?.trim() ?? '';

    // Scores
    const currentScoreMatch = missionText.match(/Aktueller Score:\s*(\d+)\s*\/\s*100/);
    const expectedScoreMatch = missionText.match(/Erwarteter Score nach Umsetzung:\s*(\d+)\s*\/\s*100/);
    const currentScore = currentScoreMatch ? parseInt(currentScoreMatch[1]) : 0;
    const expectedScore = expectedScoreMatch ? parseInt(expectedScoreMatch[1]) : 0;

    // Category mapping
    const categories: CategoryMap = { today: [], thisWeek: [], optional: [] };

    const todayMatch = missionText.match(/Heute erledigen:\s*(.+?)(?:\n|$)/);
    if (todayMatch) {
      const nums = todayMatch[1].match(/Aufgabe\s*(\d+)/g);
      if (nums) categories.today = nums.map((n) => parseInt(n.replace(/\D/g, '')) - 1);
    }

    const weekMatch = missionText.match(/Diese Woche:\s*(.+?)(?:\n|$)/);
    if (weekMatch) {
      const nums = weekMatch[1].match(/Aufgabe\s*(\d+)/g);
      if (nums) categories.thisWeek = nums.map((n) => parseInt(n.replace(/\D/g, '')) - 1);
    }

    const optMatch = missionText.match(/Optional:\s*(.+?)(?:\n|$)/);
    if (optMatch) {
      const nums = optMatch[1].match(/Aufgabe\s*(\d+)/g);
      if (nums) categories.optional = nums.map((n) => parseInt(n.replace(/\D/g, '')) - 1);
    }

    return {
      missionTitle,
      progress,
      tasks,
      biggestLever,
      currentScore,
      expectedScore,
      categories,
    };
  } catch {
    return null;
  }
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface MarketingMissionProps {
  missionText: string;
  projectId: string | null;
}

export default function MarketingMission({ missionText, projectId }: MarketingMissionProps) {
  const { t } = useTranslation();
  const storageKey = `growimo_mission_tasks_${projectId ?? 'unknown'}`;

  const parsed = useMemo(() => parseMission(missionText), [missionText]);

  // Task done states, persisted in localStorage
  const [taskStates, setTaskStates] = useState<boolean[]>(() => {
    if (!parsed) return [];
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as boolean[];
        if (saved.length === parsed.tasks.length) return saved;
      }
    } catch { /* ignore */ }
    return parsed.tasks.map(() => false);
  });

  // Persist to localStorage whenever taskStates change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(taskStates));
    } catch { /* ignore */ }
  }, [taskStates, storageKey]);

  // Update taskStates if parsed.tasks length changes
  useEffect(() => {
    if (parsed && taskStates.length !== parsed.tasks.length) {
      setTaskStates(parsed.tasks.map(() => false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed?.tasks.length]);

  const toggleTask = useCallback((index: number) => {
    setTaskStates((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  }, []);

  if (!parsed || parsed.tasks.length === 0) return null;

  const completedCount = taskStates.filter(Boolean).length;
  const totalTasks = parsed.tasks.length;

  // Build tasks enriched with done state
  const enrichedTasks = parsed.tasks.map((task, i) => ({
    ...task,
    done: taskStates[i] ?? false,
  }));

  // Group tasks by category
  const todayTasks = parsed.categories.today
    .map((i) => enrichedTasks[i])
    .filter(Boolean);
  const thisWeekTasks = parsed.categories.thisWeek
    .map((i) => enrichedTasks[i])
    .filter(Boolean);
  const optionalTasks = parsed.categories.optional
    .map((i) => enrichedTasks[i])
    .filter(Boolean);

  // Fallback grouping if categories are empty: first 2 today, next 3 thisWeek, last optional
  const hasCategories = todayTasks.length > 0 || thisWeekTasks.length > 0 || optionalTasks.length > 0;
  const fallbackToday = hasCategories ? todayTasks : enrichedTasks.slice(0, 2);
  const fallbackThisWeek = hasCategories ? thisWeekTasks : enrichedTasks.slice(2, 5);
  const fallbackOptional = hasCategories ? optionalTasks : enrichedTasks.slice(5);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* ── a) Hero Card ─────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-3xl bg-gradient-to-r from-blue-600 to-purple-600 p-8 shadow-lg">
        <h2 className="text-xl font-bold text-white mb-4">
          {String(t.mission_title ?? '🎯 Marketing Mission des Tages')}
        </h2>
        <p className="text-2xl font-extrabold text-white mb-6 leading-tight">
          {parsed.missionTitle}
        </p>
        {/* Progress bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-3 rounded-full bg-white/20 overflow-hidden">
            <div
              className="h-full rounded-full bg-white transition-all duration-700 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, parsed.progress))}%` }}
            />
          </div>
          <span className="text-sm font-bold text-white tabular-nums">
            {parsed.progress}/100
          </span>
        </div>
      </div>

      {/* ── b) Task List ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-800">
            {String(t.mission_tasks ?? 'Aufgaben')}
          </h3>
        </div>

        <div className="divide-y divide-gray-50">
          {/* Heute erledigen */}
          {fallbackToday.length > 0 && (
            <div>
              <div className="px-6 py-3 bg-blue-50/50">
                <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">
                  {String(t.mission_today ?? 'Heute erledigen')}
                </p>
              </div>
              {fallbackToday.map((task, idx) => (
                <TaskRow
                  key={`today-${idx}`}
                  task={task}
                  index={enrichedTasks.indexOf(task)}
                  onToggle={toggleTask}
                />
              ))}
            </div>
          )}

          {/* Diese Woche */}
          {fallbackThisWeek.length > 0 && (
            <div>
              <div className="px-6 py-3 bg-amber-50/50">
                <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">
                  {String(t.mission_this_week ?? 'Diese Woche')}
                </p>
              </div>
              {fallbackThisWeek.map((task, idx) => (
                <TaskRow
                  key={`week-${idx}`}
                  task={task}
                  index={enrichedTasks.indexOf(task)}
                  onToggle={toggleTask}
                />
              ))}
            </div>
          )}

          {/* Optional */}
          {fallbackOptional.length > 0 && (
            <div>
              <div className="px-6 py-3 bg-gray-50">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                  {String(t.mission_optional ?? 'Optional')}
                </p>
              </div>
              {fallbackOptional.map((task, idx) => (
                <TaskRow
                  key={`opt-${idx}`}
                  task={task}
                  index={enrichedTasks.indexOf(task)}
                  onToggle={toggleTask}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── c) Progress section ──────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-gray-700">
            {completedCount} {String(t.mission_progress ?? 'von 6 Aufgaben erledigt')}
          </span>
          <span className="text-sm font-bold text-blue-600">
            {totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0}%
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500 ease-out"
            style={{ width: `${totalTasks > 0 ? (completedCount / totalTasks) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* ── d) "Größter Hebel heute" Card ────────────────────────────────────── */}
      {parsed.biggestLever && (
        <div className="rounded-2xl border-l-4 border-emerald-400 bg-emerald-50 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 text-xl">💡</span>
            <div>
              <p className="text-sm font-bold text-emerald-800 mb-1">
                {String(t.mission_biggest_lever ?? '💡 Größter Hebel heute')}
              </p>
              <p className="text-sm leading-relaxed text-emerald-700">
                {parsed.biggestLever}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── e) "Was passiert nach der Optimierung?" Card ─────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h4 className="text-sm font-bold text-gray-800 mb-4">
          {String(t.mission_before_after ?? 'Was passiert nach der Optimierung?')}
        </h4>
        <div className="flex items-center justify-center gap-4 sm:gap-8">
          {/* Current */}
          <div className="flex flex-col items-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-amber-300 bg-amber-50">
              <span className="text-2xl font-extrabold text-amber-600">{parsed.currentScore}</span>
            </div>
            <p className="mt-2 text-xs font-semibold text-gray-500">
              {String(t.mission_current ?? 'Aktuell')}
            </p>
          </div>

          {/* Arrow */}
          <svg className="h-8 w-8 flex-shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>

          {/* Expected */}
          <div className="flex flex-col items-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-emerald-400 bg-emerald-50">
              <span className="text-2xl font-extrabold text-emerald-600">{parsed.expectedScore}</span>
            </div>
            <p className="mt-2 text-xs font-semibold text-gray-500">
              {String(t.mission_expected ?? 'Nach Optimierung')}
            </p>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-gray-500">
          {String(t.mission_after_text ?? 'Durch Umsetzung der priorisierten Aufgaben kannst du deinen Score verbessern.')}
        </p>
      </div>
    </div>
  );
}

// ── Task Row Sub-component ─────────────────────────────────────────────────────

function TaskRow({
  task,
  index,
  onToggle,
}: {
  task: ParsedTask & { done: boolean };
  index: number;
  onToggle: (index: number) => void;
}) {
  return (
    <div
      className={`px-6 py-4 transition-colors hover:bg-gray-50 ${
        task.done ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          type="button"
          onClick={() => onToggle(index)}
          className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border-2 transition-all ${
            task.done
              ? 'border-blue-500 bg-blue-500 text-white'
              : 'border-gray-200 bg-white hover:border-blue-300'
          }`}
        >
          {task.done && (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span
              className={`text-sm font-medium ${
                task.done ? 'line-through text-gray-400' : 'text-gray-900'
              }`}
            >
              {task.text}
            </span>
            {/* Priority badge */}
            <span
              className={`inline-flex flex-shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${priorityBadgeColor(task.priority)}`}
            >
              {task.priority}
            </span>
            {/* Time pill */}
            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              ⏱ {task.time}
            </span>
            {/* Impact stars */}
            <span className="inline-flex flex-shrink-0 items-center text-xs text-amber-500">
              {task.impact}
            </span>
          </div>
          {/* Reason */}
          <p className="text-xs text-gray-500 leading-relaxed">{task.reason}</p>
        </div>
      </div>
    </div>
  );
}
