/** Single-use tokens for password reset and invitation acceptance. */
import { hashToken, newToken } from '../auth/sessions.js';

/** Creates a token (invalidating earlier unused ones) and returns the raw value to email. */
export async function createResetToken(q, userId, ttlHours) {
  await q.query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  const token = newToken();
  await q.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [userId, hashToken(token), ttlHours]
  );
  return token;
}

/** Atomically marks a valid token used and returns its user id, or null. */
export async function consumeResetToken(q, token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const row = await q.maybeOne(
    `UPDATE password_reset_tokens
        SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [hashToken(token)]
  );
  return row?.user_id ?? null;
}
