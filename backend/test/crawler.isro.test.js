import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseIsroListing, createIsroClient } from '../src/services/ingestion/sources/isro/isro.js';
import { normalizeCpppTender } from '../src/services/ingestion/sources/cppp/normalize.js';

// A faithful trim of the real eproc.isro.gov.in homepage table (verified 2026-11-21):
// Tender No | Centre Name | Tender Description | Bid Closing (IST) | Bid Opening (IST) | Actions
const HTML = `
<table id="tenders">
  <thead><tr>
    <th>Tender No</th><th>Centre Name</th><th>Tender Description</th>
    <th>Bid Closing Date (IST)</th><th>Bid Opening Date (IST)</th><th>Actions</th>
  </tr></thead>
  <tbody>
    <tr>
      <td>LE202600064601</td><td>LEOS</td>
      <td>Supply of Cryogenic Globe Control Valves</td>
      <td>11-December-2026 17:00</td><td>14-December-2026 10:30</td>
      <td><a class="link" href="/viewDocumentPT?tenderId=LE202600064601">Tender Document</a></td>
    </tr>
    <tr>
      <td>IS202600091001</td><td>ISAC</td>
      <td>Procurement of Spacecraft Test Equipment</td>
      <td>05-December-2026 15:00</td><td>06-December-2026 11:00</td>
      <td><a class="link" href="/viewDocumentPT?tenderId=IS202600091001">Tender Document</a></td>
    </tr>
    <tr><td colspan="6">No records</td></tr>
  </tbody>
</table>`;

const fakeFetch = (body, { ok = true, status = 200 } = {}) =>
  async () => ({ ok, status, text: async () => body });

describe('ISRO eProc listing parsing', () => {
  it('extracts id, centre, title, dates and a per-tender detail url', () => {
    const rows = parseIsroListing(HTML, { baseUrl: 'https://eproc.isro.gov.in' });
    assert.equal(rows.length, 2, 'the two tender rows parse; header and "No records" rows are skipped');
    const [a] = rows;
    assert.equal(a.tenderId, 'LE202600064601');
    assert.equal(a.refNo, 'LE202600064601');
    assert.equal(a.title, 'Supply of Cryogenic Globe Control Valves');
    assert.equal(a.organisationChain, 'ISRO - LEOS');
    assert.equal(a.closingDate, '11-December-2026 17:00');
    assert.equal(a.openingDate, '14-December-2026 10:30');
    assert.equal(a.detailUrl, 'https://eproc.isro.gov.in/homeTenderView?tenderId=LE202600064601');
  });

  it('feeds through the shared normaliser with department, deadline and open status', () => {
    const rows = parseIsroListing(HTML, { baseUrl: 'https://eproc.isro.gov.in' });
    const { record, problems } = normalizeCpppTender(rows[0]);
    assert.deepEqual(problems, []);
    assert.equal(record.sourceId, 'LE202600064601');
    assert.equal(record.title, 'Supply of Cryogenic Globe Control Valves');
    assert.equal(record.department, 'ISRO - LEOS');
    // 17:00 IST -> 11:30 UTC
    assert.equal(record.submissionDeadline.toISOString(), '2026-12-11T11:30:00.000Z');
    assert.equal(record.status, 'Open');
    // ISRO does not publish money fields on its public pages -> stay NULL, never 0.
    assert.equal(record.estimatedValue, null);
    assert.equal(record.emdAmount, null);
    assert.equal(record.emdStatus, 'not_published');
    assert.equal(record.sourceUrl, 'https://eproc.isro.gov.in/homeTenderView?tenderId=LE202600064601');
  });

  it('client returns the listing content via an injected fetch', async () => {
    const client = createIsroClient({ fetchImpl: fakeFetch(HTML) });
    const res = await client.tenders({ page: 0 });
    assert.equal(res.content.length, 2);
    assert.equal(res.totalElements, 2);
    assert.deepEqual(await client.tenders({ page: 1 }), { content: [], totalElements: 0, totalPages: 1, page: 1 });
  });

  it('throws a SourceError when the listing has no parseable rows', async () => {
    const client = createIsroClient({ fetchImpl: fakeFetch('<table><tr><th>Tender No</th></tr></table>') });
    await assert.rejects(() => client.tenders({ page: 0 }), /no parseable tenders/);
  });
});
