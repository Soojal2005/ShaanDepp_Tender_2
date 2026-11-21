import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseHpclListing, createHpclClient } from '../src/services/ingestion/sources/hpcl/hpcl.js';
import { normalizeCpppTender } from '../src/services/ingestion/sources/cppp/normalize.js';

// A faithful trim of the real etender.hpcl.co.in "Public Tenders" table
// (verified 2026-11-21). The shownit() function definition in <script> must be
// ignored; only the anchor onclick calls are tenders.
const HTML = `
<script>function shownit(tenderNum, tenderNit, divId){ /* popup */ }</script>
<table><tr><td>Tender No</td><td>Tender Title</td><td>Due Date</td></tr>
  <tr>
    <td>
      <a href="#" onclick="javascript:shownit('2600028101-HD-07350','WATERPROOFING JOB IN SUBSTATION BUILDING AT MPSPL.\\r\\n\\r\\nScope includes supply and application of membrane.','modalak');">2600028101-HD-07350</a>
      <input type="hidden" name="2600028101-HD-07350" value="" id="VendorLoginInput_2600028101_HD_07350"/>
    </td>
    <td> WATERPROOFING JOB IN SUBSTATION BUILDING </td>
    <td>05-Dec-2026 15:00</td>
  </tr>
  <tr>
    <td><a href="#" onclick="javascript:shownit('2600028059-HD-09472','HVAC SYSTEM ON LSTK BASIS AT HOSPITAL','modalak');">2600028059-HD-09472</a></td>
    <td> HVAC SYSTEM ON LSTK BASIS AT HOSPITAL </td>
    <td>08-Dec-2026 14:00</td>
  </tr>
</table>`;

describe('HPCL public-tenders parsing', () => {
  it('extracts ref, title, due date and the full NIT description from onclick', () => {
    const rows = parseHpclListing(HTML, { baseUrl: 'https://etender.hpcl.co.in' });
    assert.equal(rows.length, 2, 'two tenders parse; the shownit() function definition is ignored');
    const [a] = rows;
    assert.equal(a.tenderId, '2600028101-HD-07350');
    assert.equal(a.refNo, '2600028101-HD-07350');
    assert.equal(a.title, 'WATERPROOFING JOB IN SUBSTATION BUILDING');
    assert.equal(a.closingDate, '05-Dec-2026 15:00');
    assert.match(a.workDescription, /^WATERPROOFING JOB IN SUBSTATION BUILDING AT MPSPL/);
    assert.ok(!a.workDescription.includes('\\r'), 'literal \\r\\n escapes are stripped from the description');
    assert.ok(a.workDescription.length > a.title.length, 'the long NIT description is kept, not just the short title');
  });

  it('feeds through the shared normaliser with deadline, open status and no made-up money', () => {
    const [a] = parseHpclListing(HTML, { baseUrl: 'https://etender.hpcl.co.in' });
    const { record, problems } = normalizeCpppTender(a);
    assert.deepEqual(problems, []);
    assert.equal(record.sourceId, '2600028101-HD-07350');
    assert.equal(record.department, 'Hindustan Petroleum Corporation Limited (HPCL)');
    // 05-Dec-2026 15:00 IST -> 09:30 UTC
    assert.equal(record.submissionDeadline.toISOString(), '2026-12-05T09:30:00.000Z');
    assert.equal(record.status, 'Open');
    assert.equal(record.estimatedValue, null);
    assert.equal(record.emdStatus, 'not_published');
    assert.equal(record.sourceUrl, 'https://etender.hpcl.co.in/');
  });

  it('client returns parsed content and throws a SourceError on an empty list', async () => {
    const client = createHpclClient({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => HTML }) });
    const res = await client.tenders({ page: 0 });
    assert.equal(res.content.length, 2);
    const empty = createHpclClient({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<table></table>' }) });
    await assert.rejects(() => empty.tenders({ page: 0 }), /no parseable rows/);
  });
});
