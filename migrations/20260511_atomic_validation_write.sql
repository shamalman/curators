-- Migration: atomic validation write function.
-- Wraps the three validation-flow writes (validations + comments +
-- taste_confirmations) inside a single Postgres function so the first two
-- become genuinely atomic. taste_confirmations stays best-effort (its
-- failure is caught inside the function and surfaced as a warning).
--
-- Threads upsert, thread_messages insert, earnings lookup, and email send
-- remain OUTSIDE the function. They are correctly best-effort and not
-- part of the source-of-truth write.

create or replace function create_validation_atomic(
  p_subscriber_id uuid,
  p_curator_id uuid,
  p_rec_id uuid,
  p_verbatim_text text,
  p_sent_to_curator boolean,
  p_posted_publicly boolean
)
returns table (
  validation_id uuid,
  comment_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_validation_id uuid;
  v_comment_id uuid := null;
begin
  -- 1. Insert validation (source of truth).
  insert into validations (
    subscriber_id,
    curator_id,
    rec_id,
    verbatim_text,
    sent_to_curator,
    posted_publicly
  )
  values (
    p_subscriber_id,
    p_curator_id,
    p_rec_id,
    p_verbatim_text,
    p_sent_to_curator,
    p_posted_publicly
  )
  returning id into v_validation_id;

  -- 2. Insert comment if posted_publicly. Atomic with the validation insert;
  -- a failure here rolls back the validation row.
  if p_posted_publicly then
    insert into comments (
      profile_id,
      rec_id,
      body,
      validation_id
    )
    values (
      p_subscriber_id,
      p_rec_id,
      p_verbatim_text,
      v_validation_id
    )
    returning id into v_comment_id;
  end if;

  -- 3. Best-effort taste_confirmations write. Mirrors the source pattern
  -- used by the existing route handler so retract-side append stays
  -- consistent.
  begin
    insert into taste_confirmations (
      profile_id,
      type,
      observation,
      source
    )
    values (
      p_subscriber_id,
      'validation_given',
      p_verbatim_text,
      'validation:' || v_validation_id::text
    );
  exception when others then
    raise warning '[ATOMIC_VALIDATION_RECORD_WRITE_FAILED] %', sqlerrm;
  end;

  return query select v_validation_id, v_comment_id;
end;
$$;

grant execute on function create_validation_atomic(
  uuid, uuid, uuid, text, boolean, boolean
) to authenticated;

notify pgrst, 'reload schema';
