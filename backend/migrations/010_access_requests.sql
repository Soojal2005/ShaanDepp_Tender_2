-- Portal access requests. A request from the website's "Request access" page is an
-- enquiry of a different kind: staff turn it into an organization and invite its
-- first administrator, and the enquiry then points at that organization.
--
-- Additive and safe to apply while the previous release is running: new columns
-- have defaults, so old API instances keep inserting enquiries as 'general'.

ALTER TABLE enquiries
  ADD COLUMN kind            text NOT NULL DEFAULT 'general' CHECK (kind IN ('general', 'access_request')),
  ADD COLUMN organization_id int REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN converted_at    timestamptz;

-- 'Converted' is set by the system when an organization is created from the enquiry.
ALTER TABLE enquiries DROP CONSTRAINT enquiries_status_check;
ALTER TABLE enquiries ADD CONSTRAINT enquiries_status_check
  CHECK (status IN ('New', 'Contacted', 'Qualified', 'Converted', 'Closed'));

-- Requests made before this migration were tagged only by their service label.
UPDATE enquiries SET kind = 'access_request' WHERE service = 'Portal access request';

CREATE INDEX idx_enquiries_kind_status ON enquiries (kind, status, created_at DESC);
CREATE INDEX idx_enquiries_organization ON enquiries (organization_id);
