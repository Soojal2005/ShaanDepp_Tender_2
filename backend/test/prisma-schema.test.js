import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/prisma-sync.mjs');

test(
  'prisma/schema.prisma matches the migrations (run `npm run db:schema` after adding a migration)',
  { skip: process.env.TEST_PG_URL ? false : 'needs TEST_PG_URL (a real PostgreSQL server)', timeout: 180000 },
  () => {
    const run = spawnSync(process.execPath, [script, '--check'], {
      env: { ...process.env, PRISMA_SYNC_PG_URL: process.env.TEST_PG_URL },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
  }
);
