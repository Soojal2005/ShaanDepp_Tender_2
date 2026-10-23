/**
 * Keeps prisma/schema.prisma in step with backend/migrations.
 *
 * The SQL migrations stay the single source of truth (they carry row-level security, roles and
 * functions that Prisma cannot express). This script builds a scratch database from them,
 * introspects it with `prisma db pull`, and either rewrites schema.prisma (default) or fails
 * if it is out of date (--check). It needs a PostgreSQL URL with CREATE DATABASE/ROLE
 * privileges in PRISMA_SYNC_PG_URL (or TEST_PG_URL), e.g. postgres://postgres:pw@localhost:5432/postgres.
 * The scratch database is dropped afterwards.
 */
process.env.NODE_ENV = 'test';

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaFile = path.join(root, 'prisma', 'schema.prisma');
const check = process.argv.includes('--check');

const base = process.env.PRISMA_SYNC_PG_URL || process.env.TEST_PG_URL;
if (!base) {
  console.error('Set PRISMA_SYNC_PG_URL to a PostgreSQL URL with CREATE DATABASE/ROLE permissions (a scratch database is created and dropped).');
  process.exit(2);
}

const { createDatabase } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');

const name = `prisma_sync_${Date.now().toString(36)}`;
const admin = new pg.Client({ connectionString: base });
await admin.connect();
let exitCode = 0;
try {
  await admin.query(`CREATE DATABASE ${name} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  const url = new URL(base);
  url.pathname = `/${name}`;

  const db = await createDatabase({ driver: 'pg', url: url.toString(), migrationUrl: url.toString() });
  try {
    await migrate(db, { appPassword: undefined });
  } finally {
    await db.close();
  }

  const prisma = (...args) =>
    spawnSync(process.execPath, [path.join(root, 'node_modules', 'prisma', 'build', 'index.js'), ...args], {
      cwd: root,
      env: { ...process.env, PRISMA_DATABASE_URL: url.toString() },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

  const pulled = prisma('db', 'pull', '--print');
  if (pulled.status !== 0) {
    console.error(pulled.stderr || pulled.stdout);
    throw new Error('prisma db pull failed');
  }
  const next = pulled.stdout.replace(/\r\n/g, '\n').trimEnd() + '\n';
  const current = fs.existsSync(schemaFile) ? fs.readFileSync(schemaFile, 'utf8').replace(/\r\n/g, '\n') : '';

  if (check) {
    if (next !== current) {
      console.error('prisma/schema.prisma is out of date with backend/migrations. Run: npm run db:schema');
      exitCode = 1;
    } else {
      console.log('prisma/schema.prisma matches the migrations.');
    }
  } else {
    if (next !== current) fs.writeFileSync(schemaFile, next);
    const generated = prisma('generate');
    if (generated.status !== 0) {
      console.error(generated.stderr || generated.stdout);
      throw new Error('prisma generate failed');
    }
    console.log(next === current ? 'Schema already up to date; client regenerated.' : 'prisma/schema.prisma updated; client regenerated.');
  }
} catch (err) {
  console.error(err.message);
  exitCode = 1;
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
  await admin.end();
}
process.exit(exitCode);
