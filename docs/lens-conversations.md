# Lens Conversations

`/myai` is moving from one lifetime chat log to real Lens conversations.

## Model

- Conversation = short-term working memory for the current Lens discussion.
- Record, recommendations, saves, subscriptions, and confirmed Reads = long-term curator memory.
- Pills = session-start affordances that help start useful Lens conversations.
- Lifetime chat history is not default AI memory.

User-facing copy says "conversation". Code may use "session" only for the UI lifecycle around freshness, pill selection, and canvas state.

## Schema

`lens_conversations` stores one row per Lens conversation:

- `profile_id` owns the conversation.
- `title` is nullable in V1.
- `status` is `active` or `archived`.
- `source = 'legacy_backfill'` marks the backfilled legacy conversation.
- `message_count`, `last_message_at`, and `updated_at` support History and active conversation lookup.
- `meta` is reserved for future session/pill details.

`chat_messages.conversation_id` links messages to a conversation. It remains nullable during migration so legacy rows and rollback are safe. New flagged Lens messages should always write it.

## V1 Behavior

The feature flag is `profiles.feature_flags.lens_conversations_v1`.

When the flag is enabled:

1. Returning within 6 hours resumes the active conversation.
2. Returning after 6 hours opens the clean Lens canvas.
3. `History` is always visible.
4. `New conversation` appears after at least one user message is sent.
5. The clean canvas shows 3 state-aware pills and the composer.
6. Pills disappear once the curator types or sends a message.
7. Feedback remains visible in canvas, conversation, and read-only history states.
8. Quick Capture is hidden on the clean canvas and visible during active conversations.

Initial rollout is `@shamal` and `@chris`, then tester profiles, then broader rollout after production verification.

## Pill States

State is computed at session start and does not change mid-session.

- Empty: zero recommendations and zero prior Lens chat messages.
- Active: at least one recommendation and activity in the last 14 days.
- Lapsed: has recommendations and no activity in 14 or more days.

The Empty `+ Recommendation` pill is locked, copper-accented, and always present. Its first tap starts a conversation with onboarding copy instead of opening `QuickCaptureSheet`; subsequent taps open `QuickCaptureSheet`.

No user-facing copy, prompt text, or AI output should contain em dashes.

## Implementation Notes

`app/api/chat/route.js` must scope server-side history fetches, recent `rec_refs` lookup, parsed-content persistence, image meta persistence, and chat-parse `rec_refs` updates by `conversation_id` when `lens_conversations_v1` is enabled. A clean-looking UI is not enough if the server still reads old lifetime messages.

The existing `threads` and `thread_messages` tables are subscriber messaging infrastructure, not Lens AI conversations.
