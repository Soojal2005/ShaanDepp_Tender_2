/**
 * Row-level-security tests. These talk to the database directly (no HTTP) as
 * the unprivileged runtime role, so they prove isolation is enforced by the
 * database itself and not just by API code.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SYSTEM, createOrg, createUser, insertTender, makeContext } from './helpers.js';

describe('row-level security', () => {
  let ctx, orgA, orgB, tenderId, caseA, caseB;
  const asA = () => ({ scope: 'tenant', orgId: orgA });
  const asB = () => ({ scope: 'tenant', orgId: orgB });
  const asStaff = () => ({ scope: 'staff', orgId: ctx.staffOrgId });

  before(async () => {
    ctx = await makeContext();
    orgA = await createOrg(ctx.db, { name: 'Org A' });
    orgB = await createOrg(ctx.db, { name: 'Org B' });
    const userA = await createUser(ctx.db, { orgId: orgA, email: 'a@a.test' });
    await createUser(ctx.db, { orgId: orgB, email: 'b@b.test' });
    tenderId = await insertTender(ctx.db);

    await ctx.db.withContext(SYSTEM, async (q) => {
      await q.query(`INSERT INTO alert_profiles (organization_id, name) VALUES ($1,'A profile'), ($2,'B profile')`, [orgA, orgB]);
      await q.query(
        `INSERT INTO saved_searches (organization_id, user_id, name, query_params) VALUES ($1,$2,'A search','{}'::jsonb)`,
        [orgA, userA]
      );
      caseA = (await q.one(
        `INSERT INTO submission_cases (organization_id, tender_title, client_name) VALUES ($1,'Case A','Org A') RETURNING id`, [orgA])).id;
      caseB = (await q.one(
        `INSERT INTO submission_cases (organization_id, tender_title, client_name) VALUES ($1,'Case B','Org B') RETURNING id`, [orgB])).id;
      await q.query(
        `INSERT INTO case_documents (case_id, name, storage_key, visibility) VALUES
           ($1,'shared.pdf','k1','shared'), ($1,'internal.xlsx','k2','internal_only')`, [caseA]);
      await q.query(`INSERT INTO case_internal (case_id, financial_strategy) VALUES ($1,'bid 5% under')`, [caseA]);
      await q.query(`INSERT INTO case_analyst_notes (case_id, note_text) VALUES ($1,'confidential margin note')`, [caseA]);
      await q.query(`INSERT INTO case_prebid_queries (case_id, query_text) VALUES ($1,'clarify clause 4')`, [caseA]);
    });
  });
  after(() => ctx.close());

  it('lets a tenant read only its own rows', async () => {
    const rows = await ctx.db.withContext(asA(), (q) => q.many('SELECT name FROM alert_profiles'));
    assert.deepEqual(rows.map((r) => r.name), ['A profile']);
    const orgs = await ctx.db.withContext(asA(), (q) => q.many('SELECT id FROM organizations'));
    assert.deepEqual(orgs.map((r) => r.id), [orgA]);
    const cases = await ctx.db.withContext(asB(), (q) => q.many('SELECT id FROM submission_cases'));
    assert.deepEqual(cases.map((r) => r.id), [caseB]);
  });

  it('blocks a tenant from inserting rows into another organization', async () => {
    await assert.rejects(
      ctx.db.withContext(asA(), (q) => q.query(`INSERT INTO alert_profiles (organization_id, name) VALUES ($1,'sneaky')`, [orgB])),
      /row-level security/
    );
  });

  it('blocks a tenant from updating or deleting another organization\'s rows', async () => {
    const upd = await ctx.db.withContext(asA(), (q) => q.query(`UPDATE alert_profiles SET name = 'hacked' WHERE organization_id = $1`, [orgB]));
    const del = await ctx.db.withContext(asA(), (q) => q.query(`DELETE FROM alert_profiles WHERE organization_id = $1`, [orgB]));
    assert.equal(upd.rowCount, 0);
    assert.equal(del.rowCount, 0);
    const still = await ctx.db.withContext(asB(), (q) => q.many('SELECT name FROM alert_profiles'));
    assert.deepEqual(still.map((r) => r.name), ['B profile']);
  });

  it('shows staff every organization', async () => {
    const rows = await ctx.db.withContext(asStaff(), (q) => q.many('SELECT name FROM alert_profiles ORDER BY name'));
    assert.deepEqual(rows.map((r) => r.name), ['A profile', 'B profile']);
  });

  it('denies everything when the tenant setting is missing, malformed or injected', async () => {
    for (const value of ['', 'abc', '1; DROP TABLE users', '-5', '99999999999']) {
      const rows = await ctx.db.withContext(asA(), async (q) => {
        await q.query(`SELECT set_config('app.current_organization_id', $1, true)`, [value]);
        return q.many('SELECT id FROM alert_profiles');
      });
      assert.equal(rows.length, 0, `value ${JSON.stringify(value)} must see nothing`);
    }
  });

  it('refuses an unknown scope', async () => {
    await assert.rejects(ctx.db.withContext({ scope: 'admin' }, (q) => q.many('SELECT 1')), /scope must be one of/);
    await assert.rejects(ctx.db.withContext({ scope: 'tenant' }, (q) => q.many('SELECT 1')), /integer orgId/);
  });

  it('keeps staff-only working data away from client accounts (FR-CASE-011 at database level)', async () => {
    const docs = await ctx.db.withContext(asA(), (q) => q.many('SELECT name FROM case_documents ORDER BY name'));
    assert.deepEqual(docs.map((d) => d.name), ['shared.pdf']);

    const internal = await ctx.db.withContext(asA(), (q) => q.many('SELECT * FROM case_internal'));
    const notes = await ctx.db.withContext(asA(), (q) => q.many('SELECT * FROM case_analyst_notes'));
    assert.equal(internal.length, 0);
    assert.equal(notes.length, 0);

    const staffDocs = await ctx.db.withContext(asStaff(), (q) => q.many('SELECT name FROM case_documents'));
    const staffNotes = await ctx.db.withContext(asStaff(), (q) => q.many('SELECT * FROM case_analyst_notes'));
    assert.equal(staffDocs.length, 2);
    assert.equal(staffNotes.length, 1);

    // The client can follow the shared parts of its own case...
    const queries = await ctx.db.withContext(asA(), (q) => q.many('SELECT query_text FROM case_prebid_queries'));
    assert.equal(queries.length, 1);
    // ...but not another organization's.
    const other = await ctx.db.withContext(asB(), (q) => q.many('SELECT query_text FROM case_prebid_queries'));
    assert.equal(other.length, 0);
  });

  it('lets a client add only shared documents to its own case', async () => {
    await ctx.db.withContext(asA(), (q) =>
      q.query(`INSERT INTO case_documents (case_id, name, storage_key, visibility) VALUES ($1,'client-upload.pdf','k3','shared')`, [caseA]));
    await assert.rejects(
      ctx.db.withContext(asA(), (q) =>
        q.query(`INSERT INTO case_documents (case_id, name, storage_key, visibility) VALUES ($1,'x.pdf','k4','internal_only')`, [caseA])),
      /row-level security/
    );
    await assert.rejects(
      ctx.db.withContext(asA(), (q) =>
        q.query(`INSERT INTO case_documents (case_id, name, storage_key, visibility) VALUES ($1,'x.pdf','k5','shared')`, [caseB])),
      /row-level security/
    );
  });

  it('hides credentials, sessions, email queue and enquiries from client accounts', async () => {
    await ctx.db.withContext(SYSTEM, (q) =>
      q.query(`INSERT INTO enquiries (name, company, email) VALUES ('Lead','Co','lead@co.test')`));
    for (const table of ['user_credentials', 'user_sessions', 'password_reset_tokens', 'email_queue', 'enquiries', 'system_config', 'raw_tender_payloads']) {
      const rows = await ctx.db.withContext(asA(), (q) => q.many(`SELECT * FROM ${table}`));
      assert.equal(rows.length, 0, `${table} must be invisible to tenants`);
    }
    await assert.rejects(
      ctx.db.withContext(asA(), (q) => q.query(`INSERT INTO enquiries (name, company, email) VALUES ('x','y','z@z.test')`)),
      /row-level security/
    );
  });

  it('lets clients read shared tender data but never change it', async () => {
    const rows = await ctx.db.withContext(asA(), (q) => q.many('SELECT id FROM tenders'));
    assert.equal(rows.length, 1);
    await assert.rejects(
      ctx.db.withContext(asA(), (q) => q.query(`INSERT INTO tenders (provider_id, source_id, title) VALUES ('tenderbook','X','x')`)),
      /row-level security/
    );
    const upd = await ctx.db.withContext(asA(), (q) => q.query(`UPDATE tenders SET title = 'pwned' WHERE id = $1`, [tenderId]));
    assert.equal(upd.rowCount, 0);
  });

  it('hides a report bundle from its client until a release is logged', async () => {
    const bundleId = await ctx.db.withContext(SYSTEM, async (q) =>
      (await q.one(
        `INSERT INTO report_bundles (organization_id, period_start, period_end, title)
         VALUES ($1, '2026-10-05', '2026-10-11', 'Weekly W41') RETURNING id`, [orgA])).id);
    assert.equal((await ctx.db.withContext(asA(), (q) => q.many('SELECT id FROM report_bundles'))).length, 0);

    await ctx.db.withContext(asStaff(), (q) =>
      q.query(
        `INSERT INTO report_releases (organization_id, bundle_id, bundle_title, scope, released_by_name)
         VALUES ($1, $2, 'Weekly W41', 'client', 'Test Admin')`, [orgA, bundleId]));
    assert.equal((await ctx.db.withContext(asA(), (q) => q.many('SELECT id FROM report_bundles'))).length, 1);
    assert.equal((await ctx.db.withContext(asB(), (q) => q.many('SELECT id FROM report_bundles'))).length, 0);
  });

  it('keeps the audit log and release log append-only, even for the database owner', async () => {
    await ctx.db.withContext(asA(), (q) =>
      q.query(`INSERT INTO audit_events (organization_id, action, resource_type) VALUES ($1,'test.event','test')`, [orgA]));

    // Runtime role: privilege revoked.
    await assert.rejects(ctx.db.withContext(SYSTEM, (q) => q.query(`UPDATE audit_events SET action = 'edited'`)), /permission denied/);
    await assert.rejects(ctx.db.withContext(SYSTEM, (q) => q.query(`DELETE FROM report_releases`)), /permission denied/);
    // Owner / superuser: trigger still blocks.
    await assert.rejects(ctx.db.admin.query(`UPDATE audit_events SET action = 'edited'`), /append-only/);
    await assert.rejects(ctx.db.admin.query(`DELETE FROM report_releases`), /append-only/);
    await assert.rejects(ctx.db.admin.query(`TRUNCATE audit_events`), /append-only/);

    // Clients cannot read the audit log; staff can.
    assert.equal((await ctx.db.withContext(asA(), (q) => q.many('SELECT id FROM audit_events'))).length, 0);
    assert.ok((await ctx.db.withContext(asStaff(), (q) => q.many('SELECT id FROM audit_events'))).length >= 1);
  });

  it('survives organization removal without touching the audit trail', async () => {
    const orgC = await createOrg(ctx.db, { name: 'Temporary Org' });
    await ctx.db.withContext(SYSTEM, (q) =>
      q.query(`INSERT INTO audit_events (organization_id, action, resource_type) VALUES ($1,'temp.event','test')`, [orgC]));
    await ctx.db.admin.query(`DELETE FROM organizations WHERE id = ${orgC}`);
    const kept = await ctx.db.withContext(SYSTEM, (q) => q.many(`SELECT id FROM audit_events WHERE action = 'temp.event'`));
    assert.equal(kept.length, 1);
  });
});
