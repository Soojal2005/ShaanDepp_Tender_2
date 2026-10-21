-- ============================================================================
-- Shan-Deep Tender Intelligence Platform & Portal (procure-brain.com)
-- PostgreSQL 15+ Core Schema & Row-Level Security Baseline (Modules M0-M11)
-- Exactly 53 Relational Tables with Least-Privilege API Role and Tenant RLS
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ----------------------------------------------------------------------------
-- 0. Database Role Configuration (Least Privilege)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_api_user') THEN
    CREATE ROLE app_api_user WITH LOGIN PASSWORD 'shandeep_api_secret_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_migration_user') THEN
    CREATE ROLE app_migration_user WITH LOGIN PASSWORD 'shandeep_migration_secret_2026' CREATEDB;
  END IF;
END $$;

-- ============================================================================
-- MODULE M0: System Configuration & Feature Flags (Tables 1-2)
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_config (
  id SERIAL PRIMARY KEY,
  config_key VARCHAR(100) UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_flags (
  id SERIAL PRIMARY KEY,
  flag_key VARCHAR(100) UNIQUE NOT NULL,
  is_enabled BOOLEAN DEFAULT false,
  target_environments TEXT[] DEFAULT ARRAY['development', 'staging'],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- MODULE M1 & M3: Organizations, Multi-Tenancy, Users & Audit (Tables 3-9)
-- ============================================================================

CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
  name VARCHAR(255) NOT NULL,
  domain VARCHAR(100),
  plan_tier VARCHAR(50) DEFAULT 'Standard' CHECK (plan_tier IN ('Standard', 'Professional', 'Enterprise')),
  daily_digest_cap INT DEFAULT 100,
  max_seats INT DEFAULT 3,
  status VARCHAR(30) DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended', 'Pending')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_settings (
  organization_id INT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  timezone VARCHAR(50) DEFAULT 'Asia/Kolkata',
  default_language VARCHAR(10) DEFAULT 'EN',
  allowed_ip_cidrs TEXT[],
  two_factor_required BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
  organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  phone VARCHAR(50),
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'subscriber' CHECK (role IN ('subscriber', 'analyst', 'case_manager', 'tenant_admin', 'tenant_owner')),
  is_active BOOLEAN DEFAULT true,
  consent_timestamp TIMESTAMPTZ DEFAULT NOW(),
  privacy_notice_version VARCHAR(30) DEFAULT 'v2026.1',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id VARCHAR(100) PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
  ip_address VARCHAR(50),
  user_agent TEXT,
  csrf_secret VARCHAR(100) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id VARCHAR(100),
  ip_address VARCHAR(50),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id SERIAL PRIMARY KEY,
  organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  request_type VARCHAR(50) NOT NULL CHECK (request_type IN ('data_export', 'data_erasure', 'consent_withdrawal')),
  status VARCHAR(50) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Processing', 'Completed', 'Rejected')),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id SERIAL PRIMARY KEY,
  role_name VARCHAR(50) NOT NULL,
  permission VARCHAR(100) NOT NULL,
  UNIQUE(role_name, permission)
);

-- ============================================================================
-- MODULE M2: Public Website & Lead Enquiry Intake (Tables 10-11)
-- ============================================================================

CREATE TABLE IF NOT EXISTS enquiries (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  company VARCHAR(200) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(150) NOT NULL,
  service VARCHAR(200),
  message TEXT,
  ip_address VARCHAR(50),
  status VARCHAR(50) DEFAULT 'New' CHECK (status IN ('New', 'Contacted', 'Qualified', 'Closed')),
  consent_timestamp TIMESTAMPTZ DEFAULT NOW(),
  privacy_notice_version VARCHAR(30) DEFAULT 'v2026.1',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS enquiry_followups (
  id SERIAL PRIMARY KEY,
  enquiry_id VARCHAR(50) REFERENCES enquiries(id) ON DELETE CASCADE,
  assigned_to INT REFERENCES users(id),
  notes TEXT NOT NULL,
  followup_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- MODULE M4 & M5: Ingestion, Tenders, BOQ & Search Architecture (Tables 12-26)
-- ============================================================================

CREATE TABLE IF NOT EXISTS providers (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('central_portal', 'state_portal', 'gem', 'psu_direct')),
  base_url VARCHAR(255),
  status VARCHAR(30) DEFAULT 'Active',
  sync_frequency_minutes INT DEFAULT 60,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id SERIAL PRIMARY KEY,
  provider_id VARCHAR(50) REFERENCES providers(id),
  status VARCHAR(50) DEFAULT 'Scheduled',
  total_records_fetched INT DEFAULT 0,
  new_records_inserted INT DEFAULT 0,
  records_updated INT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ingestion_job_runs (
  id SERIAL PRIMARY KEY,
  job_id INT REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'Running',
  error_message TEXT,
  payload_checksum VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_tender_payloads (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(100) NOT NULL,
  source_id VARCHAR(100) NOT NULL,
  raw_json JSONB NOT NULL,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, source_id)
);

CREATE TABLE IF NOT EXISTS tender_categories (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  tier VARCHAR(50) DEFAULT 'Central' CHECK (tier IN ('Central', 'State', 'PSU', 'Municipal'))
);

CREATE TABLE IF NOT EXISTS geographic_regions (
  id SERIAL PRIMARY KEY,
  state_name VARCHAR(100) NOT NULL,
  city_name VARCHAR(100),
  zone VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS tenders (
  id VARCHAR(50) PRIMARY KEY,
  source_id VARCHAR(100) NOT NULL,
  provider VARCHAR(100) NOT NULL,
  title TEXT NOT NULL,
  department VARCHAR(150) NOT NULL,
  category VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  city VARCHAR(100),
  org_type VARCHAR(100),
  estimated_value NUMERIC(18,2),
  estimated_value_display VARCHAR(50),
  emd_amount NUMERIC(18,2),
  emd_status VARCHAR(30) DEFAULT 'present' CHECK (emd_status IN ('present', 'exempted', 'not_published', 'missing')),
  emd_display VARCHAR(50),
  tender_fee VARCHAR(50),
  publish_date DATE,
  submission_deadline TIMESTAMPTZ,
  opening_date TIMESTAMPTZ,
  status VARCHAR(50) DEFAULT 'Open' CHECK (status IN ('Open', 'Closed', 'Under Evaluation', 'Awarded', 'Cancelled')),
  has_boq BOOLEAN DEFAULT true,
  has_documents BOOLEAN DEFAULT true,
  description TEXT,
  eligibility_summary TEXT,
  search_tsv tsvector,
  last_source_update TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, source_id)
);

CREATE INDEX IF NOT EXISTS idx_tenders_search_tsv ON tenders USING GIN(search_tsv);
CREATE INDEX IF NOT EXISTS idx_tenders_deadline ON tenders(submission_deadline);
CREATE INDEX IF NOT EXISTS idx_tenders_dept_state ON tenders(department, state);
CREATE INDEX IF NOT EXISTS idx_tenders_value ON tenders(estimated_value);

CREATE TABLE IF NOT EXISTS tender_documents (
  id SERIAL PRIMARY KEY,
  tender_id VARCHAR(50) REFERENCES tenders(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  size VARCHAR(50),
  type VARCHAR(50),
  url VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tender_boq_items (
  id SERIAL PRIMARY KEY,
  tender_id VARCHAR(50) REFERENCES tenders(id) ON DELETE CASCADE,
  item_code VARCHAR(100),
  item_name TEXT NOT NULL,
  quantity NUMERIC(14,2),
  unit VARCHAR(50),
  estimated_rate NUMERIC(14,2),
  total_amount NUMERIC(18,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tender_corrigenda (
  id SERIAL PRIMARY KEY,
  tender_id VARCHAR(50) REFERENCES tenders(id) ON DELETE CASCADE,
  corrigendum_number VARCHAR(50) NOT NULL,
  subject TEXT NOT NULL,
  issue_date DATE NOT NULL,
  attachment_url VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watchlists (
  id SERIAL PRIMARY KEY,
  organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(150) DEFAULT 'Default Watchlist',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id SERIAL PRIMARY KEY,
  watchlist_id INT REFERENCES watchlists(id) ON DELETE CASCADE,
  tender_id VARCHAR(50) REFERENCES tenders(id) ON DELETE CASCADE,
  notes TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(watchlist_id, tender_id)
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id SERIAL PRIMARY KEY,
  organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  query_params JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS search_query_logs (
  id BIGSERIAL PRIMARY KEY,
  organization_id INT REFERENCES organizations(id) ON DELETE SET NULL,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  query_text TEXT,
  filters_applied JSONB,
  results_count INT,
  latency_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- MODULE M6: Alert Profiles, 100-Pt Ranking Engine & Email Delivery (Tables 27-33)
-- ============================================================================

CREATE TABLE IF NOT EXISTS alert_profiles (
  id VARCHAR(50) PRIMARY KEY,
  organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  categories TEXT[],
  keywords TEXT[],
  exclude_keywords TEXT[],
  states TEXT[],
  departments TEXT[],
  value_min NUMERIC(18,2) DEFAULT 0,
  value_max NUMERIC(18,2),
  frequency VARCHAR(50) DEFAULT 'Daily (08:00 AM)',
  status VARCHAR(30) DEFAULT 'Active' CHECK (status IN ('Active', 'Paused')),
  effective_cap INT DEFAULT 100,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_profile_criteria (
  id SERIAL PRIMARY KEY,
  profile_id VARCHAR(50) REFERENCES alert_profiles(id) ON DELETE CASCADE,
  field_name VARCHAR(100) NOT NULL,
  operator VARCHAR(50) NOT NULL,
  field_value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_digests (
  id VARCHAR(50) PRIMARY KEY,
  organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id VARCHAR(50) REFERENCES alert_profiles(id) ON DELETE CASCADE,
  recipient_email VARCHAR(150) NOT NULL,
  tenders_matched_count INT DEFAULT 0,
  tenders_included_count INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'Generated',
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_digest_items (
  id BIGSERIAL PRIMARY KEY,
  digest_id VARCHAR(50) REFERENCES alert_digests(id) ON DELETE CASCADE,
  tender_id VARCHAR(50) REFERENCES tenders(id),
  score INT NOT NULL,
  is_closing_soon BOOLEAN DEFAULT false,
  rank_position INT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_queue (
  id VARCHAR(50) PRIMARY KEY,
  organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
  recipient VARCHAR(150) NOT NULL,
  profile_name VARCHAR(150),
  tenders_count INT DEFAULT 0,
  status VARCHAR(100) DEFAULT 'Queued',
  idempotency_key VARCHAR(150) UNIQUE NOT NULL,
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 5,
  retry_after_seconds INT DEFAULT 0,
  can_retry BOOLEAN DEFAULT false,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_delivery_logs (
  id BIGSERIAL PRIMARY KEY,
  email_id VARCHAR(50) REFERENCES email_queue(id) ON DELETE CASCADE,
  graph_message_id VARCHAR(255),
  response_code INT,
  delivery_status VARCHAR(50),
  latency_ms INT,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_bounce_records (
  id SERIAL PRIMARY KEY,
  recipient_email VARCHAR(150) NOT NULL,
  bounce_type VARCHAR(50) NOT NULL CHECK (bounce_type IN ('hard', 'soft', 'complaint')),
  raw_diagnostic TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- MODULE M7: Historical Tender Award Intelligence & Rate Spread (Tables 34-37)
-- ============================================================================

CREATE TABLE IF NOT EXISTS historical_awards (
  id VARCHAR(50) PRIMARY KEY,
  tender_id VARCHAR(50) REFERENCES tenders(id) ON DELETE SET NULL,
  tender_title TEXT NOT NULL,
  department VARCHAR(150) NOT NULL,
  state VARCHAR(100) NOT NULL,
  estimated_value NUMERIC(18,2),
  awarded_value NUMERIC(18,2),
  l1_bidder_name VARCHAR(200),
  l2_bidder_name VARCHAR(200),
  l1_margin_percent NUMERIC(6,2),
  rate_status VARCHAR(50) DEFAULT 'present' CHECK (rate_status IN ('present', 'not_published', 'missing')),
  bidder_count INT DEFAULT 0,
  award_date DATE,
  source_portal VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS award_bidders (
  id SERIAL PRIMARY KEY,
  award_id VARCHAR(50) REFERENCES historical_awards(id) ON DELETE CASCADE,
  bidder_name VARCHAR(200) NOT NULL,
  quoted_amount NUMERIC(18,2),
  rank_position INT,
  technical_score NUMERIC(5,2),
  is_l1 BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS historical_rate_analysis (
  id SERIAL PRIMARY KEY,
  category VARCHAR(100) NOT NULL,
  department VARCHAR(150) NOT NULL,
  avg_discount_to_csr NUMERIC(6,2),
  sample_size INT DEFAULT 0,
  time_period VARCHAR(50),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competitor_profiles (
  id SERIAL PRIMARY KEY,
  company_name VARCHAR(200) UNIQUE NOT NULL,
  primary_sectors TEXT[],
  tenders_participated INT DEFAULT 0,
  tenders_won INT DEFAULT 0,
  win_rate_percent NUMERIC(5,2),
  last_active_date DATE
);

-- ============================================================================
-- MODULE M8: Reports & Analytics Locker (Tables 38-41)
-- ============================================================================

CREATE TABLE IF NOT EXISTS report_bundles (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  cohort VARCHAR(150),
  format VARCHAR(50) DEFAULT 'PDF + XLSX',
  published_date DATE,
  file_size VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_releases (
  id VARCHAR(50) PRIMARY KEY,
  organization_id INT REFERENCES organizations(id) ON DELETE SET NULL,
  bundle_name VARCHAR(255) NOT NULL,
  target_cohort VARCHAR(150),
  format VARCHAR(50) DEFAULT 'PDF + XLSX',
  released_by VARCHAR(150),
  status VARCHAR(50) DEFAULT 'Locker Synced',
  released_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_downloads (
  id BIGSERIAL PRIMARY KEY,
  bundle_id VARCHAR(50) REFERENCES report_bundles(id) ON DELETE CASCADE,
  organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  downloaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id SERIAL PRIMARY KEY,
  organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  total_active_tenders INT,
  total_pipeline_value NUMERIC(20,2),
  urgent_closing_count INT,
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- MODULE M9: Submission Desk & Bid Management Pipeline (Tables 42-48)
-- ============================================================================

CREATE TABLE IF NOT EXISTS submission_cases (
  id VARCHAR(50) PRIMARY KEY,
  organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
  tender_id VARCHAR(50) REFERENCES tenders(id),
  tender_title TEXT NOT NULL,
  department VARCHAR(150),
  client_name VARCHAR(255) NOT NULL,
  assigned_analyst VARCHAR(150),
  stage VARCHAR(50) DEFAULT 'intake' CHECK (stage IN ('intake', 'eligibility', 'document_prep', 'technical_prep', 'financial_bid', 'submitted', 'evaluation', 'award')),
  deadline DATE,
  estimated_value VARCHAR(50),
  emd_amount VARCHAR(50),
  completion_rate INT DEFAULT 15,
  analyst_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS submission_case_stages (
  id SERIAL PRIMARY KEY,
  case_id VARCHAR(50) REFERENCES submission_cases(id) ON DELETE CASCADE,
  stage_name VARCHAR(50) NOT NULL,
  entered_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  completed_by INT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS submission_case_checklists (
  id SERIAL PRIMARY KEY,
  case_id VARCHAR(50) REFERENCES submission_cases(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  passed BOOLEAN DEFAULT false,
  note TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_documents (
  id SERIAL PRIMARY KEY,
  case_id VARCHAR(50) REFERENCES submission_cases(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  size VARCHAR(50),
  visibility VARCHAR(50) DEFAULT 'internal_only' CHECK (visibility IN ('shared', 'internal_only')),
  uploaded_by VARCHAR(150),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_activity_logs (
  id BIGSERIAL PRIMARY KEY,
  case_id VARCHAR(50) REFERENCES submission_cases(id) ON DELETE CASCADE,
  user_name VARCHAR(150) NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_analyst_notes (
  id SERIAL PRIMARY KEY,
  case_id VARCHAR(50) REFERENCES submission_cases(id) ON DELETE CASCADE,
  analyst_user_id INT REFERENCES users(id),
  note_text TEXT NOT NULL,
  confidential BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_emd_tracking (
  id SERIAL PRIMARY KEY,
  case_id VARCHAR(50) REFERENCES submission_cases(id) ON DELETE CASCADE,
  instrument_type VARCHAR(50) CHECK (instrument_type IN ('Bank Guarantee', 'FDR', 'Demand Draft', 'Online Portal', 'Exempted')),
  issuing_bank VARCHAR(150),
  instrument_number VARCHAR(100),
  valid_till DATE,
  refund_status VARCHAR(50) DEFAULT 'Pending' CHECK (refund_status IN ('Pending', 'Refunded', 'Forfeited', 'Converted to PBG')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- MODULE M10 & M11: Admin Console, Maintenance & Test Harness (Tables 49-53)
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform_admins (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  role_tier VARCHAR(50) DEFAULT 'super_admin' CHECK (role_tier IN ('super_admin', 'ops_admin', 'compliance_officer')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_id INT REFERENCES platform_admins(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  target_resource VARCHAR(100) NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_maintenance_windows (
  id SERIAL PRIMARY KEY,
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  is_completed BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS verification_suite_runs (
  id SERIAL PRIMARY KEY,
  suite_id VARCHAR(50) NOT NULL,
  suite_name VARCHAR(150) NOT NULL,
  status VARCHAR(30) DEFAULT 'Running' CHECK (status IN ('Passed', 'Failed', 'Running')),
  total_assertions INT DEFAULT 0,
  passed_assertions INT DEFAULT 0,
  duration_ms INT,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verification_test_results (
  id BIGSERIAL PRIMARY KEY,
  run_id INT REFERENCES verification_suite_runs(id) ON DELETE CASCADE,
  test_name VARCHAR(200) NOT NULL,
  passed BOOLEAN NOT NULL,
  details JSONB,
  error_message TEXT
);

-- ============================================================================
-- POSTGRESQL ROW-LEVEL SECURITY (RLS) POLICIES
-- Enforce strict multi-tenant isolation across all tenant-owned tables
-- ============================================================================

-- Function to read session org
CREATE OR REPLACE FUNCTION current_tenant_org_id() RETURNS INT AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_organization_id', true), '')::INT;
END;
$$ LANGUAGE plpgsql STABLE;

-- Enable RLS and Force on all tenant tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_query_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_profile_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_digest_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_downloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_case_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_case_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_analyst_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_emd_tracking ENABLE ROW LEVEL SECURITY;

ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE org_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE watchlists FORCE ROW LEVEL SECURITY;
ALTER TABLE watchlist_items FORCE ROW LEVEL SECURITY;
ALTER TABLE saved_searches FORCE ROW LEVEL SECURITY;
ALTER TABLE search_query_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE alert_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE alert_profile_criteria FORCE ROW LEVEL SECURITY;
ALTER TABLE alert_digests FORCE ROW LEVEL SECURITY;
ALTER TABLE alert_digest_items FORCE ROW LEVEL SECURITY;
ALTER TABLE email_queue FORCE ROW LEVEL SECURITY;
ALTER TABLE report_releases FORCE ROW LEVEL SECURITY;
ALTER TABLE report_downloads FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE submission_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE submission_case_stages FORCE ROW LEVEL SECURITY;
ALTER TABLE submission_case_checklists FORCE ROW LEVEL SECURITY;
ALTER TABLE case_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE case_activity_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE case_analyst_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE case_emd_tracking FORCE ROW LEVEL SECURITY;

-- Base Tenant Policies
CREATE POLICY tenant_isolation_organizations ON organizations
  FOR ALL USING (id = current_tenant_org_id());

CREATE POLICY tenant_isolation_org_settings ON org_settings
  FOR ALL USING (organization_id = current_tenant_org_id());

CREATE POLICY tenant_isolation_users ON users
  FOR ALL USING (organization_id = current_tenant_org_id());

CREATE POLICY tenant_isolation_sessions ON user_sessions
  FOR ALL USING (organization_id = current_tenant_org_id());

CREATE POLICY tenant_isolation_audit ON audit_events
  FOR ALL USING (organization_id = current_tenant_org_id());

CREATE POLICY tenant_isolation_privacy ON privacy_requests
  FOR ALL USING (organization_id = current_tenant_org_id());

CREATE POLICY tenant_isolation_watchlists ON watchlists
  FOR ALL USING (organization_id = current_tenant_org_id());

CREATE POLICY tenant_isolation_saved_searches ON saved_searches
  FOR ALL USING (organization_id = current_tenant_org_id());

CREATE POLICY tenant_isolation_alerts ON alert_profiles
  FOR ALL USING (organization_id = current_tenant_org_id());

CREATE POLICY tenant_isolation_email_queue ON email_queue
  FOR ALL USING (organization_id = current_tenant_org_id());

CREATE POLICY tenant_isolation_cases ON submission_cases
  FOR ALL USING (organization_id = current_tenant_org_id());

CREATE POLICY tenant_isolation_analytics ON analytics_snapshots
  FOR ALL USING (organization_id = current_tenant_org_id());

-- Parent-Scoped Policies for Child Tables
CREATE POLICY tenant_isolation_watchlist_items ON watchlist_items
  FOR ALL USING (EXISTS (
    SELECT 1 FROM watchlists w WHERE w.id = watchlist_items.watchlist_id AND w.organization_id = current_tenant_org_id()
  ));

CREATE POLICY tenant_isolation_alert_criteria ON alert_profile_criteria
  FOR ALL USING (EXISTS (
    SELECT 1 FROM alert_profiles ap WHERE ap.id = alert_profile_criteria.profile_id AND ap.organization_id = current_tenant_org_id()
  ));

CREATE POLICY tenant_isolation_alert_digests ON alert_digests
  FOR ALL USING (organization_id = current_tenant_org_id());

CREATE POLICY tenant_isolation_alert_digest_items ON alert_digest_items
  FOR ALL USING (EXISTS (
    SELECT 1 FROM alert_digests ad WHERE ad.id = alert_digest_items.digest_id AND ad.organization_id = current_tenant_org_id()
  ));

CREATE POLICY tenant_isolation_case_stages ON submission_case_stages
  FOR ALL USING (EXISTS (
    SELECT 1 FROM submission_cases sc WHERE sc.id = submission_case_stages.case_id AND sc.organization_id = current_tenant_org_id()
  ));

CREATE POLICY tenant_isolation_case_checklists ON submission_case_checklists
  FOR ALL USING (EXISTS (
    SELECT 1 FROM submission_cases sc WHERE sc.id = submission_case_checklists.case_id AND sc.organization_id = current_tenant_org_id()
  ));

CREATE POLICY tenant_isolation_case_docs ON case_documents
  FOR ALL USING (EXISTS (
    SELECT 1 FROM submission_cases sc WHERE sc.id = case_documents.case_id AND sc.organization_id = current_tenant_org_id()
  ));

CREATE POLICY tenant_isolation_case_activities ON case_activity_logs
  FOR ALL USING (EXISTS (
    SELECT 1 FROM submission_cases sc WHERE sc.id = case_activity_logs.case_id AND sc.organization_id = current_tenant_org_id()
  ));

CREATE POLICY tenant_isolation_case_notes ON case_analyst_notes
  FOR ALL USING (EXISTS (
    SELECT 1 FROM submission_cases sc WHERE sc.id = case_analyst_notes.case_id AND sc.organization_id = current_tenant_org_id()
  ));

CREATE POLICY tenant_isolation_case_emd ON case_emd_tracking
  FOR ALL USING (EXISTS (
    SELECT 1 FROM submission_cases sc WHERE sc.id = case_emd_tracking.case_id AND sc.organization_id = current_tenant_org_id()
  ));

-- ============================================================================
-- APPEND-ONLY INTEGRITY RULES (Report Releases, Audit Events)
-- ============================================================================

CREATE OR REPLACE FUNCTION forbid_update_or_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Table % is strictly append-only. Modification or deletion is forbidden by security policy.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_report_releases_append_only ON report_releases;
CREATE TRIGGER trg_report_releases_append_only
  BEFORE UPDATE OR DELETE ON report_releases
  FOR EACH ROW EXECUTE FUNCTION forbid_update_or_delete();

DROP TRIGGER IF EXISTS trg_audit_events_append_only ON audit_events;
CREATE TRIGGER trg_audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_update_or_delete();

-- Grant permissions to least-privilege runtime role
GRANT USAGE ON SCHEMA public TO app_api_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_api_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_api_user;
REVOKE UPDATE, DELETE ON report_releases FROM app_api_user;
REVOKE UPDATE, DELETE ON audit_events FROM app_api_user;
