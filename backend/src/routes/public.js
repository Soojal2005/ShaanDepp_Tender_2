/**
 * Endpoints that need no sign-in: the company website's enquiry form and the
 * contact details it displays. Enquiries are rate limited per IP, validated,
 * and readable only by staff (see the admin inbox).
 */
import { Router } from 'express';
import { config } from '../config.js';
import { clientIp, withSystemDb } from '../auth/middleware.js';
import { asyncHandler } from '../errors.js';
import { audit } from '../services/audit.js';
import { button, emailShell, esc } from '../services/mail/html.js';
import { enqueueEmail } from '../services/mail/queue.js';
import { email, parse, z } from '../validate.js';

const enquirySchema = z.object({
  name: z.string().trim().min(2).max(150),
  company: z.string().trim().min(2).max(200),
  email,
  phone: z.string().trim().max(50).optional(),
  service: z.string().trim().max(200).optional(),
  // 'access_request' comes from the website's Request access page and lands in the admin Access requests queue.
  kind: z.enum(['general', 'access_request']).default('general'),
  message: z.string().trim().max(4000).optional(),
  language: z.enum(['EN', 'HI']).default('EN'),
  consent: z.literal(true, { error: 'must be accepted' }),
  // Honeypot: real visitors never see or fill this field.
  website: z.string().max(200).optional(),
});

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

  r.post(
    '/enquiries',
    limiters.enquiry,
    asyncHandler(async (req, res) => {
      const input = parse(enquirySchema, req.body);
      // Bots that fill the honeypot get the same success response and nothing is stored.
      if (input.website) return res.status(201).json({ message: 'Thank you. Our team will contact you shortly.' });

      const ip = clientIp(req);
      await withSystemDb(req, async (q) => {
        const row = await q.one(
          `INSERT INTO enquiries (name, company, phone, email, service, message, language, ip_address, kind)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [input.name, input.company, input.phone ?? null, input.email, input.service ?? null,
           input.message ?? null, input.language, ip, input.kind]
        );
        await audit(q, { user: null, ip }, 'enquiry.create', 'enquiry', row.id, { service: input.service ?? null, kind: input.kind });
        if (input.kind === 'access_request') await notifyStaff(q, row.id, input);
      });
      res.status(201).json({ message: 'Thank you. Our team will contact you shortly.' });
    })
  );

  return r;
}
