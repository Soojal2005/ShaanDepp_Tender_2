import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildDigest, isDue, istDate, istWeekday, previewDigest, runDueDigests, sendDigestForProfile, sendTestDigest } from '../src/services/alerts/digest.js';
import { renderDigestEmail, groupTenders, inr } from '../src/services/alerts/email.js';
import { createProfile, createProfileSchema, patchProfileSchema, profileInputFromFilters } from '../src/services/alerts/profiles.js';
import { WEIGHTS, freshnessPoints, rankCandidates, scoreMatch } from '../src/services/alerts/ranking.js';
import { DAY, SYSTEM, createOrg, createUser, makeContext, seedTenders, tenderDto } from './helpers.js';

const NOW = new Date('2026-10-21T04:00:00Z'); // 09:30 IST on a Wednesday
const profileRow = (o = {}) => ({
  id: 1, organization_id: 1, status: 'active', frequency: 'daily', weekly_day: 1, last_run_at: null,
  keywords: [], exclude_keywords: [], category_ids: [], department_ids: [], state_ids: [], tender_types: [],
  value_min: null, value_max: null, include_unknown_value: true, recipient_emails: [], user_id: null, ...o,
});

describe('relevance score', () => {
  const empty = { keywords: [], categoryIds: [], departmentIds: [] };

  it('weights add up to 100', () => {
    assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
  });

  it('gives 100 to a brand-new tender that matches everything the profile names', () => {
    const profile = { keywords: ['hospital'], categoryIds: [1], departmentIds: [2] };
    const flags = { titleKeyword: true, descKeyword: true, category: true, department: true };
    assert.equal(scoreMatch(flags, profile, NOW, NOW).score, 100);
  });

  it('scores each dimension the profile names, and nothing for a miss', () => {
    const profile = { keywords: ['x'], categoryIds: [1], departmentIds: [2] };
    const none = scoreMatch({}, profile, new Date(NOW - 30 * DAY), NOW);
    assert.equal(none.score, 0);
    assert.equal(scoreMatch({ titleKeyword: true }, profile, new Date(NOW - 30 * DAY), NOW).score, 30);
    assert.equal(scoreMatch({ category: true }, profile, new Date(NOW - 30 * DAY), NOW).score, 25);
    assert.equal(scoreMatch({ descKeyword: true }, profile, new Date(NOW - 30 * DAY), NOW).score, 15);
    assert.equal(scoreMatch({ department: true }, profile, new Date(NOW - 30 * DAY), NOW).score, 15);
  });

  it('treats an unspecified dimension as a full match, so broad profiles are not penalised', () => {
    assert.equal(scoreMatch({}, empty, NOW, NOW).score, 100);
    assert.equal(scoreMatch({}, { ...empty, keywords: ['x'] }, NOW, NOW).parts.titleKeyword, 0);
    assert.equal(scoreMatch({}, { ...empty, departmentIds: [1] }, NOW, NOW).score, 85);
  });

  it('decays freshness with age', () => {
    assert.deepEqual([1, 3, 5, 7, 10, 14, 15, 60].map((d) => freshnessPoints(new Date(NOW - d * DAY), NOW)), [15, 15, 10, 10, 5, 5, 0, 0]);
    assert.equal(freshnessPoints(null, NOW), 0);
  });

  it('is deterministic and breaks ties by deadline then id', () => {
    const list = [
      { id: 3, score: 80, deadline: new Date(NOW.getTime() + 5 * DAY) },
      { id: 1, score: 80, deadline: new Date(NOW.getTime() + 2 * DAY) },
      { id: 2, score: 90, deadline: null },
      { id: 4, score: 80, deadline: new Date(NOW.getTime() + 2 * DAY) },
    ];
    assert.deepEqual(rankCandidates(list).map((t) => t.id), [2, 1, 4, 3]);
    assert.deepEqual(rankCandidates([...list].reverse()).map((t) => t.id), [2, 1, 4, 3]);
  });
});

describe('when a profile is due (India time)', () => {
  it('runs daily profiles once per India day', () => {
    assert.equal(istDate(NOW), '2026-10-21');
    assert.equal(istWeekday(NOW), 3);
    assert.equal(isDue(profileRow(), NOW), true);
    assert.equal(isDue(profileRow({ last_run_at: '2026-10-20T02:30:00Z' }), NOW), true);
    assert.equal(isDue(profileRow({ last_run_at: '2026-10-21T00:10:00Z' }), NOW), false, 'already ran today');
  });

  it('treats late-evening UTC as the next India day', () => {
    const lateUtc = new Date('2026-10-20T20:00:00Z'); // 01:30 IST on the 21st
    assert.equal(istDate(lateUtc), '2026-10-21');
    assert.equal(isDue(profileRow({ last_run_at: '2026-10-20T02:30:00Z' }), lateUtc), true);
  });

  it('runs alternate-day profiles every second day', () => {
    assert.equal(isDue(profileRow({ frequency: 'alternate_day', last_run_at: '2026-10-20T02:30:00Z' }), NOW), false);
    assert.equal(isDue(profileRow({ frequency: 'alternate_day', last_run_at: '2026-10-19T02:30:00Z' }), NOW), true);
    assert.equal(isDue(profileRow({ frequency: 'alternate_day' }), NOW), true, 'never run before');
  });

  it('runs weekly profiles only on their chosen weekday', () => {
    assert.equal(isDue(profileRow({ frequency: 'weekly', weekly_day: 3 }), NOW), true);
    assert.equal(isDue(profileRow({ frequency: 'weekly', weekly_day: 1 }), NOW), false);
    assert.equal(isDue(profileRow({ frequency: 'weekly', weekly_day: 3, last_run_at: '2026-10-21T00:10:00Z' }), NOW), false);
  });

  it('never runs a paused profile', () => {
    assert.equal(isDue(profileRow({ status: 'paused' }), NOW), false);
  });
});

describe('profile input', () => {
  it('applies defaults on create but never on update', () => {
    const created = createProfileSchema.parse({ name: 'Roads' });
    assert.deepEqual([created.frequency, created.status, created.includeUnknownValue, created.keywords], ['daily', 'active', true, []]);
    assert.deepEqual(patchProfileSchema.parse({ name: 'Renamed' }), { name: 'Renamed' });
  });

  it('rejects an inverted value band and a bad email', () => {
    assert.throws(() => createProfileSchema.parse({ name: 'x', valueMin: 10, valueMax: 5 }));
    assert.throws(() => createProfileSchema.parse({ name: 'x', recipientEmails: ['nope'] }));
  });

  it('turns a search into profile input: keywords, quoted phrases and exclusions', () => {
    const input = profileInputFromFilters({ q: 'water meter "smart city" -cctv', exclude: 'camera, drone', departmentIds: [3], valueMin: '1000000' }, 'From search');
    assert.deepEqual(input.keywords, ['water', 'meter', 'smart city']);
    assert.deepEqual(input.excludeKeywords, ['cctv', 'camera', 'drone']);
    assert.deepEqual(input.departmentIds, [3]);
    assert.equal(input.valueMin, 1_000_000);
  });
});

describe('building a digest', () => {
  let ctx, orgBasic, orgStandard, masters;
  const run = (fn) => ctx.db.withContext(SYSTEM, fn);

  async function newProfile(orgId, input = {}) {
    return run(async (q) => {
      const view = await createProfile(q, { user: null }, { orgId, userId: null, userEmail: 'alerts@client.test' }, createProfileSchema.parse({ name: 'Test alert', ...input }));
      return q.one('SELECT p.*, o.name AS org_name, coalesce(o.alert_cap_override, pl.daily_alert_cap) AS cap FROM alert_profiles p JOIN organizations o ON o.id = p.organization_id LEFT JOIN plans pl ON pl.id = o.plan_id WHERE p.id = $1', [view.id]);
    });
  }
  const dept = (name) => masters.departments.find((d) => d.name === name).id;
  const state = (name) => masters.states.find((s) => s.name === name).id;
  const category = (name) => masters.categories.find((c) => c.name === name).id;

  before(async () => {
    ctx = await makeContext();
    // These tests create many profiles per organization; the plan limit itself is tested in the API tests.
    await ctx.db.withContext(SYSTEM, (q) => q.query('UPDATE plans SET max_alert_profiles = 100'));
    orgBasic = await createOrg(ctx.db, { name: 'Basic Co', planCode: 'basic' });
    orgStandard = await createOrg(ctx.db, { name: 'Standard Co', planCode: 'standard' });
    masters = await run(async (q) => ({
      departments: await q.many('SELECT id, name FROM departments'), states: await q.many('SELECT id, name FROM states'),
      categories: await q.many('SELECT id, name FROM tender_categories'),
    }));
    await seedTenders(ctx.db, [
      tenderDto({ tender_summary: 'Supply of ultrasonic water meters', work_desc: 'AMR enabled', authority: 'Public Health Engineering Department', state: 'Madhya Pradesh', category: 'Goods', tender_value: 8_000_000, pubDaysAgo: 1 }),
      tenderDto({ tender_summary: 'Water meters with CCTV surveillance', authority: 'Public Health Engineering Department', state: 'Madhya Pradesh', category: 'Goods', tender_value: 3_000_000, pubDaysAgo: 1 }),
      tenderDto({ tender_summary: 'Pipeline works', work_desc: 'Includes installation of water meter chambers', authority: 'Public Works Department', state: 'Maharashtra', category: 'Water Supply', tender_value: 40_000_000, pubDaysAgo: 8 }),
      tenderDto({ tender_summary: 'Road widening', authority: 'Public Works Department', state: 'Madhya Pradesh', category: 'Construction', tender_value: null, pubDaysAgo: 2 }),
      tenderDto({ tender_summary: 'Hospital building', authority: 'Public Works Department', state: 'Gujarat', category: 'Construction', tender_value: 300_000_000, pubDaysAgo: 2, tender_no: 'H-1' }),
      tenderDto({ tender_summary: 'Old closed job for water meters', authority: 'Public Works Department', state: 'Gujarat', category: 'Goods', tender_value: 1_000_000, dueInDays: -3, tender_status: 'CLOSED' }),
    ]);
  });
  after(() => ctx.close());

  it('only includes open tenders that match at least one keyword, and ranks title hits first', async () => {
    const profile = await newProfile(orgStandard, { keywords: ['water meter'] });
    const digest = await run((q) => buildDigest(q, profile, { cap: profile.cap, now: new Date() }));
    assert.deepEqual(digest.included.map((t) => t.title), [
      'Supply of ultrasonic water meters', 'Water meters with CCTV surveillance', 'Pipeline works',
    ]);
    assert.ok(digest.included[0].score > digest.included[2].score);
    assert.equal(digest.matchedCount, 3);
    assert.ok(!digest.included.some((t) => t.title.includes('closed')), 'closed tenders never appear');
  });

  it('honours exclusions, state, department and category filters', async () => {
    const q1 = await newProfile(orgStandard, { keywords: ['water meter'], excludeKeywords: ['cctv'] });
    assert.equal((await run((q) => buildDigest(q, q1, { cap: 100 }))).matchedCount, 2);
    const q2 = await newProfile(orgStandard, { keywords: ['water meter'], stateIds: [state('Madhya Pradesh')] });
    assert.equal((await run((q) => buildDigest(q, q2, { cap: 100 }))).matchedCount, 2);
    const q3 = await newProfile(orgStandard, { departmentIds: [dept('Public Works Department')] });
    assert.deepEqual((await run((q) => buildDigest(q, q3, { cap: 100 }))).included.map((t) => t.title).sort(), ['Hospital building', 'Pipeline works', 'Road widening']);
    const q4 = await newProfile(orgStandard, { categoryIds: [category('Civil Works & Infrastructure')] });
    assert.deepEqual((await run((q) => buildDigest(q, q4, { cap: 100 }))).included.map((t) => t.title).sort(), ['Hospital building', 'Road widening']);
  });

  it('applies the value band, keeping undisclosed values only when the profile allows it', async () => {
    const band = { valueMin: 1_000_000, valueMax: 50_000_000 };
    const withUnknown = await newProfile(orgStandard, { ...band, departmentIds: [dept('Public Works Department')] });
    assert.deepEqual((await run((q) => buildDigest(q, withUnknown, { cap: 100 }))).included.map((t) => t.title).sort(), ['Pipeline works', 'Road widening']);
    const strict = await newProfile(orgStandard, { ...band, includeUnknownValue: false, departmentIds: [dept('Public Works Department')] });
    assert.deepEqual((await run((q) => buildDigest(q, strict, { cap: 100 }))).included.map((t) => t.title), ['Pipeline works']);
  });

  it('filters by tender type', async () => {
    const goods = await newProfile(orgStandard, { tenderTypes: ['goods'] });
    assert.equal((await run((q) => buildDigest(q, goods, { cap: 100 }))).matchedCount, 0);
    const works = await newProfile(orgStandard, { tenderTypes: ['Works'] });
    assert.equal((await run((q) => buildDigest(q, works, { cap: 100 }))).matchedCount, 5);
  });

  it('survives hostile keywords', async () => {
    const profile = await newProfile(orgStandard, { keywords: [`'; DROP TABLE tenders; --`, '&|!():*', '"', 'x'.repeat(75)] });
    await run((q) => buildDigest(q, profile, { cap: 100 }));
    assert.ok((await run((q) => q.one('SELECT count(*)::int AS n FROM tenders'))).n >= 6);
  });

  it('does not record anything for a preview or test', async () => {
    const profile = await newProfile(orgStandard, { keywords: ['hospital'] });
    await run((q) => buildDigest(q, profile, { cap: 100, persist: false }));
    assert.equal((await run((q) => q.one('SELECT count(*)::int AS n FROM alert_digests WHERE profile_id = $1', [profile.id]))).n, 0);
  });

  describe('the plan ceiling and what was held back', () => {
    let profile;
    before(async () => {
      await run((q) => q.query(
        `INSERT INTO tenders (provider_id, source_id, title, description, department, state, status, submission_deadline, publish_date)
         SELECT 'tenderbook', 'BULK-' || g, 'Supply of solar street lights lot ' || g, 'LED lighting', 'Municipal Corporation', 'Rajasthan', 'Open',
                now() + interval '20 days', now() - (g % 5) * interval '1 day'
           FROM generate_series(1, 130) g`));
      profile = await newProfile(orgBasic, { keywords: ['solar street lights'] });
    });

    it('sends only the top matches up to the Basic ceiling of 50 and stores the rest as not-in-digest', async () => {
      assert.equal(profile.cap, 50);
      const digest = await run((q) => buildDigest(q, profile, { cap: profile.cap, now: new Date(), persist: true }));
      assert.equal(digest.included.length, 50);
      assert.equal(digest.notInDigest, 80);
      assert.equal(digest.matchedCount, 130);
      const items = await run((q) => q.many('SELECT in_digest, count(*)::int AS n FROM alert_digest_items WHERE digest_id = $1 GROUP BY in_digest ORDER BY in_digest', [digest.digestId]));
      assert.deepEqual(items, [{ in_digest: false, n: 80 }, { in_digest: true, n: 50 }]);
      const scores = digest.included.map((t) => t.score);
      assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'best first');
    });

    it('never repeats a tender, including the ones that were held back', async () => {
      const second = await run((q) => buildDigest(q, profile, { cap: profile.cap, now: new Date(), persist: false }));
      assert.equal(second.matchedCount, 0);
    });

    it('lets the same tender reach a different profile', async () => {
      const other = await newProfile(orgBasic, { keywords: ['solar street lights'] });
      assert.equal((await run((q) => buildDigest(q, other, { cap: 50 }))).matchedCount, 130);
    });

    it('shows held-back tenders to the portal, flagged, and sent ones as sent', async () => {
      const sample = await run((q) => q.many(
        `SELECT t.title, i.in_digest FROM alert_digest_items i JOIN alert_digests d ON d.id = i.digest_id JOIN tenders t ON t.id = i.tender_id
          WHERE d.profile_id = $1 ORDER BY i.rank_position LIMIT 1 OFFSET 60`, [profile.id]));
      assert.equal(sample[0].in_digest, false);
    });
  });

  describe('closing-soon reminders', () => {
    let profile, tenderId;
    before(async () => {
      [tenderId] = await seedTenders(ctx.db, [tenderDto({ tender_summary: 'Bridge repair emergency works', authority: 'Public Works Department', state: 'Madhya Pradesh', dueInDays: 10 })]);
      profile = await newProfile(orgStandard, { keywords: ['bridge repair emergency'] });
      // The first digest went out three days ago (one digest per profile per day is enforced).
      await run((q) => buildDigest(q, profile, { cap: 100, now: new Date(Date.now() - 3 * DAY), persist: true }));
    });

    it('pins a previously-sent tender to the top once its deadline is within 72 hours, only once', async () => {
      const [fresh] = await seedTenders(ctx.db, [tenderDto({ tender_summary: 'Bridge repair emergency works phase 2', authority: 'Public Works Department', state: 'Madhya Pradesh' })]);
      await run((q) => q.query(`UPDATE tenders SET submission_deadline = now() + interval '40 hours' WHERE id = $1`, [tenderId]));
      await run((q) => q.query(`UPDATE alert_profiles SET last_run_at = NULL WHERE id = $1`, [profile.id]));

      const day2 = new Date();
      const digest = await run((q) => buildDigest(q, profile, { cap: 100, now: day2, persist: true }));
      assert.deepEqual(digest.closing.map((t) => t.id), [tenderId]);
      assert.deepEqual(digest.included.map((t) => t.id), [fresh]);

      const day3 = new Date(Date.now() + 25 * 36e5);
      const again = await run((q) => buildDigest(q, profile, { cap: 100, now: day3, persist: false }));
      assert.equal(again.closing.length, 0, 'the reminder is sent once, not every day');
    });

    it('counts reminders inside the ceiling', async () => {
      const p = await newProfile(orgStandard, { keywords: ['culvert'] });
      const ids = await seedTenders(ctx.db, [1, 2, 3].map((n) => tenderDto({ tender_summary: `Culvert ${n}` })));
      await run((q) => buildDigest(q, p, { cap: 100, now: new Date(), persist: true }));
      await seedTenders(ctx.db, [1, 2, 3].map((n) => tenderDto({ tender_summary: `Culvert extra ${n}` })));
      await run((q) => q.query(`UPDATE tenders SET submission_deadline = now() + interval '30 hours' WHERE id = ANY($1::bigint[])`, [ids.slice(0, 2)]));
      const next = await run((q) => buildDigest(q, p, { cap: 3, now: new Date(Date.now() + 36e5) }));
      assert.equal(next.closing.length, 2);
      assert.equal(next.included.length, 1, 'ceiling 3 minus 2 reminders');
      assert.equal(next.notInDigest, 2);
    });
  });

  describe('sending', () => {
    it('queues one email per recipient with a stable idempotency key, and never twice', async () => {
      await seedTenders(ctx.db, [tenderDto({ tender_summary: 'Zebra crossing paint', authority: 'Municipal Corporation', state: 'Madhya Pradesh' })]);
      const profile = await newProfile(orgStandard, { keywords: ['zebra crossing'], recipientEmails: ['a@client.test', 'B@client.test'] });
      const first = await run((q) => sendDigestForProfile(q, profile, { baseUrl: 'https://procure-brain.com' }));
      assert.equal(first.sent, 2);
      const mails = await run((q) => q.many(`SELECT recipient, kind, subject, tenders_count, digest_id FROM email_queue WHERE digest_id = $1 ORDER BY recipient`, [first.digestId]));
      assert.deepEqual(mails.map((m) => m.recipient), ['a@client.test', 'b@client.test']);
      assert.match(mails[0].subject, /Tender alert: Test alert · 1 tender/);

      const second = await run((q) => sendDigestForProfile(q, profile, { baseUrl: 'https://procure-brain.com' }));
      assert.equal(second.sent, 0, 'same-day re-run sends nothing');
      assert.equal((await run((q) => q.one(`SELECT count(*)::int AS n FROM email_queue WHERE digest_id = $1`, [first.digestId]))).n, 2);
    });

    it('sends nothing when there is nothing new', async () => {
      const profile = await newProfile(orgStandard, { keywords: ['nonexistentproductxyz'] });
      const out = await run((q) => sendDigestForProfile(q, profile, { baseUrl: 'https://x.test' }));
      assert.equal(out.sent, 0);
      assert.equal((await run((q) => q.one('SELECT count(*)::int AS n FROM alert_digests WHERE profile_id = $1', [profile.id]))).n, 0);
    });

    it('falls back to the creator, then account admins, when no recipients are set', async () => {
      const org = await createOrg(ctx.db, { name: 'Fallback Co' });
      const admin = await createUser(ctx.db, { orgId: org, email: 'admin@fallback.test', role: 'tenant_admin' });
      await seedTenders(ctx.db, [tenderDto({ tender_summary: 'Quokka enclosure', authority: 'Municipal Corporation' })]);
      const profile = await run(async (q) => {
        const id = (await q.one(`INSERT INTO alert_profiles (organization_id, user_id, name, keywords) VALUES ($1, $2, 'Fallback', ARRAY['quokka']) RETURNING id`, [org, admin])).id;
        return q.one('SELECT p.*, o.name AS org_name, 50 AS cap FROM alert_profiles p JOIN organizations o ON o.id = p.organization_id WHERE p.id = $1', [id]);
      });
      await run((q) => sendDigestForProfile(q, profile, { baseUrl: 'https://x.test' }));
      assert.equal((await run((q) => q.one(`SELECT recipient FROM email_queue WHERE profile_name = 'Fallback'`))).recipient, 'admin@fallback.test');
    });

    it('test sends and previews leave the real digest untouched', async () => {
      await seedTenders(ctx.db, [tenderDto({ tender_summary: 'Platypus habitat works' })]);
      const profile = await newProfile(orgStandard, { keywords: ['platypus'] });
      const test = await run((q) => sendTestDigest(q, profile.id, { to: 'me@client.test', baseUrl: 'https://x.test' }));
      assert.deepEqual([test.queued, test.included], [true, 1]);
      const mail = await run((q) => q.one(`SELECT kind, subject, html_body FROM email_queue WHERE recipient = 'me@client.test'`));
      assert.equal(mail.kind, 'test');
      assert.match(mail.subject, /^\[TEST\]/);
      assert.match(mail.html_body, /test send/i);
      const preview = await run((q) => previewDigest(q, profile.id));
      assert.equal(preview.included.length, 1);
      assert.equal((await run((q) => q.one('SELECT count(*)::int AS n FROM alert_digests WHERE profile_id = $1', [profile.id]))).n, 0);
      const real = await run((q) => sendDigestForProfile(q, profile, { baseUrl: 'https://x.test' }));
      assert.equal(real.included.length, 1, 'the tender is still new for the real digest');
    });
  });

  describe('the scheduled run', () => {
    it('skips paused profiles and suspended organizations and isolates failures', async () => {
      const org = await createOrg(ctx.db, { name: 'Sched Co' });
      const suspended = await createOrg(ctx.db, { name: 'Suspended Co', status: 'Suspended' });
      await seedTenders(ctx.db, [tenderDto({ tender_summary: 'Narwhal tank cleaning' })]);
      const make = (orgId, status, name) => run((q) => q.query(
        `INSERT INTO alert_profiles (organization_id, name, keywords, status, recipient_emails) VALUES ($1, $2, ARRAY['narwhal'], $3, ARRAY['x@client.test'])`, [orgId, name, status]));
      await make(org, 'active', 'Runs');
      await make(org, 'paused', 'Paused');
      await make(suspended, 'active', 'Suspended org');
      const summary = await runDueDigests(ctx.db, { baseUrl: 'https://x.test' });
      assert.equal(summary.failed, 0);
      const queued = await run((q) => q.many(`SELECT profile_name FROM email_queue WHERE profile_name IN ('Runs', 'Paused', 'Suspended org')`));
      assert.deepEqual(queued.map((m) => m.profile_name), ['Runs']);
      const again = await runDueDigests(ctx.db, { baseUrl: 'https://x.test' });
      assert.equal(again.emailsQueued, 0, 'not due again the same day');
    });
  });
});

describe('the digest email', () => {
  const profile = { name: 'Roads & "Bridges" <b>', keywords: [] };
  const base = (o = {}) => ({
    id: 1, title: 'Plain title', department: 'Public Works Department', state: 'Madhya Pradesh', city: 'Bhopal', category: 'x',
    estimated_value: 12_500_000, emd_amount: 250_000, emd_status: 'present', submission_deadline: new Date(NOW.getTime() + 5 * DAY),
    tender_no: 'N/1', score: 90, source_url: null, ...o,
  });

  it('escapes every piece of third-party text', () => {
    const digest = { cap: 100, notInDigest: 0, closing: [], included: [base({ title: '<script>alert(1)</script> & "quotes"', department: '<img src=x onerror=alert(1)>' })] };
    const { html, subject } = renderDigestEmail({ profile, orgName: 'Org <i>', digest, baseUrl: 'https://procure-brain.com', now: NOW });
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<b>"'), 'the profile name is escaped too');
    assert.match(subject, /Tender alert:/);
  });

  it('shows missing money as "Not disclosed", never zero', () => {
    const digest = { cap: 100, notInDigest: 0, closing: [], included: [base({ estimated_value: null, emd_amount: null, emd_status: 'not_published' })] };
    const { html } = renderDigestEmail({ profile, orgName: 'Org', digest, baseUrl: 'https://x.test', now: NOW });
    assert.match(html, /Value <b>Not disclosed<\/b> · EMD Not disclosed/);
    assert.equal(inr(0), '₹ 0', 'only a real zero is shown as zero');
    assert.equal(inr(null), 'Not disclosed');
    assert.equal(inr(12_500_000), '₹ 1.25 Cr');
    assert.equal(inr(250_000), '₹ 2.50 Lakh');
  });

  it('puts closing-soon tenders first, groups the rest by department and state, and explains overflow', () => {
    const digest = {
      cap: 2, notInDigest: 7,
      closing: [base({ id: 9, title: 'Closing one', submission_deadline: new Date(NOW.getTime() + 20 * 3_600_000) })],
      included: [base({ id: 1, score: 95 }), base({ id: 2, department: 'NTPC Limited', state: 'Gujarat', score: 99 }), base({ id: 3, score: 60 })],
    };
    const { html } = renderDigestEmail({ profile, orgName: 'Org', digest, baseUrl: 'https://x.test', now: NOW });
    assert.ok(html.indexOf('Closing within 72 hours') < html.indexOf('NTPC Limited'));
    assert.ok(html.indexOf('NTPC Limited · Gujarat') < html.indexOf('Public Works Department · Madhya Pradesh'), 'higher-scoring group first');
    assert.match(html, /closes in 20h/);
    assert.match(html, /7 more matches did not fit in this email \(ceiling 2 per alert\)/);
    assert.match(html, /not in digest/);
    assert.match(html, /href="https:\/\/x\.test\/app\/search\?tender=1"/);
  });

  it('groups by department and state', () => {
    const groups = groupTenders([base({ id: 1 }), base({ id: 2 }), base({ id: 3, state: 'Gujarat' }), base({ id: 4, department: null, state: null })]);
    assert.equal(groups.length, 3);
    assert.equal(groups.find((g) => g.state === 'Madhya Pradesh').items.length, 2);
    assert.ok(groups.some((g) => g.department === 'Other departments'));
  });

  it('says so when nothing matches', () => {
    const { html } = renderDigestEmail({ profile, orgName: 'Org', digest: { cap: 50, notInDigest: 0, closing: [], included: [] }, baseUrl: 'https://x.test', now: NOW, isTest: true });
    assert.match(html, /No new tenders match this alert right now/);
  });
});
