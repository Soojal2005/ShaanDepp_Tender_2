/**
 * SMTP transport (Hostinger) — a drop-in alternative to the Microsoft Graph
 * client. It exposes the same `sendMail({ to, subject, html })` the queue drainer
 * calls, and translates nodemailer/SMTP failures into the same error `kind`s the
 * drainer understands (throttled | transient | systemic | permanent), so retry,
 * pause and give-up behaviour is identical regardless of transport.
 *
 * Credentials come only from config (env): host, port, user, pass, from. The
 * password never leaves this process and is never logged.
 */
import nodemailer from 'nodemailer';
import { config } from '../../config.js';
import { GraphError } from './graph.js'; // shared error shape: { kind, status, retryAfterSeconds }

/** Map a nodemailer/SMTP error onto a delivery `kind`. */
function classify(err) {
  const code = Number.isInteger(err?.responseCode) ? err.responseCode : null; // SMTP reply code
  const ec = err?.code; // node/nodemailer error code
  const msg = err?.message || 'SMTP send failed';

  // Authentication or sender-not-allowed: affects every message -> pause sending.
  if (ec === 'EAUTH' || code === 535 || code === 534 || code === 530 || code === 538) {
    return new GraphError(
      'SMTP authentication failed. Check SMTP_USER / SMTP_PASS and that SMTP_FROM is a mailbox on the authenticated domain.',
      { kind: 'systemic', status: code },
    );
  }
  // Connection, DNS, TLS, timeout, greylisting, or any 4xx reply: retry later.
  const transientCodes = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'EDNS', 'EHOSTUNREACH']);
  if (transientCodes.has(ec) || code === 421 || (code != null && code >= 400 && code < 500)) {
    return new GraphError(`SMTP is temporarily unavailable${code ? ` (${code})` : ''}`, { kind: 'transient', status: code });
  }
  // Rejected recipient/message, or any other 5xx: this message cannot be delivered.
  if (ec === 'EENVELOPE' || ec === 'EMESSAGE' || (code != null && code >= 500)) {
    return new GraphError(`SMTP rejected the message${code ? ` (${code})` : ''}: ${msg}`, { kind: 'permanent', status: code });
  }
  // Unknown: prefer a bounded retry over silently dropping the message.
  return new GraphError(msg, { kind: 'transient', status: code });
}

export function createSmtpClient({
  host = config.mail.smtp.host,
  port = config.mail.smtp.port,
  secure = config.mail.smtp.secure,
  user = config.mail.smtp.user,
  pass = config.mail.smtp.pass,
  from = config.mail.smtp.from,
  // Injectable so tests never open a socket.
  transport = null,
  timeoutMs = 30_000,
} = {}) {
  if (!host || !user || !pass || !from) throw new Error('SMTP is not fully configured (host, user, pass, from)');

  // Pooled so the drainer can send a batch over a few reused connections.
  const transporter = transport ?? nodemailer.createTransport({
    host,
    port,
    secure, // true: implicit TLS (465); false: STARTTLS (587)
    auth: { user, pass },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });

  return {
    from,

    async sendMail({ to, subject, html }) {
      try {
        await transporter.sendMail({ from, to, subject, html, replyTo: from });
        return { status: 202 };
      } catch (err) {
        throw classify(err);
      }
    },

    /** Open a connection and check the credentials (for health checks / admin). */
    async verify() {
      try {
        await transporter.verify();
        return true;
      } catch (err) {
        throw classify(err);
      }
    },

    close() {
      try { transporter.close(); } catch { /* already closed */ }
    },
  };
}

export { classify as classifySmtpError };
