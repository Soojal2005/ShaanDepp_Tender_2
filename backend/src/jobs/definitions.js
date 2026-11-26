/**
 * The background jobs. Each job is a plain async function so it can be run by
 * the scheduler, by an administrator ("run now"), or by a test, and each run
 * is recorded in job_runs for the admin console.
 */
import { config } from '../config.js';
import { log } from '../log.js';
import { runDueDigests } from '../services/alerts/digest.js';
import { seedProfilesFromSearches } from '../services/alerts/searchSeed.js';
import { pollBounces } from '../services/mail/bounces.js';
import { createGraphClient } from '../services/mail/graph.js';
import { createSmtpClient } from '../services/mail/smtp.js';
import { drainQueue } from '../services/mail/sender.js';
import { button, emailShell } from '../services/mail/html.js';
import { enqueueEmail } from '../services/mail/queue.js';
import { runIngestion } from '../services/ingestion/runner.js';
import { pruneExpiredTenders } from '../services/ingestion/prune.js';
import { createTenderbookClient } from '../services/ingestion/tenderbook.js';
import { createCpppClient } from '../services/ingestion/sources/cppp/cppp.js';
import { createCpppBrowserClient } from '../services/ingestion/sources/cppp/browser.js';
import { normalizeCpppTender } from '../services/ingestion/sources/cppp/normalize.js';
import { portalById, portalClientOptions, sweepPortals } from '../services/ingestion/sources/cppp/portals.js';
import { GEM_BASE_URL, createGemClient } from '../services/ingestion/sources/gem/gem.js';
import { normalizeGemTender } from '../services/ingestion/sources/gem/normalize.js';
import { createNprocureClient } from '../services/ingestion/sources/nprocure/nprocure.js';
import { createBiharClient } from '../services/ingestion/sources/bihar/bihar.js';
import { createVupadhiClient } from '../services/ingestion/sources/vupadhi/vupadhi.js';
import { createIsroClient } from '../services/ingestion/sources/isro/isro.js';
import { createPowergridClient } from '../services/ingestion/sources/powergrid/powergrid.js';
import { createHpclClient } from '../services/ingestion/sources/hpcl/hpcl.js';
import { createBpclClient } from '../services/ingestion/sources/bpcl/bpcl.js';
import { createCpwdClient } from '../services/ingestion/sources/cpwd/cpwd.js';
import { runEnrichment } from '../services/enrichment/runner.js';
import { generateForOrganizations } from '../services/bundle/index.js';
import { queueCaseReminders } from '../services/caseReminders.js';
import { queueWatchlistReminders } from '../services/reminders.js';

const SYSTEM = { scope: 'system' };
const GEM_PROVIDER_ID = 'gem';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param db database
 * @param deps overridable collaborators (tests pass fakes)
 */
export function createJobs(db, deps = {}) {
  const {
    settings = config.mail,
    baseUrl = config.publicBaseUrl,
    // Pick the live transport by config: Hostinger SMTP (default) or Microsoft Graph.
    makeMailClient = () => (settings.dryRun ? null : settings.transport === 'smtp' ? createSmtpClient() : createGraphClient()),
    makeTenderbookClient = createTenderbookClient,
    tenderbook = config.tenderbook,
    crawler = config.crawler,
    enrichment = config.enrichment,
    prune = config.prune,
    gem = config.gem,
    makeGemClient = createGemClient,
    // PDF enrichment step of the GeM job (tests inject a fake).
    enrichGem = (opts) => runEnrichment(db, opts),
    // Build a crawler client for one portal. Most portals are GePNIC; some run
    // their own software and get a dedicated adapter (selected by portal.adapter).
    makeCrawlerClient = (portal, extra = {}) => {
      if (portal.adapter === 'nprocure') return createNprocureClient({ baseUrl: portal.baseUrl, state: portal.state });
      if (portal.adapter === 'bihar') return createBiharClient({ baseUrl: portal.baseUrl, state: portal.state });
      if (portal.adapter === 'vupadhi') return createVupadhiClient({ baseUrl: portal.baseUrl, state: portal.state });
      if (portal.adapter === 'isro') return createIsroClient({ baseUrl: portal.baseUrl, state: portal.state });
      if (portal.adapter === 'powergrid') return createPowergridClient({ baseUrl: portal.baseUrl, state: portal.state });
      if (portal.adapter === 'hpcl') return createHpclClient({ baseUrl: portal.baseUrl, state: portal.state });
      if (portal.adapter === 'bpcl') return createBpclClient({ baseUrl: portal.baseUrl, state: portal.state });
      if (portal.adapter === 'cpwd') return createCpwdClient({ baseUrl: portal.baseUrl, state: portal.state });
      const opts = { ...portalClientOptions(portal), ...extra };
      return crawler.engine === 'http' ? createCpppClient(opts) : createCpppBrowserClient(opts);
    },
    // GeM is in the registry (provider row, document proxy, portal link) but has
    // its own job, so the shared sweep leaves it out.
    portals = sweepPortals(),
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
          // When detail-capture is on, fetch detail pages for tenders still missing
          // them: brand-new tenders AND open tenders crawled before (back-fill of the
          // money/category fields). Skip tenders already detailed (source_url set) or
          // already closed, so no run re-walks finished work; capped per run. Only
          // GePNIC portals do this — the custom adapters ignore these options.
          let extra = {};
          if (crawler.fetchDetails && !portal.adapter) {
            const done = await db.withContext(SYSTEM, (q) =>
              q.many('SELECT source_id FROM tenders WHERE provider_id = $1 AND (source_url IS NOT NULL OR submission_deadline < now())', [portal.id]));
            extra = { fetchDetails: true, maxDetails: crawler.maxDetails, knownSourceIds: new Set(done.map((r) => r.source_id)) };
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

    'crawl-gem': {
      label: 'GeM bid crawl',
      description: 'Reads the live bids on GeM (bidplus.gem.gov.in) one closing day at a time, resuming where the last run stopped, so every bid is picked up and refreshed (new bids, extended deadlines) every few hours; then reads EMD and estimated value from bid PDFs.',
      enabled: Boolean(crawler.enabled && gem.enabled),
      // Recover a missed crawl after a cold start (see scheduler catch-up).
      catchUp: true,
      intervalMinutes: gem.intervalMinutes,
      cron: gem.intervalMinutes >= 60 ? `0 */${Math.max(1, Math.round(gem.intervalMinutes / 60))} * * *` : `*/${gem.intervalMinutes} * * * *`,
      timezone: 'Asia/Kolkata',
      async run({ maxPages, enrichMaxDocs } = {}) {
        const portal = portalById(GEM_PROVIDER_ID);
        // Resume the sweep from the cursor the previous run reported (kept in its
        // ingestion_runs.health). No cursor yet = start at today's closing bids.
        const last = await db.withContext(SYSTEM, (q) => q.maybeOne(
          `SELECT health->'source'->'cursor' AS cursor FROM ingestion_runs
            WHERE provider_id = $1 AND kind = 'tenders' AND status <> 'running'
              AND health->'source'->'cursor' IS NOT NULL
            ORDER BY id DESC LIMIT 1`, [GEM_PROVIDER_ID]));
        const client = makeGemClient({
          baseUrl: portal?.baseUrl ?? GEM_BASE_URL,
          cursor: last?.cursor ?? null,
          maxPages: maxPages ?? gem.maxPages,
          requestDelayMs: gem.requestDelayMs,
          userAgent: crawler.userAgent,
          timeoutMs: crawler.timeoutMs,
        });
        const r = await runIngestion(db, {
          providerId: GEM_PROVIDER_ID, kind: 'tenders', trigger: 'schedule', client, normalize: normalizeGemTender,
          // The client paces its own requests and ends the run with a short batch.
          pageSize: 100, maxPages: 100_000, pageDelayMs: 0,
        });
        const sweep = client.report?.() ?? {};
        if (r.status === 'failed') throw new Error(`GeM crawl failed: ${r.error ?? r.warnings?.[0] ?? 'no bids were read'}`);

        // The listing publishes no money; each bid's public PDF carries the EMD and,
        // when the buyer discloses it, the estimated bid value. Fill those for the
        // GeM bids still missing them (bounded per run; failures never sink the crawl).
        const docs = enrichMaxDocs ?? gem.enrichMaxDocs;
        let enrichment = null;
        if (docs > 0) {
          try { enrichment = await enrichGem({ providerId: GEM_PROVIDER_ID, maxDocs: docs }); }
          catch (err) { log.warn('gem enrichment failed', { error: err.message }); enrichment = { error: err.message }; }
        }
        return {
          status: r.status, inserted: r.inserted, updated: r.updated, skipped: r.skipped, errors: r.errors,
          requests: sweep.requests, liveBids: sweep.total, bidsSeen: sweep.bidsSeen,
          skippedReverseAuctions: sweep.skippedReverseAuctions, daysVisited: sweep.daysVisited,
          cycleComplete: sweep.cycleComplete, stoppedBy: sweep.stoppedBy, cursor: sweep.cursor,
          enrichment,
          activity: r.inserted + r.updated + (enrichment?.filled ?? 0),
        };
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

    'seed-search-alerts': {
      label: 'Search-based alerts',
      description: 'Creates a starter daily alert from each subscriber\'s most frequent portal searches (once per subscriber).',
      enabled: true,
      cron: '30 6 * * *',
      timezone: 'Asia/Kolkata',
      quiet: true,
      async run() {
        const summary = await seedProfilesFromSearches(db);
        return { ...summary, activity: summary.created };
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
      // Bounce polling reads the Graph mailbox inbox; it only applies to the Graph transport.
      enabled: settings.pollBounces && !settings.dryRun && settings.transport === 'graph',
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
