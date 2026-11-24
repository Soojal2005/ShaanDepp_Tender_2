-- 020 - Recently viewed tenders (per user), for the dashboard "recently viewed" list.
-- One row per (user, tender); each view bumps viewed_at. Tenant-scoped like the
-- other per-subscriber tables. app_api_user gets table/sequence privileges from the
-- default privileges set in migration 002.
CREATE TABLE IF NOT EXISTS tender_views (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id int NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tender_id       bigint NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  viewed_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tender_id)
);
CREATE INDEX IF NOT EXISTS idx_tender_views_user ON tender_views (user_id, viewed_at DESC);

ALTER TABLE tender_views ENABLE ROW LEVEL SECURITY;
-- Tenant may read and write its own rows (same shape as watchlist_items etc.).
-- Idempotent: the forward-only runner re-applies this on every boot, and the
-- table/policy may already exist (created out of band), so drop before re-creating
-- rather than letting "policy already exists" abort the migration and the boot.
DROP POLICY IF EXISTS tenant_rw ON tender_views;
CREATE POLICY tenant_rw ON tender_views FOR ALL
  USING (is_privileged() OR organization_id = current_tenant_org_id())
  WITH CHECK (is_privileged() OR organization_id = current_tenant_org_id());
