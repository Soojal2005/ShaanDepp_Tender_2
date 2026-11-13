-- ============================================================================
-- 014 - Tender metadata enrichment from the tender PDF
-- ============================================================================
--
-- The captcha-free listings we crawl often omit money fields (estimated value,
-- EMD, tender fee). These are almost always printed in the tender's NIT PDF, so
-- a background job downloads the PDF, reads the amounts from its text layer,
-- fills the blanks on `tenders`, and discards the file. This table is the ledger
-- for that process: one row per tender.
--
-- It serves two jobs:
--   1. Idempotency — `doc_checksum` + `extractor_version` let a re-run skip a
--      document that has not changed and was already processed at this version,
--      so we never re-download or re-parse needlessly (keeps cost down).
--   2. Review queue — rows with status 'review' are amounts that parsed but
--      failed a sanity check; an admin confirms or discards them. Nothing
--      questionable is written to `tenders` automatically.

CREATE TABLE tender_enrichment (
  tender_id         bigint PRIMARY KEY REFERENCES tenders(id) ON DELETE CASCADE,
  status            text NOT NULL
                    CHECK (status IN ('filled', 'review', 'no_fields', 'no_text', 'no_doc', 'failed')),
  doc_url           text,
  doc_checksum      text,
  extractor_version int  NOT NULL DEFAULT 1,
  fields_filled     text[] NOT NULL DEFAULT '{}',
  -- Raw extraction result: per-field { rupees, unit, snippet }, the sanity
  -- decisions and any issues — enough for an admin to judge a 'review' row.
  extracted         jsonb,
  attempts          int  NOT NULL DEFAULT 0,
  error             text,
  processed_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tender_enrichment_status ON tender_enrichment (status);

-- Shared reference data, same posture as tenders / tender_documents: any
-- signed-in context may read; only privileged (system / staff) context writes.
ALTER TABLE tender_enrichment ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_enrichment FORCE ROW LEVEL SECURITY;
CREATE POLICY read_authenticated ON tender_enrichment FOR SELECT USING (is_authenticated());
CREATE POLICY write_priv ON tender_enrichment FOR ALL USING (is_privileged()) WITH CHECK (is_privileged());
