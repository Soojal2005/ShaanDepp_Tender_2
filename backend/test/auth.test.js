import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { API, PASSWORD, SYSTEM, anon, createOrg, createUser, latestEmailToken, makeContext, signIn } from './helpers.js';

const count = (ctx, sql, params = []) => ctx.db.withContext(SYSTEM, async (q) => (await q.one(sql, params)).n);

describe('authentication', () => {
  let ctx, orgId;
  before(async () => {
    ctx = await makeContext();
    orgId = await createOrg(ctx.db, { name: 'Auth Org' });
    await createUser(ctx.db, { orgId, email: 'sub@auth.test', name: 'Sub Scriber' });
    await createUser(ctx.db, { orgId, email: 'boss@auth.test', name: 'Boss', role: 'tenant_admin' });
  });
  after(() => ctx.close());

  it('signs in with an httpOnly SameSite cookie and never returns credential material', async () => {
    const res = await anon(ctx.app).post('/auth/login').send({ email: 'Sub@Auth.test', password: PASSWORD });
    assert.equal(res.status, 200);
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('pb_session='));
    assert.ok(cookie, 'session cookie set');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.equal(res.body.user.email, 'sub@auth.test');
    assert.equal(res.body.user.role, 'subscriber');
    assert.equal(typeof res.body.csrfToken, 'string');
    assert.doesNotMatch(JSON.stringify(res.body), /password|hash|scrypt/i);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await anon(ctx.app).post('/auth/login').send({ email: 'sub@auth.test', password: 'not-the-password-1' });
    const unknown = await anon(ctx.app).post('/auth/login').send({ email: 'nobody@auth.test', password: 'not-the-password-1' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error.message, unknown.body.error.message);
  });

  it('rejects malformed login input', async () => {
    assert.equal((await anon(ctx.app).post('/auth/login').send({ email: 'sub@auth.test' })).status, 400);
    assert.equal((await anon(ctx.app).post('/auth/login').send({ email: 'not-an-email', password: 'x' })).status, 400);
  });

  it('locks an account after repeated failures and unlocks when the lock expires', async () => {
    await createUser(ctx.db, { orgId, email: 'lock@auth.test' });
    for (let i = 0; i < 5; i++) {
      const res = await anon(ctx.app).post('/auth/login').send({ email: 'lock@auth.test', password: 'wrong-password-1' });
      assert.equal(res.status, 401);
    }
    const locked = await anon(ctx.app).post('/auth/login').send({ email: 'lock@auth.test', password: PASSWORD });
    assert.equal(locked.status, 429, 'even the right password is refused while locked');

    await ctx.db.withContext(SYSTEM, (q) =>
      q.query(`UPDATE user_credentials SET locked_until = now() - interval '1 minute'
                WHERE user_id = (SELECT id FROM users WHERE email = 'lock@auth.test')`));
    const ok = await anon(ctx.app).post('/auth/login').send({ email: 'lock@auth.test', password: PASSWORD });
    assert.equal(ok.status, 200);
  });

  it('requires a session for /auth/me and returns the organization with it', async () => {
    assert.equal((await anon(ctx.app).get('/auth/me')).status, 401);
    const c = await signIn(ctx.app, 'sub@auth.test');
    const me = await c.get('/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.orgName, 'Auth Org');
    assert.equal(me.body.organization.plan.code, 'standard');
    assert.equal(me.body.organization.seatLimit, 3);
  });

  it('enforces the CSRF header on state-changing requests', async () => {
    const c = await signIn(ctx.app, 'sub@auth.test');
    const noHeader = await c.agent.post(`${API}/auth/logout`);
    const badHeader = await c.agent.post(`${API}/auth/logout`).set('x-csrf-token', 'wrong');
    assert.equal(noHeader.status, 403);
    assert.equal(badHeader.status, 403);
    assert.equal((await c.get('/auth/me')).status, 200, 'still signed in after rejected attempts');

    assert.equal((await c.post('/auth/logout')).status, 204);
    assert.equal((await c.get('/auth/me')).status, 401, 'session destroyed server-side');
  });

  it('ignores role and organization headers sent by the client', async () => {
    const c = await signIn(ctx.app, 'sub@auth.test');
    const spoofed = await c.get('/admin/organizations').set('x-user-role', 'platform_admin').set('x-organization-id', '1');
    assert.equal(spoofed.status, 403);
    const anonymous = await request(ctx.app).get(`${API}/admin/organizations`).set('x-user-role', 'platform_admin');
    assert.equal(anonymous.status, 401);
  });

  it('refuses sign-in for a suspended organization and ends its live sessions', async () => {
    const suspended = await createOrg(ctx.db, { name: 'Suspended Org' });
    await createUser(ctx.db, { orgId: suspended, email: 'user@suspended.test' });
    const c = await signIn(ctx.app, 'user@suspended.test');
    assert.equal((await c.get('/auth/me')).status, 200);

    await ctx.db.withContext(SYSTEM, (q) => q.query(`UPDATE organizations SET status = 'Suspended' WHERE id = $1`, [suspended]));
    assert.equal((await c.get('/auth/me')).status, 401);
    const again = await anon(ctx.app).post('/auth/login').send({ email: 'user@suspended.test', password: PASSWORD });
    assert.equal(again.status, 403);
  });

  it('refuses a deactivated user and ends their live sessions', async () => {
    await createUser(ctx.db, { orgId, email: 'leaver@auth.test' });
    const c = await signIn(ctx.app, 'leaver@auth.test');
    await ctx.db.withContext(SYSTEM, (q) => q.query(`UPDATE users SET is_active = false WHERE email = 'leaver@auth.test'`));
    assert.equal((await c.get('/auth/me')).status, 401);
    assert.equal((await anon(ctx.app).post('/auth/login').send({ email: 'leaver@auth.test', password: PASSWORD })).status, 403);
  });

  it('resets a forgotten password with a single-use emailed link', async () => {
    await createUser(ctx.db, { orgId, email: 'forgot@auth.test', name: 'Forgetful' });
    const old = await signIn(ctx.app, 'forgot@auth.test');

    const res = await anon(ctx.app).post('/auth/forgot-password').send({ email: 'forgot@auth.test' });
    assert.equal(res.status, 202);
    const token = await latestEmailToken(ctx.db, 'forgot@auth.test');
    assert.ok(token, 'reset link queued');

    const weak = await anon(ctx.app).post('/auth/reset-password').send({ token, password: 'short1' });
    assert.equal(weak.status, 400, 'weak password rejected and token not consumed');

    const done = await anon(ctx.app).post('/auth/reset-password').send({ token, password: 'Brand-New-Pass9' });
    assert.equal(done.status, 204);
    assert.equal((await old.get('/auth/me')).status, 401, 'old sessions are signed out');
    assert.equal((await anon(ctx.app).post('/auth/login').send({ email: 'forgot@auth.test', password: PASSWORD })).status, 401);
    assert.equal((await anon(ctx.app).post('/auth/login').send({ email: 'forgot@auth.test', password: 'Brand-New-Pass9' })).status, 200);

    const reuse = await anon(ctx.app).post('/auth/reset-password').send({ token, password: 'Another-Pass-77' });
    assert.equal(reuse.status, 400, 'a reset link works only once');
  });

  it('rejects an expired reset link', async () => {
    await createUser(ctx.db, { orgId, email: 'late@auth.test' });
    await anon(ctx.app).post('/auth/forgot-password').send({ email: 'late@auth.test' });
    const token = await latestEmailToken(ctx.db, 'late@auth.test');
    await ctx.db.withContext(SYSTEM, (q) => q.query(`UPDATE password_reset_tokens SET expires_at = now() - interval '1 hour'`));
    const res = await anon(ctx.app).post('/auth/reset-password').send({ token, password: 'Brand-New-Pass9' });
    assert.equal(res.status, 400);
  });

  it('does not reveal whether an email has an account when asked to reset', async () => {
    const before = await count(ctx, 'SELECT count(*)::int AS n FROM email_queue');
    const res = await anon(ctx.app).post('/auth/forgot-password').send({ email: 'ghost@auth.test' });
    assert.equal(res.status, 202);
    assert.equal(await count(ctx, 'SELECT count(*)::int AS n FROM email_queue'), before);
  });

  it('changes a password after checking the current one, keeping only the current session', async () => {
    await createUser(ctx.db, { orgId, email: 'change@auth.test' });
    const a = await signIn(ctx.app, 'change@auth.test');
    const b = await signIn(ctx.app, 'change@auth.test');

    const wrong = await a.post('/auth/change-password').send({ currentPassword: 'nope-nope-1', newPassword: 'Fresh-Pass-123' });
    assert.equal(wrong.status, 400);

    const ok = await a.post('/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'Fresh-Pass-123' });
    assert.equal(ok.status, 204);
    assert.equal((await a.get('/auth/me')).status, 200, 'this session survives');
    assert.equal((await b.get('/auth/me')).status, 401, 'other sessions are ended');
    assert.equal((await anon(ctx.app).post('/auth/login').send({ email: 'change@auth.test', password: 'Fresh-Pass-123' })).status, 200);
  });

  it('records sign-ins and failures in the audit log without logging passwords', async () => {
    const rows = await ctx.db.withContext(SYSTEM, (q) => q.many(`SELECT action, metadata FROM audit_events WHERE action LIKE 'auth.%'`));
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['auth.login', 'auth.login_failed', 'auth.locked', 'auth.logout', 'auth.password_reset', 'auth.password_change']) {
      assert.ok(actions.has(a), `audit has ${a}`);
    }
    assert.doesNotMatch(JSON.stringify(rows), new RegExp(PASSWORD));
  });
});
