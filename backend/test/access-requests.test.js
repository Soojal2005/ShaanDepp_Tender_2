import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SYSTEM, anon, createOrg, createUser, latestEmailToken, makeContext, signIn } from './helpers.js';

const request = {
  name: 'Meena Joshi',
  company: 'Joshi Infra Works',
  email: 'meena@joshi.test',
  phone: '+91 98260 11111',
  service: 'Portal access request',
  kind: 'access_request',
  message: 'Road contractor bidding in MP and Rajasthan, 3 users.',
  consent: true,
};

describe('portal access requests', () => {
  let ctx, platform, manager, subscriber, requestId;
  before(async () => {
    ctx = await makeContext();
    const client = await createOrg(ctx.db, { name: 'Existing Client' });
    await createUser(ctx.db, { orgId: client, email: 'sub@client.test' });
    await createUser(ctx.db, { orgId: ctx.staffOrgId, email: 'cm@staff.test', role: 'case_manager' });
    platform = await signIn(ctx.app, 'admin@test.local');
    manager = await signIn(ctx.app, 'cm@staff.test');
    subscriber = await signIn(ctx.app, 'sub@client.test');
  });
  after(() => ctx.close());

  it('stores a request apart from general enquiries and queues a notice for the team', async () => {
    assert.equal((await anon(ctx.app).post('/public/enquiries').send(request)).status, 201);
    assert.equal((await anon(ctx.app).post('/public/enquiries').send({ ...request, kind: undefined, email: 'general@joshi.test', company: 'General Co' })).status, 201);

    const queued = await ctx.db.withContext(SYSTEM, (q) => q.many(`SELECT recipient, subject FROM email_queue WHERE kind = 'ops_alert'`));
    assert.equal(queued.length, 1, 'only the access request triggers a staff notice');
    assert.match(queued[0].subject, /Joshi Infra Works/);

    const access = (await platform.get('/admin/enquiries?kind=access_request')).body.enquiries;
    assert.equal(access.length, 1);
    assert.equal(access[0].kind, 'access_request');
    assert.equal(access[0].status, 'New');
    requestId = access[0].id;
    const general = (await platform.get('/admin/enquiries?kind=general')).body.enquiries;
    assert.deepEqual(general.map((e) => e.company), ['General Co']);
  });

  it('rejects an unknown kind', async () => {
    assert.equal((await anon(ctx.app).post('/public/enquiries').send({ ...request, kind: 'free_account' })).status, 400);
  });

  it('counts new items per queue for the staff navigation, and keeps clients out', async () => {
    const summary = await platform.get('/admin/enquiries/summary');
    assert.equal(summary.status, 200);
    assert.deepEqual(summary.body, { newAccessRequests: 1, newGeneral: 1 });
    assert.equal((await manager.get('/admin/enquiries/summary')).status, 200);
    assert.equal((await subscriber.get('/admin/enquiries/summary')).status, 403);
    assert.equal((await anon(ctx.app).get('/admin/enquiries/summary')).status, 401);
  });

  it('shows follow-up notes with who wrote them', async () => {
    assert.equal((await manager.patch(`/admin/enquiries/${requestId}`).send({ status: 'Qualified', note: 'Spoke to Meena, wants Premium' })).status, 204);
    const [row] = (await manager.get('/admin/enquiries?kind=access_request')).body.enquiries;
    assert.equal(row.status, 'Qualified');
    assert.equal(row.followups.length, 1);
    assert.equal(row.followups[0].notes, 'Spoke to Meena, wants Premium');
    assert.ok(row.followups[0].author);
  });

  it('lets only an administrator turn a request into an organization', async () => {
    const body = { name: 'Joshi Infra Works', planCode: 'standard', admin: { name: 'Meena Joshi', email: 'meena@joshi.test' }, fromEnquiryId: requestId };
    assert.equal((await manager.post('/admin/organizations').send(body)).status, 403);

    const res = await platform.post('/admin/organizations').send(body);
    assert.equal(res.status, 201);
    assert.ok(await latestEmailToken(ctx.db, 'meena@joshi.test'), 'the first administrator is invited');

    const [row] = (await platform.get('/admin/enquiries?kind=access_request')).body.enquiries;
    assert.equal(row.status, 'Converted');
    assert.equal(row.organization_id, res.body.organization.id);
    assert.equal(row.organization_name, 'Joshi Infra Works');
    assert.ok(row.converted_at);
    assert.equal((await platform.get('/admin/enquiries?status=Converted')).body.enquiries.length, 1);
    assert.equal((await platform.get('/admin/enquiries/summary')).body.newAccessRequests, 0);
  });

  it('does not create a second organization from the same request, and keeps the converted status', async () => {
    const before = (await ctx.db.withContext(SYSTEM, (q) => q.one('SELECT count(*)::int AS n FROM organizations'))).n;
    const again = await platform.post('/admin/organizations').send({
      name: 'Joshi Again', planCode: 'standard', admin: { name: 'Meena', email: 'again@joshi.test' }, fromEnquiryId: requestId,
    });
    assert.equal(again.status, 409);
    const after = (await ctx.db.withContext(SYSTEM, (q) => q.one('SELECT count(*)::int AS n FROM organizations'))).n;
    assert.equal(after, before, 'the failed conversion leaves no organization behind');
    assert.equal((await platform.patch(`/admin/enquiries/${requestId}`).send({ status: 'New' })).status, 409);
  });

  it('refuses to convert a request that does not exist, without creating anything', async () => {
    const before = (await ctx.db.withContext(SYSTEM, (q) => q.one('SELECT count(*)::int AS n FROM organizations'))).n;
    const res = await platform.post('/admin/organizations').send({
      name: 'Ghost Co', planCode: 'standard', admin: { name: 'G', email: 'ghost@ghost.test' }, fromEnquiryId: 99999,
    });
    assert.equal(res.status, 404);
    const after = (await ctx.db.withContext(SYSTEM, (q) => q.one('SELECT count(*)::int AS n FROM organizations'))).n;
    assert.equal(after, before);
  });
});
