-- ============================================================================
-- 012 - Corrigendum attachments get their own table
-- ============================================================================

-- Corrigendum attachments are now served through our own download proxy, the
-- same way tender_documents are, so the government portal URL is never shown to
-- the user. The attachment used to live inline on tender_corrigenda as a single
-- URL; give it a dedicated table so a corrigendum can carry several files and
-- each is fetched by its own id.
CREATE TABLE corrigendum_documents (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  corrigendum_id int NOT NULL REFERENCES tender_corrigenda(id) ON DELETE CASCADE,
  name           text NOT NULL,
  url            text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_corrigendum_docs_corr ON corrigendum_documents (corrigendum_id);

-- Shared reference data: any signed-in context reads, only privileged writes
-- (matching tenders / tender_documents).
ALTER TABLE corrigendum_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrigendum_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY read_authenticated ON corrigendum_documents FOR SELECT USING (is_authenticated());
CREATE POLICY write_priv ON corrigendum_documents FOR ALL USING (is_privileged()) WITH CHECK (is_privileged());

-- Nothing has populated the inline attachment URL yet, and attachments now live
-- in their own table, so remove the now-unused column.
ALTER TABLE tender_corrigenda DROP COLUMN attachment_url;
