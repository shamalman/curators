# Payouts System

Phase A substrate for the Curators.AI payouts model. Covers the validation flow, threads/messages substrate, the allocation calculator and earnings surface, feature flag inventory, and pending follow-ups. Production-staged behind `is_tester=true` plus per-feature flags on `@shamal`, `@chris`, and `@testmctesty` as of May 2026.

Source of truth for table shapes: `docs/schema.md`. Source of truth for column types and RLS policies: the migration files in `migrations/`.

---

## Phase 1 (Thread 1, shipped 2026-05-08)

Validation capture core lives behind feature flag `payout_validation` AND `is_tester=true`.

Tables: `validations` (money-attached, one per subscriber+rec), `comments` (shared, includes validation-comments). RLS enabled with subscriber-write / curator-read split on validations; world-read on comments filtered by `deleted_at IS NULL AND hidden_by_curator_at IS NULL`.

Endpoint: `POST /api/validations`. As of Thread 7, the validation + comment writes are wrapped in an atomic Postgres function (`create_validation_atomic`, migration `20260511_atomic_validation_write.sql`); a comment-insert failure rolls back the validation row. `taste_confirmations` write stays best-effort inside the function and raises a server-side warning with prefix `[ATOMIC_VALIDATION_RECORD_WRITE_FAILED]` on failure. Thread message write, earnings lookup, and email send remain outside the atomic boundary.

UI: `components/payouts/ValidationSheet.jsx` (bottom-sheet pattern via shared `components/ui/Sheet.jsx` primitive as of Thread 7). Validate button renders on NetworkRecDetail and VisitorRecDetail. Hidden on CuratorRecDetail (own rec).

Feature flag helper: `hasFeature(profile, flagName)` in `lib/features.js`. Takes already-loaded profile, no DB roundtrip. `isFeatureEnabled(supabase, profileId, flagName)` is the server-side variant with a DB lookup.

## Phase 2 (Thread 2, shipped 2026-05-09)

Threads/messages substrate live + validation email.

- Tables (migration `007_threads_and_messages.sql`): `threads` (one per `(subscriber_id, curator_id)` pair, unique constraint, `last_message_at` for ordering, CHECK distinct participants) and `thread_messages` (FK to thread + sender, optional `validation_id` link). RLS enabled. Both participants can SELECT; INSERT requires caller is a participant. UPDATE policy for participants added in migration `008_threads_update_policy.sql` (Thread 4).
- Validation flow writes a thread message when `sent_to_curator=true` AND subscriber has feature flag `payout_threads`. Atomic find-or-create via `upsert ... onConflict: 'subscriber_id,curator_id'`. Failures logged as `[VALIDATION_THREAD_WRITE_FAILED]`, non-fatal.
- Validation email sent to curator when curator has feature flag `payout_email`. Helper: `lib/email/sendValidationReceivedEmail.js` (mirrors `sendNewSubscriberEmail.js` shape; never throws; returns `{ ok, sent | skipped, error?, detail? }`). Template: `validationReceivedEmail` in `lib/email-templates.js`. Curator email sourced via `supabase.auth.admin.getUserById(auth_user_id)`, NOT `profiles.email` (column does not exist). Reply CTA links to `/<curatorHandle>/<recSlug>`; no `/recs/[id]` route exists. Failures logged as `[VALIDATION_EMAIL_FAILED]`, non-fatal.
- Endpoint: `POST /api/threads/[threadId]/messages`. Auth-gated (anon-key + cookies via `@supabase/ssr`), participant-checked, gated by sender's `payout_threads`. Body: `{ body }`. RLS double-enforces participant check.
- Flags: `payout_threads` (subscriber-side, gates substrate writes + reply endpoint) and `payout_email` (curator-side, gates email send).

## Phase 3 (Thread 4, shipped 2026-05-09)

Messages segment + retract flow + comment endpoints.

- Messages segment in `/subs?segment=messages` gated on `isTester` AND `payout_messages_ui` flag. URL routing via `useSearchParams` (`segment` + `thread` query params). `components/messages/MessagesList.jsx` lists threads sorted by `last_message_at desc`; `components/messages/ThreadDetail.jsx` renders messages with day dividers, validation rec cards, retracted state, and reply input. Page wrapped in `Suspense` for `useSearchParams` build compat.
- Validation retraction: `POST /api/validations/[id]/retract`. Source of truth is `validations.retracted_at`. Cascades: soft-delete linked comment (best-effort, logged `[VALIDATION_RETRACT_CASCADE_FAILED] comment_soft_delete`) and append `taste_confirmations` row with `type='validation_retracted'` (best-effort, same marker). Existing-validation fetches in RecDetail no longer filter `retracted_at IS NULL` so the muted state can render the retracted copy.
- Comment endpoints: `PATCH /api/comments/[id]` (24h edit window, owner-only), `DELETE /api/comments/[id]` (soft-delete via `deleted_at`, owner-only), `POST/DELETE /api/comments/[id]/hide` (curator-only via service-role + rec ownership check, writes `hidden_by_curator_at`). Endpoints shipped; rec-detail three-dot menu UI deferred.
- `threads` UPDATE RLS policy applied (`migrations/008_threads_update_policy.sql`). Participants can now touch `last_message_at` from the user-session route; `[THREAD_TOUCH_FAILED]` should no longer fire on normal sends.
- Email reply CTA from `validationReceivedEmail` points to `/subs?segment=messages&thread={id}` when threadId is available; falls back to `/<curatorHandle>/<recSlug>` if not. `/api/validations` returns `thread_id` in the response.
- Flag introduced: `payout_messages_ui` (curator-side, gates Messages segment in `/subs`).

## Phase 4 (Thread 5, shipped 2026-05-09)

Allocation segment in Subs (view-only, originally mocked numbers; superseded by Phase 5).

- Fourth segment in `/subs`, gated on `isTester` + `payout_allocation_ui` flag (server + client).
- Endpoint: `GET /api/allocation/preview`. Auth-gated, server-side feature-gated via `isFeatureEnabled`.
- Components: `components/payouts/AllocationView.jsx`, `components/payouts/AllocationHeroBar.jsx`.
- Activity weights: validation=3, save=1. Last row absorbs rounding remainder. Floor splits evenly across active curators (recommended in last 30d).
- Flag enabled on @shamal, @chris, @testmctesty.
- Feature flag column on `profiles` is `feature_flags` (jsonb). Server reads via `lib/features.isFeatureEnabled`.
- Avatars: forward-looking helper at `lib/profile-avatar.js` (Thread 7). All current testers are email signups with no OAuth metadata; the helper returns null and the UI initial-bubble fallback continues to render. TODO comments at the three calc/preview sites mark the bulk auth lookup follow-up.

## Phase 5 (Thread 3, shipped 2026-05-11)

Real allocation math + curator earnings surface.

- Pure logic in `lib/allocation/calculate.js` and `lib/allocation/calculate-earnings.js`. Internal currency is hundredths of cents (1 unit = $0.0001) to keep tier-base allocations (60/25/15 of $10.50) as clean integers (63000/26250/15750). Cascade is strictly downward: empty validation tier rolls into save; empty save rolls into floor; empty floor rolls into unallocated. Within-tier remainder absorbed by highest-count curator (alphabetical handle tiebreak); floor remainder absorbed alphabetically-first.
- Dual-path on `/api/allocation/preview`: `payout_allocation_ui` remains the access gate. `payout_real_math` selects the new calculator (`is_projected: false`) vs the Thread 5 mock. The two flags are independently togglable on purpose.
- New endpoint `/api/earnings/preview`: cookie-session auth + `payout_earnings_ui` gate (403 if disabled). Calls `calculateMonthlyEarnings(curatorId=viewer)`.
- Validation email carries a current-month earnings line: `/api/validations` runs `calculateMonthlyEarnings` for the curator between thread-message write and email send, wrapped in try/catch. Failure logs `[VALIDATION_EARNINGS_LOOKUP_FAILED]` and passes `curatorEarnings: null` through; email still sends, line is omitted. Template renders the line between Reply CTA and footer only when `parseFloat(curatorEarnings) > 0`.
- UI: `components/payouts/EarningsView.jsx` + `EarningsHero.jsx`. New `/me/earnings` page. `MeSegmentedControl` adds a conditional 4th option in the LAST position (after Public Profile), gated on `isTester && hasFeature(profile, 'payout_earnings_ui')`. Layout's `active` derivation handles `pathname.startsWith('/me/earnings')`.
- Signal summary for floor-only contributors (no validations/saves) reads `subscribed` in the FROM YOUR SUBSCRIBERS list. Honest description for floor-tier earnings.
- Flags introduced: `payout_real_math` (subscriber-side, calculator selector), `payout_earnings_ui` (curator-side, gates `/me/earnings` segment and `/api/earnings/preview`). Both set manually via SQL.

## Phase 6 (Thread 7, shipped 2026-05-11)

Hardening pass: deletions, gating, atomicity, UI primitives, utility extractions, and forward-looking infrastructure.

- Removed the Thread 3 reconciliation scaffolding (`app/api/verify-thread3/allocation/route.js`, `scripts/verify-allocation.mjs`).
- Ungated the Retract button in RecDetail's Validated muted-state modal so subscribers who validated with `sent_to_curator=false` (no thread created) can still retract. Affects both `VisitorRecDetail` and `NetworkRecDetail`.
- Server-side `isFeatureEnabled` gating on the five Thread 4 endpoints that were client-gated only (retract, comment PATCH/DELETE, comment hide POST/DELETE). All five now check `payout_validation` after the auth + profile lookup. `POST /api/threads/[threadId]/messages` already gated via `hasFeature`.
- Atomic dual-write Postgres function `create_validation_atomic` (migration `20260511_atomic_validation_write.sql`). Wraps `validations` and `comments` inserts in a single transaction; `taste_confirmations` stays best-effort inside the function and raises a warning on failure. Threads upsert, thread_messages insert, earnings lookup, and email send remain outside.
- Extracted `components/ui/Sheet.jsx` primitive from `FeedbackSheet`, `QuickCaptureSheet`, and `ValidationSheet`. zIndex reconciled to 999/1000 across all three.
- Extracted `lib/format-time.js` and `lib/format-money.js`. Existing call sites use named-as aliases so behavior is byte-identical.
- Added `lib/profile-avatar.js` (forward-looking; current testers all email signups).
- Per-type opt-out: `validation_received_email_enabled` column (migration `20260511_validation_received_email_pref.sql`) joins the existing `weekly_digest_enabled` / `new_subscriber_email_enabled` / `new_rec_email_enabled` pattern. Settings UI exposes a fourth toggle; email helper short-circuits with `reason='pref_disabled'` when explicit false; email-action route handles `type='validation_received_email'` in both GET and POST unsubscribe paths.

## Feature flag inventory

All set manually via SQL on `profiles.feature_flags` (jsonb).

| Flag | Side | Effect |
|---|---|---|
| `payout_validation` | subscriber + curator | Gates the validation flow end-to-end. Required for: ValidationSheet visibility, POST /api/validations, retract endpoint, comment PATCH/DELETE/hide endpoints. |
| `payout_threads` | subscriber | Gates thread substrate writes and the reply endpoint. |
| `payout_email` | curator | Gates the validation-received email send (in addition to `validation_received_email_enabled`). |
| `payout_messages_ui` | curator | Gates the Messages segment in /subs. |
| `payout_allocation_ui` | subscriber | Gates the Allocation segment in /subs and access to /api/allocation/preview. |
| `payout_real_math` | subscriber | On /api/allocation/preview, selects the real calculator vs the Thread 5 mock. Independent of `payout_allocation_ui`. |
| `payout_earnings_ui` | curator | Gates /me/earnings segment and /api/earnings/preview. |

## Pending (Thread 8+)

- Auth context consolidation (LockManager band-aids in RecDetail.jsx). VisitorContext currently treats `profile` as the page subject not the viewer, which makes the existing setTimeout workarounds nontrivial to remove. Deferred to a dedicated post-evaluation thread.
- Comment three-dot menu UI on rec detail. Comment endpoints (PATCH/DELETE/hide) shipped in Thread 4; comment rendering on rec detail does not exist yet. Three-dot menu cannot ship without rendering. Deferred to a dedicated post-evaluation thread.
- Bulk auth lookup so `getProfileAvatarUrl` resolves OAuth metadata at the allocation/earnings sites (currently passed `null` for the authUser argument).
- Lens monthly prompt.
- Read receipts / unread persistence (no `read_at` column on `thread_messages` yet).
- Schema doc for `payout_messages_ui`, `payout_threads`, etc. consumers if more flags are added.

### Deliverability notes

Validation-received email landed in Gmail Primary tab on 2026-05-11 during Thread 7 close-out. Sender: `notifications@curators.ai`. List-Unsubscribe header present (one-click). No mitigations required.
