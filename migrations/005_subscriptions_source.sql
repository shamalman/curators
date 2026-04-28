ALTER TABLE subscriptions
ADD COLUMN source TEXT DEFAULT 'manual' CHECK (source IN ('invite', 'manual'));

UPDATE subscriptions SET source = 'manual' WHERE source IS NULL;

NOTIFY pgrst, 'reload schema';
