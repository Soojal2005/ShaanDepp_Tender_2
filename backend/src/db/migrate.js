/**
 * Forward-only SQL migration runner.
 *
 * Files in backend/migrations are applied in filename order, each in its own
 * transaction, and recorded in schema_migrations with a checksum. If an
 * already-applied file is later edited the runner refuses to continue: change
 * history by adding a new migration, never by rewriting an old one.
 *
 * Run it as `npm run migrate`. In production it must connect as a superuser or
 * the table owner (MIGRATION_DATABASE_URL).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, BACKEND_ROOT } from '../config.js';
import { createDatabase, closeDb } from './index.js';
import { log } from '../log.js';

const MIGRATIONS_DIR = path.join(BACKEND_ROOT, 'migrations');
const FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;

function checksum(sql) {
  return crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export function listMigrations(dir = MIGRATIONS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => {
      if (!FILE_PATTERN.test(f)) throw new Error(`Bad migration filename: ${f} (expected 001_name.sql)`);
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      return { version: f.slice(0, 3), name: f, sql, checksum: checksum(sql) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Give the runtime role a login password when one is configured. */
async function configureAppRole(admin, password) {
  if (!password) return;
  const literal = `'${password.replace(/'/g, "''")}'`;
  await admin.exec(`ALTER ROLE app_api_user WITH LOGIN PASSWORD ${literal}`);
}

/**
 * @param {Awaited<ReturnType<typeof createDatabase>>} db
 * @returns {Promise<{applied: string[], upToDate: boolean}>}
 */
export async function migrate(db, { dir = MIGRATIONS_DIR, appPassword = config.db.appPassword } = {}) {
  const run = (admin) => migrateConnection(admin, { dir, appPassword });
  return db.admin.withConnection ? db.admin.withConnection(run) : run(db.admin);
}

async function migrateConnection(admin, { dir, appPassword }) {
  // Hindi text, firm names and tender titles need a UTF-8 database; refuse to run on anything else.
  const encoding = (await admin.query('SHOW server_encoding')).rows[0]?.server_encoding;
  if (encoding && encoding.toUpperCase() !== 'UTF8') {
    throw new Error(`The database encoding is ${encoding}, but this application needs UTF8. Create the database with ENCODING 'UTF8'.`);
  }
  await admin.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const done = new Map(
    (await admin.query('SELECT version, name, checksum FROM schema_migrations')).rows.map((r) => [r.version, r])
  );
  const applied = [];

  for (const m of listMigrations(dir)) {
    const prior = done.get(m.version);
    if (prior) {
      if (prior.checksum !== m.checksum) {
        throw new Error(
          `Migration ${m.name} was modified after being applied. Add a new migration instead of editing it.`
        );
      }
      continue;
    }
    try {
      await admin.exec(
        `BEGIN;\n${m.sql}\n;INSERT INTO schema_migrations (version, name, checksum) VALUES ('${m.version}', '${m.name}', '${m.checksum}');\nCOMMIT;`
      );
    } catch (err) {
      await admin.exec('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${m.name} failed: ${err.message}`);
    }
    applied.push(m.name);
    log.info('migration applied', { name: m.name });
  }

  await configureAppRole(admin, appPassword);
  return { applied, upToDate: applied.length === 0 };
}

// CLI entry point: `node src/db/migrate.js`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = await createDatabase();
  try {
    const { applied, upToDate } = await migrate(db);
    console.log(upToDate ? 'Database is up to date.' : `Applied: ${applied.join(', ')}`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await db.close();
    await closeDb();
  }
}
