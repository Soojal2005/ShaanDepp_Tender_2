-- ============================================================================
-- 005 - Alert profiles keyed by master ids, and background job history
-- ============================================================================

-- Profiles refer to master entries by id (renaming a department must not break
-- an alert). The earlier name-array columns were never populated.
ALTER TABLE alert_profiles
  ADD COLUMN category_ids          int[] NOT NULL DEFAULT '{}',
  ADD COLUMN department_ids        int[] NOT NULL DEFAULT '{}',
  ADD COLUMN state_ids             int[] NOT NULL DEFAULT '{}',
  ADD COLUMN include_unknown_value boolean NOT NULL DEFAULT true,
  DROP COLUMN categories,
  DROP COLUMN states,
  DROP COLUMN departments;

CREATE INDEX idx_digests_profile_date ON alert_digests (profile_id, digest_date DESC);

-- One row per scheduled-job run, so the admin console can show what ran and how it went.
CREATE TABLE job_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job         text NOT NULL,
  trigger     text NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule', 'manual')),
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  detail      jsonb,
  error       text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX idx_job_runs_job_time ON job_runs (job, started_at DESC);

ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY priv_only ON job_runs FOR ALL USING (is_privileged()) WITH CHECK (is_privileged());
