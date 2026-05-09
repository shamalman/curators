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
