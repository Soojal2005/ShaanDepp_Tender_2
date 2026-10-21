import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { SYSTEM, anon, createOrg, createUser, makeContext, seedTenders, signIn, tenderDto } from './helpers.js';

const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };
const titles = (res) => res.body.items.map((t) => t.title).sort();

describe('tender search', () => {
  let ctx, user, otherOrgUser, ids, masters;

  before(async () => {
    ctx = await makeContext();
    const orgA = await createOrg(ctx.db, { name: 'Org A' });
    const orgB = await createOrg(ctx.db, { name: 'Org B' });
    await createUser(ctx.db, { orgId: orgA, email: 'a@a.test' });
    await createUser(ctx.db, { orgId: orgA, email: 'a2@a.test' });
    await createUser(ctx.db, { orgId: orgB, email: 'b@b.test' });

    const list = [
      tenderDto({ tender_summary: 'Supply and installation of ultrasonic water meters with AMR', work_desc: 'Smart metering', authority: 'Public Health Engineering Department', category: 'Goods', state: 'Madhya Pradesh', city: 'Bhopal', tender_value: 12_000_000, dueInDays: 10, boq_details: ['Flow sensor', 'Ultrasonic meter DN15'] }),
      tenderDto({ tender_summary: 'Water meters with CCTV surveillance', work_desc: 'Meters and cameras', authority: 'Public Health Engineering Department', category: 'Goods', state: 'Maharashtra', city: 'Pune', tender_value: 3_000_000, dueInDays: 15 }),
      tenderDto({ tender_summary: 'Construction of 100-bed hospital building', work_desc: 'Civil and MEP', authority: 'Public Works Department', category: 'Construction', state: 'Madhya Pradesh', city: 'Bhopal', tender_value: 485_000_000, dueInDays: 2, pubDaysAgo: 1, tender_no: 'PWD/BPL/2026/118' }),
      tenderDto({ tender_summary: 'Four laning of NH-48 highway section', work_desc: 'Highway works', authority: 'National Highways Authority of India (NHAI)', category: 'Construction', state: 'Gujarat', city: 'Vadodara', tender_value: 25_000_000, dueInDays: 30, boq_details: ['Bitumen VG-30', 'RCC M30'] }),
      tenderDto({ tender_summary: 'Repair of rural road under PMGSY', work_desc: 'Road repair', authority: 'Rural Development Department', category: 'Construction', state: 'Madhya Pradesh', city: 'Sehore', tender_value: null, dueInDays: 5 }),
      tenderDto({ tender_summary: 'Painting of old buildings', authority: 'Public Works Department', category: 'Construction', state: 'Madhya Pradesh', tender_value: 500_000, dueInDays: -10, tender_status: 'CLOSED', pubDaysAgo: 40 }),
      tenderDto({ tender_summary: 'Supply of laptops', authority: 'Sugar Federation', category: 'It And Telecommunications', state: 'Maharashtra', tender_value: 800_000, dueInDays: 12 }),
      tenderDto({ tender_summary: 'Solar rooftop 4.125 MW grid-connected plant', authority: 'Solar Energy Corporation Of India', category: 'Solar Power Plants', state: 'Rajasthan', tender_value: 300_000_000, dueInDays: 25 }),
      tenderDto({ tender_summary: 'Road widening works', work_desc: 'Construction of road', authority: 'Public Works Department', category: 'Construction', state: 'Madhya Pradesh', tender_value: 7_000_000, dueInDays: 18 }),
      tenderDto({ tender_summary: 'Bridge approach', work_desc: 'Includes road embankment and road signage', authority: 'Public Works Department', category: 'Construction', state: 'Madhya Pradesh', tender_value: 9_000_000, dueInDays: 22 }),
      tenderDto({ tender_summary: 'School building repair', authority: 'Public Works Department', category: 'Construction', state: 'Madhya Pradesh', tender_value: 2_000_000, dueInDays: 28 }),
      tenderDto({ tender_summary: 'Culvert construction', authority: 'Public Works Department', category: 'Construction', state: 'Madhya Pradesh', tender_value: 1_500_000, dueInDays: 35 }),
    ];
    // Only the first five tenders carry a deliberate city; the rest are filler in Indore.
    list.forEach((d, i) => { if (i > 4) d.city = 'Indore'; });
    ids = await seedTenders(ctx.db, list);
    user = await signIn(ctx.app, 'a@a.test');
    otherOrgUser = await signIn(ctx.app, 'b@b.test');
    masters = (await user.get('/masters')).body;
  });
  after(() => ctx.close());

  const search = (qs = '', client = user) => client.get(`/tenders?${qs}`);
  const idOf = (name, list) => list.find((m) => m.name === name).id;

  describe('text', () => {
    it('requires a signed-in user', async () => {
      assert.equal((await anon(ctx.app).get('/tenders')).status, 401);
    });

    it('matches word prefixes, so "meter" finds "meters"', async () => {
      assert.deepEqual(titles(await search('q=meter')), ['Supply and installation of ultrasonic water meters with AMR', 'Water meters with CCTV surveillance']);
    });

    it('requires every term to match, in any chosen scope', async () => {
      assert.equal((await search('q=water+meter')).body.total, 2);
      assert.equal((await search('q=water+hospital')).body.total, 0);
    });

    it('excludes terms with a leading minus and with the exclusion field', async () => {
      const expected = ['Supply and installation of ultrasonic water meters with AMR'];
      assert.deepEqual(titles(await search('q=meter+-cctv')), expected);
      assert.deepEqual(titles(await search('q=meter&exclude=cctv')), expected);
      assert.deepEqual(titles(await search('q=meter&exclude=surveillance,camera')), expected, 'exclusion covers description text too');
    });

    it('matches quoted phrases only when the words are adjacent and in order', async () => {
      assert.equal((await search(`q=${encodeURIComponent('"water meters"')}`)).body.total, 2);
      assert.equal((await search(`q=${encodeURIComponent('"meters water"')}`)).body.total, 0);
    });

    it('limits matching to the chosen scope (title, description, BOQ)', async () => {
      assert.deepEqual(titles(await search('q=bitumen&scope=boq')), ['Four laning of NH-48 highway section']);
      assert.equal((await search('q=bitumen&scope=title')).body.total, 0);
      assert.equal((await search('q=bitumen&scope=description')).body.total, 0);
      assert.equal((await search('q=bitumen')).body.total, 1, 'all scopes by default');
      assert.deepEqual(titles(await search('q=cameras&scope=description')), ['Water meters with CCTV surveillance']);
      assert.equal((await search('q=cameras&scope=title')).body.total, 0);
    });

    it('finds numbers, hyphenated codes and tender numbers', async () => {
      assert.equal((await search('q=4.125')).body.total, 1);
      assert.equal((await search('q=NH-48')).body.total, 1);
      assert.deepEqual(titles(await search(`q=${encodeURIComponent('PWD/BPL/2026/118')}`)), ['Construction of 100-bed hospital building']);
    });

    it('ranks title matches above description-only matches', async () => {
      const res = await search('q=road&sort=relevance');
      const order = res.body.items.map((t) => t.title);
      assert.ok(order.indexOf('Repair of rural road under PMGSY') < order.indexOf('Bridge approach'), order.join(' | '));
    });

    it('survives hostile and malformed input without errors', async () => {
      for (const q of [`'; DROP TABLE tenders; --`, 'a & b | !c (', '\\\\', '"unterminated', '-', '*:*', ':::', '<->', 'x'.repeat(290), '😀', 'ट्रांसफॉर्मर']) {
        const res = await search(`q=${encodeURIComponent(q)}`);
        assert.equal(res.status, 200, `q=${q.slice(0, 20)} gave ${res.status}`);
      }
      assert.ok((await ctx.db.withContext(SYSTEM, (q) => q.one('SELECT count(*)::int AS n FROM tenders'))).n >= 12);
    });
  });

  describe('filters', () => {
    it('filters by department, state and category ids (several at once)', async () => {
      const pwd = idOf('Public Works Department', masters.departments);
      const phed = idOf('Public Health Engineering Department', masters.departments);
      const mp = idOf('Madhya Pradesh', masters.states);
      const cat = idOf('Civil Works & Infrastructure', masters.categories);
      assert.equal((await search(`departmentIds=${pwd}`)).body.items.every((t) => t.department === 'Public Works Department'), true);
      assert.equal((await search(`departmentIds=${pwd}&departmentIds=${phed}&status=all`)).body.total, 8);
      assert.equal((await search(`departmentIds=${pwd},${phed}&status=all`)).body.total, 8, 'comma lists work too');
      assert.equal((await search(`departmentIds=${pwd},${phed}`)).body.total, 7, 'the closed tender is left out by default');
      assert.ok((await search(`stateIds=${mp}`)).body.items.every((t) => t.state === 'Madhya Pradesh'));
      assert.ok((await search(`categoryIds=${cat}`)).body.total >= 7);
    });

    it('filters by city', async () => {
      const mp = masters.states.find((s) => s.name === 'Madhya Pradesh').id;
      const { cities } = (await user.get(`/masters/cities?stateId=${mp}`)).body;
      const bhopal = cities.find((c) => c.name === 'Bhopal').id;
      assert.equal((await search(`cityIds=${bhopal}`)).body.total, 2);
    });

    it('applies value ranges only to tenders that publish a value', async () => {
      const res = await search('valueMin=10000000&status=all');
      assert.ok(res.body.items.every((t) => t.estimatedValue >= 10_000_000));
      assert.ok(!res.body.items.some((t) => t.estimatedValue === null), 'undisclosed values are not treated as zero or as a match');
      assert.equal((await search('valueMin=1000000&valueMax=3000000')).body.total, 3);
    });

    it('splits open, closing-soon and closed tenders', async () => {
      assert.deepEqual(titles(await search('status=closing_soon')), ['Construction of 100-bed hospital building']);
      assert.deepEqual(titles(await search('status=closed')), ['Painting of old buildings']);
      const open = await search('status=open&pageSize=100');
      assert.ok(!open.body.items.some((t) => t.title === 'Painting of old buildings'));
      assert.equal((await search('status=all')).body.total, 12);
    });

    it('filters by publish and deadline dates', async () => {
      const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      assert.deepEqual(titles(await search(`deadlineFrom=${day(1)}&deadlineTo=${day(3)}`)), ['Construction of 100-bed hospital building']);
      assert.deepEqual(titles(await search(`publishFrom=${day(-1)}&publishTo=${day(0)}&status=all`)), ['Construction of 100-bed hospital building']);
    });

    it('filters by tender type', async () => {
      assert.equal((await search('tenderTypes=works')).body.total, 11);
      assert.equal((await search('tenderTypes=goods')).body.total, 0);
    });

    it('rejects malformed filters instead of ignoring them', async () => {
      for (const qs of ['valueMin=abc', 'page=0', 'pageSize=500', 'status=bogus', 'deadlineFrom=tomorrow', 'departmentIds=x', 'scope=everything']) {
        assert.equal((await search(qs)).status, 400, qs);
      }
    });
  });

  describe('order, paging, facets', () => {
    it('orders by deadline, value and publish date', async () => {
      const byDeadline = (await search('sort=deadline')).body.items.map((t) => t.deadline);
      assert.deepEqual(byDeadline, [...byDeadline].sort());
      const byValue = (await search('sort=value&status=all')).body.items;
      assert.equal(byValue[0].title, 'Construction of 100-bed hospital building');
      assert.equal(byValue[byValue.length - 1].estimatedValue, null, 'undisclosed values sort last');
    });

    it('pages results with correct totals', async () => {
      const first = await search('pageSize=5&page=1&status=all');
      const last = await search('pageSize=5&page=3&status=all');
      assert.deepEqual([first.body.total, first.body.pages, first.body.items.length, last.body.items.length], [12, 3, 5, 2]);
      const seen = new Set();
      for (const p of [1, 2, 3]) (await search(`pageSize=5&page=${p}&status=all`)).body.items.forEach((t) => seen.add(t.id));
      assert.equal(seen.size, 12, 'no tender repeated or skipped across pages');
    });

    it('returns facet counts that respect the other filters', async () => {
      const res = await search('facets=1&q=meter');
      const depts = Object.fromEntries(res.body.facets.departments.map((d) => [d.label, d.count]));
      assert.deepEqual(depts, { 'Public Health Engineering Department': 2 });
      const all = await search('facets=1&status=all');
      assert.equal(all.body.facets.departments.find((d) => d.label === 'Public Works Department').count, 6);
      // A facet ignores its own filter so the user can still see the alternatives.
      const phed = idOf('Public Health Engineering Department', masters.departments);
      const withFilter = await search(`facets=1&status=all&departmentIds=${phed}`);
      assert.ok(withFilter.body.facets.departments.length > 1);
    });
  });

  describe('tender detail and watchlist', () => {
    it('returns full detail with documents and BOQ, and 404 for unknown ids', async () => {
      const res = await user.get(`/tenders/${ids[3]}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.tender.ref, `TND-${String(ids[3]).padStart(6, '0')}`);
      assert.deepEqual(res.body.tender.boqItems.map((b) => b.name), ['Bitumen VG-30', 'RCC M30']);
      assert.equal(res.body.tender.documents[0].name, 'NIT.pdf');
      assert.equal(res.body.tender.documents[0].downloadable, false, 'no link is offered when the source gave none');
      assert.equal((await user.get('/tenders/99999999')).status, 404);
      assert.equal((await user.get('/tenders/abc')).status, 400);
    });

    it('shows missing figures as null, never zero', async () => {
      const t = (await user.get(`/tenders/${ids[4]}`)).body.tender;
      assert.equal(t.estimatedValue, null);
      const closed = (await user.get(`/tenders/${ids[5]}`)).body.tender;
      assert.equal(closed.status, 'Closed');
    });

    it('lets a user watch, annotate and unwatch a tender', async () => {
      assert.equal((await user.put(`/tenders/${ids[0]}/watch`).send({ notes: 'Call PHED engineer' })).status, 204);
      const detail = (await user.get(`/tenders/${ids[0]}`)).body.tender;
      assert.equal(detail.watchlisted, true);
      assert.equal(detail.watchNotes, 'Call PHED engineer');
      assert.deepEqual(titles(await search('watchlisted=true&status=all')), ['Supply and installation of ultrasonic water meters with AMR']);
      assert.equal((await search(`q=meter`)).body.items.find((t) => t.id === ids[0]).watchlisted, true);

      assert.equal((await user.delete(`/tenders/${ids[0]}/watch`)).status, 204);
      assert.equal((await search('watchlisted=true&status=all')).body.total, 0);
      assert.equal((await user.put('/tenders/99999999/watch').send({})).status, 404);
    });

    it('keeps each person\'s watchlist private, even inside one organization', async () => {
      await user.put(`/tenders/${ids[2]}/watch`).send({});
      const colleague = await signIn(ctx.app, 'a2@a.test');
      assert.equal((await colleague.get('/tenders?watchlisted=true&status=all')).body.total, 0);
      assert.equal((await otherOrgUser.get('/tenders?watchlisted=true&status=all')).body.total, 0);
      assert.equal((await otherOrgUser.get(`/tenders/${ids[2]}`)).body.tender.watchlisted, false);
      await user.delete(`/tenders/${ids[2]}/watch`);
    });
  });

  describe('saved searches', () => {
    it('saves, lists and deletes a named filter combination', async () => {
      const created = await user.post('/saved-searches').send({ name: 'MP roads', filters: { q: 'road', status: 'open', stateIds: [1], junk: 'ignored' } });
      assert.equal(created.status, 201);
      assert.equal(created.body.search.filters.q, 'road');
      assert.equal('junk' in created.body.search.filters, false, 'unknown keys are dropped');
      const list = await user.get('/saved-searches');
      assert.deepEqual(list.body.searches.map((s) => s.name), ['MP roads']);
      assert.equal((await user.delete(`/saved-searches/${created.body.search.id}`)).status, 204);
      assert.equal((await user.delete(`/saved-searches/${created.body.search.id}`)).status, 404);
    });

    it('keeps saved searches private to their owner', async () => {
      const mine = await user.post('/saved-searches').send({ name: 'Private', filters: { q: 'solar' } });
      assert.equal((await otherOrgUser.get('/saved-searches')).body.searches.length, 0);
      assert.equal((await otherOrgUser.delete(`/saved-searches/${mine.body.search.id}`)).status, 404);
      await user.delete(`/saved-searches/${mine.body.search.id}`);
    });

    it('validates what is saved and caps how many', async () => {
      assert.equal((await user.post('/saved-searches').send({ name: '', filters: {} })).status, 400);
      assert.equal((await user.post('/saved-searches').send({ name: 'Bad', filters: { valueMin: 'abc' } })).status, 400);
      for (let i = 0; i < 50; i++) await user.post('/saved-searches').send({ name: `S${i}`, filters: {} });
      assert.equal((await user.post('/saved-searches').send({ name: 'One too many', filters: {} })).status, 409);
      for (const s of (await user.get('/saved-searches')).body.searches) await user.delete(`/saved-searches/${s.id}`);
    });
  });

  describe('Excel export', () => {
    it('exports exactly the filtered list, with unpublished figures written as text', async () => {
      const res = await user.get('/tenders/export.xlsx?status=all').buffer(true).parse(binary);
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /spreadsheetml/);
      assert.match(res.headers['content-disposition'], /attachment; filename="tenders-\d{4}-\d{2}-\d{2}\.xlsx"/);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);
      const ws = wb.getWorksheet('Tenders');
      assert.equal(ws.actualRowCount, 13, 'header + 12 tenders');
      const header = ws.getRow(1).values.slice(1);
      assert.deepEqual(header.slice(0, 3), ['Ref', 'Tender number', 'Title']);
      const rows = [];
      ws.eachRow((row, n) => { if (n > 1) rows.push(Object.fromEntries(header.map((h, i) => [h, row.getCell(i + 1).value]))); });
      const rural = rows.find((r) => r.Title === 'Repair of rural road under PMGSY');
      assert.equal(rural['Estimated value (INR)'], 'Not disclosed');
      assert.equal(rows.find((r) => r.Title === 'Four laning of NH-48 highway section')['Estimated value (INR)'], 25_000_000);
    });

    it('applies the same filters as the screen', async () => {
      const res = await user.get('/tenders/export.xlsx?q=meter').buffer(true).parse(binary);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);
      assert.equal(wb.getWorksheet('Tenders').actualRowCount, 3);
    });
  });

  describe('dashboard', () => {
    it('computes figures from the data, counting undisclosed values separately', async () => {
      const res = await user.get('/dashboard');
      assert.equal(res.status, 200);
      const { kpis, byDepartment, byState, monthly, valueBands, closingSoon } = res.body;
      assert.equal(kpis.openTenders, 11);
      assert.equal(kpis.openValueUndisclosed, 1);
      assert.equal(kpis.openWithValue + kpis.openValueUndisclosed, kpis.openTenders);
      assert.equal(kpis.closingSoon, 1);
      assert.equal(kpis.openValueKnown, 12_000_000 + 3_000_000 + 485_000_000 + 25_000_000 + 800_000 + 300_000_000 + 7_000_000 + 9_000_000 + 2_000_000 + 1_500_000);
      assert.equal(Object.values(valueBands).reduce((a, b) => a + b, 0), kpis.openTenders, 'bands add up to the open total');
      assert.equal(valueBands.undisclosed, 1);
      assert.equal(monthly.length, 6);
      assert.equal(monthly.reduce((a, m) => a + m.count, 0), 12);
      assert.ok(Math.abs(byState.reduce((a, s) => a + s.share, 0) - 100) < 0.5);
      assert.equal(byDepartment[0].label, 'Public Works Department');
      assert.deepEqual(closingSoon.map((t) => t.title), ['Construction of 100-bed hospital building']);
      assert.equal(kpis.matchedToAlertsThisWeek, 0);
      assert.ok(res.body.dataAsOf);
    });

    it('requires sign-in', async () => {
      assert.equal((await anon(ctx.app).get('/dashboard')).status, 401);
    });
  });
});
