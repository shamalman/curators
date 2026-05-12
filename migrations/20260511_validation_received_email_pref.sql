-- Per-type opt-out for validation-received emails.
-- Parallel shape to weekly_digest_enabled, new_subscriber_email_enabled,
-- and new_rec_email_enabled. Default true so existing users keep
-- receiving validation-received notifications.

alter table profiles
  add column if not exists validation_received_email_enabled boolean
  default true;

-- Backfill any nulls defensively. The default should already cover all
-- existing rows; this is belt-and-suspenders for the rare case of a
-- prior partial-rollout state.
update profiles
  set validation_received_email_enabled = true
  where validation_received_email_enabled is null;

notify pgrst, 'reload schema';
