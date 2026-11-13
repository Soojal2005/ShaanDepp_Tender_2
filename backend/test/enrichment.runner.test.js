import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { runEnrichment } from '../src/services/enrichment/runner.js';
import { SYSTEM, makeContext } from './helpers.js';

/** Insert an Open tender with one document and the given (possibly NULL) money fields. */
async function tenderWithDoc(db, { estimated = null, emd = null, fee = null, docName = 'NIT Document', url = 'http://portal.test/nit.pdf' } = {}) {
  return db.withContext(SYSTEM, async (q) => {
    const row = await q.one(
      `INSERT INTO tenders (provider_id, source_id, title, status, has_documents, estimated_value, emd_amount, tender_fee)
       VALUES ('tenderbook', $1, 'Road work', 'Open', true, $2, $3, $4) RETURNING id`,
      [`S-${Math.random().toString(36).slice(2, 9)}`, estimated, emd, fee]
    );
    if (url) await q.query('INSERT INTO tender_documents (tender_id, name, url) VALUES ($1,$2,$3)', [row.id, docName, url]);
    return row.id;
  });
}

const money = (db, id) => db.withContext(SYSTEM, (q) =>
  q.one('SELECT estimated_value, emd_amount, emd_status, tender_fee FROM tenders WHERE id = $1', [id]));
const ledger = (db, id) => db.withContext(SYSTEM, (q) =>
  q.maybeOne('SELECT status, fields_filled FROM tender_enrichment WHERE tender_id = $1', [id]));

const NIT = 'Estimated Cost of Work : Rs. 1,50,00,000/- Earnest Money Deposit : Rs. 3,00,000/- Cost of Tender Document : Rs. 5,000/-';

// A fake downloader/extractor so no network or real PDF is touched.
const fakeFetch = (checksum = 'sum1') => async () => ({ ok: true, buffer: Buffer.from('x'), checksum, bytes: 1, contentType: 'application/pdf' });
const fakeText = (text, hasText = true) => async () => ({ text, hasText, pages: 1, totalPages: 1 });
const opts = (over = {}) => ({ requestDelayMs: 0, fetchPdf: fakeFetch(), extractText: fakeText(NIT), ...over });

describe('tender PDF enrichment runner', () => {
  let ctx;
  before(async () => { ctx = await makeContext(); });
  after(async () => { await ctx.close(); });

  it('fills all three money fields from a clean NIT and records a filled ledger row', async () => {
    const id = await tenderWithDoc(ctx.db);
    const totals = await runEnrichment(ctx.db, opts());
    assert.ok(totals.filled >= 1);
    const m = await money(ctx.db, id);
    assert.equal(Number(m.estimated_value), 15000000);
    assert.equal(Number(m.emd_amount), 300000);
    assert.equal(m.emd_status, 'present');
    assert.equal(Number(m.tender_fee), 5000);
    const l = await ledger(ctx.db, id);
    assert.equal(l.status, 'filled');
    assert.deepEqual([...l.fields_filled].sort(), ['emdAmount', 'estimatedValue', 'tenderFee']);
  });

  it('never overwrites a value the listing already has', async () => {
    const id = await tenderWithDoc(ctx.db, { estimated: 99999999 });
    await runEnrichment(ctx.db, opts());
    const m = await money(ctx.db, id);
    assert.equal(Number(m.estimated_value), 99999999); // listing value preserved
    assert.equal(Number(m.tender_fee), 5000);          // blank one still filled
  });

  it('sends an out-of-range EMD to review instead of writing it', async () => {
    const id = await tenderWithDoc(ctx.db);
    // EMD 60L on a 1.5Cr value = 40%, well outside the plausible band.
    const text = 'Estimated Cost : Rs. 1,50,00,000 Earnest Money Deposit : Rs. 60,00,000 Cost of Tender Document : Rs. 5,000';
    await runEnrichment(ctx.db, opts({ extractText: fakeText(text) }));
    const m = await money(ctx.db, id);
    assert.equal(m.emd_amount, null);                  // flagged, not written
    assert.equal(Number(m.estimated_value), 15000000); // the good ones still filled
    const l = await ledger(ctx.db, id);
    assert.equal(l.status, 'review');
  });

  it('marks a scanned (no-text) PDF for review and writes nothing', async () => {
    const id = await tenderWithDoc(ctx.db);
    await runEnrichment(ctx.db, opts({ extractText: fakeText('', false) }));
    const m = await money(ctx.db, id);
    assert.equal(m.estimated_value, null);
    assert.equal((await ledger(ctx.db, id)).status, 'no_text');
  });

  it('is idempotent: a filled tender is not reconsidered on the next run', async () => {
    await tenderWithDoc(ctx.db);
    const first = await runEnrichment(ctx.db, opts());
    assert.ok(first.considered >= 1);
    const second = await runEnrichment(ctx.db, opts());
    // Everything filled/review/no_text at the current version is excluded.
    assert.equal(second.considered, 0);
  });
});
