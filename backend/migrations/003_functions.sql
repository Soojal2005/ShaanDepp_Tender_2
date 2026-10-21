-- ============================================================================
-- 003 - Search vectors and housekeeping triggers
-- ============================================================================

-- Keep the three full-text vectors in step with the tender row. The 'simple'
-- configuration is used on purpose: tender text is full of codes, proper nouns
-- and Hindi, where English stemming would only get in the way. Partial words
-- are handled by prefix queries ("meter:*") built in the search service.
CREATE FUNCTION tenders_tsv_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.title_tsv := to_tsvector('simple', coalesce(NEW.title, ''));
  NEW.desc_tsv  := to_tsvector('simple',
                     coalesce(NEW.description, '') || ' ' ||
                     coalesce(NEW.department, '')  || ' ' ||
                     coalesce(NEW.category, ''));
  NEW.boq_tsv   := to_tsvector('simple', coalesce(NEW.boq_text, ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenders_tsv
  BEFORE INSERT OR UPDATE OF title, description, department, category, boq_text ON tenders
  FOR EACH ROW EXECUTE FUNCTION tenders_tsv_update();

CREATE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations', 'users', 'tenders', 'alert_profiles',
    'submission_cases', 'email_queue', 'case_internal', 'case_emd_tracking'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_touch BEFORE UPDATE ON %1$I
         FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
  END LOOP;
END $$;
