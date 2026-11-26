import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalBaseUrl } from '../src/config.js';
import { portalTenderId } from '../src/services/ingestion/sources/cppp/portals.js';
import { isPdfDocument, listView } from '../src/services/tenderSearch.js';
import { renderDigestEmail } from '../src/services/alerts/email.js';

describe('emailed links use a host that resolves', () => {
  it('pins the bare procure-brain.in domain (no DNS record) to www', () => {
    assert.equal(canonicalBaseUrl('https://procure-brain.in'), 'https://www.procure-brain.in');
    assert.equal(canonicalBaseUrl('https://procure-brain.in/'), 'https://www.procure-brain.in');
    assert.equal(canonicalBaseUrl('http://procure-brain.in'), 'https://www.procure-brain.in');
    assert.equal(canonicalBaseUrl('https://PROCURE-BRAIN.IN'), 'https://www.procure-brain.in');
  });

  it('leaves every other address alone', () => {
    assert.equal(canonicalBaseUrl('https://www.procure-brain.in'), 'https://www.procure-brain.in');
    assert.equal(canonicalBaseUrl('https://shaandepp.synquic.tech'), 'https://shaandepp.synquic.tech');
    assert.equal(canonicalBaseUrl('http://localhost:5173'), 'http://localhost:5173');
    assert.equal(canonicalBaseUrl('https://procure-brain.in.example.com'), 'https://procure-brain.in.example.com');
  });
});

describe("the portal's own tender / bid ID", () => {
  it('is shown for crawled portals whose ID differs from the reference number', () => {
    // Values from the real-HTML crawler fixtures.
    assert.equal(portalTenderId('cppp', '2026_IITK_931268_1', '60/Civil/D1/2026-27'), '2026_IITK_931268_1');
    assert.equal(portalTenderId('mp', '2026_PWD_123456_1', 'PWD/BHOPAL/2026/42'), '2026_PWD_123456_1');
    assert.equal(portalTenderId('bihar', '45892', 'RCD/PATN/2026-27/015'), '45892');
    assert.equal(portalTenderId('gujarat', '361219', 'NIT-25 of 2026-27'), '361219');
    assert.equal(portalTenderId('telangana', '1005553', 'IFB/WR/2026-27/045'), '1005553');
    assert.equal(portalTenderId('cpwd', '176256', '15/EE(E)/Vadodara/2026-27 - Recall 1'), '176256');
  });

  it('is not repeated when it already is the reference number', () => {
    assert.equal(portalTenderId('gem', 'GEM/2026/B/8153983', 'GEM/2026/B/8153983'), null);
    assert.equal(portalTenderId('isro', 'LE202600064601', 'LE202600064601'), null);
    assert.equal(portalTenderId('hpcl', '2600028101-HD-07350', '2600028101-hd-07350'), null, 'case-insensitive');
  });

  it('hides internal keys and non-portal sources', () => {
    assert.equal(portalTenderId('powergrid', '40a25391-0092-4d70-9d9b-fa727160068a', 'ER2/NT/S-MISC/DOM/EC4/26/15714'), null, 'GUID');
    assert.equal(portalTenderId('tenderbook', 'TB-99812', 'NIT/12/2026'), null, 'vendor feed id');
    assert.equal(portalTenderId('excel', 'ROW-7', 'NIT/7'), null);
    assert.equal(portalTenderId('cppp', '', 'X'), null);
    assert.equal(portalTenderId('cppp', null, 'X'), null);
  });

  it('reaches the API next to the tender number', () => {
    const view = listView({ id: 7, provider_id: 'mp', source_id: '2026_PWD_123456_1', tender_no: 'PWD/BHOPAL/2026/42', title: 'Road', status: 'Open' });
    assert.equal(view.tenderNo, 'PWD/BHOPAL/2026/42');
    assert.equal(view.tenderId, '2026_PWD_123456_1');
    assert.match(view.portalUrl, /^https:\/\/mptenders\.gov\.in\//);
  });

  it('opens the GeM portal, not the bid PDF, from "Open on source portal"', () => {
    const view = listView({
      id: 8, provider_id: 'gem', source_id: 'GEM/2026/B/8153983', tender_no: 'GEM/2026/B/8153983', title: 'Laptops', status: 'Open',
      source_url: 'https://bidplus.gem.gov.in/showbidDocument/8153983',
    });
    assert.equal(view.portalUrl, 'https://bidplus.gem.gov.in/all-bids');
    assert.equal(view.sourceUrl, 'https://bidplus.gem.gov.in/showbidDocument/8153983', 'PDF still available');
  });

  it('flags PDF documents for the "Download PDF" button', () => {
    assert.equal(isPdfDocument({ name: 'Bid document GEM/2026/B/1', url: 'https://bidplus.gem.gov.in/showbidDocument/1' }, 'gem'), true, 'GeM bid PDF');
    assert.equal(isPdfDocument({ name: 'Bid document GEM/2026/B/1', url: null }, 'gem'), false, 'no URL, nothing to download');
    assert.equal(isPdfDocument({ name: 'Tendernotice_1.pdf', url: null }, 'cppp'), true, 'by file name');
    assert.equal(isPdfDocument({ name: 'NIT', url: 'https://eproc.isro.gov.in/doc/nit.PDF?x=1' }, 'isro'), true, 'by URL');
    assert.equal(isPdfDocument({ name: 'BOQ_123.xls', url: 'https://eproc.isro.gov.in/doc/boq.xls' }, 'isro'), false);
  });

  it('keeps a stored per-tender page link for other portals', () => {
    const view = listView({ id: 9, provider_id: 'isro', source_id: 'LE1', tender_no: 'LE1', title: 'X', status: 'Open', source_url: 'https://eproc.isro.gov.in/t/LE1' });
    assert.equal(view.portalUrl, 'https://eproc.isro.gov.in/t/LE1');
  });

  it('appears in the daily alert email', () => {
    const row = {
      id: 42, provider_id: 'cppp', source_id: '2026_IITK_931268_1', tender_no: '60/Civil/D1/2026-27', title: 'Civil works',
      department: 'IIT Kanpur', state: 'Uttar Pradesh', score: 80, emd_status: 'not_published',
      submission_deadline: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    };
    const { html } = renderDigestEmail({
      profile: { name: 'Civil' }, orgName: 'Acme', baseUrl: 'https://www.procure-brain.in',
      digest: { closing: [], included: [row], notInDigest: 0, cap: 50 },
    });
    assert.ok(html.includes('60/Civil/D1/2026-27'));
    assert.ok(html.includes('ID 2026_IITK_931268_1'));
  });
});
