import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeContext, SYSTEM } from './helpers.js';
import { seedShowcase } from '../src/db/seed-showcase.js';

describe('managed showcase seed', () => {
  let ctx;
  before(async () => { ctx = await makeContext(); });
  after(() => ctx.close());

  it('creates labelled sample records that can be inspected in PostgreSQL', async () => {
    assert.deepEqual(await seedShowcase(ctx.db), { provider: 'sample', tenders: 12, results: 5 });
    const data = await ctx.db.withContext(SYSTEM, async (q) => ({
      provider: await q.one(`SELECT name, status FROM providers WHERE id = 'sample'`),
      tenders: await q.one(`SELECT count(*)::int AS n FROM tenders WHERE provider_id = 'sample'`),
      results: await q.one(`SELECT count(*)::int AS n FROM historical_awards WHERE provider = 'sample'`),
      docs: await q.one(`SELECT count(*)::int AS n FROM tender_documents d JOIN tenders t ON t.id = d.tender_id WHERE t.provider_id = 'sample'`),
      org: await q.one(`SELECT count(*)::int AS n FROM organizations WHERE domain = 'sample.invalid'`),
      users: await q.one(`SELECT count(*)::int AS n FROM users u JOIN organizations o ON o.id = u.organization_id WHERE o.domain = 'sample.invalid'`),
    }));
    assert.deepEqual(data.provider, { name: 'Synthetic sample records', status: 'Inactive' });
    assert.equal(data.tenders.n, 12);
    assert.equal(data.results.n, 5);
    assert.ok(data.docs.n > 0);
    assert.equal(data.org.n, 1);
    assert.equal(data.users.n, 0);
  });

  it('is safe to rerun and preserves edits to existing sample rows', async () => {
    await ctx.db.withContext(SYSTEM, (q) =>
      q.query(`UPDATE tenders SET title = 'Curated sample' WHERE provider_id = 'sample' AND source_id = 'DEMO-0001'`));
    assert.deepEqual(await seedShowcase(ctx.db), { provider: 'sample', tenders: 0, results: 0 });
    const data = await ctx.db.withContext(SYSTEM, (q) =>
      q.one(`SELECT title FROM tenders WHERE provider_id = 'sample' AND source_id = 'DEMO-0001'`));
    assert.equal(data.title, 'Curated sample');
  });
});
