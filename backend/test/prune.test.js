import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { pruneExpiredTenders } from '../src/services/ingestion/prune.js';
import { SYSTEM, makeContext, createOrg, createUser } from './helpers.js';

describe('prune expired tenders', () => {
  let ctx;
  let orgId;
  let userId;
  before(async () => {
    ctx = await makeContext();
    orgId = await createOrg(ctx.db, { name: 'Prune Co' });
    userId = await createUser(ctx.db, { orgId, email: 'prune@test.local' });
  });
  after(() => ctx.close());

  const insertTender = (sourceId, deadlineSql) => ctx.db.withContext(SYSTEM, async (q) =>
    (await q.one(
      `INSERT INTO tenders (provider_id, source_id, title, submission_deadline, status)
       VALUES ('cppp', $1, $2, ${deadlineSql}, 'Open') RETURNING id`,
      [sourceId, `Tender ${sourceId}`]
    )).id);
  const exists = (id) => ctx.db.withContext(SYSTEM, async (q) => Boolean(await q.maybeOne('SELECT 1 FROM tenders WHERE id = $1', [id])));

  it('deletes only expired tenders that no user is interested in', async () => {
    const future = await insertTender('P_FUT', `now() + interval '10 days'`);
    const expiredFree = await insertTender('P_EXP', `now() - interval '10 days'`);
    const expiredWatched = await insertTender('P_WATCH', `now() - interval '10 days'`);
    const expiredCased = await insertTender('P_CASE', `now() - interval '10 days'`);
    const noDeadline = await insertTender('P_NULL', 'NULL');

    await ctx.db.withContext(SYSTEM, (q) => q.query(
      'INSERT INTO watchlist_items (organization_id, user_id, tender_id) VALUES ($1,$2,$3)', [orgId, userId, expiredWatched]));
    await ctx.db.withContext(SYSTEM, (q) => q.query(
      "INSERT INTO submission_cases (organization_id, tender_id, tender_title, client_name) VALUES ($1,$2,'T','C')", [orgId, expiredCased]));

    const { deleted, kept } = await pruneExpiredTenders(ctx.db, { graceDays: 0, batchSize: 2 });

    assert.equal(deleted, 1, 'only the unreferenced expired tender is deleted');
    assert.equal(kept, 2, 'watchlisted + cased expired tenders are kept');
    assert.equal(await exists(expiredFree), false, 'unreferenced expired tender is gone');
    assert.equal(await exists(expiredWatched), true, 'watchlisted expired tender is kept');
    assert.equal(await exists(expiredCased), true, 'cased expired tender is kept');
    assert.equal(await exists(future), true, 'open tender is kept');
    assert.equal(await exists(noDeadline), true, 'tender with no deadline is kept');
  });

  it('respects the grace period', async () => {
    const justClosed = await insertTender('P_GRACE', `now() - interval '1 day'`);
    const { deleted } = await pruneExpiredTenders(ctx.db, { graceDays: 3 });
    assert.equal(deleted, 0, 'a tender closed within the grace window is not deleted yet');
    assert.equal(await exists(justClosed), true);
  });
});
