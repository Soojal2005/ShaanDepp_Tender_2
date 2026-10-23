import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SYSTEM, createOrg, makeContext } from './helpers.js';
import { createDatabase } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { loadConfig } from '../src/config.js';

describe('Prisma scoped database access', () => {
  let ctx, orgA, orgB;
  const tenant = (orgId) => ({ scope: 'tenant', orgId });
  before(async () => {
    ctx = await makeContext();
    orgA = await createOrg(ctx.db, { name: 'Prisma tenant A' });
    orgB = await createOrg(ctx.db, { name: 'Prisma tenant B' });
  });
  after(() => ctx?.close());

  it('applies the restricted role and actor settings before any model query', async () => {
    const [row] = await ctx.db.withPrismaContext({ ...tenant(orgA), userId: 123 }, (tx) => tx.$queryRaw`
      SELECT current_user AS role, current_setting('app.actor_scope') AS scope,
             current_setting('app.current_organization_id') AS org,
             current_setting('app.current_user_id') AS actor`);
    assert.deepEqual(row, { role: 'app_api_user', scope: 'tenant', org: String(orgA), actor: '123' });
  });

  it('filters model reads and relations by tenant and denies foreign writes', async () => {
    const rows = await ctx.db.withPrismaContext(tenant(orgA), (tx) =>
      tx.organizations.findMany({ include: { users: true } }));
    assert.deepEqual(rows.map((row) => row.id), [orgA]);
    assert.equal(await ctx.db.withPrismaContext(tenant(orgA), (tx) =>
      tx.organizations.findUnique({ where: { id: orgB } })), null);
    await assert.rejects(ctx.db.withPrismaContext(tenant(orgA), (tx) =>
      tx.alert_profiles.create({ data: { organization_id: orgB, name: 'Foreign write' } })), /row.level.security/i);
    assert.equal(await ctx.db.withPrismaContext(SYSTEM, (tx) =>
      tx.alert_profiles.count({ where: { name: 'Foreign write' } })), 0);
  });

  it('keeps staff-only credentials hidden from tenant model queries', async () => {
    assert.equal(await ctx.db.withPrismaContext(tenant(orgA), (tx) => tx.user_credentials.count()), 0);
    assert.ok(await ctx.db.withPrismaContext(SYSTEM, (tx) => tx.user_credentials.count()) > 0);
  });

  it('commits model writes visible to SQL and rolls back a failed callback', async () => {
    const profile = await ctx.db.withPrismaContext(tenant(orgA), (tx) =>
      tx.alert_profiles.create({ data: { organization_id: orgA, name: 'Prisma committed' } }));
    assert.equal((await ctx.db.withContext(tenant(orgA), (q) =>
      q.one('SELECT name FROM alert_profiles WHERE id = $1', [profile.id]))).name, 'Prisma committed');
    await assert.rejects(ctx.db.withPrismaContext(tenant(orgA), async (tx) => {
      await tx.alert_profiles.update({ where: { id: profile.id }, data: { name: 'Must roll back' } });
      throw new Error('Abort callback');
    }), /Abort callback/);
    assert.equal((await ctx.db.withPrismaContext(tenant(orgA), (tx) =>
      tx.alert_profiles.findUnique({ where: { id: profile.id } }))).name, 'Prisma committed');
  });

  it('isolates concurrent tenant contexts and clears settings on connection reuse', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => i % 2 ? orgA : orgB);
    const results = await Promise.all(ids.map((orgId) => ctx.db.withPrismaContext(tenant(orgId), (tx) =>
      tx.organizations.findMany({ select: { id: true } }))));
    results.forEach((rows, i) => assert.deepEqual(rows, [{ id: ids[i] }]));
    const [row] = await ctx.db.withPrismaContext(SYSTEM, (tx) => tx.$queryRaw`
      SELECT current_setting('app.current_organization_id') AS org,
             current_setting('app.current_user_id') AS actor`);
    assert.deepEqual(row, { org: '', actor: '' });
  });

  it('rejects invalid context before opening a Prisma transaction', async () => {
    await assert.rejects(ctx.db.withPrismaContext({ scope: 'admin' }, () => {}), /scope must be one of/);
    await assert.rejects(ctx.db.withPrismaContext({ scope: 'tenant' }, () => {}), /integer orgId/);
  });

  it('checks runtime access through Prisma', async () => {
    assert.equal(await ctx.db.health(), true);
  });

  it('uses no migration connection for health and serializes concurrent migration jobs',
    { skip: !process.env.TEST_PG_URL }, async () => {
      const { rows: [{ name }] } = await ctx.db.admin.query('SELECT current_database() AS name');
      const url = new URL(process.env.TEST_PG_URL);
      url.pathname = `/${name}`;
      const runtimeOnly = await createDatabase({
        driver: 'pg', url: url.toString(), migrationUrl: 'postgresql://unused@127.0.0.1:1/missing',
      });
      try { assert.equal(await runtimeOnly.health(), true); } finally { await runtimeOnly.close(); }
      const results = await Promise.all([migrate(ctx.db), migrate(ctx.db)]);
      assert.ok(results.every((result) => result.upToDate));
    });

  it('runs with a real restricted login while owner credentials stay unavailable',
    { skip: !process.env.TEST_PG_URL }, async () => {
      const { rows: [{ name }] } = await ctx.db.admin.query('SELECT current_database() AS name');
      const role = `prisma_check_${Date.now().toString(36)}`;
      const password = 'Disposable-test-2026';
      await ctx.db.admin.exec(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
      await ctx.db.admin.exec(`GRANT app_api_user TO ${role}`);
      const url = new URL(process.env.TEST_PG_URL);
      url.pathname = `/${name}`;
      url.username = role;
      url.password = password;
      const db = await createDatabase({ driver: 'pg', url: url.toString(), migrationUrl: 'postgresql://unavailable@127.0.0.1:1/missing' });
      try {
        assert.equal(await db.health(), true);
        assert.deepEqual((await db.withPrismaContext(tenant(orgA), (tx) =>
          tx.organizations.findMany({ select: { id: true } }))), [{ id: orgA }]);
        assert.deepEqual((await db.withContext(tenant(orgB), (q) =>
          q.many('SELECT id FROM organizations'))), [{ id: orgB }]);
      } finally {
        await db.close();
        await ctx.db.admin.exec(`DROP ROLE ${role}`);
      }
    });
});

describe('managed PostgreSQL configuration', () => {
  it('supports a separate direct CLI URL and tunable pool/timeouts', () => {
    const config = loadConfig({
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://app@pooler:6543/postgres',
      DIRECT_URL: 'postgresql://owner@database:5432/postgres', DB_POOL_MAX: '3',
      DB_CONNECT_TIMEOUT_MS: '5000', DB_TRANSACTION_TIMEOUT_MS: '60000', DB_MIGRATE_ON_START: 'off',
    });
    assert.equal(config.db.driver, 'pg');
    assert.equal(config.db.migrationUrl, 'postgresql://owner@database:5432/postgres');
    assert.equal(config.db.poolMax, 3);
    assert.equal(config.db.connectTimeoutMs, 5000);
    assert.equal(config.db.transactionTimeoutMs, 60000);
    assert.equal(config.db.migrateOnStart, false);
    assert.throws(() => loadConfig({ DB_POOL_MAX: '0' }), /DB_POOL_MAX/);
  });
});
