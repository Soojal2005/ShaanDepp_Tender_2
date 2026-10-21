/**
 * Reads delivery-failure notices from the sending mailbox so bounced addresses
 * are recorded and not mailed again. Optional (needs Mail.ReadWrite on the
 * sending mailbox); enable with GRAPH_BOUNCE_POLL=on. Only notices are touched:
 * a human reply sitting in the same inbox stays unread for the team.
 */
const STRIP_TAGS = /<[^>]+>/g;
const SYSTEM_SENDERS = /(postmaster|mailer-daemon|microsoftexchange)/i;
const NOTICE_SUBJECT = /(undeliverable|delivery has failed|delivery status notification|returned mail|mail delivery failed|couldn.t be delivered)/i;
const HARD = /\b5\.\d{1,3}\.\d{1,3}\b|\b55\d\b|user unknown|does not exist|doesn.t exist|recipient not found|no such user|address rejected|couldn.t be found/i;
const SOFT = /\b4\.\d{1,3}\.\d{1,3}\b|mailbox (is )?full|over quota|temporar|try again/i;
const ADDRESS = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** @returns {{recipient: string, type: 'hard'|'soft', diagnostic: string} | null} null when the message is not a failure notice */
export function parseBounce(message, ownMailbox) {
  const from = message.from?.emailAddress?.address ?? '';
  const subject = message.subject ?? '';
  if (!SYSTEM_SENDERS.test(from) && !NOTICE_SUBJECT.test(subject)) return null;

  const text = String(message.body?.content ?? message.bodyPreview ?? '').replace(STRIP_TAGS, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const own = String(ownMailbox).toLowerCase();
  const recipient = [...text.matchAll(ADDRESS)]
    .map((m) => m[0].toLowerCase())
    .find((a) => a !== own && !SYSTEM_SENDERS.test(a) && !/noreply|no-reply/.test(a));
  if (!recipient) return null;

  const type = HARD.test(text) ? 'hard' : SOFT.test(text) ? 'soft' : 'soft';
  return { recipient, type, diagnostic: text.slice(0, 500) };
}

export async function pollBounces(db, client) {
  const messages = await client.unreadInbox(50);
  const result = { checked: messages.length, bounces: 0 };
  for (const message of messages) {
    const bounce = parseBounce(message, client.mailbox);
    if (!bounce) continue;
    await db.withContext({ scope: 'system' }, (q) =>
      q.query('INSERT INTO email_bounce_records (recipient_email, bounce_type, raw_diagnostic) VALUES ($1, $2, $3)', [bounce.recipient, bounce.type, bounce.diagnostic]));
    await client.markRead(message.id);
    result.bounces++;
  }
  return result;
}
