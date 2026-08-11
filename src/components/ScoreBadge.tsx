import { useTranslation } from '~/i18n';

export function scoreTone(total: number): 'red' | 'amber' | 'green' {
  if (total < 60) return 'red';
  if (total < 80) return 'amber';
  return 'green';
}

const TONE_CLASSES: Record<'red' | 'amber' | 'green', { badge: string; bar: string }> = {
  red: {
    badge: 'bg-red-50 text-red-700 border-red-200',
    bar: 'bg-red-500',
  },
  amber: {
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    bar: 'bg-amber-500',
  },
  green: {
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    bar: 'bg-emerald-500',
  },
};

/**
 * Compact color-coded score badge: red < 60, amber 60–79, green ≥ 80.
 * Renders "78/100" with a "Qualität" label in the current language.
 */
export function ScoreBadge({ total, size = 'md' }: { total: number; size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  const tone = scoreTone(total);
  const classes = TONE_CLASSES[tone].badge;
  const isSm = size === 'sm';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${classes} ${
        isSm ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
      }`}
      title={t.score_badge}
    >
      <span className="flex items-baseline gap-px">
        <span className={isSm ? 'text-xs' : 'text-sm'}>{total}</span>
        <span className={isSm ? 'text-[9px] opacity-60' : 'text-[10px] opacity-60'}>
          {t.score_points}
        </span>
      </span>
    </span>
  );
}

export { TONE_CLASSES };
