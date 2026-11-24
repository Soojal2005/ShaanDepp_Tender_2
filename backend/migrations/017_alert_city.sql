-- 017 - City as an alert-profile dimension
-- Subscribers register with a city; this lets their per-user alert profile narrow
-- the emailed matches to that city, exactly as state_ids already narrows by state.
-- An empty array means "no city restriction" (the default), so existing profiles
-- are unaffected. The tender side (tenders.city_id) was indexed in migration 016.
ALTER TABLE alert_profiles ADD COLUMN IF NOT EXISTS city_ids int[] NOT NULL DEFAULT '{}';
