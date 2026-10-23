/**
 * Server-side sessions. The browser holds an opaque random token in an
 * httpOnly cookie; only its SHA-256 is stored, so a database leak does not
 * yield usable sessions. A per-session CSRF secret is returned to the SPA and
 * must be echoed in the x-csrf-token header on every state-changing request.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { isStaffRole } from './permissions.js';

const TOUCH_AFTER_MS = 5 * 60 * 1000;

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** Create a session row. `q` is an open system-scope transaction. */
export async function createSession(q, { userId, orgId, ip, userAgent }) {
  const token = newToken();
  const csrfToken = newToken();
  const expiresAt = new Date(Date.now() + config.session.ttlMs);
  await q.query(
    `INSERT INTO user_sessions (id, user_id, organization_id, ip_address, user_agent, csrf_secret, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [hashToken(token), userId, orgId, ip ?? null, (userAgent ?? '').slice(0, 300), csrfToken, expiresAt]
  );
  return { token, csrfToken, expiresAt };
}

/** Resolve a cookie token to the signed-in identity, or null. */
export async function loadSession(db, token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  return db.withPrismaContext({ scope: 'system' }, async (tx) => {
    const row = await tx.user_sessions.findFirst({
      where: { id: hashToken(token), expires_at: { gt: new Date() } },
      include: { users: { include: { organizations: { include: { plans: true } } } } },
    });
    if (!row || !row.users.is_active || row.users.organizations.status !== 'Active') return null;
    const user = row.users;
    const org = user.organizations;

    if (Date.now() - new Date(row.last_seen_at).getTime() > TOUCH_AFTER_MS) {
      await tx.user_sessions.update({ where: { id: row.id }, data: { last_seen_at: new Date() } });
    }
    return {
      sessionId: row.id,
      csrfToken: row.csrf_secret,
      expiresAt: row.expires_at,
      user: {
        id: user.id,
        orgId: user.organization_id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        language: user.language,
        isStaff: isStaffRole(user.role),
        orgName: org.name,
        planCode: org.plans?.code ?? null,
        planName: org.plans?.name ?? null,
      },
    };
  });
}

export async function destroySession(q, sessionId) {
  await q.query('DELETE FROM user_sessions WHERE id = $1', [sessionId]);
}

export async function destroyUserSessions(q, userId, exceptSessionId = null) {
  await q.query('DELETE FROM user_sessions WHERE user_id = $1 AND ($2::text IS NULL OR id <> $2)', [
    userId,
    exceptSessionId,
  ]);
}

export function cookieOptions(expiresAt) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.session.secureCookie,
    path: '/',
    expires: expiresAt,
  };
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    role: user.role,
    language: user.language,
    isStaff: user.isStaff,
    orgId: user.orgId,
    orgName: user.orgName,
    planCode: user.planCode ?? null,
    planName: user.planName ?? null,
  };
}
