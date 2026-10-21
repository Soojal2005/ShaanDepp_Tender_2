import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { loadMasterIndex } from '../src/services/ingestion/masters.js';
import { checksumOf, normalizeTenderbookResult, normalizeTenderbookTender, toDate, toMoney } from '../src/services/ingestion/normalize.js';
import { runIngestion } from '../src/services/ingestion/runner.js';
import { SourceError, createTenderbookClient } from '../src/services/ingestion/tenderbook.js';
import { DAY, SYSTEM, createOrg, createUser, fakeClient, makeContext, resultDto, signIn, tenderDto } from './helpers.js';

describe('normalising source data', () => {
  it('keeps unpublished figures empty instead of inventing zeroes', () => {
    const { record } = normalizeTenderbookTender(tenderDto({ tender_value: null, earnest_amount: 0, doc_cost: null }));
    assert.equal(record.estimatedValue, null);
    assert.equal(record.emdAmount, null);
    assert.equal(record.emdStatus, 'not_published');
    assert.equal(record.tenderFee, null);
  });

  it('treats a free tender document (fee 0) as a real answer, not a missing one', () => {
    assert.equal(normalizeTenderbookTender(tenderDto({ doc_cost: 0 })).record.tenderFee, 0);
  });

  it('reads epoch-millisecond, epoch-second and ISO dates and rejects nonsense', () => {
    const iso = '2026-11-20T10:00:00Z';
    assert.equal(toDate(Date.parse(iso)).toISOString(), '2026-11-20T10:00:00.000Z');
    assert.equal(toDate(Math.floor(Date.parse(iso) / 1000)).toISOString(), '2026-11-20T10:00:00.000Z');
    assert.equal(toDate(iso).toISOString(), '2026-11-20T10:00:00.000Z');
    assert.equal(toDate('not a date'), null);
    assert.equal(toDate(1), null);
    assert.equal(toDate(null), null);
  });

  it('parses amounts typed with currency marks and refuses zero or text', () => {
    assert.equal(toMoney('₹ 1,25,000'), 125000);
    assert.equal(toMoney('Rs. 50000'), 50000);
    for (const bad of [0, '0', -5, 'NA', '', null, undefined]) assert.equal(toMoney(bad), null);
  });

  it('rejects a tender with no id or no title', () => {
    assert.ok(normalizeTenderbookTender({ tender_summary: 'x' }).problems.includes('missing tender id'));
    assert.ok(normalizeTenderbookTender({ tender_id: 'a' }).problems.includes('missing title'));
  });

  it('identifies L1 and L2 from bidder lists and never invents a rate', () => {
    const { record } = normalizeTenderbookResult(resultDto());
    assert.equal(record.winnerName, 'apex infra');
    assert.equal(record.l1Amount, 4_400_000);
    assert.equal(record.l2BidderName, 'gupta constructions');
    assert.equal(record.l2Amount, 4_550_000);
    assert.equal(record.bidderCount, 3);
    assert.equal(record.qualifiedCount, 2);
    assert.equal(record.rateStatus, 'present');

    const noRate = normalizeTenderbookResult(resultDto({
      bidder_list: [{ bidder_name: 'only winner', rank: 1, bid_amount: 0, technical_bid_status: 1, aoc_status: 1 }],
    })).record;
    assert.equal(noRate.winnerName, 'only winner');
    assert.equal(noRate.l1Amount, null);
    assert.equal(noRate.rateStatus, 'not_published', 'winner known, rate unavailable');
  });

  it('hashes payloads independently of key order', () => {
    assert.equal(checksumOf({ a: 1, b: { c: 2, d: 3 } }), checksumOf({ b: { d: 3, c: 2 }, a: 1 }));
    assert.notEqual(checksumOf({ a: 1 }), checksumOf({ a: 2 }));
  });
});

describe('master matching', () => {
  let ctx, index;
  before(async () => {
    ctx = await makeContext();
    index = await ctx.db.withContext(SYSTEM, loadMasterIndex);
  });
  after(() => ctx.close());

  it('matches names, aliases, bracketed abbreviations and whole-word aliases', () => {
    assert.equal(index.department('National Highways Authority of India (NHAI)').name, 'National Highways Authority of India');
    assert.equal(index.department('Gas Authority Of India Limited').name, 'GAIL (India) Limited');
    assert.equal(index.department('Ntpc Vidyut Vyapar Nigam Limited').name, 'NTPC Limited');
    assert.equal(index.department('South Central Railway').name, 'Indian Railways');
    assert.equal(index.department('public works department').name, 'Public Works Department');
    assert.equal(index.state('Orissa').name, 'Odisha');
    assert.equal(index.state('NCT of Delhi').name, 'Delhi');
    assert.equal(index.category('Power Generation And Transmission').name, 'Electrical & Power');
    assert.equal(index.category('Medical Related Equipment And Supplies').name, 'Medical & Healthcare');
  });

  it('does not guess when nothing matches', () => {
    assert.equal(index.department('Sugar Federation'), null);
    assert.equal(index.category('Something Entirely New'), null);
    assert.equal(index.state('Atlantis'), null);
    assert.equal(index.department(''), null);
  });

  it('does not let a short alias match inside a longer word', () => {
    assert.equal(index.department('Mchenry Constructions'), null, '"MC" must not match inside another word');
  });
});

describe('the Tenderbook client', () => {
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body });

  it('sends the key as an api-key header, never in the URL, and parses the page', async () => {
    let seen;
    const client = createTenderbookClient({
      baseUrl: 'https://example.test', apiKey: 'secret123',
      fetchImpl: async (url, init) => { seen = { url, init }; return res(200, { content: [{ a: 1 }], total_elements: 7, total_pages: 2, number: 1 }); },
    });
    const page = await client.tenders({ page: 1, size: 5, filter: { x: 1 } });
    assert.equal(seen.init.headers.Authorization, 'api-key secret123');
    assert.ok(!seen.url.includes('secret123'));
    assert.match(seen.url, /\/mb\/vendor\/getTenders\?fetchAll=true&page=1&size=5$/);
    assert.deepEqual(JSON.parse(seen.init.body), { x: 1 });
    assert.deepEqual([page.content.length, page.totalElements, page.totalPages], [1, 7, 2]);
  });

  it('accepts a key that already carries the api-key prefix', async () => {
    let header;
    const client = createTenderbookClient({ baseUrl: 'https://e.test', apiKey: 'api-key abc', fetchImpl: async (u, init) => { header = init.headers.Authorization; return res(200, { content: [] }); } });
    await client.results({});
    assert.equal(header, 'api-key abc');
  });

  it('turns failures into clear errors that never contain the key', async () => {
    const make = (impl) => createTenderbookClient({ baseUrl: 'https://e.test', apiKey: 'topsecret', fetchImpl: impl });
    await assert.rejects(make(async () => res(401, {})).tenders(), (e) => e instanceof SourceError && /rejected the API key/.test(e.message) && !e.message.includes('topsecret'));
    await assert.rejects(make(async () => res(503, {})).tenders(), (e) => e.retryable === true);
    await assert.rejects(make(async () => { throw new Error('connect ECONNREFUSED topsecret'); }).tenders(), (e) => !e.message.includes('topsecret'));
    await assert.rejects(make(async () => res(200, { unexpected: true })).tenders(), /unexpected shape/);
  });

  it('refuses to be created without a key', () => {
    assert.throws(() => createTenderbookClient({ apiKey: '' }), /not configured/);
  });
});

describe('ingestion runs', () => {
  let ctx;
  before(async () => { ctx = await makeContext(); });
  after(() => ctx.close());

  const lastRun = () => ctx.db.withContext(SYSTEM, (q) => q.one('SELECT * FROM ingestion_runs ORDER BY id DESC LIMIT 1'));
  const count = (table) => ctx.db.withContext(SYSTEM, async (q) => (await q.one(`SELECT count(*)::int AS n FROM ${table}`)).n);
  const opts = (client, extra = {}) => ({ client, pageDelayMs: 0, pageSize: 3, trigger: 'manual', ...extra });

  it('stores a feed across several pages and is idempotent on re-run', async () => {
    const dtos = Array.from({ length: 7 }, (_, i) => tenderDto({ tender_summary: `Supply of item ${i}` }));
    const client = fakeClient({ tenders: dtos, pageSize: 3 });

    const first = await runIngestion(ctx.db, opts(client));
    assert.equal(first.status, 'success');
    assert.deepEqual([first.fetched, first.inserted, first.updated, first.skipped, first.errors], [7, 7, 0, 0, 0]);
    assert.equal(client.calls.length, 3, 'three pages of 3, 3 and 1');
    assert.equal(await count('tenders'), 7);

    const second = await runIngestion(ctx.db, opts(client));
    assert.deepEqual([second.inserted, second.updated, second.skipped], [0, 0, 7], 're-ingesting identical data changes nothing');
    assert.equal(await count('tenders'), 7);
  });

  it('updates a tender when the source changes it and replaces its documents', async () => {
    const dto = tenderDto({ tender_summary: 'Original title' });
    await runIngestion(ctx.db, opts(fakeClient({ tenders: [dto] })));
    const changed = { ...dto, tender_summary: 'Corrected title', s3_document_path: [{ file_name: 'Corrigendum.pdf', download_id: 'X1' }] };
    const run = await runIngestion(ctx.db, opts(fakeClient({ tenders: [changed] })));
    assert.deepEqual([run.inserted, run.updated], [0, 1]);
    const rows = await ctx.db.withContext(SYSTEM, (q) =>
      q.many(`SELECT t.title, d.name FROM tenders t JOIN tender_documents d ON d.tender_id = t.id WHERE t.source_id = $1`, [dto.tender_id]));
    assert.deepEqual(rows, [{ title: 'Corrected title', name: 'Corrigendum.pdf' }]);
  });

  it('keeps the raw payload and maps masters, queueing names it cannot match', async () => {
    const dto = tenderDto({ authority: 'Sugar Federation', state: 'Maharashtra', city: 'jalgaon', category: 'Construction', tender_summary: 'Weighbridge repair' });
    await runIngestion(ctx.db, opts(fakeClient({ tenders: [dto] })));
    const row = await ctx.db.withContext(SYSTEM, (q) =>
      q.one(`SELECT t.department_id, t.category_id, t.state_id, t.city, t.city_id FROM tenders t WHERE t.source_id = $1`, [dto.tender_id]));
    assert.equal(row.department_id, null, 'unmatched department is not guessed');
    assert.ok(row.category_id && row.state_id);
    assert.equal(row.city, 'Jalgaon', 'new cities are tidied and created under their state');
    assert.ok(row.city_id);
    const suggestion = await ctx.db.withContext(SYSTEM, (q) => q.maybeOne(`SELECT * FROM master_suggestions WHERE raw_value = 'Sugar Federation'`));
    assert.equal(suggestion.kind, 'department');
    const raw = await ctx.db.withContext(SYSTEM, (q) => q.one(`SELECT raw_json FROM raw_tender_payloads WHERE source_id = $1`, [dto.tender_id]));
    assert.equal(raw.raw_json.authority, 'Sugar Federation');
  });

  it('records a failed run, and queues an alert for the operations mailbox', async () => {
    const run = await runIngestion(ctx.db, opts(fakeClient({ failWith: new SourceError('Tenderbook rejected the API key (expired or revoked). Renew the subscription key.', { status: 401 }) })));
    assert.equal(run.status, 'failed');
    assert.match(run.error, /rejected the API key/);
    const mail = await ctx.db.withContext(SYSTEM, (q) => q.maybeOne(`SELECT * FROM email_queue WHERE idempotency_key = $1`, [`ops:ingestion:${run.runId}`]));
    assert.equal(mail.recipient, 'ops@test.local');
    assert.equal(mail.kind, 'ops_alert');
  });

  it('flags a feed that comes back empty as a warning', async () => {
    const run = await runIngestion(ctx.db, opts(fakeClient({ tenders: [] })));
    assert.equal(run.status, 'warning');
    assert.match(run.warnings.join(' '), /at least 1 are expected/);
  });

  it('flags suspected schema drift when many records cannot be read', async () => {
    const good = Array.from({ length: 4 }, () => tenderDto());
    const broken = Array.from({ length: 4 }, () => ({ something_new: 'x' }));
    const run = await runIngestion(ctx.db, opts(fakeClient({ tenders: [...good, ...broken] }), { pageSize: 10 }));
    assert.equal(run.status, 'warning');
    assert.equal(run.errors, 4);
    assert.equal(run.inserted, 4, 'the readable records are still stored');
    assert.match(run.warnings.join(' '), /format may have changed/);
  });

  it('marks a run that stops part-way as a warning and keeps what it stored', async () => {
    const dtos = Array.from({ length: 6 }, () => tenderDto());
    const client = fakeClient({ tenders: dtos, pageSize: 3 });
    const real = client.tenders;
    client.tenders = async (args) => { if (args.page === 1) throw new SourceError('Tenderbook is unavailable (HTTP 503)', { retryable: true }); return real(args); };
    const run = await runIngestion(ctx.db, opts(client));
    assert.equal(run.status, 'warning');
    assert.equal(run.inserted, 3);
  });

  it('back-fills only records inside the requested window', async () => {
    const inside = tenderDto({ pubDaysAgo: 40 });
    const outside = tenderDto({ pubDaysAgo: 5 });
    const run = await runIngestion(ctx.db, opts(fakeClient({ tenders: [inside, outside] }), {
      trigger: 'backfill', from: new Date(Date.now() - 60 * DAY), to: new Date(Date.now() - 30 * DAY), filter: { any: 'passthrough' },
    }));
    assert.equal(run.inserted, 1);
    assert.equal(run.outOfWindow, 1);
    const stored = await ctx.db.withContext(SYSTEM, (q) => q.many('SELECT source_id FROM tenders WHERE source_id = ANY($1::text[])', [[inside.tender_id, outside.tender_id]]));
    assert.deepEqual(stored.map((s) => s.source_id), [inside.tender_id]);
  });

  it('refuses to start a second sync of the same feed while one is running', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const slow = fakeClient({ tenders: [tenderDto()] });
    const real = slow.tenders;
    slow.tenders = async (args) => { await gate; return real(args); };
    const first = runIngestion(ctx.db, opts(slow));
    await new Promise((r) => setTimeout(r, 50));
    await assert.rejects(runIngestion(ctx.db, opts(fakeClient({ tenders: [] }))), /already running/);
    release();
    assert.equal((await first).status, 'success');
  });

  it('ingests results, links them to their tender and stores every bidder', async () => {
    const tender = tenderDto({ tender_no: 'LINK/42/2026' });
    await runIngestion(ctx.db, opts(fakeClient({ tenders: [tender] })));
    const result = resultDto({ tender_no: 'LINK/42/2026' });
    const run = await runIngestion(ctx.db, opts(fakeClient({ results: [result] }), { kind: 'results' }));
    assert.equal(run.inserted, 1);
    const award = await ctx.db.withContext(SYSTEM, (q) => q.one(`SELECT * FROM historical_awards WHERE source_id = $1`, [result.tender_result_id]));
    assert.ok(award.tender_id, 'linked to the tender by number');
    assert.equal(Number(award.estimated_value), 5_000_000, 'estimate comes from the tender when the result has none');
    const bidders = await ctx.db.withContext(SYSTEM, (q) => q.many('SELECT bidder_name, is_l1 FROM award_bidders WHERE award_id = $1 ORDER BY rank_position NULLS LAST', [award.id]));
    assert.equal(bidders.length, 3);
    assert.equal(bidders.filter((b) => b.is_l1).length, 1);
    const again = await runIngestion(ctx.db, opts(fakeClient({ results: [result] }), { kind: 'results' }));
    assert.equal(again.skipped, 1);
  });
});

describe('ingestion admin API', () => {
  let ctx, platform, subscriber, client;
  before(async () => {
    client = fakeClient({ tenders: [tenderDto({ authority: 'Sugar Federation', tender_summary: 'Boiler overhaul' })] });
    ctx = await makeContext({ client });
    const org = await createOrg(ctx.db, { name: 'Client' });
    await createUser(ctx.db, { orgId: org, email: 'sub@client.test' });
    platform = await signIn(ctx.app, 'admin@test.local');
    subscriber = await signIn(ctx.app, 'sub@client.test');
  });
  after(() => ctx.close());

  it('is for platform administrators only', async () => {
    assert.equal((await subscriber.get('/admin/ingestion/status')).status, 403);
    assert.equal((await subscriber.post('/admin/ingestion/run').send({ kind: 'tenders' })).status, 403);
    assert.equal((await platform.get('/admin/ingestion/status')).status, 200);
  });

  it('reports status without ever exposing the API key', async () => {
    const res = await platform.get('/admin/ingestion/status');
    assert.equal(res.body.tenderbook.configured, true);
    assert.doesNotMatch(JSON.stringify(res.body), /test-key-not-real/);
  });

  it('runs a manual sync with the injected client and audits it', async () => {
    const res = await platform.post('/admin/ingestion/run').send({ kind: 'tenders' });
    assert.equal(res.status, 200);
    assert.equal(res.body.result.inserted, 1);
    const status = await platform.get('/admin/ingestion/status');
    assert.equal(status.body.counts.tenders, 1);
    assert.equal(status.body.tenderbook.lastTenders.status, 'success');
    const audit = await platform.get('/admin/audit?limit=20');
    assert.ok(audit.body.events.some((e) => e.action === 'ingestion.run'));
  });

  it('lets an administrator map a queued department and fixes the tenders already stored', async () => {
    const list = await platform.get('/admin/ingestion/suggestions');
    const suggestion = list.body.suggestions.find((s) => s.raw_value === 'Sugar Federation');
    assert.ok(suggestion);
    const mapped = await platform.post(`/admin/ingestion/suggestions/${suggestion.id}/map`).send({ create: { name: 'Sugar Federation of India' } });
    assert.equal(mapped.status, 200);
    assert.equal(mapped.body.tendersUpdated, 1);
    const tender = await ctx.db.withContext(SYSTEM, (q) => q.one(`SELECT department, department_id FROM tenders WHERE title = 'Boiler overhaul'`));
    assert.equal(tender.department, 'Sugar Federation of India');
    assert.ok(tender.department_id);
    assert.equal((await platform.post(`/admin/ingestion/suggestions/${suggestion.id}/map`).send({ create: { name: 'Again' } })).status, 404, 'already handled');

    // The alias was learned, so the next feed maps it automatically.
    const next = fakeClient({ tenders: [tenderDto({ authority: 'Sugar Federation', tender_summary: 'Second boiler job' })] });
    await runIngestion(ctx.db, { client: next, pageDelayMs: 0, trigger: 'manual' });
    const second = await ctx.db.withContext(SYSTEM, (q) => q.one(`SELECT department_id FROM tenders WHERE title = 'Second boiler job'`));
    assert.ok(second.department_id);
    assert.equal((await platform.get('/admin/ingestion/suggestions')).body.suggestions.length, 0);
  });

  it('starts a back-fill in the background', async () => {
    const res = await platform.post('/admin/ingestion/backfill').send({ kind: 'tenders', from: '2026-01-01', to: '2026-06-30' });
    assert.equal(res.status, 202);
    assert.equal((await platform.post('/admin/ingestion/backfill').send({ kind: 'tenders', from: '2026-06-30', to: '2026-01-01' })).status, 400);
    await new Promise((r) => setTimeout(r, 300));
  });
});

describe('Excel upload', () => {
  let ctx, platform;
  before(async () => { ctx = await makeContext(); platform = await signIn(ctx.app, 'admin@test.local'); });
  after(() => ctx.close());

  async function workbook(headers, rows) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow(headers);
    rows.forEach((r) => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const upload = (buffer, fields = {}, name = 'tenders.xlsx') => {
    let req = platform.post('/admin/ingestion/excel');
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', buffer, name);
  };
  const HEAD = ['Tender ID *', 'Title *', 'Department', 'State', 'Estimated value (INR)', 'Submission deadline *', 'BOQ items (separate with ;)'];

  it('serves a template whose headings the importer accepts', async () => {
    const res = await platform.get('/admin/ingestion/templates/tenders.xlsx').buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    assert.equal(res.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Data', 'Example', 'Read me']);
    assert.equal(wb.getWorksheet('Data').actualRowCount, 1, 'the Data sheet holds headings only');
    const dry = await upload(Buffer.from(await wb.xlsx.writeBuffer()), { kind: 'tenders', dryRun: 'true' });
    assert.equal(dry.status, 200);
    assert.equal(dry.body.result.total, 0);
  });

  it('imports good rows, reports bad rows by number, and tidies free text', async () => {
    const buffer = await workbook(HEAD, [
      ['X-1', 'Supply of water meters', 'Public Works Department', 'Madhya Pradesh', '₹ 12,50,000', '20/12/2026', 'Flow sensor; Ultrasonic meter'],
      ['X-2', '', 'Public Works Department', 'Madhya Pradesh', 100, '20/12/2026', null],
      ['X-3', 'Bad date row', null, null, null, '31/31/2026', null],
      ['X-4', 'Bad amount row', null, null, 'lots', '20/12/2026', null],
      ['X-1', 'Duplicate id', null, null, null, '20/12/2026', null],
      ['X-5', 'No value published', null, 'Gujarat', 'NA', new Date(Date.UTC(2026, 11, 25)), null],
    ]);
    const res = await upload(buffer, { kind: 'tenders' });
    assert.equal(res.status, 200);
    const { result } = res.body;
    assert.equal(result.total, 6);
    assert.equal(result.inserted, 2);
    assert.deepEqual(result.errors.map((e) => e.row), [3, 4, 5, 6]);
    assert.match(result.errors[0].messages.join(), /Title is required/);
    assert.match(result.errors[1].messages.join(), /not a valid date/);
    assert.match(result.errors[2].messages.join(), /not a valid amount/);
    assert.match(result.errors[3].messages.join(), /Duplicate ID "X-1"/);

    const rows = await ctx.db.withContext(SYSTEM, (q) => q.many(`SELECT source_id, estimated_value, boq_text, state_id FROM tenders ORDER BY source_id`));
    assert.equal(rows.length, 2);
    assert.equal(Number(rows[0].estimated_value), 1_250_000);
    assert.equal(rows[0].boq_text, 'Flow sensor Ultrasonic meter');
    assert.equal(rows[1].estimated_value, null, '"NA" stays empty rather than becoming 0');
  });

  it('is safe to upload again: unchanged rows are skipped, changed rows update', async () => {
    const same = await workbook(HEAD, [['X-1', 'Supply of water meters', 'Public Works Department', 'Madhya Pradesh', '₹ 12,50,000', '20/12/2026', 'Flow sensor; Ultrasonic meter']]);
    assert.equal((await upload(same, { kind: 'tenders' })).body.result.skipped, 1);
    const changed = await workbook(HEAD, [['X-1', 'Supply of water meters (revised)', 'Public Works Department', 'Madhya Pradesh', '₹ 12,50,000', '20/12/2026', null]]);
    const res = await upload(changed, { kind: 'tenders' });
    assert.equal(res.body.result.updated, 1);
  });

  it('previews without saving when asked for a dry run', async () => {
    const before = (await ctx.db.withContext(SYSTEM, (q) => q.one('SELECT count(*)::int AS n FROM tenders'))).n;
    const buffer = await workbook(HEAD, [['DRY-1', 'Would be new', null, null, null, '20/12/2026', null]]);
    const res = await upload(buffer, { kind: 'tenders', dryRun: 'true' });
    assert.equal(res.body.result.valid, 1);
    assert.equal(res.body.result.inserted, 0);
    assert.equal((await ctx.db.withContext(SYSTEM, (q) => q.one('SELECT count(*)::int AS n FROM tenders'))).n, before);
  });

  it('imports results with L1/L2 and shows the rate as unpublished when absent', async () => {
    const head = ['Result ID *', 'Tender title *', 'Department', 'L1 bidder', 'L1 amount (INR)', 'L2 bidder', 'L2 amount (INR)', 'Bidders', 'Award date'];
    const buffer = await workbook(head, [
      ['R-1', 'Hospital block', 'Public Works Department', 'Apex Infra', 44200000, 'Gupta Constructions', 45100000, 6, '15/12/2026'],
      ['R-2', 'Road repair', 'Public Works Department', 'Solo Co', null, null, null, 1, '16/12/2026'],
    ]);
    const res = await upload(buffer, { kind: 'results' }, 'results.xlsx');
    assert.equal(res.body.result.inserted, 2);
    const rows = await ctx.db.withContext(SYSTEM, (q) => q.many(`SELECT source_id, rate_status, l1_amount, winner_name FROM historical_awards ORDER BY source_id`));
    assert.deepEqual(rows.map((r) => [r.source_id, r.rate_status, r.l1_amount === null ? null : Number(r.l1_amount), r.winner_name]), [
      ['R-1', 'present', 44200000, 'Apex Infra'], ['R-2', 'not_published', null, 'Solo Co'],
    ]);
  });

  it('rejects wrong files, wrong types and missing required columns', async () => {
    assert.equal((await upload(Buffer.from('a,b,c'), { kind: 'tenders' }, 'data.csv')).status, 400);
    assert.equal((await upload(Buffer.from('not really a workbook'), { kind: 'tenders' })).status, 400);
    const noTitle = await workbook(['Tender ID *', 'Submission deadline *'], [['A', '01/01/2027']]);
    const res = await upload(noTitle, { kind: 'tenders' });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /Missing required column\(s\): Title/);
    assert.equal((await upload(noTitle, { kind: 'banana' })).status, 400);
    assert.equal((await platform.post('/admin/ingestion/excel').field('kind', 'tenders')).status, 400, 'no file');
  });
});
