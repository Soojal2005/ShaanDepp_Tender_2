-- ============================================================================
-- 004 - Tender number (links results to tenders) and ingestion bookkeeping
-- ============================================================================

-- The portal's own tender number. Result records quote it, which is how an
-- award is tied back to the tender it came from.
ALTER TABLE tenders ADD COLUMN tender_no text;
CREATE INDEX idx_tenders_tender_no ON tenders (tender_no);

-- Results carry the reference ids the source used for the tender they award.
ALTER TABLE historical_awards ADD COLUMN source_tender_ref text;
CREATE INDEX idx_awards_source_tender_ref ON historical_awards (source_tender_ref);

-- Remember the full reason an administrator should look at a run.
ALTER TABLE ingestion_runs ADD COLUMN warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Credential state is visible in the admin console without exposing the key.
ALTER TABLE providers ADD COLUMN last_success_at timestamptz;
