-- Lens conversations foundation.
-- Moves Lens chat toward real conversation threads while preserving the
-- existing chat_messages table and legacy history.

CREATE TABLE IF NOT EXISTS public.lens_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text,
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL DEFAULT 'lens',
  message_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT lens_conversations_status_check CHECK (status IN ('active', 'archived'))
);

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.lens_conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS lens_conversations_profile_last_idx
  ON public.lens_conversations(profile_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS lens_conversations_profile_status_last_idx
  ON public.lens_conversations(profile_id, status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_idx
  ON public.chat_messages(conversation_id, created_at);

ALTER TABLE public.lens_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lens conversation owners can read" ON public.lens_conversations;
CREATE POLICY "Lens conversation owners can read"
  ON public.lens_conversations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = lens_conversations.profile_id
        AND p.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Lens conversation owners can create" ON public.lens_conversations;
CREATE POLICY "Lens conversation owners can create"
  ON public.lens_conversations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = lens_conversations.profile_id
        AND p.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Lens conversation owners can update" ON public.lens_conversations;
CREATE POLICY "Lens conversation owners can update"
  ON public.lens_conversations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = lens_conversations.profile_id
        AND p.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = lens_conversations.profile_id
        AND p.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Lens message owners can read" ON public.chat_messages;
CREATE POLICY "Lens message owners can read"
  ON public.chat_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = chat_messages.profile_id
        AND p.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Lens message owners can create" ON public.chat_messages;
CREATE POLICY "Lens message owners can create"
  ON public.chat_messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = chat_messages.profile_id
        AND p.auth_user_id = auth.uid()
    )
  );

WITH message_profiles AS (
  SELECT
    profile_id,
    min(created_at) AS first_message_at,
    max(created_at) AS last_message_at,
    count(*)::integer AS message_count
  FROM public.chat_messages
  WHERE conversation_id IS NULL
  GROUP BY profile_id
),
inserted AS (
  INSERT INTO public.lens_conversations (
    profile_id,
    title,
    status,
    source,
    message_count,
    created_at,
    last_message_at,
    updated_at,
    meta
  )
  SELECT
    mp.profile_id,
    'Legacy Lens history',
    'active',
    'legacy_backfill',
    mp.message_count,
    COALESCE(mp.first_message_at, now()),
    COALESCE(mp.last_message_at, now()),
    now(),
    jsonb_build_object('backfilled', true, 'backfilled_at', now())
  FROM message_profiles mp
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.lens_conversations lc
    WHERE lc.profile_id = mp.profile_id
      AND lc.source = 'legacy_backfill'
  )
  RETURNING id, profile_id
),
legacy_conversations AS (
  SELECT id, profile_id FROM inserted
  UNION ALL
  SELECT lc.id, lc.profile_id
  FROM public.lens_conversations lc
  JOIN message_profiles mp ON mp.profile_id = lc.profile_id
  WHERE lc.source = 'legacy_backfill'
)
UPDATE public.chat_messages cm
SET conversation_id = lc.id
FROM legacy_conversations lc
WHERE cm.profile_id = lc.profile_id
  AND cm.conversation_id IS NULL;

NOTIFY pgrst, 'reload schema';
