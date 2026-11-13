-- ============================================================================
-- 013 - Capture the company's identity at registration
-- ============================================================================

-- Registration is an access request made "as a company": the form now collects
-- the company's identity (GSTIN, address, industry) alongside the person's name,
-- email and phone, instead of staff filling those in later at conversion.
--
-- Additive and safe to apply while the previous release runs: every column is
-- nullable, so general enquiries and older API instances leave them empty.
ALTER TABLE enquiries
  ADD COLUMN gstin    text,
  ADD COLUMN address  text,
  ADD COLUMN city     text,
  ADD COLUMN state    text,
  ADD COLUMN industry text;

-- The organization carries the same identity once the request is approved.
-- (gstin already exists on organizations.)
ALTER TABLE organizations
  ADD COLUMN address  text,
  ADD COLUMN city     text,
  ADD COLUMN state    text,
  ADD COLUMN industry text;
