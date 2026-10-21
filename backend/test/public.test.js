import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SYSTEM, anon, createOrg, createUser, makeContext, signIn } from './helpers.js';

const valid = {
  name: 'Rajesh Singhania',
  company: 'Singhania Earthmovers',
  email: 'rajesh@singhania.test',
  phone: '+91 98201 54321',
  service: 'Tender Information & Bidding Support',
  message: 'Please call me about daily alerts.',
  consent: true,
};

describe('public website endpoints', () => {
  let ctx, platform, subscriber;
  before(async () => {
    ctx = await makeContext({ rateLimits: true });
    const org = await createOrg(ctx.db, { name: 'Client' });
    await createUser(ctx.db, { orgId: org, email: 'sub@client.test' });
    platform = await signIn(ctx.app, 'admin@test.local');
    subscriber = await signIn(ctx.app, 'sub@client.test');
  });
  after(() => ctx.close());

  it('stores a valid enquiry with the consent timestamp, without echoing it back', async () => {
    const res = await anon(ctx.app).post('/public/enquiries').send(valid);
    assert.equal(res.status, 201);
    assert.doesNotMatch(JSON.stringify(res.body), /rajesh/i);
    const row = await ctx.db.withContext(SYSTEM, (q) => q.one('SELECT * FROM enquiries'));
    assert.equal(row.email, 'rajesh@singhania.test');
    assert.ok(row.consent_timestamp);
    assert.equal(row.privacy_notice_version, 'v2026.1');
  });

  it('requires DPDP consent and a valid email', async () => {
    assert.equal((await anon(ctx.app).post('/public/enquiries').send({ ...valid, consent: false })).status, 400);
    const { consent, ...noConsent } = valid;
    assert.equal((await anon(ctx.app).post('/public/enquiries').send(noConsent)).status, 400);
    assert.equal((await anon(ctx.app).post('/public/enquiries').send({ ...valid, email: 'nope' })).status, 400);
  });

  it('silently drops bot submissions that fill the honeypot field', async () => {
    const before = (await ctx.db.withContext(SYSTEM, (q) => q.one('SELECT count(*)::int AS n FROM enquiries'))).n;
    const res = await anon(ctx.app).post('/public/enquiries').send({ ...valid, email: 'bot@spam.test', website: 'http://spam.test' });
    assert.equal(res.status, 201);
    const after = (await ctx.db.withContext(SYSTEM, (q) => q.one('SELECT count(*)::int AS n FROM enquiries'))).n;
    assert.equal(after, before);
  });

  it('rate limits enquiries to 5 per 15 minutes per address', async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await anon(ctx.app).post('/public/enquiries').send(valid)).status);
    // Calls so far: 1 valid + 3 invalid + 1 honeypot = 5, so the next ones are throttled.
    assert.ok(statuses.every((s) => s === 429), `expected throttling, got ${statuses}`);
  });

  it('exposes the enquiry inbox to staff only (it used to be public)', async () => {
    assert.equal((await anon(ctx.app).get('/admin/enquiries')).status, 401);
    assert.equal((await subscriber.get('/admin/enquiries')).status, 403);
    const res = await platform.get('/admin/enquiries');
    assert.equal(res.status, 200);
    assert.equal(res.body.enquiries.length, 1);
    assert.equal(res.body.enquiries[0].company, 'Singhania Earthmovers');
  });

  it('lets staff work an enquiry: status change and follow-up note', async () => {
    const [{ id }] = (await platform.get('/admin/enquiries')).body.enquiries;
    assert.equal((await platform.patch(`/admin/enquiries/${id}`).send({ status: 'Contacted', note: 'Called, will send proposal' })).status, 204);
    const list = await platform.get('/admin/enquiries?status=Contacted');
    assert.equal(list.body.enquiries.length, 1);
    assert.equal((await platform.patch(`/admin/enquiries/${id}`).send({})).status, 400);
  });

  it('publishes contact details and registration numbers for the website', async () => {
    const res = await anon(ctx.app).get('/public/site-config');
    assert.equal(res.status, 200);
    assert.equal(res.body.registration.gst, '23APSPT2592R1ZR');
    assert.equal(res.body.registration.business, 'BHOP260407SE000586');
  });

  it('answers health checks without revealing internals', async () => {
    const res = await anon(ctx.app).get('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ['status', 'time']);
  });

  it('returns JSON 404s for unknown API routes', async () => {
    for (const res of [await anon(ctx.app).get('/does-not-exist'), await subscriber.get('/does-not-exist')]) {
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'not_found');
    }
  });
});
