/**
 * Parse an Indian-rupee money string into a plain number of rupees.
 *
 * Government tender notices write amounts many ways: "Rs. 1,50,00,000/-",
 * "₹ 2.5 Crore", "15.00 Lakh", "INR 1,00,000.00", "2.50 Cr.". We only trust
 * digits + an optional lakh/crore multiplier; amounts spelled out in words
 * ("Rupees Fifteen Lakh only") are deliberately NOT parsed — too risky to guess
 * a bid value from prose. Returns null when nothing parseable is found.
 *
 * Output is a Number of rupees rounded to 2 decimals, matching the
 * numeric(18,2) money columns on `tenders`. A missing value is null, never 0.
 */

// Multipliers, longest/most-specific first so "crore" wins before a bare "cr".
const MULTIPLIERS = [
  { re: /crores?/i, factor: 1e7 },
  { re: /lakhs?|lacs?|lacs|lac/i, factor: 1e5 },
  { re: /\bcr\b\.?/i, factor: 1e7 },
  { re: /\blac?s?\b\.?/i, factor: 1e5 },
];

// A number with Indian (1,50,00,000) or international (1,000,000) grouping, or
// a plain/decimal number (2.5, 150000). Capturing group 1 is the number.
const NUMBER = /(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)/;

// Reasonable rupee bounds for a tender money field. Anything outside is treated
// as a mis-parse (e.g. a PIN code, a phone number, a clause number) → null.
const MIN_RUPEES = 100;
const MAX_RUPEES = 1e13; // 10,00,000 crore — far above any single tender

/** Strip grouping commas and coerce to a float, or null. */
function toNumber(raw) {
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} input text that should contain a single amount
 * @param {{ requireCurrency?: boolean }} [opts] when true, only parse if a
 *   currency marker (Rs/₹/INR) or a lakh/crore unit is present — used when
 *   scanning free text so a stray number isn't read as money.
 * @returns {{ rupees: number, unit: 'crore'|'lakh'|'rupees', raw: string } | null}
 */
export function parseIndianMoney(input, opts = {}) {
  if (input === null || input === undefined) return null;
  const text = String(input);
  const numMatch = text.match(NUMBER);
  if (!numMatch) return null;
  const base = toNumber(numMatch[1]);
  if (base === null) return null;

  // Look only at the slice following the number for a unit, so "2.5 Crore (EMD 50000)"
  // attaches "Crore" to 2.5 and not to the 50000.
  const after = text.slice(numMatch.index + numMatch[1].length, numMatch.index + numMatch[1].length + 12);
  let factor = 1;
  let unit = 'rupees';
  for (const m of MULTIPLIERS) {
    if (m.re.test(after)) { factor = m.factor; unit = m.factor === 1e7 ? 'crore' : 'lakh'; break; }
  }

  const hasCurrency = /(?:₹|rs\.?|inr|rupees)/i.test(text);
  if (opts.requireCurrency && factor === 1 && !hasCurrency) return null;

  const rupees = Math.round(base * factor * 100) / 100;
  if (rupees < MIN_RUPEES || rupees > MAX_RUPEES) return null;
  return { rupees, unit, raw: numMatch[1] + (factor !== 1 ? after.match(/^\s*\S+/)?.[0] ?? '' : '') };
}
