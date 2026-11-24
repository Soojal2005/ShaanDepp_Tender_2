/** Platform administration: plans, organizations, users, enquiries inbox and the audit log. */
import { Router } from 'express';
import { requirePermission, withSystemDb } from '../auth/middleware.js';
import { CLIENT_ROLES, STAFF_ROLES } from '../auth/permissions.js';
import { destroyUserSessions } from '../auth/sessions.js';
import { asyncHandler, badRequest, conflict, notFound } from '../errors.js';
import { actorOf, audit } from '../services/audit.js';
import { queuePasswordReset } from '../services/accountEmails.js';
import { seedSubscriberProfile } from '../services/alerts/profiles.js';
import {
  createOrganization, getOrganization, inviteMember, listMembers, listOrganizations,
  orgView, updateMember, updateOrganization,
} from '../services/orgs.js';
import { email, id, parse, z } from '../validate.js';

const ALL_ROLES = [...CLIENT_ROLES, ...STAFF_ROLES];

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
          address: z.string().trim().max(300).nullish(),
          city: z.string().trim().max(100).nullish(),
          state: z.string().trim().max(100).nullish(),
          industry: z.string().trim().max(120).nullish(),
          planCode: z.string().trim().min(1).max(50),
          language: z.enum(['EN', 'HI']).default('EN'),
          admin: adminUser,
          // The first account's role (default: organization admin). Lets staff register the first user as a subscriber.
          adminRole: z.enum(CLIENT_ROLES).default('tenant_admin'),
          // Set when the organization is created from an access request, so the request is closed out with it.
          fromEnquiryId: id.optional(),
        }),
        req.body
      );
      const { fromEnquiryId, ...orgInput } = input;
      const created = await withSystemDb(req, async (q) => {
        if (fromEnquiryId) {
          const enquiry = await q.maybeOne(
            'SELECT id, organization_id, name, phone, gstin, address, city, state, industry, keywords FROM enquiries WHERE id = $1 FOR UPDATE',
            [fromEnquiryId]
          );
          if (!enquiry) throw notFound('Access request not found');
          if (enquiry.organization_id) throw conflict('An organization was already created from this request');
          // Carry the company identity captured at registration onto the new
          // organization, unless staff overrode a field in the conversion form.
          orgInput.gstin ??= enquiry.gstin;
          orgInput.address ??= enquiry.address;
          orgInput.city ??= enquiry.city;
          orgInput.state ??= enquiry.state;
          orgInput.industry ??= enquiry.industry;
          orgInput.keywords ??= enquiry.keywords;
          orgInput.contactName ??= enquiry.name;
          orgInput.contactPhone ??= enquiry.phone;
        }
        const result = await createOrganization(q, actorOf(req), orgInput);
        if (fromEnquiryId && result.admin) {
          await seedSubscriberProfile(q, actorOf(req), {
            orgId: result.organization.id, userId: result.admin.id, userEmail: result.admin.email,
            industry: orgInput.industry, keywords: orgInput.keywords, state: orgInput.state, city: orgInput.city,
          });
        }
        if (fromEnquiryId) {
          await q.query(
            `UPDATE enquiries SET organization_id = $1, status = 'Converted', converted_at = now() WHERE id = $2`,
            [result.organization.id, fromEnquiryId]
          );
          await audit(q, actorOf(req), 'enquiry.convert', 'enquiry', fromEnquiryId, { organizationId: result.organization.id });
        }
        return result;
      });
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

  // Approve an access request and create the person's login with a chosen role.
  // Three targets: a brand-new organization (client role), an existing
  // organization (client role), or the Shan-Deep staff organization (staff role).
  // Carries the company identity and seeds the subscriber's alert matching.
  r.post(
    '/enquiries/:enquiryId/approve',
    requirePermission('orgs:manage'),
    asyncHandler(async (req, res) => {
      const enquiryId = parse(z.object({ enquiryId: id }), req.params).enquiryId;
      const input = parse(
        z.object({
          role: z.enum(ALL_ROLES),
          target: z.enum(['new_org', 'existing_org']).default('new_org'),
          orgId: id.optional(),
          orgName: z.string().trim().min(2).max(255).optional(),
          planCode: z.string().trim().min(1).max(50).optional(),
          language: z.enum(['EN', 'HI']).optional(),
          // The person; defaults to what the request captured.
          name: z.string().trim().min(1).max(150).optional(),
          email: email.optional(),
          phone: z.string().trim().max(50).nullish(),
        }),
        req.body
      );
      const out = await withSystemDb(req, async (q) => {
        const enquiry = await q.maybeOne(
          `SELECT id, organization_id, name, email, phone, company, gstin, address, city, state, industry, keywords, language
             FROM enquiries WHERE id = $1 FOR UPDATE`,
          [enquiryId]
        );
        if (!enquiry) throw notFound('Access request not found');
        if (enquiry.organization_id) throw conflict('An organization was already created from this request');
        const person = {
          name: input.name ?? enquiry.name,
          email: input.email ?? enquiry.email,
          phone: input.phone ?? enquiry.phone ?? null,
        };
        const isStaff = STAFF_ROLES.includes(input.role);
        let organization = null;
        let member;
        let targetOrgId;

        if (isStaff) {
          const staff = await q.maybeOne('SELECT id FROM organizations WHERE is_staff_org LIMIT 1');
          if (!staff) throw conflict('No staff organization exists to add this person to');
          targetOrgId = staff.id;
          member = await inviteMember(q, actorOf(req), targetOrgId, { ...person, role: input.role });
        } else if (input.target === 'existing_org') {
          if (!input.orgId) throw badRequest('Choose an organization to add this person to');
          targetOrgId = input.orgId;
          member = await inviteMember(q, actorOf(req), targetOrgId, {
            ...person, role: input.role, industry: enquiry.industry, keywords: enquiry.keywords,
          });
          organization = orgView(await getOrganization(q, targetOrgId));
          await seedSubscriberProfile(q, actorOf(req), {
            orgId: targetOrgId, userId: member.id, userEmail: person.email,
            industry: enquiry.industry, keywords: enquiry.keywords, state: enquiry.state, city: enquiry.city,
          });
        } else {
          if (!input.planCode) throw badRequest('Choose a plan for the new organization');
          const created = await createOrganization(q, actorOf(req), {
            name: input.orgName ?? enquiry.company,
            gstin: enquiry.gstin, address: enquiry.address, city: enquiry.city, state: enquiry.state,
            industry: enquiry.industry, keywords: enquiry.keywords,
            contactName: enquiry.name, contactPhone: enquiry.phone,
            planCode: input.planCode, language: input.language ?? enquiry.language ?? 'EN',
            admin: { name: person.name, email: person.email, phone: person.phone }, adminRole: input.role,
          });
          organization = created.organization;
          member = created.admin;
          targetOrgId = organization.id;
          await seedSubscriberProfile(q, actorOf(req), {
            orgId: targetOrgId, userId: member.id, userEmail: person.email,
            industry: enquiry.industry, keywords: enquiry.keywords, state: enquiry.state, city: enquiry.city,
          });
        }

        await q.query(
          `UPDATE enquiries SET organization_id = $1, status = 'Converted', converted_at = now() WHERE id = $2`,
          [targetOrgId, enquiryId]
        );
        await audit(q, actorOf(req), 'enquiry.convert', 'enquiry', enquiryId, {
          organizationId: targetOrgId, role: input.role, target: isStaff ? 'staff_org' : input.target,
        });
        return { organization, member };
      });
      res.status(201).json(out);
    })
  );

  // ---- Website enquiries inbox ---------------------------------------------
  r.get(
    '/enquiries',
    requirePermission('enquiries:view'),
    asyncHandler(async (req, res) => {
      const { status, kind, limit } = parse(
        z.object({
          status: z.enum(['New', 'Contacted', 'Qualified', 'Converted', 'Closed']).optional(),
          kind: z.enum(['general', 'access_request']).optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
        req.query
      );
      const rows = await withSystemDb(req, async (q) => {
        const enquiries = await q.many(
          `SELECT e.id, e.name, e.company, e.phone, e.email, e.service, e.message, e.language, e.status, e.kind,
                  e.gstin, e.address, e.city, e.state, e.industry,
                  e.consent_timestamp, e.privacy_notice_version, e.created_at, e.converted_at,
                  e.organization_id, o.name AS organization_name
             FROM enquiries e LEFT JOIN organizations o ON o.id = e.organization_id
            WHERE ($1::text IS NULL OR e.status = $1) AND ($2::text IS NULL OR e.kind = $2)
            ORDER BY e.created_at DESC LIMIT $3`,
          [status ?? null, kind ?? null, limit]
        );
        const ids = enquiries.map((e) => e.id);
        const notes = ids.length
          ? await q.many(
              `SELECT f.enquiry_id, f.notes, f.created_at, u.name AS author
                 FROM enquiry_followups f LEFT JOIN users u ON u.id = f.assigned_to
                WHERE f.enquiry_id = ANY($1::int[]) ORDER BY f.created_at`,
              [ids]
            )
          : [];
        return enquiries.map((e) => ({ ...e, followups: notes.filter((n) => n.enquiry_id === e.id) }));
      });
      res.json({ enquiries: rows });
    })
  );

  // Open items per queue, for the badge beside each inbox in the staff navigation.
  r.get(
    '/enquiries/summary',
    requirePermission('enquiries:view'),
    asyncHandler(async (req, res) => {
      const row = await withSystemDb(req, (q) =>
        q.one(
          `SELECT count(*) FILTER (WHERE kind = 'access_request' AND status = 'New')::int AS new_access_requests,
                  count(*) FILTER (WHERE kind = 'general' AND status = 'New')::int AS new_general
             FROM enquiries`
        )
      );
      res.json({ newAccessRequests: row.new_access_requests, newGeneral: row.new_general });
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
        const found = await q.maybeOne('SELECT id, status FROM enquiries WHERE id = $1', [enquiryId]);
        if (!found) throw notFound('Enquiry not found');
        if (input.status && found.status === 'Converted') throw conflict('This request already has an organization, so its status is fixed');
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
