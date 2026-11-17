/**
 * Prune expired tenders.
 *
 * Tenders whose submission deadline passed more than `graceDays` ago are deleted
 * to keep the table lean — EXCEPT any a user has an interest in: a tender that is
 * watchlisted, or linked to a submission case, is kept so those users still see
 * it and its details in their dashboard. (Deleting such a tender would cascade
 * the watchlist row away and null out the case's link.)
 *
 * Deletes are chunked by id so one statement can't overrun the transaction
 * timeout on a large backlog.
 */
import { log } from '../../log.js';

const SYSTEM = { scope: 'system' };

const DELETE_BATCH = `
  DELETE FROM tenders
   WHERE id IN (
     SELECT t.id FROM tenders t
      WHERE t.submission_deadline IS NOT NULL
        AND t.submission_deadline < now() - make_interval(days => $1)
        AND NOT EXISTS (SELECT 1 FROM watchlist_items w WHERE w.tender_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM submission_cases c WHERE c.tender_id = t.id)
      LIMIT $2
   )`;

/**
 * @param db database from createDatabase()
 * @param {{ graceDays?: number, batchSize?: number, maxBatches?: number }} [opts]
 * @returns {Promise<{ deleted: number, kept: number }>}
 */
export async function pruneExpiredTenders(db, { graceDays = 2, batchSize = 500, maxBatches = 2000 } = {}) {
  let deleted = 0;
  for (let i = 0; i < maxBatches; i++) {
    const n = await db.withContext(SYSTEM, async (q) => {
      const res = await q.query(DELETE_BATCH, [graceDays, batchSize]);
      return res.rowCount ?? 0;
    });
    deleted += n;
    if (n < batchSize) break; // last (partial) batch
  }

  // How many expired tenders were kept because a user is interested in them.
  const kept = await db.withContext(SYSTEM, async (q) => {
    const row = await q.one(
      `SELECT count(*)::int AS n FROM tenders t
        WHERE t.submission_deadline IS NOT NULL
          AND t.submission_deadline < now() - make_interval(days => $1)
          AND (EXISTS (SELECT 1 FROM watchlist_items w WHERE w.tender_id = t.id)
            OR EXISTS (SELECT 1 FROM submission_cases c WHERE c.tender_id = t.id))`,
      [graceDays]
    );
    return row.n;
  });

  log.info('expired tenders pruned', { deleted, kept, graceDays });
  return { deleted, kept };
}
