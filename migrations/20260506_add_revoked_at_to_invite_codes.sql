-- Adds soft-revoke support for pending invite codes.
-- A pending code is now: used_at IS NULL AND revoked_at IS NULL.
-- Revoking is non-destructive so we keep the audit trail of what was issued.

ALTER TABLE invite_codes
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

NOTIFY pgrst, 'reload schema';
