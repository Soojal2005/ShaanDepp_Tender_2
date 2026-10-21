/**
 * Microsoft Graph client for the client's own Microsoft 365 mailbox.
 *
 * Mail leaves from the mailbox itself (POST /users/{mailbox}/sendMail with
 * saveToSentItems), so every alert lands in Outlook's Sent Items and replies
 * come back to the same mailbox. Authentication is the app-only client
 * credentials flow; the secret never leaves this process.
 */
import { config } from '../../config.js';

/**
 * kind:
 *   'throttled'  - 429; wait `retryAfterSeconds` and try again (does not count as a failed attempt)
 *   'transient'  - network error or 5xx; retry with back-off
 *   'systemic'   - credentials or permission problem; affects every message, so sending pauses
 *   'permanent'  - this message can never be delivered (bad address, rejected content)
 */
export class GraphError extends Error {
  constructor(message, { kind, status = null, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = 'GraphError';
    this.kind = kind;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const parseRetryAfter = (value) => {
  if (value == null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(3600, Math.max(1, Math.ceil(seconds)));
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.min(3600, Math.max(1, Math.ceil((date - Date.now()) / 1000)));
};

export function createGraphClient({
  tenantId = config.mail.tenantId,
  clientId = config.mail.clientId,
  clientSecret = config.mail.clientSecret,
  mailbox = config.mail.senderMailbox,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
  clock = () => Date.now(),
} = {}) {
  if (!tenantId || !clientId || !clientSecret || !mailbox) throw new Error('Microsoft Graph is not fully configured');
  let token = null; // { value, expiresAt }

  async function call(url, init) {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new GraphError(err?.name === 'TimeoutError' ? 'Microsoft Graph timed out' : 'Microsoft Graph could not be reached', { kind: 'transient' });
    }
  }

  async function getToken(force = false) {
    if (!force && token && token.expiresAt - 60_000 > clock()) return token.value;
    const body = new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
    });
    const res = await call(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    if (res.status === 429 || res.status >= 500) {
      throw new GraphError(`Microsoft sign-in is unavailable (HTTP ${res.status})`, { kind: 'transient', status: res.status, retryAfterSeconds: parseRetryAfter(res.headers?.get?.('retry-after')) });
    }
    if (!res.ok) {
      // Never echo the response body: it can name the tenant/app but must not be logged with the secret nearby.
      throw new GraphError(`Microsoft rejected the app credentials (HTTP ${res.status}). Check the tenant, client id and secret.`, { kind: 'systemic', status: res.status });
    }
    const data = await res.json();
    token = { value: data.access_token, expiresAt: clock() + Number(data.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  /** Authorised request with one automatic retry after a fresh token on 401. */
  async function graph(path, init = {}, attempt = 0) {
    const res = await call(`https://graph.microsoft.com/v1.0${path}`, {
      ...init, headers: { Authorization: `Bearer ${await getToken(attempt > 0)}`, 'Content-Type': 'application/json', ...init.headers },
    });
    if (res.status === 401 && attempt === 0) { token = null; return graph(path, init, 1); }
    return res;
  }

  function classify(res) {
    const retryAfterSeconds = parseRetryAfter(res.headers?.get?.('retry-after'));
    if (res.status === 429) return new GraphError('Microsoft Graph is throttling requests (HTTP 429)', { kind: 'throttled', status: 429, retryAfterSeconds });
    if (res.status === 401 || res.status === 403) {
      return new GraphError(`Microsoft Graph denied access (HTTP ${res.status}). The app registration needs Mail.Send permission with admin consent for the sending mailbox.`, { kind: 'systemic', status: res.status });
    }
    if (res.status >= 500 || res.status === 408) return new GraphError(`Microsoft Graph is unavailable (HTTP ${res.status})`, { kind: 'transient', status: res.status, retryAfterSeconds });
    return new GraphError(`Microsoft Graph refused the message (HTTP ${res.status})`, { kind: 'permanent', status: res.status });
  }

  return {
    mailbox,

    async sendMail({ to, subject, html }) {
      const res = await graph(`/users/${encodeURIComponent(mailbox)}/sendMail`, {
        method: 'POST',
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: 'HTML', content: html },
            toRecipients: [{ emailAddress: { address: to } }],
            replyTo: [{ emailAddress: { address: mailbox } }],
          },
          saveToSentItems: true,
        }),
      });
      if (res.status === 202) return { status: 202 };
      throw classify(res);
    },

    /** Unread messages in the sending mailbox's inbox (delivery-failure notices arrive here). */
    async unreadInbox(top = 50) {
      const query = `?$top=${top}&$filter=${encodeURIComponent('isRead eq false')}&$select=id,subject,from,bodyPreview,body,receivedDateTime`;
      const res = await graph(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages${query}`, { method: 'GET' });
      if (!res.ok) throw classify(res);
      return (await res.json()).value ?? [];
    },

    async markRead(messageId) {
      const res = await graph(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}`, {
        method: 'PATCH', body: JSON.stringify({ isRead: true }),
      });
      if (!res.ok) throw classify(res);
    },
  };
}
