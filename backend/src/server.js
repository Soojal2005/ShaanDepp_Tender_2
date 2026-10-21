/**
 * Process entry point: configuration -> database -> migrations -> baseline
 * data -> background jobs -> HTTP server.
 */
import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb, getDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { DEMO_PASSWORD, seedBaseline, seedDemo } from './db/seed.js';
import { createJobs } from './jobs/definitions.js';
import { startScheduler } from './jobs/scheduler.js';
import { log } from './log.js';

const db = await getDb();
const { applied } = await migrate(db);
if (applied.length) log.info('database migrated', { applied });
await seedBaseline(db);
if (config.seedDemo) {
  await seedDemo(db);
  log.warn('demo accounts available (development only)', { password: DEMO_PASSWORD });
}

const jobs = createJobs(db);
const scheduler = config.jobsEnabled ? startScheduler(db, jobs) : null;

const app = createApp({ db, jobs, schedulerRunning: Boolean(scheduler) });
const server = app.listen(config.port, () => {
  log.info('API listening', {
    port: config.port,
    env: config.env,
    database: db.kind,
    mail: config.mail.dryRun ? 'dry_run' : 'live',
    tenderbookSync: config.tenderbook.enabled,
    jobs: scheduler ? scheduler.count : 'off',
  });
});

async function shutdown(signal) {
  log.info('shutting down', { signal });
  scheduler?.stop();
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
