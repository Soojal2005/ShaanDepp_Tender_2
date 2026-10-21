/**
 * Process entry point: configuration -> database -> migrations -> baseline
 * data -> HTTP server (and, once enabled, the background jobs).
 */
import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb, getDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { seedBaseline } from './db/seed.js';
import { log } from './log.js';

const db = await getDb();
const { applied } = await migrate(db);
if (applied.length) log.info('database migrated', { applied });
await seedBaseline(db);

const app = createApp({ db });
const server = app.listen(config.port, () => {
  log.info('API listening', {
    port: config.port,
    env: config.env,
    database: db.kind,
    mail: config.mail.dryRun ? 'dry_run' : 'live',
    tenderbookSync: config.tenderbook.enabled,
  });
});

async function shutdown(signal) {
  log.info('shutting down', { signal });
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
