-- ============================================================================
-- 007 - Submission desk additions
--   * what the client asked for when raising the request
--   * one OPEN case per client and tender (a closed case may be raised again)
--   * reminder bookkeeping so a case deadline is mentioned once
-- ============================================================================
ALTER TABLE submission_cases ADD COLUMN request_note text;
ALTER TABLE submission_cases ADD COLUMN sla_note text;

CREATE UNIQUE INDEX uq_open_case_per_tender
  ON submission_cases (organization_id, tender_id)
  WHERE tender_id IS NOT NULL AND stage <> 'closed';

CREATE INDEX idx_cases_assigned ON submission_cases (assigned_to) WHERE stage <> 'closed';
CREATE INDEX idx_checklists_case ON submission_case_checklists (case_id);
CREATE INDEX idx_stages_case ON submission_case_stages (case_id);
CREATE INDEX idx_prebid_case ON case_prebid_queries (case_id);
CREATE INDEX idx_followups_case ON case_followups (case_id);
CREATE INDEX idx_emd_case ON case_emd_tracking (case_id);

ALTER TABLE email_queue DROP CONSTRAINT email_queue_kind_check;
ALTER TABLE email_queue ADD CONSTRAINT email_queue_kind_check
  CHECK (kind IN ('digest', 'test', 'reminder', 'bundle_notice', 'password_reset', 'invite', 'ops_alert', 'case_notice'));

CREATE TABLE case_reminders (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id int NOT NULL REFERENCES submission_cases(id) ON DELETE CASCADE,
  kind    text NOT NULL,
  ref     text NOT NULL DEFAULT '',
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, kind, ref)
);
ALTER TABLE case_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY priv_only ON case_reminders FOR ALL USING (is_privileged()) WITH CHECK (is_privileged());
-- app_api_user receives its table and sequence privileges from the default privileges set in 002.
