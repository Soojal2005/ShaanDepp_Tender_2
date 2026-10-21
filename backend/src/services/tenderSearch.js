/**
 * Tender search. One canonical filter object (validated by `filtersSchema`) is
 * used by the search screen, saved searches, alert profiles and Excel export,
 * so "what I searched" and "what I get alerted on / exported" can never drift.
 *
 * Text search works on three separate full-text vectors (title, description
 * and BOQ). Every term is matched as a prefix ("meter" finds "meters"), terms
 * are ANDed, a term may sit in any chosen scope, "-word" excludes, and
 * "quoted phrases" must appear together.
 */
import { z } from 'zod';
import { notFound } from '../errors.js';
import { tenderRef } from '../util.js';

const list = (inner, max = 100) =>
  z.preprocess((v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : String(v).split(',')), z.array(inner).max(max)).default([]);
const intId = z.coerce.number().int().positive();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const money = z.coerce.number().min(0).max(1e13);

export const filtersSchema = z.object({
  q: z.string().trim().max(300).optional(),
  scope: list(z.enum(['title', 'description', 'boq']), 3),
  exclude: z.string().trim().max(200).optional(),
  departmentIds: list(intId),
  stateIds: list(intId),
  cityIds: list(intId),
  categoryIds: list(intId),
  tenderTypes: list(z.string().trim().min(1).max(50), 20),
  valueMin: money.optional(),
  valueMax: money.optional(),
  publishFrom: dateOnly.optional(),
  publishTo: dateOnly.optional(),
  deadlineFrom: dateOnly.optional(),
  deadlineTo: dateOnly.optional(),
  openingFrom: dateOnly.optional(),
  openingTo: dateOnly.optional(),
  status: z.enum(['open', 'closing_soon', 'closed', 'all']).default('open'),
  // Relation to this organization's email alerts.
  alerts: z.enum(['any', 'matched', 'in_digest', 'not_in_digest']).default('any'),
  sort: z.enum(['relevance', 'deadline', 'published', 'value']).optional(),
  watchlisted: z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()).default(false),
});

export const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Split a search box into required terms, "quoted phrases" and -excluded terms. */
export function parseQuery(text = '') {
  const include = [];
  const exclude = [];
  const pattern = /(-?)"([^"]+)"|(-?)(\S+)/g;
  let m;
  while ((m = pattern.exec(text))) {
    const negative = (m[1] || m[3]) === '-';
    const phrase = m[2] !== undefined;
    const raw = (m[2] ?? m[4]).replace(/[\\'\u0000]/g, ' ').trim();
    if (!/[\p{L}\p{N}]/u.test(raw)) continue;
    const entry = { text: raw.slice(0, 60), phrase };
    (negative ? exclude : include).push(entry);
  }
  return { include, exclude };
}

/** Builds WHERE conditions for a filter set. `omit` leaves out one facet so its own counts stay useful. */
function buildWhere(filters, { userId = null, orgId = null, omit = null } = {}) {
  const params = [];
  const where = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };

  const scope = filters.scope.length ? filters.scope : ['title', 'description', 'boq'];
  const vectorOf = { title: 't.title_tsv', description: 't.desc_tsv', boq: 't.boq_tsv' };
  const termQuery = (term) => {
    const p = add(term.text);
    return term.phrase ? `phraseto_tsquery('simple', ${p})` : `to_tsquery('simple', quote_literal(${p}::text) || ':*')`;
  };
  const matches = (tsq, vectors) => `(${vectors.map((v) => `${v} @@ ${tsq}`).join(' OR ')})`;

  const parsed = parseQuery(filters.q ?? '');
  const extraExclusions = parseQuery((filters.exclude ?? '').split(/[\s,]+/).filter(Boolean).map((w) => `-${w}`).join(' ')).exclude;
  const rankParts = [];

  for (const term of parsed.include) {
    const tsq = termQuery(term);
    const clause = matches(tsq, scope.map((s) => vectorOf[s]));
    // A single bare term may also be a tender number / id.
    if (parsed.include.length === 1 && !term.phrase) {
      const p = add(term.text);
      where.push(`(${clause} OR t.tender_no ILIKE ${p}::text || '%' OR t.source_id = ${p}::text)`);
    } else where.push(clause);
    rankParts.push(`ts_rank_cd(t.title_tsv, ${tsq}) * 2 + ts_rank_cd(t.desc_tsv, ${tsq})`);
  }
  // Exclusions look everywhere, whatever scope the positive terms use.
  for (const term of [...parsed.exclude, ...extraExclusions]) {
    where.push(`NOT ${matches(termQuery(term), Object.values(vectorOf))}`);
  }

  const inList = (column, key, values) => {
    if (omit === key || !values.length) return;
    where.push(`${column} = ANY(${add(values)}::int[])`);
  };
  inList('t.department_id', 'departmentIds', filters.departmentIds);
  inList('t.state_id', 'stateIds', filters.stateIds);
  inList('t.city_id', 'cityIds', filters.cityIds);
  inList('t.category_id', 'categoryIds', filters.categoryIds);
  if (omit !== 'tenderTypes' && filters.tenderTypes.length) {
    where.push(`lower(t.tender_type) = ANY(${add(filters.tenderTypes.map((s) => s.toLowerCase()))}::text[])`);
  }

  // A value range only returns tenders whose value is actually published.
  if (filters.valueMin !== undefined) where.push(`t.estimated_value >= ${add(filters.valueMin)}`);
  if (filters.valueMax !== undefined) where.push(`t.estimated_value <= ${add(filters.valueMax)}`);

  const range = (column, from, to) => {
    if (from) where.push(`${column} >= ${add(from)}::date`);
    if (to) where.push(`${column} < ${add(to)}::date + 1`);
  };
  range('t.publish_date', filters.publishFrom, filters.publishTo);
  range('t.submission_deadline', filters.deadlineFrom, filters.deadlineTo);
  range('t.opening_date', filters.openingFrom, filters.openingTo);

  const open = `(t.status = 'Open' AND (t.submission_deadline IS NULL OR t.submission_deadline > now()))`;
  if (filters.status === 'open') where.push(open);
  else if (filters.status === 'closing_soon') {
    where.push(`t.status = 'Open' AND t.submission_deadline > now() AND t.submission_deadline <= now() + interval '72 hours'`);
  } else if (filters.status === 'closed') where.push(`NOT ${open}`);

  if (filters.alerts !== 'any' && orgId) {
    const seen = `SELECT 1 FROM alert_digest_items i JOIN alert_digests d ON d.id = i.digest_id
                   WHERE i.tender_id = t.id AND d.organization_id = ${add(orgId)} AND NOT d.is_test`;
    if (filters.alerts === 'matched') where.push(`EXISTS (${seen})`);
    else if (filters.alerts === 'in_digest') where.push(`EXISTS (${seen} AND i.in_digest)`);
    else where.push(`EXISTS (${seen}) AND NOT EXISTS (${seen} AND i.in_digest)`);
  }

  if (filters.watchlisted && userId) {
    where.push(`EXISTS (SELECT 1 FROM watchlist_items w WHERE w.tender_id = t.id AND w.user_id = ${add(userId)})`);
  }

  return { params, where: where.length ? where.join(' AND ') : 'TRUE', rank: rankParts.length ? rankParts.join(' + ') : null };
}

const SORTS = {
  deadline: '(t.submission_deadline IS NULL), t.submission_deadline ASC, t.id DESC',
  published: 't.publish_date DESC NULLS LAST, t.id DESC',
  value: 't.estimated_value DESC NULLS LAST, t.id DESC',
};

const COLUMNS = `
  t.id, t.provider_id, t.source_url, t.tender_no, t.title, t.description, t.department, t.department_id,
  t.category, t.category_id, t.state, t.state_id, t.city, t.city_id, t.org_type, t.tender_type,
  t.estimated_value, t.emd_amount, t.emd_status, t.tender_fee, t.publish_date, t.prebid_date,
  t.submission_deadline, t.opening_date, t.status, t.has_boq, t.has_documents`;

export const listView = (r) => ({
  id: r.id,
  ref: tenderRef(r.id),
  tenderNo: r.tender_no,
  title: r.title,
  snippet: r.description && r.description !== r.title ? r.description.slice(0, 260) : null,
  department: r.department,
  departmentId: r.department_id,
  category: r.category,
  state: r.state,
  city: r.city,
  orgType: r.org_type,
  tenderType: r.tender_type,
  estimatedValue: r.estimated_value,
  emdAmount: r.emd_amount,
  emdStatus: r.emd_status,
  tenderFee: r.tender_fee,
  publishDate: r.publish_date,
  prebidDate: r.prebid_date,
  deadline: r.submission_deadline,
  openingDate: r.opening_date,
  status: r.status,
  hasBoq: r.has_boq,
  hasDocuments: r.has_documents,
  sourceUrl: r.source_url,
  watchlisted: Boolean(r.watchlisted),
  inDigest: r.in_digest ?? null,
});

const WATCH = (p) => `EXISTS (SELECT 1 FROM watchlist_items w WHERE w.tender_id = t.id AND w.user_id = ${p}) AS watchlisted`;

export async function searchTenders(q, filters, paging, { userId = null, orgId = null } = {}) {
  const { params, where, rank } = buildWhere(filters, { userId, orgId });
  const { page, pageSize } = paging;

  const sort = filters.sort ?? (rank ? 'relevance' : 'deadline');
  const orderBy = sort === 'relevance' && rank ? `(${rank}) DESC, t.id DESC` : SORTS[sort === 'relevance' ? 'deadline' : sort];

  const total = (await q.one(`SELECT count(*)::int AS n FROM tenders t WHERE ${where}`, params)).n;

  // Extra per-row columns, each with its own placeholder after the filter parameters.
  const rowParams = [...params];
  const add = (v) => { rowParams.push(v); return `$${rowParams.length}`; };
  const limit = add(pageSize);
  const offset = add((page - 1) * pageSize);
  const watch = userId ? WATCH(add(userId)) : 'false AS watchlisted';
  // NULL: no alert of this organization matched it; false: matched but held back; true: emailed.
  const inDigest = orgId
    ? `(SELECT bool_or(i.in_digest) FROM alert_digest_items i JOIN alert_digests d ON d.id = i.digest_id
         WHERE i.tender_id = t.id AND d.organization_id = ${add(orgId)} AND NOT d.is_test) AS in_digest`
    : 'NULL::boolean AS in_digest';

  const rows = await q.many(
    `SELECT ${COLUMNS}, ${watch}, ${inDigest} FROM tenders t WHERE ${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
    rowParams
  );
  return { total, page, pageSize, pages: Math.ceil(total / pageSize), items: rows.map(listView), sort };
}

/** Counts per department / state / category / type for the filter panel. */
export async function tenderFacets(q, filters, { orgId = null } = {}) {
  const facet = async (omit, column, labelColumn, key) => {
    const { params, where } = buildWhere(filters, { omit, orgId });
    const rows = await q.many(
      `SELECT ${column} AS id, ${labelColumn} AS label, count(*)::int AS count
         FROM tenders t WHERE ${where} AND ${column} IS NOT NULL
        GROUP BY ${column}, ${labelColumn} ORDER BY count DESC, label LIMIT 15`,
      params
    );
    return [key, rows];
  };
  const types = async () => {
    const { params, where } = buildWhere(filters, { omit: 'tenderTypes', orgId });
    return ['tenderTypes', await q.many(
      `SELECT t.tender_type AS label, count(*)::int AS count FROM tenders t
        WHERE ${where} AND t.tender_type IS NOT NULL GROUP BY t.tender_type ORDER BY count DESC LIMIT 10`, params)];
  };
  return Object.fromEntries(await Promise.all([
    facet('departmentIds', 't.department_id', 't.department', 'departments'),
    facet('stateIds', 't.state_id', 't.state', 'states'),
    facet('categoryIds', 't.category_id', 't.category', 'categories'),
    types(),
  ]));
}

/** Rows for Excel export (same filters, capped). */
export async function exportTenders(q, filters, { userId = null, orgId = null, limit = 10_000 } = {}) {
  const { params, where, rank } = buildWhere(filters, { userId, orgId });
  const sort = filters.sort ?? (rank ? 'relevance' : 'deadline');
  const orderBy = sort === 'relevance' && rank ? `(${rank}) DESC, t.id DESC` : SORTS[sort === 'relevance' ? 'deadline' : sort];
  return q.many(`SELECT ${COLUMNS} FROM tenders t WHERE ${where} ORDER BY ${orderBy} LIMIT ${Number(limit)}`, params);
}

export async function getTender(q, id, { userId = null, orgId = null } = {}) {
  const row = await q.maybeOne(
    `SELECT ${COLUMNS}, t.eligibility_summary, t.payment_terms, t.delivery_terms, t.penalty_terms, t.last_source_update,
            ${userId ? WATCH('$2') : 'false AS watchlisted'},
            (SELECT bool_or(i.in_digest) FROM alert_digest_items i JOIN alert_digests d ON d.id = i.digest_id
              WHERE i.tender_id = t.id AND d.organization_id = $3 AND NOT d.is_test) AS in_digest,
            (SELECT notes FROM watchlist_items w WHERE w.tender_id = t.id AND w.user_id = $2) AS watch_notes
       FROM tenders t WHERE t.id = $1`,
    [id, userId, orgId]
  );
  if (!row) throw notFound('Tender not found');
  const [documents, boq, corrigenda] = await Promise.all([
    q.many('SELECT id, name, doc_type, size_label, url, external_id FROM tender_documents WHERE tender_id = $1 ORDER BY id', [id]),
    q.many('SELECT item_code, item_name, quantity, unit, estimated_rate, total_amount FROM tender_boq_items WHERE tender_id = $1 ORDER BY id LIMIT 500', [id]),
    q.many('SELECT corrigendum_number, subject, issue_date, attachment_url FROM tender_corrigenda WHERE tender_id = $1 ORDER BY issue_date DESC', [id]),
  ]);
  return {
    ...listView(row),
    snippet: null,
    description: row.description,
    eligibility: row.eligibility_summary,
    paymentTerms: row.payment_terms,
    deliveryTerms: row.delivery_terms,
    penaltyTerms: row.penalty_terms,
    lastUpdated: row.last_source_update,
    watchNotes: row.watch_notes,
    documents: documents.map((d) => ({ id: d.id, name: d.name, type: d.doc_type, sizeLabel: d.size_label, url: d.url, downloadable: Boolean(d.url) })),
    boqItems: boq.map((b) => ({ code: b.item_code, name: b.item_name, quantity: b.quantity, unit: b.unit, rate: b.estimated_rate, total: b.total_amount })),
    corrigenda: corrigenda.map((c) => ({ number: c.corrigendum_number, subject: c.subject, issueDate: c.issue_date, url: c.attachment_url })),
  };
}
