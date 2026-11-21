import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBpclListing, createBpclClient } from '../src/services/ingestion/sources/bpcl/bpcl.js';
import { normalizeCpppTender } from '../src/services/ingestion/sources/cppp/normalize.js';

// A faithful trim of the real bpcltenders.eproc.in/Product/publicDash page
// (verified 2026-11-21): a live-tenders table (CRFQ / Title / Dept / Due Date)
// plus a "Category" (forthcoming) table that must be ignored. The full title is
// in a hidden <div id="newTendDesc{n}"> inside the title cell.
const HTML = `
<table><tr><td>S.No.</td><td>CRFQ No</td><td>Tender Title [English]</td><td>Department</td><td>Category</td><td>Detail</td></tr>
  <tr class="tblTr2"><td>1.</td><td>9999999999</td><td>SHOULD BE IGNORED (forthcoming, no due date)</td><td>REFINERY</td><td>Works</td><td></td></tr>
</table>
<table>
  <tr><td>S.No.</td><td>CRFQ No</td><td>Tender Title [English]</td><td>Department</td><td>Due Date & Time</td><td>Detail</td></tr>
  <tr class="tblTr2" height="25">
    <td>1.</td>
    <td onmouseover="showTndDesc('newTendDesc','1')">1000468003</td>
    <td onmouseover="showMsg('newTend','1')">CONTRACT FOR COOLING TOWER SUMP CLEANING JOBS IN S...
      <div id="newTendDesc1" style="display:none">CONTRACT FOR COOLING TOWER SUMP CLEANING JOBS IN SRU3 AND MSBP FOR IREP TA 26-27 AT BPCL KOCHI REFINERY</div>
      <div id="newTend1" style="display:none">CONTRACT FOR COOLING TOWER SUMP CLEANING JOBS IN SRU3 AND MSBP FOR IREP TA 26-27 AT BPCL KOCHI REFINERY</div>
    </td>
    <td>REFINERY</td>
    <td>11-12-2026 14:00</td>
    <td></td>
  </tr>
  <tr class="tblTr" height="25">
    <td>2.</td>
    <td onmouseover="showTndDesc('newTendDesc','2')">1000468614</td>
    <td>SUPPLY, FABRICATION...<div id="newTendDesc2" style="display:none">SUPPLY, FABRICATION AND ERECTION OF RAIN PROTECTION COVER TO DCP FIRE EXTINGUISHERS &amp; CIVIL WORKS AT TANK FARM</div></td>
    <td>Kondapalli TOP</td>
    <td>12-12-2026 15:00</td>
    <td></td>
  </tr>
</table>`;

describe('BPCL public-dashboard parsing', () => {
  it('reads only the live-tender table, with CRFQ, full title and department', () => {
    const rows = parseBpclListing(HTML, { baseUrl: 'https://bpcltenders.eproc.in' });
    assert.equal(rows.length, 2, 'the forthcoming/Category table (no Due Date) is ignored');
    const [a] = rows;
    assert.equal(a.tenderId, '1000468003');
    assert.equal(a.refNo, '1000468003');
    assert.equal(a.title, 'CONTRACT FOR COOLING TOWER SUMP CLEANING JOBS IN SRU3 AND MSBP FOR IREP TA 26-27 AT BPCL KOCHI REFINERY');
    assert.ok(!a.title.includes('...'), 'the hidden full title is used, not the truncated visible teaser');
    assert.equal(a.organisationChain, 'Bharat Petroleum (BPCL) - REFINERY');
    assert.equal(a.closingDate, '11-12-2026 14:00');
    assert.equal(a.detailUrl, 'https://bpcltenders.eproc.in/Product/publicDash');
    assert.ok(rows.every((r) => r.tenderId !== '9999999999'), 'the no-due-date row is excluded');
  });

  it('feeds through the shared normaliser with deadline, open status and no made-up money', () => {
    const [a] = parseBpclListing(HTML, { baseUrl: 'https://bpcltenders.eproc.in' });
    const { record, problems } = normalizeCpppTender(a);
    assert.deepEqual(problems, []);
    assert.equal(record.sourceId, '1000468003');
    assert.equal(record.department, 'Bharat Petroleum (BPCL) - REFINERY');
    // 11-12-2026 14:00 IST -> 08:30 UTC
    assert.equal(record.submissionDeadline.toISOString(), '2026-12-11T08:30:00.000Z');
    assert.equal(record.status, 'Open');
    assert.equal(record.estimatedValue, null);
    assert.equal(record.emdStatus, 'not_published');
  });

  it('client returns parsed content and throws a SourceError on an empty dashboard', async () => {
    const client = createBpclClient({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => HTML }) });
    const res = await client.tenders({ page: 0 });
    assert.equal(res.content.length, 2);
    const empty = createBpclClient({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<table><tr><td>CRFQ No</td><td>Due Date</td></tr></table>' }) });
    await assert.rejects(() => empty.tenders({ page: 0 }), /no parseable tenders/);
  });
});
