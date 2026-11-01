import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBiharTender, toBiharDateStr } from '../src/services/ingestion/sources/bihar/bihar.js';
import { normalizeCpppTender } from '../src/services/ingestion/sources/cppp/normalize.js';

// Simulated API response object (shape from AngularJS template bindings).
const RAW_TENDER = {
  currenttenderid: 45892,
  currenttenderrefno: 'RCD/PATN/2026-27/015',
  currentdescription: 'Construction of RCC Bridge over River Gandak at NH-28 Gopalganj',
  orgName: 'Road Construction Department',
  deptName: 'RCD Patna Division',
  currentTenderPublishDate: '28-Oct-2026 10:00 AM',
  currentbidStartDate: '28-Oct-2026 11:00 AM',
  currentbidEndDate: '15-Nov-2026 05:00 PM',
  pacamt: 85000000,
};

describe('Bihar tender parsing', () => {
  it('extracts all fields from the API response', () => {
    const dto = parseBiharTender(RAW_TENDER);
    assert.equal(dto.tenderId, '45892');
    assert.equal(dto.refNo, 'RCD/PATN/2026-27/015');
    assert.equal(dto.title, 'Construction of RCC Bridge over River Gandak at NH-28 Gopalganj');
    assert.equal(dto.organisationChain, 'Road Construction Department');
    assert.equal(dto.closingDate, '15-Nov-2026 05:00 PM');
    assert.equal(dto.tenderValue, '85000000');
    assert.equal(dto.state, 'Bihar');
    assert.equal(dto.publishedDate, '28-Oct-2026 10:00 AM');
  });

  it('falls back to dept name when orgName is absent', () => {
    const dto = parseBiharTender({ ...RAW_TENDER, orgName: null });
    assert.equal(dto.organisationChain, 'RCD Patna Division');
  });

  it('falls back to org ID when both names are absent', () => {
    const dto = parseBiharTender({ ...RAW_TENDER, orgName: null, deptName: null, currentorgid: 'ORG-123' });
    assert.equal(dto.organisationChain, 'ORG-123');
  });

  it('leaves tenderValue null when pacamt is 0', () => {
    const dto = parseBiharTender({ ...RAW_TENDER, pacamt: 0 });
    assert.equal(dto.tenderValue, null);
  });

  it('leaves tenderValue null when pacamt is missing', () => {
    const dto = parseBiharTender({ ...RAW_TENDER, pacamt: undefined });
    assert.equal(dto.tenderValue, null);
  });

  it('handles camelCase field variants', () => {
    const dto = parseBiharTender({
      currentTenderId: 99999,
      currentTenderRefNo: 'ALT/REF/001',
      currentDescription: 'Test with CamelCase',
      currentBidEndDate: '20-Dec-2026 06:00 PM',
      pacamt: 5000000,
    });
    assert.equal(dto.tenderId, '99999');
    assert.equal(dto.refNo, 'ALT/REF/001');
    assert.equal(dto.title, 'Test with CamelCase');
    assert.equal(dto.closingDate, '20-Dec-2026 06:00 PM');
  });

  it('feeds through the shared normaliser with value and deadline', () => {
    const dto = parseBiharTender(RAW_TENDER);
    const { record, problems } = normalizeCpppTender(dto);
    assert.deepEqual(problems, []);
    assert.equal(record.sourceId, '45892');
    assert.equal(record.tenderNo, 'RCD/PATN/2026-27/015');
    assert.equal(record.estimatedValue, 85_000_000);
    assert.equal(record.state, 'Bihar');
    assert.equal(record.department, 'Road Construction Department');
    // 17:00 IST = 11:30 UTC
    assert.equal(record.submissionDeadline.toISOString(), '2026-11-15T11:30:00.000Z');
    assert.equal(record.status, 'Open');
  });

  it('returns null tenderId for missing id', () => {
    const dto = parseBiharTender({ currentdescription: 'No ID tender' });
    assert.equal(dto.tenderId, null);
  });

  it('converts epoch millisecond dates from the API', () => {
    const epochMs = Date.UTC(2026, 10, 15, 11, 30, 0); // 2026-11-15T11:30:00Z = 17:00 IST
    const dto = parseBiharTender({ ...RAW_TENDER, currentbidEndDate: epochMs, currentTenderPublishDate: epochMs });
    assert.equal(dto.closingDate, '15-11-2026 17:00:00');
    assert.equal(dto.publishedDate, '15-11-2026 17:00:00');
  });

  it('epoch dates survive the normaliser round-trip', () => {
    const epochMs = Date.UTC(2026, 10, 15, 11, 30, 0);
    const dto = parseBiharTender({ ...RAW_TENDER, currentbidEndDate: epochMs });
    const { record } = normalizeCpppTender(dto);
    assert.equal(record.submissionDeadline.toISOString(), '2026-11-15T11:30:00.000Z');
    assert.equal(record.status, 'Open');
  });

  it('converts ISO date strings (YYYY-MM-DD HH:mm)', () => {
    assert.equal(toBiharDateStr('2026-11-15 17:00'), '15-11-2026 17:00');
    assert.equal(toBiharDateStr('2026-11-15T17:00:00'), '15-11-2026 17:00:00');
    assert.equal(toBiharDateStr('2026-11-15'), '15-11-2026');
  });

  it('returns null for zero, empty, and null date values', () => {
    assert.equal(toBiharDateStr(0), null);
    assert.equal(toBiharDateStr(''), null);
    assert.equal(toBiharDateStr(null), null);
    assert.equal(toBiharDateStr(undefined), null);
  });
});
