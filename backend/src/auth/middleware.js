import crypto from 'node:crypto';
import { config } from '../config.js';
import { asyncHandler, forbidden, unauthorized } from '../errors.js';
import { can, contextFor } from './permissions.js';
import { loadSession } from './sessions.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Reads the session cookie and sets req.auth ({ user, csrfToken, ... }) or null. */
export function attachAuth(db) {
  return asyncHandler(async (req, res, next) => {
    req.auth = await loadSession(db, req.cookies?.[config.session.cookieName]);
    next();
  });
}

export function requireAuth(req, res, next) {
  if (!req.auth) return next(unauthorized());
  next();
}

export const requirePermission = (permission) => (req, res, next) => {
  if (!req.auth) return next(unauthorized());
  if (!can(req.auth.user, permission)) return next(forbidden());
  next();
};

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.auth) return next(unauthorized());
  if (!roles.includes(req.auth.user.role)) return next(forbidden());
  next();
};

/**
 * CSRF defence for cookie sessions: every unsafe request from a signed-in
 * browser must carry the session's CSRF token in a header. SameSite=Lax on
 * the cookie is a second layer.
 */
export function csrfProtect({ exempt = [] } = {}) {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method) || !req.auth || exempt.includes(req.path)) return next();
    const sent = Buffer.from(String(req.get(config.session.csrfHeader) ?? ''));
    const expected = Buffer.from(req.auth.csrfToken);
    if (sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) {
      return next(forbidden('Missing or invalid CSRF token'));
    }
    next();
  };
}

/** Run fn(q) under the signed-in user's own database context (tenant or staff). */
export const withUserDb = (req, fn) => req.app.locals.db.withContext(contextFor(req.auth.user), fn);

/**
 * Run fn(q) with full (system) scope. Only call this AFTER the route has
 * authorised the action and bound every query to the caller's organization.
 */
export const withSystemDb = (req, fn) => req.app.locals.db.withContext({ scope: 'system' }, fn);

export const clientIp = (req) => req.ip || req.socket?.remoteAddress || null;
