/**
 * Shared test fixtures. Every test file builds its own in-memory PGlite
 * database from the real migrations, so tests exercise the same SQL and the
 * same row-level-security policies as production.
 */
process.env.NODE_ENV = 'test';

const { default: request } = await import('supertest');
const { createDatabase } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { ensureBootstrapAdmin, ensureStaffOrganization, seedMasters } = await import('../src/db/seed.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/auth/password.js');

export const SYSTEM = { scope: 'system' };
export const PASSWORD = 'Passw0rd-Test1';
export const API = '/api/v1';

export async function makeContext({ rateLimits = false } = {}) {
  const db = await createDatabase({ driver: 'pglite', pgliteDir: 'memory://' });
  await migrate(db, { appPassword: undefined });
  const staffOrgId = await db.withContext(SYSTEM, async (q) => {
    const orgId = await ensureStaffOrganization(q);
    await seedMasters(q);
    await ensureBootstrapAdmin(q, orgId, { email: 'admin@test.local', password: PASSWORD, name: 'Test Admin' });
    return orgId;
  });
  const app = createApp({ db, rateLimits });
  return { db, app, staffOrgId, close: () => db.close() };
}

export async function createOrg(db, { name = 'Acme Infra', planCode = 'standard', status = 'Active' } = {}) {
  return db.withContext(SYSTEM, async (q) => {
    const row = await q.one(
      `INSERT INTO organizations (name, plan_id, status) VALUES ($1, (SELECT id FROM plans WHERE code = $2), $3) RETURNING id`,
      [name, planCode, status]
    );
    return row.id;
  });
}

export async function createUser(db, { orgId, email, name = 'Test User', role = 'subscriber', password = PASSWORD, isActive = true }) {
  return db.withContext(SYSTEM, async (q) => {
    const user = await q.one(
      `INSERT INTO users (organization_id, name, email, role, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [orgId, name, email.toLowerCase(), role, isActive]
    );
    await q.query('INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)', [
      user.id,
      await hashPassword(password),
    ]);
    return user.id;
  });
}

/** A signed-in HTTP client that automatically sends the CSRF header. */
export async function signIn(app, email, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post(`${API}/auth/login`).send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf = res.body.csrfToken;
  const wrap = (method) => (url) => agent[method](`${API}${url}`).set('x-csrf-token', csrf);
  return {
    agent, csrf, user: res.body.user,
    get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete'),
  };
}

export const anon = (app) => ({
  get: (url) => request(app).get(`${API}${url}`),
  post: (url) => request(app).post(`${API}${url}`),
});

export async function insertTender(db, overrides = {}) {
  const t = {
    source_id: `SRC-${Math.random().toString(36).slice(2, 10)}`,
    title: 'Construction of Road',
    description: 'Road works',
    department: 'Public Works Department',
    state: 'Madhya Pradesh',
    ...overrides,
  };
  return db.withContext(SYSTEM, async (q) => {
    const row = await q.one(
      `INSERT INTO tenders (provider_id, source_id, title, description, department, state)
       VALUES ('tenderbook', $1, $2, $3, $4, $5) RETURNING id`,
      [t.source_id, t.title, t.description, t.department, t.state]
    );
    return row.id;
  });
}

/** Pull the first link token out of the newest queued email for an address. */
export async function latestEmailToken(db, recipient) {
  const row = await db.withContext(SYSTEM, (q) =>
    q.maybeOne('SELECT html_body FROM email_queue WHERE recipient = $1 ORDER BY id DESC LIMIT 1', [recipient.toLowerCase()])
  );
  const match = row?.html_body.match(/token=([A-Za-z0-9_%-]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
