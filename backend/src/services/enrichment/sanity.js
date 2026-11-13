/**
 * Decide whether an extracted money field is trustworthy enough to write
 * automatically, or should go to the admin review queue instead. This is the
 * safety net that replaces an LLM's judgement: cheap, explainable rules.
 */

// Absolute plausible bounds per field, in rupees.
const BOUNDS = {
  estimatedValue: [10_000, 1e12],   // 10k .. 1 lakh crore
  emdAmount: [500, 5e8],            // 500 .. 50 crore
  tenderFee: [100, 200_000],        // fees are small
};
// EMD is almost always a small fraction of the estimated cost. Outside this
// band the pair is suspicious (we likely attached the wrong number to one).
const EMD_RATIO = [0.001, 0.12]; // 0.1% .. 12%

const inBounds = (v, [lo, hi]) => v !== null && v !== undefined && v >= lo && v <= hi;

/**
 * @param {{ estimatedValue, emdAmount, tenderFee }} extracted  each `{rupees}` or null
 * @param {{ knownEstimatedValue?: number|null }} ctx  value the listing already has
 * @returns {{ decisions: Record<string,'fill'|'review'>, issues: string[] }}
 *   decisions only contains fields that were extracted (non-null).
 */
export function assessFields(extracted, ctx = {}) {
  const decisions = {};
  const issues = [];
  const mark = (field, ok, why) => {
    decisions[field] = ok ? 'fill' : 'review';
    if (!ok) issues.push(`${field}: ${why}`);
  };

  if (extracted.estimatedValue) {
    mark('estimatedValue', inBounds(extracted.estimatedValue.rupees, BOUNDS.estimatedValue), 'outside plausible range');
  }
  if (extracted.tenderFee) {
    mark('tenderFee', inBounds(extracted.tenderFee.rupees, BOUNDS.tenderFee), 'outside plausible range');
  }
  if (extracted.emdAmount) {
    const emd = extracted.emdAmount.rupees;
    if (!inBounds(emd, BOUNDS.emdAmount)) {
      mark('emdAmount', false, 'outside plausible range');
    } else {
      // Cross-check against a value if we have one (extracted takes precedence
      // over the listing value for the ratio test).
      const basis = extracted.estimatedValue?.rupees ?? ctx.knownEstimatedValue ?? null;
      if (basis) {
        const ratio = emd / basis;
        mark('emdAmount', ratio >= EMD_RATIO[0] && ratio <= EMD_RATIO[1], `EMD is ${(ratio * 100).toFixed(1)}% of value`);
      } else {
        mark('emdAmount', true); // in absolute bounds, nothing to cross-check
      }
    }
  }
  return { decisions, issues };
}
