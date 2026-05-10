-- Allow participants to UPDATE last_message_at on their own threads.
-- Without this, the [THREAD_TOUCH_FAILED] log fires on every reply send
-- because the messages endpoint runs the touch under user-session RLS.
-- Scope: any column on the row, but the only caller is the touch path
-- in app/api/threads/[threadId]/messages/route.js.

CREATE POLICY "Participants can update own threads"
  ON public.threads
  FOR UPDATE
  USING (
    subscriber_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = auth.uid())
    OR curator_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = auth.uid())
  )
  WITH CHECK (
    subscriber_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = auth.uid())
    OR curator_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
