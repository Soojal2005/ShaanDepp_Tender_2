-- ============================================================================
-- 015 - Email one-time passwords (OTP)
-- ============================================================================
--
-- Short-lived numeric codes emailed to prove control of an address, used for:
--   * 'register'       - verifying the email on the company registration form
--   * 'password_reset' - resetting a forgotten password without a magic link
--
-- Only the SHA-256 hash of the code is stored (never the code itself), with an
-- expiry and an attempt counter so a code cannot be brute-forced or replayed.
-- One row per issuance; issuing a new code for the same (purpose, email)
-- invalidates earlier unconsumed ones. Pre-login flows run in system scope, so
-- the table is privileged-only, like password_reset_tokens and email_queue.

CREATE TABLE email_otps (
  id           bigserial PRIMARY KEY,
  purpose      text NOT NULL CHECK (purpose IN ('register', 'password_reset')),
  email        text NOT NULL,
  code_hash    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  consumed_at  timestamptz,
  ip_address   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Active-code lookup (latest unconsumed per purpose+email) and expiry sweeps.
CREATE INDEX idx_email_otps_lookup ON email_otps (purpose, email, consumed_at, created_at DESC);
CREATE INDEX idx_email_otps_expiry ON email_otps (expires_at);

-- Privileged (system / staff) context only — no client account may read codes.
ALTER TABLE email_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_otps FORCE ROW LEVEL SECURITY;
CREATE POLICY priv_only ON email_otps FOR ALL USING (is_privileged()) WITH CHECK (is_privileged());

-- Allow the new queue kinds: 'otp' (verification/reset codes) and
-- 'result_alert' (tender result/award notifications).
ALTER TABLE email_queue DROP CONSTRAINT IF EXISTS email_queue_kind_check;
ALTER TABLE email_queue ADD CONSTRAINT email_queue_kind_check
  CHECK (kind IN ('digest', 'test', 'reminder', 'bundle_notice', 'password_reset', 'invite', 'ops_alert', 'otp', 'result_alert'));
