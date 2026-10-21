import { ArrowRight, FileText, Layers } from 'lucide-react';
import { useI18n } from '../../i18n/index.jsx';
import { formatDate } from '../../lib/format.js';
import { DeadlineBadge, Money, WatchStar } from './parts.jsx';

/** One result row. Uses the tender-card styles from styles.css. */
export default function TenderCard({ tender: t, onOpen, onToggleWatch, busy, compact = false }) {
  const { t: tr, lang } = useI18n();
  const location = [t.city, t.state].filter(Boolean).join(', ');
  return (
    <article className={`tender-item-card ${compact ? 'compact' : ''}`}>
      <div className="tender-card-selectors">
        <WatchStar watched={t.watchlisted} busy={busy} onToggle={() => onToggleWatch(t)} />
      </div>

      <div className="tender-card-content">
        <div className="tender-card-meta-line">
          <span className="tender-id-label">{t.ref}</span>
          {t.department && <span className="dept-badge-pill">{t.department}</span>}
          {location && <span className="state-location-text">{location}</span>}
          <DeadlineBadge deadline={t.deadline} status={t.status} />
        </div>
        <h3 className="tender-card-headline" role="button" tabIndex={0} onClick={() => onOpen(t)}
          onKeyDown={(e) => { if (e.key === 'Enter') onOpen(t); }}>
          {t.title}
        </h3>
        {!compact && t.snippet && <p className="tender-snippet-desc">{t.snippet}</p>}
        {!compact && <div className="tender-tags-row">
          {t.category && <span className="tender-category-tag procure">{t.category}</span>}
          {t.tenderType && <span className="tender-category-tag govt">{t.tenderType}</span>}
          {t.hasBoq && <span className="tender-category-tag open"><Layers size={11} style={{ verticalAlign: -1 }} /> {tr('tender.hasBoq')}</span>}
          {t.hasDocuments && <span className="tender-category-tag govt"><FileText size={11} style={{ verticalAlign: -1 }} /> {tr('tender.hasDocs')}</span>}
        </div>}
      </div>

      <div className="tender-card-metrics-strip">
        <div className="metric-column-item">
          <span className="metric-column-title">{tr('tender.estimated')}</span>
          <span className="metric-column-val tabular-nums"><Money value={t.estimatedValue} /></span>
        </div>
        {!compact && (
          <div className="metric-column-item">
            <span className="metric-column-title">{tr('tender.emd')}</span>
            <span className="metric-column-val tabular-nums"><Money value={t.emdAmount} exempted={t.emdStatus === 'exempted'} /></span>
          </div>
        )}
        <div className="metric-column-item">
          <span className="metric-column-title">{tr('tender.deadline')}</span>
          <span className="metric-column-val tabular-nums">{formatDate(t.deadline, lang)}</span>
        </div>
      </div>

      <div className="tender-card-buttons-stack">
        <button type="button" className="btn-view-details-blue" onClick={() => onOpen(t)}>
          <span>{tr('tender.view')}</span><ArrowRight size={13} />
        </button>
      </div>
    </article>
  );
}
