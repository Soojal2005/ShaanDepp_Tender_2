import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Card } from '../ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { formatDateTime, formatInr } from '../../lib/format.js';

const TILE = 52;
const GAP = 4;
const COLUMNS = 9;
const ROWS = 8;
const LINE_COLORS = ['#0066FF', '#0B8F6B', '#D97706', '#7C3AED', '#DB2777', '#475569'];

const pctText = (v) => (v === null || v === undefined ? null : `${v > 0 ? '+' : ''}${v}%`);

function Change({ value, label }) {
  if (value === null || value === undefined) return null;
  const tone = value > 0 ? '#047857' : value < 0 ? '#B91C1C' : '#64748B';
  return <span style={{ color: tone, fontWeight: 600 }}>{label.replace('{pct}', `${value > 0 ? '+' : ''}${value}`)}</span>;
}

function Kpi({ label, value, note, children }) {
  return (
    <div className="kpi-metric-card">
      <div className="kpi-numbers-wrap">
        <div className="kpi-big-value tabular-nums">{value}</div>
        <div className="kpi-label-text">{label}</div>
        {note && <div className="cell-sub" style={{ marginTop: 4 }}>{note}</div>}
        {children}
      </div>
    </div>
  );
}

/** Equal-sized state tiles placed roughly where each state sits; darker = more tenders this week. */
function TileMap({ states, label }) {
  const max = Math.max(1, ...states.filter((s) => s.inScope).map((s) => s.count));
  const width = COLUMNS * (TILE + GAP);
  const height = ROWS * (TILE + GAP);
  return (
    <svg className="tile-map" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {states.filter((s) => s.tile).map((s) => {
        const [x, y] = s.tile;
        const level = s.inScope ? s.count / max : 0;
        const fill = !s.inScope ? '#F1F5F9' : s.count === 0 ? '#E8F0FE' : `rgba(0, 102, 255, ${0.25 + level * 0.75})`;
        const dark = s.inScope && level > 0.5;
        return (
          <g key={s.code} transform={`translate(${x * (TILE + GAP)}, ${y * (TILE + GAP)})`}>
            <title>{`${s.name}: ${s.count}`}</title>
            <rect width={TILE} height={TILE} rx={6} fill={fill} stroke={s.inScope ? '#BFD4FF' : '#E2E8F0'} />
            <text x={TILE / 2} y={TILE / 2 - 2} textAnchor="middle" fontSize="12" fontWeight="700" fill={dark ? '#FFFFFF' : '#0F172A'}>{s.code}</text>
            <text x={TILE / 2} y={TILE / 2 + 14} textAnchor="middle" fontSize="11" fill={dark ? '#E0EAFF' : '#475569'}>{s.inScope ? s.count : ''}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Section({ title, note, children, flush }) {
  return (
    <Card title={title} flush={flush}>
      {note && <p className="cell-sub" style={{ marginBottom: 12 }}>{note}</p>}
      {children}
    </Card>
  );
}

export default function BundleView({ snapshot: s }) {
  const { t, lang } = useI18n();
  const scopeText = (list, all) => (list.length ? list.join(', ') : all);
  const bandLabel = (b) => t(`reports.band_${b.key}`);
  const calendarKind = { 'Submission deadline': 'Submission deadline', 'Pre-bid meeting': t('tender.prebid'), 'Bid opening': t('tender.opening') };

  const volume = s.volumeTrend.map((w, i) => ({ ...w, name: w.label, current: i === 4 }));
  const topWeeks = s.categoryDemand.length ? s.volumeTrend.map((w, i) => {
    const row = { name: w.label };
    s.categoryDemand.forEach((c) => { row[c.category] = c.weeks[i]; });
    return row;
  }) : [];

  return (
    <>
      <div className="note note-info" style={{ display: 'block' }}>
        <b>{s.period.label}</b> · {t('reports.scope')}: {scopeText(s.scope.categories, t('reports.allCategories'))} · {scopeText(s.scope.states, t('reports.allStates'))} · {scopeText(s.scope.departments, t('reports.allDepartments'))}
        <span className="cell-sub"> ({t('reports.basis', { basis: s.scope.basis })})</span>
      </div>

      <div className="kpi-cards-grid">
        <Kpi label={t('reports.kpiTenders')} value={s.summary.count.toLocaleString('en-IN')}>
          <div className="cell-sub" style={{ marginTop: 4 }}>
            <Change value={s.summary.changeVsPrevWeekPct} label={t('reports.vsLast')} />
            {s.summary.changeVsAveragePct !== null && <> · <Change value={s.summary.changeVsAveragePct} label={t('reports.vsAvg')} /></>}
          </div>
        </Kpi>
        <Kpi label={t('reports.kpiValue')} value={s.summary.value > 0 ? formatInr(s.summary.value) : t('reports.notPublished')}
          note={s.summary.undisclosed > 0 ? `${t('reports.kpiNoValue')}: ${s.summary.undisclosed} (${t('reports.ofTenders', { pct: s.summary.undisclosedSharePct })})` : null} />
        <Kpi label={t('reports.kpiDeadlines')} value={s.summary.closingWithinTwoWeeks} note={t('reports.nextTwo')} />
      </div>

      <Section title={t('reports.s1')} note={t('reports.s1n')}>
        <div className="chart-box" role="img" aria-label={t('reports.s1')}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={volume} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip formatter={(v, _n, p) => [v, `${t('reports.count')} (${formatInr(p.payload.value, t('reports.notPublished'))})`]} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {volume.map((w) => <Cell key={w.weekStart} fill={w.current ? '#0066FF' : '#9DBFFF'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title={t('reports.s2')} note={t('reports.s2n')}>
        <TileMap states={s.states} label={t('reports.s2')} />
        {s.unmatchedStates > 0 && <p className="cell-sub" style={{ marginTop: 10 }}>{t('reports.unmatched', { n: s.unmatchedStates })}</p>}
      </Section>

      <Section title={t('reports.s3')} note={t('reports.s3n')} flush>
        {s.departments.length === 0 ? <p className="cell-sub" style={{ padding: 20 }}>{t('results.noResults')}</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>#</th><th>{t('reports.department')}</th><th className="num">{t('reports.count')}</th><th className="num">{t('reports.value')}</th><th className="num">{t('reports.vsLastWeek')}</th></tr></thead>
            <tbody>{s.departments.map((d) => (
              <tr key={d.department}>
                <td>{d.rank}</td><td className="cell-title">{d.department}</td><td className="num">{d.count}</td>
                <td className="num">{d.value > 0 ? formatInr(d.value) : <span className="not-disclosed-fallback">{t('reports.notPublished')}</span>}</td>
                <td className="num"><span style={{ color: d.change > 0 ? '#047857' : d.change < 0 ? '#B91C1C' : '#64748B', fontWeight: 600 }}>{d.change > 0 ? '+' : ''}{d.change}</span></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Section>

      <Section title={t('reports.s4')} note={t('reports.s4n')}>
        <div className="chart-box" style={{ height: 220 }} role="img" aria-label={t('reports.s4')}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={s.valueBands.map((b) => ({ name: bandLabel(b), count: b.count, key: b.key }))} layout="vertical" margin={{ left: 10, right: 24 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {s.valueBands.map((b) => <Cell key={b.key} fill={b.key === 'undisclosed' ? '#CBD5E1' : '#0066FF'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title={t('reports.s5')} note={t('reports.s5n')}>
        {s.categoryDemand.length === 0 ? <p className="cell-sub">{t('results.noResults')}</p> : (
          <>
            <div className="chart-box" role="img" aria-label={t('reports.s5')}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={topWeeks} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip />
                  {s.categoryDemand.map((c, i) => <Line key={c.category} type="monotone" dataKey={c.category} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="table-wrap" style={{ marginTop: 12 }}><table className="table">
              <thead><tr><th>{t('reports.category')}</th><th className="num">{t('reports.thisWeek')}</th><th className="num">{t('reports.prior')}</th><th className="num">{t('reports.change')}</th><th className="num">{t('reports.medianThis')}</th><th className="num">{t('reports.medianPrior')}</th></tr></thead>
              <tbody>{s.categoryDemand.map((c) => {
                const p = s.categoryPricing.find((x) => x.category === c.category);
                return (
                  <tr key={c.category}>
                    <td className="cell-title">{c.category}</td><td className="num">{c.thisWeek}</td><td className="num">{c.prevAvg}</td>
                    <td className="num">{c.change === null ? '-' : pctText(c.change)}</td>
                    <td className="num">{p?.medianThisWeek != null ? formatInr(p.medianThisWeek) : <span className="cell-sub">{t('reports.tooFew')}</span>}</td>
                    <td className="num">{p?.medianPrior4Weeks != null ? formatInr(p.medianPrior4Weeks) : <span className="cell-sub">{t('reports.tooFew')}</span>}</td>
                  </tr>);
              })}</tbody>
            </table></div>
          </>
        )}
      </Section>

      <Section title={t('reports.s6')} note={t('reports.s6n')} flush>
        {s.competition.length === 0 ? <p className="cell-sub" style={{ padding: 20 }}>{t('results.noResults')}</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('reports.department')}</th><th className="num">{t('reports.results')}</th><th className="num">{t('reports.avgBidders')}</th><th className="num">{t('reports.avgQualified')}</th></tr></thead>
            <tbody>{s.competition.map((c) => (
              <tr key={c.department}>
                <td className="cell-title">{c.department}</td><td className="num">{c.awards}</td>
                {c.available ? (<><td className="num">{c.avgBidders}</td><td className="num">{c.avgQualified ?? '-'}</td></>)
                  : <td className="num cell-sub" colSpan={2}>{t('reports.notEnoughData')}</td>}
              </tr>))}</tbody>
          </table></div>
        )}
      </Section>

      <Section title={t('reports.s7')} note={t('reports.s7n')}>
        {s.calendar.length === 0 ? <p className="cell-sub">{t('reports.noDates')}</p> : s.calendar.map((day) => (
          <div className="calendar-day" key={day.date}>
            <h4>{new Intl.DateTimeFormat(lang === 'HI' ? 'hi-IN' : 'en-IN', { weekday: 'long', day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(`${day.date}T12:00:00+05:30`))}</h4>
            {day.items.map((i, n) => (
              <div key={n} className={`calendar-item ${i.type === 'Submission deadline' ? 'deadline' : ''}`}>
                <span className="kind">{calendarKind[i.type] ?? i.type}</span>
                <span>{i.title}{i.department ? ` · ${i.department}` : ''} <span className="cell-sub">{formatDateTime(i.at, lang).split(', ').pop()}</span></span>
              </div>
            ))}
          </div>
        ))}
      </Section>

      <div className="cell-sub" style={{ marginBottom: 20 }}>
        {s.notes.map((n, i) => <p key={i}>{n}</p>)}
        <Badge tone="slate">v{s.version}</Badge>
      </div>
    </>
  );
}
