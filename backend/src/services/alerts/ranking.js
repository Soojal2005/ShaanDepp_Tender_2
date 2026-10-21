/**
 * The 100-point relevance score for a tender against an alert profile.
 * Deterministic: the same tender and profile always give the same number, and
 * the parts are returned so the score can be explained.
 *
 *   keyword in the title ............ 30
 *   category matches ................ 25
 *   keyword in description / BOQ .... 15
 *   department matches .............. 15
 *   freshness (days since published)  15 / 10 / 5 / 0
 *
 * A dimension the profile does not specify cannot tell tenders apart, so it
 * counts as a full match. 100 therefore means "matches everything you asked
 * for, and is brand new".
 */
const DAY = 86_400_000;

export const WEIGHTS = Object.freeze({ titleKeyword: 30, category: 25, descKeyword: 15, department: 15, freshness: 15 });

/** Within 3 days: full points, 7 days: two-thirds, 14 days: one third, older: none. */
export function freshnessPoints(publishedAt, now = new Date()) {
  if (!publishedAt) return 0;
  const days = (now.getTime() - new Date(publishedAt).getTime()) / DAY;
  if (days <= 3) return 15;
  if (days <= 7) return 10;
  if (days <= 14) return 5;
  return 0;
}

/**
 * @param flags  { titleKeyword, descKeyword, category, department } booleans from the matching query
 * @param profile { keywords[], categoryIds[], departmentIds[] }
 */
export function scoreMatch(flags, profile, publishedAt, now = new Date()) {
  const hasKeywords = profile.keywords.length > 0;
  const parts = {
    titleKeyword: hasKeywords ? (flags.titleKeyword ? WEIGHTS.titleKeyword : 0) : WEIGHTS.titleKeyword,
    category: profile.categoryIds.length ? (flags.category ? WEIGHTS.category : 0) : WEIGHTS.category,
    descKeyword: hasKeywords ? (flags.descKeyword ? WEIGHTS.descKeyword : 0) : WEIGHTS.descKeyword,
    department: profile.departmentIds.length ? (flags.department ? WEIGHTS.department : 0) : WEIGHTS.department,
    freshness: freshnessPoints(publishedAt, now),
  };
  const score = Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0));
  return { score, parts };
}

/** Highest score first; ties go to the sooner deadline, then the lower id, so ordering never wobbles. */
export function rankCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    if (da !== db) return da - db;
    return a.id - b.id;
  });
}
