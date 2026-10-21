-- ============================================================================
-- 002 - Row-level security, grants and append-only protection
--
-- Request context is carried in two transaction-local settings that ONLY the
-- API server sets, after it has verified the session:
--   app.current_organization_id  -> the caller's organization (tenant scope)
--   app.actor_scope              -> 'tenant' | 'staff' | 'system'
--
--   tenant : a client account. Sees only its own organization's rows.
--   staff  : Shan-Deep analysts / case managers / platform admins.
--   system : background jobs and pre-login paths (login, signup, enquiries).
--
-- 'staff' and 'system' are "privileged": they pass every policy below.
-- Anything without a recognised scope (including a missing or malformed
-- setting) is denied. Every table has RLS enabled AND forced; the policies are
-- the single place where tenant isolation is decided.
-- ============================================================================

CREATE FUNCTION current_tenant_org_id() RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN nullif(current_setting('app.current_organization_id', true), '') ~ '^[0-9]{1,9}$'
    THEN current_setting('app.current_organization_id', true)::int
  END
$$;

CREATE FUNCTION is_privileged() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.actor_scope', true), '') IN ('staff', 'system')
$$;

CREATE FUNCTION is_authenticated() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.actor_scope', true), '') IN ('tenant', 'staff', 'system')
$$;

-- ----------------------------------------------------------------------------
-- Enable + force RLS on every application table
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables
           WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- A. Staff / system only (no client account may touch these)
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_credentials', 'user_sessions', 'password_reset_tokens',
    'enquiries', 'enquiry_followups',
    'ingestion_runs', 'raw_tender_payloads', 'system_config', 'master_suggestions',
    'watchlist_reminders',
    'email_queue', 'email_delivery_logs', 'email_bounce_records',
    'case_internal', 'case_analyst_notes', 'case_activity_logs'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY priv_only ON %I FOR ALL USING (is_privileged()) WITH CHECK (is_privileged())', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- B. Shared reference data: any signed-in context reads, only privileged writes
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'plans', 'providers', 'tender_categories', 'departments', 'states', 'cities',
    'tenders', 'tender_documents', 'tender_boq_items', 'tender_corrigenda',
    'historical_awards', 'award_bidders'
  ] LOOP
    EXECUTE format('CREATE POLICY read_authenticated ON %I FOR SELECT USING (is_authenticated())', t);
    EXECUTE format(
      'CREATE POLICY write_priv ON %I FOR ALL USING (is_privileged()) WITH CHECK (is_privileged())', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- C. Tenant-owned, tenant may read AND write its own rows
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'watchlist_items', 'saved_searches', 'search_query_logs', 'alert_profiles',
    'report_downloads', 'privacy_requests'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_rw ON %I FOR ALL
         USING (is_privileged() OR organization_id = current_tenant_org_id())
         WITH CHECK (is_privileged() OR organization_id = current_tenant_org_id())', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- D. Tenant-owned, tenant may only READ its own rows (writes go through the API
--    server in system scope after it has authorised the action)
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'alert_digests', 'report_releases', 'submission_cases'] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_read ON %I FOR SELECT
         USING (is_privileged() OR organization_id = current_tenant_org_id())', t);
    EXECUTE format(
      'CREATE POLICY write_priv ON %I FOR ALL USING (is_privileged()) WITH CHECK (is_privileged())', t);
  END LOOP;
END $$;

CREATE POLICY tenant_read ON organizations FOR SELECT
  USING (is_privileged() OR id = current_tenant_org_id());
CREATE POLICY write_priv ON organizations FOR ALL
  USING (is_privileged()) WITH CHECK (is_privileged());

-- Audit log: any signed-in context may append, only staff may read.
CREATE POLICY audit_insert ON audit_events FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY audit_read   ON audit_events FOR SELECT USING (is_privileged());

-- ----------------------------------------------------------------------------
-- E. Child tables: visibility follows the parent row
-- ----------------------------------------------------------------------------
CREATE POLICY tenant_read ON alert_digest_items FOR SELECT USING (
  is_privileged() OR EXISTS (
    SELECT 1 FROM alert_digests d
    WHERE d.id = alert_digest_items.digest_id AND d.organization_id = current_tenant_org_id()));
CREATE POLICY write_priv ON alert_digest_items FOR ALL
  USING (is_privileged()) WITH CHECK (is_privileged());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'submission_case_stages', 'submission_case_checklists', 'case_emd_tracking',
    'case_prebid_queries', 'case_submissions', 'case_results', 'case_followups'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_read ON %I FOR SELECT USING (
         is_privileged() OR EXISTS (
           SELECT 1 FROM submission_cases c
           WHERE c.id = %I.case_id AND c.organization_id = current_tenant_org_id()))', t, t);
    EXECUTE format(
      'CREATE POLICY write_priv ON %I FOR ALL USING (is_privileged()) WITH CHECK (is_privileged())', t);
  END LOOP;
END $$;

-- Case documents: a client sees (and may add) only documents marked shared.
CREATE POLICY tenant_read ON case_documents FOR SELECT USING (
  is_privileged() OR (
    visibility = 'shared' AND EXISTS (
      SELECT 1 FROM submission_cases c
      WHERE c.id = case_documents.case_id AND c.organization_id = current_tenant_org_id())));
CREATE POLICY tenant_insert_shared ON case_documents FOR INSERT WITH CHECK (
  is_privileged() OR (
    visibility = 'shared' AND EXISTS (
      SELECT 1 FROM submission_cases c
      WHERE c.id = case_documents.case_id AND c.organization_id = current_tenant_org_id())));
CREATE POLICY write_priv ON case_documents FOR ALL
  USING (is_privileged()) WITH CHECK (is_privileged());

-- Report bundles stay invisible to a client until a release has been logged.
CREATE POLICY tenant_read_released ON report_bundles FOR SELECT USING (
  is_privileged() OR (
    organization_id = current_tenant_org_id() AND EXISTS (
      SELECT 1 FROM report_releases r
      WHERE r.bundle_id = report_bundles.id AND r.organization_id = report_bundles.organization_id)));
CREATE POLICY write_priv ON report_bundles FOR ALL
  USING (is_privileged()) WITH CHECK (is_privileged());

-- ----------------------------------------------------------------------------
-- Append-only integrity (audit log, report release log)
-- ----------------------------------------------------------------------------
CREATE FUNCTION forbid_update_or_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; % is not permitted.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_update_or_delete();
CREATE TRIGGER trg_audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_or_delete();

CREATE TRIGGER trg_report_releases_append_only
  BEFORE UPDATE OR DELETE ON report_releases
  FOR EACH ROW EXECUTE FUNCTION forbid_update_or_delete();
CREATE TRIGGER trg_report_releases_no_truncate
  BEFORE TRUNCATE ON report_releases
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_or_delete();

-- ----------------------------------------------------------------------------
-- Grants for the runtime role (RLS above decides what each row-level request
-- may actually do)
-- ----------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_api_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_api_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_api_user;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events, report_releases FROM app_api_user;
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    REVOKE ALL ON schema_migrations FROM app_api_user;
  END IF;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_api_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_api_user;
