import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, Search } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader } from '../../components/ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { formatDate, formatInr } from '../../lib/format.js';
import { useAsync } from '../../lib/hooks.js';

const FILTER_KEYS = ['q', 'departmentIds', 'stateIds', 'categoryIds', 'from', 'to', 'ratePublished'];

function useFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])), [params]);
  const tab = params.get('tab') ?? 'awards';
  const set = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === '' || v === null || v === false) next.delete(k); else next.set(k, String(v)); }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const query = () => Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
  return { filters, tab, set, query, page: Number(params.get('page')) || 1 };
}

const spreadLabel = (pct, t) => {
  if (pct === null || pct === undefined) return <span className="not-disclosed-fallback">{t('results.spreadUnavailable')}</span>;
  if (pct === 0) return t('results.atEstimate');
  return <span style={{ color: pct < 0 ? '#047857' : '#B45309', fontWeight: 600 }}>{t(pct < 0 ? 'results.below' : 'results.above', { pct: Math.abs(pct) })}</span>;
};

function FilterBar({ f, masters }) {
  const { t } = useI18n();
  const [q, setQ] = useState(f.filters.q);
  const pick = (key, list, any) => (
    <select className="select" value={f.filters[key]} aria-label={any} onChange={(e) => f.set({ [key]: e.target.value })}>
      <option value="">{any}</option>
      {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
    </select>
  );
  return (
    <Card>
      <form className="results-filters" onSubmit={(e) => { e.preventDefault(); f.set({ q: q.trim() }); }}>
        <div style={{ flex: '2 1 240px', position: 'relative' }}>
          <input className="input" value={q} placeholder={t('results.searchPlaceholder')} aria-label={t('results.search')} onChange={(e) => setQ(e.target.value)} />
        </div>
        {pick('departmentIds', masters?.departments ?? [], t('results.anyDepartment'))}
        {pick('stateIds', masters?.states ?? [], t('results.anyState'))}
        {pick('categoryIds', masters?.categories ?? [], t('results.anyCategory'))}
        <label className="cell-sub" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{t('results.from')}
          <input className="input" type="date" style={{ width: 150 }} value={f.filters.from} onChange={(e) => f.set({ from: e.target.value })} />
        </label>
        <label className="cell-sub" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{t('results.to')}
          <input className="input" type="date" style={{ width: 150 }} value={f.filters.to} onChange={(e) => f.set({ to: e.target.value })} />
        </label>
        <label className="check-row" style={{ margin: 0 }}>
          <input type="checkbox" checked={f.filters.ratePublished === 'true'} onChange={(e) => f.set({ ratePublished: e.target.checked ? 'true' : '' })} />
          {t('results.ratePublished')}
        </label>
        <Button type="submit"><Search size={14} />{t('results.apply')}</Button>
      </form>
    </Card>
  );
}

function AwardDetail({ id, onClose }) {
  const { t, lang } = useI18n();
  const data = useAsync(async () => (await api.get(`/results/${id}`)).result, [id]);
  const r = data.data;
  return (
    <Modal wide title={r?.title ?? t('results.detail')} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>{t('common.close')}</Button>}>
      {data.loading && !r && <Loading label={t('common.loading')} />}
      <ErrorNote error={data.error} />
      {r && (
        <>
          <dl className="kv" style={{ marginBottom: 16 }}>
            <dt>{t('tender.department')}</dt><dd>{r.department ?? '-'}</dd>
            <dt>{t('search.state')}</dt><dd>{r.state ?? '-'}</dd>
            <dt>{t('results.estimated')}</dt><dd>{formatInr(r.estimatedValue, t('common.notDisclosed'))}</dd>
            <dt>{t('results.awarded')}</dt><dd>{formatInr(r.awardedValue, t('results.rateNotPublished'))}</dd>
            <dt>{t('results.colSpread')}</dt><dd>{spreadLabel(r.spreadPct, t)}</dd>
            <dt>{t('results.colDate')}</dt><dd>{formatDate(r.awardDate, lang)}</dd>
            <dt>{t('results.workOrder')}</dt><dd>{r.workOrderRef ?? '-'}</dd>
            <dt>{t('results.source')}</dt><dd>{r.sourcePortal ?? '-'}</dd>
          </dl>
          <h4 className="drawer-h">{t('results.bidderList')} ({r.bidders ?? r.bidderList.length}{r.qualified !== null && r.qualified !== undefined ? `, ${r.qualified} ${t('results.qualified')}` : ''})</h4>
          {r.bidderList.length === 0 ? <p className="cell-sub">{t('results.winnerNotPublished')}</p> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{t('results.rank')}</th><th>{t('common.name')}</th><th className="num">{t('results.quoted')}</th><th /></tr></thead>
              <tbody>{r.bidderList.map((b, i) => (
                <tr key={i}><td>{b.rank ?? '-'}</td><td className="cell-title">{b.name}</td>
                  <td className="num">{b.amount === null ? <span className="not-disclosed-fallback">{t('results.rateNotPublished')}</span> : formatInr(b.amount)}</td>
                  <td>{b.isL1 && <Badge tone="green">L1 · {t('results.won')}</Badge>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
    </Modal>
  );
}

function Awards({ f }) {
  const { t, lang } = useI18n();
  const [openId, setOpenId] = useState(null);
  const key = JSON.stringify([f.query(), f.page]);
  const data = useAsync(() => api.get('/results', { query: { ...f.query(), page: f.page, pageSize: 20 } }), [key]);
  const d = data.data;
  const go = (page) => f.set({ page });
  return (
    <>
      <div className="note note-info">{t('results.depthNote')}</div>
      <Card title={d ? t('results.found', { n: d.total.toLocaleString('en-IN') }) : t('results.tabAwards')} flush
        actions={<a className="btn btn-sm btn-outline" href={api.url('/results/export.xlsx', f.query())} download><Download size={13} />{t('results.exportExcel')}</a>}>
        {data.loading && !d && <Loading label={t('common.loading')} />}
        <ErrorNote error={data.error} onRetry={data.reload} retryLabel={t('common.retry')} />
        {d && d.items.length === 0 && <Empty title={t('results.noResults')}>{t('results.noResultsHint')}</Empty>}
        {d && d.items.length > 0 && (
          <div className="table-wrap" style={{ opacity: data.loading ? 0.6 : 1 }}>
            <table className="table">
              <thead><tr><th>{t('results.colTender')}</th><th>{t('results.colWinner')}</th><th className="num">{t('results.colL1')}</th><th>{t('results.colL2')}</th><th>{t('results.colSpread')}</th><th className="num">{t('results.colBidders')}</th><th>{t('results.colDate')}</th></tr></thead>
              <tbody>
                {d.items.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => setOpenId(a.id)}>
                    <td style={{ maxWidth: 320 }}><div className="cell-title">{a.title}</div><div className="cell-sub">{a.ref} · {[a.department, a.state].filter(Boolean).join(' · ')}</div></td>
                    <td>{a.winner ?? <span className="not-disclosed-fallback">{t('results.winnerNotPublished')}</span>}</td>
                    <td className="num">{a.l1Amount === null ? <span className="not-disclosed-fallback">{t('results.rateNotPublished')}</span> : formatInr(a.l1Amount)}</td>
                    <td>{a.l2Bidder ? <><div>{a.l2Bidder}</div><div className="cell-sub">{formatInr(a.l2Amount, t('results.rateNotPublished'))}</div></> : '-'}</td>
                    <td>{spreadLabel(a.spreadPct, t)}</td>
                    <td className="num">{a.bidders ?? '-'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(a.awardDate, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d && d.pages > 1 && (
          <nav className="pager" aria-label="Pagination">
            <Button variant="outline" size="sm" disabled={f.page <= 1} onClick={() => go(f.page - 1)}>{t('common.previous')}</Button>
            <span className="cell-sub">{t('search.page', { p: d.page, n: d.pages })}</span>
            <Button variant="outline" size="sm" disabled={f.page >= d.pages} onClick={() => go(f.page + 1)}>{t('common.next')}</Button>
          </nav>
        )}
      </Card>
      {openId && <AwardDetail id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

const pctText = (v) => (v === null || v === undefined ? '-' : `${v > 0 ? '+' : ''}${v}%`);

function Rates({ f }) {
  const { t } = useI18n();
  const [by, setBy] = useState('department');
  const [estimate, setEstimate] = useState('');
  const [unit, setUnit] = useState('');
  const key = JSON.stringify(f.query());
  const rates = useAsync(() => api.get('/results/analysis/rates', { query: { ...f.query(), by, estimatedValue: estimate || undefined } }), [key, by, estimate]);
  const trend = useAsync(async () => (await api.get('/results/analysis/trend', { query: f.query() })).months, [key]);
  const [item, unitName] = unit ? unit.split('|') : [null, null];
  const units = useAsync(() => api.get('/results/analysis/unit-rates', { query: { ...f.query(), item: item || undefined, unit: unitName || undefined, by } }), [key, unit, by]);
  const r = rates.data;

  return (
    <>
      <div className="note note-info">{t('results.depthNote')}</div>
      {rates.loading && !r && <Loading label={t('common.loading')} />}
      <ErrorNote error={rates.error} onRetry={rates.reload} retryLabel={t('common.retry')} />
      {r && (
        <div className="grid-2">
          <Card title={t('results.rateTitle')}>
            <div className="kpi-cards-grid" style={{ marginBottom: 0, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              {[[t('results.awardsUsed'), r.overall.awards], [t('results.withRate'), r.overall.withRate],
                [t('results.median'), r.overall.enoughData ? pctText(r.overall.medianSpreadPct) : '-'], [t('results.average'), r.overall.enoughData ? pctText(r.overall.avgSpreadPct) : '-']]
                .map(([label, value]) => <div key={label} className="kpi-metric-card"><div className="kpi-numbers-wrap"><div className="kpi-big-value tabular-nums">{value}</div><div className="kpi-label-text">{label}</div></div></div>)}
            </div>
            {!r.overall.enoughData && <p className="cell-sub" style={{ marginTop: 10 }}>{t('results.notEnough')}. {t('results.notEnoughHint')}</p>}
          </Card>
          <Card title={t('results.bandTitle')}>
            <Field label={t('results.bandEstimate')}>{(p) => <input {...p} className="input" type="number" min="1" value={estimate} onChange={(e) => setEstimate(e.target.value)} />}</Field>
            {r.band ? (
              <>
                <p>{t('results.bandBody', { low: r.band.lowPct, high: r.band.highPct, median: r.band.medianPct })}</p>
                {r.band.low !== null && <div className="note note-success" style={{ marginTop: 10 }}>{t('results.bandApplied', { value: formatInr(Number(estimate)), low: formatInr(r.band.low), high: formatInr(r.band.high) })}</div>}
                <p className="cell-sub">{t('results.basedOn', { n: r.band.basedOn })} · {t('results.bandDisclaimer')}</p>
              </>
            ) : <p className="cell-sub">{t('results.bandNone')} {r.bandNote}</p>}
          </Card>
        </div>
      )}

      {r && (
        <Card title={t('results.groupBy')} flush actions={
          <select className="select" style={{ height: 32, width: 160 }} value={by} onChange={(e) => setBy(e.target.value)} aria-label={t('results.groupBy')}>
            <option value="department">{t('results.byDepartment')}</option><option value="category">{t('results.byCategory')}</option><option value="state">{t('results.byState')}</option>
          </select>}>
          {r.groups.length === 0 ? <Empty title={t('results.noResults')} /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{t('results.groupBy')}</th><th className="num">{t('results.awardsUsed')}</th><th className="num">{t('results.withRate')}</th><th className="num">{t('results.median')}</th><th className="num">{t('results.average')}</th><th className="num">{t('results.range')}</th></tr></thead>
              <tbody>{r.groups.map((g) => (
                <tr key={g.id ?? g.label}>
                  <td className="cell-title">{g.label}</td><td className="num">{g.awards}</td><td className="num">{g.withRate}</td>
                  {g.enoughData ? (<><td className="num">{pctText(g.medianSpreadPct)}</td><td className="num">{pctText(g.avgSpreadPct)}</td><td className="num">{pctText(g.minSpreadPct)} to {pctText(g.maxSpreadPct)}</td></>)
                    : <td className="num cell-sub" colSpan={3}>{t('results.notEnough')} ({g.withSpread})</td>}
                </tr>))}</tbody>
            </table></div>
          )}
        </Card>
      )}

      <Card title={t('results.trendTitle')}>
        {trend.loading && !trend.data && <Loading />}
        {trend.data?.length === 0 && <p className="cell-sub">{t('results.noResults')}</p>}
        {trend.data?.length > 0 && (
          <div className="chart-box" role="img" aria-label={t('results.trendLine')}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend.data} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip formatter={(v) => (v === null ? t('results.spreadUnavailable') : `${v}%`)} />
                <ReferenceLine y={0} stroke="#94A3B8" />
                <Line type="monotone" dataKey="avgSpreadPct" name={t('results.trendLine')} stroke="#0066FF" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card title={t('results.unitTitle')}>
        <p className="cell-sub" style={{ marginBottom: 10 }}>{t('results.unitHint')}</p>
        {units.data?.combos.length === 0 && <p className="cell-sub">{t('results.unitNone')}</p>}
        {units.data?.combos.length > 0 && (
          <select className="select" style={{ maxWidth: 360, marginBottom: 12 }} value={unit} aria-label={t('results.unitTitle')} onChange={(e) => setUnit(e.target.value)}>
            <option value="">{t('results.unitChoose')}</option>
            {units.data.combos.map((c) => <option key={`${c.item}|${c.unit}`} value={`${c.item}|${c.unit}`}>{c.item} ({c.unit}) · {c.awards}</option>)}
          </select>
        )}
        {units.data?.groups.length > 0 && (
          <div className="chart-box" style={{ height: 40 + units.data.groups.length * 34 }} role="img" aria-label={t('results.unitTitle')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={units.data.groups} layout="vertical" margin={{ left: 10, right: 24 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={170} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => `₹ ${Number(v).toLocaleString('en-IN')}`} />
                <Bar dataKey="average" name={t('results.average')} fill="#0066FF" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {units.data?.groups.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('results.groupBy')}</th><th className="num">{t('results.awardsUsed')}</th><th className="num">{t('results.lowest')}</th><th className="num">{t('results.average')}</th><th className="num">{t('results.highest')}</th></tr></thead>
            <tbody>{units.data.groups.map((g) => <tr key={g.label}><td className="cell-title">{g.label}</td><td className="num">{g.awards}</td><td className="num">{formatInr(g.lowest)}</td><td className="num">{formatInr(g.average)}</td><td className="num">{formatInr(g.highest)}</td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

function BidderDetail({ bidder, f, onClose }) {
  const { t, lang } = useI18n();
  const data = useAsync(() => api.get('/results/analysis/bidders/detail', { query: { ...f.query(), key: bidder.key } }), [bidder.key]);
  return (
    <Modal wide title={bidder.name} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>{t('common.close')}</Button>}>
      {data.loading && !data.data && <Loading label={t('common.loading')} />}
      <ErrorNote error={data.error} />
      {data.data && (
        <>
          <h4 className="drawer-h">{t('results.departmentsWon')}</h4>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('results.colDept')}</th><th className="num">{t('results.colWins')}</th><th className="num">{t('results.colParticipations')}</th><th /></tr></thead>
            <tbody>{data.data.departments.map((d) => <tr key={d.department}><td className="cell-title">{d.department}</td><td className="num">{d.wins}</td><td className="num">{d.participations}</td><td>{d.keepsWinning && <Badge tone="green">{t('results.keepsWinning')}</Badge>}</td></tr>)}</tbody>
          </table></div>
          <h4 className="drawer-h">{t('results.recentAwards')}</h4>
          {data.data.recent.map((a) => (
            <div className="preview-item" key={a.id}>
              <div><b>{a.title}</b><div className="cell-sub">{[a.department, a.state].filter(Boolean).join(' · ')} · {formatDate(a.awardDate, lang)}</div></div>
              <div style={{ textAlign: 'right' }}>{a.won ? <Badge tone="green">{t('results.won')}</Badge> : <Badge tone="slate">L2+</Badge>}<div className="cell-sub">{formatInr(a.theirBid ?? a.l1Amount, t('results.rateNotPublished'))}</div></div>
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}

function Tenders({ f }) {
  const { t } = useI18n();
  const key = JSON.stringify(f.query());
  const [name, setName] = useState('');
  const [open, setOpen] = useState(null);
  const depts = useAsync(async () => (await api.get('/results/analysis/departments', { query: f.query() })).departments, [key]);
  const bidders = useAsync(async () => (await api.get('/results/analysis/bidders', { query: { ...f.query(), name: name || undefined } })).bidders, [key, name]);
  return (
    <>
      <div className="note note-info">{t('results.depthNote')}</div>
      <Card title={t('results.deptTitle')} flush>
        {depts.loading && !depts.data && <Loading />}
        {depts.data?.length === 0 && <Empty title={t('results.noResults')} />}
        {depts.data?.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('results.colDept')}</th><th className="num">{t('results.colAwards')}</th><th className="num">{t('results.colPerMonth')}</th><th className="num">{t('results.colAvgAward')}</th><th className="num">{t('results.colVariance')}</th><th className="num">{t('results.colAvgBidders')}</th><th className="num">{t('results.colQualified')}</th></tr></thead>
            <tbody>{depts.data.map((d) => (
              <tr key={d.id ?? d.department}>
                <td className="cell-title">{d.department}</td><td className="num">{d.awards}</td><td className="num">{d.awardsPerMonth ?? '-'}</td>
                <td className="num">{d.avgAwardValue === null ? '-' : formatInr(d.avgAwardValue)}</td>
                <td className="num">{d.avgVariancePct === null ? <span className="cell-sub">{t('results.notEnough')}</span> : pctText(d.avgVariancePct)}</td>
                <td className="num">{d.avgBidders ?? <span className="cell-sub">{t('results.notEnough')}</span>}</td><td className="num">{d.avgQualified ?? '-'}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>

      <Card title={t('results.bidderTitle')} flush actions={<input className="input" style={{ height: 32, width: 200 }} placeholder={t('results.bidderSearch')} aria-label={t('results.bidderSearch')} value={name} onChange={(e) => setName(e.target.value)} />}>
        <p className="cell-sub" style={{ padding: '10px 20px 0' }}>{t('results.bidderNote')}</p>
        {bidders.loading && !bidders.data && <Loading />}
        {bidders.data?.length === 0 && <Empty title={t('results.noResults')} />}
        {bidders.data?.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('results.colFirm')}</th><th className="num">{t('results.colParticipations')}</th><th className="num">{t('results.colWins')}</th><th className="num">{t('results.colWinRate')}</th><th className="num">{t('results.colWonValue')}</th><th className="num">{t('results.colDepts')}</th></tr></thead>
            <tbody>{bidders.data.map((b) => (
              <tr key={b.key} className="clickable" onClick={() => setOpen(b)}>
                <td className="cell-title">{b.name} {b.repeatWinner && <Badge tone="green">{t('results.repeat')}</Badge>}</td>
                <td className="num">{b.participations}</td><td className="num">{b.wins}</td><td className="num">{b.winRatePct === null ? '-' : `${b.winRatePct}%`}</td>
                <td className="num">{b.wonValue === null ? '-' : formatInr(b.wonValue)}</td><td className="num">{b.departmentsWon}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      {open && <BidderDetail bidder={open} f={f} onClose={() => setOpen(null)} />}
    </>
  );
}

export default function Results() {
  const { t } = useI18n();
  const f = useFilters();
  const [, setParams] = useSearchParams();
  const masters = useAsync(() => api.get('/masters'), []);
  const tabs = [['awards', t('results.tabAwards')], ['rates', t('results.tabRates')], ['tenders', t('results.tabTenders')]];
  return (
    <>
      <PageHeader title={t('results.title')} subtitle={t('results.subtitle')} crumbs={[{ label: t('nav.home'), to: '/app' }, { label: t('nav.results') }]} />
      <FilterBar key={f.filters.q} f={f} masters={masters.data} />
      <div className="tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={f.tab === key} className={`tab ${f.tab === key ? 'active' : ''}`}
            onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', key); n.delete('page'); return n; }, { replace: true })}>{label}</button>
        ))}
      </div>
      {f.tab === 'awards' && <Awards f={f} />}
      {f.tab === 'rates' && <Rates f={f} />}
      {f.tab === 'tenders' && <Tenders f={f} />}
    </>
  );
}
