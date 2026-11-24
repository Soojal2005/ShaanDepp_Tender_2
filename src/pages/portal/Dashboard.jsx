import { useState } from 'react';
import { Clock, FileText, IndianRupee, Sparkles, Star } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, ComposedChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import TenderCard from '../../components/tender/TenderCard.jsx';
import TenderDrawer from '../../components/tender/TenderDrawer.jsx';
import { Button, Card, Empty, ErrorNote, Loading, PageHeader } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { lakhToRupees, rupeesToLakh } from '../../lib/filters.js';
import { formatDateTime, formatInr, formatNumber } from '../../lib/format.js';
import { useAsync } from '../../lib/hooks.js';

const PALETTE = ['#08726B', '#35A28B', '#71BD9D', '#A3D3B0', '#5F9E85', '#C5DCD0'];
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

/** A titled card listing tenders; renders nothing when empty (so personal boxes stay out of the way). */
function TenderList({ title, icon: Icon, items, onOpen, onToggleWatch }) {
  if (!items || items.length === 0) return null;
  return (
    <Card title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{Icon && <Icon size={16} />}{title}</span>} flush>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((item) => <TenderCard key={item.id} compact tender={item} onOpen={onOpen} onToggleWatch={onToggleWatch} />)}
      </div>
    </Card>
  );
}

/** Editor for the subscriber's preferred value range (in ₹ lakh), which filters the "for you" sections. */
function ValueRangePref({ interest, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const [min, setMin] = useState(rupeesToLakh(interest.valueMin) ?? '');
  const [max, setMax] = useState(rupeesToLakh(interest.valueMax) ?? '');
  const [pending, setPending] = useState(false);
  // lakhToRupees returns '' for an empty box; send null so the bound is cleared, not saved as 0.
  const toRupees = (v) => { const r = lakhToRupees(v); return r === '' ? null : Number(r); };
  const save = async () => {
    setPending(true);
    try {
      await api.put('/dashboard/preferences', { valueMin: toRupees(min), valueMax: toRupees(max) });
      toast.success(t('dash.prefSaved'));
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="pref-range-row" style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', margin: '4px 0 2px' }}>
      <div>
        <label className="cell-sub" htmlFor="pref-min">{t('dash.prefRangeTitle')}</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <input id="pref-min" className="input" type="number" min="0" style={{ width: 120 }} placeholder={t('search.min')}
            value={min} onChange={(e) => setMin(e.target.value)} aria-label={`${t('dash.prefRangeTitle')} ${t('search.min')}`} />
          <input className="input" type="number" min="0" style={{ width: 120 }} placeholder={t('search.max')}
            value={max} onChange={(e) => setMax(e.target.value)} aria-label={`${t('dash.prefRangeTitle')} ${t('search.max')}`} />
          <Button size="sm" pending={pending} onClick={save}>{t('common.save')}</Button>
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
  const interest = d.interest ?? { hasInterest: false };
  const maxDept = Math.max(1, ...d.byDepartment.map((x) => x.count));
  const bands = [
    [t('dash.band10l'), d.valueBands.under10Lakh], [t('dash.band1cr'), d.valueBands.tenLakhTo1Crore],
    [t('dash.bandOver'), d.valueBands.over1Crore], [t('dash.bandNone'), d.valueBands.undisclosed],
  ];
  const trend = d.monthly.map((m) => ({ ...m, name: monthLabel(m.month, lang), crore: Math.round((m.value / 1e7) * 100) / 100 }));
  const statesLabeled = d.byState.map((s) => ({ ...s, name: s.label === 'Other' ? t('dash.other') : s.label }));
  const change = k.newWeekChangePct;

  // Toggle watch from any of the lists, then refresh the figures.
  const toggleWatch = async (x) => {
    try { await (x.watchlisted ? api.delete(`/tenders/${x.id}/watch`) : api.put(`/tenders/${x.id}/watch`, {})); data.reload(); } catch { /* shown on next load */ }
  };
  const openTender = (x) => setOpenId(x.id);

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
        <Kpi icon={Sparkles} tone="purple" value={formatNumber(interest.newThisWeek ?? 0, lang)} label={t('dash.kpiNewForYou')}
          note={interest.preferredState ? t('dash.inState', { state: interest.preferredState }) : (k.myMatchesThisWeek ? `${t('dash.kpiMatched')}: ${k.myMatchesThisWeek}` : null)} />
      </div>

      {/* ---------------- For you ---------------- */}
      <h3 className="dash-section-heading" style={{ margin: '22px 0 6px', fontSize: 16, color: 'var(--slate-800)' }}>{t('dash.forYouTitle')}</h3>
      {interest.hasInterest
        ? <p className="cell-sub" style={{ margin: '0 0 10px' }}>
            {t('dash.newInterestWeek', { n: interest.newThisWeek ?? 0 })}{interest.preferredState ? ` ${t('dash.inState', { state: interest.preferredState })}` : ''}.
          </p>
        : <div className="note note-info" style={{ marginBottom: 10 }}>{t('dash.noInterest')}</div>}

      <ValueRangePref interest={interest} onSaved={data.reload} />

      <TenderList title={t('dash.bestMatchesTitle')} icon={Sparkles} items={d.bestMatches} onOpen={openTender} onToggleWatch={toggleWatch} />
      <TenderList title={t('dash.myMatchesTitle')} items={d.matchedTenders} onOpen={openTender} onToggleWatch={toggleWatch} />
      <TenderList title={t('dash.latestInterestTitle')} items={d.latestInterest} onOpen={openTender} onToggleWatch={toggleWatch} />
      <TenderList title={t('dash.closingInterestTitle')} icon={Clock} items={d.closingInterest} onOpen={openTender} onToggleWatch={toggleWatch} />
      <TenderList title={t('dash.savedClosingTitle')} icon={Star} items={d.savedClosing} onOpen={openTender} onToggleWatch={toggleWatch} />

      {/* ---------------- Market overview ---------------- */}
      <h3 className="dash-section-heading" style={{ margin: '22px 0 6px', fontSize: 16, color: 'var(--slate-800)' }}>{t('dash.marketTitle')}</h3>
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
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dce7e1" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="n" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis yAxisId="v" orientation="right" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="n" dataKey="count" name={t('dash.count')} fill="#4BA996" radius={[3, 3, 0, 0]} />
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
                  {bands.map((_, i) => <Cell key={i} fill={i === 3 ? '#BCD8CB' : '#086C65'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title={t('dash.closingTitle')} flush>
          {d.closingSoon.length === 0 ? <Empty title={t('dash.closingEmpty')} /> : (
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {d.closingSoon.map((item) => (
                <TenderCard key={item.id} compact tender={item} onOpen={openTender} onToggleWatch={toggleWatch} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {openId && <TenderDrawer key={openId} tenderId={openId} onClose={() => setOpenId(null)} onWatchChange={() => data.reload()} />}
    </>
  );
}
