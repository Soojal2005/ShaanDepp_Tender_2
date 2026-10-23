-- Supabase's publishable key runs as anon. Make only synthetic sample tenders
-- readable over its Data API; tenant-owned and real feed data stay protected.
-- Plain PostgreSQL / PGlite installations do not have Supabase's anon role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT USAGE ON SCHEMA public TO anon;
    GRANT SELECT ON tenders TO anon;
    CREATE POLICY sample_tenders_public ON tenders FOR SELECT TO anon
      USING (provider_id = 'sample');
  END IF;
END $$;
