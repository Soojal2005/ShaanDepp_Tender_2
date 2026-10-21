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
import { email, parse, z } from '../validate.js';

const enquirySchema = z.object({
  name: z.string().trim().min(2).max(150),
  company: z.string().trim().min(2).max(200),
  email,
  phone: z.string().trim().max(50).optional(),
  service: z.string().trim().max(200).optional(),
  message: z.string().trim().max(4000).optional(),
  language: z.enum(['EN', 'HI']).default('EN'),
  consent: z.literal(true, { error: 'must be accepted' }),
  // Honeypot: real visitors never see or fill this field.
  website: z.string().max(200).optional(),
});

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
          `INSERT INTO enquiries (name, company, phone, email, service, message, language, ip_address)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [input.name, input.company, input.phone ?? null, input.email, input.service ?? null,
           input.message ?? null, input.language, ip]
        );
        await audit(q, { user: null, ip }, 'enquiry.create', 'enquiry', row.id, { service: input.service ?? null });
      });
      res.status(201).json({ message: 'Thank you. Our team will contact you shortly.' });
    })
  );

  return r;
}
