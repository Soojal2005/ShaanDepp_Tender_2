import { useState } from 'react';
import { Bookmark, Clock, FileText, IndianRupee } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, ComposedChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import TenderCard from '../../components/tender/TenderCard.jsx';
import TenderDrawer from '../../components/tender/TenderDrawer.jsx';
import { Card, Empty, ErrorNote, Loading, PageHeader } from '../../components/ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime, formatInr, formatNumber } from '../../lib/format.js';
import { useAsync } from '../../lib/hooks.js';

const PALETTE = ['#0066FF', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#94A3B8'];
const monthLabel = (ym, lang) => {
  const [y, m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat(lang === 'HI' ? 'hi-IN' : 'en-IN', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
};

function Kpi({ icon: Icon, tone, value, label, note }) {
  return (
    <div className="kpi-metric-card">
      <div className="kpi-card-left">
        <div className={`kpi-icon-square ${tone}`}><Icon size={22} /></div>
        <div className="kpi-numbers-wrap">
          <div className="kpi-big-value tabular-nums">{value}</div>
          <div className="kpi-label-text">{label}</div>
          {note && <div className="kpi-delta-positive" style={{ color: 'var(--slate-500)' }}>{note}</div>}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { t, lang } = useI18n();
  const data = useAsync(() => api.get('/dashboard'), []);
  const [openId, setOpenId] = useState(null);

  if (data.loading && !data.data) return <Loading label={t('common.loading')} />;
  if (data.error && !data.data) return <ErrorNote error={data.error} onRetry={data.reload} retryLabel={t('common.retry')} />;
  const d = data.data;
  const k = d.kpis;
  const maxDept = Math.max(1, ...d.byDepartment.map((x) => x.count));
  const bands = [
    [t('dash.band10l'), d.valueBands.under10Lakh], [t('dash.band1cr'), d.valueBands.tenLakhTo1Crore],
    [t('dash.bandOver'), d.valueBands.over1Crore], [t('dash.bandNone'), d.valueBands.undisclosed],
  ];
  const trend = d.monthly.map((m) => ({ ...m, name: monthLabel(m.month, lang), crore: Math.round((m.value / 1e7) * 100) / 100 }));
  const statesLabeled = d.byState.map((s) => ({ ...s, name: s.label === 'Other' ? t('dash.other') : s.label }));
  const change = k.newWeekChangePct;

  return (
    <>
      <PageHeader
        title={t('dash.title')}
        subtitle={t('dash.subtitle')}
        crumbs={[{ label: t('nav.home'), to: '/app' }, { label: t('nav.dashboard') }]}
        actions={d.dataAsOf && <span className="cell-sub">{t('dash.asOf', { when: formatDateTime(d.dataAsOf, lang) })}</span>}
      />

      {k.openTenders === 0 && d.monthly.every((m) => m.count === 0) && <div className="note note-info">{t('dash.noData')}</div>}

      <div className="kpi-cards-grid">
        <Kpi icon={FileText} tone="blue" value={formatNumber(k.openTenders, lang)} label={t('dash.kpiOpen')}
          note={[t('dash.newWeek', { n: k.newThisWeek }), change !== null ? t('dash.vsLastWeek', { pct: `${change > 0 ? '+' : ''}${change}` }) : null].filter(Boolean).join(' · ')} />
        <Kpi icon={IndianRupee} tone="green" value={formatInr(k.openValueKnown, '-')} label={t('dash.kpiValue')}
          note={k.openValueUndisclosed > 0 ? t('dash.kpiValueNote', { n: k.openValueUndisclosed }) : null} />
        <Kpi icon={Clock} tone="amber" value={formatNumber(k.closingSoon, lang)} label={t('dash.kpiClosing')} />
        <Kpi icon={Bookmark} tone="purple" value={formatNumber(k.watchlisted, lang)} label={t('dash.kpiWatch')}
          note={`${t('dash.kpiMatched')}: ${k.matchedToAlertsThisWeek}`} />
      </div>

      <div className="analytics-cards-row">
        <div className="analytics-widget-card">
          <div className="widget-card-header"><h3>{t('dash.deptTitle')}</h3></div>
          {d.byDepartment.length === 0 ? <p className="cell-sub">-</p> : (
            <div className="dept-bars-list">
              {d.byDepartment.map((x) => (
                <div key={x.label} className="dept-bar-row">
                  <span className="dept-bar-label" title={x.label}>{x.label}</span>
                  <div className="dept-bar-track"><div className="dept-bar-fill" style={{ width: `${(x.count / maxDept) * 100}%` }} /></div>
                  <span className="dept-bar-val tabular-nums">{x.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="analytics-widget-card">
          <div className="widget-card-header"><h3>{t('dash.stateTitle')}</h3></div>
          {statesLabeled.length === 0 ? <p className="cell-sub">-</p> : (
            <div className="donut-widget-layout">
              <div className="donut-svg-wrap" role="img" aria-label={t('dash.stateTitle')}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statesLabeled} dataKey="count" nameKey="name" innerRadius={30} outerRadius={52} paddingAngle={2} stroke="none">
                      {statesLabeled.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v, n]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="donut-legend-list">
                {statesLabeled.map((s, i) => (
                  <li key={s.name} className="donut-legend-item" style={{ listStyle: 'none' }}>
                    <span><span className="donut-dot" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="donut-legend-name">{s.name}</span></span>
                    <span className="donut-legend-pct tabular-nums">{s.share}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="analytics-widget-card">
          <div className="widget-card-header"><h3>{t('dash.trendTitle')}</h3></div>
          <div className="chart-box" role="img" aria-label={t('dash.trendTitle')}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="n" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis yAxisId="v" orientation="right" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="n" dataKey="count" name={t('dash.count')} fill="#60A5FA" radius={[3, 3, 0, 0]} />
                <Line yAxisId="v" dataKey="crore" name={t('dash.value')} stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <Card title={t('dash.bandsTitle')}>
          <div className="chart-box" style={{ height: 180 }} role="img" aria-label={t('dash.bandsTitle')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bands.map(([name, count]) => ({ name, count }))} layout="vertical" margin={{ left: 20, right: 16 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="count" name={t('dash.count')} radius={[0, 3, 3, 0]}>
                  {bands.map((_, i) => <Cell key={i} fill={i === 3 ? '#CBD5E1' : '#0066FF'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title={t('dash.closingTitle')} flush>
          {d.closingSoon.length === 0 ? <Empty title={t('dash.closingEmpty')} /> : (
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {d.closingSoon.map((item) => (
                <TenderCard key={item.id} compact tender={item} onOpen={(x) => setOpenId(x.id)} onToggleWatch={async (x) => {
                  try { await (x.watchlisted ? api.delete(`/tenders/${x.id}/watch`) : api.put(`/tenders/${x.id}/watch`, {})); data.reload(); } catch { /* shown on next load */ }
                }} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {openId && <TenderDrawer key={openId} tenderId={openId} onClose={() => setOpenId(null)} onWatchChange={() => data.reload()} />}
    </>
  );
}
