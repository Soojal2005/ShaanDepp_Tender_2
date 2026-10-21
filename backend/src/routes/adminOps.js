/** Operations console: the outgoing mail queue and the background jobs. */
import { Router } from 'express';
import { requirePermission, withSystemDb } from '../auth/middleware.js';
import { config } from '../config.js';
import { runJob } from '../jobs/definitions.js';
import { asyncHandler, badRequest, conflict, notFound } from '../errors.js';
import { actorOf, audit } from '../services/audit.js';
import { clearPause, getPause, queueCounts } from '../services/mail/sender.js';
import { id, parse, z } from '../validate.js';

const MESSAGE_COLUMNS = `id, organization_id, kind, recipient, subject, status, attempts, max_attempts, next_attempt_at,
  last_error, tenders_count, profile_name, created_at, sent_at`;

export function adminMailRoutes() {
  const r = Router();
  r.use(requirePermission('queue:manage'));

  r.get('/status', asyncHandler(async (req, res) => {
    const data = await withSystemDb(req, async (q) => ({
      counts: await queueCounts(q),
      pause: await getPause(q),
      recent: await q.many(`SELECT ${MESSAGE_COLUMNS} FROM email_queue ORDER BY id DESC LIMIT 30`),
      bounces: (await q.one(`SELECT count(*)::int AS n FROM email_bounce_records WHERE bounce_type IN ('hard','complaint')`)).n,
    }));
    res.json({
      mode: config.mail.dryRun ? 'dry_run' : 'live',
      sender: config.mail.senderMailbox ?? null,
      limits: { perMinute: config.mail.perMinute, perDay: config.mail.perDay },
      outboxDir: config.mail.dryRun ? config.outboxDir : null,
      bouncePolling: config.mail.pollBounces && !config.mail.dryRun,
      ...data,
    });
  }));

  r.get('/messages', asyncHandler(async (req, res) => {
    const { status, limit, before } = parse(z.object({
      status: z.enum(['queued', 'sending', 'sent', 'failed', 'dry_run', 'cancelled']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      before: z.coerce.number().int().positive().optional(),
    }), req.query);
    const rows = await withSystemDb(req, (q) => q.many(
      `SELECT ${MESSAGE_COLUMNS} FROM email_queue
        WHERE ($1::text IS NULL OR status = $1) AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $3`, [status ?? null, before ?? null, limit]));
    res.json({ messages: rows });
  }));

  r.get('/messages/:messageId', asyncHandler(async (req, res) => {
    const { messageId } = parse(z.object({ messageId: id }), req.params);
    const data = await withSystemDb(req, async (q) => {
      const message = await q.maybeOne(`SELECT ${MESSAGE_COLUMNS}, html_body FROM email_queue WHERE id = $1`, [messageId]);
      if (!message) throw notFound('Message not found');
      const attempts = await q.many('SELECT outcome, response_code, detail, latency_ms, attempted_at FROM email_delivery_logs WHERE email_id = $1 ORDER BY id', [messageId]);
      return { message, attempts };
    });
    res.json(data);
  }));

  r.post('/messages/:messageId/retry', asyncHandler(async (req, res) => {
    const { messageId } = parse(z.object({ messageId: id }), req.params);
    await withSystemDb(req, async (q) => {
      const done = await q.query(
        `UPDATE email_queue SET status = 'queued', attempts = 0, next_attempt_at = now(), last_error = NULL
          WHERE id = $1 AND status IN ('failed', 'cancelled')`, [messageId]);
      if (!done.rowCount) throw conflict('Only failed or cancelled messages can be retried');
      await audit(q, actorOf(req), 'mail.retry', 'email', messageId);
    });
    res.status(204).end();
  }));

  r.post('/messages/:messageId/cancel', asyncHandler(async (req, res) => {
    const { messageId } = parse(z.object({ messageId: id }), req.params);
    await withSystemDb(req, async (q) => {
      const done = await q.query(`UPDATE email_queue SET status = 'cancelled' WHERE id = $1 AND status = 'queued'`, [messageId]);
      if (!done.rowCount) throw conflict('Only queued messages can be cancelled');
      await audit(q, actorOf(req), 'mail.cancel', 'email', messageId);
    });
    res.status(204).end();
  }));

  r.post('/drain', asyncHandler(async (req, res) => {
    const jobs = req.app.locals.jobs;
    if (!jobs) throw badRequest('Background jobs are not available');
    res.json(await runJob(req.app.locals.db, jobs, 'mail-drain', { trigger: 'manual' }));
  }));

  r.post('/resume', asyncHandler(async (req, res) => {
    await withSystemDb(req, async (q) => { await clearPause(q); await audit(q, actorOf(req), 'mail.resume', 'email_queue'); });
    res.status(204).end();
  }));

  r.get('/bounces', asyncHandler(async (req, res) => {
    const rows = await withSystemDb(req, (q) => q.many('SELECT id, recipient_email, bounce_type, raw_diagnostic, created_at FROM email_bounce_records ORDER BY id DESC LIMIT 100'));
    res.json({ bounces: rows });
  }));

  // Clearing a bounce lets mail to that address be attempted again (for example after the mailbox was fixed).
  r.delete('/bounces/:bounceId', asyncHandler(async (req, res) => {
    const { bounceId } = parse(z.object({ bounceId: id }), req.params);
    await withSystemDb(req, async (q) => {
      const done = await q.query('DELETE FROM email_bounce_records WHERE id = $1', [bounceId]);
      if (!done.rowCount) throw notFound('Bounce record not found');
      await audit(q, actorOf(req), 'mail.bounce.clear', 'bounce', bounceId);
    });
    res.status(204).end();
  }));

  return r;
}

export function adminJobsRoutes() {
  const r = Router();
  r.use(requirePermission('jobs:manage'));

  r.get('/', asyncHandler(async (req, res) => {
    const jobs = req.app.locals.jobs ?? {};
    const rows = await withSystemDb(req, (q) =>
      q.many(`SELECT DISTINCT ON (job) job, status, trigger, detail, error, started_at, finished_at FROM job_runs ORDER BY job, started_at DESC`));
    const recent = await withSystemDb(req, (q) =>
      q.many(`SELECT id, job, status, trigger, detail, error, started_at, finished_at FROM job_runs ORDER BY id DESC LIMIT 40`));
    const last = Object.fromEntries(rows.map((row) => [row.job, row]));
    res.json({
      schedulerRunning: Boolean(req.app.locals.schedulerRunning),
      jobs: Object.entries(jobs).map(([name, j]) => ({
        name, label: j.label, description: j.description, enabled: j.enabled, schedule: j.cron, timezone: j.timezone ?? 'UTC', last: last[name] ?? null,
      })),
      recent,
    });
  }));

  r.post('/:name/run', asyncHandler(async (req, res) => {
    const jobs = req.app.locals.jobs ?? {};
    const { name } = parse(z.object({ name: z.string().min(1).max(60) }), req.params);
    if (!jobs[name]) throw notFound('Unknown job');
    const result = await runJob(req.app.locals.db, jobs, name, { trigger: 'manual', args: req.body?.force ? { force: true } : undefined });
    await withSystemDb(req, (q) => audit(q, actorOf(req), 'job.run', 'job', name, { ok: result.ok }));
    res.status(result.ok ? 200 : 500).json(result);
  }));

  return r;
}
