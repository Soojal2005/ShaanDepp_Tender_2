-- ============================================================================
-- Shan-Deep Tender Intelligence Platform (procure-brain.com)
-- 001 - Core schema (PostgreSQL 15+, also runs on PGlite for dev/test)
--
-- Conventions
--   * Integer identity primary keys; display references (TND-000123, CASE-00045)
--     are derived in the API layer, never stored.
--   * Every tenant-owned table carries organization_id (or hangs off a parent
--     that does). Row-level security is applied in 002_rls.sql.
--   * Money is NUMERIC(18,2) in rupees. A missing value is NULL, never 0.
--   * audit_events and report_releases are append-only and deliberately have
--     no foreign keys, so nothing can cascade into them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Runtime role (least privilege). Login/password is set by the migration
-- runner from APP_DB_PASSWORD; no credential ever lives in SQL.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_api_user') THEN
    CREATE ROLE app_api_user NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- ============================================================================
-- System
-- ============================================================================
CREATE TABLE system_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- Plans, organizations, users
-- ============================================================================
CREATE TABLE plans (
  id                 int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code               text NOT NULL UNIQUE,
  name               text NOT NULL,
  daily_alert_cap    int  NOT NULL CHECK (daily_alert_cap BETWEEN 1 AND 500),
  max_seats          int  NOT NULL DEFAULT 3 CHECK (max_seats >= 1),
  max_alert_profiles int  NOT NULL DEFAULT 5 CHECK (max_alert_profiles >= 1),
  is_active          boolean NOT NULL DEFAULT true,
  sort_order         int  NOT NULL DEFAULT 0
);

INSERT INTO plans (code, name, daily_alert_cap, max_seats, max_alert_profiles, sort_order) VALUES
  ('basic',    'Basic',    50,  3, 2, 1),
  ('standard', 'Standard', 100, 3, 5, 2),
  ('premium',  'Premium',  150, 3, 10, 3);

CREATE TABLE organizations (
  id                 int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name               text NOT NULL,
  domain             text,
  gstin              text,
  contact_name       text,
  contact_phone      text,
  plan_id            int REFERENCES plans(id),
  alert_cap_override int CHECK (alert_cap_override IS NULL OR alert_cap_override BETWEEN 1 AND 500),
  seat_limit_override int CHECK (seat_limit_override IS NULL OR seat_limit_override >= 1),
  status             text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended', 'Pending')),
  is_staff_org       boolean NOT NULL DEFAULT false,
  language           text NOT NULL DEFAULT 'EN' CHECK (language IN ('EN', 'HI')),
  timezone           text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- Exactly one organization may represent Shan-Deep staff.
CREATE UNIQUE INDEX uq_one_staff_org ON organizations ((true)) WHERE is_staff_org;

CREATE TABLE users (
  id                     int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id        int NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  email                  text NOT NULL,
  phone                  text,
  role                   text NOT NULL DEFAULT 'subscriber'
                         CHECK (role IN ('subscriber', 'tenant_admin', 'analyst', 'case_manager', 'platform_admin')),
  is_active              boolean NOT NULL DEFAULT true,
  language               text NOT NULL DEFAULT 'EN' CHECK (language IN ('EN', 'HI')),
  consent_timestamp      timestamptz NOT NULL DEFAULT now(),
  privacy_notice_version text NOT NULL DEFAULT 'v2026.1',
  last_login_at          timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);
CREATE UNIQUE INDEX uq_users_email ON users (email);
CREATE INDEX idx_users_org ON users (organization_id);

-- Credentials are kept apart from the profile row so that no tenant-visible
-- query can ever return a password hash.
CREATE TABLE user_credentials (
  user_id             int PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash       text NOT NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  failed_login_count  int NOT NULL DEFAULT 0,
  locked_until        timestamptz
);

CREATE TABLE user_sessions (
  id              text PRIMARY KEY,                -- sha256 of the cookie token
  user_id         int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id int NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ip_address      text,
  user_agent      text,
  csrf_secret     text NOT NULL,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON user_sessions (user_id);
CREATE INDEX idx_sessions_expiry ON user_sessions (expires_at);

CREATE TABLE password_reset_tokens (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only. No foreign keys on purpose.
CREATE TABLE audit_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id int,
  user_id         int,
  actor_email     text,
  action          text NOT NULL,
  resource_type   text NOT NULL,
  resource_id     text,
  ip_address      text,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_org_time ON audit_events (organization_id, created_at DESC);

CREATE TABLE privacy_requests (
  id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id int NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type    text NOT NULL CHECK (request_type IN ('data_export', 'data_erasure', 'consent_withdrawal')),
  status          text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Processing', 'Completed', 'Rejected')),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

-- ============================================================================
-- Website enquiries (admin inbox)
-- ============================================================================
CREATE TABLE enquiries (
  id                     int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                   text NOT NULL,
  company                text NOT NULL,
  phone                  text,
  email                  text NOT NULL,
  service                text,
  message                text,
  language               text NOT NULL DEFAULT 'EN',
  ip_address             text,
  status                 text NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Contacted', 'Qualified', 'Closed')),
  consent_timestamp      timestamptz NOT NULL DEFAULT now(),
  privacy_notice_version text NOT NULL DEFAULT 'v2026.1',
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_enquiries_status ON enquiries (status, created_at DESC);

CREATE TABLE enquiry_followups (
  id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enquiry_id    int NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  assigned_to   int REFERENCES users(id) ON DELETE SET NULL,
  notes         text NOT NULL,
  followup_date date,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- Masters (client-controlled) and ingestion
-- ============================================================================
CREATE TABLE tender_categories (
  id        int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug      text NOT NULL UNIQUE,
  name      text NOT NULL,
  name_hi   text,
  aliases   text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE departments (
  id        int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug      text NOT NULL UNIQUE,
  name      text NOT NULL,
  name_hi   text,
  tier      text NOT NULL DEFAULT 'Central' CHECK (tier IN ('Central', 'State', 'PSU', 'Municipal')),
  aliases   text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE states (
  id      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name    text NOT NULL UNIQUE,
  name_hi text,
  code    text,
  aliases text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE cities (
  id       int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  state_id int NOT NULL REFERENCES states(id) ON DELETE CASCADE,
  name     text NOT NULL,
  UNIQUE (state_id, name)
);

-- Values seen during ingestion that match no master entry. Reviewed by admin
-- instead of being silently defaulted.
CREATE TABLE master_suggestions (
  id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('department', 'category', 'state', 'city')),
  raw_value    text NOT NULL,
  provider_id  text,
  seen_count   int NOT NULL DEFAULT 1,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'mapped', 'ignored')),
  mapped_to_id int,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, raw_value)
);

CREATE TABLE providers (
  id                     text PRIMARY KEY,
  name                   text NOT NULL,
  type                   text NOT NULL CHECK (type IN ('api', 'excel', 'central_portal', 'state_portal', 'gem', 'psu_direct')),
  base_url               text,
  status                 text NOT NULL DEFAULT 'Active',
  sync_frequency_minutes int NOT NULL DEFAULT 120,
  min_expected_records   int NOT NULL DEFAULT 1
);

INSERT INTO providers (id, name, type, base_url, sync_frequency_minutes) VALUES
  ('tenderbook', 'Tenderbook (Metalbook)', 'api', 'https://dev-api.tenderbook.in', 120),
  ('excel',      'Excel bulk upload',      'excel', NULL, 0);

CREATE TABLE ingestion_runs (
  id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id   text NOT NULL REFERENCES providers(id),
  kind          text NOT NULL CHECK (kind IN ('tenders', 'results')),
  trigger       text NOT NULL CHECK (trigger IN ('schedule', 'manual', 'backfill', 'excel')),
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'warning')),
  params        jsonb,
  fetched       int NOT NULL DEFAULT 0,
  inserted      int NOT NULL DEFAULT 0,
  updated       int NOT NULL DEFAULT 0,
  skipped       int NOT NULL DEFAULT 0,
  errors        int NOT NULL DEFAULT 0,
  error_message text,
  health        jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX idx_ingestion_runs_time ON ingestion_runs (provider_id, kind, started_at DESC);

CREATE TABLE raw_tender_payloads (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider   text NOT NULL,
  kind       text NOT NULL DEFAULT 'tender',
  source_id  text NOT NULL,
  raw_json   jsonb NOT NULL,
  checksum   text NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, kind, source_id)
);

-- ============================================================================
-- Tenders
-- ============================================================================
CREATE TABLE tenders (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id         text NOT NULL REFERENCES providers(id),
  source_id           text NOT NULL,
  source_url          text,
  title               text NOT NULL,
  description         text,
  department          text,
  department_id       int REFERENCES departments(id) ON DELETE SET NULL,
  category            text,
  category_id         int REFERENCES tender_categories(id) ON DELETE SET NULL,
  state               text,
  state_id            int REFERENCES states(id) ON DELETE SET NULL,
  city                text,
  city_id             int REFERENCES cities(id) ON DELETE SET NULL,
  org_type            text,
  tender_type         text,
  estimated_value     numeric(18,2) CHECK (estimated_value IS NULL OR estimated_value > 0),
  emd_amount          numeric(18,2) CHECK (emd_amount IS NULL OR emd_amount > 0),
  emd_status          text NOT NULL DEFAULT 'not_published'
                      CHECK (emd_status IN ('present', 'exempted', 'not_published')),
  tender_fee          numeric(18,2) CHECK (tender_fee IS NULL OR tender_fee >= 0),
  publish_date        timestamptz,
  prebid_date         timestamptz,
  submission_deadline timestamptz,
  opening_date        timestamptz,
  status              text NOT NULL DEFAULT 'Open'
                      CHECK (status IN ('Open', 'Closed', 'Under Evaluation', 'Awarded', 'Cancelled')),
  has_boq             boolean NOT NULL DEFAULT false,
  has_documents       boolean NOT NULL DEFAULT false,
  eligibility_summary text,
  payment_terms       text,
  delivery_terms      text,
  penalty_terms       text,
  boq_text            text,
  payload_checksum    text,
  title_tsv           tsvector,
  desc_tsv            tsvector,
  boq_tsv             tsvector,
  last_source_update  timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, source_id)
);
CREATE INDEX idx_tenders_title_tsv ON tenders USING GIN (title_tsv);
CREATE INDEX idx_tenders_desc_tsv  ON tenders USING GIN (desc_tsv);
CREATE INDEX idx_tenders_boq_tsv   ON tenders USING GIN (boq_tsv);
CREATE INDEX idx_tenders_deadline  ON tenders (submission_deadline);
CREATE INDEX idx_tenders_publish   ON tenders (publish_date DESC);
CREATE INDEX idx_tenders_dept      ON tenders (department_id);
CREATE INDEX idx_tenders_state     ON tenders (state_id);
CREATE INDEX idx_tenders_category  ON tenders (category_id);
CREATE INDEX idx_tenders_value     ON tenders (estimated_value);

CREATE TABLE tender_documents (
  id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tender_id   bigint NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  name        text NOT NULL,
  doc_type    text,
  size_label  text,
  url         text,
  external_id text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tender_docs_tender ON tender_documents (tender_id);

CREATE TABLE tender_boq_items (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tender_id      bigint NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  item_code      text,
  item_name      text NOT NULL,
  quantity       numeric(18,3),
  unit           text,
  estimated_rate numeric(18,2),
  total_amount   numeric(18,2)
);
CREATE INDEX idx_tender_boq_tender ON tender_boq_items (tender_id);

CREATE TABLE tender_corrigenda (
  id                 int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tender_id          bigint NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  corrigendum_number text NOT NULL,
  subject            text NOT NULL,
  issue_date         date NOT NULL,
  attachment_url     text
);

-- ============================================================================
-- Subscriber workspace: watchlist, saved searches
-- ============================================================================
CREATE TABLE watchlist_items (
  id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id int NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tender_id       bigint NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tender_id)
);
CREATE INDEX idx_watchlist_org ON watchlist_items (organization_id);

CREATE TABLE watchlist_reminders (
  id                int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  watchlist_item_id int NOT NULL REFERENCES watchlist_items(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('prebid', 'submission_72h', 'submission_24h')),
  sent_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watchlist_item_id, kind)
);

CREATE TABLE saved_searches (
  id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id int NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  query_params    jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_saved_searches_org ON saved_searches (organization_id);

CREATE TABLE search_query_logs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id int NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         int REFERENCES users(id) ON DELETE SET NULL,
  query_text      text,
  filters_applied jsonb,
  results_count   int,
  latency_ms      int,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- Alerts, digests and the Microsoft Graph send queue
-- ============================================================================
CREATE TABLE alert_profiles (
  id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  int NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          int REFERENCES users(id) ON DELETE SET NULL,
  name             text NOT NULL,
  categories       text[] NOT NULL DEFAULT '{}',
  keywords         text[] NOT NULL DEFAULT '{}',
  exclude_keywords text[] NOT NULL DEFAULT '{}',
  states           text[] NOT NULL DEFAULT '{}',
  departments      text[] NOT NULL DEFAULT '{}',
  tender_types     text[] NOT NULL DEFAULT '{}',
  value_min        numeric(18,2),
  value_max        numeric(18,2),
  recipient_emails text[] NOT NULL DEFAULT '{}',
  frequency        text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'alternate_day', 'weekly')),
  weekly_day       int NOT NULL DEFAULT 1 CHECK (weekly_day BETWEEN 0 AND 6),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  last_run_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_alert_profiles_org ON alert_profiles (organization_id);

CREATE TABLE alert_digests (
  id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  int NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id       int NOT NULL REFERENCES alert_profiles(id) ON DELETE CASCADE,
  digest_date      date NOT NULL,
  is_test          boolean NOT NULL DEFAULT false,
  matched_count    int NOT NULL DEFAULT 0,
  included_count   int NOT NULL DEFAULT 0,
  cap              int NOT NULL,
  generated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_digest_profile_day ON alert_digests (profile_id, digest_date) WHERE NOT is_test;

CREATE TABLE alert_digest_items (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  digest_id       int NOT NULL REFERENCES alert_digests(id) ON DELETE CASCADE,
  tender_id       bigint NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  score           int NOT NULL,
  rank_position   int NOT NULL,
  in_digest       boolean NOT NULL,
  is_closing_soon boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_digest_items_digest ON alert_digest_items (digest_id);
CREATE INDEX idx_digest_items_tender ON alert_digest_items (tender_id);

CREATE TABLE email_queue (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id int REFERENCES organizations(id) ON DELETE SET NULL,
  kind            text NOT NULL CHECK (kind IN ('digest', 'test', 'reminder', 'bundle_notice', 'password_reset', 'invite', 'ops_alert')),
  recipient       text NOT NULL,
  subject         text NOT NULL,
  html_body       text NOT NULL,
  profile_name    text,
  tenders_count   int NOT NULL DEFAULT 0,
  digest_id       int REFERENCES alert_digests(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'dry_run', 'cancelled')),
  idempotency_key text NOT NULL UNIQUE,
  attempts        int NOT NULL DEFAULT 0,
  max_attempts    int NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  graph_message_id text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_queue_due ON email_queue (status, next_attempt_at);
CREATE INDEX idx_email_queue_org ON email_queue (organization_id, created_at DESC);

CREATE TABLE email_delivery_logs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_id      bigint NOT NULL REFERENCES email_queue(id) ON DELETE CASCADE,
  response_code int,
  outcome       text NOT NULL,
  detail        text,
  latency_ms    int,
  attempted_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_bounce_records (
  id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_email text NOT NULL,
  bounce_type     text NOT NULL CHECK (bounce_type IN ('hard', 'soft', 'complaint')),
  raw_diagnostic  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bounces_recipient ON email_bounce_records (recipient_email);

-- ============================================================================
-- Tender results (award intelligence)
-- ============================================================================
CREATE TABLE historical_awards (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider        text NOT NULL,
  source_id       text NOT NULL,
  tender_id       bigint REFERENCES tenders(id) ON DELETE SET NULL,
  tender_ref      text,
  tender_title    text NOT NULL,
  department      text,
  department_id   int REFERENCES departments(id) ON DELETE SET NULL,
  category        text,
  category_id     int REFERENCES tender_categories(id) ON DELETE SET NULL,
  state           text,
  state_id        int REFERENCES states(id) ON DELETE SET NULL,
  city            text,
  estimated_value numeric(18,2) CHECK (estimated_value IS NULL OR estimated_value > 0),
  awarded_value   numeric(18,2) CHECK (awarded_value IS NULL OR awarded_value > 0),
  winner_name     text,
  l1_amount       numeric(18,2) CHECK (l1_amount IS NULL OR l1_amount > 0),
  l2_bidder_name  text,
  l2_amount       numeric(18,2) CHECK (l2_amount IS NULL OR l2_amount > 0),
  rate_status     text NOT NULL DEFAULT 'not_published' CHECK (rate_status IN ('present', 'not_published')),
  item_name       text,
  unit            text,
  unit_rate       numeric(18,2) CHECK (unit_rate IS NULL OR unit_rate > 0),
  bidder_count    int,
  qualified_count int,
  award_date      date,
  work_order_ref  text,
  source_portal   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, source_id)
);
CREATE INDEX idx_awards_dept   ON historical_awards (department_id);
CREATE INDEX idx_awards_date   ON historical_awards (award_date DESC);
CREATE INDEX idx_awards_winner ON historical_awards (winner_name);

CREATE TABLE award_bidders (
  id                   int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  award_id             bigint NOT NULL REFERENCES historical_awards(id) ON DELETE CASCADE,
  bidder_name          text NOT NULL,
  quoted_amount        numeric(18,2),
  rank_position        int,
  technically_qualified boolean,
  is_l1                boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_award_bidders_award ON award_bidders (award_id);

-- ============================================================================
-- Weekly analytical bundles (Reports locker)
-- ============================================================================
CREATE TABLE report_bundles (
  id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id int NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  title           text NOT NULL,
  status          text NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'failed')),
  snapshot        jsonb,
  pdf_key         text,
  xlsx_key        text,
  size_bytes      bigint,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, period_start)
);

-- Append-only release log. No foreign keys on purpose.
CREATE TABLE report_releases (
  id                  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id     int NOT NULL,
  bundle_id           int NOT NULL,
  bundle_title        text NOT NULL,
  scope               text NOT NULL CHECK (scope IN ('client', 'plan')),
  plan_code           text,
  released_by_user_id int,
  released_by_name    text,
  released_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, bundle_id)
);

CREATE TABLE report_downloads (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bundle_id       int NOT NULL REFERENCES report_bundles(id) ON DELETE CASCADE,
  organization_id int NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         int REFERENCES users(id) ON DELETE SET NULL,
  format          text NOT NULL,
  downloaded_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- Submission assistance desk
-- ============================================================================
CREATE TABLE submission_cases (
  id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id int NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tender_id       bigint REFERENCES tenders(id) ON DELETE SET NULL,
  tender_ref      text,
  tender_title    text NOT NULL,
  department      text,
  client_name     text NOT NULL,
  requested_by    int REFERENCES users(id) ON DELETE SET NULL,
  assigned_to     int REFERENCES users(id) ON DELETE SET NULL,
  assigned_name   text,  -- denormalised: client accounts cannot read staff user rows
  stage           text NOT NULL DEFAULT 'intake'
                  CHECK (stage IN ('intake', 'detail_study', 'eligibility', 'technical_prep', 'financial_strategy',
                                   'prebid', 'submission', 'evaluation', 'follow_up', 'closed')),
  deadline        timestamptz,
  estimated_value numeric(18,2),
  emd_amount      numeric(18,2),
  client_summary  text,
  outcome         text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'l1', 'not_l1', 'cancelled', 'withdrawn')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz
);
CREATE INDEX idx_cases_org   ON submission_cases (organization_id);
CREATE INDEX idx_cases_stage ON submission_cases (stage);

-- Staff-only working data. Separate tables so row-level security (not just the
-- API serializer) keeps them away from client accounts (FR-CASE-011).
CREATE TABLE case_internal (
  case_id            int PRIMARY KEY REFERENCES submission_cases(id) ON DELETE CASCADE,
  financial_strategy text,
  rate_analysis      jsonb,
  margin_notes       text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE case_analyst_notes (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id    int NOT NULL REFERENCES submission_cases(id) ON DELETE CASCADE,
  author_id  int REFERENCES users(id) ON DELETE SET NULL,
  note_text  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE submission_case_stages (
  id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id      int NOT NULL REFERENCES submission_cases(id) ON DELETE CASCADE,
  stage        text NOT NULL,
  entered_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  moved_by     int REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE submission_case_checklists (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id    int NOT NULL REFERENCES submission_cases(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('eligibility', 'technical')),
  label      text NOT NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'pass', 'fail', 'na')),
  note       text,
  updated_by int REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE case_documents (
  id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id     int NOT NULL REFERENCES submission_cases(id) ON DELETE CASCADE,
  slot        text NOT NULL DEFAULT 'other'
              CHECK (slot IN ('tender_document', 'compliance_checklist', 'technical_bid', 'boq',
                              'proof_of_submission', 'emd_receipt', 'work_order', 'other')),
  name        text NOT NULL,
  size_bytes  bigint,
  mime_type   text,
  storage_key text NOT NULL,
  visibility  text NOT NULL DEFAULT 'internal_only' CHECK (visibility IN ('shared', 'internal_only')),
  uploaded_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE case_activity_logs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id    int NOT NULL REFERENCES submission_cases(id) ON DELETE CASCADE,
  user_id    int REFERENCES users(id) ON DELETE SET NULL,
  user_name  text NOT NULL,
  action     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE case_emd_tracking (
  id                int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id           int NOT NULL REFERENCES submission_cases(id) ON DELETE CASCADE,
  instrument_type   text CHECK (instrument_type IN ('Bank Guarantee', 'FDR', 'Demand Draft', 'Online Portal', 'Exempted')),
  issuing_bank      text,
  instrument_number text,
  amount            numeric(18,2),
  valid_till        date,
  refund_status     text NOT NULL DEFAULT 'Pending' CHECK (refund_status IN ('Pending', 'Refunded', 'Forfeited', 'Converted to PBG')),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE case_prebid_queries (
  id                  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id             int NOT NULL REFERENCES submission_cases(id) ON DELETE CASCADE,
  query_text          text NOT NULL,
  raised_at           timestamptz NOT NULL DEFAULT now(),
  department_response text,
  responded_at        timestamptz
);

CREATE TABLE case_submissions (
  case_id          int PRIMARY KEY REFERENCES submission_cases(id) ON DELETE CASCADE,
  mode             text NOT NULL CHECK (mode IN ('online', 'offline')),
  portal_reference text,
  courier_name     text,
  tracking_number  text,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  submitted_by     int REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT submission_has_reference CHECK (
    (mode = 'online'  AND portal_reference IS NOT NULL) OR
    (mode = 'offline' AND tracking_number  IS NOT NULL)
  )
);

CREATE TABLE case_results (
  case_id          int PRIMARY KEY REFERENCES submission_cases(id) ON DELETE CASCADE,
  technical_status text CHECK (technical_status IN ('pending', 'qualified', 'disqualified')),
  financial_status text CHECK (financial_status IN ('pending', 'opened', 'evaluated')),
  outcome          text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'l1', 'not_l1')),
  our_amount       numeric(18,2),
  l1_amount        numeric(18,2),
  result_date      date,
  remarks          text
);

CREATE TABLE case_followups (
  id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id      int NOT NULL REFERENCES submission_cases(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('emd_refund', 'purchase_order', 'payment')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  due_date     date,
  amount       numeric(18,2),
  reference    text,
  note         text,
  completed_at timestamptz
);
CREATE INDEX idx_case_children_docs ON case_documents (case_id);
CREATE INDEX idx_case_children_log  ON case_activity_logs (case_id);
