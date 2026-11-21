import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCpwdRows } from '../src/services/ingestion/sources/cpwd/cpwd.js';
import { normalizeCpppTender } from '../src/services/ingestion/sources/cppp/normalize.js';

// A faithful trim of the real CPWD #awardedDataTable "All Tenders" rows
// (verified live 2026-11-21): the rupee cells wrap "₹" in a span; CPWD is the
// one portal that publishes Estimated Cost and EMD on the public list.
const HTML = `
<table id="awardedDataTable"><tbody>
  <tr role="row" class="odd">
    <td class="sorting_1">176256</td>
    <td>15/EE(E)/Vadodara/2026-27 - Recall 1</td>
    <td>Repair/ Upgradation of fire safety installed at CGST Bhavan, Vadodara.</td>
    <td>Project Region Mumbai - SE - VADODRA - EE(E)- Vadodra</td>
    <td><span class="customRupeeTextfield"> ₹</span>18,17,411</td>
    <td><span class="customRupeeTextfield"> ₹</span>36,348</td>
    <td>28/11/2026 15:00</td>
    <td>28/11/2026 15:30</td>
    <td>New Tenders</td>
    <td><a href="#" class="a_viewBtn">View</a></td>
  </tr>
  <tr role="row" class="even">
    <td class="sorting_1">176240</td>
    <td>NIT-9/2026-27</td>
    <td>Civil maintenance works</td>
    <td>CE Delhi - EE Civil-II</td>
    <td></td>
    <td></td>
    <td>30/11/2026 15:00</td>
    <td>30/11/2026 15:30</td>
    <td>New Tenders</td>
    <td><a href="#" class="a_viewBtn">View</a></td>
  </tr>
  <tr><td colspan="10" class="dataTables_empty">No data available</td></tr>
</tbody></table>`;

describe('CPWD All-Tenders row parsing', () => {
  it('extracts id, NIT no, work, office, estimated value, EMD and dates', () => {
    const rows = parseCpwdRows(HTML, { baseUrl: 'https://etender.cpwd.gov.in' });
    assert.equal(rows.length, 2, 'the two tenders parse; the empty row is skipped');
    const [a] = rows;
    assert.equal(a.tenderId, '176256');
    assert.equal(a.refNo, '15/EE(E)/Vadodara/2026-27 - Recall 1');
    assert.match(a.title, /^Repair\/ Upgradation of fire safety/);
    assert.equal(a.organisationChain, 'CPWD - Project Region Mumbai - SE - VADODRA - EE(E)- Vadodra');
    assert.equal(a.tenderValue, '₹18,17,411');
    assert.equal(a.emdAmount, '₹36,348');
    assert.equal(a.closingDate, '28/11/2026 15:00');
    assert.equal(a.detailUrl, 'https://etender.cpwd.gov.in/tenderAwardedDetails.html');
  });

  it('feeds through the shared normaliser with value, EMD and deadline populated', () => {
    const [a] = parseCpwdRows(HTML, { baseUrl: 'https://etender.cpwd.gov.in' });
    const { record, problems } = normalizeCpppTender(a);
    assert.deepEqual(problems, []);
    assert.equal(record.sourceId, '176256');
    assert.equal(record.estimatedValue, 1_817_411); // "₹18,17,411" (Indian grouping)
    assert.equal(record.emdAmount, 36_348);
    assert.equal(record.emdStatus, 'present');
    assert.equal(record.department, 'CPWD - Project Region Mumbai - SE - VADODRA - EE(E)- Vadodra');
    // 28/11/2026 15:00 IST -> 09:30 UTC
    assert.equal(record.submissionDeadline.toISOString(), '2026-11-28T09:30:00.000Z');
    assert.equal(record.status, 'Open');
  });

  it('keeps a tender with no published cost/EMD as NULL, never zero', () => {
    const rows = parseCpwdRows(HTML, { baseUrl: 'https://etender.cpwd.gov.in' });
    const { record } = normalizeCpppTender(rows[1]);
    assert.equal(record.sourceId, '176240');
    assert.equal(record.estimatedValue, null);
    assert.equal(record.emdAmount, null);
    assert.equal(record.emdStatus, 'not_published');
  });
});
