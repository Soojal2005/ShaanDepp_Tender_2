import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseNprocureRow } from '../src/services/ingestion/sources/nprocure/nprocure.js';
import { normalizeCpppTender } from '../src/services/ingestion/sources/cppp/normalize.js';

// A real row from POST /beforeLoginTenderTableList (shape { "1","2","3" }).
const ROW = {
  '1': 'NIT-25 of 2026-27',
  '2': `<html><body><span style="color:#f44336;">R&B-Kheda R&B Division Nadiad<form action='/view-nit-home' method='POST'><input type='hidden' name='_csrf' value='token'><input type='hidden' name='tenderid' id='tenderid_361219' value='361219'/><a href='#' class='edit1'>Tender Id :361219</a></form></span><span style="color:#FF9933;"><form action='/view-nit-home' method='POST'><input type='hidden' name='tenderid' value='361219'/><a href='#'><strong>Name Of Work :</strong>Repairing & Renovation of Existing Godown at Matar (Taluka Matar) District Kheda</a></form></span><p style="color:#FF9933;"> Estimated Contract Value : 11619514.78</p><p style="color:#000000;"> Last Date & Time For Submission : 16-11-2026 18:00:00</p></body></html>`,
  '3': "<form action='/view-nit-document'><a href='#'>Total No:7 </a></form>",
};

describe('nProcure (Gujarat) row parsing', () => {
  it('extracts id, notice no, department, title, value and deadline', () => {
    const dto = parseNprocureRow(ROW);
    assert.equal(dto.tenderId, '361219');
    assert.equal(dto.refNo, 'NIT-25 of 2026-27');
    assert.equal(dto.organisationChain, 'R&B-Kheda R&B Division Nadiad');
    assert.equal(dto.title, 'Repairing & Renovation of Existing Godown at Matar (Taluka Matar) District Kheda');
    assert.equal(dto.tenderValue, '11619514.78');
    assert.equal(dto.closingDate, '16-11-2026 18:00:00');
    assert.equal(dto.state, 'Gujarat');
  });

  it('feeds through the shared normaliser with value and deadline populated', () => {
    const { record, problems } = normalizeCpppTender(parseNprocureRow(ROW));
    assert.deepEqual(problems, []);
    assert.equal(record.sourceId, '361219');
    assert.equal(record.tenderNo, 'NIT-25 of 2026-27');
    assert.equal(record.estimatedValue, 11_619_514.78);
    assert.equal(record.state, 'Gujarat');
    assert.equal(record.submissionDeadline.toISOString(), '2026-11-16T12:30:00.000Z'); // 18:00 IST
    assert.equal(record.status, 'Open');
  });

  it('rejects a row with no tender id', () => {
    assert.ok(parseNprocureRow({ '1': 'X', '2': '<html><body>nothing</body></html>', '3': '' }).tenderId === null);
  });
});
