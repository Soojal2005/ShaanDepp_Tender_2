/** A client organization managing its own logins (the "up to 3 logins per account" rule). */
import { Router } from 'express';
import { requireAuth, requirePermission, withSystemDb } from '../auth/middleware.js';
import { asyncHandler } from '../errors.js';
import { actorOf } from '../services/audit.js';
import { getOrganization, inviteMember, listMembers, orgView, updateMember } from '../services/orgs.js';
import { email, id, parse, z } from '../validate.js';

export function orgRoutes() {
  const r = Router();
  r.use(requireAuth);

  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const org = await withSystemDb(req, (q) => getOrganization(q, req.auth.user.orgId));
      res.json({ organization: orgView(org) });
    })
  );

  r.get(
    '/members',
    asyncHandler(async (req, res) => {
      const members = await withSystemDb(req, (q) => listMembers(q, req.auth.user.orgId));
      res.json({ members });
    })
  );

  r.post(
    '/members',
    requirePermission('members:manage'),
    asyncHandler(async (req, res) => {
      const input = parse(
        z.object({
          name: z.string().trim().min(1).max(150),
          email,
          phone: z.string().trim().max(50).nullish(),
          role: z.enum(['subscriber', 'tenant_admin']).default('subscriber'),
        }),
        req.body
      );
      const member = await withSystemDb(req, (q) => inviteMember(q, actorOf(req), req.auth.user.orgId, input));
      res.status(201).json({ member });
    })
  );

  r.patch(
    '/members/:userId',
    requirePermission('members:manage'),
    asyncHandler(async (req, res) => {
      const userId = parse(z.object({ userId: id }), req.params).userId;
      const patch = parse(
        z.object({
          name: z.string().trim().min(1).max(150).optional(),
          phone: z.string().trim().max(50).nullable().optional(),
          role: z.enum(['subscriber', 'tenant_admin']).optional(),
          isActive: z.boolean().optional(),
        }),
        req.body
      );
      const member = await withSystemDb(req, (q) =>
        updateMember(q, actorOf(req), req.auth.user.orgId, userId, patch)
      );
      res.json({ member });
    })
  );

  return r;
}
