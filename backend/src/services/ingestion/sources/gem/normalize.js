/**
 * Turns a GeM bid (see gem.js -> mapGemDoc) into the same normalized record the
 * rest of the pipeline stores, so upsertTender() handles it exactly like any
 * other crawled tender.
 *
 * Field rules (verified against the live listing and bid PDFs, 2026-11-26):
 *  - Dates: GeM stores the IST wall-clock time with a "Z" suffix — the listing
 *    page itself renders them with timeZone 'UTC' to show them unchanged, and the
 *    bid PDF prints the same digits as IST ("2026-11-26T20:00:00Z" is shown as
 *    "Bid End Date/Time 26-11-2026 20:00:00"). So the digits are read as +05:30;
 *    reading them as UTC would put every deadline 5½ hours late.
 *  - Money: the listing publishes no value, EMD or fee, so they stay NULL (the
 *    project rule: never default an unpublished figure). The public bid PDF
 *    carries EMD and, when the buyer discloses it, the estimated bid value; the
 *    PDF enrichment step reads those into the empty columns.
 *  - tender_type is the procurement type the alert filters use (Works / Goods /
 *    Services): GeM's product/service flag maps straight onto Goods / Services.
 *  - category stays NULL. GeM's "category" is the item list (already the title);
 *    mapping every goods bid to a broad "Goods & Equipment" master would make
 *    subscribers of that category match all ~30k goods bids, and storing the raw
 *    item names would flood the master-mapping queue with thousands of entries.
 *  - state is filled only for a state-government buyer (no central ministry)
 *    whose department name contains the state — e.g. "Department of Higher
 *    Education Madhya Pradesh". A central body's department is not used: "Punjab
 *    National Bank" is under the Ministry of Finance, not a Punjab buyer.
 */
import { STATES } from '../../../../../seed/masters.js';
import { checksumOf, cleanText, statusFrom, toDate } from '../../normalize.js';

const TITLE_MAX = 300;

/**
 * Read a GeM timestamp ("2026-11-26T20:00:00Z", IST digits) as India time.
 * @returns {Date|null}
 */
export function gemDate(value) {
  const raw = cleanText(Array.isArray(value) ? value[0] : value);
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?/);
  if (!m) return null;
  return toDate(`${m[1]}T${m[2]}${m[3] ?? ':00'}+05:30`);
}

// State/UT names and their unambiguous aliases, longest first so "Arunachal
// Pradesh" wins over a shorter overlapping name. Abbreviated aliases ("MP",
// "U.P.", "J&K") are left out: inside a department name they match far too much.
// Canonical names are always kept (Goa is a full name, not an abbreviation).
const STATE_PATTERNS = STATES
  .flatMap(([name, , , aliases]) => [name, ...aliases.filter((a) => a.length >= 4 && !/\./.test(a))].map((n) => [n, name]))
  .sort((a, b) => b[0].length - a[0].length)
  .map(([needle, state]) => [
    new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i'),
    state,
  ]);

/** The state a state-government buyer belongs to, read from its department name. */
export function inferGemState({ ministry, department }) {
  if (ministry || !department) return null;
  for (const [re, state] of STATE_PATTERNS) if (re.test(department)) return state;
  return null;
}

/** Cut a long multi-item list at a word/comma boundary for the title. */
function shortTitle(text) {
  if (!text || text.length <= TITLE_MAX) return text;
  const cut = text.slice(0, TITLE_MAX);
  const at = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(' '));
  return `${(at > TITLE_MAX * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;]+$/, '')}…`;
}

function describe(bid) {
  const flags = [
    bid.bidType === 'direct_ra' && 'Direct reverse auction',
    bid.rateContract && 'Rate contract',
    bid.globalTender && 'Global tender',
    bid.limitedTender && 'Limited tender',
    bid.singlePacket && 'Single packet bid',
    bid.highValue && 'High value bid',
  ].filter(Boolean);
  const buyer = [bid.ministry, bid.department].filter(Boolean).join(' / ');
  return [
    bid.items,
    bid.quantity != null ? `Quantity: ${bid.quantity}` : null,
    buyer ? `Buyer: ${buyer}` : null,
    flags.length ? flags.join(', ') : null,
    `GeM ${bid.bidType === 'direct_ra' ? 'direct reverse auction' : 'bid'} ${bid.bidNumber}`,
  ].filter(Boolean).join('. ');
}

/**
 * @param {object} bid a bid from createGemClient().tenders() (see mapGemDoc)
 * @returns {{ record: object, problems: string[] }}
 */
export function normalizeGemTender(bid) {
  const problems = [];
  const bidNumber = cleanText(bid.bidNumber);
  if (!bidNumber) problems.push('missing bid number');
  const items = cleanText(bid.items);
  const title = shortTitle(items) ?? (bidNumber ? `GeM bid ${bidNumber}` : null);
  if (!title) problems.push('missing title');

  const deadline = gemDate(bid.endDate);
  const documentUrl = /^https:\/\//i.test(bid.documentUrl ?? '') ? bid.documentUrl : null;
  const documents = documentUrl
    ? [{ name: `Bid document ${bidNumber}`, type: 'Tender Document', externalId: cleanText(bid.bidId), url: documentUrl }]
    : [];

  return {
    problems,
    record: {
      sourceId: bidNumber,
      // GeM's own listing links the bid number to this public PDF; it is the
      // bid's only stable public URL.
      sourceUrl: documentUrl,
      tenderNo: bidNumber,
      title,
      description: bidNumber ? describe({ ...bid, bidNumber, items }) : items,
      department: cleanText(bid.department) ?? cleanText(bid.ministry),
      category: null,
      state: inferGemState({ ministry: cleanText(bid.ministry), department: cleanText(bid.department) }),
      city: null,
      orgType: cleanText(bid.ministry) ? 'Central' : null,
      tenderType: bid.procurement === 'Goods' || bid.procurement === 'Services' ? bid.procurement : null,
      estimatedValue: null,
      emdAmount: null,
      emdStatus: 'not_published',
      tenderFee: null,
      publishDate: gemDate(bid.startDate),
      prebidDate: null,
      submissionDeadline: deadline,
      openingDate: null,
      status: statusFrom(null, deadline),
      hasBoq: false,
      hasDocuments: documents.length > 0,
      eligibilitySummary: null,
      paymentTerms: null,
      deliveryTerms: null,
      penaltyTerms: null,
      boqItems: [],
      boqText: null,
      documents,
      checksum: checksumOf(bid),
    },
  };
}
