/** Platform administration: plans, organizations, users, enquiries inbox and the audit log. */
import { Router } from 'express';
import { requirePermission, withSystemDb } from '../auth/middleware.js';
import { STAFF_ROLES } from '../auth/permissions.js';
import { destroyUserSessions } from '../auth/sessions.js';
import { asyncHandler, badRequest, notFound } from '../errors.js';
import { actorOf, audit } from '../services/audit.js';
import { queuePasswordReset } from '../services/accountEmails.js';
import {
  createOrganization, getOrganization, inviteMember, listMembers, listOrganizations,
  orgView, updateMember, updateOrganization,
} from '../services/orgs.js';
import { email, id, parse, z } from '../validate.js';

const adminUser = z.object({
  name: z.string().trim().min(1).max(150),
  email,
  phone: z.string().trim().max(50).nullish(),
});

export function adminRoutes() {
  const r = Router();

  // ---- Plans ---------------------------------------------------------------
  r.get(
    '/plans',
    requirePermission('plans:manage'),
    asyncHandler(async (req, res) => {
      const plans = await withSystemDb(req, (q) => q.many('SELECT * FROM plans ORDER BY sort_order'));
      res.json({ plans });
    })
  );

  r.put(
    '/plans/:planId',
    requirePermission('plans:manage'),
    asyncHandler(async (req, res) => {
      const planId = parse(z.object({ planId: id }), req.params).planId;
      const input = parse(
        z.object({
          name: z.string().trim().min(1).max(100),
          dailyAlertCap: z.number().int().min(1).max(500),
          maxSeats: z.number().int().min(1).max(50),
          maxAlertProfiles: z.number().int().min(1).max(100),
          isActive: z.boolean(),
        }),
        req.body
      );
      const plan = await withSystemDb(req, async (q) => {
        const row = await q.maybeOne(
          `UPDATE plans SET name = $1, daily_alert_cap = $2, max_seats = $3, max_alert_profiles = $4, is_active = $5
            WHERE id = $6 RETURNING *`,
          [input.name, input.dailyAlertCap, input.maxSeats, input.maxAlertProfiles, input.isActive, planId]
        );
        if (!row) throw notFound('Plan not found');
        await audit(q, actorOf(req), 'plan.update', 'plan', planId, input);
        return row;
      });
      res.json({ plan });
    })
  );

  // ---- Organizations -------------------------------------------------------
  r.get(
    '/organizations',
    requirePermission('orgs:manage'),
    asyncHandler(async (req, res) => {
      res.json({ organizations: await withSystemDb(req, listOrganizations) });
    })
  );

  r.post(
    '/organizations',
    requirePermission('orgs:manage'),
    asyncHandler(async (req, res) => {
      const input = parse(
        z.object({
          name: z.string().trim().min(2).max(255),
          domain: z.string().trim().max(100).nullish(),
          gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'is not a valid GSTIN').nullish(),
          contactName: z.string().trim().max(150).nullish(),
          contactPhone: z.string().trim().max(50).nullish(),
          planCode: z.string().trim().min(1).max(50),
          language: z.enum(['EN', 'HI']).default('EN'),
          admin: adminUser,
        }),
        req.body
      );
      const created = await withSystemDb(req, (q) => createOrganization(q, actorOf(req), input));
      res.status(201).json(created);
    })
  );

  r.get(
    '/organizations/:orgId',
    requirePermission('orgs:manage'),
    asyncHandler(async (req, res) => {
      const orgId = parse(z.object({ orgId: id }), req.params).orgId;
      const result = await withSystemDb(req, async (q) => {
        const org = await getOrganization(q, orgId);
        if (!org) throw notFound('Organization not found');
        return { organization: orgView(org), members: await listMembers(q, orgId) };
      });
      res.json(result);
    })
  );

  r.patch(
    '/organizations/:orgId',
    requirePermission('orgs:manage'),
    asyncHandler(async (req, res) => {
      const orgId = parse(z.object({ orgId: id }), req.params).orgId;
      const patch = parse(
        z.object({
          name: z.string().trim().min(2).max(255).optional(),
          domain: z.string().trim().max(100).nullable().optional(),
          gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'is not a valid GSTIN').nullable().optional(),
          contactName: z.string().trim().max(150).nullable().optional(),
          contactPhone: z.string().trim().max(50).nullable().optional(),
          planCode: z.string().trim().min(1).max(50).nullable().optional(),
          alertCapOverride: z.number().int().min(1).max(500).nullable().optional(),
          seatLimitOverride: z.number().int().min(1).max(50).nullable().optional(),
          status: z.enum(['Active', 'Suspended', 'Pending']).optional(),
          language: z.enum(['EN', 'HI']).optional(),
        }),
        req.body
      );
      const organization = await withSystemDb(req, (q) => updateOrganization(q, actorOf(req), orgId, patch));
      res.json({ organization });
    })
  );

  r.post(
    '/organizations/:orgId/members',
    requirePermission('users:manage'),
    asyncHandler(async (req, res) => {
      const orgId = parse(z.object({ orgId: id }), req.params).orgId;
      const input = parse(
        adminUser.extend({ role: z.enum(['subscriber', 'tenant_admin', ...STAFF_ROLES]) }),
        req.body
      );
      const member = await withSystemDb(req, (q) => inviteMember(q, actorOf(req), orgId, input));
      res.status(201).json({ member });
    })
  );

  r.patch(
    '/organizations/:orgId/members/:userId',
    requirePermission('users:manage'),
    asyncHandler(async (req, res) => {
      const { orgId, userId } = parse(z.object({ orgId: id, userId: id }), req.params);
      const patch = parse(
        z.object({
          name: z.string().trim().min(1).max(150).optional(),
          phone: z.string().trim().max(50).nullable().optional(),
          role: z.enum(['subscriber', 'tenant_admin', ...STAFF_ROLES]).optional(),
          isActive: z.boolean().optional(),
        }),
        req.body
      );
      const member = await withSystemDb(req, (q) => updateMember(q, actorOf(req), orgId, userId, patch));
      res.json({ member });
    })
  );

  r.post(
    '/users/:userId/reset-password',
    requirePermission('users:manage'),
    asyncHandler(async (req, res) => {
      const userId = parse(z.object({ userId: id }), req.params).userId;
      await withSystemDb(req, async (q) => {
        const user = await q.maybeOne(
          'SELECT id, name, email, organization_id FROM users WHERE id = $1 AND is_active',
          [userId]
        );
        if (!user) throw notFound('User not found or inactive');
        await destroyUserSessions(q, userId);
        await queuePasswordReset(q, user);
        await audit(q, actorOf(req), 'user.reset_password_requested', 'user', userId);
      });
      res.status(202).json({ message: 'Reset email queued' });
    })
  );

  // ---- Website enquiries inbox ---------------------------------------------
  r.get(
    '/enquiries',
    requirePermission('enquiries:view'),
    asyncHandler(async (req, res) => {
      const { status, limit } = parse(
        z.object({
          status: z.enum(['New', 'Contacted', 'Qualified', 'Closed']).optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
        req.query
      );
      const rows = await withSystemDb(req, (q) =>
        q.many(
          `SELECT id, name, company, phone, email, service, message, language, status, consent_timestamp,
                  privacy_notice_version, created_at
             FROM enquiries WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2`,
          [status ?? null, limit]
        )
      );
      res.json({ enquiries: rows });
    })
  );

  r.patch(
    '/enquiries/:enquiryId',
    requirePermission('enquiries:view'),
    asyncHandler(async (req, res) => {
      const enquiryId = parse(z.object({ enquiryId: id }), req.params).enquiryId;
      const input = parse(
        z.object({
          status: z.enum(['New', 'Contacted', 'Qualified', 'Closed']).optional(),
          note: z.string().trim().min(1).max(2000).optional(),
        }),
        req.body
      );
      if (!input.status && !input.note) throw badRequest('Provide a status or a note');
      await withSystemDb(req, async (q) => {
        const found = await q.maybeOne('SELECT id FROM enquiries WHERE id = $1', [enquiryId]);
        if (!found) throw notFound('Enquiry not found');
        if (input.status) await q.query('UPDATE enquiries SET status = $1 WHERE id = $2', [input.status, enquiryId]);
        if (input.note) {
          await q.query('INSERT INTO enquiry_followups (enquiry_id, assigned_to, notes) VALUES ($1, $2, $3)', [
            enquiryId, req.auth.user.id, input.note,
          ]);
        }
        await audit(q, actorOf(req), 'enquiry.update', 'enquiry', enquiryId, { status: input.status ?? null });
      });
      res.status(204).end();
    })
  );

  // ---- Audit log -----------------------------------------------------------
  r.get(
    '/audit',
    requirePermission('audit:view'),
    asyncHandler(async (req, res) => {
      const { limit, before, orgId } = parse(
        z.object({
          limit: z.coerce.number().int().min(1).max(500).default(100),
          before: z.coerce.number().int().positive().optional(),
          orgId: z.coerce.number().int().positive().optional(),
        }),
        req.query
      );
      const events = await withSystemDb(req, (q) =>
        q.many(
          `SELECT id, organization_id, user_id, actor_email, action, resource_type, resource_id, ip_address, metadata, created_at
             FROM audit_events
            WHERE ($1::bigint IS NULL OR id < $1) AND ($2::int IS NULL OR organization_id = $2)
            ORDER BY id DESC LIMIT $3`,
          [before ?? null, orgId ?? null, limit]
        )
      );
      res.json({ events });
    })
  );

  return r;
}
