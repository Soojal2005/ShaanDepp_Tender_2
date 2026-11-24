/**
 * Auto-seed a starter alert profile from a subscriber's own portal searches.
 *
 * Repeated searching reveals intent, so we turn it into a daily email without the
 * subscriber lifting a finger: once someone has run a handful of text searches and
 * has no "From your recent searches" profile yet, we distil their recent query
 * words into keywords and create one profile (respecting the plan's cap). It is
 * created active, so the normal digest job emails it; the subscriber can edit or
 * delete it like any other. This complements the explicit "Email me matches for
 * this search" button on the search page (POST /alert-profiles/from-filters).
 */
import { log } from '../../log.js';
import { createProfile } from './profiles.js';

export const SEARCH_PROFILE_NAME = 'From your recent searches';
const SYSTEM_ACTOR = { user: null, ip: null };

// Words that carry no matching signal, so they never become keywords on their own.
const STOP = new Set(['the', 'and', 'for', 'with', 'of', 'in', 'to', 'tender', 'tenders', 'supply', 'work', 'works', 'new', 'all']);

/** Distil recent query strings into up to `max` distinct keyword terms, freshest first. */
export function keywordsFromQueries(queries, max = 15) {
  const seen = new Set();
  const out = [];
  for (const raw of queries ?? []) {
    for (const w of String(raw ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (w.length < 3 || STOP.has(w) || seen.has(w)) continue;
      seen.add(w);
      out.push(w);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * Create a "From your recent searches" profile for every eligible subscriber that
 * does not already have one. Idempotent: an existing profile of that name excludes
 * the user, so re-running never duplicates. Never throws for one user's failure
 * (e.g. plan cap) — it is counted and skipped.
 */
export async function seedProfilesFromSearches(db, { minSearches = 5, lookbackDays = 30, limit = 200 } = {}) {
  const candidates = await db.withContext({ scope: 'system' }, (q) => q.many(
    `SELECT l.user_id, u.organization_id AS org_id, u.email,
            array_agg(l.query_text ORDER BY l.created_at DESC) AS queries
       FROM search_query_logs l
       JOIN users u ON u.id = l.user_id AND u.is_active
       JOIN organizations o ON o.id = u.organization_id AND o.status = 'Active'
      WHERE l.user_id IS NOT NULL AND coalesce(l.query_text, '') <> ''
        AND l.created_at >= now() - ($1 || ' days')::interval
        AND u.role IN ('subscriber', 'tenant_admin')
        AND NOT EXISTS (SELECT 1 FROM alert_profiles p WHERE p.user_id = l.user_id AND p.name = $2)
      GROUP BY l.user_id, u.organization_id, u.email
     HAVING count(*) >= $3
      LIMIT $4`,
    [String(lookbackDays), SEARCH_PROFILE_NAME, minSearches, limit]
  ));

  const summary = { candidates: candidates.length, created: 0, skipped: 0, activity: 0 };
  for (const c of candidates) {
    const keywords = keywordsFromQueries(c.queries);
    if (!keywords.length) { summary.skipped++; continue; }
    try {
      await db.withContext({ scope: 'system' }, (q) => createProfile(
        q, SYSTEM_ACTOR,
        { orgId: c.org_id, userId: c.user_id, userEmail: c.email },
        {
          name: SEARCH_PROFILE_NAME, keywords, excludeKeywords: [], categoryIds: [], departmentIds: [],
          stateIds: [], cityIds: [], tenderTypes: [], valueMin: null, valueMax: null, includeUnknownValue: true,
          recipientEmails: [], frequency: 'daily', weeklyDay: 1, status: 'active',
        }
      ));
      summary.created++;
    } catch (err) {
      // Plan cap reached, or a race created it meanwhile: skip, never sink the batch.
      summary.skipped++;
      log.info('search-seed skipped', { userId: c.user_id, reason: err.message });
    }
  }
  summary.activity = summary.created;
  return summary;
}
