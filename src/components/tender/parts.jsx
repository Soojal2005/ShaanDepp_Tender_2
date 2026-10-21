import { Star } from 'lucide-react';
import { useI18n } from '../../i18n/index.jsx';
import { formatInr, timeLeft } from '../../lib/format.js';

/** A rupee figure, or the explicit "not disclosed" label when the source did not publish it. */
export function Money({ value, exempted = false }) {
  const { t } = useI18n();
  if (exempted) return <span>{t('tender.exempted')}</span>;
  if (value === null || value === undefined) return <span className="not-disclosed-fallback">{t('common.notDisclosed')}</span>;
  return <span>{formatInr(value)}</span>;
}

export function DeadlineBadge({ deadline, status }) {
  const { t } = useI18n();
  const left = timeLeft(deadline);
  if (status && status !== 'Open') return <span className="urgency-badge slate">{status === 'Closed' ? t('tender.closed') : status}</span>;
  if (!left) return null;
  if (left.expired) return <span className="urgency-badge slate">{t('tender.closed')}</span>;
  const text = left.days >= 1
    ? t('tender.closesIn', { n: t('tender.daysShort', { n: left.days }) })
    : left.hours >= 1 ? t('tender.closesIn', { n: t('tender.hoursShort', { n: left.hours }) }) : t('tender.closesToday');
  return <span className={`urgency-badge ${left.level}`}>{text}</span>;
}

export function WatchStar({ watched, onToggle, busy }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={`card-star-btn ${watched ? 'saved' : ''}`}
      aria-pressed={watched}
      aria-label={watched ? t('tender.unwatch') : t('tender.watch')}
      title={watched ? t('tender.unwatch') : t('tender.watch')}
      disabled={busy}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      <Star size={19} fill={watched ? 'currentColor' : 'none'} />
    </button>
  );
}
