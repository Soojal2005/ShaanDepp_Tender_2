/**
 * Organizations and their members.
 *
 * Every function takes an open transaction `q` that is already authorised by
 * the caller; callers pass the organization id they have verified (a client
 * admin's own org, or any org for platform admins). Seat limits are enforced
 * here under a row lock on the organization so two simultaneous invitations
 * cannot both take the last seat.
 */
import { CLIENT_ROLES, STAFF_ROLES } from '../auth/permissions.js';
import { unusablePasswordHash } from '../auth/password.js';
import { destroyUserSessions } from '../auth/sessions.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { audit } from './audit.js';
import { queueInvite } from './accountEmails.js';

const ORG_SELECT = `
  SELECT o.id, o.name, o.domain, o.gstin, o.contact_name, o.contact_phone, o.status, o.is_staff_org,
         o.language, o.created_at, o.plan_id, o.alert_cap_override, o.seat_limit_override,
         p.code AS plan_code, p.name AS plan_name,
         coalesce(o.alert_cap_override, p.daily_alert_cap) AS alert_cap,
         coalesce(o.seat_limit_override, p.max_seats, 3) AS seat_limit,
         coalesce(p.max_alert_profiles, 5) AS max_alert_profiles,
         (SELECT count(*) FROM users u WHERE u.organization_id = o.id AND u.is_active)::int AS seats_used
    FROM organizations o
    LEFT JOIN plans p ON p.id = o.plan_id`;

export const orgView = (r) => ({
  id: r.id,
  name: r.name,
  domain: r.domain,
  gstin: r.gstin,
  contactName: r.contact_name,
  contactPhone: r.contact_phone,
  status: r.status,
  isStaffOrg: r.is_staff_org,
  language: r.language,
  createdAt: r.created_at,
  plan: r.plan_code ? { code: r.plan_code, name: r.plan_name } : null,
  alertCap: r.alert_cap,
  alertCapOverride: r.alert_cap_override,
  maxAlertProfiles: r.max_alert_profiles,
  seatLimit: r.seat_limit,
  seatLimitOverride: r.seat_limit_override,
  seatsUsed: r.seats_used,
});

export const memberView = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  isActive: u.is_active,
  language: u.language,
  lastLoginAt: u.last_login_at,
  createdAt: u.created_at,
});

export async function getOrganization(q, orgId, { lock = false } = {}) {
  const row = await q.maybeOne(`${ORG_SELECT} WHERE o.id = $1 ${lock ? 'FOR UPDATE OF o' : ''}`, [orgId]);
  return row;
}

export async function listOrganizations(q) {
  const rows = await q.many(`${ORG_SELECT} ORDER BY o.is_staff_org DESC, o.name`);
  return rows.map(orgView);
}

export async function listMembers(q, orgId) {
  const rows = await q.many(
    `SELECT id, name, email, phone, role, is_active, language, last_login_at, created_at
       FROM users WHERE organization_id = $1 ORDER BY is_active DESC, name`,
    [orgId]
  );
  return rows.map(memberView);
}

function assertRoleFitsOrg(org, role) {
  const allowed = org.is_staff_org ? STAFF_ROLES : CLIENT_ROLES;
  if (!allowed.includes(role)) {
    throw badRequest(
      org.is_staff_org
        ? `Staff accounts must be one of: ${STAFF_ROLES.join(', ')}`
        : `Client accounts must be one of: ${CLIENT_ROLES.join(', ')}`
    );
  }
}

function assertSeatAvailable(org) {
  if (org.is_staff_org) return;
  if (org.seats_used >= org.seat_limit) {
    throw conflict(
      `Seat limit reached (${org.seats_used} of ${org.seat_limit} logins in use). Deactivate a user or ask Shan-Deep to upgrade the plan.`
    );
  }
}

/** Create a user for an organization and email them a link to set their password. */
export async function inviteMember(q, actor, orgId, { name, email, phone = null, role, language = null }) {
  const org = await getOrganization(q, orgId, { lock: true });
  if (!org) throw notFound('Organization not found');
  if (org.status === 'Suspended') throw conflict('This organization is suspended');
  assertRoleFitsOrg(org, role);
  assertSeatAvailable(org);

  const taken = await q.maybeOne('SELECT 1 AS x FROM users WHERE email = $1', [email]);
  if (taken) throw conflict('A user with this email address already exists');

  const user = await q.one(
    `INSERT INTO users (organization_id, name, email, phone, role, language)
     VALUES ($1, $2, $3, $4, $5, coalesce($6, $7)) RETURNING *`,
    [orgId, name, email, phone, role, language, org.language]
  );
  await q.query('INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)', [
    user.id,
    await unusablePasswordHash(),
  ]);
  await queueInvite(q, {
    user: { id: user.id, name: user.name, email: user.email, orgId },
    invitedBy: actor.user?.name ?? 'Shan-Deep',
    orgName: org.name,
  });
  await audit(q, actor, 'user.invite', 'user', user.id, { orgId, role });
  return memberView(user);
}

/** Change a member's name, phone, role or active flag. */
export async function updateMember(q, actor, orgId, userId, patch) {
  const org = await getOrganization(q, orgId, { lock: true });
  if (!org) throw notFound('Organization not found');
  const user = await q.maybeOne('SELECT * FROM users WHERE id = $1 AND organization_id = $2 FOR UPDATE', [userId, orgId]);
  if (!user) throw notFound('User not found');

  const next = {
    name: patch.name ?? user.name,
    phone: patch.phone === undefined ? user.phone : patch.phone,
    role: patch.role ?? user.role,
    is_active: patch.isActive ?? user.is_active,
  };
  if (next.role !== user.role) assertRoleFitsOrg(org, next.role);

  const isSelf = actor.user?.id === user.id;
  if (isSelf && (!next.is_active || next.role !== user.role)) {
    throw conflict('You cannot deactivate or change the role of your own account');
  }
  if (!user.is_active && next.is_active) assertSeatAvailable(org);

  const losesAdmin =
    user.role === 'tenant_admin' && user.is_active && (!next.is_active || next.role !== 'tenant_admin');
  if (losesAdmin && !org.is_staff_org) {
    const others = await q.one(
      `SELECT count(*)::int AS n FROM users
        WHERE organization_id = $1 AND role = 'tenant_admin' AND is_active AND id <> $2`,
      [orgId, userId]
    );
    if (others.n === 0) throw conflict('An organization needs at least one active administrator');
  }

  const updated = await q.one(
    `UPDATE users SET name = $1, phone = $2, role = $3, is_active = $4 WHERE id = $5 RETURNING *`,
    [next.name, next.phone, next.role, next.is_active, userId]
  );
  if (user.is_active && !next.is_active) await destroyUserSessions(q, userId);
  if (next.role !== user.role) await destroyUserSessions(q, userId);
  await audit(q, actor, 'user.update', 'user', userId, {
    orgId,
    changed: Object.keys(patch),
    role: next.role,
    isActive: next.is_active,
  });
  return memberView(updated);
}

export async function createOrganization(q, actor, input) {
  const plan = input.planCode
    ? await q.maybeOne('SELECT id FROM plans WHERE code = $1 AND is_active', [input.planCode])
    : null;
  if (input.planCode && !plan) throw badRequest(`Unknown plan: ${input.planCode}`);

  const org = await q.one(
    `INSERT INTO organizations (name, domain, gstin, contact_name, contact_phone, plan_id, language, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'Active') RETURNING id`,
    [input.name, input.domain ?? null, input.gstin ?? null, input.contactName ?? null,
     input.contactPhone ?? null, plan?.id ?? null, input.language ?? 'EN']
  );
  await audit(q, actor, 'org.create', 'organization', org.id, { name: input.name, plan: input.planCode ?? null });

  let admin = null;
  if (input.admin) {
    admin = await inviteMember(q, actor, org.id, { ...input.admin, role: 'tenant_admin', language: input.language });
  }
  return { organization: orgView(await getOrganization(q, org.id)), admin };
}

export async function updateOrganization(q, actor, orgId, patch) {
  const current = await getOrganization(q, orgId, { lock: true });
  if (!current) throw notFound('Organization not found');
  if (current.is_staff_org && patch.status && patch.status !== 'Active') {
    throw conflict('The Shan-Deep staff organization cannot be suspended');
  }

  let planId = current.plan_id;
  if (patch.planCode !== undefined) {
    if (patch.planCode === null) planId = null;
    else {
      const plan = await q.maybeOne('SELECT id FROM plans WHERE code = $1 AND is_active', [patch.planCode]);
      if (!plan) throw badRequest(`Unknown plan: ${patch.planCode}`);
      planId = plan.id;
    }
  }
  const pick = (key, column) => (patch[key] === undefined ? current[column] : patch[key]);

  await q.query(
    `UPDATE organizations
        SET name = $1, domain = $2, gstin = $3, contact_name = $4, contact_phone = $5, plan_id = $6,
            alert_cap_override = $7, seat_limit_override = $8, status = $9, language = $10
      WHERE id = $11`,
    [
      pick('name', 'name'), pick('domain', 'domain'), pick('gstin', 'gstin'),
      pick('contactName', 'contact_name'), pick('contactPhone', 'contact_phone'), planId,
      pick('alertCapOverride', 'alert_cap_override'), pick('seatLimitOverride', 'seat_limit_override'),
      pick('status', 'status'), pick('language', 'language'), orgId,
    ]
  );
  await audit(q, actor, 'org.update', 'organization', orgId, { changed: Object.keys(patch) });
  return orgView(await getOrganization(q, orgId));
}
