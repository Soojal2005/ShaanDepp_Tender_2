-- ============================================================================
-- 016 - Per-subscriber matching inputs and a city search index
-- ============================================================================
--
-- Registration now also captures free-text "keywords" (what the business
-- supplies or does). Together with the industry captured in 013, these seed a
-- personal alert profile for the subscriber when their account is created, so
-- the daily digest and the dashboard show tenders matched to them specifically.
--
-- Additive and safe to apply while the previous release runs: every column is
-- nullable and the index is created IF NOT EXISTS, so older code paths that do
-- not write these columns keep working.

-- What the business does, captured on the registration/access-request form.
ALTER TABLE enquiries     ADD COLUMN IF NOT EXISTS keywords text;

-- Carried onto the organization and the person once the request is approved.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS keywords text;

-- The subscriber's own matching basis, used to seed and label their profile.
ALTER TABLE users         ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE users         ADD COLUMN IF NOT EXISTS keywords text;

-- The tender search and alert matcher filter on city_id (state was already
-- indexed in 001); this makes the new city filter and city-scoped counts fast.
CREATE INDEX IF NOT EXISTS idx_tenders_city ON tenders (city_id);
