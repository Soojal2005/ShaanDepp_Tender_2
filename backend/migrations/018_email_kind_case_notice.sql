-- 018 - Restore 'case_notice' to the email_queue kind check
--
-- Migration 007 added 'case_notice' (submission-desk notifications to managers and
-- clients). Migration 015 then redefined this same constraint from an older copy of
-- the list and accidentally dropped 'case_notice' while adding 'otp'/'result_alert'.
-- Result in any DB where 015 ran: every "request submission help" (createCase) and
-- every desk reminder failed when enqueuing its notification email, with CHECK
-- violation 23514 -> "A value is outside the allowed range".
--
-- Restore the complete set. Additive and idempotent (DROP IF EXISTS first).
ALTER TABLE email_queue DROP CONSTRAINT IF EXISTS email_queue_kind_check;
ALTER TABLE email_queue ADD CONSTRAINT email_queue_kind_check
  CHECK (kind IN ('digest', 'test', 'reminder', 'bundle_notice', 'password_reset', 'invite', 'ops_alert', 'case_notice', 'otp', 'result_alert'));
