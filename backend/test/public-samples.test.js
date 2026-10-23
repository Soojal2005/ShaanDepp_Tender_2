import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createDatabase } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { seedBaseline } from '../src/db/seed.js';
import { seedShowcase } from '../src/db/seed-showcase.js';

describe('Supabase publishable-key read policy', () => {
  let db;
  before(async () => {
    db = await createDatabase({ driver: 'pglite', pgliteDir: 'memory://' });
    await db.admin.exec('CREATE ROLE anon NOLOGIN');
    await migrate(db);
    await seedBaseline(db);
    await seedShowcase(db);
    await db.withContext({ scope: 'system' }, (q) =>
      q.query(`INSERT INTO tenders (provider_id, source_id, title) VALUES ('tenderbook', 'PRIVATE-CHECK', 'Non-sample tender')`));
  });
  after(() => db?.close());

  const asAnon = async (sql) => {
    await db.admin.query('BEGIN');
    try {
      await db.admin.query('SET LOCAL ROLE anon');
      return await db.admin.query(sql);
    } finally {
      await db.admin.query('ROLLBACK');
    }
  };

  it('allows anonymous reads of synthetic tenders only', async () => {
    const { rows } = await asAnon('SELECT provider_id FROM tenders');
    assert.equal(rows.length, 12);
    assert.ok(rows.every((row) => row.provider_id === 'sample'));
    await assert.rejects(asAnon('SELECT * FROM organizations'), /permission denied/i);
    await assert.rejects(asAnon(`INSERT INTO tenders (provider_id, source_id, title) VALUES ('sample', 'UNWANTED', 'x')`), /permission denied/i);
  });
});
