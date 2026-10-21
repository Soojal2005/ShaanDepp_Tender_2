-- ============================================================================
-- 006 - Indexes for results search and bidder analysis
-- ============================================================================
CREATE INDEX idx_awards_category   ON historical_awards (category_id);
CREATE INDEX idx_awards_state      ON historical_awards (state_id);
CREATE INDEX idx_awards_dept_date  ON historical_awards (department_id, award_date DESC);
CREATE INDEX idx_awards_winner_ci  ON historical_awards (lower(winner_name));
CREATE INDEX idx_award_bidders_ci  ON award_bidders (lower(btrim(bidder_name)));
