# Payouts System — Implementation Tracking

Progress log for the staged payouts rollout. CLAUDE.md carries the canonical short-form summary; this file is the longer change log + open-question list. Append-only.

---

## Phase 1 — Validation capture (shipped 2026-05-08)

**Threads completed**: Thread 1.

**Tables**:
- `validations` — money-attached, one per `(subscriber_id, rec_id)`, soft-delete via `retracted_at`. RLS: subscriber-write, both participants read. No DELETE policy.
- `comments` — shared substrate for validation-comments and future standalone comments. World-read filtered by `deleted_at IS NULL AND hidden_by_curator_at IS NULL`. No DELETE policy.

**Endpoint**: `POST /api/validations`. Three-write sequence (validation → comment if posted_publicly → taste_confirmations best-effort). Writes 2 and 3 log on failure but do not fail the request.

**UI**: `components/payouts/ValidationSheet.jsx` (bottom-sheet copy of FeedbackSheet). Validate button on NetworkRecDetail and VisitorRecDetail. Hidden on CuratorRecDetail.

**Feature flags gating Phase 1**: `payout_validation` AND `is_tester=true`.

**Migration**: `migrations/006_validations_and_comments.sql`.

---

## Phase 2 — Threads/messages substrate + validation email (shipped 2026-05-09)

**Threads completed**: Thread 2.

**Tables added** (migration `007_threads_and_messages.sql`):
- `threads` — one row per `(subscriber_id, curator_id)` pair (UNIQUE constraint), `last_message_at` for ordering, CHECK `subscriber_id <> curator_id`. RLS: both participants SELECT; INSERT requires caller is a participant. No UPDATE policy.
- `thread_messages` — FK to `threads(id)` + `profiles(id)` for `sender_id`, optional `validation_id` link to `validations(id)` ON DELETE SET NULL. RLS: SELECT and INSERT gated by parent thread participant membership.

**Endpoints**:
- `app/api/validations/route.js` updated: replaces `[VALIDATION_THREAD_PENDING]` log with thread upsert + message insert + email send. Find-or-create thread via `.upsert({...}, { onConflict: 'subscriber_id,curator_id' })`. Single round trip, atomic.
- `app/api/threads/[threadId]/messages/route.js` (new): `POST` endpoint for Thread 4's reply UI. Anon-key + cookies auth via `@supabase/ssr`, participant double-check (explicit + RLS), `payout_threads` gate.

**Email**:
- Helper: `lib/email/sendValidationReceivedEmail.js`. Mirrors `sendNewSubscriberEmail.js` shape exactly (imports `{ resend }` from `@/lib/resend`, positional `generateEmailToken(profileId, action, payload)`, writes `notification_log`, never throws, returns `{ ok, sent | skipped, error?, detail? }`).
- Template: `validationReceivedEmail` in `lib/email-templates.js`. Uses existing `emailShell({ title, preheader, innerHtml })` + `emailFooter` design system. Subject locked to `@{subscriberHandle} said this landed`.
- Curator email sourced via `supabase.auth.admin.getUserById(auth_user_id)`. The `profiles.email` column does not exist; do not attempt to read it.
- Reply CTA URL: `https://curators.ai/{curatorHandle}/{recSlug}`. The codebase has no `/recs/[id]` route; rec URLs are `/<handle>/<slug>` (`app/[handle]/[slug]/page.js`). Forward-compat to `/subs?segment=messages&thread={id}` deferred to Thread 4.

**Feature flags introduced**:
- `payout_threads` — subscriber-side, gates thread substrate writes from the validation flow AND the `/api/threads/[threadId]/messages` reply endpoint.
- `payout_email` — curator-side, gates the email send (checked inside the helper). Both flags are set manually via SQL by Shamal; no code path enables them.

**Migration run**: deferred — Shamal runs SQL manually in Supabase SQL Editor.

**Log markers**:
- `[VALIDATION_THREAD_WRITE_FAILED]` — non-fatal thread upsert / message insert failure.
- `[VALIDATION_EMAIL_FAILED]` — non-fatal email send failure (after helper returned `ok: false` with no `skipped`).
- `[THREAD_MESSAGE_INSERT_ERROR]` — fatal insert failure in the reply endpoint (returns 500).
- `[THREAD_TOUCH_FAILED]` — `last_message_at` UPDATE blocked (expected; see open question below).

**Decisions captured during recon (locked)**:
1. Migration filename `007_threads_and_messages.sql` (numeric series matching `006_…`).
2. Reply CTA URL: `/<handle>/<slug>` not `/recs/{id}`. The latter does not exist as a route; the former is already used by `newRecEmail`.
3. No shared `sendEmail` helper exists. Each call site invokes `resend.emails.send` directly. Pattern model: `lib/email/sendNewSubscriberEmail.js`.
4. Greeting `Hi @{curator_handle},` — `profiles.first_name` does not exist; no fallback logic.
5. Thread find-or-create via single upsert with `onConflict: 'subscriber_id,curator_id'`.

---

## Open follow-ups

| Item | Owner thread | Note |
|---|---|---|
| Threads UPDATE RLS — `last_message_at` touch fails silently from user session in `POST /api/threads/[threadId]/messages` | Thread 4 | Either add a participant-scoped UPDATE policy that only allows `last_message_at` modification, or move the touch to service-role inside the route. |
| Messages segment in Subs (and `useSearchParams` wiring) | Thread 4 | `SubsView.jsx` currently has only `subscriptions`/`subscribers` tabs and reads no query params. Email reply links land on the rec page until this ships. |
| Allocation segment in Subs | Thread 5+ | |
| Allocation calculator | Thread 5+ | |
| Earnings surface | Thread 5+ | |
| Lens monthly prompt | Future | |
| `VisitorContext` does not expose `feature_flags` | Thread 4 (if needed) | If any visitor-side UI gates on a flag, `context/VisitorContext.jsx` must be extended. `CuratorContext` already maps `feature_flags → featureFlags`. |
| Migration naming inconsistency | Backlog | `migrations/` mixes `NNN_…` and `YYYYMMDD_…` schemes. Lex order interleaves them. Not a Phase 2 blocker. |

---

## Open follow-ups

### Per-notification-type unsubscribe (deferred to dedicated thread)

Status: NOT STARTED. Tracked for a future thread, not blocked on Thread 4.

Today, the validation email footer has a "Manage notifications" link that points to /api/email-action with action=unsubscribe and metadata { type: 'validation_received_email' }. The endpoint exists but does not write granular preferences yet. Footer link is currently a soft 404 for testers. Acceptable in alpha; not acceptable post-launch.

When this thread happens:

1. Add notification_prefs jsonb column to profiles. Default {} (treated as all-enabled by helper logic). Shape:

   {
     "validation_received_email": true,
     "new_subscriber_email": true,
     "new_rec_email": true,
     "weekly_digest_email": true
   }

2. Update each email helper to check the relevant key. If notification_prefs.<key> === false, return { ok: true, skipped: 'pref_disabled' }. Feature flag check stays — both gates apply.

3. Update /api/email-action endpoint to honor action=unsubscribe&type=<email_type> by writing notification_prefs[type] = false via service-role client.

4. Add /settings/notifications page UI with a toggle per email type. Reads from notification_prefs, writes via authenticated PATCH.

5. Treat missing keys as true in helper checks — no migration backfill needed for existing profiles.

Why deferred: Thread 2's helper already gates on payout_email feature flag, so testers can be silenced via flag flip if needed. Per-type granularity is a public-launch requirement, not an alpha requirement. Keeping Thread 4 focused on Messages segment + reply UI.

Touchpoints when work begins: lib/email/sendValidationReceivedEmail.js, lib/email/sendNewSubscriberEmail.js, app/api/email-action/route.js, new app/settings/notifications/page.jsx, profiles migration.

## Thread 4 — Shipped

Commits:
- 9200379 — backend (retract endpoint, comment endpoints, threads UPDATE policy, email URL)
- 8b5a848 — UI (Messages segment, MessagesList, ThreadDetail, RecDetail muted state with retract flow)
- 2554a83 — Suspense wrapper for /subs page

SQL applied manually:
- threads UPDATE policy (migrations/008_threads_update_policy.sql)
- payout_messages_ui flag set on @shamal, @chris, @testmctesty

Decisions made:
- Used profileId from useCurator() not profile.id (profile object has no id field)
- Used shared lib/supabase.js client not per-component createBrowserClient
- Two-step queries throughout (threads → profiles → messages, no joins)
- Convention kept: viewer's messages right, other participant's left
- Day dividers in thread detail (Today / Yesterday / weekday / dated)
- Refetch after send vs optimistic — alpha volume fine
- Retract button gated on existingThreadId being set (only sent_to_curator=true validations have a retract path in UI)

Follow-ups for Thread 7:
- Read receipts / unread persistence (no read_at column yet)
- Comment three-dot menu UI on rec detail (endpoints shipped, UI deferred)
- LockManager auth context fix
- Atomic dual-write Postgres function for validation flow
