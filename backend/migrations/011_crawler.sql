-- ============================================================================
-- 011 - Register the CPPP web-crawler as an ingestion provider
-- ============================================================================

-- The crawler scrapes the Central Public Procurement Portal's ePublishing
-- ("Latest Active Tenders") pages. It reuses the existing ingestion pipeline:
-- the same (provider_id, source_id) dedup, payload_checksum change-detection,
-- master mapping and ingestion_runs health logging as the Tenderbook feed.
--
-- A low min_expected_records keeps an empty scrape from being flagged as a
-- short pull while the crawler is first bedding in; raise it once typical
-- volumes are known.
INSERT INTO providers (id, name, type, base_url, sync_frequency_minutes, min_expected_records) VALUES
  ('cppp', 'CPPP eProcurement (crawler)', 'central_portal', 'https://eprocure.gov.in', 360, 1)
ON CONFLICT (id) DO NOTHING;
