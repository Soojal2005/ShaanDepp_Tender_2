/**
 * Drains the email queue through Microsoft Graph without exceeding Microsoft's
 * limits (per-minute and per-24-hours). A batch larger than the window simply
 * stays queued and goes out in the next window; nothing is dropped.
 *
 * Failure handling:
 *   throttled (429) .. wait the Retry-After time, whole queue pauses, attempt not counted
 *   transient ........ retry with exponential back-off, up to max_attempts
 *   systemic (401/403) pause 15 minutes, messages stay queued, administrators are alerted
 *   permanent ........ message marked failed (bad address, rejected content)
 *
 * With MAIL_MODE=dry_run nothing leaves the building: each message is written
 * to an HTML file in the outbox folder and marked "dry_run", never "sent".
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { log } from '../../log.js';
import { GraphError } from './graph.js';
import { enqueueEmail } from './queue.js';
import { button, emailShell, esc } from './html.js';

const SYSTEM = { scope: 'system' };
const STUCK_AFTER_MINUTES = 10;
const SYSTEMIC_PAUSE_SECONDS = 15 * 60;
const TRANSIENT_STREAK_LIMIT = 3;
const PAUSE_KEY = 'mail.pause';
const BULK_KINDS = `('digest', 'reminder', 'bundle_notice')`;

/** 30s, 1m, 2m, 4m ... capped at 15 minutes. */
export const backoffSeconds = (attempt) => Math.min(900, 30 * 2 ** Math.max(0, attempt - 1));

export async function getPause(q, now = new Date()) {
  const row = await q.maybeOne('SELECT value FROM system_config WHERE key = $1', [PAUSE_KEY]);
  if (!row?.value?.until || new Date(row.value.until) <= now) return null;
  return row.value;
}

async function setPause(q, until, reason) {
  await q.query(
    `INSERT INTO system_config (key, value, description) VALUES ($1, $2::jsonb, 'Mail sending is paused until the given time')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [PAUSE_KEY, JSON.stringify({ until: until.toISOString(), reason })]
  );
}

export async function clearPause(q) {
  await q.query('DELETE FROM system_config WHERE key = $1', [PAUSE_KEY]);
}

const safeName = (s) => String(s).toLowerCase().replace(/[^a-z0-9@.+-]+/g, '_').slice(0, 60);

function writeOutbox(dir, row, now) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
  const file = path.join(dir, `${stamp}-${row.id}-${row.kind}-${safeName(row.recipient)}.html`);
  const header = `<!--\n  DRY RUN - not sent\n  To: ${row.recipient}\n  Subject: ${row.subject.replace(/-->/g, '--&gt;')}\n  Kind: ${row.kind}\n-->\n`;
  fs.writeFileSync(file, header + row.html_body, 'utf8');
  return file;
}

async function logAttempt(q, emailId, outcome, { code = null, detail = null, ms = null } = {}) {
  await q.query(
    'INSERT INTO email_delivery_logs (email_id, response_code, outcome, detail, latency_ms) VALUES ($1, $2, $3, $4, $5)',
    [emailId, code, outcome, detail ? String(detail).slice(0, 500) : null, ms]
  );
}

export async function queueCounts(q, now = new Date()) {
  const byStatus = await q.many('SELECT status, count(*)::int AS n FROM email_queue GROUP BY status');
  const sent = await q.one(
    `SELECT count(*) FILTER (WHERE sent_at > $1::timestamptz - interval '1 minute')::int AS last_minute,
            count(*) FILTER (WHERE sent_at > $1::timestamptz - interval '24 hours')::int AS last_day
       FROM email_queue WHERE status = 'sent'`, [now]);
  return { byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])), sentLastMinute: sent.last_minute, sentLastDay: sent.last_day };
}

/**
 * @param db database
 * @param opts { client (Graph, null in dry run), settings: {dryRun, perMinute, perDay}, outboxDir, now, maxBatch }
 */
export async function drainQueue(db, { client = null, settings = config.mail, outboxDir = config.outboxDir, now = new Date(), maxBatch = 200 } = {}) {
  const stats = { sent: 0, dryRun: 0, retried: 0, failed: 0, suppressed: 0, requeued: 0, paused: null, budget: null };

  // Messages stuck "sending" (process died mid-send) go back to the queue.
  await db.withContext(SYSTEM, (q) =>
    q.query(`UPDATE email_queue SET status = 'queued' WHERE status = 'sending' AND updated_at < $1::timestamptz - make_interval(mins => $2)`, [now, STUCK_AFTER_MINUTES]));

  let budget = maxBatch;
  if (!settings.dryRun) {
    const gate = await db.withContext(SYSTEM, async (q) => ({ pause: await getPause(q, now), counts: await queueCounts(q, now) }));
    if (gate.pause) return { ...stats, paused: gate.pause };
    budget = Math.min(maxBatch, settings.perMinute - gate.counts.sentLastMinute, settings.perDay - gate.counts.sentLastDay);
    stats.budget = budget;
    if (budget <= 0) return stats;
  }

  const claimed = await db.withContext(SYSTEM, (q) =>
    q.many(
      `UPDATE email_queue SET status = 'sending', attempts = attempts + 1
        WHERE id IN (SELECT id FROM email_queue WHERE status = 'queued' AND next_attempt_at <= $1::timestamptz
                      ORDER BY (kind IN ${BULK_KINDS}), next_attempt_at, id LIMIT $2 FOR UPDATE SKIP LOCKED)
        RETURNING id, organization_id, kind, recipient, subject, html_body, attempts, max_attempts`,
      [now, budget])
  );
  claimed.sort((a, b) => a.id - b.id);

  const release = (rows, { countAttempt = false } = {}) =>
    db.withContext(SYSTEM, (q) =>
      q.query(`UPDATE email_queue SET status = 'queued', attempts = attempts - $2 WHERE id = ANY($1::bigint[]) AND status = 'sending'`,
        [rows.map((r) => r.id), countAttempt ? 0 : 1]));

  let transientStreak = 0;
  for (let i = 0; i < claimed.length; i++) {
    const row = claimed[i];
    const rest = claimed.slice(i + 1);
    const started = Date.now();
    try {
      const suppressed = await db.withContext(SYSTEM, (q) =>
        q.maybeOne(`SELECT 1 AS x FROM email_bounce_records WHERE recipient_email = $1 AND bounce_type IN ('hard', 'complaint') LIMIT 1`, [row.recipient]));
      if (suppressed) {
        await db.withContext(SYSTEM, async (q) => {
          await q.query(`UPDATE email_queue SET status = 'failed', last_error = $2 WHERE id = $1`, [row.id, 'Not sent: this address previously bounced permanently']);
          await logAttempt(q, row.id, 'suppressed');
        });
        stats.suppressed++;
        continue;
      }

      if (settings.dryRun) {
        const file = writeOutbox(outboxDir, row, now);
        await db.withContext(SYSTEM, async (q) => {
          await q.query(`UPDATE email_queue SET status = 'dry_run', sent_at = $2, last_error = NULL WHERE id = $1`, [row.id, now]);
          await logAttempt(q, row.id, 'dry_run', { detail: path.basename(file), ms: Date.now() - started });
        });
        stats.dryRun++;
        continue;
      }

      await client.sendMail({ to: row.recipient, subject: row.subject, html: row.html_body });
      await db.withContext(SYSTEM, async (q) => {
        await q.query(`UPDATE email_queue SET status = 'sent', sent_at = $2, last_error = NULL WHERE id = $1`, [row.id, now]);
        await logAttempt(q, row.id, 'sent', { code: 202, ms: Date.now() - started });
      });
      stats.sent++;
      transientStreak = 0;
    } catch (err) {
      const kind = err instanceof GraphError ? err.kind : 'transient';
      const message = err.message ?? String(err);
      const ms = Date.now() - started;

      if (kind === 'throttled' || kind === 'systemic') {
        // Affects everything, not just this message: put it and the rest back and stop.
        const seconds = kind === 'throttled' ? err.retryAfterSeconds ?? 60 : SYSTEMIC_PAUSE_SECONDS;
        const until = new Date(now.getTime() + seconds * 1000);
        await release([row, ...rest]);
        await db.withContext(SYSTEM, async (q) => {
          await setPause(q, until, message);
          await logAttempt(q, row.id, kind, { code: err.status, detail: message, ms });
          if (kind === 'systemic') await alertOps(q, message);
        });
        stats.requeued += 1 + rest.length;
        stats.paused = { until: until.toISOString(), reason: message };
        break;
      }

      if (kind === 'permanent' || row.attempts >= row.max_attempts) {
        await db.withContext(SYSTEM, async (q) => {
          await q.query(`UPDATE email_queue SET status = 'failed', last_error = $2 WHERE id = $1`, [row.id, message.slice(0, 500)]);
          await logAttempt(q, row.id, kind === 'permanent' ? 'permanent' : 'gave_up', { code: err.status, detail: message, ms });
        });
        stats.failed++;
        continue;
      }

      const next = new Date(now.getTime() + (err.retryAfterSeconds ?? backoffSeconds(row.attempts)) * 1000);
      await db.withContext(SYSTEM, async (q) => {
        await q.query(`UPDATE email_queue SET status = 'queued', next_attempt_at = $2, last_error = $3 WHERE id = $1`, [row.id, next, message.slice(0, 500)]);
        await logAttempt(q, row.id, 'transient', { code: err.status, detail: message, ms });
      });
      stats.retried++;
      transientStreak++;
      if (transientStreak >= TRANSIENT_STREAK_LIMIT && rest.length) {
        await release(rest);
        stats.requeued += rest.length;
        break;
      }
    }
  }
  if (stats.sent || stats.failed || stats.retried) log.info('mail drain', stats);
  return stats;
}

/** One alert per hour at most when sending is blocked by a credentials / permission problem. */
async function alertOps(q, message) {
  if (!config.mail.opsAlertEmail) return;
  const hour = new Date().toISOString().slice(0, 13);
  const html = emailShell({
    title: 'Email sending is paused',
    bodyHtml: `<p style="font-size:15px;"><b>procure-brain.com cannot send email through Microsoft 365.</b></p>
      <p style="font-size:13px;">${esc(message)}</p>
      <p style="font-size:13px;">Messages are kept and will be sent automatically once access is restored. Sending retries every 15 minutes.</p>
      <p>${button('Open mail queue', `${config.publicBaseUrl}/app/admin/mail`)}</p>`,
  });
  await enqueueEmail(q, { kind: 'ops_alert', to: config.mail.opsAlertEmail, subject: '[procure-brain] Email sending is paused', html, idempotencyKey: `ops:mail-paused:${hour}` });
}
