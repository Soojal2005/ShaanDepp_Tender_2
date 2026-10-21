import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { computeBundle, scopeForOrg } from '../src/services/bundle/compute.js';
import { generateBundle, generateForOrganizations } from '../src/services/bundle/index.js';
import { addDays, isMonday, istStart, mondayOf, periodLabel, previousWeekStart } from '../src/services/bundle/period.js';
import { bundlePdf } from '../src/services/bundle/pdf.js';
import { TILE_GRID } from '../src/services/bundle/tilemap.js';
import { bundleWorkbook } from '../src/services/bundle/xlsx.js';
import { DAY, SYSTEM, anon, createOrg, createUser, makeContext, seedResults, seedTenders, signIn, resultDto, tenderDto } from './helpers.js';

const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };

describe('weeks in India time', () => {
  it('finds the Monday of a week, even for instants that are still the previous day in UTC', () => {
    assert.equal(mondayOf(new Date('2026-10-21T04:00:00Z')), '2026-10-19'); // Wednesday
    assert.equal(mondayOf(new Date('2026-10-18T19:00:00Z')), '2026-10-19', 'Sunday 19:00 UTC is already Monday 00:30 in India');
    assert.equal(mondayOf(new Date('2026-10-18T17:00:00Z')), '2026-10-12', 'Sunday 22:30 in India is still the old week');
    assert.equal(previousWeekStart(new Date('2026-10-21T04:00:00Z')), '2026-10-12');
    assert.equal(previousWeekStart(new Date('2026-10-19T00:30:00Z')), '2026-10-12', 'Monday morning reports on the week just ended');
  });

  it('starts a day at midnight India time and labels periods readably', () => {
    assert.equal(istStart('2026-10-12').toISOString(), '2026-10-11T18:30:00.000Z');
    assert.equal(addDays('2026-12-28', 7), '2027-01-04');
    assert.equal(periodLabel('2026-10-12'), '12-18 Oct 2026');
    assert.equal(periodLabel('2026-09-28'), '28 Sep - 4 Oct 2026');
    assert.equal(periodLabel('2026-12-28'), '28 Dec 2026 - 3 Jan 2027');
    assert.deepEqual(['2026-10-12', '2026-10-13', 'nope'].map(isMonday), [true, false, false]);
  });

  it('has a tile on the India map for each of the 36 states and union territories', () => {
    assert.equal(Object.keys(TILE_GRID).length, 36);
    const cells = new Set(Object.values(TILE_GRID).map(([x, y]) => `${x},${y}`));
    assert.equal(cells.size, 36, 'no two tiles share a square');
  });
});

describe('weekly bundle', () => {
  let ctx, orgA, orgB, orgAll, platform, clientA, clientB;
  const WEEK = '2026-10-12';
  const at = (dayOffset, hour = 12) => istStart(addDays(WEEK, dayOffset)).getTime() + hour * 3_600_000; // inside the week
  const run = (fn) => ctx.db.withContext(SYSTEM, fn);

  before(async () => {
    ctx = await makeContext();
    orgA = await createOrg(ctx.db, { name: 'Roads Co', planCode: 'standard' });
    orgB = await createOrg(ctx.db, { name: 'Other Co', planCode: 'premium' });
    orgAll = await createOrg(ctx.db, { name: 'No Profiles Co', planCode: 'basic' });
    await createUser(ctx.db, { orgId: orgA, email: 'a@a.test', role: 'tenant_admin', name: 'Admin A' });
    await createUser(ctx.db, { orgId: orgB, email: 'b@b.test', role: 'tenant_admin' });
    platform = await signIn(ctx.app, 'admin@test.local');

    const [civil, power] = await run(async (q) => (await q.many(`SELECT id FROM tender_categories WHERE name IN ('Civil Works & Infrastructure', 'Electrical & Power') ORDER BY name`)).map((r) => r.id));
    const mp = (await run((q) => q.one(`SELECT id FROM states WHERE name = 'Madhya Pradesh'`))).id;
    await run((q) => q.query(
      `INSERT INTO alert_profiles (organization_id, name, category_ids, state_ids) VALUES ($1, 'Roads in MP', $2, $3)`, [orgA, [civil], [mp]]));
    await run((q) => q.query(`INSERT INTO alert_profiles (organization_id, name, category_ids) VALUES ($1, 'Power anywhere', $2)`, [orgB, [power]]));

    const pub = (day, o = {}) => tenderDto({ pub_date: at(day), dueInDays: 25, ...o });
    await seedTenders(ctx.db, [
      // This week, in Roads Co's scope (civil works, Madhya Pradesh).
      pub(0, { tender_summary: 'MP road 1', authority: 'Public Works Department', category: 'Construction', state: 'Madhya Pradesh', tender_value: 5_000_000 }),
      pub(1, { tender_summary: 'MP road 2', authority: 'Public Works Department', category: 'Construction', state: 'Madhya Pradesh', tender_value: 50_000_000 }),
      pub(2, { tender_summary: 'MP road 3', authority: 'Public Works Department', category: 'Construction', state: 'Madhya Pradesh', tender_value: null }),
      pub(3, { tender_summary: 'MP road 4', authority: 'Rural Development Department', category: 'Construction', state: 'Madhya Pradesh', tender_value: 500_000 }),
      // Outside Roads Co's scope.
      pub(1, { tender_summary: 'Gujarat road', authority: 'Public Works Department', category: 'Construction', state: 'Gujarat', tender_value: 9_000_000 }),
      pub(2, { tender_summary: 'MP power line', authority: 'State Electricity Distribution Company', category: 'Power Generation And Transmission', state: 'Madhya Pradesh', tender_value: 20_000_000 }),
      // Earlier weeks (for the trend and the movement figures).
      pub(-3, { tender_summary: 'Last week road A', authority: 'Public Works Department', category: 'Construction', state: 'Madhya Pradesh', tender_value: 2_000_000 }),
      pub(-4, { tender_summary: 'Last week road B', authority: 'Public Works Department', category: 'Construction', state: 'Madhya Pradesh', tender_value: 3_000_000 }),
      pub(-5, { tender_summary: 'Last week road C', authority: 'Rural Development Department', category: 'Construction', state: 'Madhya Pradesh', tender_value: 4_000_000 }),
      pub(-10, { tender_summary: 'Two weeks ago road', authority: 'Public Works Department', category: 'Construction', state: 'Madhya Pradesh', tender_value: 6_000_000 }),
      // Critical dates in the two weeks after the report week.
      pub(0, { tender_summary: 'Closing soon road', authority: 'Public Works Department', category: 'Construction', state: 'Madhya Pradesh', tender_value: 7_000_000, due_date: at(9), prebid_date: at(8) }),
    ]);
    // Result data for the competition section: PWD with bidder counts.
    await seedResults(ctx.db, [4, 5, 3, 6].map((n, i) => resultDto({
      authority: 'Public Works Department', state: 'Madhya Pradesh', category: 'Construction', contract_date: at(-20 - i),
      bidder_list: Array.from({ length: n }, (_, k) => ({ bidder_name: `firm ${i}-${k}`, rank: k + 1, bid_amount: 1_000_000 + k, technical_bid_status: 1, aoc_status: k === 0 ? 1 : 2 })),
    })));
  });
  after(() => ctx.close());

  describe('scope', () => {
    it('is taken from the organization\'s own alert profiles', async () => {
      const scope = await run((q) => scopeForOrg(q, orgA));
      assert.deepEqual([scope.categories, scope.states, scope.departments], [['Civil Works & Infrastructure'], ['Madhya Pradesh'], []]);
      assert.equal(scope.basis, 'alert profiles');
    });
    it('is the whole market when there are no profiles', async () => {
      const scope = await run((q) => scopeForOrg(q, orgAll));
      assert.deepEqual([scope.categoryIds, scope.stateIds, scope.departmentIds, scope.basis.startsWith('whole market')], [[], [], [], true]);
    });
    it('widens a dimension when any profile leaves it open', async () => {
      await run((q) => q.query(`INSERT INTO alert_profiles (organization_id, name, category_ids) VALUES ($1, 'Anything in civil', ARRAY[1])`, [orgA]));
      const scope = await run((q) => scopeForOrg(q, orgA));
      assert.deepEqual(scope.stateIds, [], 'one profile names no state, so every state is in scope');
      await run((q) => q.query(`DELETE FROM alert_profiles WHERE organization_id = $1 AND name = 'Anything in civil'`, [orgA]));
    });
  });

  describe('the eight sections', () => {
    let s;
    before(async () => { s = await run((q) => computeBundle(q, { id: orgA, name: 'Roads Co' }, WEEK, { now: new Date(at(7)) })); });

    it('counts only tenders in the subscriber\'s scope and published in that week', () => {
      assert.equal(s.period.label, '12-18 Oct 2026');
      assert.equal(s.summary.count, 5, 'four road tenders plus the closing-soon one; Gujarat and the power line are out of scope');
      assert.equal(s.summary.value, 62_500_000);
      assert.equal(s.summary.undisclosed, 1);
      assert.equal(s.summary.undisclosedSharePct, 20);
    });

    it('1. trends this week against the previous four, with value totals that skip unpublished values', () => {
      assert.deepEqual(s.volumeTrend.map((w) => w.count), [0, 0, 1, 3, 5], 'four weeks ago, three weeks ago, two weeks ago (1), last week (3), this week (5)');
      assert.equal(s.volumeTrend[4].value, 62_500_000);
      assert.equal(s.volumeTrend[3].value, 9_000_000);
      assert.equal(s.summary.prevWeekCount, 3);
      assert.equal(s.summary.changeVsPrevWeekPct, 66.7);
      assert.equal(s.summary.priorFourWeekAvgCount, 1);
      assert.equal(s.summary.changeVsAveragePct, 400);
    });

    it('2. lists every state with a map tile, marking those outside the scope', () => {
      assert.equal(s.states.length, 36);
      const mp = s.states.find((x) => x.name === 'Madhya Pradesh');
      assert.deepEqual([mp.count, mp.inScope, mp.tile], [5, true, TILE_GRID.MP]);
      const gj = s.states.find((x) => x.name === 'Gujarat');
      assert.deepEqual([gj.count, gj.inScope], [0, false]);
      assert.ok(s.states.every((x) => x.tile), 'every state has a tile');
    });

    it('3. ranks departments with movement since last week', () => {
      const [first, second] = s.departments;
      assert.deepEqual([first.department, first.count, first.prevCount, first.change, first.rank], ['Public Works Department', 4, 2, 2, 1]);
      assert.deepEqual([second.department, second.count], ['Rural Development Department', 1]);
      assert.equal(s.departmentsByValue[0].department, 'Public Works Department');
    });

    it('4. bands values and gives unpublished values their own band', () => {
      // 0.5M (5 lakh); 5M and 7M (50 and 70 lakh); 50M (5 crore); one tender with no published value.
      assert.deepEqual(s.valueBands.map((b) => [b.key, b.count]), [['under10Lakh', 1], ['tenLakhTo1Crore', 2], ['over1Crore', 1], ['undisclosed', 1]]);
      assert.equal(s.valueBands.reduce((n, b) => n + b.count, 0), s.summary.count);
    });

    it('5. shows category demand over five weeks and withholds medians resting on too few values', () => {
      const civil = s.categoryDemand.find((c) => c.category === 'Civil Works & Infrastructure');
      assert.deepEqual(civil.weeks, [0, 0, 1, 3, 5]);
      assert.equal(civil.thisWeek, 5);
      const price = s.categoryPricing.find((c) => c.category === 'Civil Works & Infrastructure');
      assert.equal(price.medianThisWeek, 6_000_000, 'median of the four published values: 0.5M, 5M, 7M, 50M');
      assert.equal(price.samplesThisWeek, 4);
      assert.equal(price.medianPrior4Weeks, 3_500_000);
    });

    it('6. reports competition density only where enough results list the bidder count', () => {
      const pwd = s.competition.find((c) => c.department === 'Public Works Department');
      assert.deepEqual([pwd.available, pwd.avgBidders, pwd.awards], [true, 4.5, 4]);
      const rural = s.competition.find((c) => c.department === 'Rural Development Department');
      assert.deepEqual([rural.available, rural.avgBidders], [false, null]);
    });

    it('7. builds the two-week critical-dates calendar', () => {
      const kinds = s.calendar.flatMap((d) => d.items.map((i) => i.type));
      assert.ok(kinds.includes('Pre-bid meeting') && kinds.includes('Submission deadline'));
      assert.ok(s.calendar.every((d) => d.date > '2026-10-18' && d.date <= '2026-11-01'));
      assert.deepEqual(s.calendar.map((d) => d.date), [...s.calendar.map((d) => d.date)].sort());
      assert.ok(s.summary.closingWithinTwoWeeks >= 1);
    });

    it('covers the whole market for an organization with no alert profiles', async () => {
      const all = await run((q) => computeBundle(q, { id: orgAll, name: 'No Profiles Co' }, WEEK));
      assert.equal(all.summary.count, 7, 'all tenders published that week, in every state');
      assert.equal(all.scope.basis.startsWith('whole market'), true);
    });

    it('stays correct for an empty week', async () => {
      const empty = await run((q) => computeBundle(q, { id: orgA, name: 'Roads Co' }, '2026-03-02'));
      assert.deepEqual([empty.summary.count, empty.summary.changeVsPrevWeekPct, empty.departments.length, empty.calendar.length], [0, null, 0, 0]);
    });
  });

  describe('the files', () => {
    let s;
    before(async () => { s = await run((q) => computeBundle(q, { id: orgA, name: 'Roads Co' }, WEEK, { now: new Date(at(7)) })); });

    it('writes a PDF with several pages and no blank trailing page', async () => {
      const pdf = await bundlePdf(s);
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      assert.match(pdf.subarray(-16).toString(), /%%EOF/);
      const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
      assert.ok(pages >= 2 && pages <= 8, `pages: ${pages}`);
      assert.ok(pdf.length > 8000);
    });

    it('survives titles with markup and non-Latin text', async () => {
      const odd = structuredClone(s);
      odd.organization.name = '<b>Rathi & Sons</b> ट्रांसफॉर्मर';
      odd.calendar = [{ date: '2026-10-22', items: [{ type: 'Bid opening', tenderId: 1, title: 'नई सड़क निर्माण', department: null }] }];
      assert.ok((await bundlePdf(odd)).length > 5000);
    });

    it('writes an Excel sheet for every chart, with unpublished figures as text', async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await bundleWorkbook(s));
      assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'Volume trend', 'States', 'Departments', 'Value bands', 'Category demand', 'Pricing pattern', 'Competition', 'Critical dates']);
      assert.equal(wb.getWorksheet('States').actualRowCount, 37);
      const comp = wb.getWorksheet('Competition');
      const rows = []; comp.eachRow((row, n) => { if (n > 1) rows.push(row.values.slice(1)); });
      assert.ok(rows.some((r) => r[2] === 'Not enough result data'));
      assert.equal(wb.getWorksheet('Value bands').getRow(5).getCell(1).value, 'Value not published');
    });
  });

  describe('generation and release', () => {
    it('generates one bundle per client organization and refreshes rather than duplicates', async () => {
      const first = await generateForOrganizations(ctx.db, { periodStart: WEEK });
      assert.deepEqual([first.generated, first.failed], [3, 0]);
      const again = await generateForOrganizations(ctx.db, { periodStart: WEEK });
      assert.equal(again.generated, 3);
      assert.equal((await run((q) => q.one('SELECT count(*)::int AS n FROM report_bundles'))).n, 3);
      assert.equal((await generateForOrganizations(ctx.db, { periodStart: WEEK, orgId: orgA })).generated, 1);
    });

    it('rejects a period that does not start on a Monday', async () => {
      await assert.rejects(run((q) => generateBundle(q, { id: orgA, name: 'x' }, '2026-10-13')), /Monday/);
      assert.equal((await platform.post('/admin/reports/generate').send({ periodStart: '2026-10-13' })).status, 400);
    });

    it('keeps a bundle invisible to its client until it is released', async () => {
      clientA = await signIn(ctx.app, 'a@a.test');
      clientB = await signIn(ctx.app, 'b@b.test');
      assert.equal((await clientA.get('/reports/bundles')).body.bundles.length, 0);
      const { bundles } = (await platform.get('/admin/reports/bundles')).body;
      const forA = bundles.find((b) => b.organizationId === orgA);
      assert.equal(forA.releasedAt, null);
      assert.equal((await clientA.get(`/reports/bundles/${forA.id}`)).status, 404, 'not even its existence is revealed');
      assert.equal((await clientA.get(`/reports/bundles/${forA.id}/pdf`)).status, 404);
      assert.equal((await clientA.get(`/reports/bundles/${forA.id}/xlsx`)).status, 404);
    });

    it('releases to one client, logs it, and does so only once', async () => {
      const forA = (await platform.get('/admin/reports/bundles')).body.bundles.find((b) => b.organizationId === orgA);
      const res = await platform.post('/admin/reports/release').send({ bundleId: forA.id });
      assert.deepEqual(res.body.result, { released: true, orgId: orgA });
      assert.equal((await platform.post('/admin/reports/release').send({ bundleId: forA.id })).body.result.released, false);
      const log = (await platform.get('/admin/reports/releases')).body.releases;
      assert.equal(log.length, 1);
      assert.deepEqual([log[0].scope, log[0].released_by_name], ['client', 'Test Admin']);

      const mine = (await clientA.get('/reports/bundles')).body.bundles;
      assert.deepEqual(mine.map((b) => b.id), [forA.id]);
      assert.equal(mine[0].periodStart, WEEK);
      assert.equal((await clientB.get(`/reports/bundles/${forA.id}`)).status, 404, 'another client cannot open it');
      assert.equal((await clientB.get('/reports/bundles')).body.bundles.length, 0);
    });

    it('serves the released bundle as charts data, a PDF and an Excel sheet, and counts downloads', async () => {
      const [mine] = (await clientA.get('/reports/bundles')).body.bundles;
      const data = await clientA.get(`/reports/bundles/${mine.id}`);
      assert.equal(data.body.bundle.snapshot.summary.count, 5);
      const pdf = await clientA.get(`/reports/bundles/${mine.id}/pdf`).buffer(true).parse(binary);
      assert.equal(pdf.status, 200);
      assert.match(pdf.headers['content-type'], /application\/pdf/);
      assert.match(pdf.headers['content-disposition'], /weekly-tender-intelligence-2026-10-12\.pdf/);
      assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
      const xl = await clientA.get(`/reports/bundles/${mine.id}/xlsx`).buffer(true).parse(binary);
      assert.equal(xl.status, 200);
      assert.equal(xl.body.subarray(0, 2).toString(), 'PK');
      const downloads = (await platform.get('/admin/reports/bundles')).body.bundles.find((b) => b.id === mine.id).downloads;
      assert.equal(downloads, 2);
    });

    it('releases in bulk to every organization on a plan, skipping those already released', async () => {
      const res = await platform.post('/admin/reports/release').send({ planCode: 'premium', periodStart: WEEK });
      assert.deepEqual(res.body.result, { bundles: 1, released: 1, alreadyReleased: 0 });
      assert.equal((await clientB.get('/reports/bundles')).body.bundles.length, 1);
      const std = await platform.post('/admin/reports/release').send({ planCode: 'standard', periodStart: WEEK });
      assert.deepEqual([std.body.result.released, std.body.result.alreadyReleased], [0, 1]);
      assert.equal((await platform.post('/admin/reports/release').send({ planCode: 'platinum', periodStart: WEEK })).status, 400);
      assert.equal((await platform.post('/admin/reports/release').send({})).status, 400);
    });

    it('can email the account administrators when asked, never otherwise', async () => {
      const before = (await run((q) => q.one(`SELECT count(*)::int AS n FROM email_queue WHERE kind = 'bundle_notice'`))).n;
      assert.equal(before, 0, 'releasing never emailed anyone by default');
      const forAll = (await platform.get('/admin/reports/bundles')).body.bundles.find((b) => b.organizationId === orgAll);
      await platform.post('/admin/reports/release').send({ bundleId: forAll.id, notify: true });
      await createUser(ctx.db, { orgId: orgAll, email: 'boss@all.test', role: 'tenant_admin' });
      const second = await generateForOrganizations(ctx.db, { periodStart: addDays(WEEK, -7), orgId: orgAll });
      const prior = (await platform.get(`/admin/reports/bundles?period=${addDays(WEEK, -7)}`)).body.bundles[0];
      await platform.post('/admin/reports/release').send({ bundleId: prior.id, notify: true });
      assert.equal(second.generated, 1);
      const mail = await run((q) => q.one(`SELECT recipient, subject FROM email_queue WHERE kind = 'bundle_notice'`));
      assert.equal(mail.recipient, 'boss@all.test');
      assert.match(mail.subject, /weekly report is ready/);
    });

    it('is for authorised staff only', async () => {
      assert.equal((await clientA.get('/admin/reports/bundles')).status, 403);
      assert.equal((await clientA.post('/admin/reports/release').send({ bundleId: 1 })).status, 403);
      assert.equal((await clientA.post('/admin/reports/generate').send({})).status, 403);
      assert.equal((await anon(ctx.app).get('/reports/bundles')).status, 401);
    });

    it('runs from the scheduler job for the previous week', async () => {
      const out = await ctx.jobs['weekly-bundle'].run({ periodStart: addDays(WEEK, -14) });
      assert.equal(out.generated, 3);
    });
  });
});
