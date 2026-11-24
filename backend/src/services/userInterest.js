/**
 * A subscriber's "interest" — what their dashboard is personalized around.
 *
 * Keywords and locations are the union of their ACTIVE alert profiles (which were
 * seeded from their industry, their registration state/city, and their frequent
 * searches). The value range is NOT asked for — it is observed from the value
 * filters they have actually used in recent searches (see observedValueRange).
 * These drive the "for you" dashboard sections: best matches, latest, closing
 * soon, and the weekly new count.
 */

/** Load the signed-in user's interest. `preferredState` is the first of their states, by name. */
export async function loadUserInterest(q, userId) {
  const row = await q.one(
    `SELECT
       coalesce((SELECT array_agg(DISTINCT k) FROM alert_profiles p, unnest(p.keywords) k
                  WHERE p.user_id = $1 AND p.status = 'active'), '{}') AS keywords,
       coalesce((SELECT array_agg(DISTINCT s) FROM alert_profiles p, unnest(p.state_ids) s
                  WHERE p.user_id = $1 AND p.status = 'active'), '{}') AS state_ids,
       coalesce((SELECT array_agg(DISTINCT c) FROM alert_profiles p, unnest(p.city_ids) c
                  WHERE p.user_id = $1 AND p.status = 'active'), '{}') AS city_ids`,
    [userId]);
  const stateIds = row.state_ids ?? [];
  const preferredState = stateIds.length
    ? (await q.maybeOne('SELECT name FROM states WHERE id = $1', [stateIds[0]]))?.name ?? null
    : null;
  const keywords = row.keywords ?? [];
  const { valueMin, valueMax } = await observedValueRange(q, userId);
  return {
    keywords,
    stateIds,
    cityIds: row.city_ids ?? [],
    valueMin,
    valueMax,
    preferredState,
    hasInterest: keywords.length > 0 || stateIds.length > 0,
  };
}

/**
 * The value band the subscriber actually filters by — observed from the value
 * filters they used in recent searches (`search_query_logs.filters_applied`),
 * never asked for. Takes the median of each side over recent searches so a one-off
 * search does not skew it; null on a side they have never filtered by.
 */
async function observedValueRange(q, userId, { days = 90, sample = 50 } = {}) {
  const rows = await q.many(
    `SELECT (filters_applied->>'valueMin')::numeric AS vmin, (filters_applied->>'valueMax')::numeric AS vmax
       FROM search_query_logs
      WHERE user_id = $1 AND filters_applied IS NOT NULL
        AND ((filters_applied ->> 'valueMin') IS NOT NULL OR (filters_applied ->> 'valueMax') IS NOT NULL)
        AND created_at >= now() - ($2 || ' days')::interval
      ORDER BY created_at DESC LIMIT $3`,
    [userId, String(days), sample]);
  const median = (vals) => {
    const a = vals.map(Number).filter(Number.isFinite).sort((x, y) => x - y);
    return a.length ? a[Math.floor((a.length - 1) / 2)] : null;
  };
  let valueMin = median(rows.map((r) => r.vmin).filter((v) => v != null));
  const valueMax = median(rows.map((r) => r.vmax).filter((v) => v != null));
  // If the observed sides conflict, drop the lower bound rather than hide everything.
  if (valueMin != null && valueMax != null && valueMin > valueMax) valueMin = null;
  return { valueMin, valueMax };
}

const OPEN = `(t.status = 'Open' AND (t.submission_deadline IS NULL OR t.submission_deadline > now()))`;

/**
 * One keyword → a tsquery whose words are prefix-matched and ANDed ("meter" finds
 * "meters"). Only alphanumeric tokens are kept, so arbitrary user text — "A/C",
 * "R.C.C.", "c++ & steel", "(x" — can never produce an invalid tsquery that would
 * throw a syntax error and 500 the query.
 */
function keywordQuery(add, keyword) {
  const parts = (String(keyword).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 6);
  if (!parts.length) return null;
  return parts.map((w) => `to_tsquery('simple', quote_literal(${add(w.slice(0, 60))}::text) || ':*')`).join(' && ');
}

/**
 * Build the WHERE fragments that select "tenders in this user's interest":
 * keyword match (OR across their keywords, across title/description/BOQ), their
 * states, and their preferred value band (undisclosed-value tenders are kept).
 * Also returns `titleHit` — a boolean SQL expression, true when a keyword hits the
 * title — used to rank best-fit first. All placeholders use the passed `add`, so
 * call this once per query with that query's own params array.
 */
export function interestWhere(add, interest, { openOnly = true } = {}) {
  const where = [];
  if (openOnly) where.push(OPEN);
  const kqs = interest.keywords.map((k) => keywordQuery(add, k)).filter(Boolean);
  const titleHit = kqs.length ? `(${kqs.map((e) => `t.title_tsv @@ (${e})`).join(' OR ')})` : 'FALSE';
  if (kqs.length) {
    const any = kqs.flatMap((e) => [`t.title_tsv @@ (${e})`, `t.desc_tsv @@ (${e})`, `t.boq_tsv @@ (${e})`]).join(' OR ');
    where.push(`(${any})`);
  }
  if (interest.stateIds.length) where.push(`t.state_id = ANY(${add(interest.stateIds)}::int[])`);
  if (interest.valueMin != null) where.push(`(t.estimated_value >= ${add(interest.valueMin)} OR t.estimated_value IS NULL)`);
  if (interest.valueMax != null) where.push(`(t.estimated_value <= ${add(interest.valueMax)} OR t.estimated_value IS NULL)`);
  return { where, titleHit };
}
