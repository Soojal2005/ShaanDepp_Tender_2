import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { MIN_SAMPLE } from '../src/services/results.js';
import { DAY, SYSTEM, anon, createOrg, createUser, makeContext, resultDto, seedResults, signIn } from './helpers.js';

const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };
const bid = (name, amount, rank, won = false, tech = 1) => ({ bidder_name: name, rank, bid_amount: amount, technical_bid_status: tech, aoc_status: won ? 1 : 2 });

describe('tender results', () => {
  let ctx, user, masters;
  const pwd = () => masters.departments.find((d) => d.name === 'Public Works Department').id;
  const nhai = () => masters.departments.find((d) => d.name === 'National Highways Authority of India').id;
  const phed = () => masters.departments.find((d) => d.name === 'Public Health Engineering Department').id;

  before(async () => {
    ctx = await makeContext();
    const org = await createOrg(ctx.db, { name: 'Client' });
    await createUser(ctx.db, { orgId: org, email: 'u@c.test' });
    user = await signIn(ctx.app, 'u@c.test');
    masters = (await user.get('/masters')).body;

    // PWD: eight awards with a published L1 against a 1 crore estimate, spread -10, -8, -5, -15, 0, -12, -7, -9 percent.
    const pct = [90, 92, 95, 85, 100, 88, 93, 91];
    const pwdAwards = pct.map((p, i) => resultDto({
      work_desc: `PWD road work ${i}`, authority: 'Public Works Department', state: 'Madhya Pradesh',
      tender_value: 10_000_000, contract_value: 10_000_000 * (p / 100), contract_date: Date.now() - (i * 20 + 3) * DAY,
      bidder_list: [bid('apex infra', 10_000_000 * (p / 100), 1, true), bid(i % 2 ? 'gupta constructions' : 'narmada builders', 10_000_000 * (p / 100) * 1.03, 2),
        ...(i < 4 ? [bid('third bidder', 10_000_000 * (p / 100) * 1.06, 3)] : [])],
    }));
    // NHAI: only three awards, fewer than the minimum sample.
    const nhaiAwards = [88, 91, 94].map((p, i) => resultDto({
      work_desc: `Highway lot ${i}`, authority: 'National Highways Authority of India (NHAI)', state: 'Gujarat', category: 'Construction',
      tender_value: 200_000_000, contract_value: 200_000_000 * (p / 100), contract_date: Date.now() - (i * 5 + 1) * DAY,
      bidder_list: [bid('gupta constructions', 200_000_000 * (p / 100), 1, true), bid('apex infra', 200_000_000 * (p / 100) * 1.02, 2)],
    }));
    // Winner known but the rate was not published.
    const noRate = resultDto({
      work_desc: 'Rate withheld job', authority: 'Public Works Department', state: 'Madhya Pradesh', tender_value: 5_000_000, contract_value: null,
      bidder_list: [bid('apex infra', 0, 1, true)],
    });
    // Rate-per-unit data for the same item in two departments.
    const unit = (dept, state, rate, i) => resultDto({
      work_desc: `Water meter supply ${dept} ${i}`, authority: dept, state, category: 'Goods', product_name: 'Water Meter', unit: 'nos', unit_rate: rate,
      tender_value: 1_000_000, contract_value: 900_000, contract_date: Date.now() - (i + 1) * 40 * DAY,
      bidder_list: [bid('bharat water', 900_000, 1, true)],
    });
    const unitAwards = [unit('Public Health Engineering Department', 'Madhya Pradesh', 1800, 0), unit('Public Health Engineering Department', 'Madhya Pradesh', 1900, 1),
      unit('Public Works Department', 'Rajasthan', 2400, 2), unit('Public Works Department', 'Rajasthan', 2600, 3)].map((dto) => ({ ...dto, product_name: 'Water Meter' }));
    await seedResults(ctx.db, [...pwdAwards, ...nhaiAwards, noRate, ...unitAwards]);
  });
  after(() => ctx.close());

  describe('search', () => {
    it('requires sign-in', async () => assert.equal((await anon(ctx.app).get('/results')).status, 401));

    it('lists awards with their L1/L2 and the spread against the estimate', async () => {
      const res = await user.get(`/results?departmentIds=${pwd()}&q=PWD+road+work`);
      assert.equal(res.body.total, 8);
      const a = res.body.items.find((x) => x.title === 'PWD road work 3');
      assert.deepEqual([a.winner, a.l1Amount, a.l2Bidder, a.estimatedValue, a.bidders, a.qualified], ['apex infra', 8_500_000, 'gupta constructions', 10_000_000, 3, 3]);
      assert.equal(a.spreadPct, -15, 'L1 15% below the estimate is -15');
      assert.match(a.ref, /^RES-\d{6}$/);
    });

    it('shows a winner with no published rate, with no spread and no invented number', async () => {
      const a = (await user.get('/results?q=withheld')).body.items[0];
      assert.deepEqual([a.winner, a.l1Amount, a.spreadPct, a.rateStatus, a.awardedValue], ['apex infra', null, null, 'not_published', null]);
    });

    it('filters by department, state, dates, value and rate availability', async () => {
      assert.equal((await user.get(`/results?departmentIds=${nhai()}`)).body.total, 3);
      assert.equal((await user.get(`/results?departmentIds=${pwd()}&ratePublished=true`)).body.total, 10, '8 road works + 2 unit-rate PWD awards');
      assert.equal((await user.get(`/results?departmentIds=${pwd()}`)).body.total, 11, 'plus the one without a rate');
      const day = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
      assert.equal((await user.get(`/results?departmentIds=${nhai()}&from=${day(30)}&to=${day(8)}`)).body.total, 1);
      assert.ok((await user.get('/results?valueMin=100000000')).body.items.every((a) => a.awardedValue >= 100_000_000));
      assert.equal((await user.get('/results?winner=gupta')).body.items.every((a) => a.winner.toLowerCase().includes('gupta')), true);
    });

    it('sorts by date, value and spread', async () => {
      const bySpread = (await user.get(`/results?departmentIds=${pwd()}&ratePublished=true&sort=spread`)).body.items.map((a) => a.spreadPct).filter((v) => v !== null);
      assert.deepEqual(bySpread, [...bySpread].sort((x, y) => x - y));
      const byDate = (await user.get('/results?sort=date')).body.items.map((a) => a.awardDate);
      assert.deepEqual(byDate, [...byDate].sort().reverse());
    });

    it('pages and treats wildcards in the search box literally', async () => {
      const page2 = await user.get('/results?pageSize=5&page=2');
      assert.equal(page2.body.items.length, 5);
      assert.equal(page2.body.pages, Math.ceil(page2.body.total / 5));
      for (const q of ['%', '_', '\\', "'; DROP TABLE historical_awards; --"]) {
        const res = await user.get(`/results?q=${encodeURIComponent(q)}`);
        assert.equal(res.status, 200);
        assert.equal(res.body.total, 0, `"${q}" must not match everything`);
      }
      for (const qs of ['page=0', 'pageSize=999', 'from=yesterday', 'sort=magic', 'departmentIds=x']) assert.equal((await user.get(`/results?${qs}`)).status, 400, qs);
    });

    it('returns an award with every bidder in rank order and a link to its tender when we hold it', async () => {
      const { items } = (await user.get('/results?q=road+work+0')).body;
      const detail = await user.get(`/results/${items[0].id}`);
      assert.equal(detail.status, 200);
      assert.deepEqual(detail.body.result.bidderList.map((b) => [b.name, b.rank, b.isL1]), [['apex infra', 1, true], ['narmada builders', 2, false], ['third bidder', 3, false]]);
      assert.equal((await user.get('/results/99999999')).status, 404);
    });
  });

  describe('rate analysis', () => {
    it('summarises how far below the estimate winning bids landed', async () => {
      const res = await user.get(`/results/analysis/rates?departmentIds=${pwd()}&q=road+work`);
      const o = res.body.overall;
      assert.equal(o.awards, 8);
      assert.equal(o.withSpread, 8);
      assert.equal(o.enoughData, true);
      assert.equal(o.minSpreadPct, -15);
      assert.equal(o.maxSpreadPct, 0);
      assert.equal(o.avgSpreadPct, -8.25);
      assert.equal(o.medianSpreadPct, -8.5);
    });

    it('suggests a bid band as the historical middle range, scaled to a given estimate', async () => {
      const res = await user.get(`/results/analysis/rates?departmentIds=${pwd()}&q=road+work&estimatedValue=20000000`);
      const band = res.body.band;
      assert.deepEqual([band.basedOn, band.lowPct, band.highPct], [8, -10.5, -6.5]);
      assert.deepEqual([band.low, band.high], [17_900_000, 18_700_000]);
      assert.equal(res.body.bandNote, null);
    });

    it('refuses to give statistics or a band from too few awards', async () => {
      const res = await user.get(`/results/analysis/rates?departmentIds=${nhai()}&estimatedValue=1000`);
      assert.equal(res.body.overall.withSpread, 3);
      assert.ok(MIN_SAMPLE > 3);
      assert.deepEqual([res.body.overall.enoughData, res.body.overall.avgSpreadPct, res.body.overall.p25], [false, null, null]);
      assert.equal(res.body.band, null);
      assert.match(res.body.bandNote, /Fewer than 5 awards/);
    });

    it('leaves awards without a published rate out of every rate figure but still counts them', async () => {
      const res = await user.get(`/results/analysis/rates?departmentIds=${pwd()}`);
      assert.equal(res.body.overall.awards, 11);
      assert.equal(res.body.overall.withRate, 10);
    });

    it('groups by department, category or state and says how many awards each rests on', async () => {
      const byDept = await user.get('/results/analysis/rates?by=department');
      const labels = byDept.body.groups.map((g) => g.label);
      assert.ok(labels.includes('Public Works Department') && labels.includes('National Highways Authority of India'));
      assert.equal(byDept.body.groups.find((g) => g.label.startsWith('National')).enoughData, false);
      assert.ok((await user.get('/results/analysis/rates?by=state')).body.groups.some((g) => g.label === 'Gujarat'));
      assert.ok((await user.get('/results/analysis/rates?by=category')).body.groups.length > 0);
      assert.equal((await user.get('/results/analysis/rates?by=colour')).status, 400);
    });

    it('shows the trend month by month', async () => {
      const { months } = (await user.get(`/results/analysis/trend?departmentIds=${pwd()}&q=road+work`)).body;
      assert.ok(months.length >= 3);
      assert.deepEqual(months.map((m) => m.month), [...months.map((m) => m.month)].sort());
      assert.equal(months.reduce((n, m) => n + m.awards, 0), 8);
    });
  });

  describe('rate per unit', () => {
    it('lists the item/unit pairs that have a published unit rate', async () => {
      const { combos } = (await user.get('/results/analysis/unit-rates')).body;
      assert.deepEqual(combos.map((c) => [c.item, c.unit, c.awards]), [['water meter', 'nos', 4]]);
    });

    it('compares departments like for like, lowest average first', async () => {
      const res = await user.get('/results/analysis/unit-rates?item=water%20meter&unit=nos&by=department');
      assert.deepEqual(res.body.groups.map((g) => [g.label, g.awards, g.lowest, g.average, g.highest]), [
        ['Public Health Engineering Department', 2, 1800, 1850, 1900], ['Public Works Department', 2, 2400, 2500, 2600],
      ]);
      const byState = await user.get('/results/analysis/unit-rates?item=water%20meter&unit=nos&by=state');
      assert.deepEqual(byState.body.groups.map((g) => g.label), ['Madhya Pradesh', 'Rajasthan']);
    });
  });

  describe('tender analysis', () => {
    it('describes each department\'s award pattern and how crowded its bidding is', async () => {
      const { departments } = (await user.get('/results/analysis/departments')).body;
      const p = departments.find((d) => d.department === 'Public Works Department');
      assert.ok(p.awards >= 8 && p.awardsPerMonth > 0);
      assert.equal(p.avgBidders, 2.1, '23 bidders across 11 awards');
      assert.ok(p.avgVariancePct < 0, 'awards landed below estimates');
      const n = departments.find((d) => d.department.startsWith('National'));
      assert.equal(n.avgVariancePct, null, 'three awards are too few to quote an average variance (minimum is 5)');
      assert.equal(n.avgBidders, null);
      assert.equal(n.sample, 3);
    });

    it('profiles bidders by win rate and flags repeat winners', async () => {
      const { bidders } = (await user.get('/results/analysis/bidders')).body;
      const apex = bidders.find((b) => b.name === 'apex infra');
      assert.equal(apex.wins, 9, '8 PWD road works plus the one with no published rate');
      assert.equal(apex.repeatWinner, true);
      assert.equal(apex.winRatePct, Math.round((apex.wins / apex.participations) * 1000) / 10);
      assert.ok(apex.participations > apex.wins, 'also lost bids as L2');
      assert.deepEqual(bidders.map((b) => b.wins), [...bidders.map((b) => b.wins)].sort((x, y) => y - x), 'most wins first');
      const gupta = bidders.find((b) => b.name === 'gupta constructions');
      assert.equal(gupta.wins, 3);
      assert.equal((await user.get('/results/analysis/bidders?name=gupta')).body.bidders.every((b) => b.name.includes('gupta')), true);
      assert.ok((await user.get('/results/analysis/bidders?min=5')).body.bidders.every((b) => b.participations >= 5));
    });

    it('shows where a firm keeps winning and its recent awards', async () => {
      const detail = await user.get('/results/analysis/bidders/detail?key=Apex%20Infra');
      assert.equal(detail.status, 200);
      const pwdRow = detail.body.departments.find((d) => d.department === 'Public Works Department');
      assert.equal(pwdRow.keepsWinning, true);
      assert.ok(detail.body.recent.length > 0);
      assert.ok(detail.body.recent.every((r) => typeof r.won === 'boolean'));
      assert.equal((await user.get('/results/analysis/bidders/detail')).status, 400);
    });
  });

  describe('Excel export', () => {
    it('exports the filtered list, writing unpublished figures as text', async () => {
      const res = await user.get(`/results/export.xlsx?departmentIds=${pwd()}&q=withheld`).buffer(true).parse(binary);
      assert.equal(res.status, 200);
      assert.match(res.headers['content-disposition'], /tender-results-\d{4}-\d{2}-\d{2}\.xlsx/);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);
      const ws = wb.getWorksheet('Results');
      assert.equal(ws.actualRowCount, 2);
      const header = ws.getRow(1).values.slice(1);
      const row = Object.fromEntries(header.map((h, i) => [h, ws.getRow(2).getCell(i + 1).value]));
      assert.equal(row['L1 amount (INR)'], 'Not published');
      assert.equal(row['L1 vs estimate (%)'], 'Unavailable');
      assert.equal(row['L1 bidder'], 'apex infra');
    });
  });

  it('reads results as a client account but a client cannot change them', async () => {
    await assert.rejects(
      ctx.db.withContext({ scope: 'tenant', orgId: 1 }, (q) => q.query(`UPDATE historical_awards SET winner_name = 'pwned'`)).then((r) => { if (r.rowCount) throw new Error('updated'); }),
      /updated/
    ).catch(() => {});
    const count = await ctx.db.withContext(SYSTEM, (q) => q.one(`SELECT count(*)::int AS n FROM historical_awards WHERE winner_name = 'pwned'`));
    assert.equal(count.n, 0);
  });
});
