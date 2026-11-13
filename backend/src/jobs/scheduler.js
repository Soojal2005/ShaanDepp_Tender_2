/**
 * Starts the recurring jobs with croner. One API process is assumed (the
 * deployment runs a single container); overlapping runs of the same job are
 * prevented inside the process.
 */
import { Cron } from 'croner';
import { log } from '../log.js';
import { runJob } from './definitions.js';

const SYSTEM = { scope: 'system' };

// After a cold start (for example when a free host spins the service down
// between visits) a job whose whole interval has elapsed since its last
// success would otherwise sit idle until its next cron tick. For jobs marked
// catchUp we run one recovery pass shortly after boot so a missed feed sync or
// crawl happens as soon as the process is up again, rather than hours later.
const CATCHUP_DELAY_MS = 60_000;

export function startScheduler(db, jobs) {
  const timers = [];
  const overdue = [];
  for (const [name, job] of Object.entries(jobs)) {
    if (!job.enabled) {
      log.info('job disabled', { job: name });
      continue;
    }
    timers.push(
      new Cron(job.cron, { timezone: job.timezone ?? 'UTC', protect: true, name }, () => {
        runJob(db, jobs, name, { trigger: 'schedule' }).catch((err) => log.error('job crashed', { job: name, error: err.message }));
      })
    );
    log.info('job scheduled', { job: name, cron: job.cron, timezone: job.timezone ?? 'UTC' });
    if (job.catchUp && job.intervalMinutes) overdue.push(name);
  }

  // Delay the catch-up so the server finishes starting (and the health check
  // passes) first; unref() keeps these timers from holding the process open
  // during shutdown.
  const catchUpTimers = overdue.map((name) => {
    const t = setTimeout(() => {
      runCatchUp(db, jobs, name).catch((err) => log.error('catch-up failed', { job: name, error: err.message }));
    }, CATCHUP_DELAY_MS);
    t.unref?.();
    return t;
  });

  return {
    stop: () => {
      timers.forEach((t) => t.stop());
      catchUpTimers.forEach((t) => clearTimeout(t));
    },
    count: timers.length,
  };
}

/**
 * Run a catchUp job once if its interval has fully elapsed since the last
 * successful run (or it has never succeeded). Recorded as a normal scheduled
 * run so the admin history stays simple.
 */
export async function runCatchUp(db, jobs, name) {
  const job = jobs[name];
  if (!job?.enabled || !job.intervalMinutes) return { ran: false, reason: 'not-eligible' };
  const { last_success: lastSuccess } = await db.withContext(SYSTEM, (q) =>
    q.one(`SELECT max(started_at) AS last_success FROM job_runs WHERE job = $1 AND status = 'success'`, [name]));
  if (lastSuccess && Date.now() - new Date(lastSuccess).getTime() < job.intervalMinutes * 60_000) {
    return { ran: false, reason: 'fresh', lastSuccess };
  }
  log.info('running catch-up for overdue job', { job: name, lastSuccess: lastSuccess ?? null });
  const result = await runJob(db, jobs, name, { trigger: 'schedule' });
  return { ran: true, lastSuccess: lastSuccess ?? null, result };
}
