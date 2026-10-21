import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { GraphError, createGraphClient } from '../src/services/mail/graph.js';
import { parseBounce, pollBounces } from '../src/services/mail/bounces.js';
import { enqueueEmail } from '../src/services/mail/queue.js';
import { backoffSeconds, clearPause, drainQueue, getPause, queueCounts } from '../src/services/mail/sender.js';
import { SYSTEM, makeContext } from './helpers.js';

const response = (status, body = {}, headers = {}) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
});

describe('Microsoft Graph client', () => {
  const settings = { tenantId: 'tenant-1', clientId: 'client-1', clientSecret: 'S3CRET-VALUE', mailbox: 'alerts@procure-brain.com' };

  function harness(script) {
    const calls = [];
    let time = 1_000_000;
    const client = createGraphClient({
      ...settings, clock: () => time,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return script(url, init, calls.length);
      },
    });
    return { client, calls, advance: (ms) => { time += ms; } };
  }
  const tokenOk = () => response(200, { access_token: 'tok-' + Math.random(), expires_in: 3600 });
  const message = { to: 'ravi@client.test', subject: 'Hello', html: '<p>Hi</p>' };

  it('signs in with client credentials and sends from the shared mailbox, saving to Sent Items', async () => {
    const { client, calls } = harness((url) => (url.includes('oauth2') ? tokenOk() : response(202)));
    assert.deepEqual(await client.sendMail(message), { status: 202 });

    const [tokenCall, sendCall] = calls;
    assert.match(tokenCall.url, /login\.microsoftonline\.com\/tenant-1\/oauth2\/v2\.0\/token$/);
    const form = new URLSearchParams(String(tokenCall.init.body));
    assert.equal(form.get('grant_type'), 'client_credentials');
    assert.equal(form.get('scope'), 'https://graph.microsoft.com/.default');
    assert.equal(form.get('client_id'), 'client-1');

    assert.equal(sendCall.url, 'https://graph.microsoft.com/v1.0/users/alerts%40procure-brain.com/sendMail');
    assert.match(sendCall.init.headers.Authorization, /^Bearer tok-/);
    const body = JSON.parse(sendCall.init.body);
    assert.equal(body.saveToSentItems, true);
    assert.equal(body.message.subject, 'Hello');
    assert.deepEqual(body.message.body, { contentType: 'HTML', content: '<p>Hi</p>' });
    assert.equal(body.message.toRecipients[0].emailAddress.address, 'ravi@client.test');
    assert.equal(body.message.replyTo[0].emailAddress.address, 'alerts@procure-brain.com', 'replies come back to the shared mailbox');
  });

  it('reuses the access token until it nears expiry, then fetches a new one', async () => {
    const { client, calls, advance } = harness((url) => (url.includes('oauth2') ? tokenOk() : response(202)));
    await client.sendMail(message);
    await client.sendMail(message);
    assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1);
    advance(3600 * 1000);
    await client.sendMail(message);
    assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 2);
  });

  it('refreshes the token once on a 401 and then succeeds', async () => {
    let sends = 0;
    const { client, calls } = harness((url) => (url.includes('oauth2') ? tokenOk() : ++sends === 1 ? response(401) : response(202)));
    assert.deepEqual(await client.sendMail(message), { status: 202 });
    assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 2);
  });

  it('classifies failures so the queue can react correctly', async () => {
    const fail = (status, headers) => harness((url) => (url.includes('oauth2') ? tokenOk() : response(status, {}, headers))).client.sendMail(message);
    await assert.rejects(fail(429, { 'retry-after': '17' }), (e) => e instanceof GraphError && e.kind === 'throttled' && e.retryAfterSeconds === 17);
    await assert.rejects(fail(429, {}), (e) => e.kind === 'throttled' && e.retryAfterSeconds === null);
    await assert.rejects(fail(403), (e) => e.kind === 'systemic' && /Mail\.Send/.test(e.message));
    await assert.rejects(fail(401), (e) => e.kind === 'systemic');
    await assert.rejects(fail(503), (e) => e.kind === 'transient');
    await assert.rejects(fail(400), (e) => e.kind === 'permanent');
  });

  it('treats a rejected app credential as systemic, and never leaks the secret', async () => {
    const { client } = harness(() => response(401, { error: 'invalid_client', error_description: 'S3CRET-VALUE is wrong' }));
    await assert.rejects(client.sendMail(message), (e) => e.kind === 'systemic' && !e.message.includes('S3CRET-VALUE'));
  });

  it('treats network failures and timeouts as transient', async () => {
    const down = createGraphClient({ ...settings, fetchImpl: async () => { throw new Error('ECONNRESET S3CRET-VALUE'); } });
    await assert.rejects(down.sendMail(message), (e) => e.kind === 'transient' && !e.message.includes('S3CRET-VALUE'));
  });

  it('refuses to be created without full configuration', () => {
    assert.throws(() => createGraphClient({ ...settings, clientSecret: '' }), /not fully configured/);
  });
});

describe('sending the queue', () => {
  let ctx, outbox;
  const run = (fn) => ctx.db.withContext(SYSTEM, fn);
  // "Now" for the sender: a little after real time so freshly queued messages (due at the database's now()) are due.
  const T0 = new Date(Date.now() + 5 * 60_000);
  const live = { dryRun: false, perMinute: 5, perDay: 1000 };

  before(async () => { ctx = await makeContext(); });
  after(() => ctx.close());

  async function reset() {
    await run(async (q) => { await q.query('DELETE FROM email_delivery_logs'); await q.query('DELETE FROM email_queue'); await q.query('DELETE FROM email_bounce_records'); await clearPause(q); });
    outbox = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-'));
  }
  const queue = async (n, { kind = 'digest', to = (i) => `user${i}@client.test`, maxAttempts } = {}) => {
    await run(async (q) => {
      for (let i = 0; i < n; i++) {
        const id = await enqueueEmail(q, { kind, to: to(i), subject: `Subject ${i}`, html: `<p>Body ${i}</p>`, idempotencyKey: `${kind}:${Math.random()}` });
        if (maxAttempts) await q.query('UPDATE email_queue SET max_attempts = $2 WHERE id = $1', [id, maxAttempts]);
      }
    });
  };
  const statuses = () => run(async (q) => Object.fromEntries((await q.many('SELECT status, count(*)::int AS n FROM email_queue GROUP BY status')).map((r) => [r.status, r.n])));
  const okClient = () => { const sent = []; return { sent, mailbox: 'a@b.test', sendMail: async (m) => { sent.push(m); return { status: 202 }; } }; };
  const drain = (client, extra = {}) => drainQueue(ctx.db, { client, settings: live, outboxDir: outbox, now: T0, ...extra });

  it('dry run writes each message to the outbox and marks it dry_run, never sent', async () => {
    await reset();
    await queue(3);
    const stats = await drainQueue(ctx.db, { client: null, settings: { dryRun: true }, outboxDir: outbox, now: T0 });
    assert.equal(stats.dryRun, 3);
    assert.deepEqual(await statuses(), { dry_run: 3 });
    const files = fs.readdirSync(outbox);
    assert.equal(files.length, 3);
    const text = fs.readFileSync(path.join(outbox, files[0]), 'utf8');
    assert.match(text, /DRY RUN - not sent/);
    assert.match(text, /To: user\d@client\.test/);
    assert.match(text, /<p>Body \d<\/p>/);
    const log = await run((q) => q.many(`SELECT outcome FROM email_delivery_logs`));
    assert.ok(log.every((l) => l.outcome === 'dry_run'));
  });

  it('sends live messages through Graph, logs each, and records when they were sent', async () => {
    await reset();
    await queue(3);
    const client = okClient();
    const stats = await drain(client);
    assert.equal(stats.sent, 3);
    assert.deepEqual(client.sent.map((m) => m.subject), ['Subject 0', 'Subject 1', 'Subject 2']);
    assert.deepEqual(await statuses(), { sent: 3 });
    const logs = await run((q) => q.many(`SELECT outcome, response_code FROM email_delivery_logs`));
    assert.deepEqual(new Set(logs.map((l) => `${l.outcome}:${l.response_code}`)), new Set(['sent:202']));
  });

  it('stays inside Microsoft\'s per-minute limit and rolls the rest into later windows', async () => {
    await reset();
    await queue(12);
    const client = okClient();
    assert.equal((await drain(client)).sent, 5);
    assert.equal((await drain(client)).sent, 0, 'same minute: nothing more');
    assert.equal((await drain(client, { now: new Date(T0.getTime() + 61_000) })).sent, 5);
    assert.equal((await drain(client, { now: new Date(T0.getTime() + 122_000) })).sent, 2);
    assert.deepEqual(await statuses(), { sent: 12 });
    assert.equal(new Set(client.sent.map((m) => m.subject)).size, 12, 'no message sent twice');
  });

  it('stays inside the 24-hour limit', async () => {
    await reset();
    await queue(6);
    const client = okClient();
    const settings = { dryRun: false, perMinute: 100, perDay: 4 };
    assert.equal((await drainQueue(ctx.db, { client, settings, now: T0 })).sent, 4);
    assert.equal((await drainQueue(ctx.db, { client, settings, now: new Date(T0.getTime() + 3_600_000) })).sent, 0);
    assert.equal((await drainQueue(ctx.db, { client, settings, now: new Date(T0.getTime() + 25 * 3_600_000) })).sent, 2);
  });

  it('on a 429, honours Retry-After, pauses everything and does not count it as a failed attempt', async () => {
    await reset();
    await queue(4);
    let calls = 0;
    const client = { mailbox: 'a@b.test', sendMail: async () => { calls++; throw new GraphError('throttled', { kind: 'throttled', status: 429, retryAfterSeconds: 90 }); } };
    const stats = await drain(client);
    assert.equal(calls, 1, 'stops at the first 429 instead of hammering the service');
    assert.equal(stats.requeued, 4);
    assert.ok(stats.paused);
    assert.deepEqual(await statuses(), { queued: 4 });
    const attempts = await run((q) => q.many('SELECT attempts FROM email_queue'));
    assert.ok(attempts.every((a) => a.attempts === 0), 'throttling does not use up attempts');

    const during = await drain(okClient(), { now: new Date(T0.getTime() + 60_000) });
    assert.equal(during.sent, 0);
    assert.ok(during.paused, 'still paused 60s later');
    const client2 = okClient();
    assert.equal((await drain(client2, { now: new Date(T0.getTime() + 91_000) })).sent, 4);
    assert.equal(await run((q) => getPause(q, new Date(T0.getTime() + 91_000))), null);
  });

  it('retries transient failures with back-off and gives up after the maximum attempts', async () => {
    await reset();
    await queue(1, { maxAttempts: 2 });
    const failing = { mailbox: 'a@b.test', sendMail: async () => { throw new GraphError('Graph unavailable (HTTP 503)', { kind: 'transient', status: 503 }); } };
    const first = await drain(failing);
    assert.equal(first.retried, 1);
    const row = await run((q) => q.one('SELECT status, attempts, next_attempt_at, last_error FROM email_queue'));
    assert.equal(row.status, 'queued');
    assert.equal(row.attempts, 1);
    assert.equal(new Date(row.next_attempt_at).getTime(), T0.getTime() + 30_000, 'first back-off is 30 seconds');
    assert.equal((await drain(failing, { now: new Date(T0.getTime() + 10_000) })).retried, 0, 'not due yet');

    const second = await drain(failing, { now: new Date(T0.getTime() + 31_000) });
    assert.equal(second.failed, 1);
    assert.deepEqual(await statuses(), { failed: 1 });
    assert.match((await run((q) => q.one('SELECT last_error FROM email_queue'))).last_error, /503/);
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(backoffSeconds), [30, 60, 120, 240, 480, 900]);
  });

  it('stops a batch after repeated transient failures without burning the remaining attempts', async () => {
    await reset();
    await queue(8);
    const failing = { mailbox: 'a@b.test', sendMail: async () => { throw new GraphError('Graph unavailable', { kind: 'transient', status: 503 }); } };
    const stats = await drain(failing, { settings: { dryRun: false, perMinute: 100, perDay: 1000 } });
    assert.equal(stats.retried, 3);
    assert.equal(stats.requeued, 5);
    const rows = await run((q) => q.many('SELECT attempts FROM email_queue ORDER BY id'));
    assert.deepEqual(rows.map((r) => r.attempts), [1, 1, 1, 0, 0, 0, 0, 0]);
  });

  it('pauses on a permission problem, keeps the messages, and alerts operations once', async () => {
    await reset();
    await queue(3);
    const denied = { mailbox: 'a@b.test', sendMail: async () => { throw new GraphError('Microsoft Graph denied access (HTTP 403)', { kind: 'systemic', status: 403 }); } };
    const stats = await drain(denied);
    assert.ok(stats.paused);
    assert.match(stats.paused.reason, /denied access/);
    assert.deepEqual(await statuses(), { queued: 3, ...{} , queued: 3 + 1 });
    const alerts = await run((q) => q.many(`SELECT recipient, kind FROM email_queue WHERE kind = 'ops_alert'`));
    assert.deepEqual(alerts, [{ recipient: 'ops@test.local', kind: 'ops_alert' }]);
    await drain(denied, { now: new Date(T0.getTime() + 20 * 60_000) });
    assert.equal((await run((q) => q.one(`SELECT count(*)::int AS n FROM email_queue WHERE kind = 'ops_alert'`))).n, 1, 'one alert per hour, not one per retry');
  });

  it('marks a message the service refuses as failed and carries on with the rest', async () => {
    await reset();
    await queue(3);
    const client = { mailbox: 'a@b.test', sent: [], sendMail: async function (m) { if (m.subject === 'Subject 1') throw new GraphError('refused (HTTP 400)', { kind: 'permanent', status: 400 }); this.sent.push(m); return { status: 202 }; } };
    const stats = await drain(client);
    assert.deepEqual([stats.sent, stats.failed], [2, 1]);
    assert.deepEqual(await statuses(), { sent: 2, failed: 1 });
  });

  it('does not mail an address that has permanently bounced', async () => {
    await reset();
    await queue(2);
    await run((q) => q.query(`INSERT INTO email_bounce_records (recipient_email, bounce_type) VALUES ('user1@client.test', 'hard'), ('user0@client.test', 'soft')`));
    const client = okClient();
    const stats = await drain(client);
    assert.deepEqual([stats.sent, stats.suppressed], [1, 1]);
    assert.deepEqual(client.sent.map((m) => m.to), ['user0@client.test'], 'a soft bounce does not block mail');
  });

  it('sends account emails (password resets) ahead of bulk digests', async () => {
    await reset();
    await queue(3, { kind: 'digest' });
    await queue(1, { kind: 'password_reset', to: () => 'urgent@client.test' });
    const client = okClient();
    await drainQueue(ctx.db, { client, settings: { dryRun: false, perMinute: 1, perDay: 100 }, now: T0 });
    assert.deepEqual(client.sent.map((m) => m.to), ['urgent@client.test']);
  });

  it('recovers a message left "sending" by a crashed process', async () => {
    await reset();
    await queue(1);
    // Simulate a worker that died half-way: "sending" with an old timestamp (done as the table owner, bypassing the touch trigger).
    await ctx.db.admin.exec(`
      ALTER TABLE email_queue DISABLE TRIGGER trg_email_queue_touch;
      UPDATE email_queue SET status = 'sending', updated_at = '${T0.toISOString()}'::timestamptz - interval '30 minutes';
      ALTER TABLE email_queue ENABLE TRIGGER trg_email_queue_touch;`);
    const client = okClient();
    assert.equal((await drain(client)).sent, 1);
  });

  it('never sends a message twice when two workers drain at once', async () => {
    await reset();
    await queue(10);
    const client = okClient();
    const settings = { dryRun: false, perMinute: 100, perDay: 1000 };
    await Promise.all([drainQueue(ctx.db, { client, settings, now: T0 }), drainQueue(ctx.db, { client, settings, now: T0 })]);
    assert.equal(client.sent.length, 10);
    assert.equal(new Set(client.sent.map((m) => m.subject)).size, 10);
  });

  it('reports queue counts for the admin console', async () => {
    await reset();
    await queue(3);
    await drain(okClient());
    const counts = await run((q) => queueCounts(q, T0));
    assert.deepEqual([counts.byStatus.sent, counts.sentLastMinute, counts.sentLastDay], [3, 3, 3]);
  });

  it('is idempotent on the enqueue side', async () => {
    await reset();
    await run(async (q) => {
      const a = await enqueueEmail(q, { kind: 'digest', to: 'a@b.test', subject: 's', html: 'h', idempotencyKey: 'same-key' });
      const b = await enqueueEmail(q, { kind: 'digest', to: 'a@b.test', subject: 's', html: 'h', idempotencyKey: 'same-key' });
      assert.ok(a);
      assert.equal(b, null);
    });
    assert.deepEqual(await statuses(), { queued: 1 });
  });
});

describe('delivery-failure notices', () => {
  const own = 'alerts@procure-brain.com';
  const ndr = (o = {}) => ({
    id: 'm1', subject: 'Undeliverable: Tender alert', from: { emailAddress: { address: 'postmaster@outlook.com' } },
    body: { content: `<p>Your message to <b>Ghost@Client.test</b> couldn't be delivered. 550 5.1.1 user unknown. Original sender: ${own}</p>` }, ...o,
  });

  it('extracts the failed address and calls a missing mailbox a hard bounce', () => {
    const b = parseBounce(ndr(), own);
    assert.deepEqual([b.recipient, b.type], ['ghost@client.test', 'hard']);
    assert.ok(!b.diagnostic.includes('<p>'));
  });

  it('calls a full mailbox a soft bounce', () => {
    const b = parseBounce(ndr({ body: { content: 'Delivery to full@client.test failed: mailbox is full 4.2.2' } }), own);
    assert.deepEqual([b.recipient, b.type], ['full@client.test', 'soft']);
  });

  it('ignores ordinary mail, including replies from real people', () => {
    assert.equal(parseBounce({ id: 'x', subject: 'Re: Tender alert', from: { emailAddress: { address: 'ravi@client.test' } }, body: { content: 'Thanks, please call me' } }, own), null);
    assert.equal(parseBounce(ndr({ body: { content: `Only our own address ${own} appears` } }), own), null);
  });

  it('records bounces and marks only the notices as read', async () => {
    const ctx = await makeContext();
    const read = [];
    const client = {
      mailbox: own,
      unreadInbox: async () => [ndr(), { id: 'human', subject: 'Question about my alert', from: { emailAddress: { address: 'ravi@client.test' } }, body: { content: 'Hello' } }],
      markRead: async (id) => { read.push(id); },
    };
    const result = await pollBounces(ctx.db, client);
    assert.deepEqual(result, { checked: 2, bounces: 1 });
    assert.deepEqual(read, ['m1']);
    const rows = await ctx.db.withContext(SYSTEM, (q) => q.many('SELECT recipient_email, bounce_type FROM email_bounce_records'));
    assert.deepEqual(rows, [{ recipient_email: 'ghost@client.test', bounce_type: 'hard' }]);
    await ctx.close();
  });
});
