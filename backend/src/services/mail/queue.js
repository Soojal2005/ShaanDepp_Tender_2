/**
 * Outgoing mail queue. Producers only ever INSERT here (inside their own
 * transaction); the sender in services/mail/sender.js drains it. Because the
 * row is written in the same transaction as the business change, a rolled-back
 * action never produces an email.
 */

/**
 * @param q open transaction (system or staff scope; the table is staff-only)
 * @returns {Promise<number|null>} queue id, or null if idempotencyKey already existed
 */
export async function enqueueEmail(
  q,
  { orgId = null, kind, to, subject, html, profileName = null, tendersCount = 0, digestId = null, idempotencyKey, sendAfter = null }
) {
  if (!idempotencyKey) throw new Error('enqueueEmail requires an idempotencyKey');
  const row = await q.maybeOne(
    `INSERT INTO email_queue
       (organization_id, kind, recipient, subject, html_body, profile_name, tenders_count, digest_id, idempotency_key, next_attempt_at)
     VALUES ($1, $2, lower($3), $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()))
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [orgId, kind, to, subject, html, profileName, tendersCount, digestId, idempotencyKey, sendAfter]
  );
  return row?.id ?? null;
}
