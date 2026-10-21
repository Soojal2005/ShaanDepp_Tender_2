import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { queueCaseReminders } from '../src/services/caseReminders.js';
import { DAY, SYSTEM, createOrg, createUser, makeContext, seedResults, seedTenders, signIn, resultDto, tenderDto } from './helpers.js';

const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

describe('submission desk', () => {
  let ctx, orgA, orgB, tenderIds;
  let owner, member, outsider, manager, analyst, admin;
  const run = (fn) => ctx.db.withContext(SYSTEM, fn);

  before(async () => {
    ctx = await makeContext();
    orgA = await createOrg(ctx.db, { name: 'Roads Co' });
    orgB = await createOrg(ctx.db, { name: 'Other Co' });
    await createUser(ctx.db, { orgId: orgA, email: 'owner@a.test', role: 'tenant_admin', name: 'Owner A' });
    await createUser(ctx.db, { orgId: orgA, email: 'member@a.test', role: 'subscriber', name: 'Member A' });
    await createUser(ctx.db, { orgId: orgB, email: 'owner@b.test', role: 'tenant_admin' });
    await createUser(ctx.db, { orgId: ctx.staffOrgId, email: 'manager@s.test', role: 'case_manager', name: 'Meera Manager' });
    await createUser(ctx.db, { orgId: ctx.staffOrgId, email: 'analyst@s.test', role: 'analyst', name: 'Anil Analyst' });
    [owner, member, outsider, manager, analyst, admin] = await Promise.all(
      ['owner@a.test', 'member@a.test', 'owner@b.test', 'manager@s.test', 'analyst@s.test', 'admin@test.local'].map((e) => signIn(ctx.app, e)));
    tenderIds = await seedTenders(ctx.db, [
      tenderDto({ tender_summary: 'Widening of state highway', dueInDays: 2 }),
      tenderDto({ tender_summary: 'Supply of water meters', dueInDays: 30 }),
      tenderDto({ tender_summary: 'Hospital building', dueInDays: 30 }),
    ]);
  });
  after(() => ctx.close());

  const raise = async (client, body) => client.post('/cases').send(body);

  describe('raising a request', () => {
    it('opens a case from a tender, filling what the tender already says, with the standard checklists', async () => {
      const res = await raise(owner, { tenderId: tenderIds[0], note: 'Please check our turnover' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.match(res.body.ref, /^CASE-\d{5}$/);
      const detail = await owner.get(`/cases/${res.body.id}`);
      const c = detail.body.case;
      assert.equal(c.title, 'Widening of state highway');
      assert.equal(c.client, 'Roads Co');
      assert.equal(c.stage, 'intake');
      assert.equal(c.requestNote, 'Please check our turnover');
      assert.ok(c.deadline, 'deadline is taken from the tender');
      assert.equal(c.estimatedValue, 5_000_000);
      assert.equal(c.emdAmount, 100_000);
      assert.equal(c.checklists.eligibility.length, 6);
      assert.equal(c.checklists.technical.length, 6);
      assert.equal(c.timeline.length, 1);
    });

    it('refuses a second open request for the same tender, but another client may raise one', async () => {
      const dup = await raise(member, { tenderId: tenderIds[0] });
      assert.equal(dup.status, 409);
      assert.ok(dup.body.error.details.caseId);
      const other = await raise(outsider, { tenderId: tenderIds[0] });
      assert.equal(other.status, 201);
    });

    it('lets a client ask for a tender that is not in the feed, but needs a title', async () => {
      assert.equal((await raise(owner, {})).status, 400);
      assert.equal((await raise(owner, { title: 'ab' })).status, 400);
      assert.equal((await raise(owner, { title: 'Municipal drain cleaning, Ward 12' })).status, 201);
      assert.equal((await raise(owner, { tenderId: 999999 })).status, 404);
    });

    it('tells the case managers by email', async () => {
      const mail = await run((q) => q.many(`SELECT recipient, subject FROM email_queue WHERE kind = 'case_notice'`));
      assert.ok(mail.some((m) => m.recipient === 'manager@s.test' && m.subject.includes('Widening of state highway')));
    });

    it('does not take the organization from the request body for a client', async () => {
      const res = await raise(owner, { title: 'Tender for another firm', orgId: orgB });
      assert.equal(res.status, 201);
      const row = await run((q) => q.one('SELECT organization_id FROM submission_cases WHERE id = $1', [res.body.id]));
      assert.equal(row.organization_id, orgA);
    });

    it('a staff member raises one on a client\'s behalf only when naming the client', async () => {
      assert.equal((await raise(manager, { title: 'Phone request from a client' })).status, 400);
      const res = await raise(manager, { title: 'Phone request from a client', orgId: orgB });
      assert.equal(res.status, 201);
      const row = await run((q) => q.one('SELECT organization_id FROM submission_cases WHERE id = $1', [res.body.id]));
      assert.equal(row.organization_id, orgB);
    });
  });

  describe('who sees what', () => {
    let caseId;
    before(async () => {
      caseId = (await raise(owner, { tenderId: tenderIds[1] })).body.id;
      await manager.put(`/cases/${caseId}/internal`).send({ financialStrategy: 'Quote 6% below estimate', marginNotes: 'Margin 11%' });
      await manager.post(`/cases/${caseId}/notes`).send({ text: 'Client is slow with documents' });
    });

    it('a client never receives internal strategy, notes or the activity log', async () => {
      const res = await owner.get(`/cases/${caseId}`);
      assert.equal(res.status, 200);
      const body = JSON.stringify(res.body);
      assert.ok(!body.includes('Quote 6% below'));
      assert.ok(!body.includes('Margin 11%'));
      assert.ok(!body.includes('slow with documents'));
      for (const key of ['internal', 'notes', 'activity']) assert.equal(res.body.case[key], undefined, key);
    });

    it('staff do receive it', async () => {
      const res = await analyst.get(`/cases/${caseId}`);
      assert.equal(res.body.case.internal.financialStrategy, 'Quote 6% below estimate');
      assert.equal(res.body.case.notes[0].text, 'Client is slow with documents');
      assert.ok(res.body.case.activity.length >= 3);
    });

    it('the database itself hides internal tables from a client, whatever the API does', async () => {
      const seen = await ctx.db.withContext({ scope: 'tenant', orgId: orgA, userId: 1 }, async (q) => ({
        internal: (await q.many('SELECT * FROM case_internal')).length,
        notes: (await q.many('SELECT * FROM case_analyst_notes')).length,
        log: (await q.many('SELECT * FROM case_activity_logs')).length,
        cases: (await q.many('SELECT organization_id FROM submission_cases')).map((r) => r.organization_id),
      }));
      assert.deepEqual({ internal: seen.internal, notes: seen.notes, log: seen.log }, { internal: 0, notes: 0, log: 0 });
      assert.ok(seen.cases.length > 0 && seen.cases.every((o) => o === orgA));
    });

    it('another client cannot open the case or list it', async () => {
      assert.equal((await outsider.get(`/cases/${caseId}`)).status, 404);
      const list = await outsider.get('/cases');
      assert.ok(list.body.cases.every((c) => c.client === 'Other Co'));
      assert.ok(!list.body.cases.some((c) => c.id === caseId));
    });

    it('clients cannot reach any staff action', async () => {
      const attempts = [
        owner.patch(`/cases/${caseId}`).send({ clientSummary: 'x' }),
        owner.post(`/cases/${caseId}/stage`).send({ stage: 'closed' }),
        owner.post(`/cases/${caseId}/assign`).send({ userId: 1 }),
        owner.put(`/cases/${caseId}/internal`).send({ marginNotes: 'x' }),
        owner.post(`/cases/${caseId}/notes`).send({ text: 'x' }),
        owner.post(`/cases/${caseId}/rate-analysis`),
        owner.get('/cases/summary'),
        owner.get('/cases/team'),
      ];
      for (const res of await Promise.all(attempts)) assert.equal(res.status, 403);
    });

    it('requires a signed-in user', async () => {
      const { anon } = await import('./helpers.js');
      assert.equal((await anon(ctx.app).get('/cases')).status, 401);
    });
  });

  describe('working a case', () => {
    let caseId;
    before(async () => { caseId = (await raise(owner, { tenderId: tenderIds[2] })).body.id; });
    const detail = async (client = manager) => (await client.get(`/cases/${caseId}`)).body.case;

    it('only a case manager or admin may assign; the assignee must be a team member', async () => {
      assert.equal((await analyst.post(`/cases/${caseId}/assign`).send({ userId: 1 })).status, 403);
      const team = (await manager.get('/cases/team')).body.team;
      const anil = team.find((p) => p.name === 'Anil Analyst');
      assert.equal((await manager.post(`/cases/${caseId}/assign`).send({ userId: anil.id })).status, 200);
      assert.equal((await detail()).assignedName, 'Anil Analyst');
      const clientUser = await run((q) => q.one(`SELECT id FROM users WHERE email = 'owner@a.test'`));
      assert.equal((await manager.post(`/cases/${caseId}/assign`).send({ userId: clientUser.id })).status, 400, 'a client is not assignable');
      assert.equal((await manager.post(`/cases/${caseId}/assign`).send({ userId: anil.id })).status, 200);
    });

    it('moves through the stages, records each, and tells the client', async () => {
      assert.equal((await analyst.post(`/cases/${caseId}/stage`).send({ stage: 'detail_study' })).status, 200);
      await analyst.patch(`/cases/${caseId}`).send({ clientSummary: 'Works tender, 18 months, needs Class A contractor.' });
      assert.equal((await analyst.post(`/cases/${caseId}/stage`).send({ stage: 'nonsense' })).status, 400);
      const c = await detail(owner);
      assert.equal(c.stage, 'detail_study');
      assert.equal(c.summary, 'Works tender, 18 months, needs Class A contractor.');
      assert.deepEqual(c.timeline.map((t) => t.stage), ['intake', 'detail_study']);
      assert.ok(c.timeline[0].completedAt);
      const mail = await run((q) => q.many(`SELECT recipient FROM email_queue WHERE kind = 'case_notice' AND subject LIKE 'Update on your submission request%'`));
      assert.ok(mail.some((m) => m.recipient === 'owner@a.test'), 'the account admin is told');
    });

    it('ticks the eligibility checklist and lets the team add their own checks', async () => {
      const c = await detail();
      const first = c.checklists.eligibility[0];
      assert.equal((await analyst.patch(`/cases/${caseId}/checklist/${first.id}`).send({ status: 'pass', note: 'GST valid till 2028' })).status, 200);
      assert.equal((await analyst.patch(`/cases/${caseId}/checklist/${c.checklists.eligibility[1].id}`).send({ status: 'bogus' })).status, 400);
      const added = await analyst.post(`/cases/${caseId}/checklist`).send({ kind: 'eligibility', label: 'ISO 9001 certificate' });
      assert.equal(added.status, 200);
      const after = await detail(owner);
      assert.equal(after.checklists.eligibility[0].status, 'pass');
      assert.equal(after.checklists.eligibility[0].note, 'GST valid till 2028');
      assert.ok(after.checklists.eligibility.some((i) => i.label === 'ISO 9001 certificate'));
      assert.equal((await analyst.delete(`/cases/${caseId}/checklist/${added.body.id}`)).status, 200);
      assert.equal((await analyst.patch(`/cases/${caseId}/checklist/999999`).send({ status: 'pass' })).status, 404);
    });

    it('attaches the department\'s historical rate band to the staff view only', async () => {
      await seedResults(ctx.db, Array.from({ length: 6 }, (_, i) => resultDto({ contract_value: 4_000_000 + i * 100_000, bidder_list: [{ bidder_name: `firm ${i}`, rank: 1, bid_amount: 4_000_000 + i * 100_000, technical_bid_status: 1, aoc_status: 1 }] })));
      const res = await analyst.post(`/cases/${caseId}/rate-analysis`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const staff = await detail();
      assert.ok(staff.internal.rateAnalysis.takenAt);
      assert.ok(staff.internal.rateAnalysis.overall.awards >= 6);
      assert.equal((await detail(owner)).internal, undefined);
    });

    it('records pre-bid queries and the department\'s answer, visible to the client', async () => {
      const raised = await analyst.post(`/cases/${caseId}/prebid`).send({ query: 'Is a JV allowed for this tender?' });
      assert.equal(raised.status, 200);
      await analyst.patch(`/cases/${caseId}/prebid/${raised.body.id}`).send({ response: 'JV allowed up to two partners.' });
      const c = await detail(owner);
      assert.equal(c.prebid[0].query, 'Is a JV allowed for this tender?');
      assert.equal(c.prebid[0].response, 'JV allowed up to two partners.');
      assert.equal((await analyst.patch(`/cases/${caseId}/prebid/999999`).send({ response: 'x' })).status, 404);
    });

    it('records the EMD instrument', async () => {
      assert.equal((await analyst.post(`/cases/${caseId}/emd`).send({ instrumentType: 'Cheque' })).status, 400);
      assert.equal((await analyst.post(`/cases/${caseId}/emd`).send({ instrumentType: 'Bank Guarantee', issuingBank: 'SBI', instrumentNumber: 'BG-778', amount: 100000, validTill: '2027-03-31' })).status, 200);
      const emd = (await detail(owner)).emd[0];
      assert.deepEqual([emd.instrumentType, emd.amount, emd.validTill, emd.refundStatus], ['Bank Guarantee', 100000, '2027-03-31', 'Pending']);
    });

    it('requires the right reference for online and offline submissions', async () => {
      assert.equal((await analyst.put(`/cases/${caseId}/submission`).send({ mode: 'online' })).status, 400);
      assert.equal((await analyst.put(`/cases/${caseId}/submission`).send({ mode: 'offline', courierName: 'India Post' })).status, 400);
      assert.equal((await analyst.put(`/cases/${caseId}/submission`).send({ mode: 'offline', courierName: 'India Post', trackingNumber: 'EE123456789IN' })).status, 200);
      assert.equal((await detail(owner)).submission.trackingNumber, 'EE123456789IN');
      assert.equal((await analyst.put(`/cases/${caseId}/submission`).send({ mode: 'online', portalReference: 'MPT-2026-5521' })).status, 200);
      const s = (await detail(owner)).submission;
      assert.deepEqual([s.mode, s.portalReference, s.trackingNumber], ['online', 'MPT-2026-5521', null]);
    });

    it('will not close or follow up until a result is on record', async () => {
      assert.equal((await analyst.post(`/cases/${caseId}/stage`).send({ stage: 'follow_up' })).status, 400);
      assert.equal((await analyst.post(`/cases/${caseId}/stage`).send({ stage: 'closed' })).status, 400);
    });

    it('losing creates an EMD refund follow-up; the case can then be closed', async () => {
      const res = await analyst.put(`/cases/${caseId}/result`).send({ technicalStatus: 'qualified', financialStatus: 'evaluated', outcome: 'not_l1', ourAmount: 5_100_000, l1Amount: 4_900_000, resultDate: '2026-11-02' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      let c = await detail(owner);
      assert.equal(c.outcome, 'not_l1');
      assert.deepEqual(c.followups.map((f) => f.kind), ['emd_refund']);
      // Saving the result again must not duplicate the follow-up.
      await analyst.put(`/cases/${caseId}/result`).send({ outcome: 'not_l1', ourAmount: 5_100_000, l1Amount: 4_900_000 });
      assert.equal((await detail(owner)).followups.length, 1);
      assert.equal((await analyst.post(`/cases/${caseId}/stage`).send({ stage: 'follow_up' })).status, 200);
      const f = c.followups[0];
      assert.equal((await analyst.patch(`/cases/${caseId}/followups/${f.id}`).send({ status: 'done', reference: 'NEFT-9981' })).status, 200);
      assert.equal((await analyst.post(`/cases/${caseId}/stage`).send({ stage: 'closed' })).status, 200);
      c = await detail(owner);
      assert.equal(c.stage, 'closed');
      assert.ok(c.closedAt);
      assert.equal(c.followups[0].status, 'done');
    });

    it('an analyst cannot reopen a closed case; a case manager can, and a new request for the tender is then refused', async () => {
      assert.equal((await analyst.post(`/cases/${caseId}/stage`).send({ stage: 'follow_up' })).status, 403);
      assert.equal((await manager.post(`/cases/${caseId}/stage`).send({ stage: 'follow_up' })).status, 200);
      assert.equal((await raise(owner, { tenderId: tenderIds[2] })).status, 409);
    });

    it('winning creates the purchase-order and payment follow-ups', async () => {
      const id2 = (await raise(owner, { title: 'Culvert repair, NH-46' })).body.id;
      await analyst.put(`/cases/${id2}/result`).send({ outcome: 'l1', ourAmount: 1_000_000, l1Amount: 1_000_000 });
      const kinds = (await owner.get(`/cases/${id2}`)).body.case.followups.map((f) => f.kind);
      assert.deepEqual(kinds, ['purchase_order', 'payment']);
    });

    it('cancelling needs no result and can then be closed', async () => {
      const id3 = (await raise(owner, { title: 'Withdrawn enquiry' })).body.id;
      assert.equal((await analyst.patch(`/cases/${id3}`).send({ outcome: 'l1' })).status, 400, 'winning is recorded with the result');
      assert.equal((await analyst.patch(`/cases/${id3}`).send({ outcome: 'cancelled' })).status, 200);
      assert.equal((await analyst.post(`/cases/${id3}/stage`).send({ stage: 'closed' })).status, 200);
    });
  });

  describe('document vault', () => {
    let caseId;
    before(async () => { caseId = (await raise(owner, { title: 'Vault test tender' })).body.id; });
    const upload = (client, name, buffer, fields = {}) => {
      let req = client.post(`/cases/${caseId}/documents`);
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      return req.attach('file', buffer, name);
    };
    const docs = async (client) => (await client.get(`/cases/${caseId}`)).body.case.documents;

    it('staff documents are internal by default; the client sees none of them', async () => {
      const res = await upload(manager, 'strategy.pdf', PDF, { slot: 'technical_bid' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal((await docs(manager)).length, 1);
      assert.equal((await docs(owner)).length, 0);
      const dl = await owner.get(`/cases/${caseId}/documents/${res.body.id}/file`);
      assert.equal(dl.status, 404, 'an internal document cannot be fetched by id either');
    });

    it('sharing a document lets the client download exactly what was uploaded', async () => {
      const res = await upload(manager, 'compliance.pdf', PDF, { slot: 'compliance_checklist', visibility: 'shared' });
      assert.equal((await docs(owner)).map((d) => d.name).join(), 'compliance.pdf');
      const dl = await owner.get(`/cases/${caseId}/documents/${res.body.id}/file`).buffer(true).parse(binary);
      assert.equal(dl.status, 200);
      assert.ok(dl.body.equals(PDF));
      assert.match(dl.headers['content-disposition'], /^attachment/);
      assert.equal(dl.headers['content-type'], 'application/pdf');
      assert.equal(dl.headers['x-content-type-options'], 'nosniff');
    });

    it('another client cannot download it', async () => {
      const shared = (await docs(owner))[0];
      assert.equal((await outsider.get(`/cases/${caseId}/documents/${shared.id}/file`)).status, 404);
    });

    it('a client may add a shared document, but only in the slots meant for clients', async () => {
      assert.equal((await upload(owner, 'nit.pdf', PDF, { slot: 'tender_document' })).status, 201);
      assert.equal((await upload(owner, 'x.pdf', PDF, { slot: 'technical_bid' })).status, 400);
      const spoof = await upload(owner, 'sneaky.pdf', PDF, { slot: 'other', visibility: 'internal_only' });
      assert.equal(spoof.status, 201);
      const list = await docs(owner);
      assert.ok(list.find((d) => d.name === 'sneaky.pdf').visibility === 'shared', 'a client cannot make a document internal');
      assert.equal((await upload(outsider, 'nit.pdf', PDF, { slot: 'other' })).status, 404, 'nor upload to someone else\'s case');
    });

    it('rejects files that are not what their name says, are of unknown types, or are empty', async () => {
      assert.equal((await upload(manager, 'fake.pdf', Buffer.from('this is plain text'))).status, 400);
      assert.equal((await upload(manager, 'run.exe', Buffer.from('MZ\x90\x00'))).status, 400);
      assert.equal((await upload(manager, 'page.html', Buffer.from('<script>alert(1)</script>'))).status, 400);
      assert.equal((await upload(manager, 'empty.pdf', Buffer.alloc(0))).status, 400);
      assert.equal((await manager.post(`/cases/${caseId}/documents`)).status, 400, 'no file at all');
    });

    it('stores a hostile file name safely', async () => {
      const res = await upload(manager, '../../etc/passwd.pdf', PDF);
      assert.equal(res.status, 201);
      const row = await run((q) => q.one('SELECT name, storage_key FROM case_documents WHERE id = $1', [res.body.id]));
      assert.equal(row.name, 'passwd.pdf');
      assert.ok(row.storage_key.startsWith(`cases/${caseId}/`) && !row.storage_key.includes('..'));
    });

    it('staff can withdraw a shared document from the client, and delete one', async () => {
      const shared = (await docs(owner)).find((d) => d.name === 'compliance.pdf');
      assert.equal((await manager.patch(`/cases/${caseId}/documents/${shared.id}`).send({ visibility: 'internal_only' })).status, 200);
      assert.ok(!(await docs(owner)).some((d) => d.id === shared.id));
      assert.equal((await owner.get(`/cases/${caseId}/documents/${shared.id}/file`)).status, 404);
      assert.equal((await owner.delete(`/cases/${caseId}/documents/${shared.id}`)).status, 403);
      assert.equal((await manager.delete(`/cases/${caseId}/documents/${shared.id}`)).status, 200);
      assert.equal((await manager.get(`/cases/${caseId}/documents/${shared.id}/file`)).status, 404);
    });

    it('refuses uploads once the case is closed', async () => {
      const closedId = (await raise(owner, { title: 'Closed case' })).body.id;
      await manager.patch(`/cases/${closedId}`).send({ outcome: 'cancelled' });
      await manager.post(`/cases/${closedId}/stage`).send({ stage: 'closed' });
      const res = await owner.post(`/cases/${closedId}/documents`).attach('file', PDF, 'late.pdf');
      assert.equal(res.status, 400);
    });
  });

  describe('desk dashboard', () => {
    it('counts open cases by stage, flags unassigned and at-risk ones, and totals EMD outstanding', async () => {
      const res = await admin.get('/cases/summary');
      assert.equal(res.status, 200);
      const d = res.body;
      assert.equal(d.stages.length, 9);
      assert.equal(d.stages.reduce((s, x) => s + x.count, 0), d.open);
      assert.ok(d.unassigned >= 1);
      assert.ok(d.atRisk.some((c) => c.title === 'Widening of state highway'), 'a tender due in 2 days with no submission is at risk');
      assert.ok(d.atRisk.every((c) => c.hoursToDeadline <= 72));
      assert.equal(d.emdOutstanding.amount, 100000);
      const roads = d.byClient.find((c) => c.label === 'Roads Co');
      assert.ok(roads.lost >= 1 && roads.won >= 1);
    });
  });

  describe('reminders', () => {
    it('warn the team once about a deadline within 72 hours, and once about an unassigned request', async () => {
      const now = new Date(Date.now() + 5 * 3_600_000);
      const first = await queueCaseReminders(ctx.db, { now, baseUrl: 'https://x.test' });
      assert.ok(first.reminders >= 1);
      const second = await queueCaseReminders(ctx.db, { now, baseUrl: 'https://x.test' });
      assert.equal(second.reminders, 0, 'nothing is sent twice');
      const mail = await run((q) => q.many(`SELECT recipient, subject FROM email_queue WHERE kind = 'case_notice' AND subject LIKE 'Deadline within%' OR subject LIKE 'Unassigned request%'`));
      assert.ok(mail.some((m) => m.subject.startsWith('Deadline within') && m.subject.includes('Widening of state highway')));
      assert.ok(mail.some((m) => m.subject.startsWith('Unassigned request') && m.recipient === 'manager@s.test'));
    });

    it('stop once the bid has been submitted', async () => {
      const open = await run((q) => q.one(`SELECT id FROM submission_cases WHERE tender_title = 'Widening of state highway' AND organization_id = $1`, [orgA]));
      await analyst.put(`/cases/${open.id}/submission`).send({ mode: 'online', portalReference: 'REF-1' });
      await run((q) => q.query(`DELETE FROM case_reminders WHERE case_id = $1`, [open.id]));
      const before = await run((q) => q.one('SELECT count(*)::int AS n FROM case_reminders WHERE case_id = $1', [open.id]));
      await queueCaseReminders(ctx.db, { now: new Date(Date.now() + 5 * 3_600_000), baseUrl: 'https://x.test' });
      const afterRun = await run((q) => q.many(`SELECT kind FROM case_reminders WHERE case_id = $1`, [open.id]));
      assert.equal(before.n, 0);
      assert.ok(!afterRun.some((r) => r.kind.startsWith('deadline')), 'no deadline reminder for a submitted bid');
    });
  });
});
