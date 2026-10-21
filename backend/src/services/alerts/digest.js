/**
 * Builds the daily digest for an alert profile.
 *
 * What a digest contains:
 *  1. CLOSING SOON: tenders sent in an earlier digest whose deadline is now
 *     inside 72 hours, each flagged once, pinned to the top.
 *  2. NEW MATCHES: open tenders that fit the profile and that this profile has
 *     not been shown before, ranked by the 100-point score. The top ones, up
 *     to the plan ceiling, are emailed.
 *  3. THE REST: matches beyond the ceiling are stored as "not in digest" so the
 *     portal can still show them (flagged) but they are never emailed.
 */
import { enqueueEmail } from '../mail/queue.js';
import { audit } from '../audit.js';
import { renderDigestEmail } from './email.js';
import { rankCandidates, scoreMatch } from './ranking.js';

const SYSTEM_ACTOR = { user: null, ip: null };
const MAX_CANDIDATES = 5000;
const OPEN = `(t.status = 'Open' AND (t.submission_deadline IS NULL OR t.submission_deadline > now()))`;

const COLUMNS = `t.id, t.tender_no, t.title, t.department, t.category, t.state, t.city, t.tender_type, t.estimated_value,
  t.emd_amount, t.emd_status, t.submission_deadline, t.publish_date, t.source_url`;

const IST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
const IST_DOW = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' });
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const istDate = (date) => IST.format(date); // YYYY-MM-DD in India
export const istWeekday = (date) => DOW.indexOf(IST_DOW.format(date)); // 0 = Sunday

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Is this profile due for a digest today (India time)? Pure, so it is easy to test. */
export function isDue(profile, now = new Date()) {
  if (profile.status !== 'active') return false;
  const today = istDate(now);
  const last = profile.last_run_at ? istDate(new Date(profile.last_run_at)) : null;
  if (last === today) return false;
  switch (profile.frequency) {
    case 'daily': return true;
    case 'alternate_day': return !last || daysBetween(last, today) >= 2;
    case 'weekly': return istWeekday(now) === profile.weekly_day;
    default: return false;
  }
}

/** A user's keyword as a tsquery: every word must appear, as a prefix ("meter" finds "meters"). */
function keywordQuery(add, keyword) {
  const parts = String(keyword).replace(/[\\']/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).slice(0, 6);
  if (!parts.length) return null;
  return parts.map((w) => `to_tsquery('simple', quote_literal(${add(w.slice(0, 60))}::text) || ':*')`).join(' && ');
}

export async function findCandidates(q, profile) {
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  const where = [OPEN];

  // Never repeat something this profile has already shown or deliberately held back.
  where.push(`NOT EXISTS (SELECT 1 FROM alert_digest_items i JOIN alert_digests d ON d.id = i.digest_id
                           WHERE d.profile_id = ${add(profile.id)} AND i.tender_id = t.id AND NOT d.is_test)`);

  if (profile.state_ids.length) where.push(`t.state_id = ANY(${add(profile.state_ids)}::int[])`);
  if (profile.department_ids.length) where.push(`t.department_id = ANY(${add(profile.department_ids)}::int[])`);
  if (profile.tender_types.length) where.push(`lower(t.tender_type) = ANY(${add(profile.tender_types.map((s) => s.toLowerCase()))}::text[])`);

  if (profile.value_min != null || profile.value_max != null) {
    const bounds = [];
    if (profile.value_min != null) bounds.push(`t.estimated_value >= ${add(profile.value_min)}`);
    if (profile.value_max != null) bounds.push(`t.estimated_value <= ${add(profile.value_max)}`);
    where.push(`((${bounds.join(' AND ')})${profile.include_unknown_value ? ' OR t.estimated_value IS NULL' : ''})`);
  }

  for (const word of profile.exclude_keywords) {
    const tsq = keywordQuery(add, word);
    if (tsq) where.push(`NOT (t.title_tsv @@ (${tsq}) OR t.desc_tsv @@ (${tsq}) OR t.boq_tsv @@ (${tsq}))`);
  }

  const queries = profile.keywords.map((k) => keywordQuery(add, k)).filter(Boolean);
  const anyOf = (vectors) => (queries.length ? `(${queries.flatMap((e) => vectors.map((v) => `${v} @@ (${e})`)).join(' OR ')})` : 'FALSE');
  const titleKw = anyOf(['t.title_tsv']);
  const descKw = anyOf(['t.desc_tsv', 't.boq_tsv']);
  const categoryHit = profile.category_ids.length ? `t.category_id = ANY(${add(profile.category_ids)}::int[])` : 'FALSE';
  const departmentHit = profile.department_ids.length ? `t.department_id = ANY(${add(profile.department_ids)}::int[])` : 'FALSE';

  // A profile that names keywords or categories only matches tenders that touch at least one of them.
  if (queries.length || profile.category_ids.length) where.push(`(${categoryHit} OR ${titleKw} OR ${descKw})`);

  const rows = await q.many(
    `SELECT ${COLUMNS}, ${titleKw} AS kw_title, ${descKw} AS kw_desc, ${categoryHit} AS cat_hit, ${departmentHit} AS dept_hit
       FROM tenders t WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT ${MAX_CANDIDATES}`,
    params
  );
  return rows;
}

export async function findClosingSoon(q, profile) {
  return q.many(
    `SELECT ${COLUMNS}, max(i.score) AS prior_score
       FROM tenders t
       JOIN alert_digest_items i ON i.tender_id = t.id AND i.in_digest
       JOIN alert_digests d ON d.id = i.digest_id AND d.profile_id = $1 AND NOT d.is_test
      WHERE t.status = 'Open' AND t.submission_deadline > now() AND t.submission_deadline <= now() + interval '72 hours'
        AND NOT EXISTS (SELECT 1 FROM alert_digest_items c JOIN alert_digests cd ON cd.id = c.digest_id
                         WHERE cd.profile_id = $1 AND c.tender_id = t.id AND c.is_closing_soon)
      GROUP BY t.id ORDER BY t.submission_deadline, t.id`,
    [profile.id]
  );
}

/**
 * Work out what to send. With `persist` the digest is recorded (so nothing is
 * sent twice); without it this is a read-only preview or test.
 */
export async function buildDigest(q, profile, { cap, now = new Date(), persist = false }) {
  const profileShape = {
    keywords: profile.keywords, categoryIds: profile.category_ids, departmentIds: profile.department_ids,
  };
  const closing = await findClosingSoon(q, profile);
  const candidates = await findCandidates(q, profile);

  const scored = rankCandidates(candidates.map((c) => ({
    ...c,
    deadline: c.submission_deadline,
    ...scoreMatch({ titleKeyword: c.kw_title, descKeyword: c.kw_desc, category: c.cat_hit, department: c.dept_hit }, profileShape, c.publish_date, now),
  })));

  // The ceiling covers the whole email, so closing-soon reminders use some of it.
  const closingShown = closing.slice(0, cap);
  const room = Math.max(0, cap - closingShown.length);
  const included = scored.slice(0, room);
  const held = scored.slice(room);

  const result = {
    digestId: null,
    cap,
    matchedCount: scored.length,
    closing: closingShown,
    included,
    notInDigest: held.length,
    isEmpty: closingShown.length === 0 && included.length === 0,
  };
  if (!persist || result.isEmpty && held.length === 0) return result;

  const digest = await q.maybeOne(
    `INSERT INTO alert_digests (organization_id, profile_id, digest_date, matched_count, included_count, cap)
     VALUES ($1, $2, $3::date, $4, $5, $6)
     ON CONFLICT (profile_id, digest_date) WHERE NOT is_test DO NOTHING RETURNING id`,
    [profile.organization_id, profile.id, istDate(now), scored.length, closingShown.length + included.length, cap]
  );
  if (!digest) return { ...result, alreadySent: true, closing: [], included: [], isEmpty: true };

  const rows = [
    ...closingShown.map((t, i) => ({ id: t.id, score: Number(t.prior_score ?? 0), rank: i + 1, inDigest: true, closing: true })),
    ...included.map((t, i) => ({ id: t.id, score: t.score, rank: closingShown.length + i + 1, inDigest: true, closing: false })),
    ...held.map((t, i) => ({ id: t.id, score: t.score, rank: closingShown.length + included.length + i + 1, inDigest: false, closing: false })),
  ];
  if (rows.length) {
    await q.query(
      `INSERT INTO alert_digest_items (digest_id, tender_id, score, rank_position, in_digest, is_closing_soon)
       SELECT $1, * FROM unnest($2::bigint[], $3::int[], $4::int[], $5::boolean[], $6::boolean[])`,
      [digest.id, rows.map((r) => r.id), rows.map((r) => r.score), rows.map((r) => r.rank), rows.map((r) => r.inDigest), rows.map((r) => r.closing)]
    );
  }
  return { ...result, digestId: digest.id };
}

/** Who receives a profile's emails: its recipients, else the person who created it, else the account admins. */
export async function recipientsFor(q, profile) {
  if (profile.recipient_emails.length) return [...new Set(profile.recipient_emails.map((e) => e.toLowerCase()))];
  const rows = await q.many(
    `SELECT email FROM users WHERE is_active AND organization_id = $1 AND (id = $2 OR role = 'tenant_admin')
      ORDER BY (id = $2) DESC LIMIT 3`,
    [profile.organization_id, profile.user_id ?? 0]
  );
  return rows.map((r) => r.email);
}

export async function loadProfileContext(q, profileId) {
  return q.maybeOne(
    `SELECT p.*, o.name AS org_name, o.status AS org_status, o.language AS org_language,
            coalesce(o.alert_cap_override, pl.daily_alert_cap, 50) AS cap
       FROM alert_profiles p
       JOIN organizations o ON o.id = p.organization_id
       LEFT JOIN plans pl ON pl.id = o.plan_id
      WHERE p.id = $1`, [profileId]);
}

/** Build, record and queue one profile's digest. */
export async function sendDigestForProfile(q, profile, { now = new Date(), baseUrl }) {
  const digest = await buildDigest(q, profile, { cap: profile.cap, now, persist: true });
  await q.query('UPDATE alert_profiles SET last_run_at = $2 WHERE id = $1', [profile.id, now]);
  if (digest.isEmpty) return { sent: 0, ...digest };

  const recipients = await recipientsFor(q, profile);
  const { subject, html } = renderDigestEmail({ profile, orgName: profile.org_name, digest, baseUrl, now });
  let queued = 0;
  for (const to of recipients) {
    const id = await enqueueEmail(q, {
      orgId: profile.organization_id, kind: 'digest', to, subject, html, profileName: profile.name,
      tendersCount: digest.included.length + digest.closing.length, digestId: digest.digestId,
      idempotencyKey: `digest:${digest.digestId}:${to}`,
    });
    if (id) queued++;
  }
  await audit(q, SYSTEM_ACTOR, 'digest.queued', 'alert_digest', digest.digestId, { profileId: profile.id, recipients: queued, tenders: digest.included.length + digest.closing.length });
  return { sent: queued, ...digest };
}

/** Test send: the same email the next digest would be, to one address, without recording anything. */
export async function sendTestDigest(q, profileId, { to, baseUrl, now = new Date() }) {
  const profile = await loadProfileContext(q, profileId);
  const digest = await buildDigest(q, profile, { cap: profile.cap, now, persist: false });
  const { subject, html } = renderDigestEmail({ profile, orgName: profile.org_name, digest, baseUrl, now, isTest: true });
  const id = await enqueueEmail(q, {
    orgId: profile.organization_id, kind: 'test', to, subject, html, profileName: profile.name,
    tendersCount: digest.included.length + digest.closing.length,
    idempotencyKey: `test:${profileId}:${to}:${now.getTime()}`,
  });
  return { queued: Boolean(id), included: digest.included.length, closing: digest.closing.length, notInDigest: digest.notInDigest, matched: digest.matchedCount };
}

export async function previewDigest(q, profileId, { now = new Date() } = {}) {
  const profile = await loadProfileContext(q, profileId);
  const digest = await buildDigest(q, profile, { cap: profile.cap, now, persist: false });
  const view = (t) => ({
    id: t.id, title: t.title, department: t.department, state: t.state, city: t.city, estimatedValue: t.estimated_value,
    deadline: t.submission_deadline, score: t.score ?? null,
  });
  return {
    cap: digest.cap, matched: digest.matchedCount, notInDigest: digest.notInDigest,
    closingSoon: digest.closing.map(view), included: digest.included.slice(0, 50).map(view),
  };
}

/**
 * Run every profile that is due. Each profile is its own transaction, so one
 * failing profile never blocks the others.
 */
export async function runDueDigests(db, { now = new Date(), baseUrl, profileId = null, force = false } = {}) {
  const profiles = await db.withContext({ scope: 'system' }, (q) =>
    q.many(
      `SELECT p.id FROM alert_profiles p JOIN organizations o ON o.id = p.organization_id
        WHERE o.status = 'Active' AND ($1::int IS NULL OR p.id = $1) ORDER BY p.id`, [profileId])
  );
  const summary = { checked: profiles.length, due: 0, emailsQueued: 0, tenders: 0, failed: 0, errors: [] };
  for (const { id } of profiles) {
    try {
      await db.withContext({ scope: 'system' }, async (q) => {
        const profile = await loadProfileContext(q, id);
        if (!profile || profile.org_status !== 'Active') return;
        if (!force && !isDue(profile, now)) return;
        if (force && profile.status !== 'active') return;
        summary.due++;
        const out = await sendDigestForProfile(q, profile, { now, baseUrl });
        summary.emailsQueued += out.sent;
        summary.tenders += out.included.length + out.closing.length;
      });
    } catch (err) {
      summary.failed++;
      summary.errors.push(`profile ${id}: ${err.message}`);
    }
  }
  return summary;
}
