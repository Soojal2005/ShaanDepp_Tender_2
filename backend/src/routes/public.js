/**
 * Endpoints that need no sign-in: the company website's enquiry form and the
 * contact details it displays. Enquiries are rate limited per IP, validated,
 * and readable only by staff (see the admin inbox).
 */
import { Router } from 'express';
import { config } from '../config.js';
import { clientIp, withSystemDb } from '../auth/middleware.js';
import { asyncHandler, badRequest } from '../errors.js';
import { audit } from '../services/audit.js';
import { button, emailShell, esc } from '../services/mail/html.js';
import { enqueueEmail } from '../services/mail/queue.js';
import { issueOtp, verifyOtp, queueOtpEmail } from '../services/emailOtp.js';
import { email, parse, z } from '../validate.js';

// A 15-character GSTIN, e.g. 22AAAAA0000A1Z5.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const enquirySchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    company: z.string().trim().min(2).max(200),
    email,
    phone: z.string().trim().max(50).optional(),
    service: z.string().trim().max(200).optional(),
    // 'access_request' comes from the website's Request access page and lands in the admin Access requests queue.
    kind: z.enum(['general', 'access_request']).default('general'),
    message: z.string().trim().max(4000).optional(),
    language: z.enum(['EN', 'HI']).default('EN'),
    // Company identity, collected when registering "as a company" (access_request).
    gstin: z.string().trim().toUpperCase().regex(GSTIN_RE, 'is not a valid GSTIN').optional(),
    address: z.string().trim().max(300).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    industry: z.string().trim().max(120).optional(),
    consent: z.literal(true, { error: 'must be accepted' }),
    // The 6-digit email verification code (required for an access request).
    otp: z.string().trim().regex(/^\d{6}$/, 'must be the 6-digit code emailed to you').optional(),
    // Honeypot: real visitors never see or fill this field.
    website: z.string().max(200).optional(),
  })
  // A registration must identify the company and the person, and the email must be
  // verified, so these are required for an access request (GSTIN and a full street
  // address stay optional).
  .superRefine((v, ctx) => {
    if (v.kind !== 'access_request') return;
    for (const field of ['phone', 'city', 'state', 'industry']) {
      if (!v[field] || !String(v[field]).trim()) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'is required to register as a company' });
      }
    }
    if (!v.otp) ctx.addIssue({ code: 'custom', path: ['otp'], message: 'is required — verify your email first' });
  });

const otpRequestSchema = z.object({ email, name: z.string().trim().max(150).optional() });

/** Tell the team a new access request is waiting. Queued in the same transaction, so a failed save sends nothing. */
async function notifyStaff(q, enquiryId, input) {
  const to = config.mail.opsAlertEmail || config.site.email;
  if (!to) return;
  const html = emailShell({
    title: 'New portal access request',
    preheader: `${input.company} asked for access to the tender portal.`,
    bodyHtml: `
      <p style="font-size:14px;margin:0 0 12px;"><b>${esc(input.company)}</b> asked for access to the tender portal.</p>
      <p style="font-size:14px;margin:0 0 4px;">Contact: ${esc(input.name)}, ${esc(input.email)}${input.phone ? `, ${esc(input.phone)}` : ''}</p>
      ${input.message ? `<p style="font-size:14px;margin:12px 0 0;white-space:pre-wrap;">${esc(input.message)}</p>` : ''}
      <p style="margin:18px 0 0;">${button('Open access requests', `${config.publicBaseUrl}/app/admin/access-requests`)}</p>`,
  });
  await enqueueEmail(q, {
    kind: 'ops_alert', to, subject: `[procure-brain] Access request from ${input.company}`, html,
    idempotencyKey: `access-request:${enquiryId}`,
  });
}

export function publicRoutes({ limiters }) {
  const r = Router();

  r.get('/site-config', (req, res) => {
    res.json({
      phone: config.site.phone,
      email: config.site.email,
      whatsappNumber: config.site.whatsappNumber,
      registration: { business: 'BHOP260407SE000586', gst: '23APSPT2592R1ZR' },
    });
  });

  // Step 1 of registering as a company: email a 6-digit code to prove the address.
  // Always 202 so it cannot be used to probe addresses; cooldown is enforced server-side.
  r.post(
    '/register/request-otp',
    limiters.otpRequest,
    asyncHandler(async (req, res) => {
      const input = parse(otpRequestSchema, req.body);
      const result = await withSystemDb(req, async (q) => {
        const issued = await issueOtp(q, { purpose: 'register', email: input.email, ip: clientIp(req) });
        if (issued.code) {
          await queueOtpEmail(q, { purpose: 'register', email: input.email, code: issued.code, otpId: issued.otpId, name: input.name });
          return { sent: true };
        }
        return { cooldownSeconds: issued.cooldownSeconds };
      });
      res.status(202).json({
        message: 'If that address is valid, a verification code is on its way.',
        ...(result.cooldownSeconds ? { cooldownSeconds: result.cooldownSeconds } : {}),
      });
    })
  );

  // Step 2: check the code the user typed and confirm the email, without using it
  // up — the final /enquiries submit verifies and consumes it authoritatively.
  r.post(
    '/register/verify-otp',
    limiters.otpRequest,
    asyncHandler(async (req, res) => {
      const input = parse(z.object({ email, otp: z.string().trim().regex(/^\d{6}$/, 'must be a 6-digit code') }), req.body);
      const ok = await withSystemDb(req, (q) => verifyOtp(q, { purpose: 'register', email: input.email, code: input.otp, consume: false }));
      if (!ok) throw badRequest('That verification code is invalid or has expired. Request a new one.');
      res.json({ verified: true });
    })
  );

  r.post(
    '/enquiries',
    limiters.enquiry,
    asyncHandler(async (req, res) => {
      const input = parse(enquirySchema, req.body);
      // Bots that fill the honeypot get the same success response and nothing is stored.
      if (input.website) return res.status(201).json({ message: 'Thank you. Our team will contact you shortly.' });

      const ip = clientIp(req);
      const outcome = await withSystemDb(req, async (q) => {
        // Registering as a company requires a verified email (consumes the OTP).
        if (input.kind === 'access_request') {
          const ok = await verifyOtp(q, { purpose: 'register', email: input.email, code: input.otp });
          if (!ok) return { error: 'otp' };
        }
        const row = await q.one(
          `INSERT INTO enquiries (name, company, phone, email, service, message, language, ip_address, kind, gstin, address, city, state, industry)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
          [input.name, input.company, input.phone ?? null, input.email, input.service ?? null,
           input.message ?? null, input.language, ip, input.kind,
           input.gstin ?? null, input.address ?? null, input.city ?? null, input.state ?? null, input.industry ?? null]
        );
        await audit(q, { user: null, ip }, 'enquiry.create', 'enquiry', row.id, { service: input.service ?? null, kind: input.kind });
        if (input.kind === 'access_request') await notifyStaff(q, row.id, input);
        return { ok: true };
      });
      if (outcome.error === 'otp') throw badRequest('That verification code is invalid or has expired. Request a new one.');
      res.status(201).json({ message: 'Thank you. Our team will contact you shortly.' });
    })
  );

  return r;
}
