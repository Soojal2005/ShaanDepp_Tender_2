/**
 * Starts the recurring jobs with croner. One API process is assumed (the
 * deployment runs a single container); overlapping runs of the same job are
 * prevented inside the process.
 */
import { Cron } from 'croner';
import { log } from '../log.js';
import { runJob } from './definitions.js';

export function startScheduler(db, jobs) {
  const timers = [];
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
  }
  return { stop: () => timers.forEach((t) => t.stop()), count: timers.length };
}
