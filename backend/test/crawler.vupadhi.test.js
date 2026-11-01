import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseVupadhiTender, parseVupadhiCorrigendum } from '../src/services/ingestion/sources/vupadhi/vupadhi.js';
import { normalizeCpppTender } from '../src/services/ingestion/sources/cppp/normalize.js';

// Simulated HTML block from the AP Vupadhi portal (class "samer").
const AP_BLOCK = `
<div class="samer">
  <span class="coli-id" onclick="viewtender(848803)">1005553</span>
  <span class="coli-date">06/11/2026 10:30 AM</span>
  <span class="coli-tno">IFB/WR/2026-27/045</span>
  <p class="tDesc">Construction of check dam at Kurnool District under MGNREGS</p>
</div>`;

// Simulated HTML block from Telangana (slightly different structure).
const TS_BLOCK = `
<div class="samer">
  <a href="#" onclick="viewtender(677069)">744078</a>
  <span class="coli-date">16/11/2026 05:00 PM</span>
  <span class="coli-tno">ENN26O0017</span>
  <span class="sCircle_Division">Naini-Pur.</span>
  <p class="tDesc">Hiring of Heavy Duty Truck for transportation of coal</p>
</div>`;

// Telangana corrigendum JSON shape.
const CORRIGENDUM = {
  nProcurementID: 677069,
  nTenderID: 744078,
  sTenderNo: 'ENN26O0017',
  sNameOfWork: 'Hiring of Heavy Duty Truck for transportation of coal',
  sCircle_Division: 'Naini-Pur.',
  sMonth: 'November',
  sDate: '16',
  sMins: '05:00 PM',
};

describe('Vupadhi (AP/Telangana) tender parsing', () => {
  it('extracts AP tender fields from HTML block', () => {
    const dto = parseVupadhiTender(AP_BLOCK, 'Andhra Pradesh');
    assert.equal(dto.tenderId, '1005553');
    assert.equal(dto.refNo, 'IFB/WR/2026-27/045');
    assert.equal(dto.title, 'Construction of check dam at Kurnool District under MGNREGS');
    assert.equal(dto.closingDate, '06/11/2026 10:30 AM');
    assert.equal(dto.state, 'Andhra Pradesh');
    assert.equal(dto.tenderValue, null); // Not shown on listing
  });

  it('extracts Telangana tender with department', () => {
    const dto = parseVupadhiTender(TS_BLOCK, 'Telangana');
    assert.equal(dto.tenderId, '744078');
    assert.equal(dto.refNo, 'ENN26O0017');
    assert.equal(dto.organisationChain, 'Naini-Pur.');
    assert.equal(dto.closingDate, '16/11/2026 05:00 PM');
    assert.equal(dto.state, 'Telangana');
  });

  it('extracts procurement ID from viewtender onclick', () => {
    const html = '<div><a onclick="viewtender(12345)">67890</a></div>';
    const dto = parseVupadhiTender(html, 'Test');
    // Display ID is 67890, onclick has 12345 — display ID wins
    assert.equal(dto.tenderId, '67890');
  });

  it('parses Telangana corrigendum JSON', () => {
    const dto = parseVupadhiCorrigendum(CORRIGENDUM, 'Telangana');
    assert.equal(dto.tenderId, '744078');
    assert.equal(dto.refNo, 'ENN26O0017');
    assert.equal(dto.title, 'Hiring of Heavy Duty Truck for transportation of coal');
    assert.equal(dto.organisationChain, 'Naini-Pur.');
    assert.ok(dto.closingDate.includes('16'));
    assert.ok(dto.closingDate.includes('November'));
    assert.equal(dto.state, 'Telangana');
  });

  it('feeds AP tender through normaliser', () => {
    const dto = parseVupadhiTender(AP_BLOCK, 'Andhra Pradesh');
    const { record, problems } = normalizeCpppTender(dto);
    assert.deepEqual(problems, []);
    assert.equal(record.sourceId, '1005553');
    assert.equal(record.tenderNo, 'IFB/WR/2026-27/045');
    assert.equal(record.state, 'Andhra Pradesh');
    assert.equal(record.estimatedValue, null); // Not published on listing
    // 06/11/2026 10:30 AM IST = 05:00 UTC
    assert.equal(record.submissionDeadline.toISOString(), '2026-11-06T05:00:00.000Z');
  });

  it('returns null tenderId for empty block', () => {
    const dto = parseVupadhiTender('<div>nothing here</div>', 'Test');
    assert.equal(dto.tenderId, null);
  });
});
