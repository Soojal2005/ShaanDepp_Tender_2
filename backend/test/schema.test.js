import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createDatabase } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { makeContext } from './helpers.js';

describe('schema and migrations', () => {
  let ctx;
  before(async () => { ctx = await makeContext(); });
  after(() => ctx.close());

  it('forces row-level security on every application table', async () => {
    const { rows } = await ctx.db.admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`
    );
    assert.deepEqual(rows.map((r) => r.relname), []);
  });

  it('gives every table at least one policy (no accidental deny-all)', async () => {
    const { rows } = await ctx.db.admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'
          AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)`
    );
    assert.deepEqual(rows.map((r) => r.relname), []);
  });

  it('runs the application as a role that cannot bypass row-level security', async () => {
    const { rows } = await ctx.db.admin.query(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = 'app_api_user'`
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
  });

  it('keeps password hashes out of any table a client account can read', async () => {
    const { rows } = await ctx.db.admin.query(
      `SELECT DISTINCT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name LIKE '%password%'`
    );
    assert.deepEqual(rows.map((r) => r.table_name), ['user_credentials']);
  });

  it('is idempotent when migrations are re-run', async () => {
    const again = await migrate(ctx.db);
    assert.equal(again.upToDate, true);
  });

  it('refuses to continue if an applied migration file was edited', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    try {
      fs.writeFileSync(path.join(dir, '001_one.sql'), 'CREATE TABLE t_one (id int);');
      const db = await createDatabase({ driver: 'pglite', pgliteDir: 'memory://' });
      await migrate(db, { dir });
      fs.writeFileSync(path.join(dir, '001_one.sql'), 'CREATE TABLE t_one (id int, extra int);');
      await assert.rejects(migrate(db, { dir }), /modified after being applied/);
      await db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rolls back a failing migration completely', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    try {
      fs.writeFileSync(path.join(dir, '001_bad.sql'), 'CREATE TABLE half_done (id int); SELECT * FROM missing_table;');
      const db = await createDatabase({ driver: 'pglite', pgliteDir: 'memory://' });
      await assert.rejects(migrate(db, { dir }), /001_bad\.sql failed/);
      const { rows } = await db.admin.query(`SELECT to_regclass('public.half_done') AS t`);
      assert.equal(rows[0].t, null);
      await db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seeds the three plans with the proposal alert caps', async () => {
    const { rows } = await ctx.db.admin.query('SELECT code, daily_alert_cap, max_seats FROM plans ORDER BY sort_order');
    assert.deepEqual(rows, [
      { code: 'basic', daily_alert_cap: 50, max_seats: 3 },
      { code: 'standard', daily_alert_cap: 100, max_seats: 3 },
      { code: 'premium', daily_alert_cap: 150, max_seats: 3 },
    ]);
  });

  it('populates tender search vectors automatically', async () => {
    const { rows } = await ctx.db.admin.query(
      `INSERT INTO tenders (provider_id, source_id, title, description) VALUES ('tenderbook','S1','Supply of Ultrasonic Water Meters','AMR telemetry')
       RETURNING title_tsv @@ to_tsquery('simple','ultrasonic') AS in_title, desc_tsv @@ to_tsquery('simple','telemetry') AS in_desc`
    );
    assert.deepEqual(rows[0], { in_title: true, in_desc: true });
  });
});
