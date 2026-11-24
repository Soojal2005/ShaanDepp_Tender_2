-- 019 - Per-subscriber preferred tender value range
-- Lets a subscriber say which price band of tenders they care about; the dashboard
-- uses it to filter the "for you" sections. NULL on either side means "no bound".
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pref_value_min numeric(18,2),
  ADD COLUMN IF NOT EXISTS pref_value_max numeric(18,2);
