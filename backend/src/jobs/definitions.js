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
import { pruneExpiredTenders } from '../services/ingestion/prune.js';
import { createTenderbookClient } from '../services/ingestion/tenderbook.js';
import { createCpppClient } from '../services/ingestion/sources/cppp/cppp.js';
import { createCpppBrowserClient } from '../services/ingestion/sources/cppp/browser.js';
import { normalizeCpppTender } from '../services/ingestion/sources/cppp/normalize.js';
import { enabledPortals, portalClientOptions } from '../services/ingestion/sources/cppp/portals.js';
import { createNprocureClient } from '../services/ingestion/sources/nprocure/nprocure.js';
import { createBiharClient } from '../services/ingestion/sources/bihar/bihar.js';
import { createVupadhiClient } from '../services/ingestion/sources/vupadhi/vupadhi.js';
import { runEnrichment } from '../services/enrichment/runner.js';
import { generateForOrganizations } from '../services/bundle/index.js';
import { queueCaseReminders } from '../services/caseReminders.js';
import { queueWatchlistReminders } from '../services/reminders.js';

const SYSTEM = { scope: 'system' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    crawler = config.crawler,
    enrichment = config.enrichment,
    prune = config.prune,
    // Build a crawler client for one portal. Most portals are GePNIC; some run
    // their own software and get a dedicated adapter (selected by portal.adapter).
    makeCrawlerClient = (portal, extra = {}) => {
      if (portal.adapter === 'nprocure') return createNprocureClient({ baseUrl: portal.baseUrl, state: portal.state });
      if (portal.adapter === 'bihar') return createBiharClient({ baseUrl: portal.baseUrl, state: portal.state });
      if (portal.adapter === 'vupadhi') return createVupadhiClient({ baseUrl: portal.baseUrl, state: portal.state });
      const opts = { ...portalClientOptions(portal), ...extra };
      return crawler.engine === 'http' ? createCpppClient(opts) : createCpppBrowserClient(opts);
    },
    portals = enabledPortals(),
  } = deps;

  return {
    ingest: {
      label: 'Tender feed sync',
      description: 'Pulls new and changed tenders, then results, from Tenderbook.',
      enabled: tenderbook.enabled,
      // Recover a missed run after a cold start (see scheduler catch-up).
      catchUp: true,
      intervalMinutes: tenderbook.intervalMinutes,
      cron: tenderbook.intervalMinutes >= 60 ? `0 */${Math.max(1, Math.round(tenderbook.intervalMinutes / 60))} * * *` : `*/${tenderbook.intervalMinutes} * * * *`,
      async run() {
        const client = makeTenderbookClient();
        const tenders = await runIngestion(db, { kind: 'tenders', trigger: 'schedule', client });
        const results = await runIngestion(db, { kind: 'results', trigger: 'schedule', client });
        return { tenders: { status: tenders.status, inserted: tenders.inserted, updated: tenders.updated }, results: { status: results.status, inserted: results.inserted } };
      },
    },

    'crawl-gepnic': {
      label: 'Government portal crawl (GePNIC)',
      description: 'Scrapes the captcha-free "Tenders by Closing Date" listing from every enabled government portal (CPPP + state portals on NIC GePNIC).',
      enabled: crawler.enabled,
      // Recover a missed crawl after a cold start (see scheduler catch-up).
      catchUp: true,
      intervalMinutes: crawler.intervalMinutes,
      cron: crawler.intervalMinutes >= 60 ? `0 */${Math.max(1, Math.round(crawler.intervalMinutes / 60))} * * *` : `*/${crawler.intervalMinutes} * * * *`,
      timezone: 'Asia/Kolkata',
      async run({ only } = {}) {
        const targets = only ? portals.filter((p) => p.id === only) : portals;
        const results = [];
        let inserted = 0;
        let updated = 0;
        const gap = crawler.requestDelayMs ?? 1500;
        // These portals are slow and occasionally time out, so retry a portal once
        // before giving up, and pace between portals to stay polite.
        const crawlOnce = async (portal) => {
          // When detail-capture is on, fetch detail pages only for tenders we do
          // not already have, so each run adds the missing fields to new tenders
          // without re-walking everything already stored.
          let extra = {};
          if (crawler.fetchDetails) {
            const known = await db.withContext(SYSTEM, (q) =>
              q.many('SELECT source_id FROM tenders WHERE provider_id = $1', [portal.id]));
            extra = { fetchDetails: true, maxDetails: crawler.maxDetails, knownSourceIds: new Set(known.map((r) => r.source_id)) };
          }
          const client = makeCrawlerClient(portal, extra);
          const normalize = (dto) => normalizeCpppTender(portal.state ? { state: portal.state, ...dto } : dto);
          return runIngestion(db, { providerId: portal.id, kind: 'tenders', trigger: 'schedule', client, normalize });
        };
        for (const portal of targets) {
          let r = null;
          let error = null;
          for (let attempt = 0; attempt < 2 && (r === null || r.status === 'failed'); attempt++) {
            if (attempt) await sleep(gap * 2);
            try { r = await crawlOnce(portal); error = null; }
            catch (err) { error = err.message; r = null; log.warn('portal crawl error', { portal: portal.id, attempt, error: err.message }); }
          }
          if (r) { inserted += r.inserted; updated += r.updated; results.push({ portal: portal.id, status: r.status, inserted: r.inserted, updated: r.updated, errors: r.errors }); }
          else results.push({ portal: portal.id, status: 'failed', error });
          await sleep(gap);
        }
        const failed = results.filter((r) => r.status === 'failed').length;
        return { portals: targets.length, failed, inserted, updated, activity: inserted + updated, results };
      },
    },

    'enrich-tenders': {
      label: 'Tender PDF enrichment',
      description: 'Reads estimated value, EMD and tender fee from tender notice PDFs to fill the money fields the listings omit, then discards the file.',
      enabled: enrichment.enabled,
      catchUp: true,
      intervalMinutes: enrichment.intervalMinutes,
      cron: enrichment.intervalMinutes >= 60 ? `0 */${Math.max(1, Math.round(enrichment.intervalMinutes / 60))} * * *` : `*/${enrichment.intervalMinutes} * * * *`,
      timezone: 'Asia/Kolkata',
      async run({ providerId, maxDocs } = {}) {
        const result = await runEnrichment(db, { providerId, maxDocs });
        return { ...result, activity: result.filled + result.review };
      },
    },

    'prune-expired-tenders': {
      label: 'Prune expired tenders',
      description: 'Deletes tenders whose deadline has passed, keeping any a user has watchlisted or raised a submission case for so those users still see them.',
      enabled: prune.enabled,
      catchUp: true,
      intervalMinutes: prune.intervalMinutes,
      cron: prune.intervalMinutes >= 60 ? `0 */${Math.max(1, Math.round(prune.intervalMinutes / 60))} * * *` : `*/${prune.intervalMinutes} * * * *`,
      timezone: 'Asia/Kolkata',
      async run() {
        const result = await pruneExpiredTenders(db, { graceDays: prune.graceDays });
        return { ...result, activity: result.deleted };
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
