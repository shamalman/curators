-- 007_threads_and_messages.sql
-- Threads/messages substrate. Per-person threading: one thread per (subscriber_id, curator_id) pair.
-- Validation messages append to the thread; future DMs and paid curation tasks reuse the same substrate.

-- threads table
CREATE TABLE IF NOT EXISTS public.threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  curator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT threads_unique_pair UNIQUE (subscriber_id, curator_id),
  CONSTRAINT threads_distinct_participants CHECK (subscriber_id <> curator_id)
);

CREATE INDEX IF NOT EXISTS threads_subscriber_idx ON public.threads(subscriber_id);
CREATE INDEX IF NOT EXISTS threads_curator_idx ON public.threads(curator_id);
CREATE INDEX IF NOT EXISTS threads_last_message_at_idx ON public.threads(last_message_at DESC);

-- thread_messages table
CREATE TABLE IF NOT EXISTS public.thread_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  validation_id uuid REFERENCES public.validations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS thread_messages_thread_created_idx ON public.thread_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS thread_messages_sender_idx ON public.thread_messages(sender_id);

-- RLS
ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_messages ENABLE ROW LEVEL SECURITY;

-- threads: both participants can SELECT
CREATE POLICY "Participants can read own threads"
  ON public.threads
  FOR SELECT
  USING (
    subscriber_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = auth.uid())
    OR curator_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = auth.uid())
  );

-- threads: INSERT requires auth.uid() to be one of the participants
CREATE POLICY "Participants can create threads"
  ON public.threads
  FOR INSERT
  WITH CHECK (
    subscriber_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = auth.uid())
    OR curator_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = auth.uid())
  );

-- thread_messages: SELECT if auth.uid() is one of the parent thread's participants
CREATE POLICY "Participants can read messages in own threads"
  ON public.thread_messages
  FOR SELECT
  USING (
    thread_id IN (
      SELECT t.id FROM public.threads t
      WHERE t.subscriber_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = auth.uid())
         OR t.curator_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = auth.uid())
    )
  );

-- thread_messages: INSERT requires sender_id = caller's profile AND caller is a participant of the parent thread
CREATE POLICY "Participants can send messages in own threads"
  ON public.thread_messages
  FOR INSERT
  WITH CHECK (
    sender_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = auth.uid())
    AND thread_id IN (
      SELECT t.id FROM public.threads t
      WHERE t.subscriber_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = auth.uid())
         OR t.curator_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';
