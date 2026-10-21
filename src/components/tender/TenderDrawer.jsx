import { useEffect, useState } from 'react';
import { ClipboardCheck, ExternalLink, Star, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Button, ErrorNote, Loading } from '../ui.jsx';
import RequestHelp from '../desk/RequestHelp.jsx';
import { useToast } from '../Toast.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime, formatInr } from '../../lib/format.js';
import { useAction, useAsync } from '../../lib/hooks.js';
import { DeadlineBadge, Money } from './parts.jsx';

const TABS = ['overview', 'boq', 'terms', 'documents', 'corrigenda'];

function Fact({ label, children }) {
  return (
    <div className="fact">
      <span className="fact-label">{label}</span>
      <span className="fact-value tabular-nums">{children}</span>
    </div>
  );
}

const Published = ({ value }) => {
  const { t } = useI18n();
  return value ? <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span> : <span className="not-disclosed-fallback">{t('tender.notPublished')}</span>;
};

/** Slide-in dossier for one tender. `onWatchChange` lets the list update its star without refetching. */
export default function TenderDrawer({ tenderId, onClose, onWatchChange }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState('overview');
  const [notes, setNotes] = useState('');
  const [askDesk, setAskDesk] = useState(false);
  const { user } = useAuth();
  const isClient = user.role === 'subscriber' || user.role === 'tenant_admin';
  const detail = useAsync(async () => {
    const { tender } = await api.get(`/tenders/${tenderId}`);
    setNotes(tender.watchNotes ?? '');
    return tender;
  }, [tenderId]);
  const { pending, run } = useAction();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const tender = detail.data;

  const toggleWatch = async () => {
    const result = await run(() => (tender.watchlisted ? api.delete(`/tenders/${tenderId}/watch`) : api.put(`/tenders/${tenderId}/watch`, { notes: notes.trim() || null })));
    if (!result.ok) return toast.error(result.error.message);
    toast.success(tender.watchlisted ? t('tender.removedWatch') : t('tender.addedWatch'));
    onWatchChange?.(tenderId, !tender.watchlisted);
    await detail.reload();
  };

  const saveNotes = async () => {
    const result = await run(() => api.put(`/tenders/${tenderId}/watch`, { notes: notes.trim() || null }));
    if (!result.ok) return toast.error(result.error.message);
    toast.success(t('tender.notesSaved'));
    if (!tender.watchlisted) onWatchChange?.(tenderId, true);
    await detail.reload();
  };

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={tender?.title ?? t('common.loading')}>
        <header className="drawer-header">
          <div style={{ minWidth: 0 }}>
            {tender && (
              <div className="tender-card-meta-line">
                <span className="tender-id-label">{tender.ref}</span>
                <DeadlineBadge deadline={tender.deadline} status={tender.status} />
              </div>
            )}
            <h2>{tender?.title ?? t('common.loading')}</h2>
            {tender && <p>{[tender.department, tender.city, tender.state].filter(Boolean).join(' · ')}</p>}
          </div>
          <button type="button" className="modal-close" aria-label={t('common.close')} onClick={onClose}><X size={20} /></button>
        </header>

        {detail.loading && !tender && <Loading label={t('common.loading')} />}
        <ErrorNote error={detail.error} onRetry={detail.reload} retryLabel={t('common.retry')} />

        {tender && (
          <div className="drawer-body">
            <div className="fact-grid">
              <Fact label={t('tender.estimated')}><Money value={tender.estimatedValue} /></Fact>
              <Fact label={t('tender.emd')}><Money value={tender.emdAmount} exempted={tender.emdStatus === 'exempted'} /></Fact>
              <Fact label={t('tender.fee')}>
                {tender.tenderFee === null ? <span className="not-disclosed-fallback">{t('common.notDisclosed')}</span>
                  : tender.tenderFee === 0 ? t('tender.free') : formatInr(tender.tenderFee)}
              </Fact>
              <Fact label={t('tender.deadline')}>{formatDateTime(tender.deadline, lang)}</Fact>
              <Fact label={t('tender.published')}>{formatDate(tender.publishDate, lang)}</Fact>
              <Fact label={t('tender.opening')}>{formatDate(tender.openingDate, lang)}</Fact>
              <Fact label={t('tender.prebid')}>{formatDate(tender.prebidDate, lang)}</Fact>
              <Fact label={t('tender.type')}>{tender.tenderType ?? '-'}</Fact>
              <Fact label={t('tender.tenderNo')}>{tender.tenderNo ?? '-'}</Fact>
              <Fact label={t('tender.category')}>{tender.category ?? '-'}</Fact>
            </div>

            <div className="drawer-actions">
              <Button variant={tender.watchlisted ? 'outline' : 'primary'} pending={pending} onClick={toggleWatch}>
                <Star size={15} fill={tender.watchlisted ? 'currentColor' : 'none'} />
                {tender.watchlisted ? t('tender.unwatch') : t('tender.watch')}
              </Button>
              {isClient && (
                <Button variant="outline" onClick={() => setAskDesk(true)}><ClipboardCheck size={15} />{t('desk.request')}</Button>
              )}
              {tender.sourceUrl && (
                <a className="btn btn-outline" href={tender.sourceUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={15} />{t('tender.sourceLink')}
                </a>
              )}
            </div>

            <div className="tabs" role="tablist">
              {TABS.map((key) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
                  {t(`tender.${key}`)}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <div>
                <h4 className="drawer-h">{t('tender.description')}</h4>
                <p style={{ whiteSpace: 'pre-wrap', color: 'var(--slate-700)', lineHeight: 1.6 }}>
                  {tender.description || <span className="not-disclosed-fallback">{t('tender.noDescription')}</span>}
                </p>
                <h4 className="drawer-h">{t('tender.myNotes')}</h4>
                <textarea className="textarea" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} aria-label={t('tender.myNotes')} />
                <div style={{ marginTop: 8 }}><Button size="sm" variant="outline" pending={pending} onClick={saveNotes}>{t('tender.saveNotes')}</Button></div>
                <p className="cell-sub" style={{ marginTop: 14 }}>{t('tender.lastUpdated', { when: formatDateTime(tender.lastUpdated, lang) })}</p>
              </div>
            )}

            {tab === 'boq' && (tender.boqItems.length === 0 ? <p className="cell-sub">{t('tender.noBoq')}</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t('tender.item')}</th><th className="num">{t('tender.qty')}</th><th>{t('tender.unit')}</th><th className="num">{t('tender.rate')}</th><th className="num">{t('tender.amount')}</th></tr></thead>
                  <tbody>
                    {tender.boqItems.map((b, i) => (
                      <tr key={i}>
                        <td>{b.name}{b.code && <div className="cell-sub">{b.code}</div>}</td>
                        <td className="num">{b.quantity ?? '-'}</td><td>{b.unit ?? '-'}</td>
                        <td className="num">{b.rate === null ? '-' : formatInr(b.rate)}</td>
                        <td className="num">{b.total === null ? '-' : formatInr(b.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

            {tab === 'terms' && (
              <div>
                {[['eligibility', tender.eligibility], ['payment', tender.paymentTerms], ['delivery', tender.deliveryTerms], ['penalty', tender.penaltyTerms]].map(([key, value]) => (
                  <div key={key}><h4 className="drawer-h">{t(`tender.${key}`)}</h4><p style={{ color: 'var(--slate-700)', lineHeight: 1.6 }}><Published value={value} /></p></div>
                ))}
              </div>
            )}

            {tab === 'documents' && (
              <div>
                {tender.documents.length === 0 ? <p className="cell-sub">{t('tender.noDocs')}</p> : (
                  <ul className="doc-list">
                    {tender.documents.map((d) => (
                      <li key={d.id}>
                        <span>{d.name}{d.type && <span className="cell-sub"> · {d.type}</span>}</span>
                        {d.downloadable && <a href={d.url} target="_blank" rel="noopener noreferrer">{t('common.download')}</a>}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="cell-sub" style={{ marginTop: 12 }}>{t('tender.docNote')}</p>
              </div>
            )}

            {tab === 'corrigenda' && (tender.corrigenda.length === 0 ? <p className="cell-sub">{t('tender.noCorrigenda')}</p> : (
              <ul className="doc-list">
                {tender.corrigenda.map((c, i) => (
                  <li key={i}><span><b>{c.number}</b> · {c.subject}<span className="cell-sub"> · {formatDate(c.issueDate, lang)}</span></span>
                    {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer">{t('common.download')}</a>}</li>
                ))}
              </ul>
            ))}
          </div>
        )}
      </aside>
      {askDesk && tender && <RequestHelp tenderId={tender.id} tenderTitle={tender.title} onClose={() => setAskDesk(false)} />}
    </div>
  );
}
