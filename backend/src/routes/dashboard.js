/**
 * Dashboard figures, all computed from the tender table on request. Nothing is
 * hard-coded and nothing is estimated: tenders without a published value are
 * counted separately instead of being treated as zero.
 *
 * The "for you" sections (best matches, latest, closing soon, weekly new count)
 * are personalized to the subscriber's interest — the keywords/locations of their
 * active alert profiles plus their saved value-range preference (see userInterest.js).
 */
import { Router } from 'express';
import { requireAuth, withUserDb } from '../auth/middleware.js';
import { asyncHandler } from '../errors.js';
import { listView } from '../services/tenderSearch.js';
import { interestWhere, loadUserInterest } from '../services/userInterest.js';
import { STAGES } from '../services/cases.js';
import { caseRef } from '../util.js';

const CASE_STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));

const OPEN = `(t.status = 'Open' AND (t.submission_deadline IS NULL OR t.submission_deadline > now()))`;
const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

// The columns listView() reads, plus a per-user watchlist flag. $1 must be the userId.
const TENDER_COLS = `t.id, t.tender_no, t.title, t.description, t.department, t.department_id, t.category, t.state, t.city,
  t.org_type, t.tender_type, t.estimated_value, t.emd_amount, t.emd_status, t.tender_fee, t.publish_date,
  t.prebid_date, t.submission_deadline, t.opening_date, t.status, t.has_boq, t.has_documents, t.source_url,
  EXISTS (SELECT 1 FROM watchlist_items w WHERE w.tender_id = t.id AND w.user_id = $1) AS watchlisted`;

export function dashboardRoutes() {
  const r = Router();

  r.get(
    '/',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.auth.user.id;
      const data = await withUserDb(req, async (q) => {
        const kpi = await q.one(`
          SELECT count(*) FILTER (WHERE ${OPEN})::int AS open_count,
                 coalesce(sum(t.estimated_value) FILTER (WHERE ${OPEN}), 0) AS open_value,
                 count(*) FILTER (WHERE ${OPEN} AND t.estimated_value IS NOT NULL)::int AS open_with_value,
                 count(*) FILTER (WHERE ${OPEN} AND t.submission_deadline <= now() + interval '72 hours')::int AS closing_soon,
                 count(*) FILTER (WHERE t.publish_date >= now() - interval '7 days')::int AS new_week,
                 count(*) FILTER (WHERE t.publish_date >= now() - interval '14 days' AND t.publish_date < now() - interval '7 days')::int AS new_prev_week,
                 max(t.last_source_update) AS data_as_of
            FROM tenders t`);
        const watch = await q.one('SELECT count(*)::int AS n FROM watchlist_items WHERE user_id = $1', [userId]);
        const matched = await q.one(
          `SELECT count(DISTINCT i.tender_id)::int AS n
             FROM alert_digest_items i JOIN alert_digests d ON d.id = i.digest_id
            WHERE i.in_digest AND NOT d.is_test AND d.generated_at >= now() - interval '7 days'`);
        // Matches for THIS subscriber's own alert profiles (keywords + industry + searches).
        const myMatched = await q.one(
          `SELECT count(DISTINCT i.tender_id)::int AS n
             FROM alert_digest_items i
             JOIN alert_digests d ON d.id = i.digest_id
             JOIN alert_profiles p ON p.id = d.profile_id
            WHERE i.in_digest AND NOT d.is_test AND p.user_id = $1
              AND d.generated_at >= now() - interval '7 days'`, [userId]);
        const myMatchTenders = await q.many(
          `SELECT ${TENDER_COLS}, true AS in_digest
             FROM tenders t
             JOIN (SELECT i.tender_id, max(d.generated_at) AS matched_at
                     FROM alert_digest_items i
                     JOIN alert_digests d ON d.id = i.digest_id
                     JOIN alert_profiles p ON p.id = d.profile_id
                    WHERE i.in_digest AND NOT d.is_test AND p.user_id = $1
                      AND d.generated_at >= now() - interval '21 days'
                    GROUP BY i.tender_id) mm ON mm.tender_id = t.id
            WHERE ${OPEN}
            ORDER BY mm.matched_at DESC, t.submission_deadline NULLS LAST
            LIMIT 6`, [userId]);

        const byDepartment = await q.many(`
          SELECT t.department AS label, count(*)::int AS count, coalesce(sum(t.estimated_value), 0) AS value
            FROM tenders t WHERE ${OPEN} AND t.department IS NOT NULL
           GROUP BY t.department ORDER BY count DESC, label LIMIT 8`);
        const stateRows = await q.many(`
          SELECT t.state AS label, count(*)::int AS count
            FROM tenders t WHERE ${OPEN} AND t.state IS NOT NULL
           GROUP BY t.state ORDER BY count DESC, label`);
        const monthly = await q.many(`
          SELECT to_char(date_trunc('month', t.publish_date AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month,
                 count(*)::int AS count, coalesce(sum(t.estimated_value), 0) AS value
            FROM tenders t
           WHERE t.publish_date >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '5 months'
           GROUP BY 1 ORDER BY 1`);
        const bands = await q.one(`
          SELECT count(*) FILTER (WHERE t.estimated_value < 1000000)::int AS under_10l,
                 count(*) FILTER (WHERE t.estimated_value >= 1000000 AND t.estimated_value < 10000000)::int AS l10_to_1cr,
                 count(*) FILTER (WHERE t.estimated_value >= 10000000)::int AS over_1cr,
                 count(*) FILTER (WHERE t.estimated_value IS NULL)::int AS undisclosed
            FROM tenders t WHERE ${OPEN}`);
        const closing = await q.many(
          `SELECT ${TENDER_COLS} FROM tenders t
            WHERE ${OPEN} AND t.submission_deadline <= now() + interval '72 hours'
            ORDER BY t.submission_deadline LIMIT 8`, [userId]);

        // ---- Personalized "for you" ------------------------------------------------
        const interest = await loadUserInterest(q, userId);
        // Run an interest-filtered tender query with a given ORDER BY (+ optional extra WHERE).
        // '{TITLEHIT}' in orderBy is replaced by the best-fit (keyword-in-title) expression.
        const interestQuery = (orderBy, extra = [], limit = 6) => {
          if (!interest.hasInterest) return Promise.resolve([]);
          const params = [];
          const add = (v) => { params.push(v); return `$${params.length}`; };
          add(userId); // $1 for the watchlist flag in TENDER_COLS
          const { where, titleHit } = interestWhere(add, interest);
          const whereSql = [...where, ...extra].join(' AND ');
          return q.many(
            `SELECT ${TENDER_COLS} FROM tenders t WHERE ${whereSql} ORDER BY ${orderBy.replaceAll('{TITLEHIT}', titleHit)} LIMIT ${Number(limit)}`,
            params);
        };
        const bestMatches = await interestQuery(
          `({TITLEHIT}) DESC, t.publish_date DESC NULLS LAST, (t.submission_deadline IS NULL), t.submission_deadline ASC, t.id DESC`);
        const latestInterest = await interestQuery(`t.publish_date DESC NULLS LAST, t.id DESC`);
        const closingInterest = await interestQuery(
          `t.submission_deadline ASC, t.id DESC`, ['t.submission_deadline IS NOT NULL', 't.submission_deadline > now()']);

        // How many new tenders of their interest were published in the last 7 days
        // (their preferred state is already part of the interest filter).
        let newInterest = 0;
        if (interest.hasInterest) {
          const params = [];
          const add = (v) => { params.push(v); return `$${params.length}`; };
          // NB: this count query must not reserve an unused parameter — an unused $1
          // makes Postgres fail with "could not determine data type of parameter $1".
          const { where } = interestWhere(add, interest);
          newInterest = (await q.one(
            `SELECT count(*)::int AS n FROM tenders t WHERE ${[...where, "t.publish_date >= now() - interval '7 days'"].join(' AND ')}`,
            params)).n;
        }

        // Alert box: tenders the subscriber SAVED (watchlisted) that are closing soon.
        const savedClosing = await q.many(
          `SELECT ${TENDER_COLS} FROM tenders t
             JOIN watchlist_items wl ON wl.tender_id = t.id AND wl.user_id = $1
            WHERE t.status = 'Open' AND t.submission_deadline IS NOT NULL AND t.submission_deadline > now()
              AND t.submission_deadline <= now() + interval '14 days'
            ORDER BY t.submission_deadline LIMIT 8`, [userId]);

        // Recently viewed tenders (per-user, from tender_views). Guarded by a
        // table-exists check so the dashboard still loads if migration 020 has not
        // been applied yet (migrations are manual here, DB_MIGRATE_ON_START=off).
        const hasViews = (await q.one(`SELECT to_regclass('public.tender_views') AS t`)).t;
        const recentlyViewed = hasViews ? await q.many(
          `SELECT ${TENDER_COLS} FROM tenders t
             JOIN tender_views v ON v.tender_id = t.id AND v.user_id = $1
            ORDER BY v.viewed_at DESC LIMIT 6`, [userId]) : [];

        // Submission-help (desk) cases for this subscriber's organization, newest first, open before closed.
        const myCases = await q.many(
          `SELECT c.id, c.tender_title, c.stage, c.outcome, c.deadline, c.updated_at, c.assigned_name
             FROM submission_cases c
            ORDER BY (c.stage = 'closed'), c.updated_at DESC LIMIT 5`);

        return { kpi, watch, matched, myMatched, myMatchTenders, byDepartment, stateRows, monthly, bands, closing,
          interest, newInterest, bestMatches, latestInterest, closingInterest, savedClosing, recentlyViewed, myCases };
      });

      // Last six calendar months, with zero where nothing was published.
      const months = [];
      const base = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
        months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
      }
      const byMonth = new Map(data.monthly.map((m) => [m.month, m]));

      const topStates = data.stateRows.slice(0, 5);
      const otherCount = data.stateRows.slice(5).reduce((sum, s) => sum + s.count, 0);
      const stateTotal = data.stateRows.reduce((sum, s) => sum + s.count, 0);
      const states = [...topStates, ...(otherCount ? [{ label: 'Other', count: otherCount }] : [])].map((s) => ({
        ...s, share: stateTotal ? Math.round((s.count / stateTotal) * 1000) / 10 : 0,
      }));

      const k = data.kpi;
      res.json({
        kpis: {
          openTenders: k.open_count,
          openValueKnown: Number(k.open_value),
          openWithValue: k.open_with_value,
          openValueUndisclosed: k.open_count - k.open_with_value,
          closingSoon: k.closing_soon,
          newThisWeek: k.new_week,
          newWeekChangePct: pct(k.new_week, k.new_prev_week),
          watchlisted: data.watch.n,
          matchedToAlertsThisWeek: data.matched.n,
          myMatchesThisWeek: data.myMatched.n,
        },
        matchedTenders: data.myMatchTenders.map(listView),
        byDepartment: data.byDepartment.map((d) => ({ ...d, value: Number(d.value) })),
        byState: states,
        monthly: months.map((month) => ({
          month, count: byMonth.get(month)?.count ?? 0, value: Number(byMonth.get(month)?.value ?? 0),
        })),
        valueBands: {
          under10Lakh: data.bands.under_10l,
          tenLakhTo1Crore: data.bands.l10_to_1cr,
          over1Crore: data.bands.over_1cr,
          undisclosed: data.bands.undisclosed,
        },
        closingSoon: data.closing.map(listView),
        // ---- personalized to the subscriber's interest ----
        interest: {
          hasInterest: data.interest.hasInterest,
          preferredState: data.interest.preferredState,
          valueMin: data.interest.valueMin,
          valueMax: data.interest.valueMax,
          newThisWeek: data.newInterest,
        },
        bestMatches: data.bestMatches.map(listView),
        latestInterest: data.latestInterest.map(listView),
        closingInterest: data.closingInterest.map(listView),
        savedClosing: data.savedClosing.map(listView),
        recentlyViewed: data.recentlyViewed.map(listView),
        myCases: data.myCases.map((c) => ({
          id: c.id, ref: caseRef(c.id), title: c.tender_title, stage: c.stage,
          stageLabel: CASE_STAGE_LABEL[c.stage] ?? c.stage, outcome: c.outcome,
          deadline: c.deadline, updatedAt: c.updated_at, assignedName: c.assigned_name,
        })),
        dataAsOf: k.data_as_of,
      });
    })
  );

  return r;
}
