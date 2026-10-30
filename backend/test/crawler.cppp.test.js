import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { parseDetailPage, parseListPage, createCpppClient } from '../src/services/ingestion/sources/cppp/cppp.js';
import { normalizeCpppTender, toCpppDate } from '../src/services/ingestion/sources/cppp/normalize.js';
import { runIngestion } from '../src/services/ingestion/runner.js';
import { SourceError } from '../src/services/ingestion/tenderbook.js';
import { GEPNIC_PORTALS, enabledPortals, portalClientOptions } from '../src/services/ingestion/sources/cppp/portals.js';
import { seedCrawlerProviders } from '../src/db/seed.js';
import { createJobs } from '../src/jobs/definitions.js';
import { SYSTEM, makeContext } from './helpers.js';

// --- Fixtures: representative CPPP ePublishing HTML -------------------------

const LIST_HTML = `
<html><body>
<table id="activeTenders">
  <tr>
    <th>S.No</th><th>e-Published Date</th><th>Bid Submission Closing Date</th>
    <th>Tender Opening Date</th><th>Title and Ref.No./Tender ID</th><th>Organisation Chain</th>
  </tr>
  <tr>
    <td>1</td>
    <td>20-Oct-2026 05:00 PM</td>
    <td>15-Nov-2026 03:00 PM</td>
    <td>16-Nov-2026 03:30 PM</td>
    <td><a href="/epublish/app?page=FrontEndTenderDetails&amp;id=111">Construction of rural road in Bhopal district</a> [2026_PWD_123456_1]</td>
    <td>Madhya Pradesh Public Works Department||PWD Bhopal</td>
  </tr>
  <tr>
    <td>2</td>
    <td>21-Oct-2026 11:00 AM</td>
    <td>25-Nov-2026 02:00 PM</td>
    <td>26-Nov-2026 11:00 AM</td>
    <td><a href="/epublish/app?page=FrontEndTenderDetails&amp;id=222">Supply of medical equipment</a> [2026_HEALTH_654321_1]</td>
    <td>Ministry of Health and Family Welfare</td>
  </tr>
</table>
</body></html>`;

const DETAIL_HTML = `
<html><body>
<table class="tablebg">
  <tr><td class="td_caption">Organisation Chain</td><td class="td_field">Madhya Pradesh Public Works Department||PWD Bhopal</td></tr>
  <tr><td class="td_caption">Tender Reference Number</td><td class="td_field">PWD/BHOPAL/2026/42</td></tr>
  <tr><td class="td_caption">Tender ID</td><td class="td_field">2026_PWD_123456_1</td></tr>
  <tr><td class="td_caption">Tender Type</td><td class="td_field">Open Tender</td></tr>
  <tr><td class="td_caption">Tender Category</td><td class="td_field">Works</td></tr>
  <tr><td class="td_caption">Work Description</td><td class="td_field">Construction of rural road in Bhopal district with cross drainage.</td></tr>
  <tr><td class="td_caption">Tender Value in &#8377;</td><td class="td_field">1,25,00,000</td></tr>
  <tr><td class="td_caption">EMD Amount in &#8377;</td><td class="td_field">2,50,000</td></tr>
  <tr><td class="td_caption">Bid Opening Date</td><td class="td_field">16-Nov-2026 03:30 PM</td></tr>
  <tr><td class="td_caption">Bid Submission End Date</td><td class="td_field">15-Nov-2026 03:00 PM</td></tr>
</table>
<table class="list_table">
  <tr><th>Tender Documents</th></tr>
  <tr><td><a href="/epublish/app?download=NIT.pdf&amp;type=Download">NIT.pdf</a></td></tr>
</table>
</body></html>`;

describe('CPPP list page parsing', () => {
  it('reads each active-tender row by header, splitting title from tender id', () => {
    const rows = parseListPage(LIST_HTML, 'https://eprocure.gov.in');
    assert.equal(rows.length, 2);
    const [first] = rows;
    assert.equal(first.tenderId, '2026_PWD_123456_1');
    assert.equal(first.title, 'Construction of rural road in Bhopal district');
    assert.equal(first.organisationChain, 'Madhya Pradesh Public Works Department||PWD Bhopal');
    assert.equal(first.closingDate, '15-Nov-2026 03:00 PM');
    assert.equal(first.openingDate, '16-Nov-2026 03:30 PM');
    assert.equal(first.detailUrl, 'https://eprocure.gov.in/epublish/app?page=FrontEndTenderDetails&id=111');
  });

  it('returns nothing for a page without the active-tenders table', () => {
    assert.deepEqual(parseListPage('<html><body><p>maintenance</p></body></html>'), []);
  });
});

// The real GePNIC "Tenders by Closing Date" table: id="table", <td> header cells,
// and a title cell with TWO bracketed tokens [reference no][tender id] plus a
// session-scoped (captcha-gated) DirectLink that must NOT be stored.
const GEPNIC_HTML = `
<html><body>
<table id="table" class="list_table">
  <tr class="list_header">
    <td>S.No</td><td>e-Published Date</td><td>Bid Submission Closing Date</td>
    <td>Tender Opening Date</td><td>Title and Ref.No./Tender ID</td><td>Organisation Chain</td>
  </tr>
  <tr>
    <td>1.</td>
    <td>22-Oct-2026 03:00 PM</td>
    <td>29-Oct-2026 03:30 PM</td>
    <td>30-Oct-2026 03:30 PM</td>
    <td><a href="/eprocure/app?component=%24DirectLink&amp;page=FrontEndListTendersbyDate&amp;service=direct&amp;session=T&amp;sp=SLlEj6abc">[Civil work for academic block]</a> [60/Civil/D1/2026-27] [2026_IITK_931268_1]</td>
    <td>IIT Kanpur||Civil Engineering Department</td>
  </tr>
  <tr>
    <td>2.</td>
    <td>25-Sep-2026 11:30 AM</td>
    <td>29-Oct-2026 03:30 PM</td>
    <td>30-Oct-2026 03:30 PM</td>
    <td><a href="/eprocure/app?component=%24DirectLink&amp;service=direct&amp;session=T&amp;sp=SEnnabc">[Project management consultancy]</a> [IIML/PROJ/4631] [2026_IIML_927626_1]</td>
    <td>IIM Lucknow</td>
  </tr>
</table>
</body></html>`;

describe('GePNIC "Tenders by Closing Date" parsing', () => {
  it('reads id="table", two-bracket title cells, and drops session-scoped links', () => {
    const rows = parseListPage(GEPNIC_HTML, 'https://eprocure.gov.in');
    assert.equal(rows.length, 2);
    const [a, b] = rows;
    assert.equal(a.tenderId, '2026_IITK_931268_1');
    assert.equal(a.refNo, '60/Civil/D1/2026-27');
    assert.equal(a.title, 'Civil work for academic block');
    assert.equal(a.organisationChain, 'IIT Kanpur||Civil Engineering Department');
    assert.equal(a.closingDate, '29-Oct-2026 03:30 PM');
    assert.equal(a.detailUrl, null, 'ephemeral captcha-gated DirectLink is not stored');
    assert.equal(b.tenderId, '2026_IIML_927626_1');
    assert.equal(b.refNo, 'IIML/PROJ/4631');
  });

  it('feeds cleanly through the normaliser', () => {
    const rows = parseListPage(GEPNIC_HTML, 'https://eprocure.gov.in');
    const { record, problems } = normalizeCpppTender(rows[0]);
    assert.deepEqual(problems, []);
    assert.equal(record.sourceId, '2026_IITK_931268_1');
    assert.equal(record.tenderNo, '60/Civil/D1/2026-27');
    assert.equal(record.department, 'IIT Kanpur');
    assert.equal(record.submissionDeadline.toISOString(), '2026-10-29T10:00:00.000Z');
    assert.equal(record.estimatedValue, null, 'value lives behind the captcha, stays empty');
  });
});

describe('CPPP detail page parsing', () => {
  it('reads label/value pairs and download links', () => {
    const d = parseDetailPage(DETAIL_HTML, 'https://eprocure.gov.in');
    assert.equal(d.refNo, 'PWD/BHOPAL/2026/42');
    assert.equal(d.tenderType, 'Open Tender');
    assert.equal(d.category, 'Works');
    assert.equal(d.tenderValue, '1,25,00,000');
    assert.equal(d.emdAmount, '2,50,000');
    assert.equal(d.workDescription, 'Construction of rural road in Bhopal district with cross drainage.');
    assert.equal(d.documents.length, 1);
    assert.equal(d.documents[0].name, 'NIT.pdf');
    assert.equal(d.documents[0].url, 'https://eprocure.gov.in/epublish/app?download=NIT.pdf&type=Download');
  });
});

describe('CPPP date parsing', () => {
  it('reads "DD-MMM-YYYY hh:mm AM/PM" as India time', () => {
    assert.equal(toCpppDate('15-Nov-2026 03:00 PM').toISOString(), '2026-11-15T09:30:00.000Z');
    assert.equal(toCpppDate('01-Jan-2026 12:00 AM').toISOString(), '2025-12-31T18:30:00.000Z');
    assert.equal(toCpppDate('25/11/2026').toISOString(), '2026-11-24T18:30:00.000Z');
    assert.equal(toCpppDate('rubbish'), null);
    assert.equal(toCpppDate(null), null);
  });
});

describe('CPPP normalisation', () => {
  const merged = () => ({
    tenderId: '2026_PWD_123456_1',
    refNo: 'PWD/BHOPAL/2026/42',
    title: 'Construction of rural road in Bhopal district',
    organisationChain: 'Madhya Pradesh Public Works Department||PWD Bhopal',
    category: 'Works',
    tenderType: 'Open Tender',
    workDescription: 'Construction of rural road in Bhopal district with cross drainage.',
    tenderValue: '1,25,00,000',
    emdAmount: '2,50,000',
    publishedDate: '20-Oct-2026 05:00 PM',
    closingDate: '15-Nov-2026 03:00 PM',
    openingDate: '16-Nov-2026 03:30 PM',
    detailUrl: 'https://eprocure.gov.in/epublish/app?page=FrontEndTenderDetails&id=111',
    documents: [{ name: 'NIT.pdf', url: 'https://eprocure.gov.in/epublish/app?download=NIT.pdf' }],
  });

  it('maps a scraped tender onto the shared record shape', () => {
    const { record, problems } = normalizeCpppTender(merged());
    assert.deepEqual(problems, []);
    assert.equal(record.sourceId, '2026_PWD_123456_1');
    assert.equal(record.tenderNo, 'PWD/BHOPAL/2026/42');
    assert.equal(record.department, 'Madhya Pradesh Public Works Department');
    assert.equal(record.estimatedValue, 12_500_000);
    assert.equal(record.emdAmount, 250_000);
    assert.equal(record.emdStatus, 'present');
    assert.equal(record.status, 'Open');
    assert.equal(record.hasDocuments, true);
    assert.equal(record.submissionDeadline.toISOString(), '2026-11-15T09:30:00.000Z');
    assert.ok(record.checksum);
  });

  it('keeps unpublished figures empty instead of inventing zeroes', () => {
    const { record } = normalizeCpppTender({ ...merged(), tenderValue: null, emdAmount: '0', tenderFee: null });
    assert.equal(record.estimatedValue, null);
    assert.equal(record.emdAmount, null);
    assert.equal(record.emdStatus, 'not_published');
    assert.equal(record.tenderFee, null);
  });

  it('rejects a tender with no id or no title', () => {
    assert.ok(normalizeCpppTender({ title: 'x' }).problems.includes('missing tender id'));
    assert.ok(normalizeCpppTender({ tenderId: 'a' }).problems.includes('missing title'));
  });
});

describe('CPPP client', () => {
  // A fetch stub that serves the list page, then detail pages.
  const stub = () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      const body = url.includes('FrontEndTenderDetails') ? DETAIL_HTML
        : url.includes('FrontEndLatestActiveTenders') ? LIST_HTML
        : '<html></html>';
      return { ok: true, status: 200, text: async () => body };
    };
    return { calls, fetchImpl };
  };

  const HTTP_OPTS = { requestDelayMs: 0, baseUrl: 'https://eprocure.gov.in', listPath: '/epublish/app?page=FrontEndLatestActiveTenders&service=page' };

  it('fetches the listing then each detail page and merges them', async () => {
    const { calls, fetchImpl } = stub();
    const client = createCpppClient({ fetchImpl, ...HTTP_OPTS });
    const page = await client.tenders({ page: 0 });
    assert.equal(page.content.length, 2);
    assert.equal(page.totalPages, 1);
    const [first] = page.content;
    assert.equal(first.tenderValue, '1,25,00,000', 'detail fields merged onto list row');
    assert.equal(first.refNo, 'PWD/BHOPAL/2026/42');
    assert.equal(calls.length, 3, 'one list page + two detail pages');
  });

  it('serves the listing as a single page', async () => {
    const { fetchImpl } = stub();
    const client = createCpppClient({ fetchImpl, ...HTTP_OPTS });
    assert.deepEqual((await client.tenders({ page: 1 })).content, []);
  });

  it('raises a SourceError when the portal returns an unexpected page', async () => {
    const client = createCpppClient({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>nope</html>' }), ...HTTP_OPTS });
    await assert.rejects(client.tenders({ page: 0 }), (e) => e instanceof SourceError && /layout may have changed/.test(e.message));
  });
});

describe('CPPP end-to-end through the ingestion pipeline', () => {
  let ctx;
  before(async () => { ctx = await makeContext(); });
  after(() => ctx.close());

  // A fake client that serves CPPP-shaped dtos directly (no HTML), like the
  // Tenderbook fakeClient but producing crawler records.
  const client = (dtos) => ({
    tenders: async ({ page = 0 } = {}) => (page > 0
      ? { content: [], totalElements: dtos.length, totalPages: 1, page }
      : { content: dtos, totalElements: dtos.length, totalPages: 1, page: 0 }),
  });
  const dto = (over = {}) => ({
    tenderId: `2026_T_${Math.random().toString(36).slice(2, 8)}`,
    refNo: 'REF/1',
    title: 'Construction of rural road',
    organisationChain: 'Public Works Department',
    category: 'Civil Works & Infrastructure',
    tenderValue: '50,00,000',
    emdAmount: '1,00,000',
    publishedDate: '20-Oct-2026 05:00 PM',
    closingDate: '15-Nov-2026 03:00 PM',
    detailUrl: 'https://eprocure.gov.in/epublish/app?id=1',
    ...over,
  });
  const opts = (dtos, extra = {}) => ({ client: client(dtos), providerId: 'cppp', normalize: normalizeCpppTender, pageDelayMs: 0, trigger: 'manual', ...extra });
  const count = () => ctx.db.withContext(SYSTEM, async (q) => (await q.one(`SELECT count(*)::int AS n FROM tenders WHERE provider_id = 'cppp'`)).n);

  it('stores scraped tenders and is idempotent on re-run', async () => {
    const dtos = [dto(), dto(), dto()];
    const first = await runIngestion(ctx.db, opts(dtos));
    assert.equal(first.status, 'success');
    assert.deepEqual([first.inserted, first.updated, first.skipped], [3, 0, 0]);
    assert.equal(await count(), 3);

    const second = await runIngestion(ctx.db, opts(dtos));
    assert.deepEqual([second.inserted, second.updated, second.skipped], [0, 0, 3], 're-crawling identical data changes nothing');
    assert.equal(await count(), 3);
  });

  it('maps masters and resolves the category, mapping the state too', async () => {
    const one = dto({ tenderId: '2026_MAP_1', category: 'Civil Works & Infrastructure', organisationChain: 'Public Works Department', state: 'Madhya Pradesh' });
    await runIngestion(ctx.db, opts([one]));
    const row = await ctx.db.withContext(SYSTEM, (q) =>
      q.one(`SELECT category_id, department_id, state_id FROM tenders WHERE source_id = $1`, ['2026_MAP_1']));
    assert.ok(row.category_id, 'exact category name resolves to a master');
    assert.ok(row.department_id, 'exact department name resolves to a master');
    assert.ok(row.state_id, 'state resolves to a master');
  });

  it('updates a tender when the source changes it', async () => {
    const base = dto({ tenderId: '2026_UPD_1', title: 'Original title' });
    await runIngestion(ctx.db, opts([base]));
    const changed = { ...base, title: 'Revised title' };
    const run = await runIngestion(ctx.db, opts([changed]));
    assert.deepEqual([run.inserted, run.updated], [0, 1]);
    const title = await ctx.db.withContext(SYSTEM, async (q) => (await q.one(`SELECT title FROM tenders WHERE source_id = '2026_UPD_1'`)).title);
    assert.equal(title, 'Revised title');
  });
});

describe('GePNIC portal registry', () => {
  it('has well-formed, uniquely-identified entries', () => {
    const ids = GEPNIC_PORTALS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, 'portal ids are unique');
    for (const p of GEPNIC_PORTALS) {
      assert.ok(p.id && p.name && p.baseUrl && p.appPath, `${p.id} has required fields`);
      assert.match(p.baseUrl, /^https:\/\//, `${p.id} baseUrl is https`);
      assert.ok(['central_portal', 'state_portal', 'psu_direct'].includes(p.type), `${p.id} has a valid provider type`);
    }
    assert.ok(enabledPortals().some((p) => p.id === 'cppp'), 'CPPP is enabled');
    assert.ok(enabledPortals().some((p) => p.id === 'mp'), 'Madhya Pradesh is enabled');
  });

  it('builds per-portal client options with the right path and state', () => {
    const mp = GEPNIC_PORTALS.find((p) => p.id === 'mp');
    const o = portalClientOptions(mp);
    assert.equal(o.baseUrl, 'https://mptenders.gov.in');
    assert.match(o.listPath, /\/nicgep\/app\?page=FrontEndListTendersbyDate/);
    assert.equal(o.tableSelector, '#table');
    assert.equal(o.state, 'Madhya Pradesh');
  });
});

describe('crawl-gepnic job across portals', () => {
  let ctx;
  before(async () => {
    ctx = await makeContext();
    await ctx.db.withContext(SYSTEM, seedCrawlerProviders); // register provider rows
  });
  after(() => ctx.close());

  const gepnicDto = (over = {}) => ({
    tenderId: `2026_X_${Math.random().toString(36).slice(2, 8)}`,
    refNo: 'REF/1', title: 'Road works', organisationChain: 'Public Works Department',
    closingDate: '15-Nov-2026 03:00 PM', ...over,
  });

  it('crawls every portal, isolates failures, and attributes state', async () => {
    const portals = [
      { id: 'cppp', name: 'CPPP', state: null, type: 'central_portal', baseUrl: 'https://eprocure.gov.in', appPath: '/eprocure/app', enabled: true },
      { id: 'mp', name: 'MP', state: 'Madhya Pradesh', type: 'state_portal', baseUrl: 'https://mptenders.gov.in', appPath: '/nicgep/app', enabled: true },
      { id: 'odisha', name: 'Odisha', state: 'Odisha', type: 'state_portal', baseUrl: 'https://tendersodisha.gov.in', appPath: '/nicgep/app', enabled: true },
    ];
    // Fake client: MP/CPPP serve rows; Odisha throws (simulating a bad URL).
    const makeCrawlerClient = (o) => ({
      tenders: async ({ page = 0 } = {}) => {
        if (o.baseUrl.includes('tendersodisha')) throw new Error('site unreachable');
        const rows = page > 0 ? [] : [gepnicDto(), gepnicDto()];
        return { content: rows, totalElements: rows.length, totalPages: 1, page: 0 };
      },
    });
    const jobs = createJobs(ctx.db, { crawler: { enabled: true, engine: 'http', intervalMinutes: 360, requestDelayMs: 0 }, portals, makeCrawlerClient });
    const detail = await jobs['crawl-gepnic'].run();

    assert.equal(detail.portals, 3);
    assert.equal(detail.failed, 1, 'odisha failed but did not stop the others');
    assert.equal(detail.inserted, 4, 'cppp + mp each stored 2');
    const mpState = await ctx.db.withContext(SYSTEM, async (q) =>
      (await q.one(`SELECT state FROM tenders WHERE provider_id = 'mp' LIMIT 1`)).state);
    assert.equal(mpState, 'Madhya Pradesh', 'MP tenders are attributed to the MP state');
  });

  it('can target a single portal with { only }', async () => {
    const portals = [
      { id: 'cppp', name: 'CPPP', state: null, type: 'central_portal', baseUrl: 'https://eprocure.gov.in', appPath: '/eprocure/app', enabled: true },
      { id: 'mp', name: 'MP', state: 'Madhya Pradesh', type: 'state_portal', baseUrl: 'https://mptenders.gov.in', appPath: '/nicgep/app', enabled: true },
    ];
    const makeCrawlerClient = () => ({ tenders: async ({ page = 0 } = {}) => ({ content: page > 0 ? [] : [gepnicDto()], totalElements: 1, totalPages: 1, page: 0 }) });
    const jobs = createJobs(ctx.db, { crawler: { enabled: true, engine: 'http', intervalMinutes: 360, requestDelayMs: 0 }, portals, makeCrawlerClient });
    const detail = await jobs['crawl-gepnic'].run({ only: 'mp' });
    assert.equal(detail.portals, 1);
    assert.deepEqual(detail.results.map((r) => r.portal), ['mp']);
  });
});
