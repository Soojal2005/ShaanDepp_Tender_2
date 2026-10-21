import { Router } from 'express';
import { config } from '../config.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../auth/password.js';
import { clientIp, requireAuth, withSystemDb } from '../auth/middleware.js';
import { cookieOptions, createSession, destroySession, destroyUserSessions, publicUser } from '../auth/sessions.js';
import { HttpError, asyncHandler, forbidden, unauthorized } from '../errors.js';
import { audit, actorOf } from '../services/audit.js';
import { queuePasswordReset } from '../services/accountEmails.js';
import { consumeResetToken } from '../services/accountTokens.js';
import { getOrganization, orgView } from '../services/orgs.js';
import { email, parse, password, z } from '../validate.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const GENERIC_LOGIN_ERROR = 'Invalid email or password';

export function authRoutes({ limiters }) {
  const r = Router();

  r.post(
    '/login',
    limiters.login,
    asyncHandler(async (req, res) => {
      const input = parse(z.object({ email, password: z.string().min(1).max(200) }), req.body);

      // The outcome is computed inside the transaction but any error is thrown
      // after it commits, so the failed-attempt counter is never rolled back.
      const outcome = await withSystemDb(req, async (q) => {
        const row = await q.maybeOne(
          `SELECT u.id, u.organization_id, u.name, u.email, u.phone, u.role, u.language, u.is_active,
                  c.password_hash, c.failed_login_count, c.locked_until,
                  o.name AS org_name, o.status AS org_status, o.is_staff_org,
                  p.code AS plan_code, p.name AS plan_name
             FROM users u
             JOIN user_credentials c ON c.user_id = u.id
             JOIN organizations o ON o.id = u.organization_id
             LEFT JOIN plans p ON p.id = o.plan_id
            WHERE u.email = $1`,
          [input.email]
        );
        if (!row) return { error: 'invalid', burn: true };
        if (row.locked_until && new Date(row.locked_until) > new Date()) return { error: 'locked' };

        const ok = await verifyPassword(input.password, row.password_hash);
        if (!ok) {
          const failures = row.failed_login_count + 1;
          const lock = failures >= MAX_FAILED_LOGINS;
          await q.query(
            `UPDATE user_credentials
                SET failed_login_count = $2,
                    locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END
              WHERE user_id = $1`,
            [row.id, lock ? 0 : failures, lock, LOCK_MINUTES]
          );
          await audit(q, { user: null, ip: clientIp(req) }, lock ? 'auth.locked' : 'auth.login_failed', 'user', row.id, {
            email: row.email,
          });
          return { error: 'invalid' };
        }
        if (!row.is_active) return { error: 'inactive' };
        if (row.org_status !== 'Active') return { error: 'org_suspended' };

        await q.query('UPDATE user_credentials SET failed_login_count = 0, locked_until = NULL WHERE user_id = $1', [row.id]);
        await q.query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id]);
        const session = await createSession(q, {
          userId: row.id,
          orgId: row.organization_id,
          ip: clientIp(req),
          userAgent: req.get('user-agent'),
        });
        const user = {
          id: row.id, orgId: row.organization_id, name: row.name, email: row.email, phone: row.phone,
          role: row.role, language: row.language, isStaff: ['analyst', 'case_manager', 'platform_admin'].includes(row.role),
          orgName: row.org_name, planCode: row.plan_code, planName: row.plan_name,
        };
        await audit(q, { user, ip: clientIp(req) }, 'auth.login', 'user', row.id);
        return { session, user };
      });

      if (outcome.burn) await burnPasswordCheck(input.password);
      if (outcome.error === 'locked') {
        throw new HttpError(429, `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`, { code: 'locked' });
      }
      if (outcome.error === 'inactive') throw forbidden('This account has been deactivated');
      if (outcome.error === 'org_suspended') throw forbidden('This organization is suspended. Please contact Shan-Deep.');
      if (outcome.error) throw unauthorized(GENERIC_LOGIN_ERROR);

      res.cookie(config.session.cookieName, outcome.session.token, cookieOptions(outcome.session.expiresAt));
      res.json({ user: publicUser(outcome.user), csrfToken: outcome.session.csrfToken });
    })
  );

  r.post(
    '/logout',
    requireAuth,
    asyncHandler(async (req, res) => {
      await withSystemDb(req, async (q) => {
        await destroySession(q, req.auth.sessionId);
        await audit(q, actorOf(req), 'auth.logout', 'user', req.auth.user.id);
      });
      res.clearCookie(config.session.cookieName, { ...cookieOptions(), expires: undefined });
      res.status(204).end();
    })
  );

  r.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const org = await withSystemDb(req, (q) => getOrganization(q, req.auth.user.orgId));
      res.json({ user: publicUser(req.auth.user), csrfToken: req.auth.csrfToken, organization: orgView(org) });
    })
  );

  r.patch(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const patch = parse(
        z.object({
          name: z.string().trim().min(1).max(150).optional(),
          phone: z.string().trim().max(50).nullable().optional(),
          language: z.enum(['EN', 'HI']).optional(),
        }),
        req.body
      );
      const row = await withSystemDb(req, async (q) => {
        const updated = await q.one(
          `UPDATE users SET name = coalesce($1, name),
                            phone = CASE WHEN $2::boolean THEN $3 ELSE phone END,
                            language = coalesce($4, language)
            WHERE id = $5 RETURNING name, phone, language`,
          [patch.name ?? null, patch.phone !== undefined, patch.phone ?? null, patch.language ?? null, req.auth.user.id]
        );
        await audit(q, actorOf(req), 'user.profile_update', 'user', req.auth.user.id, { changed: Object.keys(patch) });
        return updated;
      });
      res.json({ user: publicUser({ ...req.auth.user, ...row }) });
    })
  );

  r.post(
    '/change-password',
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }), req.body);
      const ok = await withSystemDb(req, async (q) => {
        const cred = await q.one('SELECT password_hash FROM user_credentials WHERE user_id = $1', [req.auth.user.id]);
        if (!(await verifyPassword(input.currentPassword, cred.password_hash))) return false;
        await q.query('UPDATE user_credentials SET password_hash = $2, password_changed_at = now() WHERE user_id = $1', [
          req.auth.user.id,
          await hashPassword(input.newPassword),
        ]);
        await destroyUserSessions(q, req.auth.user.id, req.auth.sessionId);
        await audit(q, actorOf(req), 'auth.password_change', 'user', req.auth.user.id);
        return true;
      });
      if (!ok) throw new HttpError(400, 'Your current password is not correct', { code: 'wrong_password' });
      res.status(204).end();
    })
  );

  // Always answers 202 so the form cannot be used to discover which emails have accounts.
  r.post(
    '/forgot-password',
    limiters.passwordReset,
    asyncHandler(async (req, res) => {
      const input = parse(z.object({ email }), req.body);
      await withSystemDb(req, async (q) => {
        const user = await q.maybeOne(
          `SELECT u.id, u.name, u.email, u.organization_id FROM users u
             JOIN organizations o ON o.id = u.organization_id
            WHERE u.email = $1 AND u.is_active AND o.status = 'Active'`,
          [input.email]
        );
        if (user) await queuePasswordReset(q, user);
      });
      res.status(202).json({ message: 'If that email has an account, a reset link is on its way.' });
    })
  );

  // Also used to accept an invitation (the invited user chooses their first password).
  r.post(
    '/reset-password',
    limiters.passwordReset,
    asyncHandler(async (req, res) => {
      const input = parse(z.object({ token: z.string().min(10).max(200), password }), req.body);
      const userId = await withSystemDb(req, async (q) => {
        const id = await consumeResetToken(q, input.token);
        if (!id) return null;
        await q.query(
          `UPDATE user_credentials
              SET password_hash = $2, password_changed_at = now(), failed_login_count = 0, locked_until = NULL
            WHERE user_id = $1`,
          [id, await hashPassword(input.password)]
        );
        await destroyUserSessions(q, id);
        await audit(q, { user: null, ip: clientIp(req) }, 'auth.password_reset', 'user', id);
        return id;
      });
      if (!userId) throw new HttpError(400, 'This link is invalid or has expired', { code: 'invalid_token' });
      res.status(204).end();
    })
  );

  return r;
}
