import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePowergridListing, createPowergridClient } from '../src/services/ingestion/sources/powergrid/powergrid.js';
import { normalizeCpppTender } from '../src/services/ingestion/sources/cppp/normalize.js';

// A faithful trim of the real apps.powergrid.in/pgciltenders/u/view-published-tender.aspx
// table (verified 2026-11-21): # | Location | Ref/Title | Closing/Opening | Published | View | Corrig.
const HTML = `
<table><thead><tr>
  <th># </th><th>Tender Location</th><th>Tender Ref No / Tender Title</th>
  <th>Doc Collection Upto / Tender Opening at</th><th>Published At</th>
  <th>Tender Details</th><th>Corrigendum</th>
</tr></thead><tbody>
  <tr align="center">
    <td>1</td>
    <td width="15%">Angul, Odisha</td>
    <td width="20%"><font color='red'><i>ER2/NT/S-MISC/DOM/EC4/26/15714</i></font> / <br>Rate Contract for Refilling of Argon, Hydrogen &amp; Zero Air gasses [Spec.no: ODP/BB/C&amp;M-4759/GeM-121/26-27]</td>
    <td data-order="2026-12-11 04:00:00">Fri, 11-Dec-2026 04:00 PM / <br><font color='red'>Sat, 12-Dec-2026 04:00 PM</font></td>
    <td data-order="2026-11-20 07:12:00">Fri, 20-Nov-2026 07:12 PM</td>
    <td><a href="view-published-tender-details.aspx?tid=40a25391-0092-4d70-9d9b-fa727160068a">View</a></td>
    <td></td>
  </tr>
  <tr align="center">
    <td>2</td>
    <td width="15%">Shahjahanpur</td>
    <td width="20%"><font color='red'><i>ER2/NT/S-MAN/DOM/EC4/26/15712</i></font> / <br>Engagement of Un-skilled Manpower for Material Handling</td>
    <td data-order="2026-12-05 04:00:00">Fri, 05-Dec-2026 04:00 PM / <br><font color='red'>Mon, 08-Dec-2026 04:00 PM</font></td>
    <td data-order="2026-11-20 07:08:00">Fri, 20-Nov-2026 07:08 PM</td>
    <td><a href="view-published-tender-details.aspx?tid=aaaa1111-0092-4d70-9d9b-fa727160aaaa">View</a></td>
    <td></td>
  </tr>
  <tr><td colspan="7">No records</td></tr>
</tbody></table>`;

describe('POWERGRID published-tenders parsing', () => {
  it('extracts tid, ref, title, location, dates and an absolute detail url', () => {
    const rows = parsePowergridListing(HTML, { baseUrl: 'https://apps.powergrid.in' });
    assert.equal(rows.length, 2);
    const [a] = rows;
    assert.equal(a.tenderId, '40a25391-0092-4d70-9d9b-fa727160068a'); // stable GUID
    assert.equal(a.refNo, 'ER2/NT/S-MISC/DOM/EC4/26/15714');
    assert.match(a.title, /^Rate Contract for Refilling of Argon/);
    assert.ok(!a.title.includes('ER2/NT/S-MISC'), 'the ref number is stripped out of the title');
    assert.equal(a.location, 'Angul, Odisha');
    assert.equal(a.closingDate, 'Fri, 11-Dec-2026 04:00 PM');
    assert.equal(a.openingDate, 'Sat, 12-Dec-2026 04:00 PM');
    assert.equal(a.publishedDate, 'Fri, 20-Nov-2026 07:12 PM');
    assert.equal(a.detailUrl, 'https://apps.powergrid.in/pgciltenders/u/view-published-tender-details.aspx?tid=40a25391-0092-4d70-9d9b-fa727160068a');
  });

  it('feeds through the shared normaliser with deadline, open status and no made-up money', () => {
    const [a] = parsePowergridListing(HTML, { baseUrl: 'https://apps.powergrid.in' });
    const { record, problems } = normalizeCpppTender(a);
    assert.deepEqual(problems, []);
    assert.equal(record.sourceId, '40a25391-0092-4d70-9d9b-fa727160068a');
    assert.equal(record.tenderNo, 'ER2/NT/S-MISC/DOM/EC4/26/15714');
    assert.equal(record.department, 'Power Grid Corporation of India (POWERGRID)');
    // 11-Dec-2026 04:00 PM IST -> 10:30 UTC
    assert.equal(record.submissionDeadline.toISOString(), '2026-12-11T10:30:00.000Z');
    assert.equal(record.status, 'Open');
    assert.equal(record.estimatedValue, null);
    assert.equal(record.emdStatus, 'not_published');
  });

  it('client requests the chosen window and returns parsed content', async () => {
    let called = '';
    const fetchImpl = async (url) => { called = url; return { ok: true, status: 200, text: async () => HTML }; };
    const client = createPowergridClient({ fetchImpl, dt: 'onemonth' });
    const res = await client.tenders({ page: 0 });
    assert.match(called, /\/pgciltenders\/u\/view-published-tender\.aspx\?dt=onemonth$/);
    assert.equal(res.content.length, 2);
    assert.deepEqual(await client.tenders({ page: 1 }), { content: [], totalElements: 0, totalPages: 1, page: 1 });
  });

  it('throws a SourceError when the table has no parseable rows', async () => {
    const client = createPowergridClient({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<table><tbody></tbody></table>' }) });
    await assert.rejects(() => client.tenders({ page: 0 }), /no parseable rows/);
  });
});
