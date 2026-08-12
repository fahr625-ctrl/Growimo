import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { getPreferencesServer, resetPreferencesServer } from '~/ai/server';
import type { UserPreferencesView } from '~/ai/types';
import { useTranslation } from '~/i18n';
import { getContentTypeConfig } from '~/ai/content-types';

/**
 * F10 "Meine Präferenzen" — Panel auf dem Performance-Dashboard. Zeigt die
 * gelernte Präferenz-View NUR, wenn genug Signale vorliegen (Stichproben-Gate),
 * sonst einen ehrlichen Fortschritts-Hinweis. Mit Reset-Option.
 */
export function PreferencesCard({ onChanged }: { onChanged?: () => void }) {
  const { user } = useUser();
  const uid = user?.id ?? 'anonymous';
  const { t } = useTranslation();
  const tLookup = t as unknown as Record<string, string>;
  const [prefs, setPrefs] = useState<UserPreferencesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const reload = useCallback(async () => {
    if (!uid) return;
    try {
      const view = await getPreferencesServer({ data: { userId: uid } });
      setPrefs(view);
    } catch (err) {
      console.error('Failed to load preferences:', err);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    setLoading(true);
    reload().catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const handleReset = useCallback(async () => {
    if (!uid) return;
    try {
      await resetPreferencesServer({ data: { userId: uid } });
      setResetDone(true);
      setConfirmReset(false);
      await reload();
      onChanged?.();
      setTimeout(() => setResetDone(false), 3500);
    } catch (err) {
      console.error('resetPreferences failed:', err);
    }
  }, [uid, reload, onChanged]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="animate-pulse text-sm text-gray-400">{tLookup.common_loading}</p>
      </div>
    );
  }

  const total = prefs?.totalSignals ?? 0;

  return (
    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-violet-50/40 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900">{tLookup.learn_title}</h2>
          <p className="mt-0.5 max-w-md text-xs leading-relaxed text-gray-500">{tLookup.learn_subtitle}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
          🧠 {tLookup.learn_badge}
        </span>
      </div>

      {resetDone && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
          {tLookup.learn_reset_done}
        </p>
      )}

      {/* ── Zu wenige Signale: ehrlicher Fortschritt ── */}
      {total === 0 && (
        <p className="mt-3 text-sm text-gray-600">{tLookup.learn_no_data_desc.replace('{min}', '3')}</p>
      )}
      {total > 0 && prefs && !prefs.enoughData && (
        <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5">
          <p className="text-xs font-bold text-amber-800">{tLookup.learn_no_data}</p>
          <p className="mt-1 text-xs text-amber-700">
            {tLookup.learn_progress.replace('{n}', String(total)).replace('{min}', '3')}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
              style={{ width: `${Math.min(100, (total / 3) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Genug Daten: gelerntes Profil ── */}
      {prefs && prefs.enoughData && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-gray-400">
              {tLookup.learn_signals.replace('{likes}', String(prefs.likes)).replace('{dislikes}', String(prefs.dislikes))}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <PrefItem label={tLookup.learn_tone_title} value={toneLabel(tLookup, prefs.preferredTone)} empty={tLookup.learn_no_pref} />
            <PrefItem label={tLookup.learn_format_title} value={formatLabel(tLookup, prefs.preferredFormat)} empty={tLookup.learn_no_pref} />
            <PrefItem label={tLookup.learn_channel_title} value={channelLabel(tLookup, prefs.preferredChannel)} empty={tLookup.learn_no_pref} />
          </div>
        </div>
      )}

      {/* ── Reset ── */}
      {total > 0 && (
        <div className="mt-4 border-t border-indigo-100 pt-3">
          {confirmReset ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-600">{tLookup.learn_reset_confirm}</span>
              <button
                type="button"
                onClick={() => void handleReset()}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-rose-700"
              >
                {tLookup.learn_reset}
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-100"
              >
                {tLookup.common_cancel ?? 'Abbrechen'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="text-xs font-semibold text-gray-400 underline-offset-2 hover:text-rose-600 hover:underline"
            >
              ↺ {tLookup.learn_reset}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PrefItem({ label, value, empty }: { label: string; value: string | null; empty: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-sm font-bold text-gray-900">{value ?? <span className="font-medium text-gray-400">{empty}</span>}</p>
    </div>
  );
}

function toneLabel(t: Record<string, string>, tone: string | null): string | null {
  if (!tone) return null;
  return t[`learn_tone_${tone}`] ?? tone;
}

function formatLabel(t: Record<string, string>, format: string | null): string | null {
  if (!format) return null;
  return t[`learn_format_${format}`] ?? format;
}

function channelLabel(t: Record<string, string>, channel: string | null): string | null {
  if (!channel) return null;
  const cfg = getContentTypeConfig(channel as never);
  if (cfg?.label) return `${cfg.icon} ${cfg.label}`;
  return channel;
}
