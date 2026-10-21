/** Transactional account emails: password reset and invitations. */
import { config } from '../config.js';
import { button, emailShell, esc } from './mail/html.js';
import { enqueueEmail } from './mail/queue.js';
import { createResetToken } from './accountTokens.js';

const linkFor = (token) => `${config.publicBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;

export async function queuePasswordReset(q, user) {
  const token = await createResetToken(q, user.id, 1);
  const html = emailShell({
    title: 'Reset your password',
    preheader: 'Use this link within one hour to choose a new password.',
    bodyHtml: `
      <p style="font-size:15px;margin:0 0 12px;">Hello ${esc(user.name)},</p>
      <p style="font-size:14px;margin:0 0 18px;">We received a request to reset the password for your procure-brain.com account. This link is valid for one hour and can be used once.</p>
      <p style="margin:0 0 18px;">${button('Choose a new password', linkFor(token))}</p>
      <p style="font-size:12px;color:#64748B;margin:0;">If you did not ask for this, you can ignore this email; your password will not change.</p>`,
  });
  await enqueueEmail(q, {
    orgId: user.orgId ?? user.organization_id ?? null,
    kind: 'password_reset',
    to: user.email,
    subject: 'Reset your procure-brain.com password',
    html,
    idempotencyKey: `reset:${user.id}:${token.slice(0, 12)}`,
  });
}

export async function queueInvite(q, { user, invitedBy, orgName }) {
  const token = await createResetToken(q, user.id, 72);
  const html = emailShell({
    title: 'You have been invited',
    preheader: `${invitedBy} invited you to ${orgName}.`,
    bodyHtml: `
      <p style="font-size:15px;margin:0 0 12px;">Hello ${esc(user.name)},</p>
      <p style="font-size:14px;margin:0 0 18px;">${esc(invitedBy)} has set up an account for you on the Shan-Deep Tender Intelligence portal for <b>${esc(orgName)}</b>. Choose your password to get started. The link is valid for 72 hours.</p>
      <p style="margin:0 0 18px;">${button('Set your password', linkFor(token))}</p>`,
  });
  await enqueueEmail(q, {
    orgId: user.orgId ?? user.organization_id ?? null,
    kind: 'invite',
    to: user.email,
    subject: 'Your procure-brain.com account',
    html,
    idempotencyKey: `invite:${user.id}:${token.slice(0, 12)}`,
  });
}
