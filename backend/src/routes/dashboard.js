/**
 * Dashboard figures, all computed from the tender table on request. Nothing is
 * hard-coded and nothing is estimated: tenders without a published value are
 * counted separately instead of being treated as zero.
 */
import { Router } from 'express';
import { requireAuth, withUserDb } from '../auth/middleware.js';
import { asyncHandler } from '../errors.js';
import { listView } from '../services/tenderSearch.js';

const OPEN = `(t.status = 'Open' AND (t.submission_deadline IS NULL OR t.submission_deadline > now()))`;
const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

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
        // Matches for THIS subscriber's own alert profiles (keywords + industry they registered with).
        const myMatched = await q.one(
          `SELECT count(DISTINCT i.tender_id)::int AS n
             FROM alert_digest_items i
             JOIN alert_digests d ON d.id = i.digest_id
             JOIN alert_profiles p ON p.id = d.profile_id
            WHERE i.in_digest AND NOT d.is_test AND p.user_id = $1
              AND d.generated_at >= now() - interval '7 days'`, [userId]);
        const myMatchTenders = await q.many(
          `SELECT t.id, t.tender_no, t.title, t.description, t.department, t.department_id, t.category, t.state, t.city,
                  t.org_type, t.tender_type, t.estimated_value, t.emd_amount, t.emd_status, t.tender_fee, t.publish_date,
                  t.prebid_date, t.submission_deadline, t.opening_date, t.status, t.has_boq, t.has_documents, t.source_url,
                  true AS in_digest,
                  EXISTS (SELECT 1 FROM watchlist_items w WHERE w.tender_id = t.id AND w.user_id = $1) AS watchlisted
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
          `SELECT t.id, t.tender_no, t.title, t.description, t.department, t.department_id, t.category, t.state, t.city,
                  t.org_type, t.tender_type, t.estimated_value, t.emd_amount, t.emd_status, t.tender_fee, t.publish_date,
                  t.prebid_date, t.submission_deadline, t.opening_date, t.status, t.has_boq, t.has_documents, t.source_url,
                  EXISTS (SELECT 1 FROM watchlist_items w WHERE w.tender_id = t.id AND w.user_id = $1) AS watchlisted
             FROM tenders t
            WHERE ${OPEN} AND t.submission_deadline <= now() + interval '72 hours'
            ORDER BY t.submission_deadline LIMIT 8`, [userId]);
        // The subscriber's own interest: the states and cities their active alert
        // profiles cover (seeded from their registered location). Drives the
        // "closing soon in your area" list so the dashboard leads with what is near them.
        const interest = await q.one(
          `SELECT coalesce((SELECT array_agg(DISTINCT s) FROM alert_profiles p, unnest(p.state_ids) s
                              WHERE p.user_id = $1 AND p.status = 'active'), '{}') AS state_ids,
                  coalesce((SELECT array_agg(DISTINCT c) FROM alert_profiles p, unnest(p.city_ids) c
                              WHERE p.user_id = $1 AND p.status = 'active'), '{}') AS city_ids`,
          [userId]);
        const hasInterest = interest.state_ids.length > 0 || interest.city_ids.length > 0;
        const closingForYou = hasInterest ? await q.many(
          `SELECT t.id, t.tender_no, t.title, t.description, t.department, t.department_id, t.category, t.state, t.city,
                  t.org_type, t.tender_type, t.estimated_value, t.emd_amount, t.emd_status, t.tender_fee, t.publish_date,
                  t.prebid_date, t.submission_deadline, t.opening_date, t.status, t.has_boq, t.has_documents, t.source_url,
                  EXISTS (SELECT 1 FROM watchlist_items w WHERE w.tender_id = t.id AND w.user_id = $1) AS watchlisted
             FROM tenders t
            WHERE ${OPEN} AND t.submission_deadline <= now() + interval '7 days'
              AND (($2::int[] <> '{}' AND t.state_id = ANY($2::int[]))
                OR ($3::int[] <> '{}' AND t.city_id = ANY($3::int[])))
            ORDER BY t.submission_deadline LIMIT 8`, [userId, interest.state_ids, interest.city_ids]) : [];
        return { kpi, watch, matched, myMatched, myMatchTenders, byDepartment, stateRows, monthly, bands, closing, hasInterest, closingForYou };
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
        // Personalized to the subscriber's interest (their alert-profile locations).
        hasInterest: data.hasInterest,
        closingForYou: data.closingForYou.map(listView),
        dataAsOf: k.data_as_of,
      });
    })
  );

  return r;
}

