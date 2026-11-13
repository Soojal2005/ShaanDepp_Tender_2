/**
 * Catch-up runs: after a cold start, an overdue catchUp job should run once,
 * while a job that ran within its interval should be left alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeContext, SYSTEM } from './helpers.js';
import { runCatchUp } from '../src/jobs/scheduler.js';

function fakeJob({ enabled = true, intervalMinutes = 120, catchUp = true } = {}) {
  const calls = [];
  const job = {
    label: 'Fake', enabled, intervalMinutes, catchUp, cron: '0 */2 * * *',
    async run(args) { calls.push(args ?? {}); return { activity: 1 }; },
  };
  return { job, calls };
}

const recordRun = (db, name, startedAt) =>
  db.withContext(SYSTEM, (q) =>
    q.query(
      `INSERT INTO job_runs (job, trigger, status, started_at, finished_at) VALUES ($1, 'schedule', 'success', $2, $2)`,
      [name, startedAt]
    ));

test('runs an overdue job that has never succeeded', async () => {
  const ctx = await makeContext();
  try {
    const { job, calls } = fakeJob();
    const out = await runCatchUp(ctx.db, { 'crawl-gepnic': job }, 'crawl-gepnic');
    assert.equal(out.ran, true);
    assert.equal(calls.length, 1);
    const row = await ctx.db.withContext(SYSTEM, (q) =>
      q.one(`SELECT status, trigger FROM job_runs WHERE job = 'crawl-gepnic' ORDER BY id DESC LIMIT 1`));
    assert.equal(row.status, 'success');
    assert.equal(row.trigger, 'schedule');
  } finally {
    await ctx.close();
  }
});

test('runs a job whose last success is older than its interval', async () => {
  const ctx = await makeContext();
  try {
    const { job, calls } = fakeJob({ intervalMinutes: 120 });
    await recordRun(ctx.db, 'crawl-gepnic', new Date(Date.now() - 3 * 3600_000).toISOString());
    const out = await runCatchUp(ctx.db, { 'crawl-gepnic': job }, 'crawl-gepnic');
    assert.equal(out.ran, true);
    assert.equal(calls.length, 1);
  } finally {
    await ctx.close();
  }
});

test('skips a job that succeeded within its interval', async () => {
  const ctx = await makeContext();
  try {
    const { job, calls } = fakeJob({ intervalMinutes: 120 });
    await recordRun(ctx.db, 'crawl-gepnic', new Date(Date.now() - 10 * 60_000).toISOString());
    const out = await runCatchUp(ctx.db, { 'crawl-gepnic': job }, 'crawl-gepnic');
    assert.equal(out.ran, false);
    assert.equal(out.reason, 'fresh');
    assert.equal(calls.length, 0);
  } finally {
    await ctx.close();
  }
});

test('ignores a disabled job', async () => {
  const ctx = await makeContext();
  try {
    const { job, calls } = fakeJob({ enabled: false });
    const out = await runCatchUp(ctx.db, { 'crawl-gepnic': job }, 'crawl-gepnic');
    assert.equal(out.ran, false);
    assert.equal(out.reason, 'not-eligible');
    assert.equal(calls.length, 0);
  } finally {
    await ctx.close();
  }
});
