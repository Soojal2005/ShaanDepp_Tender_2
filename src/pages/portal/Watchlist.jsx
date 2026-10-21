import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Trash2 } from 'lucide-react';
import TenderCard from '../../components/tender/TenderCard.jsx';
import TenderDrawer from '../../components/tender/TenderDrawer.jsx';
import { useToast } from '../../components/Toast.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Loading, PageHeader } from '../../components/ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { filtersFrom, toParams } from '../../lib/filters.js';
import { formatDate } from '../../lib/format.js';
import { useAsync } from '../../lib/hooks.js';

function WatchedTenders() {
  const { t } = useI18n();
  const toast = useToast();
  const list = useAsync(() => api.get('/tenders', { query: { watchlisted: 'true', status: 'all', sort: 'deadline', pageSize: 100 } }), []);
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const unwatch = async (tender) => {
    setBusyId(tender.id);
    try {
      await api.delete(`/tenders/${tender.id}/watch`);
      toast.success(t('tender.removedWatch'));
      await list.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (list.loading && !list.data) return <Loading label={t('common.loading')} />;
  if (list.error) return <ErrorNote error={list.error} onRetry={list.reload} retryLabel={t('common.retry')} />;
  if (list.data.items.length === 0) return <Card><Empty title={t('watch.emptyTenders')}>{t('watch.emptyTendersHint')}</Empty></Card>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {list.data.items.map((item) => (
        <TenderCard key={item.id} tender={item} busy={busyId === item.id} onOpen={(x) => setOpenId(x.id)} onToggleWatch={unwatch} />
      ))}
      {openId && <TenderDrawer key={openId} tenderId={openId} onClose={() => setOpenId(null)} onWatchChange={() => list.reload()} />}
    </div>
  );
}

function summarise(filters, t) {
  const parts = [];
  if (filters.q) parts.push(`"${filters.q}"`);
  if (filters.exclude) parts.push(`− ${filters.exclude}`);
  const counts = [['departmentIds', t('search.department')], ['stateIds', t('search.state')], ['categoryIds', t('search.category')]];
  for (const [key, label] of counts) if (filters[key].length) parts.push(`${label}: ${filters[key].length}`);
  if (filters.valueMin || filters.valueMax) parts.push(t('search.value'));
  if (filters.status !== 'open') parts.push(t(`search.${{ closing_soon: 'closingSoon', closed: 'closed', all: 'allStatus' }[filters.status]}`));
  return parts;
}

function SavedSearches() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const list = useAsync(async () => (await api.get('/saved-searches')).searches, []);

  const remove = async (s) => {
    try { await api.delete(`/saved-searches/${s.id}`); toast.success(t('search.deleted')); list.reload(); } catch (err) { toast.error(err.message); }
  };

  if (list.loading && !list.data) return <Loading label={t('common.loading')} />;
  if (list.error) return <ErrorNote error={list.error} onRetry={list.reload} retryLabel={t('common.retry')} />;
  if (list.data.length === 0) return <Card><Empty title={t('search.noSaved')} /></Card>;

  return (
    <Card flush>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('common.name')}</th><th>{t('watch.filtersSummary')}</th><th>{t('common.created')}</th><th /></tr></thead>
          <tbody>
            {list.data.map((s) => {
              const filters = filtersFrom(s.filters);
              return (
                <tr key={s.id}>
                  <td className="cell-title">{s.name}</td>
                  <td><div className="chip-row">{summarise(filters, t).map((p) => <Badge key={p} tone="blue">{p}</Badge>)}</div></td>
                  <td>{formatDate(s.createdAt, lang)}</td>
                  <td>
                    <div className="row-actions">
                      <Link className="btn btn-sm btn-primary" style={{ textDecoration: 'none', color: '#fff' }} to={`/app/search?${toParams(filters)}`}><Play size={13} />{t('watch.run')}</Link>
                      <Button size="sm" variant="danger" onClick={() => remove(s)} aria-label={`${t('watch.delete')} ${s.name}`}><Trash2 size={13} />{t('watch.delete')}</Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function Watchlist() {
  const { t } = useI18n();
  const [tab, setTab] = useState('tenders');
  return (
    <>
      <PageHeader title={t('watch.title')} subtitle={t('watch.subtitle')} crumbs={[{ label: t('nav.home'), to: '/app' }, { label: t('nav.watchlist') }]} />
      <div className="tabs" role="tablist">
        {[['tenders', t('watch.tendersTab')], ['searches', t('watch.searchesTab')]].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {tab === 'tenders' ? <WatchedTenders /> : <SavedSearches />}
    </>
  );
}
