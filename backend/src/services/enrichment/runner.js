/**
 * Back-fill the money fields a listing omits (estimated value, EMD, tender fee)
 * by reading the tender's NIT PDF. For each candidate tender: pick the most
 * notice-like document, download it into memory, pull the text layer, run the
 * deterministic field patterns, sanity-check the numbers, fill only the columns
 * that are still NULL, and record the outcome in `tender_enrichment`. The PDF is
 * never stored — only the few extracted numbers and a checksum survive.
 *
 * Everything that touches the network or a PDF is injectable so the pipeline can
 * be tested end to end without either.
 */
import { config } from '../../config.js';
import { log } from '../../log.js';
import { downloadPdf } from './fetch.js';
import { extractPdfText } from './pdfText.js';
import { extractTenderFields } from './fields.js';
import { assessFields } from './sanity.js';

const SYSTEM = { scope: 'system' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Bump this when the parser/patterns change so already-processed tenders are
// reconsidered on the next run.
export const EXTRACTOR_VERSION = 1;

/** Choose the document most likely to be the tender notice (NIT). */
export function pickDocument(docs) {
  const score = (d) => {
    const s = `${d.name || ''} ${d.doc_type || ''}`.toLowerCase();
    let v = 0;
    if (/\bnit\b|notice|invit/.test(s)) v += 5;
    if (/tender\s*doc|bid\s*doc|e-?tender|dtp|detailed/.test(s)) v += 3;
    if (/corrigend|addend|amend/.test(s)) v -= 3;
    if (/boq|bill of quant|schedule/.test(s)) v -= 1;
    if (/\.pdf(\?|$)/.test((d.url || '').toLowerCase())) v += 1;
    return v;
  };
  return [...docs].filter((d) => d.url).sort((a, b) => score(b) - score(a))[0] || null;
}

const CANDIDATES_SQL = `
  SELECT t.id, t.estimated_value, t.emd_amount, t.tender_fee,
         e.extractor_version AS e_version, e.status AS e_status,
         e.doc_checksum AS e_checksum, e.attempts AS e_attempts
    FROM tenders t
    LEFT JOIN tender_enrichment e ON e.tender_id = t.id
   WHERE t.has_documents = true
     AND t.status = 'Open'
     AND (t.estimated_value IS NULL OR t.emd_amount IS NULL OR t.tender_fee IS NULL)
     AND ($1::text IS NULL OR t.provider_id = $1)
     AND (e.tender_id IS NULL
          OR e.extractor_version < $2
          OR (e.status = 'failed' AND e.attempts < 3))
   ORDER BY t.submission_deadline ASC NULLS LAST
   LIMIT $3`;

/**
 * @param db database from createDatabase()
 * @param opts { providerId, maxDocs, requestDelayMs, extractorVersion, fetchPdf, extractText, extractFields, assess, fetchOpts }
 */
export async function runEnrichment(db, opts = {}) {
  const cfg = config.enrichment;
  const {
    providerId = cfg.providerId || null,
    maxDocs = cfg.maxDocs,
    requestDelayMs = cfg.requestDelayMs,
    extractorVersion = EXTRACTOR_VERSION,
    fetchPdf = downloadPdf,
    extractText = extractPdfText,
    extractFields = extractTenderFields,
    assess = assessFields,
    fetchOpts = { maxBytes: cfg.maxBytes, timeoutMs: cfg.timeoutMs, userAgent: cfg.userAgent },
  } = opts;

  const candidates = await db.withContext(SYSTEM, (q) => q.many(CANDIDATES_SQL, [providerId, extractorVersion, maxDocs]));
  const totals = { considered: candidates.length, downloaded: 0, filled: 0, review: 0, noFields: 0, noText: 0, noDoc: 0, failed: 0, skipped: 0 };

  for (const t of candidates) {
    try {
      const docs = await db.withContext(SYSTEM, (q) =>
        q.many('SELECT name, doc_type, url FROM tender_documents WHERE tender_id = $1 AND url IS NOT NULL', [t.id]));
      const doc = pickDocument(docs);
      if (!doc) { await record(db, t.id, { status: 'no_doc', extractorVersion }); totals.noDoc++; continue; }

      const dl = await fetchPdf(doc.url, fetchOpts);
      if (!dl.ok) { await record(db, t.id, { status: 'failed', docUrl: doc.url, extractorVersion, error: dl.reason }); totals.failed++; continue; }
      totals.downloaded++;

      // Unchanged document already processed at this version — nothing to do.
      if (t.e_checksum === dl.checksum && t.e_version === extractorVersion) { totals.skipped++; continue; }

      const { text, hasText } = await extractText(dl.buffer, { maxPages: cfg.maxPages });
      if (!hasText) {
        await record(db, t.id, { status: 'no_text', docUrl: doc.url, checksum: dl.checksum, extractorVersion });
        totals.noText++;
        continue;
      }

      const extracted = extractFields(text);
      if (extracted.matched === 0) {
        await record(db, t.id, { status: 'no_fields', docUrl: doc.url, checksum: dl.checksum, extractorVersion, extracted });
        totals.noFields++;
        continue;
      }

      const { decisions, issues } = assess(extracted, { knownEstimatedValue: t.estimated_value });
      // Only fill a column that is currently NULL and whose extracted value passed.
      const fill = {
        estimatedValue: t.estimated_value == null && decisions.estimatedValue === 'fill' ? extracted.estimatedValue.rupees : null,
        emdAmount: t.emd_amount == null && decisions.emdAmount === 'fill' ? extracted.emdAmount.rupees : null,
        tenderFee: t.tender_fee == null && decisions.tenderFee === 'fill' ? extracted.tenderFee.rupees : null,
      };
      const fieldsFilled = Object.entries(fill).filter(([, v]) => v != null).map(([k]) => k);
      const status = issues.length ? 'review' : (fieldsFilled.length ? 'filled' : 'no_fields');

      await db.withContext(SYSTEM, async (q) => {
        if (fieldsFilled.length) {
          await q.query(
            `UPDATE tenders SET
               estimated_value = COALESCE(estimated_value, $2),
               emd_amount = COALESCE(emd_amount, $3),
               emd_status = CASE WHEN emd_amount IS NULL AND $3 IS NOT NULL THEN 'present' ELSE emd_status END,
               tender_fee = COALESCE(tender_fee, $4)
             WHERE id = $1`,
            [t.id, fill.estimatedValue, fill.emdAmount, fill.tenderFee]
          );
        }
        await recordTx(q, t.id, { status, docUrl: doc.url, checksum: dl.checksum, extractorVersion, fieldsFilled, extracted: { ...extracted, decisions, issues } });
      });
      if (status === 'review') totals.review++;
      else if (status === 'filled') totals.filled++;
      else totals.noFields++;
    } catch (err) {
      log.warn('tender enrichment error', { tenderId: t.id, error: err.message });
      await record(db, t.id, { status: 'failed', extractorVersion, error: err.message }).catch(() => {});
      totals.failed++;
    }
    if (requestDelayMs) await sleep(requestDelayMs);
  }

  log.info('tender enrichment run', totals);
  return totals;
}

function record(db, tenderId, fields) {
  return db.withContext(SYSTEM, (q) => recordTx(q, tenderId, fields));
}

function recordTx(q, tenderId, { status, docUrl = null, checksum = null, extractorVersion, fieldsFilled = [], extracted = null, error = null }) {
  return q.query(
    `INSERT INTO tender_enrichment (tender_id, status, doc_url, doc_checksum, extractor_version, fields_filled, extracted, attempts, error, processed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,1,$8, now())
     ON CONFLICT (tender_id) DO UPDATE SET
       status = EXCLUDED.status, doc_url = EXCLUDED.doc_url, doc_checksum = EXCLUDED.doc_checksum,
       extractor_version = EXCLUDED.extractor_version, fields_filled = EXCLUDED.fields_filled,
       extracted = EXCLUDED.extracted, attempts = tender_enrichment.attempts + 1,
       error = EXCLUDED.error, processed_at = now()`,
    [tenderId, status, docUrl, checksum, extractorVersion, fieldsFilled, extracted ? JSON.stringify(extracted) : null, error]
  );
}
