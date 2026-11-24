/**
 * Email one-time passwords (OTP): issue, verify, and the OTP email itself.
 *
 * A code is a 6-digit number. Only its SHA-256 hash (bound to purpose + email)
 * is stored, with an expiry and an attempt counter, so a code cannot be read
 * from the table, brute-forced, or replayed. Issuing a new code supersedes any
 * earlier unconsumed one for the same (purpose, email), and a resend cooldown
 * stops an attacker (or an impatient user) from flooding an inbox.
 *
 * Used by the registration form (purpose 'register') and forgot-password
 * (purpose 'password_reset'). All of it runs in system/staff DB scope.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { emailShell, esc } from './mail/html.js';
import { enqueueEmail } from './mail/queue.js';

const PURPOSE_COPY = {
  register: {
    subject: 'Your procure-brain.in verification code',
    intro: 'Use this code to verify your email and complete your registration with Shan-Deep.',
  },
  password_reset: {
    subject: 'Your procure-brain.in password reset code',
    intro: 'Use this code to reset the password for your procure-brain.in account.',
  },
};

const normalize = (email) => String(email ?? '').trim().toLowerCase();

const hashCode = (purpose, email, code) =>
  crypto.createHash('sha256').update(`${purpose}:${normalize(email)}:${code}`).digest('hex');

const genCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * Issue an OTP for (purpose, email). Supersedes earlier unconsumed codes.
 * Honours a resend cooldown: if a live code was issued within the window, no new
 * code is sent and { cooldownSeconds } is returned so the caller can tell the user.
 * @returns {Promise<{otpId:number, code:string, expiresAt:Date} | {cooldownSeconds:number}>}
 */
export async function issueOtp(q, { purpose, email, ip = null } = {}) {
  const addr = normalize(email);
  const cooldown = config.otp.resendCooldownSeconds;

  const recent = await q.maybeOne(
    `SELECT created_at FROM email_otps
      WHERE purpose = $1 AND email = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [purpose, addr]
  );
  if (recent) {
    const secondsSince = (Date.now() - new Date(recent.created_at).getTime()) / 1000;
    if (secondsSince < cooldown) return { cooldownSeconds: Math.ceil(cooldown - secondsSince) };
  }

  await q.query(
    `UPDATE email_otps SET consumed_at = now() WHERE purpose = $1 AND email = $2 AND consumed_at IS NULL`,
    [purpose, addr]
  );
  const code = genCode();
  const row = await q.one(
    `INSERT INTO email_otps (purpose, email, code_hash, expires_at, max_attempts, ip_address)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4), $5, $6)
     RETURNING id, expires_at`,
    [purpose, addr, hashCode(purpose, addr, code), config.otp.ttlMinutes, config.otp.maxAttempts, ip]
  );
  return { otpId: row.id, code, expiresAt: row.expires_at };
}

/**
 * Verify a code for (purpose, email). On a wrong code the attempt is counted and
 * the code is burned once max_attempts is reached. On success the code is marked
 * used when `consume` is true (the default) — the authoritative check at the
 * point of action. Pass `consume: false` for an intermediate "is this code
 * right?" check (e.g. a Verify-email button) that must still work at final submit.
 * @returns {Promise<boolean>}
 */
export async function verifyOtp(q, { purpose, email, code, consume = true } = {}) {
  const addr = normalize(email);
  if (!/^\d{6}$/.test(String(code ?? ''))) return false;

  const row = await q.maybeOne(
    `SELECT id, code_hash, attempts, max_attempts FROM email_otps
      WHERE purpose = $1 AND email = $2 AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [purpose, addr]
  );
  if (!row) return false;
  if (row.attempts >= row.max_attempts) {
    await q.query(`UPDATE email_otps SET consumed_at = now() WHERE id = $1`, [row.id]);
    return false;
  }

  const matches = crypto.timingSafeEqual(
    Buffer.from(row.code_hash, 'hex'),
    Buffer.from(hashCode(purpose, addr, code), 'hex')
  );
  if (!matches) {
    await q.query(
      `UPDATE email_otps
          SET attempts = attempts + 1,
              consumed_at = CASE WHEN attempts + 1 >= max_attempts THEN now() ELSE consumed_at END
        WHERE id = $1`,
      [row.id]
    );
    return false;
  }

  if (consume) await q.query(`UPDATE email_otps SET consumed_at = now() WHERE id = $1`, [row.id]);
  return true;
}

/** Build and enqueue the OTP email in the same transaction that issued the code. */
export async function queueOtpEmail(q, { purpose, email, code, otpId, name = null, orgId = null }) {
  const copy = PURPOSE_COPY[purpose] ?? PURPOSE_COPY.register;
  const html = emailShell({
    title: copy.subject,
    preheader: `Your code is ${code} — it expires in ${config.otp.ttlMinutes} minutes.`,
    bodyHtml: `
      ${name ? `<p style="font-size:15px;margin:0 0 12px;">Hello ${esc(name)},</p>` : ''}
      <p style="font-size:14px;margin:0 0 18px;">${esc(copy.intro)}</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:10px;color:#0B2545;background:#F1F5F9;border:1px solid #E2E8F0;border-radius:8px;padding:18px 0;text-align:center;margin:0 0 18px;">${esc(code)}</div>
      <p style="font-size:13px;color:#64748B;margin:0 0 6px;">This code expires in ${config.otp.ttlMinutes} minutes and can be used once.</p>
      <p style="font-size:12px;color:#94A3B8;margin:0;">If you did not request this, you can safely ignore this email — nothing will change.</p>`,
  });
  await enqueueEmail(q, {
    orgId,
    kind: 'otp',
    to: email,
    subject: copy.subject,
    html,
    idempotencyKey: `otp:${purpose}:${otpId}`,
  });
}
