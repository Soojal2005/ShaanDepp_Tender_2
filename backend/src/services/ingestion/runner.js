/**
 * Pulls a feed page by page, stores what it finds, and records how the run
 * went. A run that fails, comes back short, or returns records that no longer
 * look the way we expect is flagged so an administrator hears about it
 * (admin banner plus an email) instead of the data silently going stale.
 */
import { config } from '../../config.js';
import { conflict } from '../../errors.js';
import { log } from '../../log.js';
import { button, emailShell, esc } from '../mail/html.js';
import { enqueueEmail } from '../mail/queue.js';
import { loadMasterIndex } from './masters.js';
import { normalizeTenderbookResult, normalizeTenderbookTender } from './normalize.js';
import { upsertAward, upsertTender } from './store.js';
import { SourceError, createTenderbookClient } from './tenderbook.js';

const SYSTEM = { scope: 'system' };
const STALE_RUN_MS = 30 * 60 * 1000;
const DRIFT_RATIO = 0.2;
const MAX_ERROR_SAMPLES = 5;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const KINDS = {
  tenders: { fetch: (c, args) => c.tenders(args), normalize: normalizeTenderbookTender, store: upsertTender, label: 'tender' },
  results: { fetch: (c, args) => c.results(args), normalize: normalizeTenderbookResult, store: upsertAward, label: 'result' },
};

const running = new Set();

/**
 * @param db database from createDatabase()
 * @param opts { providerId, kind: 'tenders'|'results', trigger, filter, from, to, pageSize, maxPages, pageDelayMs, client }
 *   from/to (Date) keep only records published/awarded inside the window (back-fill).
 */
export async function runIngestion(db, opts = {}) {
  const {
    providerId = 'tenderbook', kind = 'tenders', trigger = 'manual', filter = {}, from = null, to = null,
    pageSize = 100, maxPages = 50, pageDelayMs = 250,
    client = createTenderbookClient(),
  } = opts;
  const def = KINDS[kind];
  if (!def) throw new Error(`Unknown ingestion kind: ${kind}`);

  const lockKey = `${providerId}:${kind}`;
  if (running.has(lockKey)) throw conflict('A sync for this feed is already running');
  running.add(lockKey);

  const runId = await db.withContext(SYSTEM, async (q) => {
    await q.query(
      `UPDATE ingestion_runs SET status = 'failed', finished_at = now(), error_message = 'Stopped: run did not finish'
        WHERE provider_id = $1 AND kind = $2 AND status = 'running' AND started_at < now() - make_interval(secs => $3)`,
      [providerId, kind, STALE_RUN_MS / 1000]
    );
    const inProgress = await q.maybeOne(
      `SELECT id FROM ingestion_runs WHERE provider_id = $1 AND kind = $2 AND status = 'running'`, [providerId, kind]);
    if (inProgress) throw conflict('A sync for this feed is already running');
    const row = await q.one(
      `INSERT INTO ingestion_runs (provider_id, kind, trigger, params) VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [providerId, kind, trigger, JSON.stringify({ filter, from, to })]
    );
    return row.id;
  }).catch((err) => { running.delete(lockKey); throw err; });

  const totals = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const samples = [];
  let outOfWindow = 0;
  let pages = 0;
  let available = 0;
  let fatal = null;

  try {
    for (let page = 0; page < maxPages; page++) {
      const batch = await def.fetch(client, { page, size: pageSize, filter });
      pages++;
      available = batch.totalElements || available;
      totals.fetched += batch.content.length;

      await db.withContext(SYSTEM, async (q) => {
        const index = await loadMasterIndex(q);
        for (const dto of batch.content) {
          const { record, problems } = def.normalize(dto);
          if (problems.length) {
            totals.errors++;
            if (samples.length < MAX_ERROR_SAMPLES) samples.push(`record rejected: ${problems.join(', ')}`);
            continue;
          }
          const when = record.publishDate ?? record.awardDate ?? null;
          if ((from && when && when < from) || (to && when && when > to)) { outOfWindow++; continue; }
          try {
            const outcome = await q.savepoint((tx) => def.store(tx, providerId, record, index, dto));
            totals[outcome]++;
          } catch (err) {
            totals.errors++;
            if (samples.length < MAX_ERROR_SAMPLES) samples.push(`could not store ${record.sourceId}: ${err.message}`);
          }
        }
      });

      const lastPage = batch.content.length < pageSize || (batch.totalPages && page + 1 >= batch.totalPages);
      if (lastPage) break;
      if (pageDelayMs) await sleep(pageDelayMs);
    }
  } catch (err) {
    fatal = err instanceof SourceError ? err : new SourceError(`Unexpected error: ${err.message}`);
    log.error('ingestion failed', { providerId, kind, error: fatal.message });
  } finally {
    running.delete(lockKey);
  }

  return finish(db, { runId, providerId, kind, trigger, filter, from, to, totals, samples, outOfWindow, pages, available, fatal });
}

async function finish(db, ctx) {
  const { runId, providerId, kind, trigger, filter, from, to, totals, samples, outOfWindow, pages, available, fatal } = ctx;
  const warnings = [];
  let status = 'success';
  let errorMessage = null;

  if (fatal) {
    status = totals.fetched === 0 ? 'failed' : 'warning';
    errorMessage = fatal.message;
    warnings.push(totals.fetched === 0 ? fatal.message : `Stopped part-way after ${totals.fetched} records: ${fatal.message}`);
  }
  const provider = await db.withContext(SYSTEM, (q) => q.one('SELECT min_expected_records FROM providers WHERE id = $1', [providerId]));
  const fullPull = !from && !to && Object.keys(filter ?? {}).length === 0;
  if (!fatal && fullPull && totals.fetched < provider.min_expected_records) {
    status = 'warning';
    warnings.push(`Only ${totals.fetched} records arrived; at least ${provider.min_expected_records} are expected. The feed may be incomplete.`);
  }
  if (!fatal && totals.fetched >= 5 && totals.errors / totals.fetched > DRIFT_RATIO) {
    status = totals.errors === totals.fetched ? 'failed' : 'warning';
    warnings.push(`${totals.errors} of ${totals.fetched} records could not be read. The source format may have changed.`);
  }
  if (!fatal && totals.errors > 0 && warnings.length === 0) {
    status = 'warning';
    warnings.push(`${totals.errors} records could not be stored.`);
  }
  for (const s of samples) warnings.push(s);

  await db.withContext(SYSTEM, async (q) => {
    await q.query(
      `UPDATE ingestion_runs
          SET status = $2, fetched = $3, inserted = $4, updated = $5, skipped = $6, errors = $7,
              error_message = $8, warnings = $9::jsonb, finished_at = now(), health = $10::jsonb
        WHERE id = $1`,
      [runId, status, totals.fetched, totals.inserted, totals.updated, totals.skipped, totals.errors, errorMessage,
        JSON.stringify(warnings), JSON.stringify({ pages, available, outOfWindow })]
    );
    if (totals.fetched > 0 && status !== 'failed') {
      await q.query('UPDATE providers SET last_success_at = now() WHERE id = $1', [providerId]);
    }
    if (status !== 'success' && trigger !== 'excel' && config.mail.opsAlertEmail) {
      const html = emailShell({
        title: 'Tender feed needs attention',
        bodyHtml: `
          <p style="font-size:15px;margin:0 0 10px;"><b>The ${esc(providerId)} ${esc(kind)} sync finished with status: ${esc(status)}.</b></p>
          <ul style="font-size:13px;padding-left:18px;margin:0 0 16px;">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
          <p style="margin:0 0 16px;">${button('Open ingestion status', `${config.publicBaseUrl}/app/admin/ingestion`)}</p>`,
      });
      await enqueueEmail(q, {
        kind: 'ops_alert', to: config.mail.opsAlertEmail, subject: `[procure-brain] ${providerId} ${kind} sync: ${status}`,
        html, idempotencyKey: `ops:ingestion:${runId}`,
      });
    }
  });

  return { runId, status, ...totals, outOfWindow, warnings, error: errorMessage };
}
