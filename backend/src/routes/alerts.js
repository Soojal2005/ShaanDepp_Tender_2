/**
 * Alert profiles. A subscriber manages their own organization's profiles; a
 * platform administrator can manage any organization's on its behalf. Both
 * paths call the same service functions, always bound to one organization id.
 */
import { Router } from 'express';
import { requireAuth, requirePermission, withSystemDb } from '../auth/middleware.js';
import { config } from '../config.js';
import { asyncHandler, notFound } from '../errors.js';
import { actorOf } from '../services/audit.js';
import { previewDigest, sendTestDigest } from '../services/alerts/digest.js';
import {
  createProfile, createProfileSchema, deleteProfile, getProfile, listProfiles, patchProfileSchema,
  profileInputFromFilters, updateProfile,
} from '../services/alerts/profiles.js';
import { filtersSchema } from '../services/tenderSearch.js';
import { id, parse, z } from '../validate.js';

function profileRoutes(resolveOrgId, limiters) {
  const r = Router({ mergeParams: true });

  r.get('/', asyncHandler(async (req, res) => {
    res.json({ profiles: await withSystemDb(req, (q) => listProfiles(q, resolveOrgId(req))) });
  }));

  r.post('/', asyncHandler(async (req, res) => {
    const input = parse(createProfileSchema, req.body);
    const profile = await withSystemDb(req, (q) =>
      createProfile(q, actorOf(req), { orgId: resolveOrgId(req), userId: req.auth.user.id, userEmail: req.auth.user.email }, input));
    res.status(201).json({ profile });
  }));

  r.post('/from-filters', asyncHandler(async (req, res) => {
    const { name, filters, frequency } = parse(
      z.object({ name: z.string().trim().min(1).max(150), filters: z.record(z.string(), z.unknown()), frequency: z.enum(['daily', 'alternate_day', 'weekly']).default('daily') }),
      req.body
    );
    const input = parse(createProfileSchema, { ...profileInputFromFilters(parse(filtersSchema, filters), name), frequency });
    const profile = await withSystemDb(req, (q) =>
      createProfile(q, actorOf(req), { orgId: resolveOrgId(req), userId: req.auth.user.id, userEmail: req.auth.user.email }, input));
    res.status(201).json({ profile });
  }));

  r.patch('/:profileId', asyncHandler(async (req, res) => {
    const { profileId } = parse(z.object({ profileId: id }), req.params);
    const patch = parse(patchProfileSchema, req.body);
    res.json({ profile: await withSystemDb(req, (q) => updateProfile(q, actorOf(req), resolveOrgId(req), profileId, patch)) });
  }));

  r.delete('/:profileId', asyncHandler(async (req, res) => {
    const { profileId } = parse(z.object({ profileId: id }), req.params);
    await withSystemDb(req, (q) => deleteProfile(q, actorOf(req), resolveOrgId(req), profileId));
    res.status(204).end();
  }));

  // What the next digest would hold right now. Nothing is recorded or sent.
  r.get('/:profileId/preview', asyncHandler(async (req, res) => {
    const { profileId } = parse(z.object({ profileId: id }), req.params);
    const preview = await withSystemDb(req, async (q) => {
      await getProfile(q, resolveOrgId(req), profileId);
      return previewDigest(q, profileId);
    });
    res.json({ preview });
  }));

  // Sends the digest as it would look to the signed-in user only, without recording anything.
  r.post('/:profileId/test', limiters.alertTest, asyncHandler(async (req, res) => {
    const { profileId } = parse(z.object({ profileId: id }), req.params);
    const result = await withSystemDb(req, async (q) => {
      await getProfile(q, resolveOrgId(req), profileId);
      return sendTestDigest(q, profileId, { to: req.auth.user.email, baseUrl: config.publicBaseUrl });
    });
    res.json({ result, sentTo: req.auth.user.email, dryRun: config.mail.dryRun });
  }));

  r.get('/:profileId/digests', asyncHandler(async (req, res) => {
    const { profileId } = parse(z.object({ profileId: id }), req.params);
    const digests = await withSystemDb(req, async (q) => {
      await getProfile(q, resolveOrgId(req), profileId);
      return q.many(
        `SELECT id, digest_date, matched_count, included_count, cap, generated_at,
                (SELECT count(*)::int FROM alert_digest_items i WHERE i.digest_id = d.id AND NOT i.in_digest) AS held_back
           FROM alert_digests d WHERE profile_id = $1 AND NOT is_test ORDER BY digest_date DESC LIMIT 30`, [profileId]);
    });
    res.json({ digests });
  }));

  return r;
}

export function alertRoutes({ limiters }) {
  const r = Router();
  r.use(requireAuth);
  r.use('/', profileRoutes((req) => req.auth.user.orgId, limiters));
  return r;
}

/** Administrators managing alerts on behalf of a subscriber organization. */
export function adminAlertRoutes({ limiters }) {
  const r = Router();
  r.use(requirePermission('orgs:manage'));
  r.use('/:orgId/alert-profiles', (req, res, next) => {
    const orgId = Number(req.params.orgId);
    if (!Number.isInteger(orgId) || orgId < 1) return next(notFound('Organization not found'));
    next();
  }, profileRoutes((req) => Number(req.params.orgId), limiters));
  return r;
}
