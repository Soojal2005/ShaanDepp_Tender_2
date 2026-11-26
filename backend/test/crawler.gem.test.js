import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  GEM_BASE_URL, addDays, createGemClient, createGemSession, istDay, mapGemDoc, parseGemResponse,
} from '../src/services/ingestion/sources/gem/gem.js';
import { gemDate, inferGemState, normalizeGemTender } from '../src/services/ingestion/sources/gem/normalize.js';
import { extractTenderFields } from '../src/services/enrichment/fields.js';
import {
  GEPNIC_PORTALS, isGepnicProvider, portalPublicUrl, sweepPortals,
} from '../src/services/ingestion/sources/cppp/portals.js';
import { assertFetchableUrl } from '../src/services/documentProxy.js';
import { SourceError } from '../src/services/ingestion/tenderbook.js';
import { seedCrawlerProviders } from '../src/db/seed.js';
import { createJobs } from '../src/jobs/definitions.js';
import { SYSTEM, makeContext } from './helpers.js';

const noSleep = async () => {};

// GeM timestamps carry IST wall-clock digits with a "Z" suffix.
const gemTs = (day, time = '20:00:00') => `${day}T${time}Z`;

// A faithful copy of a real /all-bids-data doc (bidplus.gem.gov.in, verified
// 2026-11-26), with the closing/start days made relative so the test never
// drifts into the past.
function bidDoc({ id, number, endDay, startDay, endTime = '20:00:00', startTime = '10:00:00', type = 1, kind = 1, ministry = 'Ministry of Railways', dept = 'Indian Railways', items, short, qty = 4, extra = {} }) {
  const full = items ?? 'Goods Transportation service - Monthly Based Service - Outside city within state; Machinery & Equipment; Closed Body LCV Truck';
  return {
    id: String(id), b_id: [id], b_bid_number: [number],
    b_category_name: [short ?? full.slice(0, 99)], bd_category_name: [full],
    b_total_quantity: [qty], b_status: [1], b_bid_type: [type], b_type: [kind], b_is_bunch: [1],
    b_buyer_status: [0], b_eval_type: [0],
    final_start_date_sort: [gemTs(startDay ?? addDays(endDay, -14), startTime)],
    final_end_date_sort: [gemTs(endDay, endTime)],
    is_high_value: [false], is_rc_bid: [0], ba_is_global_tendering: [0], ba_is_limited_tendering: [0], ba_is_single_packet: [0],
    b_cat_id: ['services_home_good_go02585026'], 'b.b_created_by': ['srdmmdnr'],
    ...(ministry === null ? {} : { ba_official_details_minName: [ministry] }),
    ba_official_details_deptName: [dept],
    bid_schedule: [], parent_bid_schedule: [],
    ...extra,
  };
}

// The real Reverse Auction shape (bid type 2, "GEM/…/R/…", tied to a parent bid).
const raDoc = (id, endDay) => bidDoc({
  id, number: `GEM/2026/R/${id}`, endDay, type: 2, kind: 0, ministry: 'Ministry of Defence', dept: 'Department of Military Affairs',
  items: 'Genr Set 15 KVA', qty: 5, extra: { b_bid_number_parent: ['GEM/2026/B/8247438'], b_id_parent: [10134987] },
});

const response = (status, body, cookies = []) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { getSetCookie: () => cookies, get: () => null },
  text: async () => body,
});

/**
 * A stand-in for bidplus.gem.gov.in with the behaviours the client relies on:
 * the All Bids page issues a session cookie + CSRF token; /all-bids-data checks
 * them (HTTP 403 HTML page otherwise), filters by closing day (both ends required,
 * like GeM), sorts, pages 10 at a time, and answers an empty result with HTTP 404
 * {"code":404,"message":"No data found"}.
 */
function fakeGem(docs, { failPosts = () => false } = {}) {
  let sessions = 0;
  const calls = { gets: 0, posts: 0, payloads: [] };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/all-bids' && (init.method ?? 'GET') === 'GET') {
      calls.gets++;
      sessions++;
      const csrf = `tok${sessions}`;
      return response(200, `<html><script>data: {'payload': x, 'csrf_bd_gem_nk': '${csrf}'},</script></html>`,
        [`csrf_gem_cookie=${csrf}; expires=x; Max-Age=1200; path=/; domain=.gem.gov.in;HttpOnly;Secure`, `ci_session=s${sessions}; path=/`]);
    }
    if (u.pathname === '/all-bids-data' && init.method === 'POST') {
      calls.posts++;
      if (failPosts(calls.posts)) return response(503, '<html>Service Unavailable</html>');
      const form = new URLSearchParams(init.body);
      const csrf = form.get('csrf_bd_gem_nk');
      if (!String(init.headers?.Cookie ?? '').includes(`csrf_gem_cookie=${csrf}`) || csrf !== `tok${sessions}`) {
        return response(403, '<!DOCTYPE html><html><head><title>Error</title></head><body>The action you have requested is not allowed.</body></html>');
      }
      const p = JSON.parse(form.get('payload'));
      calls.payloads.push(p);
      const { from, to } = p.filter.byEndDate;
      let rows = docs.filter((d) => {
        const day = d.final_end_date_sort[0].slice(0, 10);
        return from && to ? day >= from && day <= to : true;
      });
      const key = { 'Bid-End-Date-Oldest': 'final_end_date_sort', 'Bid-Start-Date-Oldest': 'final_start_date_sort' }[p.filter.sort];
      if (key) rows = [...rows].sort((a, b) => a[key][0].localeCompare(b[key][0]));
      if (!rows.length) return response(404, JSON.stringify({ status: 0, code: 404, message: 'No data found' }));
      const start = (p.page - 1) * 10;
      return response(200, JSON.stringify({
        status: 1, code: 200, message: 'Bid result',
        response: { response: { numFound: rows.length, start, numFoundExact: true, docs: rows.slice(start, start + 10) } },
      }));
    }
    return response(404, 'not found');
  };
  return { fetchImpl, calls };
}

/** A small live-bid book: 2 pages closing today (2 RAs among them), nothing tomorrow,
 *  5 the day after, and 1 far out after a long gap. 18 docs, 16 storable bids. */
function bidBook(today) {
  const docs = [];
  for (let i = 0; i < 12; i++) {
    const id = 10_000_000 + i;
    docs.push(i === 3 || i === 7
      ? raDoc(id, today)
      : bidDoc({ id, number: `GEM/2026/B/${8_100_000 + i}`, endDay: today, startTime: `10:${String(i).padStart(2, '0')}:00`, kind: i % 2 }));
  }
  const d2 = addDays(today, 2);
  for (let i = 0; i < 5; i++) {
    docs.push(bidDoc({ id: 10_100_000 + i, number: `GEM/2026/B/${8_200_000 + i}`, endDay: d2, startTime: `11:${String(i).padStart(2, '0')}:00`, kind: 0 }));
  }
  const far = addDays(today, 40);
  docs.push(bidDoc({ id: 10_200_000, number: 'GEM/2026/B/8300000', endDay: far, kind: 0, extra: { is_rc_bid: [1] } }));
  return { docs, d2, far };
}

// Drain a client the way runIngestion does: pages until a short batch.
async function drain(client, size = 100) {
  const all = [];
  for (let page = 0; page < 1000; page++) {
    const batch = await client.tenders({ page, size });
    all.push(...batch.content);
    if (batch.content.length < size) break;
  }
  return all;
}

// ---------------------------------------------------------------------------

describe('GeM listing parsing', () => {
  it('maps a real bid doc: number, full item list, buyer, dates, type, public PDF link', () => {
    const doc = bidDoc({ id: 10027513, number: 'GEM/2026/B/8153983', endDay: '2026-11-26', startDay: '2026-10-27', startTime: '19:27:13' });
    const bid = mapGemDoc(doc);
    assert.equal(bid.bidNumber, 'GEM/2026/B/8153983');
    assert.equal(bid.bidId, '10027513');
    assert.equal(bid.bidType, 'bid');
    // b_category_name is cut at ~100 chars; the full list comes from bd_category_name.
    assert.match(bid.items, /Closed Body LCV Truck$/);
    assert.equal(bid.ministry, 'Ministry of Railways');
    assert.equal(bid.department, 'Indian Railways');
    assert.equal(bid.procurement, 'Services');
    assert.equal(bid.quantity, 4);
    assert.equal(bid.endDate, '2026-11-26T20:00:00Z');
    assert.equal(bid.documentUrl, `${GEM_BASE_URL}/showbidDocument/10027513`);
  });

  it('classifies Reverse Auctions and Direct RAs and points each at its own document', () => {
    const ra = mapGemDoc(raDoc(10220633, '2026-11-28'));
    assert.equal(ra.bidType, 'ra');
    assert.equal(ra.parentBidNumber, 'GEM/2026/B/8247438');
    assert.equal(ra.procurement, 'Goods');
    const dra = mapGemDoc(bidDoc({ id: 555, number: 'GEM/2026/R/555', endDay: '2026-11-28', type: 5 }));
    assert.equal(dra.bidType, 'direct_ra');
    assert.equal(dra.documentUrl, `${GEM_BASE_URL}/showdirectradocumentPdf/555`);
  });

  it('treats a missing or "undefined" ministry as none (state buyers)', () => {
    assert.equal(mapGemDoc(bidDoc({ id: 1, number: 'GEM/2026/B/1', endDay: '2026-11-28', ministry: null })).ministry, null);
    assert.equal(mapGemDoc(bidDoc({ id: 2, number: 'GEM/2026/B/2', endDay: '2026-11-28', ministry: 'undefined' })).ministry, null);
  });

  it('reads every reply mode: a page, "No data found" (HTTP 404), and refusals', () => {
    const ok = parseGemResponse(JSON.stringify({ status: 1, code: 200, response: { response: { numFound: 43956, start: 10, docs: [{ id: 'x' }] } } }));
    assert.deepEqual([ok.total, ok.start, ok.docs.length], [43956, 10, 1]);
    // GeM answers an empty slice with HTTP 404 + JSON code 404 — an empty result, not an error.
    assert.deepEqual(parseGemResponse('{"status":0,"code":404,"message":"No data found"}', 404), { total: 0, start: 0, docs: [] });
    // An expired CSRF token gets CodeIgniter's HTML error page with HTTP 403.
    assert.throws(() => parseGemResponse('<!DOCTYPE html><title>Error</title>', 403), (e) => e instanceof SourceError && e.retryable && e.status === 403);
    assert.throws(() => parseGemResponse('<html>maintenance</html>', 200), (e) => e instanceof SourceError && e.retryable);
    assert.throws(() => parseGemResponse('{"code":500}', 200), SourceError);
  });
});

describe('GeM normalization', () => {
  it('reads GeM timestamps as India time (the "Z" digits are IST)', () => {
    // The bid PDF prints this same value as "Bid End Date/Time 26-11-2026 20:00:00".
    assert.equal(gemDate('2026-11-26T20:00:00Z').toISOString(), '2026-11-26T14:30:00.000Z');
    assert.equal(gemDate(['2026-10-27T19:27:13Z']).toISOString(), '2026-10-27T13:57:13.000Z');
    assert.equal(gemDate('nonsense'), null);
    assert.equal(gemDate(null), null);
  });

  it('turns a bid into a pipeline record: bid no., buyer, type, IST deadline, public document', () => {
    const endDay = addDays(istDay(Date.now()), 10);
    const bid = mapGemDoc(bidDoc({ id: 10027513, number: 'GEM/2026/B/8153983', endDay }));
    const { record, problems } = normalizeGemTender(bid);
    assert.deepEqual(problems, []);
    assert.equal(record.sourceId, 'GEM/2026/B/8153983');
    assert.equal(record.tenderNo, 'GEM/2026/B/8153983');
    assert.match(record.title, /^Goods Transportation service/);
    assert.equal(record.department, 'Indian Railways');
    assert.equal(record.orgType, 'Central');
    assert.equal(record.tenderType, 'Services', 'GeM service bid -> the Services procurement type the alert filters use');
    assert.equal(record.category, null, 'no coarse category (it would match every GeM bid)');
    assert.equal(record.state, null, 'central buyer: no state guessed');
    assert.equal(record.submissionDeadline.toISOString(), new Date(`${endDay}T20:00:00+05:30`).toISOString());
    assert.equal(record.status, 'Open');
    // The listing publishes no money: NULL, never 0.
    assert.equal(record.estimatedValue, null);
    assert.equal(record.emdAmount, null);
    assert.equal(record.emdStatus, 'not_published');
    assert.equal(record.tenderFee, null);
    assert.equal(record.hasDocuments, true);
    assert.deepEqual(record.documents, [{
      name: 'Bid document GEM/2026/B/8153983', type: 'Tender Document', externalId: '10027513',
      url: `${GEM_BASE_URL}/showbidDocument/10027513`,
    }]);
    assert.equal(record.sourceUrl, `${GEM_BASE_URL}/showbidDocument/10027513`);
    assert.match(record.description, /Quantity: 4\. Buyer: Ministry of Railways \/ Indian Railways\. GeM bid GEM\/2026\/B\/8153983$/);
    assert.equal(record.checksum, normalizeGemTender(bid).record.checksum, 'stable checksum: an unchanged bid is skipped');
  });

  it('marks a bid whose closing time has passed as Closed', () => {
    const bid = mapGemDoc(bidDoc({ id: 7, number: 'GEM/2026/B/7', endDay: addDays(istDay(Date.now()), -2) }));
    assert.equal(normalizeGemTender(bid).record.status, 'Closed');
  });

  it('infers the state only for state-government buyers named after their state', () => {
    assert.equal(inferGemState({ ministry: null, department: 'Department of Higher Education Madhya Pradesh' }), 'Madhya Pradesh');
    assert.equal(inferGemState({ ministry: null, department: 'Jammu & Kashmir Power Development Department' }), 'Jammu and Kashmir');
    assert.equal(inferGemState({ ministry: null, department: 'Govt of NCT of Delhi' }), 'Delhi');
    assert.equal(inferGemState({ ministry: null, department: 'Arunachal Pradesh Police' }), 'Arunachal Pradesh');
    assert.equal(inferGemState({ ministry: null, department: 'Goa State Pollution Control Board' }), 'Goa', 'a short full state name still counts');
    assert.equal(inferGemState({ ministry: null, department: 'Urban Development Department' }), null, 'no state named');
    // A central body's name is not its location.
    assert.equal(inferGemState({ ministry: 'Ministry of Finance', department: 'Punjab National Bank' }), null);
    assert.equal(inferGemState({ ministry: null, department: 'Umpteenth Committee' }), null, 'abbreviations like "UP"/"MP" are not matched');
  });

  it('keeps a long multi-item title readable and the full list in the description', () => {
    const items = Array.from({ length: 60 }, (_, i) => `Item number ${i} (V2)`).join(',');
    const bid = mapGemDoc(bidDoc({ id: 9, number: 'GEM/2026/B/9', endDay: addDays(istDay(Date.now()), 5), items }));
    const { record } = normalizeGemTender(bid);
    assert.ok(record.title.length <= 301, `title capped (${record.title.length})`);
    assert.ok(record.title.endsWith('…'));
    assert.ok(record.description.includes('Item number 59 (V2)'), 'description keeps every item for keyword matching');
  });

  it('rejects a doc without a bid number', () => {
    const { problems } = normalizeGemTender({ ...mapGemDoc(bidDoc({ id: 1, number: '', endDay: '2026-12-01' })), bidNumber: null });
    assert.deepEqual(problems, ['missing bid number']);
  });
});

describe('GeM session', () => {
  it('opens a session from the All Bids page and reopens it when GeM refuses the token', async () => {
    const today = istDay(Date.now());
    const { docs } = bidBook(today);
    const gem = fakeGem(docs);
    const session = createGemSession({ fetchImpl: gem.fetchImpl, userAgent: 'test-agent' });
    const page = await session.query({ page: 1, param: {}, filter: { byEndDate: { from: today, to: today }, sort: 'Bid-Start-Date-Oldest' } });
    assert.equal(page.docs.length, 10);
    assert.equal(gem.calls.gets, 1);
    session.reset();
    await session.query({ page: 2, param: {}, filter: { byEndDate: { from: today, to: today }, sort: 'Bid-Start-Date-Oldest' } });
    assert.equal(gem.calls.gets, 2, 'reset forces a fresh session');
  });

  it('fails clearly when the page hands out no token (layout changed)', async () => {
    const session = createGemSession({ fetchImpl: async () => response(200, '<html>no token here</html>') });
    await assert.rejects(session.query({}), /did not hand out a session/);
  });
});

describe('GeM closing-day sweep', () => {
  const NOW = Date.parse('2026-12-01T06:30:00Z'); // 12:00 IST
  const TODAY = '2026-12-01';

  it('walks every closing day once, skips empty days and Reverse Auctions, then restarts the cycle', async () => {
    const { docs, d2, far } = bidBook(TODAY);
    const gem = fakeGem(docs);
    const client = createGemClient({ fetchImpl: gem.fetchImpl, now: () => NOW, sleep: noSleep, maxPages: 100 });
    const bids = await drain(client);

    assert.equal(bids.length, 16, 'all 16 storable bids');
    assert.ok(bids.every((b) => b.bidType !== 'ra'), 'no Reverse Auctions');
    assert.equal(new Set(bids.map((b) => b.bidNumber)).size, 16, 'no duplicates');
    const r = client.report();
    assert.equal(r.skippedReverseAuctions, 2);
    assert.equal(r.total, 18, 'live bid count from the opening range query');
    assert.equal(r.cycleComplete, true);
    assert.deepEqual(r.cursor, { day: TODAY, page: 1 }, 'next run starts a new cycle at today');
    // The empty day (tomorrow) and the 37 empty days before `far` cost no slice requests.
    const slices = gem.calls.payloads.filter((p) => p.filter.byEndDate.from === p.filter.byEndDate.to).map((p) => `${p.filter.byEndDate.from}#${p.page}`);
    assert.deepEqual(slices, [`${TODAY}#1`, `${TODAY}#2`, `${d2}#1`, `${far}#1`]);
    assert.equal(r.requests, 8, '4 slice pages + 4 seeks');
    // Every request carries both ends of the range (GeM ignores a range with an empty "to").
    assert.ok(gem.calls.payloads.every((p) => p.filter.byEndDate.from && p.filter.byEndDate.to));
    assert.ok(gem.calls.payloads.every((p) => p.filter.bidStatusType === 'ongoing_bids'));
  });

  it('stops at the page budget and the next run resumes exactly where it stopped', async () => {
    const { docs } = bidBook(TODAY);
    const gem = fakeGem(docs);
    const seen = new Set();
    let cursor = null;
    const runs = [];
    for (let run = 0; run < 10; run++) {
      const client = createGemClient({ fetchImpl: gem.fetchImpl, now: () => NOW, sleep: noSleep, maxPages: 2, cursor });
      for (const b of await drain(client)) seen.add(b.bidNumber);
      const r = client.report();
      runs.push(r);
      cursor = r.cursor;
      if (r.cycleComplete) break;
    }
    assert.equal(runs[0].stoppedBy, 'page budget');
    assert.deepEqual(runs[0].cursor, { day: TODAY, page: 2 }, 'run 1 read page 1 of today and stopped');
    assert.equal(seen.size, 16, 'together the runs covered every bid');
    assert.ok(runs.at(-1).cycleComplete);
    assert.ok(runs.length > 1 && runs.length < 10);
  });

  it('ignores a stale cursor from a past day and starts at today', async () => {
    const { docs } = bidBook(TODAY);
    const gem = fakeGem(docs);
    const client = createGemClient({ fetchImpl: gem.fetchImpl, now: () => NOW, sleep: noSleep, maxPages: 2, cursor: { day: addDays(TODAY, -3), page: 40 } });
    await drain(client);
    assert.deepEqual(client.report().cursor, { day: TODAY, page: 2 });
  });

  it('retries with a fresh session when a request is refused, without losing its place', async () => {
    const { docs } = bidBook(TODAY);
    let refused = false;
    const gem = fakeGem(docs);
    const flaky = async (url, init) => {
      // GeM invalidates the token once mid-run (as when its 20-minute CSRF cookie lapses).
      if (init?.method === 'POST' && gem.calls.posts === 2 && !refused) {
        refused = true;
        gem.calls.posts++;
        return response(403, '<!DOCTYPE html><title>Error</title>');
      }
      return gem.fetchImpl(url, init);
    };
    const client = createGemClient({ fetchImpl: flaky, now: () => NOW, sleep: noSleep, maxPages: 100 });
    const bids = await drain(client);
    assert.equal(bids.length, 16, 'nothing lost to the refusal');
    assert.equal(gem.calls.gets, 2, 'a second session was opened');
  });

  it('gives up after its retries with a SourceError when GeM stays down', async () => {
    const gem = fakeGem(bidBook(TODAY).docs, { failPosts: () => true });
    const client = createGemClient({ fetchImpl: gem.fetchImpl, now: () => NOW, sleep: noSleep, maxPages: 100 });
    await assert.rejects(client.tenders({ page: 0, size: 100 }), (e) => e instanceof SourceError && e.status === 503);
    assert.equal(gem.calls.posts, 3, 'one attempt + two retries');
  });

  it('hands over the bids it already read before reporting a later failure', async () => {
    // The 4th request onwards fails: today's two pages are read, the next seek is not.
    const gem = fakeGem(bidBook(TODAY).docs, { failPosts: (n) => n >= 4 });
    const client = createGemClient({ fetchImpl: gem.fetchImpl, now: () => NOW, sleep: noSleep, maxPages: 100 });
    const first = await client.tenders({ page: 0, size: 100 });
    assert.equal(first.content.length, 10, "today's 10 storable bids are returned for storing");
    await assert.rejects(client.tenders({ page: 1, size: 100 }), SourceError);
    assert.deepEqual(client.report().cursor, { day: TODAY, page: 2 }, 'resume point is kept for the next run');
  });

  it('paces its requests', async () => {
    const gem = fakeGem(bidBook(TODAY).docs);
    const waits = [];
    let clock = NOW;
    const client = createGemClient({
      fetchImpl: gem.fetchImpl, now: () => clock, maxPages: 100, requestDelayMs: 1000,
      sleep: async (ms) => { waits.push(ms); clock += ms; },
    });
    await drain(client);
    assert.equal(waits.length, client.report().requests - 1, 'a pause between every pair of requests');
    assert.ok(waits.every((ms) => ms === 1000));
  });

  it('stops at the time budget', async () => {
    const gem = fakeGem(bidBook(TODAY).docs);
    let clock = NOW;
    const client = createGemClient({
      fetchImpl: gem.fetchImpl, now: () => clock, maxPages: 100, maxRunMs: 1500, requestDelayMs: 1000,
      sleep: async (ms) => { clock += ms; },
    });
    await drain(client);
    assert.equal(client.report().stoppedBy, 'time budget');
    assert.equal(client.report().cycleComplete, false);
  });
});

describe('GeM in the portal registry', () => {
  it('is registered as a GeM provider with a public listing link and allowed documents', () => {
    const gem = GEPNIC_PORTALS.find((p) => p.id === 'gem');
    assert.ok(gem?.enabled);
    assert.equal(gem.type, 'gem');
    assert.equal(gem.adapter, 'gem');
    assert.equal(portalPublicUrl('gem'), 'https://bidplus.gem.gov.in/all-bids');
    assert.equal(isGepnicProvider('gem'), false, 'documents are served by the proxy, not the GePNIC worker');
    // The document proxy only fetches from registry hosts: the bid PDF host is allowed.
    assert.equal(assertFetchableUrl('https://bidplus.gem.gov.in/showbidDocument/10027513').hostname, 'bidplus.gem.gov.in');
  });

  it('is left out of the shared crawl-gepnic sweep (it has its own job)', () => {
    assert.ok(!sweepPortals().some((p) => p.id === 'gem'));
    assert.ok(sweepPortals().some((p) => p.id === 'cppp'));
  });
});

describe('GeM bid PDF fields', () => {
  // Text as pdfjs extracts it from live GeM bid PDFs (bilingual labels). Every
  // GeM bid PDF carries its own bid number, which is how it is recognised.
  const HEADER = 'बड सं:या / Bid Number : GEM/2026/B/8153983 ;दनांक / Dated : 27-10-2026 बड बड द\'तावेज़ / Bid Document 1 / 8 ';
  const PDF_TEXT = `${HEADER}/Bid End Date/Time 26-11-2026 20:00:00 ... कुल मूल्य (सभी करE स;हत) भारतीय Wपये मG / Estimated Bid Value in INR (Inclusive of all taxes) 6137280 मूTयांकन पXित /Evaluation Method Total value wise evaluation ... EMD Amount 122800 ईपीबीजी ववरण /ePBG Detail ...`;
  const BOILERPLATE_ONLY = `${HEADER}EMD Amount 250000 ... 4. Estimated Bid Value indicated above is being declared solely for the purpose of guidance on EMD amount and for determining the Eligibility Criteria related to Turn Over, Past Performance and Project / Past Experience etc. In case the bid value is more than Rs 10 Crore, the declaration ...`;
  // A live bid (GEM/2026/B/8205239) whose ATC states the EMD and whose
  // eligibility clause mentions "400% of the bid estimated value".
  const ATC_EMD = `${HEADER}... EMD (3% of bid value, i.e. Rs.6,000/-) as per Gujarat Procurement Policy 2024. ... In case of OEM the turnover at least 400% of the bid estimated value. ...`;

  it('reads the estimated bid value and EMD from a GeM bid PDF', () => {
    const f = extractTenderFields(PDF_TEXT);
    assert.equal(f.estimatedValue?.rupees, 6137280);
    assert.equal(f.emdAmount?.rupees, 122800);
  });

  it('never reads the guidance boilerplate as a value', () => {
    const f = extractTenderFields(BOILERPLATE_ONLY);
    assert.equal(f.estimatedValue, null);
    assert.equal(f.emdAmount?.rupees, 250000);
  });

  it('does not take "400% of the bid estimated value" as the value, so the real EMD is kept', () => {
    const f = extractTenderFields(ATC_EMD);
    assert.equal(f.estimatedValue, null, 'the broad "estimated value" label is not applied to GeM text');
    assert.equal(f.emdAmount?.rupees, 6000);
  });

  it('leaves the general NIT patterns unchanged for other portals', () => {
    const f = extractTenderFields('Name of Work: Road repair. Estimated Cost of Work: Rs. 12,50,000/- EMD: Rs. 25,000/- Tender Fee: Rs. 1,180/-');
    assert.equal(f.estimatedValue?.rupees, 1250000);
    assert.equal(f.emdAmount?.rupees, 25000);
    assert.equal(f.tenderFee?.rupees, 1180);
  });
});

describe('crawl-gem job', () => {
  let ctx;
  before(async () => {
    ctx = await makeContext();
    await ctx.db.withContext(SYSTEM, seedCrawlerProviders); // registers the gem provider row
  });
  after(() => ctx.close());

  it('is enabled only when the crawler and GeM are both on', () => {
    const gem = { enabled: true, intervalMinutes: 30, maxPages: 1, requestDelayMs: 0, enrichMaxDocs: 0 };
    assert.equal(createJobs(ctx.db, { crawler: { enabled: false }, gem })['crawl-gem'].enabled, false);
    assert.equal(createJobs(ctx.db, { crawler: { enabled: true }, gem: { ...gem, enabled: false } })['crawl-gem'].enabled, false);
    const on = createJobs(ctx.db, { crawler: { enabled: true }, gem })['crawl-gem'];
    assert.equal(on.enabled, true);
    assert.equal(on.cron, '*/30 * * * *');
    assert.equal(on.catchUp, true);
  });

  it('stores GeM bids across resumed runs, keeps the cursor, and enriches from the bid PDFs', async () => {
    const today = istDay(Date.now());
    const { docs } = bidBook(today);
    const gem = fakeGem(docs);
    const enrichCalls = [];
    const jobs = createJobs(ctx.db, {
      crawler: { enabled: true, userAgent: 'test-agent', timeoutMs: 5000 },
      gem: { enabled: true, intervalMinutes: 30, maxPages: 3, requestDelayMs: 0, enrichMaxDocs: 5 },
      makeGemClient: (o) => createGemClient({ ...o, fetchImpl: gem.fetchImpl, sleep: noSleep }),
      enrichGem: async (o) => { enrichCalls.push(o); return { considered: 0, filled: 0 }; },
    });

    const results = [];
    for (let i = 0; i < 6; i++) {
      const r = await jobs['crawl-gem'].run();
      results.push(r);
      if (r.cycleComplete) break;
    }
    assert.equal(results[0].stoppedBy, 'page budget');
    assert.ok(results.at(-1).cycleComplete, 'the sweep completed over a few resumed runs');
    assert.equal(results.reduce((n, r) => n + r.inserted, 0), 16);

    const stored = await ctx.db.withContext(SYSTEM, (q) => q.many(
      `SELECT source_id, tender_no, tender_type, status, submission_deadline, has_documents, source_url, emd_status, estimated_value
         FROM tenders WHERE provider_id = 'gem' ORDER BY source_id`));
    assert.equal(stored.length, 16);
    assert.ok(stored.every((t) => /^GEM\/2026\/B\/\d+$/.test(t.source_id) && t.tender_no === t.source_id), 'bid numbers, no Reverse Auctions');
    assert.ok(stored.every((t) => t.has_documents && /^https:\/\/bidplus\.gem\.gov\.in\/showbidDocument\/\d+$/.test(t.source_url)));
    assert.ok(stored.every((t) => ['Goods', 'Services'].includes(t.tender_type)));
    assert.ok(stored.every((t) => t.estimated_value === null && t.emd_status === 'not_published'));
    const farBid = stored.find((t) => t.source_id === 'GEM/2026/B/8300000');
    assert.equal(new Date(farBid.submission_deadline).toISOString(), new Date(`${addDays(today, 40)}T20:00:00+05:30`).toISOString(), 'IST deadline stored');

    const docRows = await ctx.db.withContext(SYSTEM, (q) => q.many(
      `SELECT d.url FROM tender_documents d JOIN tenders t ON t.id = d.tender_id WHERE t.provider_id = 'gem'`));
    assert.equal(docRows.length, 16, 'one public bid PDF per bid');

    // The cursor lives on with each ingestion run.
    const runs = await ctx.db.withContext(SYSTEM, (q) => q.many(
      `SELECT status, health FROM ingestion_runs WHERE provider_id = 'gem' ORDER BY id`));
    assert.equal(runs.length, results.length);
    assert.ok(runs.every((r) => r.status === 'success' && r.health.source?.cursor?.day));
    assert.deepEqual(runs.at(-1).health.source.cursor, { day: today, page: 1 });

    assert.equal(enrichCalls.length, results.length);
    assert.deepEqual(enrichCalls[0], { providerId: 'gem', maxDocs: 5 });

    // A further run re-reads bids it already holds and changes nothing.
    const again = await jobs['crawl-gem'].run();
    assert.equal(again.inserted, 0);
    assert.equal(again.updated, 0);
  });

  it('records a failed run (and throws, so the admin console shows it) when GeM is down', async () => {
    const gem = fakeGem([], { failPosts: () => true });
    const jobs = createJobs(ctx.db, {
      crawler: { enabled: true, userAgent: 'test-agent', timeoutMs: 5000 },
      gem: { enabled: true, intervalMinutes: 30, maxPages: 3, requestDelayMs: 0, enrichMaxDocs: 0 },
      makeGemClient: (o) => createGemClient({ ...o, fetchImpl: gem.fetchImpl, sleep: noSleep }),
    });
    await assert.rejects(jobs['crawl-gem'].run(), /GeM crawl failed/);
    const last = await ctx.db.withContext(SYSTEM, (q) => q.one(
      `SELECT status FROM ingestion_runs WHERE provider_id = 'gem' ORDER BY id DESC LIMIT 1`));
    assert.equal(last.status, 'failed');
  });
});
