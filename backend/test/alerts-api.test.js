import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { sendDigestForProfile } from '../src/services/alerts/digest.js';
import { runJob } from '../src/jobs/definitions.js';
import { queueWatchlistReminders } from '../src/services/reminders.js';
import { DAY, SYSTEM, createOrg, createUser, makeContext, seedTenders, signIn, tenderDto } from './helpers.js';

describe('alert profile API', () => {
  let ctx, orgA, orgB, a, b, admin, masters;
  const run = (fn) => ctx.db.withContext(SYSTEM, fn);

  before(async () => {
    ctx = await makeContext();
    orgA = await createOrg(ctx.db, { name: 'Org A', planCode: 'basic' }); // basic: 2 profiles
    orgB = await createOrg(ctx.db, { name: 'Org B', planCode: 'premium' });
    await createUser(ctx.db, { orgId: orgA, email: 'a@a.test', role: 'tenant_admin' });
    await createUser(ctx.db, { orgId: orgB, email: 'b@b.test', role: 'tenant_admin' });
    a = await signIn(ctx.app, 'a@a.test');
    b = await signIn(ctx.app, 'b@b.test');
    admin = await signIn(ctx.app, 'admin@test.local');
    masters = (await a.get('/masters')).body;
  });
  after(() => ctx.close());

  it('creates a profile, defaulting the recipient to the creator', async () => {
    const res = await a.post('/alert-profiles').send({ name: 'Water meters', keywords: ['water meter'], excludeKeywords: ['cctv'], valueMin: 1_000_000 });
    assert.equal(res.status, 201);
    const p = res.body.profile;
    assert.deepEqual([p.frequency, p.status, p.includeUnknownValue, p.recipientEmails], ['daily', 'active', true, ['a@a.test']]);
    assert.deepEqual(p.keywords, ['water meter']);
    assert.equal((await a.get('/alert-profiles')).body.profiles.length, 1);
  });

  it('updates only the fields sent and can pause and resume', async () => {
    const [{ id }] = (await a.get('/alert-profiles')).body.profiles;
    const state = masters.states.find((s) => s.name === 'Madhya Pradesh').id;
    const res = await a.patch(`/alert-profiles/${id}`).send({ stateIds: [state], frequency: 'weekly', weeklyDay: 5 });
    assert.deepEqual([res.body.profile.keywords, res.body.profile.stateIds, res.body.profile.frequency], [['water meter'], [state], 'weekly']);
    assert.equal((await a.patch(`/alert-profiles/${id}`).send({ status: 'paused' })).body.profile.status, 'paused');
    assert.equal((await a.patch(`/alert-profiles/${id}`).send({ status: 'active' })).body.profile.status, 'active');
  });

  it('validates input and rejects master ids that do not exist', async () => {
    for (const body of [{}, { name: 'x', frequency: 'hourly' }, { name: 'x', valueMin: 9, valueMax: 1 }, { name: 'x', recipientEmails: ['nope'] }, { name: 'x', departmentIds: [999999] }, { name: 'x', keywords: Array(40).fill('k') }]) {
      assert.equal((await a.post('/alert-profiles').send(body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
    const [{ id }] = (await a.get('/alert-profiles')).body.profiles;
    assert.equal((await a.patch(`/alert-profiles/${id}`).send({ valueMin: 10, valueMax: 1 })).status, 400);
  });

  it('keeps each organization\'s profiles private', async () => {
    const [{ id }] = (await a.get('/alert-profiles')).body.profiles;
    assert.equal((await b.get('/alert-profiles')).body.profiles.length, 0);
    assert.equal((await b.patch(`/alert-profiles/${id}`).send({ name: 'hijack' })).status, 404);
    assert.equal((await b.delete(`/alert-profiles/${id}`)).status, 404);
    assert.equal((await b.get(`/alert-profiles/${id}/preview`)).status, 404);
    assert.equal((await b.post(`/alert-profiles/${id}/test`)).status, 404);
    assert.equal((await a.get('/alert-profiles')).body.profiles[0].name, 'Water meters');
  });

  it('enforces the plan\'s profile limit, even for simultaneous requests', async () => {
    assert.equal((await a.post('/alert-profiles').send({ name: 'Second' })).status, 201);
    const third = await a.post('/alert-profiles').send({ name: 'Third' });
    assert.equal(third.status, 409);
    assert.match(third.body.error.message, /plan allows 2 alert profiles/);

    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => b.post('/alert-profiles').send({ name: `P${i}` })));
    assert.equal(results.filter((r) => r.status === 201).length, 6, 'premium allows 10');
    const raceOrg = await createOrg(ctx.db, { name: 'Race', planCode: 'basic' });
    await createUser(ctx.db, { orgId: raceOrg, email: 'r@r.test', role: 'tenant_admin' });
    const r = await signIn(ctx.app, 'r@r.test');
    const raced = await Promise.all(Array.from({ length: 5 }, (_, i) => r.post('/alert-profiles').send({ name: `R${i}` })));
    assert.deepEqual(raced.map((x) => x.status).sort(), [201, 201, 409, 409, 409]);
  });

  it('deletes a profile, freeing a slot', async () => {
    const second = (await a.get('/alert-profiles')).body.profiles.find((p) => p.name === 'Second');
    assert.equal((await a.delete(`/alert-profiles/${second.id}`)).status, 204);
    assert.equal((await a.delete(`/alert-profiles/${second.id}`)).status, 404);
    assert.equal((await a.post('/alert-profiles').send({ name: 'Replacement' })).status, 201);
  });

  it('turns a search into an alert', async () => {
    const res = await b.post('/alert-profiles/from-filters').send({ name: 'From search', frequency: 'alternate_day', filters: { q: 'solar "street lights" -cctv', status: 'open', departmentIds: [masters.departments[0].id] } });
    assert.equal(res.status, 201);
    assert.deepEqual([res.body.profile.keywords, res.body.profile.excludeKeywords, res.body.profile.frequency], [['solar', 'street lights'], ['cctv'], 'alternate_day']);
    assert.equal((await b.post('/alert-profiles/from-filters').send({ name: 'bad', filters: { valueMin: 'abc' } })).status, 400);
  });

  describe('test send, preview and history', () => {
    let profileId;
    before(async () => {
      await seedTenders(ctx.db, [tenderDto({ tender_summary: 'Gadolinium reactor shielding works' }), tenderDto({ tender_summary: 'Gadolinium coating supply', pubDaysAgo: 0 })]);
      profileId = (await b.post('/alert-profiles').send({ name: 'Gadolinium', keywords: ['gadolinium'] })).body.profile.id;
    });

    it('previews what the next digest holds without recording anything', async () => {
      const { preview } = (await b.get(`/alert-profiles/${profileId}/preview`)).body;
      assert.deepEqual([preview.matched, preview.cap, preview.included.length], [2, 150, 2]);
      assert.ok(preview.included[0].score >= preview.included[1].score);
      assert.equal((await b.get(`/alert-profiles/${profileId}/digests`)).body.digests.length, 0);
    });

    it('sends a test email to the signed-in person only, flagged as a test', async () => {
      const res = await b.post(`/alert-profiles/${profileId}/test`);
      assert.equal(res.status, 200);
      assert.equal(res.body.sentTo, 'b@b.test');
      assert.equal(res.body.dryRun, true);
      const mail = await run((q) => q.one(`SELECT recipient, kind, subject FROM email_queue WHERE profile_name = 'Gadolinium'`));
      assert.deepEqual([mail.recipient, mail.kind], ['b@b.test', 'test']);
      assert.match(mail.subject, /^\[TEST\]/);
    });

    it('lets an administrator work on a subscriber\'s alerts', async () => {
      const list = await admin.get(`/admin/organizations/${orgB}/alert-profiles`);
      assert.equal(list.status, 200);
      assert.ok(list.body.profiles.some((p) => p.name === 'Gadolinium'));
      const created = await admin.post(`/admin/organizations/${orgB}/alert-profiles`).send({ name: 'Set up by Shan-Deep', recipientEmails: ['boss@b.test'] });
      assert.equal(created.status, 201);
      assert.deepEqual(created.body.profile.recipientEmails, ['boss@b.test']);
      assert.equal((await admin.patch(`/admin/organizations/${orgB}/alert-profiles/${created.body.profile.id}`).send({ status: 'paused' })).status, 200);
      assert.equal((await admin.delete(`/admin/organizations/${orgB}/alert-profiles/${created.body.profile.id}`)).status, 204);
      // Never crosses organizations: profile ids are scoped to the organization in the URL.
      assert.equal((await admin.patch(`/admin/organizations/${orgA}/alert-profiles/${profileId}`).send({ name: 'x' })).status, 404);
      assert.equal((await a.get(`/admin/organizations/${orgB}/alert-profiles`)).status, 403);
    });

    it('records each digest in the history with what was held back', async () => {
      const profile = await run((q) => q.one(`SELECT p.*, o.name AS org_name, 150 AS cap FROM alert_profiles p JOIN organizations o ON o.id = p.organization_id WHERE p.id = $1`, [profileId]));
      await run((q) => sendDigestForProfile(q, profile, { baseUrl: 'https://x.test' }));
      const { digests } = (await b.get(`/alert-profiles/${profileId}/digests`)).body;
      assert.equal(digests.length, 1);
      assert.deepEqual([digests[0].matched_count, digests[0].included_count, digests[0].held_back], [2, 2, 0]);
    });
  });

  describe('alerts shown in search', () => {
    let held;
    before(async () => {
      // A tiny ceiling forces some matches to be held back.
      await run((q) => q.query(`UPDATE organizations SET alert_cap_override = 1 WHERE id = $1`, [orgA]));
      await seedTenders(ctx.db, [1, 2, 3].map((n) => tenderDto({ tender_summary: `Quokkaplex habitat ${n}`, tender_value: n * 1_000_000 })));
      const pid = (await a.post('/alert-profiles').send({ name: 'Replacement 2' }).catch(() => null)) && (await a.get('/alert-profiles')).body.profiles[0].id;
      await a.patch(`/alert-profiles/${pid}`).send({ keywords: ['quokkaplex'] });
      const profile = await run((q) => q.one(`SELECT p.*, o.name AS org_name, 1 AS cap FROM alert_profiles p JOIN organizations o ON o.id = p.organization_id WHERE p.id = $1`, [pid]));
      await run((q) => sendDigestForProfile(q, profile, { baseUrl: 'https://x.test' }));
      held = pid;
    });

    it('marks tenders that were emailed, held back, or never matched', async () => {
      const res = await a.get('/tenders?q=quokkaplex');
      const flags = res.body.items.map((t) => t.inDigest).sort();
      assert.deepEqual(flags, [false, false, true]);
      const other = await a.get('/tenders?q=gadolinium');
      assert.ok(other.body.items.every((t) => t.inDigest === null), 'no alert of this organization matched them');
      const asB = await b.get('/tenders?q=quokkaplex');
      assert.ok(asB.body.items.every((t) => t.inDigest === null), 'another organization\'s alerts are never revealed');
    });

    it('can list just the held-back tenders, the emailed ones, or all matches', async () => {
      assert.equal((await a.get('/tenders?alerts=not_in_digest')).body.total, 2);
      assert.equal((await a.get('/tenders?alerts=in_digest')).body.total, 1);
      assert.equal((await a.get('/tenders?alerts=matched')).body.total, 3);
      const bMatched = await b.get('/tenders?alerts=matched');
      assert.equal(bMatched.body.total, 2, 'B sees only its own two Gadolinium matches');
      assert.ok(bMatched.body.items.every((t) => t.title.includes('Gadolinium')), 'never organization A\'s matches');
    });

    it('shows the flag in tender detail and counts matches on the dashboard', async () => {
      const [first] = (await a.get('/tenders?q=quokkaplex&sort=value')).body.items;
      assert.equal((await a.get(`/tenders/${first.id}`)).body.tender.inDigest, first.inDigest);
      assert.equal((await a.get('/dashboard')).body.kpis.matchedToAlertsThisWeek, 1);
      assert.ok(held);
    });
  });
});

describe('rate limiting test sends', () => {
  it('allows ten test emails an hour per person', async () => {
    const ctx = await makeContext({ rateLimits: true });
    const org = await createOrg(ctx.db, { name: 'Org', planCode: 'standard' });
    await createUser(ctx.db, { orgId: org, email: 'u@o.test', role: 'tenant_admin' });
    const u = await signIn(ctx.app, 'u@o.test');
    const id = (await u.post('/alert-profiles').send({ name: 'x' })).body.profile.id;
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await u.post(`/alert-profiles/${id}/test`)).status);
    assert.deepEqual(codes, [...Array(10).fill(200), 429, 429]);
    await ctx.close();
  });
});

describe('operations console', () => {
  let ctx, admin, subscriber;
  const run = (fn) => ctx.db.withContext(SYSTEM, fn);
  before(async () => {
    ctx = await makeContext();
    const org = await createOrg(ctx.db, { name: 'Client' });
    await createUser(ctx.db, { orgId: org, email: 'sub@c.test' });
    admin = await signIn(ctx.app, 'admin@test.local');
    subscriber = await signIn(ctx.app, 'sub@c.test');
  });
  after(() => ctx.close());

  it('is for platform administrators only', async () => {
    for (const path of ['/admin/mail/status', '/admin/mail/messages', '/admin/jobs']) {
      assert.equal((await subscriber.get(path)).status, 403, path);
    }
    assert.equal((await subscriber.post('/admin/mail/drain')).status, 403);
    assert.equal((await subscriber.post('/admin/jobs/digests/run')).status, 403);
  });

  it('reports the mail mode, limits and queue without revealing secrets', async () => {
    await run((q) => q.query(`INSERT INTO email_queue (kind, recipient, subject, html_body, idempotency_key) VALUES ('digest', 'x@y.test', 'Hello', '<p>hi</p>', 'k1')`));
    const res = await admin.get('/admin/mail/status');
    assert.equal(res.status, 200);
    assert.equal(res.body.mode, 'dry_run');
    assert.deepEqual(res.body.limits, { perMinute: 25, perDay: 10000 });
    assert.equal(res.body.counts.byStatus.queued, 1);
    assert.doesNotMatch(JSON.stringify(res.body), /secret|password/i);
  });

  it('drains the queue on demand (dry run writes a file, nothing is "sent")', async () => {
    const res = await admin.post('/admin/mail/drain');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const msg = (await admin.get('/admin/mail/messages')).body.messages[0];
    assert.equal(msg.status, 'dry_run');
    const detail = await admin.get(`/admin/mail/messages/${msg.id}`);
    assert.equal(detail.body.attempts[0].outcome, 'dry_run');
    assert.equal(detail.body.message.html_body, '<p>hi</p>');
  });

  it('retries failed and cancels queued messages, and refuses anything else', async () => {
    const ids = await run(async (q) => {
      const out = [];
      for (const [i, status] of ['failed', 'queued', 'sent'].entries()) {
        out.push((await q.one(`INSERT INTO email_queue (kind, recipient, subject, html_body, idempotency_key, status) VALUES ('digest','a@b.test','s','h',$1,$2) RETURNING id`, [`op${i}`, status])).id);
      }
      return out;
    });
    assert.equal((await admin.post(`/admin/mail/messages/${ids[0]}/retry`)).status, 204);
    assert.equal((await admin.post(`/admin/mail/messages/${ids[1]}/cancel`)).status, 204);
    assert.equal((await admin.post(`/admin/mail/messages/${ids[2]}/retry`)).status, 409);
    assert.equal((await admin.post(`/admin/mail/messages/${ids[2]}/cancel`)).status, 409);
    assert.equal((await admin.get('/admin/mail/messages?status=cancelled')).body.messages.length, 1);
  });

  it('lets an administrator clear a bounce so the address can be mailed again', async () => {
    await run((q) => q.query(`INSERT INTO email_bounce_records (recipient_email, bounce_type) VALUES ('gone@x.test', 'hard')`));
    const [bounce] = (await admin.get('/admin/mail/bounces')).body.bounces;
    assert.equal((await admin.delete(`/admin/mail/bounces/${bounce.id}`)).status, 204);
    assert.equal((await admin.get('/admin/mail/bounces')).body.bounces.length, 0);
  });

  it('lists the background jobs and runs one on demand', async () => {
    const list = await admin.get('/admin/jobs');
    const names = list.body.jobs.map((j) => j.name);
    for (const n of ['ingest', 'digests', 'mail-drain', 'reminders', 'housekeeping']) assert.ok(names.includes(n), n);
    assert.equal(list.body.jobs.find((j) => j.name === 'digests').timezone, 'Asia/Kolkata');
    assert.equal(list.body.jobs.find((j) => j.name === 'ingest').enabled, false, 'off until the Tenderbook key is configured');

    const run1 = await admin.post('/admin/jobs/housekeeping/run');
    assert.equal(run1.status, 200);
    assert.equal((await admin.post('/admin/jobs/nonsense/run')).status, 404);
    const after1 = await admin.get('/admin/jobs');
    assert.equal(after1.body.recent[0].job, 'housekeeping');
    assert.equal(after1.body.recent[0].trigger, 'manual');
  });

  it('keeps a record of failures and leaves idle scheduled runs out of the history', async () => {
    const jobs = { boom: { quiet: false, run: async () => { throw new Error('exploded'); } }, idle: { quiet: true, run: async () => ({ activity: 0 }) } };
    const failed = await runJob(ctx.db, jobs, 'boom', { trigger: 'schedule' });
    assert.deepEqual([failed.ok, failed.error], [false, 'exploded']);
    await runJob(ctx.db, jobs, 'idle', { trigger: 'schedule' });
    const rows = await run((q) => q.many(`SELECT job, status, error FROM job_runs WHERE job IN ('boom', 'idle')`));
    assert.deepEqual(rows, [{ job: 'boom', status: 'failed', error: 'exploded' }]);
  });

  it('removes expired sessions and old reset links in housekeeping', async () => {
    await run(async (q) => {
      const org = (await q.one(`SELECT id FROM organizations LIMIT 1`)).id;
      const user = (await q.one(`SELECT id FROM users LIMIT 1`)).id;
      await q.query(`INSERT INTO user_sessions (id, user_id, organization_id, csrf_secret, expires_at) VALUES ('old', $1, $2, 'c', now() - interval '3 days')`, [user, org]);
    });
    const out = await runJob(ctx.db, ctx.jobs, 'housekeeping', { trigger: 'manual' });
    assert.equal(out.detail.sessions, 1);
  });
});

describe('watchlist reminders', () => {
  let ctx, org, user, ids;
  const run = (fn) => ctx.db.withContext(SYSTEM, fn);
  before(async () => {
    ctx = await makeContext();
    org = await createOrg(ctx.db, { name: 'Remind Co' });
    user = await createUser(ctx.db, { orgId: org, email: 'watcher@r.test', name: 'Watcher' });
    ids = await seedTenders(ctx.db, [
      tenderDto({ tender_summary: 'Due in two days', dueInDays: 2 }),
      tenderDto({ tender_summary: 'Due in 10 hours', dueInDays: 0.4 }),
      tenderDto({ tender_summary: 'Due in a month', dueInDays: 30 }),
      tenderDto({ tender_summary: 'Meeting soon', dueInDays: 20, prebid_date: Date.now() + 30 * 3_600_000 }),
    ]);
    await run((q) => q.query(`INSERT INTO watchlist_items (organization_id, user_id, tender_id) SELECT $1, $2, unnest($3::bigint[])`, [org, user, ids]));
  });
  after(() => ctx.close());

  it('sends one email listing what is due, grouped by urgency, and only once', async () => {
    const out = await queueWatchlistReminders(ctx.db, { baseUrl: 'https://x.test' });
    assert.deepEqual([out.reminders, out.emails], [3, 1]);
    const mail = await run((q) => q.one(`SELECT recipient, subject, html_body FROM email_queue WHERE kind = 'reminder'`));
    assert.equal(mail.recipient, 'watcher@r.test');
    assert.match(mail.subject, /3 tenders on your watchlist are due soon/);
    assert.match(mail.html_body, /Closing within 24 hours \(1\)/);
    assert.match(mail.html_body, /Closing within 3 days \(1\)/);
    assert.match(mail.html_body, /Pre-bid meeting within 48 hours \(1\)/);
    assert.ok(!mail.html_body.includes('Due in a month'));

    const again = await queueWatchlistReminders(ctx.db, { baseUrl: 'https://x.test' });
    assert.deepEqual([again.reminders, again.emails], [0, 0]);
  });

  it('later sends a 24-hour reminder for a tender that already had its 3-day one', async () => {
    await run((q) => q.query(`UPDATE tenders SET submission_deadline = now() + interval '20 hours' WHERE id = $1`, [ids[0]]));
    const out = await queueWatchlistReminders(ctx.db, { baseUrl: 'https://x.test', now: new Date(Date.now() + 1000) });
    assert.equal(out.reminders, 1);
  });

  it('skips deactivated people and suspended organizations', async () => {
    const org2 = await createOrg(ctx.db, { name: 'Suspended', status: 'Suspended' });
    const u2 = await createUser(ctx.db, { orgId: org2, email: 'sus@r.test' });
    const u3 = await createUser(ctx.db, { orgId: org, email: 'gone@r.test', isActive: false });
    const [t] = await seedTenders(ctx.db, [tenderDto({ tender_summary: 'Another due soon', dueInDays: 1.5 })]);
    await run((q) => q.query(`INSERT INTO watchlist_items (organization_id, user_id, tender_id) VALUES ($1, $2, $4), ($3, $5, $4)`, [org2, u2, org, t, u3]));
    await queueWatchlistReminders(ctx.db, { baseUrl: 'https://x.test' });
    const mail = await run((q) => q.many(`SELECT recipient FROM email_queue WHERE kind = 'reminder' AND recipient IN ('sus@r.test', 'gone@r.test')`));
    assert.equal(mail.length, 0);
  });
});
