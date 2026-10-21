/**
 * Module M6: Deterministic 100-Point Tender Ranking & Shared Account Cap Engine
 * Shan-Deep Tender Intelligence Platform (procure-brain.com)
 */

export function scoreTenderForProfile(tender, profile) {
  const titleLower = (tender.title || '').toLowerCase();
  const descLower = (tender.description || '').toLowerCase();
  const boqText = (tender.boqItems || []).map(b => b.name || '').join(' ').toLowerCase();

  // 1. Negative exclusion check (Hard Filter)
  const excludeKws = profile.exclude_keywords || profile.excludeKeywords || [];
  for (const excl of excludeKws) {
    if (excl && excl.trim()) {
      const term = excl.trim().toLowerCase();
      if (titleLower.includes(term) || descLower.includes(term) || boqText.includes(term)) {
        return { qualified: false, score: 0, reason: `Excluded keyword: "${term}"` };
      }
    }
  }

  // 2. State & Department filters
  const profileStates = profile.states || [];
  if (profileStates.length > 0 && !profileStates.includes('All India') && !profileStates.includes(tender.state)) {
    return { qualified: false, score: 0, reason: 'State mismatch' };
  }

  const profileDepts = profile.departments || [];
  if (profileDepts.length > 0 && !profileDepts.includes('All') && !profileDepts.includes(tender.department) && !profileDepts.includes(tender.dept)) {
    return { qualified: false, score: 0, reason: 'Department mismatch' };
  }

  // 3. 100-Point Deterministic Score Computation
  let score = 0;
  const kws = (profile.keywords || []).filter(k => k && k.trim());

  // Component 1: Keyword in Title (30 pts)
  const inTitle = kws.some(k => titleLower.includes(k.trim().toLowerCase()));
  if (inTitle) {
    score += 30;
  }

  // Component 2: Category Match (25 pts)
  const profileCats = profile.categories || [];
  if (profileCats.length === 0 || profileCats.includes(tender.category) || profileCats.includes(tender.category_name)) {
    score += 25;
  }

  // Component 3: Keyword in Description or BOQ (15 pts)
  const inDescOrBoq = kws.some(k => {
    const term = k.trim().toLowerCase();
    return descLower.includes(term) || boqText.includes(term);
  });
  if (inDescOrBoq) {
    score += 15;
  }

  // Component 4: Department Match (15 pts)
  if (profileDepts.includes(tender.department) || profileDepts.includes(tender.dept)) {
    score += 15;
  }

  // Component 5: Freshness Bonus (15 pts)
  const isFresh = tender.isFresh !== false;
  if (isFresh) {
    score += 15;
  }

  // Closing Soon Flag (< 72 hours remaining)
  const daysLeft = tender.daysLeft !== undefined ? tender.daysLeft : 10;
  const isClosingSoon = daysLeft <= 3 || tender.isUrgent === true;

  return {
    qualified: score > 0,
    score: Math.min(100, score),
    isClosingSoon
  };
}

/**
 * Ranks candidates and applies organization daily digest caps with closing-soon pinning
 */
export function rankAndCapDigest(tenders, profile, cap = 100) {
  const scored = [];

  for (const t of tenders) {
    const res = scoreTenderForProfile(t, profile);
    if (res.qualified) {
      scored.push({
        tender: t,
        score: res.score,
        isClosingSoon: res.isClosingSoon
      });
    }
  }

  // Sort: closing-soon pinned first, then descending by deterministic score
  scored.sort((a, b) => {
    if (a.isClosingSoon && !b.isClosingSoon) return -1;
    if (!a.isClosingSoon && b.isClosingSoon) return 1;
    return b.score - a.score;
  });

  // Apply effective cap
  return scored.slice(0, cap);
}
