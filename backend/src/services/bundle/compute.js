/**
 * Builds the weekly analytical bundle for one subscriber: eight sections
 * computed from the tender table against THAT subscriber's own categories,
 * states and departments (taken from their alert profiles; a dimension no
 * profile restricts is treated as "all").
 *
 * The result is a plain JSON snapshot. The on-screen charts, the PDF and the
 * Excel workbook are all rendered from the same snapshot, so the three can
 * never disagree.
 */
import { addDays, istStart, periodLabel, weekShort } from './period.js';
import { TILE_GRID } from './tilemap.js';

export const SNAPSHOT_VERSION = 1;
const DAY = 86_400_000;
const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const round = (v, d = 1) => (v === null || v === undefined ? null : Math.round(Number(v) * 10 ** d) / 10 ** d);
const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);

/** Scope from the organization's active alert profiles. */
export async function scopeForOrg(q, orgId) {
  const profiles = await q.many(
    `SELECT category_ids, state_ids, department_ids FROM alert_profiles WHERE organization_id = $1 AND status = 'active'`, [orgId]);
  const pick = (key) => (profiles.length && profiles.every((p) => p[key].length) ? [...new Set(profiles.flatMap((p) => p[key]))] : []);
  const scope = { categoryIds: pick('category_ids'), stateIds: pick('state_ids'), departmentIds: pick('department_ids'), profiles: profiles.length };
  const names = async (table, ids) => (ids.length ? (await q.many(`SELECT name FROM ${table} WHERE id = ANY($1::int[]) ORDER BY name`, [ids])).map((r) => r.name) : []);
  return {
    ...scope,
    categories: await names('tender_categories', scope.categoryIds),
    states: await names('states', scope.stateIds),
    departments: await names('departments', scope.departmentIds),
    basis: profiles.length ? 'alert profiles' : 'whole market (no active alert profiles)',
  };
}

function scopeClause(scope, params) {
  const add = (v) => { params.push(v); return `$${params.length}`; };
  const parts = [];
  if (scope.categoryIds.length) parts.push(`t.category_id = ANY(${add(scope.categoryIds)}::int[])`);
  if (scope.stateIds.length) parts.push(`t.state_id = ANY(${add(scope.stateIds)}::int[])`);
  if (scope.departmentIds.length) parts.push(`t.department_id = ANY(${add(scope.departmentIds)}::int[])`);
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

/**
 * @param q open transaction
 * @param {{id:number, name:string}} org
 * @param {string} periodStart Monday as YYYY-MM-DD
 */
export async function computeBundle(q, org, periodStart, { now = new Date() } = {}) {
  const scope = await scopeForOrg(q, org.id);
  const start = istStart(periodStart);
  const end = new Date(start.getTime() + 7 * DAY);
  const base = new Date(start.getTime() - 28 * DAY); // five weekly buckets: four before, then this one
  const prevStart = new Date(start.getTime() - 7 * DAY);

  const withScope = (extra = '') => {
    const params = [];
    const clause = scopeClause(scope, params);
    return { params, clause, extra };
  };
  const run = (sql, extraParams, fill) => {
    const { params, clause } = withScope();
    const all = [...extraParams, ...params];
    // Extra parameters come first, scope placeholders are renumbered after them.
    const shifted = clause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + extraParams.length}`);
    return q.many(sql.replace('/*SCOPE*/', shifted), all).then(fill);
  };

  // 1. Volume and value, this week against the previous four.
  const weekly = await run(
    `SELECT floor(extract(epoch FROM (t.publish_date - $1::timestamptz)) / 604800)::int AS wk,
            count(*)::int AS n, coalesce(sum(t.estimated_value), 0) AS value,
            count(*) FILTER (WHERE t.estimated_value IS NULL)::int AS undisclosed
       FROM tenders t WHERE t.publish_date >= $1 AND t.publish_date < $2 /*SCOPE*/ GROUP BY 1`, [base, end], (rows) => rows);
  const volumeTrend = [0, 1, 2, 3, 4].map((wk) => {
    const row = weekly.find((r) => r.wk === wk);
    const weekStart = addDays(periodStart, (wk - 4) * 7);
    return { weekStart, label: weekShort(weekStart), count: row?.n ?? 0, value: num(row?.value), undisclosed: row?.undisclosed ?? 0 };
  });
  const thisWeek = volumeTrend[4];
  const prior = volumeTrend.slice(0, 4);
  const priorAvgCount = prior.reduce((s, w) => s + w.count, 0) / 4;
  const priorAvgValue = prior.reduce((s, w) => s + w.value, 0) / 4;

  // 2. State-wise picture (all states, so the map can show where nothing is happening).
  const stateRows = await run(
    `SELECT s.id, s.name, s.code, count(t.id)::int AS n, coalesce(sum(t.estimated_value), 0) AS value
       FROM states s LEFT JOIN tenders t ON t.state_id = s.id AND t.publish_date >= $1 AND t.publish_date < $2 /*SCOPE*/
      GROUP BY s.id, s.name, s.code ORDER BY n DESC, s.name`, [start, end], (rows) => rows);
  const states = stateRows.map((r) => ({
    id: r.id, name: r.name, code: r.code, count: r.n, value: num(r.value),
    inScope: !scope.stateIds.length || scope.stateIds.includes(r.id),
    tile: TILE_GRID[r.code] ?? null,
  }));
  const unmatchedStates = (await run(
    `SELECT count(*)::int AS n FROM tenders t WHERE t.state_id IS NULL AND t.publish_date >= $1 AND t.publish_date < $2 /*SCOPE*/`, [start, end], (rows) => rows))[0].n;

  // 3. Department opportunity with movement since last week.
  const deptRows = await run(
    `SELECT t.department AS label,
            count(*) FILTER (WHERE t.publish_date >= $1)::int AS n,
            coalesce(sum(t.estimated_value) FILTER (WHERE t.publish_date >= $1), 0) AS value,
            count(*) FILTER (WHERE t.publish_date < $1)::int AS prev_n
       FROM tenders t WHERE t.publish_date >= $3 AND t.publish_date < $2 AND t.department IS NOT NULL /*SCOPE*/ GROUP BY t.department`,
    [start, end, prevStart], (rows) => rows);
  // One ordering drives both the table and the rank column: most tenders, then highest value, then name.
  const departments = deptRows.filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n || num(b.value) - num(a.value) || a.label.localeCompare(b.label)).slice(0, 10)
    .map((r, i) => ({ department: r.label, count: r.n, value: num(r.value), prevCount: r.prev_n, change: r.n - r.prev_n, rank: i + 1 }));
  const departmentsByValue = [...deptRows].filter((r) => num(r.value) > 0).sort((a, b) => num(b.value) - num(a.value)).slice(0, 5)
    .map((r) => ({ department: r.label, value: num(r.value), count: r.n }));

  // 4. Value bands (a tender with no published value gets its own band).
  const bandRow = (await run(
    `SELECT count(*) FILTER (WHERE t.estimated_value < 1000000)::int AS under10,
            count(*) FILTER (WHERE t.estimated_value >= 1000000 AND t.estimated_value < 10000000)::int AS mid,
            count(*) FILTER (WHERE t.estimated_value >= 10000000)::int AS over1cr,
            count(*) FILTER (WHERE t.estimated_value IS NULL)::int AS undisclosed
       FROM tenders t WHERE t.publish_date >= $1 AND t.publish_date < $2 /*SCOPE*/`, [start, end], (rows) => rows))[0];
  const valueBands = [
    { key: 'under10Lakh', label: 'Under ₹10 lakh', count: bandRow.under10 },
    { key: 'tenLakhTo1Crore', label: '₹10 lakh - ₹1 crore', count: bandRow.mid },
    { key: 'over1Crore', label: 'Above ₹1 crore', count: bandRow.over1cr },
    { key: 'undisclosed', label: 'Value not published', count: bandRow.undisclosed },
  ];

  // 5. Demand and pricing pattern by category.
  const catRows = await run(
    `SELECT floor(extract(epoch FROM (t.publish_date - $1::timestamptz)) / 604800)::int AS wk, t.category AS label, count(*)::int AS n
       FROM tenders t WHERE t.publish_date >= $1 AND t.publish_date < $2 AND t.category IS NOT NULL /*SCOPE*/ GROUP BY 1, 2`, [base, end], (rows) => rows);
  const totals = new Map();
  for (const r of catRows) totals.set(r.label, (totals.get(r.label) ?? 0) + r.n);
  const topCategories = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([label]) => label);
  const categoryDemand = topCategories.map((category) => {
    const weeks = [0, 1, 2, 3, 4].map((wk) => catRows.find((r) => r.label === category && r.wk === wk)?.n ?? 0);
    const prevAvg = weeks.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
    return { category, weeks, thisWeek: weeks[4], prevAvg: round(prevAvg), change: pct(weeks[4], prevAvg) };
  });
  const priceRows = await run(
    `SELECT t.category AS label,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY t.estimated_value) FILTER (WHERE t.publish_date >= $1) AS median_now,
            count(t.estimated_value) FILTER (WHERE t.publish_date >= $1)::int AS n_now,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY t.estimated_value) FILTER (WHERE t.publish_date < $1) AS median_prior,
            count(t.estimated_value) FILTER (WHERE t.publish_date < $1)::int AS n_prior
       FROM tenders t WHERE t.publish_date >= $3 AND t.publish_date < $2 AND t.category IS NOT NULL AND t.estimated_value IS NOT NULL /*SCOPE*/
      GROUP BY t.category ORDER BY count(*) DESC, t.category LIMIT 8`, [start, end, base], (rows) => rows);
  const categoryPricing = priceRows.map((r) => ({
    category: r.label,
    // A median of fewer than three published values says little, so it is withheld.
    medianThisWeek: r.n_now >= 3 ? round(r.median_now, 0) : null, samplesThisWeek: r.n_now,
    medianPrior4Weeks: r.n_prior >= 3 ? round(r.median_prior, 0) : null, samplesPrior: r.n_prior,
    changePct: r.n_now >= 3 && r.n_prior >= 3 ? pct(Number(r.median_now), Number(r.median_prior)) : null,
  }));

  // 6. Competition density where result data exists.
  const compRows = departments.length
    ? await q.many(
        `SELECT a.department AS label, count(*)::int AS awards, count(a.bidder_count)::int AS with_bidders,
                avg(a.bidder_count) AS avg_bidders, avg(a.qualified_count) AS avg_qualified
           FROM historical_awards a WHERE a.department = ANY($1::text[]) AND a.award_date >= $2::date
          GROUP BY a.department ORDER BY count(*) DESC`,
        [departments.map((d) => d.department), addDays(periodStart, -120)])
    : [];
  const competition = departments.map((d) => {
    const r = compRows.find((c) => c.label === d.department);
    return r && r.with_bidders >= 3
      ? { department: d.department, awards: r.awards, avgBidders: round(r.avg_bidders), avgQualified: r.avg_qualified === null ? null : round(r.avg_qualified), available: true }
      : { department: d.department, awards: r?.awards ?? 0, avgBidders: null, avgQualified: null, available: false };
  });

  // 7. Critical dates over the coming two weeks.
  const calendarStart = end;
  const calendarEnd = new Date(end.getTime() + 14 * DAY);
  const calRows = await run(
    `SELECT t.id, t.title, t.department, d.kind, d.at
       FROM tenders t
       CROSS JOIN LATERAL (VALUES ('Submission deadline', t.submission_deadline), ('Pre-bid meeting', t.prebid_date), ('Bid opening', t.opening_date)) AS d(kind, at)
      WHERE t.status = 'Open' AND d.at >= $1 AND d.at < $2 /*SCOPE*/
      ORDER BY d.at, t.id LIMIT 200`, [calendarStart, calendarEnd], (rows) => rows);
  const byDay = new Map();
  for (const r of calRows) {
    const day = new Date(r.at.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ type: r.kind, tenderId: r.id, title: r.title, department: r.department, at: r.at });
  }
  const calendar = [...byDay.entries()].map(([date, items]) => ({ date, items }));

  const undisclosedShare = thisWeek.count ? Math.round((thisWeek.undisclosed / thisWeek.count) * 100) : 0;
  return {
    version: SNAPSHOT_VERSION,
    organization: { id: org.id, name: org.name },
    period: { start: periodStart, end: addDays(periodStart, 6), label: periodLabel(periodStart) },
    generatedAt: now.toISOString(),
    scope: { categories: scope.categories, states: scope.states, departments: scope.departments, basis: scope.basis },
    summary: {
      count: thisWeek.count, value: thisWeek.value, undisclosed: thisWeek.undisclosed, undisclosedSharePct: undisclosedShare,
      prevWeekCount: prior[3].count, changeVsPrevWeekPct: pct(thisWeek.count, prior[3].count),
      priorFourWeekAvgCount: round(priorAvgCount), changeVsAveragePct: pct(thisWeek.count, priorAvgCount),
      valueChangeVsAveragePct: pct(thisWeek.value, priorAvgValue),
      closingWithinTwoWeeks: calendar.reduce((n, d) => n + d.items.filter((i) => i.type === 'Submission deadline').length, 0),
    },
    volumeTrend, states, unmatchedStates, departments, departmentsByValue, valueBands, categoryDemand, categoryPricing, competition, calendar,
    notes: [
      'Counts and values cover tenders published in the licensed data feed during the week and matching your scope.',
      'Tenders that did not publish a value are counted but left out of every value total; they are never treated as zero.',
      'Competition figures use published results from the last 120 days and appear only where at least three results list the number of bidders.',
    ],
  };
}
