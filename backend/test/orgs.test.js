import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SYSTEM, createOrg, createUser, latestEmailToken, makeContext, signIn } from './helpers.js';

describe('organizations, members and seat limits', () => {
  let ctx, orgA, orgB, admin, sub, other, platform;

  before(async () => {
    ctx = await makeContext();
    orgA = await createOrg(ctx.db, { name: 'Org A', planCode: 'standard' });
    orgB = await createOrg(ctx.db, { name: 'Org B', planCode: 'basic' });
    await createUser(ctx.db, { orgId: orgA, email: 'admin@a.test', role: 'tenant_admin', name: 'A Admin' });
    await createUser(ctx.db, { orgId: orgA, email: 'sub@a.test', role: 'subscriber' });
    await createUser(ctx.db, { orgId: orgB, email: 'admin@b.test', role: 'tenant_admin', name: 'B Admin' });
    admin = await signIn(ctx.app, 'admin@a.test');
    sub = await signIn(ctx.app, 'sub@a.test');
    other = await signIn(ctx.app, 'admin@b.test');
    platform = await signIn(ctx.app, 'admin@test.local');
  });
  after(() => ctx.close());

  const invite = (client, n) => client.post('/org/members').send({ name: `Person ${n}`, email: `p${n}@a.test` });

  it('lets only an organization administrator invite members', async () => {
    assert.equal((await invite(sub, 0)).status, 403);
    assert.equal((await sub.get('/org/members')).status, 200, 'any member can see colleagues');
  });

  it('emails the invitee a link to set their password and lets them sign in', async () => {
    const res = await admin.post('/org/members').send({ name: 'New Joiner', email: 'Joiner@A.test', role: 'subscriber' });
    assert.equal(res.status, 201);
    assert.equal(res.body.member.email, 'joiner@a.test');
    const token = await latestEmailToken(ctx.db, 'joiner@a.test');
    assert.ok(token);
    const before = await signIn(ctx.app, 'joiner@a.test').catch((e) => e);
    assert.match(String(before), /login failed/, 'cannot sign in before choosing a password');

    const set = await (await import('supertest')).default(ctx.app).post('/api/v1/auth/reset-password').send({ token, password: 'Joiner-Pass-42' });
    assert.equal(set.status, 204);
    const c = await signIn(ctx.app, 'joiner@a.test', 'Joiner-Pass-42');
    assert.equal(c.user.orgId, orgA);
    await admin.patch(`/org/members/${res.body.member.id}`).send({ isActive: false });
  });

  it('enforces the 3-login limit and counts only active users', async () => {
    // Org A has: admin, sub, and the deactivated joiner => 2 active seats used.
    const info = await admin.get('/org');
    assert.equal(info.body.organization.seatsUsed, 2);
    assert.equal(info.body.organization.seatLimit, 3);

    assert.equal((await invite(admin, 1)).status, 201);
    const full = await invite(admin, 2);
    assert.equal(full.status, 409);
    assert.match(full.body.error.message, /Seat limit reached \(3 of 3/);
  });

  it('never lets simultaneous invitations exceed the seat limit', async () => {
    const org = await createOrg(ctx.db, { name: 'Race Org', planCode: 'standard' });
    await createUser(ctx.db, { orgId: org, email: 'lead@race.test', role: 'tenant_admin' });
    const lead = await signIn(ctx.app, 'lead@race.test');
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => lead.post('/org/members').send({ name: `R${i}`, email: `r${i}@race.test` }))
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 201, 409, 409, 409, 409]);
    const used = await ctx.db.withContext(SYSTEM, (q) => q.one(`SELECT count(*)::int AS n FROM users WHERE organization_id = $1 AND is_active`, [org]));
    assert.equal(used.n, 3);
  });

  it('applies a per-organization seat override', async () => {
    const res = await platform.patch(`/admin/organizations/${orgB}`).send({ seatLimitOverride: 5 });
    assert.equal(res.status, 200);
    assert.equal(res.body.organization.seatLimit, 5);
    assert.equal((await other.post('/org/members').send({ name: 'B2', email: 'b2@b.test' })).status, 201);
  });

  it('keeps one organization away from another\'s members', async () => {
    const members = await admin.get('/org/members');
    assert.ok(members.body.members.every((m) => m.email.endsWith('@a.test')));

    const victim = members.body.members.find((m) => m.email === 'sub@a.test');
    const attack = await other.patch(`/org/members/${victim.id}`).send({ isActive: false });
    assert.equal(attack.status, 404, 'user ids from another organization are not addressable');
    const still = await ctx.db.withContext(SYSTEM, (q) => q.one(`SELECT is_active FROM users WHERE id = $1`, [victim.id]));
    assert.equal(still.is_active, true);
  });

  it('protects an organization from losing its last administrator or locking itself out', async () => {
    const me = (await admin.get('/org/members')).body.members.find((m) => m.email === 'admin@a.test');
    assert.equal((await admin.patch(`/org/members/${me.id}`).send({ isActive: false })).status, 409);
    assert.equal((await admin.patch(`/org/members/${me.id}`).send({ role: 'subscriber' })).status, 409);
  });

  it('refuses to demote the last administrator even when another user tries', async () => {
    const org = await createOrg(ctx.db, { name: 'Solo Org' });
    const adminId = await createUser(ctx.db, { orgId: org, email: 'solo@solo.test', role: 'tenant_admin' });
    const res = await platform.patch(`/admin/organizations/${org}/members/${adminId}`).send({ role: 'subscriber' });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /at least one active administrator/);
  });

  it('ends a member\'s sessions when they are deactivated', async () => {
    const id = await createUser(ctx.db, { orgId: orgB, email: 'temp@b.test' });
    const temp = await signIn(ctx.app, 'temp@b.test');
    assert.equal((await other.patch(`/org/members/${id}`).send({ isActive: false })).status, 200);
    assert.equal((await temp.get('/auth/me')).status, 401);
  });

  it('lets only a platform admin manage organizations', async () => {
    assert.equal((await admin.get('/admin/organizations')).status, 403);
    assert.equal((await sub.get('/admin/organizations')).status, 403);
    const list = await platform.get('/admin/organizations');
    assert.equal(list.status, 200);
    assert.ok(list.body.organizations.length >= 4);
  });

  it('creates an organization with its first administrator invited by email', async () => {
    const res = await platform.post('/admin/organizations').send({
      name: 'Gupta Constructions Ltd', planCode: 'premium', gstin: '23APSPT2592R1ZR',
      admin: { name: 'Gupta Ji', email: 'gupta@gupta.test' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.organization.plan.code, 'premium');
    assert.equal(res.body.organization.alertCap, 150);
    assert.equal(res.body.admin.role, 'tenant_admin');
    assert.ok(await latestEmailToken(ctx.db, 'gupta@gupta.test'));
  });

  it('validates organization input', async () => {
    const badGst = await platform.post('/admin/organizations').send({
      name: 'X Corp', planCode: 'basic', gstin: 'NOTAGSTIN', admin: { name: 'X', email: 'x@x.test' } });
    assert.equal(badGst.status, 400);
    const badPlan = await platform.post('/admin/organizations').send({
      name: 'Y Corp', planCode: 'platinum', admin: { name: 'Y', email: 'y@y.test' } });
    assert.equal(badPlan.status, 400);
    const dup = await platform.post('/admin/organizations').send({
      name: 'Dup Corp', planCode: 'basic', admin: { name: 'Dup', email: 'admin@a.test' } });
    assert.equal(dup.status, 409);
  });

  it('keeps staff roles inside the staff organization and client roles out of it', async () => {
    const asClient = await platform.post(`/admin/organizations/${orgA}/members`).send({ name: 'Wrong', email: 'w1@a.test', role: 'analyst' });
    assert.equal(asClient.status, 400);
    const asStaff = await platform.post(`/admin/organizations/${ctx.staffOrgId}/members`).send({ name: 'Wrong', email: 'w2@s.test', role: 'subscriber' });
    assert.equal(asStaff.status, 400);
    const ok = await platform.post(`/admin/organizations/${ctx.staffOrgId}/members`).send({ name: 'An Analyst', email: 'analyst@s.test', role: 'analyst' });
    assert.equal(ok.status, 201);
  });

  it('suspending an organization takes effect immediately and is audited', async () => {
    const org = await createOrg(ctx.db, { name: 'To Suspend' });
    await createUser(ctx.db, { orgId: org, email: 'u@suspend.test' });
    const c = await signIn(ctx.app, 'u@suspend.test');
    assert.equal((await platform.patch(`/admin/organizations/${org}`).send({ status: 'Suspended' })).status, 200);
    assert.equal((await c.get('/auth/me')).status, 401);

    const audit = await platform.get(`/admin/audit?orgId=${ctx.staffOrgId}&limit=50`);
    assert.ok(audit.body.events.some((e) => e.action === 'org.update' && e.resource_id === String(org)));
    assert.equal((await admin.get('/admin/audit')).status, 403);
  });

  it('will not suspend the staff organization', async () => {
    const res = await platform.patch(`/admin/organizations/${ctx.staffOrgId}`).send({ status: 'Suspended' });
    assert.equal(res.status, 409);
  });
});
