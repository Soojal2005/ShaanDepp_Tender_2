/**
 * Tender results: who won, at what rate, and what that says about the next bid.
 *
 * Honesty rules, repeated here because they matter most in this module:
 *  - A rate the source did not publish is never estimated. Awards without an
 *    L1 amount still appear (winner known) but are left out of every rate figure.
 *  - Every aggregate reports how many awards it is based on, and statistics that
 *    would be misleading on a handful of records are withheld (MIN_SAMPLE).
 *  - "Spread" is (L1 - estimate) / estimate. Negative means the winning bid came
 *    in BELOW the department's estimate.
 */
import { z } from 'zod';
import { notFound } from '../errors.js';

export const MIN_SAMPLE = 5;
const num = (v) => (v === null || v === undefined ? null : Number(v));
const round = (v, digits = 2) => (v === null || v === undefined ? null : Math.round(Number(v) * 10 ** digits) / 10 ** digits);

const list = (inner, max = 100) =>
  z.preprocess((v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : String(v).split(',')), z.array(inner).max(max)).default([]);
const intId = z.coerce.number().int().positive();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const awardFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  departmentIds: list(intId),
  stateIds: list(intId),
  categoryIds: list(intId),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  valueMin: z.coerce.number().min(0).max(1e13).optional(),
  valueMax: z.coerce.number().min(0).max(1e13).optional(),
  winner: z.string().trim().max(150).optional(),
  ratePublished: z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()).default(false),
  sort: z.enum(['date', 'value', 'spread']).default('date'),
});

export const awardPaging = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const SPREAD = `CASE WHEN a.l1_amount IS NOT NULL AND a.estimated_value IS NOT NULL
                     THEN (a.l1_amount - a.estimated_value) / a.estimated_value * 100 END`;

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function buildWhere(f, { skip = [] } = {}) {
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  const where = [];

  for (const word of (f.q ?? '').split(/\s+/).filter(Boolean).slice(0, 6)) {
    const p = add(`%${escapeLike(word)}%`);
    where.push(`(a.tender_title ILIKE ${p} OR a.winner_name ILIKE ${p} OR a.item_name ILIKE ${p} OR a.tender_ref ILIKE ${p} OR a.work_order_ref ILIKE ${p})`);
  }
  if (f.winner) where.push(`a.winner_name ILIKE ${add(`%${escapeLike(f.winner)}%`)}`);
  if (!skip.includes('department') && f.departmentIds.length) where.push(`a.department_id = ANY(${add(f.departmentIds)}::int[])`);
  if (f.stateIds.length) where.push(`a.state_id = ANY(${add(f.stateIds)}::int[])`);
  if (f.categoryIds.length) where.push(`a.category_id = ANY(${add(f.categoryIds)}::int[])`);
  if (f.from) where.push(`a.award_date >= ${add(f.from)}::date`);
  if (f.to) where.push(`a.award_date <= ${add(f.to)}::date`);
  if (f.valueMin !== undefined) where.push(`a.awarded_value >= ${add(f.valueMin)}`);
  if (f.valueMax !== undefined) where.push(`a.awarded_value <= ${add(f.valueMax)}`);
  if (f.ratePublished) where.push('a.l1_amount IS NOT NULL');
  return { params, where: where.length ? where.join(' AND ') : 'TRUE' };
}

export const awardRef = (id) => `RES-${String(id).padStart(6, '0')}`;

const COLUMNS = `a.id, a.tender_id, a.tender_ref, a.tender_title, a.department, a.state, a.category, a.estimated_value,
  a.awarded_value, a.winner_name, a.l1_amount, a.l2_bidder_name, a.l2_amount, a.rate_status, a.item_name, a.unit, a.unit_rate,
  a.bidder_count, a.qualified_count, a.award_date, a.work_order_ref, a.source_portal, ${SPREAD} AS spread`;

export const awardView = (r) => ({
  id: r.id,
  ref: awardRef(r.id),
  tenderId: r.tender_id,
  tenderRef: r.tender_ref,
  title: r.tender_title,
  department: r.department,
  state: r.state,
  category: r.category,
  estimatedValue: num(r.estimated_value),
  awardedValue: num(r.awarded_value),
  winner: r.winner_name,
  l1Amount: num(r.l1_amount),
  l2Bidder: r.l2_bidder_name,
  l2Amount: num(r.l2_amount),
  rateStatus: r.rate_status,
  spreadPct: round(r.spread),
  item: r.item_name,
  unit: r.unit,
  unitRate: num(r.unit_rate),
  bidders: r.bidder_count,
  qualified: r.qualified_count,
  awardDate: r.award_date,
  workOrderRef: r.work_order_ref,
  sourcePortal: r.source_portal,
});

const ORDER = {
  date: 'a.award_date DESC NULLS LAST, a.id DESC',
  value: 'a.awarded_value DESC NULLS LAST, a.id DESC',
  spread: `(${SPREAD}) ASC NULLS LAST, a.id DESC`,
};

export async function searchAwards(q, filters, { page, pageSize }) {
  const { params, where } = buildWhere(filters);
  const total = (await q.one(`SELECT count(*)::int AS n FROM historical_awards a WHERE ${where}`, params)).n;
  const rows = await q.many(
    `SELECT ${COLUMNS} FROM historical_awards a WHERE ${where} ORDER BY ${ORDER[filters.sort]}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return { total, page, pageSize, pages: Math.ceil(total / pageSize), items: rows.map(awardView) };
}

export async function exportAwards(q, filters, limit = 10_000) {
  const { params, where } = buildWhere(filters);
  const rows = await q.many(`SELECT ${COLUMNS} FROM historical_awards a WHERE ${where} ORDER BY ${ORDER[filters.sort]} LIMIT ${Number(limit)}`, params);
  return rows.map(awardView);
}

export async function getAward(q, id) {
  const row = await q.maybeOne(`SELECT ${COLUMNS} FROM historical_awards a WHERE a.id = $1`, [id]);
  if (!row) throw notFound('Result not found');
  const bidders = await q.many(
    `SELECT bidder_name, quoted_amount, rank_position, technically_qualified, is_l1 FROM award_bidders
      WHERE award_id = $1 ORDER BY rank_position NULLS LAST, quoted_amount NULLS LAST, id`, [id]);
  const tender = row.tender_id
    ? await q.maybeOne(`SELECT id, title, submission_deadline, status FROM tenders WHERE id = $1`, [row.tender_id])
    : null;
  return {
    ...awardView(row),
    bidderList: bidders.map((b) => ({ name: b.bidder_name, amount: num(b.quoted_amount), rank: b.rank_position, qualified: b.technically_qualified, isL1: b.is_l1 })),
    tender: tender ? { id: tender.id, title: tender.title, status: tender.status } : null,
  };
}

// ---- Rate analysis -----------------------------------------------------------------------------

const GROUPS = {
  department: { id: 'a.department_id', label: 'a.department' },
  category: { id: 'a.category_id', label: 'a.category' },
  state: { id: 'a.state_id', label: 'a.state' },
};

const STATS = `count(*)::int AS awards,
  count(a.l1_amount)::int AS with_rate,
  count(${SPREAD})::int AS with_spread,
  avg(${SPREAD}) AS avg_spread,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY ${SPREAD}) AS median_spread,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY ${SPREAD}) AS p25,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY ${SPREAD}) AS p75,
  min(${SPREAD}) AS min_spread,
  max(${SPREAD}) AS max_spread`;

const statsView = (r) => {
  const enough = r.with_spread >= MIN_SAMPLE;
  return {
    awards: r.awards,
    withRate: r.with_rate,
    withSpread: r.with_spread,
    // Statistics from a handful of records would mislead, so they are withheld below MIN_SAMPLE.
    avgSpreadPct: enough ? round(r.avg_spread) : null,
    medianSpreadPct: enough ? round(r.median_spread) : null,
    p25: enough ? round(r.p25) : null,
    p75: enough ? round(r.p75) : null,
    minSpreadPct: enough ? round(r.min_spread) : null,
    maxSpreadPct: enough ? round(r.max_spread) : null,
    enoughData: enough,
  };
};

/**
 * L1 against estimate, grouped. Also returns the bid-band suggestion: the range
 * (25th to 75th percentile of historical spread) in which winning bids landed.
 */
export async function rateAnalysis(q, filters, { groupBy = 'department', estimatedValue = null } = {}) {
  const g = GROUPS[groupBy] ?? GROUPS.department;
  const { params, where } = buildWhere(filters);
  const overall = statsView(await q.one(`SELECT ${STATS} FROM historical_awards a WHERE ${where}`, params));
  const groups = await q.many(
    `SELECT ${g.id} AS id, ${g.label} AS label, ${STATS}
       FROM historical_awards a WHERE ${where} AND ${g.label} IS NOT NULL
      GROUP BY ${g.id}, ${g.label} ORDER BY count(*) DESC, ${g.label} LIMIT 50`, params);

  let band = null;
  if (overall.enoughData) {
    band = {
      basedOn: overall.withSpread,
      lowPct: overall.p25, highPct: overall.p75, medianPct: overall.medianSpreadPct,
      low: estimatedValue ? Math.round(estimatedValue * (1 + overall.p25 / 100)) : null,
      high: estimatedValue ? Math.round(estimatedValue * (1 + overall.p75 / 100)) : null,
    };
  }
  return {
    overall,
    band,
    bandNote: band ? null : `Fewer than ${MIN_SAMPLE} awards with both an estimate and a published L1 rate match these filters, so no band is suggested.`,
    groupBy,
    groups: groups.map((r) => ({ id: r.id, label: r.label, ...statsView(r) })),
  };
}

/** The same measure month by month, so a rise or fall in winning rates is visible. */
export async function rateTrend(q, filters) {
  const { params, where } = buildWhere(filters);
  const rows = await q.many(
    `SELECT to_char(date_trunc('month', a.award_date), 'YYYY-MM') AS month, count(*)::int AS awards, count(${SPREAD})::int AS with_spread,
            avg(${SPREAD}) AS avg_spread, avg(a.unit_rate) AS avg_unit_rate, count(a.unit_rate)::int AS with_unit_rate
       FROM historical_awards a WHERE ${where} AND a.award_date IS NOT NULL GROUP BY 1 ORDER BY 1`, params);
  return rows.map((r) => ({
    month: r.month, awards: r.awards, withSpread: r.with_spread,
    avgSpreadPct: r.with_spread >= 2 ? round(r.avg_spread) : null,
    avgUnitRate: r.with_unit_rate >= 2 ? round(r.avg_unit_rate) : null,
  }));
}

/** Like-for-like rate-per-unit comparison: one item and one unit at a time. */
export async function unitRates(q, filters, { item = null, unit = null, groupBy = 'department' } = {}) {
  const g = GROUPS[groupBy] ?? GROUPS.department;
  const { params, where } = buildWhere(filters);
  const combos = await q.many(
    `SELECT lower(a.item_name) AS item, a.unit, count(*)::int AS awards FROM historical_awards a
      WHERE ${where} AND a.unit_rate IS NOT NULL AND a.item_name IS NOT NULL AND a.unit IS NOT NULL
      GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 60`, params);
  if (!item || !unit) return { combos, groups: [], note: combos.length ? null : 'No result in these filters published a rate per unit.' };

  const p = [...params, item.toLowerCase(), unit];
  const groups = await q.many(
    `SELECT ${g.id} AS id, ${g.label} AS label, count(*)::int AS awards, min(a.unit_rate) AS lowest, avg(a.unit_rate) AS average, max(a.unit_rate) AS highest
       FROM historical_awards a
      WHERE ${where} AND a.unit_rate IS NOT NULL AND lower(a.item_name) = $${params.length + 1} AND a.unit = $${params.length + 2} AND ${g.label} IS NOT NULL
      GROUP BY ${g.id}, ${g.label} ORDER BY avg(a.unit_rate)`, p);
  return {
    combos, item, unit, groupBy,
    groups: groups.map((r) => ({ id: r.id, label: r.label, awards: r.awards, lowest: round(r.lowest), average: round(r.average), highest: round(r.highest) })),
    note: null,
  };
}

// ---- Tender analysis ----------------------------------------------------------------------------

/** Department award pattern: how often and how large, estimate-versus-award variance, and how crowded the bidding is. */
export async function departmentPatterns(q, filters) {
  const { params, where } = buildWhere(filters);
  const rows = await q.many(
    `SELECT a.department_id AS id, a.department AS label, count(*)::int AS awards,
            min(a.award_date) AS first_award, max(a.award_date) AS last_award,
            avg(a.awarded_value) AS avg_award, count(a.awarded_value)::int AS with_value,
            avg(CASE WHEN a.awarded_value IS NOT NULL AND a.estimated_value IS NOT NULL
                     THEN (a.awarded_value - a.estimated_value) / a.estimated_value * 100 END) AS avg_variance,
            count(CASE WHEN a.awarded_value IS NOT NULL AND a.estimated_value IS NOT NULL THEN 1 END)::int AS with_variance,
            avg(a.bidder_count) AS avg_bidders, count(a.bidder_count)::int AS with_bidders,
            avg(a.qualified_count) AS avg_qualified
       FROM historical_awards a WHERE ${where} AND a.department IS NOT NULL
      GROUP BY a.department_id, a.department ORDER BY count(*) DESC, a.department LIMIT 50`, params);
  return rows.map((r) => {
    const spanDays = r.first_award && r.last_award ? Math.max(30, (new Date(r.last_award) - new Date(r.first_award)) / 86_400_000) : null;
    return {
      id: r.id, department: r.label, awards: r.awards,
      awardsPerMonth: spanDays ? round((r.awards / spanDays) * 30.4, 1) : null,
      avgAwardValue: r.with_value ? round(r.avg_award, 0) : null,
      avgVariancePct: r.with_variance >= MIN_SAMPLE ? round(r.avg_variance) : null,
      avgBidders: r.with_bidders >= MIN_SAMPLE ? round(r.avg_bidders, 1) : null,
      avgQualified: r.with_bidders >= MIN_SAMPLE && r.avg_qualified !== null ? round(r.avg_qualified, 1) : null,
      sample: r.awards,
    };
  });
}

/**
 * Win rate by firm, repeat winners and where each keeps winning. Participation
 * is counted from the bidders listed in published results, so for sources that
 * list only L1/L2 the win rate overstates a firm's true rate; the screen says so.
 */
export async function bidderProfiles(q, filters, { name = null, minParticipations = 1, limit = 50 } = {}) {
  const { params, where } = buildWhere(filters);
  const p = [...params];
  let nameClause = '';
  if (name) { p.push(`%${escapeLike(name)}%`); nameClause = `AND b.bidder_name ILIKE $${p.length}`; }
  p.push(minParticipations, limit);
  const rows = await q.many(
    `SELECT lower(btrim(b.bidder_name)) AS key, min(b.bidder_name) AS display,
            count(*)::int AS participations, count(*) FILTER (WHERE b.is_l1)::int AS wins,
            sum(a.awarded_value) FILTER (WHERE b.is_l1) AS won_value,
            count(DISTINCT a.department_id) FILTER (WHERE b.is_l1)::int AS departments_won
       FROM award_bidders b JOIN historical_awards a ON a.id = b.award_id
      WHERE ${where} ${nameClause}
      GROUP BY lower(btrim(b.bidder_name))
     HAVING count(*) >= $${p.length - 1}
      ORDER BY count(*) FILTER (WHERE b.is_l1) DESC, count(*) DESC, 1 LIMIT $${p.length}`, p);
  return rows.map((r) => ({
    key: r.key, name: r.display, participations: r.participations, wins: r.wins,
    winRatePct: r.participations ? round((r.wins / r.participations) * 100, 1) : null,
    wonValue: num(r.won_value), departmentsWon: r.departments_won, repeatWinner: r.wins >= 2,
  }));
}

export async function bidderDetail(q, key, filters) {
  const { params, where } = buildWhere(filters);
  const p = [...params, key.toLowerCase().trim()];
  const k = `lower(btrim(b.bidder_name)) = $${p.length}`;
  const departments = await q.many(
    `SELECT a.department AS label, count(*) FILTER (WHERE b.is_l1)::int AS wins, count(*)::int AS participations
       FROM award_bidders b JOIN historical_awards a ON a.id = b.award_id
      WHERE ${where} AND ${k} AND a.department IS NOT NULL GROUP BY a.department
      ORDER BY count(*) FILTER (WHERE b.is_l1) DESC, count(*) DESC LIMIT 20`, p);
  const recent = await q.many(
    `SELECT ${COLUMNS}, b.is_l1 AS won, b.quoted_amount AS their_bid
       FROM award_bidders b JOIN historical_awards a ON a.id = b.award_id
      WHERE ${where} AND ${k} ORDER BY a.award_date DESC NULLS LAST, a.id DESC LIMIT 25`, p);
  return {
    departments: departments.map((d) => ({ department: d.label, wins: d.wins, participations: d.participations, keepsWinning: d.wins >= 2 })),
    recent: recent.map((r) => ({ ...awardView(r), won: r.won, theirBid: num(r.their_bid) })),
  };
}
