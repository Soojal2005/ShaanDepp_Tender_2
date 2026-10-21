/**
 * Alert profiles: what a subscriber wants to be told about. A profile can be
 * edited by the subscriber or by Shan-Deep staff on their behalf; both go
 * through the same functions, always bound to one organization id.
 */
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../../errors.js';
import { audit } from '../audit.js';
import { email } from '../../validate.js';

const words = (max = 30) => z.array(z.string().trim().min(1).max(80)).max(max);
const ids = z.array(z.coerce.number().int().positive()).max(100);
const money = z.coerce.number().min(0).max(1e13).nullable();

// Create and patch are separate so a Zod default can never overwrite an omitted field on update.
const shape = {
  name: z.string().trim().min(1).max(150),
  keywords: words(),
  excludeKeywords: words(),
  categoryIds: ids,
  departmentIds: ids,
  stateIds: ids,
  tenderTypes: z.array(z.string().trim().min(1).max(50)).max(10),
  valueMin: money,
  valueMax: money,
  includeUnknownValue: z.boolean(),
  recipientEmails: z.array(email).max(10),
  frequency: z.enum(['daily', 'alternate_day', 'weekly']),
  weeklyDay: z.number().int().min(0).max(6),
  status: z.enum(['active', 'paused']),
};

const bandOk = (v) => v.valueMin == null || v.valueMax == null || v.valueMin <= v.valueMax;
const bandMessage = { message: 'Minimum value cannot be above the maximum', path: ['valueMax'] };

export const createProfileSchema = z
  .object({
    ...shape,
    keywords: shape.keywords.default([]),
    excludeKeywords: shape.excludeKeywords.default([]),
    categoryIds: ids.default([]),
    departmentIds: ids.default([]),
    stateIds: ids.default([]),
    tenderTypes: shape.tenderTypes.default([]),
    valueMin: money.default(null),
    valueMax: money.default(null),
    includeUnknownValue: z.boolean().default(true),
    recipientEmails: shape.recipientEmails.default([]),
    frequency: shape.frequency.default('daily'),
    weeklyDay: shape.weeklyDay.default(1),
    status: shape.status.default('active'),
  })
  .refine(bandOk, bandMessage);

export const patchProfileSchema = z.object(shape).partial().refine(bandOk, bandMessage);

export const profileView = (r) => ({
  id: r.id,
  name: r.name,
  keywords: r.keywords,
  excludeKeywords: r.exclude_keywords,
  categoryIds: r.category_ids,
  departmentIds: r.department_ids,
  stateIds: r.state_ids,
  tenderTypes: r.tender_types,
  valueMin: r.value_min,
  valueMax: r.value_max,
  includeUnknownValue: r.include_unknown_value,
  recipientEmails: r.recipient_emails,
  frequency: r.frequency,
  weeklyDay: r.weekly_day,
  status: r.status,
  lastRunAt: r.last_run_at,
  createdAt: r.created_at,
  lastDigest: r.last_digest_date
    ? { date: r.last_digest_date, matched: r.last_matched_count, included: r.last_included_count }
    : null,
});

const LIST_SQL = `
  SELECT p.*, d.digest_date AS last_digest_date, d.matched_count AS last_matched_count, d.included_count AS last_included_count
    FROM alert_profiles p
    LEFT JOIN LATERAL (
      SELECT digest_date, matched_count, included_count FROM alert_digests
       WHERE profile_id = p.id AND NOT is_test ORDER BY digest_date DESC LIMIT 1) d ON true`;

/** Reject ids that do not exist in the master lists (a stale id would silently match nothing). */
async function assertMasterIds(q, input) {
  for (const [key, table] of [['categoryIds', 'tender_categories'], ['departmentIds', 'departments'], ['stateIds', 'states']]) {
    const list = input[key];
    if (!list?.length) continue;
    const found = await q.one(`SELECT count(*)::int AS n FROM ${table} WHERE id = ANY($1::int[])`, [list]);
    if (found.n !== new Set(list).size) throw badRequest(`${key} contains an entry that does not exist`);
  }
}

export async function listProfiles(q, orgId) {
  const rows = await q.many(`${LIST_SQL} WHERE p.organization_id = $1 ORDER BY p.created_at, p.id`, [orgId]);
  return rows.map(profileView);
}

export async function getProfile(q, orgId, profileId) {
  const row = await q.maybeOne(`${LIST_SQL} WHERE p.organization_id = $1 AND p.id = $2`, [orgId, profileId]);
  if (!row) throw notFound('Alert profile not found');
  return row;
}

export async function createProfile(q, actor, { orgId, userId, userEmail }, input) {
  await assertMasterIds(q, input);
  // Serialise creations per organization so two simultaneous requests cannot exceed the plan's limit.
  const org = await q.maybeOne(
    `SELECT o.id, coalesce(p.max_alert_profiles, 5) AS max_profiles FROM organizations o
       LEFT JOIN plans p ON p.id = o.plan_id WHERE o.id = $1 FOR UPDATE OF o`, [orgId]);
  if (!org) throw notFound('Organization not found');
  const { n } = await q.one('SELECT count(*)::int AS n FROM alert_profiles WHERE organization_id = $1', [orgId]);
  if (n >= org.max_profiles) {
    throw conflict(`Your plan allows ${org.max_profiles} alert profiles. Delete one or ask Shan-Deep to upgrade the plan.`);
  }
  const recipients = input.recipientEmails.length ? input.recipientEmails : userEmail ? [userEmail] : [];
  const row = await q.one(
    `INSERT INTO alert_profiles
       (organization_id, user_id, name, keywords, exclude_keywords, category_ids, department_ids, state_ids, tender_types,
        value_min, value_max, include_unknown_value, recipient_emails, frequency, weekly_day, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [orgId, userId ?? null, input.name, input.keywords, input.excludeKeywords, input.categoryIds, input.departmentIds,
      input.stateIds, input.tenderTypes, input.valueMin, input.valueMax, input.includeUnknownValue, recipients,
      input.frequency, input.weeklyDay, input.status]
  );
  await audit(q, actor, 'alert_profile.create', 'alert_profile', row.id, { orgId, name: input.name });
  return profileView(await getProfile(q, orgId, row.id));
}

export async function updateProfile(q, actor, orgId, profileId, patch) {
  const current = await getProfile(q, orgId, profileId);
  await assertMasterIds(q, patch);
  const next = {
    name: patch.name ?? current.name,
    keywords: patch.keywords ?? current.keywords,
    excludeKeywords: patch.excludeKeywords ?? current.exclude_keywords,
    categoryIds: patch.categoryIds ?? current.category_ids,
    departmentIds: patch.departmentIds ?? current.department_ids,
    stateIds: patch.stateIds ?? current.state_ids,
    tenderTypes: patch.tenderTypes ?? current.tender_types,
    valueMin: patch.valueMin === undefined ? current.value_min : patch.valueMin,
    valueMax: patch.valueMax === undefined ? current.value_max : patch.valueMax,
    includeUnknownValue: patch.includeUnknownValue ?? current.include_unknown_value,
    recipientEmails: patch.recipientEmails ?? current.recipient_emails,
    frequency: patch.frequency ?? current.frequency,
    weeklyDay: patch.weeklyDay ?? current.weekly_day,
    status: patch.status ?? current.status,
  };
  if (next.valueMin != null && next.valueMax != null && next.valueMin > next.valueMax) {
    throw badRequest('Minimum value cannot be above the maximum');
  }
  await q.query(
    `UPDATE alert_profiles SET name=$3, keywords=$4, exclude_keywords=$5, category_ids=$6, department_ids=$7, state_ids=$8,
       tender_types=$9, value_min=$10, value_max=$11, include_unknown_value=$12, recipient_emails=$13, frequency=$14,
       weekly_day=$15, status=$16 WHERE organization_id=$1 AND id=$2`,
    [orgId, profileId, next.name, next.keywords, next.excludeKeywords, next.categoryIds, next.departmentIds, next.stateIds,
      next.tenderTypes, next.valueMin, next.valueMax, next.includeUnknownValue, next.recipientEmails, next.frequency,
      next.weeklyDay, next.status]
  );
  await audit(q, actor, 'alert_profile.update', 'alert_profile', profileId, { orgId, changed: Object.keys(patch) });
  return profileView(await getProfile(q, orgId, profileId));
}

export async function deleteProfile(q, actor, orgId, profileId) {
  const done = await q.query('DELETE FROM alert_profiles WHERE organization_id = $1 AND id = $2', [orgId, profileId]);
  if (!done.rowCount) throw notFound('Alert profile not found');
  await audit(q, actor, 'alert_profile.delete', 'alert_profile', profileId, { orgId });
}

/**
 * Turn a search (or saved search) into the matching alert profile. Free text
 * becomes keywords (quoted phrases stay whole); "-word" becomes an exclusion.
 */
export function profileInputFromFilters(filters, name) {
  const keywords = [];
  const exclude = [];
  const pattern = /(-?)"([^"]+)"|(-?)(\S+)/g;
  let m;
  while ((m = pattern.exec(filters.q ?? ''))) {
    const word = (m[2] ?? m[4]).trim();
    if (!word) continue;
    ((m[1] || m[3]) === '-' ? exclude : keywords).push(word);
  }
  for (const w of (filters.exclude ?? '').split(/[\s,]+/).filter(Boolean)) exclude.push(w);
  return {
    name,
    keywords: [...new Set(keywords)].slice(0, 30),
    excludeKeywords: [...new Set(exclude)].slice(0, 30),
    categoryIds: filters.categoryIds ?? [],
    departmentIds: filters.departmentIds ?? [],
    stateIds: filters.stateIds ?? [],
    tenderTypes: filters.tenderTypes ?? [],
    valueMin: filters.valueMin ? Number(filters.valueMin) : null,
    valueMax: filters.valueMax ? Number(filters.valueMax) : null,
  };
}
