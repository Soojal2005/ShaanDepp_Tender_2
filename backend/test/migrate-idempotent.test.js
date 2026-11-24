import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDatabase } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';

// The container entrypoint runs `node src/db/migrate.js` on every boot with `set -e`,
// so a migration that errors on re-application crashes the whole service (the app
// never reaches app.listen → "nothing responded on port 4000"). This happened when
// 019/020 were applied out of band: their objects existed but the ledger rows did
// not, so the next boot re-ran them — and 020's CREATE POLICY is only safe to re-run
// because it DROPs the policy first. Guard that every migration is re-runnable.
describe('boot migrations are idempotent', () => {
  it('re-applies migrations whose objects already exist but are not recorded', async () => {
    const db = await createDatabase({ driver: 'pglite', pgliteDir: 'memory://' });
    try {
      await migrate(db, { appPassword: undefined }); // fresh apply (creates tender_views + policy)
      // Simulate an out-of-band apply: the objects exist, but the ledger rows are gone.
      // schema_migrations is revoked from the app role, so use the owner (admin) handle.
      const adminDelete = (sql) =>
        (db.admin.withConnection ? db.admin.withConnection((a) => a.query(sql)) : db.admin.query(sql));
      await adminDelete("DELETE FROM schema_migrations WHERE version IN ('019', '020')");
      // Boot re-run must NOT throw (020's policy already exists).
      const { applied } = await migrate(db, { appPassword: undefined });
      assert.ok(applied.includes('020_tender_views.sql'), 're-applied 020 cleanly');
      assert.ok(applied.includes('019_user_value_pref.sql'), 're-applied 019 cleanly');
    } finally {
      await (db.close?.() ?? db.end?.() ?? Promise.resolve());
    }
  });
});
