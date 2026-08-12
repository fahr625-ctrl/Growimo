import { useCallback, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { recordFeedbackServer } from '~/ai/server';
import { useTranslation } from '~/i18n';
import { trackEvent } from '~/store/analytics';

/**
 * F10 Persönliche Lernschleife: 👍/👎-Feedback auf ein generiertes Asset.
 * Speichert das Signal per User+Asset (Dedupe) — die deterministische
 * Präferenz-Ableitung steuert Ton & Format künftiger Generierungen.
 * Nie blockierend: Fehler → kompakter Hinweis, Inhalt bleibt unberührt.
 */

/** Stabile temp-Id für noch nicht gespeicherte Inhalte (Quick-Generator/Paket):
 * gleicher Titel+Body → gleiche Id → kein Doppel-Zählen im selben Verlauf. */
export function tempAssetId(title: string, body: string): string {
  let h = 5381;
  const s = `${title}|${body}`;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return `tmp-${h.toString(16)}`;
}

export function AssetFeedback({
  assetId,
  channel,
  title,
  body,
}: {
  assetId: string;
  channel: string;
  title: string;
  body: string;
}) {
  const { user } = useUser();
  const { t } = useTranslation();
  const tLookup = t as unknown as Record<string, string>;
  const [state, setState] = useState<{ kind: 'like' | 'dislike'; status: 'saving' | 'done' } | null>(null);
  const [error, setError] = useState(false);

  const send = useCallback(
    async (kind: 'like' | 'dislike') => {
      const uid = user?.id;
      if (!uid || state?.status === 'saving') return;
      setError(false);
      setState({ kind, status: 'saving' });
      try {
        await recordFeedbackServer({
          data: { userId: uid, assetId, kind, title, body, channel },
        });
        setState({ kind, status: 'done' });
        try {
          trackEvent('feedback_submitted', { type: kind === 'like' ? 'asset_like' : 'asset_dislike' });
        } catch {
          // ignore analytics errors
        }
      } catch (err) {
        console.error('[AssetFeedback] record failed:', err);
        setError(true);
        setState(null);
      }
    },
    [user?.id, assetId, title, body, channel, state?.status],
  );

  if (state?.status === 'done') {
    return (
      <p className="text-[11px] font-semibold text-emerald-700">
        {tLookup.learn_thanks}{' '}
        <span className="font-normal text-gray-400">· {tLookup.learn_steer_note}</span>
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold text-gray-500">{tLookup.learn_feedback_hint}</span>
      <button
        type="button"
        disabled={state?.status === 'saving'}
        onClick={() => void send('like')}
        title={tLookup.learn_like}
        className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 transition-all hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        👍 <span className="hidden sm:inline">{tLookup.learn_like}</span>
      </button>
      <button
        type="button"
        disabled={state?.status === 'saving'}
        onClick={() => void send('dislike')}
        title={tLookup.learn_dislike}
        className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 transition-all hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        👎 <span className="hidden sm:inline">{tLookup.learn_dislike}</span>
      </button>
      {error && <span className="text-[11px] font-medium text-amber-700">{tLookup.learn_error}</span>}
    </div>
  );
}
