/**
 * Excel bulk upload: the permanent fallback for tenders and results the API
 * does not carry. Every row is checked on its own; good rows are stored and bad
 * rows come back with the row number and what is wrong, so the sheet can be
 * fixed and re-uploaded (re-uploading is safe: rows are matched by id).
 */
import ExcelJS from 'exceljs';
import { badRequest } from '../../errors.js';
import { loadMasterIndex } from './masters.js';
import { checksumOf, cleanText, toDate, toFee, toMoney } from './normalize.js';
import { upsertAward, upsertTender } from './store.js';

const SYSTEM = { scope: 'system' };
export const MAX_ROWS = 5000;

const COLUMNS = {
  tenders: [
    { key: 'sourceId', header: 'Tender ID', required: true, example: 'MPE-2026-0457' },
    { key: 'tenderNo', header: 'Tender number', example: 'PWD/BPL/2026/118' },
    { key: 'title', header: 'Title', required: true, example: 'Construction of 100-bed hospital block' },
    { key: 'description', header: 'Description', example: 'Civil, electrical and MEP works' },
    { key: 'department', header: 'Department', example: 'Public Works Department' },
    { key: 'category', header: 'Category', example: 'Civil Works & Infrastructure' },
    { key: 'state', header: 'State', example: 'Madhya Pradesh' },
    { key: 'city', header: 'City', example: 'Bhopal' },
    { key: 'tenderType', header: 'Tender type', example: 'Works' },
    { key: 'estimatedValue', header: 'Estimated value (INR)', type: 'money', example: 48500000 },
    { key: 'emdAmount', header: 'EMD (INR)', type: 'money', example: 970000 },
    { key: 'tenderFee', header: 'Tender fee (INR)', type: 'fee', example: 5000 },
    { key: 'publishDate', header: 'Publish date', type: 'date', example: '21/10/2026' },
    { key: 'submissionDeadline', header: 'Submission deadline', type: 'date', required: true, example: '20/11/2026' },
    { key: 'openingDate', header: 'Opening date', type: 'date', example: '21/11/2026' },
    { key: 'sourceUrl', header: 'Source link', type: 'url', example: 'https://mptenders.gov.in/' },
    { key: 'boqText', header: 'BOQ items (separate with ;)', example: 'RCC M30; Steel Fe500; Bitumen VG-30' },
  ],
  results: [
    { key: 'sourceId', header: 'Result ID', required: true, example: 'RES-2026-0099' },
    { key: 'tenderRef', header: 'Tender number', example: 'PWD/BPL/2026/118' },
    { key: 'title', header: 'Tender title', required: true, example: 'Construction of 100-bed hospital block' },
    { key: 'department', header: 'Department', example: 'Public Works Department' },
    { key: 'category', header: 'Category', example: 'Civil Works & Infrastructure' },
    { key: 'state', header: 'State', example: 'Madhya Pradesh' },
    { key: 'city', header: 'City', example: 'Bhopal' },
    { key: 'estimatedValue', header: 'Estimated value (INR)', type: 'money', example: 48500000 },
    { key: 'awardedValue', header: 'Award value (INR)', type: 'money', example: 44200000 },
    { key: 'winnerName', header: 'L1 bidder', example: 'Apex Infra Pvt Ltd' },
    { key: 'l1Amount', header: 'L1 amount (INR)', type: 'money', example: 44200000 },
    { key: 'l2BidderName', header: 'L2 bidder', example: 'Gupta Constructions Ltd' },
    { key: 'l2Amount', header: 'L2 amount (INR)', type: 'money', example: 45100000 },
    { key: 'bidderCount', header: 'Bidders', type: 'count', example: 6 },
    { key: 'qualifiedCount', header: 'Technically qualified', type: 'count', example: 4 },
    { key: 'awardDate', header: 'Award date', type: 'date', example: '15/12/2026' },
    { key: 'workOrderRef', header: 'Work order reference', example: 'WO/2026/778' },
    { key: 'itemName', header: 'Item', example: 'Building work' },
    { key: 'unit', header: 'Unit', example: 'sq.m' },
    { key: 'unitRate', header: 'Rate per unit (INR)', type: 'money', example: 28500 },
  ],
};
export const excelKinds = Object.keys(COLUMNS);

const EMPTY_MARKERS = new Set(['', '-', '--', 'na', 'n/a', 'nil', 'not published', 'not disclosed', 'none']);
const norm = (s) => String(s ?? '').toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();

function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return v.text;
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('hyperlink' in v) return v.hyperlink;
    return null;
  }
  return v;
}

/** DD/MM/YYYY and DD-MM-YYYY (Indian order), ISO dates, and real Excel dates. */
function parseDate(value) {
  if (value instanceof Date) return toDate(value);
  const text = String(value).trim();
  const m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    // Reject impossible dates (31/31/2026, 30/02/2026) instead of letting them roll over.
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return toDate(date);
  }
  return toDate(text);
}

function readRow(columns, rawRow) {
  const values = {};
  const problems = [];
  for (const col of columns) {
    const raw = cellValue(rawRow[col.key]);
    const blank = raw === null || EMPTY_MARKERS.has(norm(raw));
    if (blank) {
      if (col.required) problems.push(`${col.header} is required`);
      values[col.key] = null;
      continue;
    }
    switch (col.type) {
      case 'money': values[col.key] = toMoney(raw); if (values[col.key] === null) problems.push(`${col.header} "${raw}" is not a valid amount`); break;
      case 'fee': values[col.key] = toFee(raw); if (values[col.key] === null) problems.push(`${col.header} "${raw}" is not a valid amount`); break;
      case 'count': { const n = Number(raw); if (Number.isInteger(n) && n >= 0) values[col.key] = n; else { values[col.key] = null; problems.push(`${col.header} "${raw}" is not a whole number`); } break; }
      case 'date': values[col.key] = parseDate(raw); if (!values[col.key]) problems.push(`${col.header} "${raw}" is not a valid date (use DD/MM/YYYY)`); break;
      case 'url': values[col.key] = /^https?:\/\//i.test(String(raw)) ? String(raw).trim() : null; if (!values[col.key]) problems.push(`${col.header} must start with http:// or https://`); break;
      default: values[col.key] = cleanText(raw);
    }
  }
  return { values, problems };
}

export async function parseWorkbook(buffer, kind) {
  const columns = COLUMNS[kind];
  if (!columns) throw badRequest(`Unknown upload type "${kind}"`);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw badRequest('That file could not be read. Upload an .xlsx workbook (not .xls or .csv).');
  }
  const sheet = workbook.getWorksheet('Data') ?? workbook.worksheets[0];
  if (!sheet) throw badRequest('The workbook has no sheets');

  const headerRow = sheet.getRow(1);
  const byHeader = new Map();
  headerRow.eachCell((cell, col) => byHeader.set(norm(cellValue(cell.value)), col));
  const missing = columns.filter((c) => c.required && !byHeader.has(norm(c.header))).map((c) => c.header);
  if (missing.length) throw badRequest(`Missing required column(s): ${missing.join(', ')}. Download the template and keep its headings.`);
  if (sheet.actualRowCount - 1 > MAX_ROWS) throw badRequest(`Too many rows (maximum ${MAX_ROWS} per upload)`);

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const raw = {};
    for (const col of columns) {
      const index = byHeader.get(norm(col.header));
      raw[col.key] = index ? row.getCell(index).value : null;
    }
    if (Object.values(raw).every((v) => cellValue(v) === null)) return;
    rows.push({ rowNumber, ...readRow(columns, raw) });
  });
  return rows;
}

function toRecord(kind, values) {
  if (kind === 'tenders') {
    const items = values.boqText ? values.boqText.split(/[;\n]/).map((s) => s.trim()).filter(Boolean) : [];
    return {
      sourceId: values.sourceId, sourceUrl: values.sourceUrl, tenderNo: values.tenderNo, title: values.title,
      description: values.description, department: values.department, category: values.category,
      state: values.state, city: values.city, orgType: null, tenderType: values.tenderType,
      estimatedValue: values.estimatedValue, emdAmount: values.emdAmount,
      emdStatus: values.emdAmount ? 'present' : 'not_published', tenderFee: values.tenderFee,
      publishDate: values.publishDate, prebidDate: null, submissionDeadline: values.submissionDeadline,
      openingDate: values.openingDate,
      status: values.submissionDeadline && values.submissionDeadline.getTime() < Date.now() ? 'Closed' : 'Open',
      hasBoq: items.length > 0, hasDocuments: false, eligibilitySummary: null, paymentTerms: null,
      deliveryTerms: null, penaltyTerms: null,
      boqItems: items.map((name) => ({ name })), boqText: items.join(' ') || null, documents: [],
      checksum: checksumOf(values),
    };
  }
  return {
    sourceId: values.sourceId, tenderRef: values.tenderRef, sourceTenderRef: null, title: values.title,
    department: values.department, category: values.category, state: values.state, city: values.city,
    estimatedValue: values.estimatedValue, awardedValue: values.awardedValue, winnerName: values.winnerName,
    l1Amount: values.l1Amount, l2BidderName: values.l2BidderName, l2Amount: values.l2Amount,
    rateStatus: values.l1Amount ? 'present' : 'not_published', itemName: values.itemName, unit: values.unit,
    unitRate: values.unitRate, bidderCount: values.bidderCount, qualifiedCount: values.qualifiedCount,
    awardDate: values.awardDate, workOrderRef: values.workOrderRef, sourcePortal: 'Excel upload',
    bidders: [
      ...(values.winnerName ? [{ name: values.winnerName, amount: values.l1Amount, rank: 1, technicallyQualified: true, isL1: true }] : []),
      ...(values.l2BidderName ? [{ name: values.l2BidderName, amount: values.l2Amount, rank: 2, technicallyQualified: true, isL1: false }] : []),
    ],
    checksum: checksumOf(values),
  };
}

/**
 * @returns {Promise<{total:number, valid:number, inserted:number, updated:number, skipped:number,
 *   errors:{row:number, messages:string[]}[], dryRun:boolean}>}
 */
export async function importWorkbook(db, { buffer, kind, dryRun = false }) {
  const rows = await parseWorkbook(buffer, kind);
  const result = { total: rows.length, valid: 0, inserted: 0, updated: 0, skipped: 0, errors: [], dryRun };

  const seen = new Set();
  const good = [];
  for (const row of rows) {
    const problems = [...row.problems];
    const id = row.values.sourceId;
    if (id && seen.has(id)) problems.push(`Duplicate ID "${id}" in this file`);
    if (id) seen.add(id);
    if (problems.length) result.errors.push({ row: row.rowNumber, messages: problems });
    else good.push(row);
  }
  result.valid = good.length;
  if (dryRun || good.length === 0) return result;

  const runId = await db.withContext(SYSTEM, async (q) =>
    (await q.one(
      `INSERT INTO ingestion_runs (provider_id, kind, trigger, params) VALUES ('excel', $1, 'excel', $2::jsonb) RETURNING id`,
      [kind, JSON.stringify({ rows: rows.length })]
    )).id
  );

  const store = kind === 'tenders' ? upsertTender : upsertAward;
  await db.withContext(SYSTEM, async (q) => {
    const index = await loadMasterIndex(q);
    for (const row of good) {
      try {
        const outcome = await q.savepoint((tx) => store(tx, 'excel', toRecord(kind, row.values), index, row.values));
        result[outcome]++;
      } catch (err) {
        result.valid--;
        result.errors.push({ row: row.rowNumber, messages: [`Could not be saved: ${err.message}`] });
      }
    }
  });

  await db.withContext(SYSTEM, (q) =>
    q.query(
      `UPDATE ingestion_runs SET status = $2, fetched = $3, inserted = $4, updated = $5, skipped = $6, errors = $7, finished_at = now()
        WHERE id = $1`,
      [runId, result.errors.length ? 'warning' : 'success', result.total, result.inserted, result.updated, result.skipped, result.errors.length]
    )
  );
  return result;
}

/** A workbook with only the headings on "Data", plus an example and notes on separate sheets. */
export async function buildTemplate(kind) {
  const columns = COLUMNS[kind];
  if (!columns) throw badRequest(`Unknown upload type "${kind}"`);
  const wb = new ExcelJS.Workbook();

  const data = wb.addWorksheet('Data');
  data.columns = columns.map((c) => ({ header: c.header + (c.required ? ' *' : ''), key: c.key, width: Math.max(18, c.header.length + 6) }));
  data.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  data.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2545' } };
  data.views = [{ state: 'frozen', ySplit: 1 }];
  columns.filter((c) => c.type === 'date').forEach((c) => { data.getColumn(c.key).numFmt = 'dd/mm/yyyy'; });

  const example = wb.addWorksheet('Example');
  example.columns = data.columns.map((c) => ({ ...c }));
  example.addRow(Object.fromEntries(columns.map((c) => [c.key, c.example])));
  example.getRow(1).font = { bold: true };

  const notes = wb.addWorksheet('Read me');
  [
    kind === 'tenders' ? 'Tender upload' : 'Tender result upload',
    '',
    'Put one record per row on the "Data" sheet. Columns marked * are required.',
    'Dates: DD/MM/YYYY. Amounts: plain numbers in rupees (no commas needed).',
    'Leave a cell empty (or write NA) when the source did not publish the figure. Never type 0 for "unknown".',
    'Department, category, state and city are matched to the master lists; unrecognised names are queued for review.',
    'Uploading the same ID again updates that record instead of creating a duplicate.',
    `Maximum ${MAX_ROWS} rows per upload.`,
  ].forEach((line) => notes.addRow([line]));
  notes.getColumn(1).width = 110;
  notes.getRow(1).font = { bold: true, size: 14 };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
