/**
 * The background jobs. Each job is a plain async function so it can be run by
 * the scheduler, by an administrator ("run now"), or by a test, and each run
 * is recorded in job_runs for the admin console.
 */
import { config } from '../config.js';
import { log } from '../log.js';
import { runDueDigests } from '../services/alerts/digest.js';
import { pollBounces } from '../services/mail/bounces.js';
import { createGraphClient } from '../services/mail/graph.js';
import { drainQueue } from '../services/mail/sender.js';
import { button, emailShell } from '../services/mail/html.js';
import { enqueueEmail } from '../services/mail/queue.js';
import { runIngestion } from '../services/ingestion/runner.js';
import { createTenderbookClient } from '../services/ingestion/tenderbook.js';
import { generateForOrganizations } from '../services/bundle/index.js';
import { queueCaseReminders } from '../services/caseReminders.js';
import { queueWatchlistReminders } from '../services/reminders.js';

const SYSTEM = { scope: 'system' };

/**
 * @param db database
 * @param deps overridable collaborators (tests pass fakes)
 */
export function createJobs(db, deps = {}) {
  const {
    settings = config.mail,
    baseUrl = config.publicBaseUrl,
    makeMailClient = () => (settings.dryRun ? null : createGraphClient()),
    makeTenderbookClient = createTenderbookClient,
    tenderbook = config.tenderbook,
  } = deps;

  return {
    ingest: {
      label: 'Tender feed sync',
      description: 'Pulls new and changed tenders, then results, from Tenderbook.',
      enabled: tenderbook.enabled,
      cron: tenderbook.intervalMinutes >= 60 ? `0 */${Math.max(1, Math.round(tenderbook.intervalMinutes / 60))} * * *` : `*/${tenderbook.intervalMinutes} * * * *`,
      async run() {
        const client = makeTenderbookClient();
        const tenders = await runIngestion(db, { kind: 'tenders', trigger: 'schedule', client });
        const results = await runIngestion(db, { kind: 'results', trigger: 'schedule', client });
        return { tenders: { status: tenders.status, inserted: tenders.inserted, updated: tenders.updated }, results: { status: results.status, inserted: results.inserted } };
      },
    },

    digests: {
      label: 'Daily alert digests',
      description: 'Builds and queues each due alert profile (08:00 India time, retried every 15 minutes until done).',
      enabled: true,
      cron: '*/15 8-19 * * *',
      timezone: 'Asia/Kolkata',
      async run({ force = false } = {}) {
        const summary = await runDueDigests(db, { baseUrl, force });
        if (summary.failed) throw new Error(`${summary.failed} alert profile(s) failed: ${summary.errors.join('; ')}`);
        return { ...summary, activity: summary.emailsQueued };
      },
    },

    'mail-drain': {
      label: 'Send queued email',
      description: 'Sends waiting messages without exceeding Microsoft limits.',
      enabled: true,
      cron: '*/30 * * * * *',
      quiet: true,
      async run() {
        const stats = await drainQueue(db, { client: makeMailClient(), settings });
        return { ...stats, activity: stats.sent + stats.dryRun + stats.failed + stats.retried };
      },
    },

    bounces: {
      label: 'Read delivery failures',
      description: 'Records bounced addresses from the sending mailbox so they are not mailed again.',
      enabled: settings.pollBounces && !settings.dryRun,
      cron: '*/10 * * * *',
      quiet: true,
      async run() {
        const result = await pollBounces(db, createGraphClient());
        return { ...result, activity: result.bounces };
      },
    },

    'weekly-bundle': {
      label: 'Monday analytical bundles',
      description: "Builds last week's report for every client organization (Monday 06:00 India time). Reports stay in the locker until released.",
      enabled: true,
      cron: '0 6 * * 1',
      timezone: 'Asia/Kolkata',
      async run({ periodStart } = {}) {
        const result = await generateForOrganizations(db, { periodStart });
        if (result.failed) throw new Error(`${result.failed} bundle(s) failed: ${result.errors.join('; ')}`);
        return { ...result, activity: result.generated };
      },
    },

    reminders: {
      label: 'Watchlist reminders',
      description: 'Reminds people about pre-bid meetings and deadlines of tenders they track.',
      enabled: true,
      cron: '5 * * * *',
      quiet: true,
      async run() {
        const result = await queueWatchlistReminders(db, { baseUrl });
        return { ...result, activity: result.emails };
      },
    },

    'case-reminders': {
      label: 'Submission desk reminders',
      description: 'Reminds the desk team about bid deadlines, due follow-ups and requests nobody owns.',
      enabled: true,
      cron: '10 * * * *',
      quiet: true,
      async run() {
        const result = await queueCaseReminders(db, { baseUrl });
        return { ...result, activity: result.emails };
      },
    },

    'key-expiry': {
      label: 'Data-feed key expiry check',
      description: 'Warns the operations mailbox when the Tenderbook key is about to expire.',
      enabled: Boolean(tenderbook.validTill),
      cron: '0 9 * * *',
      timezone: 'Asia/Kolkata',
      quiet: true,
      async run() {
        const daysLeft = Math.ceil((new Date(`${tenderbook.validTill}T23:59:59+05:30`).getTime() - Date.now()) / 86_400_000);
        if (daysLeft > 7 || !settings.opsAlertEmail) return { daysLeft, activity: 0 };
        const html = emailShell({
          title: 'Tender data key expiring',
          bodyHtml: `<p style="font-size:15px;"><b>The Tenderbook API key ${daysLeft < 0 ? 'has expired' : `expires in ${daysLeft} day(s)`}.</b></p>
            <p style="font-size:13px;">Tender data stops arriving when it lapses. Renew the subscription with the vendor and update TENDERBOOK_API_KEY on the server.</p>
            <p>${button('Open data feeds', `${baseUrl}/app/admin/ingestion`)}</p>`,
        });
        await db.withContext(SYSTEM, (q) => enqueueEmail(q, {
          kind: 'ops_alert', to: settings.opsAlertEmail, subject: `[procure-brain] Tenderbook key ${daysLeft < 0 ? 'expired' : `expires in ${daysLeft} day(s)`}`, html,
          idempotencyKey: `ops:key-expiry:${new Date().toISOString().slice(0, 10)}`,
        }));
        return { daysLeft, activity: 1 };
      },
    },

    housekeeping: {
      label: 'Housekeeping',
      description: 'Removes expired sessions and reset links, and old job history.',
      enabled: true,
      cron: '30 3 * * *',
      timezone: 'Asia/Kolkata',
      quiet: true,
      async run() {
        return db.withContext(SYSTEM, async (q) => {
          const sessions = await q.query(`DELETE FROM user_sessions WHERE expires_at < now() - interval '1 day'`);
          const tokens = await q.query(`DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '7 days' OR used_at < now() - interval '7 days'`);
          const jobs = await q.query(`DELETE FROM job_runs WHERE started_at < now() - interval '60 days'`);
          return { sessions: sessions.rowCount, resetTokens: tokens.rowCount, jobRuns: jobs.rowCount, activity: 0 };
        });
      },
    },
  };
}

/** Run one job, recording it. Quiet jobs that did nothing leave no trace in the history. */
export async function runJob(db, jobs, name, { trigger = 'schedule', args } = {}) {
  const job = jobs[name];
  if (!job) throw new Error(`Unknown job: ${name}`);
  const runId = await db.withContext(SYSTEM, async (q) =>
    (await q.one(`INSERT INTO job_runs (job, trigger) VALUES ($1, $2) RETURNING id`, [name, trigger])).id);
  try {
    const detail = await job.run(args);
    const idle = job.quiet && !detail?.activity && trigger === 'schedule';
    await db.withContext(SYSTEM, (q) =>
      idle
        ? q.query('DELETE FROM job_runs WHERE id = $1', [runId])
        : q.query(`UPDATE job_runs SET status = 'success', detail = $2::jsonb, finished_at = now() WHERE id = $1`, [runId, JSON.stringify(detail ?? {})]));
    return { ok: true, detail };
  } catch (err) {
    log.error('job failed', { job: name, error: err.message });
    await db.withContext(SYSTEM, (q) =>
      q.query(`UPDATE job_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [runId, String(err.message).slice(0, 1000)]));
    return { ok: false, error: err.message };
  }
}
