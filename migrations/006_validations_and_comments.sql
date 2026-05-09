-- Validations: a subscriber's verbatim affirmation that a curator's rec landed.
-- Money-attached. One per (subscriber, rec) pair, ever. Soft-deletable via retracted_at.

CREATE TABLE IF NOT EXISTS validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  curator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rec_id UUID NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  verbatim_text TEXT NOT NULL,
  sent_to_curator BOOLEAN NOT NULL DEFAULT true,
  posted_publicly BOOLEAN NOT NULL DEFAULT true,
  retracted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS validations_subscriber_rec_unique
  ON validations (subscriber_id, rec_id);

CREATE INDEX IF NOT EXISTS validations_curator_idx ON validations (curator_id);
CREATE INDEX IF NOT EXISTS validations_rec_idx ON validations (rec_id);

ALTER TABLE validations ENABLE ROW LEVEL SECURITY;

-- Subscriber can read their own validations.
CREATE POLICY "Subscribers can read own validations"
  ON validations FOR SELECT
  USING (subscriber_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid()));

-- Curator can read validations against their own recs.
CREATE POLICY "Curators can read validations on their recs"
  ON validations FOR SELECT
  USING (curator_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid()));

-- Subscriber can insert own validations.
CREATE POLICY "Subscribers can create own validations"
  ON validations FOR INSERT
  WITH CHECK (subscriber_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid()));

-- Subscriber can update own validations (for retraction).
CREATE POLICY "Subscribers can update own validations"
  ON validations FOR UPDATE
  USING (subscriber_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid()));

-- No DELETE policy. Hard deletes blocked by RLS.

-- Comments: shared table for validation-comments and future standalone comments.
-- profile_id = the commenter. validation_id is optional FK to validations.

CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rec_id UUID NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  validation_id UUID REFERENCES validations(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  hidden_by_curator_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_rec_idx ON comments (rec_id);
CREATE INDEX IF NOT EXISTS comments_profile_idx ON comments (profile_id);
CREATE INDEX IF NOT EXISTS comments_validation_idx ON comments (validation_id);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read non-deleted, non-hidden comments.
CREATE POLICY "Anyone can read visible comments"
  ON comments FOR SELECT
  USING (deleted_at IS NULL AND hidden_by_curator_at IS NULL);

-- Commenter can always read their own comments, even if hidden by curator.
CREATE POLICY "Commenters can read own comments"
  ON comments FOR SELECT
  USING (profile_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid()));

-- Commenter can insert own comments.
CREATE POLICY "Users can create own comments"
  ON comments FOR INSERT
  WITH CHECK (profile_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid()));

-- Commenter can update own comments (edit, soft-delete via deleted_at).
CREATE POLICY "Users can update own comments"
  ON comments FOR UPDATE
  USING (profile_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid()));

-- No DELETE policy. Hard deletes blocked by RLS.
-- Curator hide-on-rec is exposed via /api/comments/:id/hide endpoint (Thread 4),
-- which uses service-role to write hidden_by_curator_at after auth check.

NOTIFY pgrst, 'reload schema';
