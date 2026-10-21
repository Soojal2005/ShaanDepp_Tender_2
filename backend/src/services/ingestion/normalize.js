/**
 * Pure functions that turn what a data source sends into the rows we store.
 *
 * Two rules run through all of it:
 *  - A figure the source did not publish stays NULL. It is never defaulted to 0
 *    and never estimated (FR-RESULT-002), so a missing EMD or L1 rate is shown
 *    to the user as "not disclosed" rather than as a made-up number.
 *  - Free text from a third party is stored as given and escaped on output.
 */
import crypto from 'node:crypto';

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
};

/** Deterministic hash of a payload; key order does not matter. */
export const checksumOf = (value) =>
  crypto.createHash('sha256').update(JSON.stringify(sortKeys(value))).digest('hex');

const clean = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
};
export { clean as cleanText };

/** Accepts Date, epoch seconds/milliseconds, or any date string. Implausible years become null. */
export function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  let date;
  if (value instanceof Date) date = value;
  else if (typeof value === 'number' || /^\d{9,13}$/.test(String(value).trim())) {
    const n = Number(value);
    date = new Date(n < 1e11 ? n * 1000 : n);
  } else date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  return year >= MIN_YEAR && year <= MAX_YEAR ? date : null;
}

/** Rupee amount from a number or text like "₹ 1,25,000". Zero, negative or unparseable means "not published". */
export function toMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[₹,\s]|rs\.?|inr/gi, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Like toMoney but 0 is a real answer (a free tender document). */
export function toFee(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[₹,\s]|rs\.?|inr/gi, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

const toCount = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/** Lower-case, accent-free, punctuation-free key used to compare names and aliases. */
export const normalizeKey = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const titleCase = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/(^|[\s(\-/])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());

const SOURCE_STATUS = {
  OPEN: 'Open', ACTIVE: 'Open', LIVE: 'Open',
  CLOSED: 'Closed', EXPIRED: 'Closed',
  CANCELLED: 'Cancelled', CANCELED: 'Cancelled', ANNULLED: 'Cancelled',
  AWARDED: 'Awarded', AOC: 'Awarded',
  EVALUATION: 'Under Evaluation', 'UNDER EVALUATION': 'Under Evaluation',
};

function statusFrom(raw, deadline) {
  const mapped = SOURCE_STATUS[String(raw ?? '').trim().toUpperCase()];
  if (mapped) return mapped;
  return deadline && deadline.getTime() < Date.now() ? 'Closed' : 'Open';
}

function boqFrom(raw) {
  if (!raw) return { items: [], text: null };
  if (typeof raw === 'string') return { items: [], text: clean(raw) };
  const list = Array.isArray(raw) ? raw : raw.items ?? raw.boq_items ?? [];
  const items = list
    .map((row) => {
      if (typeof row === 'string') return { name: clean(row) };
      return {
        code: clean(row.item_code ?? row.code),
        name: clean(row.item_name ?? row.name ?? row.description ?? row.item),
        quantity: Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : null,
        unit: clean(row.unit),
        rate: toMoney(row.estimated_rate ?? row.rate),
        total: toMoney(row.total_amount ?? row.amount ?? row.total),
      };
    })
    .filter((i) => i.name);
  return { items, text: items.map((i) => i.name).join(' ') || null };
}

/**
 * Tenderbook "VendorTenderDto" -> our tender shape. Returns { record, problems };
 * a record with problems is rejected by the caller and counted as an error.
 */
export function normalizeTenderbookTender(dto) {
  const problems = [];
  const sourceId = clean(dto.tender_id ?? dto.tender_reference_id ?? dto.tender_no ?? dto.our_ref_no);
  const title = clean(dto.tender_summary ?? dto.work_desc) ?? (clean(dto.tender_no) ? `Tender ${clean(dto.tender_no)}` : null);
  if (!sourceId) problems.push('missing tender id');
  if (!title) problems.push('missing title');

  const deadline = toDate(dto.due_date);
  const boq = boqFrom(dto.boq_details);
  const emd = toMoney(dto.earnest_amount);
  const documents = (Array.isArray(dto.s3_document_path) ? dto.s3_document_path : [])
    .map((d) => ({
      name: clean(d.file_name) ?? 'Tender document',
      type: clean(d.doc_type) ?? 'NIT',
      externalId: clean(d.download_id),
      url: /^https?:\/\//i.test(d.url ?? '') ? d.url : null,
    }));

  return {
    problems,
    record: {
      sourceId,
      sourceUrl: /^https?:\/\//i.test(dto.source_url ?? dto.tender_url ?? '') ? (dto.source_url ?? dto.tender_url) : null,
      tenderNo: clean(dto.tender_no),
      title,
      description: clean(dto.work_desc ?? dto.tender_summary),
      department: clean(dto.authority),
      category: clean(dto.category ?? dto.sector),
      state: clean(dto.state),
      city: clean(dto.city),
      orgType: clean(dto.ownership),
      tenderType: clean(dto.procurement_type),
      estimatedValue: toMoney(dto.tender_value),
      emdAmount: emd,
      emdStatus: emd ? 'present' : 'not_published',
      tenderFee: toFee(dto.doc_cost),
      publishDate: toDate(dto.pub_date),
      prebidDate: toDate(dto.prebid_date ?? dto.pre_bid_date),
      submissionDeadline: deadline,
      openingDate: toDate(dto.open_date),
      status: statusFrom(dto.tender_status, deadline),
      hasBoq: boq.items.length > 0 || Boolean(boq.text),
      hasDocuments: documents.length > 0,
      eligibilitySummary: clean(dto.eligibility),
      paymentTerms: clean(dto.payment_terms),
      deliveryTerms: clean(dto.delivery_terms),
      penaltyTerms: clean(dto.penalty_terms),
      boqItems: boq.items,
      boqText: boq.text,
      documents,
      checksum: checksumOf(dto),
    },
  };
}

/** Tenderbook tender-result (award) record -> our award shape. */
export function normalizeTenderbookResult(dto) {
  const problems = [];
  const sourceId = clean(dto.tender_result_id ?? dto.our_ref_no);
  const title = clean(dto.work_desc ?? dto.product_name);
  if (!sourceId) problems.push('missing result id');
  if (!title) problems.push('missing title');

  const bidders = (Array.isArray(dto.bidder_list) ? dto.bidder_list : [])
    .map((b) => {
      const amount = toMoney(b.bid_amount);
      const rank = Number(b.rank);
      return {
        name: clean(b.bidder_name),
        amount,
        rank: Number.isInteger(rank) && rank > 0 ? rank : null,
        technicallyQualified: b.technical_bid_status === 1 ? true : b.technical_bid_status === 0 || b.technical_bid_status === 2 ? false : null,
        isL1: b.aoc_status === 1 || (Number.isInteger(rank) && rank === 1 && amount !== null),
      };
    })
    .filter((b) => b.name);

  const l1 = bidders.find((b) => b.isL1) ?? null;
  const l2 = bidders.filter((b) => !b.isL1 && b.rank === 2)[0] ?? null;
  const l1Amount = l1?.amount ?? null;

  return {
    problems,
    record: {
      sourceId,
      tenderRef: clean(dto.tender_no),
      sourceTenderRef: clean(dto.tender_reference_id),
      title,
      department: clean(dto.authority),
      category: clean(dto.category ?? dto.sector),
      state: clean(dto.state),
      city: clean(dto.city) ? titleCase(clean(dto.city)) : null,
      estimatedValue: toMoney(dto.tender_value ?? dto.estimated_value),
      awardedValue: toMoney(dto.contract_value),
      winnerName: l1?.name ?? null,
      l1Amount,
      l2BidderName: l2?.name ?? null,
      l2Amount: l2?.amount ?? null,
      rateStatus: l1Amount ? 'present' : 'not_published',
      itemName: clean(dto.product_name),
      unit: clean(dto.unit),
      unitRate: toMoney(dto.unit_rate),
      bidderCount: bidders.length || null,
      qualifiedCount: bidders.length ? bidders.filter((b) => b.technicallyQualified === true).length : null,
      awardDate: toDate(dto.contract_date ?? dto.open_date),
      workOrderRef: clean(dto.work_order_no ?? dto.work_order_ref),
      sourcePortal: clean(dto.procurement_source_name ?? dto.platforms),
      bidders,
      checksum: checksumOf(dto),
    },
  };
}

export { toCount };
