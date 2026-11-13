/**
 * Pull the money fields a tender listing often omits — estimated value, EMD and
 * tender fee — out of the plain text of an NIT / tender-notice PDF.
 *
 * This is deterministic: a library of label patterns per field, then the shared
 * money parser on the text that follows the label. No model, no guessing from
 * prose. Government NIT templates vary by department, so the patterns are
 * intentionally broad; wrong or ambiguous reads are caught later by sanity
 * checks and sent to the review queue rather than written blindly.
 */
import { parseIndianMoney } from './money.js';

// How much text after a label we treat as "the value for this label". Table
// cells extracted from a PDF frequently land on the next line, so we allow the
// window to cross a newline (collapsed to a space) but keep it short.
const WINDOW = 80;

// A currency- or unit-marked amount, preferred inside a window because it is
// unambiguously money even when other numbers (percentages, item counts) sit
// nearby.
const MARKED = /(?:₹|rs\.?|inr)\s*\d[\d,]*(?:\.\d+)?\s*(?:crores?|lakhs?|lacs?|cr|lac)?|\d[\d,]*(?:\.\d+)?\s*(?:crores?|lakhs?|lacs?|\bcr\b|\blac\b)/i;

const LABELS = {
  estimatedValue: [
    /Estimated\s+(?:Contract\s+)?(?:Cost|Value|Amount)(?:\s+(?:of|put\s+to)\s+(?:Work|Tender|Contract)s?)?/i,
    /Value\s+of\s+(?:Work|Tender|Contract)s?/i,
    /Approx(?:\.|imate)?\s+(?:Cost|Value)/i,
    /Cost\s+of\s+Works?/i,
    /Tender\s+Value/i,
  ],
  emdAmount: [
    /Earnest\s+Money(?:\s+Deposit)?/i,
    /Bid\s+Security(?:\s+Amount)?/i,
    /\bE\.?\s?M\.?\s?D\.?\b/i,
  ],
  tenderFee: [
    /(?:Cost|Price)\s+of\s+(?:Tender\s+)?Document(?:s)?/i,
    /Tender\s+(?:Document\s+)?Fee/i,
    /Document\s+(?:Fee|Cost|Download\s+Cost)/i,
    /Tender\s+Processing\s+Fee/i,
  ],
};

/** Find the money value attached to one label within the given text. */
function findField(text, patterns) {
  for (const label of patterns) {
    const m = label.exec(text);
    if (!m) continue;
    const start = m.index + m[0].length;
    const window = text.slice(start, start + WINDOW).replace(/[\r\n]+/g, ' ');
    // A value immediately introduced by ':' / '=' / '-' is the strongest signal.
    const trimmed = window.replace(/^\s*[:=.\-]*\s*/, '');
    // Prefer an unambiguously-marked amount anywhere in the window...
    const marked = trimmed.match(MARKED);
    const parsed = (marked && parseIndianMoney(marked[0])) || parseIndianMoney(trimmed);
    if (parsed) {
      return { rupees: parsed.rupees, unit: parsed.unit, label: m[0].trim(), snippet: `${m[0]}${window}`.trim().slice(0, 140) };
    }
  }
  return null;
}

/**
 * @param {string} text extracted PDF text
 * @returns {{ estimatedValue, emdAmount, tenderFee, matched: number }}
 *   each field is `{ rupees, unit, label, snippet }` or null.
 */
export function extractTenderFields(text) {
  if (!text || typeof text !== 'string') return { estimatedValue: null, emdAmount: null, tenderFee: null, matched: 0 };
  const estimatedValue = findField(text, LABELS.estimatedValue);
  const emdAmount = findField(text, LABELS.emdAmount);
  const tenderFee = findField(text, LABELS.tenderFee);
  const matched = [estimatedValue, emdAmount, tenderFee].filter(Boolean).length;
  return { estimatedValue, emdAmount, tenderFee, matched };
}
