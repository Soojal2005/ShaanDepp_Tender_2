/**
 * Turns a scraped CPPP tender (see cppp.js) into the same normalized record the
 * rest of the pipeline stores, so upsertTender() handles it identically to a
 * vendor-API tender.
 *
 * The project rule holds here too: a figure the portal did not publish stays
 * NULL. It is never defaulted to 0.
 */
import {
  checksumOf,
  cleanText,
  statusFrom,
  titleCase,
  toDate,
  toFee,
  toMoney,
} from '../../normalize.js';

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse the date formats CPPP shows, interpreted as India Standard Time:
 *   "25-Nov-2026 03:00 PM", "25/11/2026 15:00", "25-11-2026".
 * Unparseable or implausible values become null (validated via toDate).
 */
export function toCpppDate(value) {
  const str = cleanText(value);
  if (!str) return null;
  const m = str.match(
    /(\d{1,2})[-/ ]([A-Za-z]{3,}|\d{1,2})[-/ ](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/
  );
  if (!m) return null;
  const day = Number(m[1]);
  const monthRaw = m[2];
  const year = Number(m[3]);
  const month = /^\d+$/.test(monthRaw) ? Number(monthRaw) - 1 : MONTHS[monthRaw.slice(0, 3).toLowerCase()];
  if (month === undefined || Number.isNaN(month)) return null;

  let hour = m[4] ? Number(m[4]) : 0;
  const minute = m[5] ? Number(m[5]) : 0;
  const second = m[6] ? Number(m[6]) : 0;
  const ampm = m[7]?.toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;

  const pad = (n) => String(n).padStart(2, '0');
  // +05:30 = IST; toDate validates the year range and rejects nonsense.
  return toDate(`${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+05:30`);
}

/** First segment of a CPPP "Org||Sub-org||Office" chain, tidied for master matching. */
function departmentFrom(chain) {
  const text = cleanText(chain);
  if (!text) return null;
  return cleanText(text.split(/\|\||›|>|\/\//)[0]);
}

/**
 * @param {object} dto a row from createCpppClient().tenders()
 * @returns {{ record: object, problems: string[] }}
 */
export function normalizeCpppTender(dto) {
  const problems = [];
  const sourceId = cleanText(dto.tenderId ?? dto.refNo);
  const title =
    cleanText(dto.title ?? dto.workDescription) ??
    (cleanText(dto.refNo) ? `Tender ${cleanText(dto.refNo)}` : null);
  if (!sourceId) problems.push('missing tender id');
  if (!title) problems.push('missing title');

  const deadline = toCpppDate(dto.closingDate);
  const emd = toMoney(dto.emdAmount);
  const documents = (Array.isArray(dto.documents) ? dto.documents : [])
    .map((d) => ({
      name: cleanText(d.name) ?? 'Tender document',
      type: cleanText(d.type) ?? 'Tender Document',
      externalId: cleanText(d.externalId),
      url: /^https?:\/\//i.test(d.url ?? '') ? d.url : null,
    }))
    .filter((d) => d.url);

  const city = cleanText(dto.location);

  return {
    problems,
    record: {
      sourceId,
      sourceUrl: /^https?:\/\//i.test(dto.detailUrl ?? '') ? dto.detailUrl : null,
      tenderNo: cleanText(dto.refNo ?? dto.tenderId),
      title,
      description: cleanText(dto.workDescription ?? dto.title),
      department: departmentFrom(dto.organisationChain),
      category: cleanText(dto.category),
      state: cleanText(dto.state),
      city: city ? titleCase(city) : null,
      orgType: null,
      tenderType: cleanText(dto.tenderType),
      estimatedValue: toMoney(dto.tenderValue),
      emdAmount: emd,
      emdStatus: emd ? 'present' : 'not_published',
      tenderFee: toFee(dto.tenderFee),
      publishDate: toCpppDate(dto.publishedDate),
      prebidDate: toCpppDate(dto.prebidDate),
      submissionDeadline: deadline,
      openingDate: toCpppDate(dto.openingDate),
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
      checksum: checksumOf(dto),
    },
  };
}
