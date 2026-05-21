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
- Reply CTA URL: `https://curators.com/{curatorHandle}/{recSlug}`. The codebase has no `/recs/[id]` route; rec URLs are `/<handle>/<slug>` (`app/[handle]/[slug]/page.js`). Forward-compat to `/subs?segment=messages&thread={id}` deferred to Thread 4.

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
| Allocation segment in Subs | Thread 5 | SHIPPED 2026-05-09. View-only, mocked. See Thread 5 section below. |
| Allocation calculator (real waterfall math) | Thread 6+ | Replaces mocked totals/weights in `/api/allocation/preview`. |
| Earnings surface | Thread 6+ | |
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

## Thread 5 — Shipped

Phase 4 — Allocation segment in Subs (view-only, mocked) shipped 2026-05-09.

Final commits:
- 8ca15c7 — endpoint (`app/api/allocation/preview/route.js`)
- c9cc150 — UI wire-up (`AllocationView`, `AllocationHeroBar`, SubsView segment)
- 8f4821b — avatar column fix (drop `avatar_url` from profiles SELECT; column does not exist)

SQL applied manually:
- `payout_allocation_ui` flag set on @shamal, @chris, @testmctesty (`profiles.feature_flags`)

Decisions made:
- Server-side feature-flag gating on `/api/allocation/preview` is the new convention starting Thread 5. Thread 4 endpoints (`/api/validations/[id]/retract`, `/api/comments/[id]`, etc.) are client-gated only. Flag as a Thread 7 hardening item if desired.
- Dollar formatter and `daysRemainingInMonth` helpers defined inline in `AllocationView` / route module, not in `lib/format`. Extract when a third caller needs them.
- Endpoint inlines `getSupabaseAdmin()` and `getServerSupabase(cookieStore)` factories per Thread 4 convention. No shared helper introduced.
- Activity row sort by weight desc, with the last (smallest) row absorbing the cents rounding remainder so the sum exactly equals `ACTIVITY_TOTAL`.
- Floor uses `Math.floor((FLOOR_TOTAL * 100) / N)` per active curator — the per-curator amount may understate the displayed floor total by a few cents at certain N. Acceptable while mocked; revisit when real math lands.
- `is_projected: true` returned on every response so the alpha banner is decoupled from the page; flipping the projection state is a single boolean change.

New follow-ups added by Thread 5:
- **PROFILES-AVATAR-001 (P3)**: `profiles` table has no avatar column. Allocation rows render initial bubbles. Decide: add `avatar_url` column or pull from `auth.users` metadata. Affects any future surface that wants avatars in row contexts (Subscribers, Subscriptions, Allocation, ThreadDetail header, etc.).
- **ALLOCATION-VIZ-001 (P3)**: when alpha exits and `is_projected: false`, decide whether to keep the alpha banner copy, replace it (e.g., "Live allocation for {month}"), or remove it. The boolean already flows through the response.
- **ALLOCATION-RECON-001 (lessons learned)**: recon SQL did not dump full `profiles` schema — only the specific columns the Thread 5 spec mentioned. The avatar column gap was caught only at deploy time. Future recon prompts should always include a full `information_schema.columns` dump for any table the endpoint will SELECT from, not just the columns the spec calls out.

---

## Thread 3 — Shipped

Phase 5 — Real allocation math + curator earnings surface shipped 2026-05-11.

Final commits (in execution order, all on `main`):
- `3c02285` — Step B initial: pure-logic calculator + verify script. `lib/allocation/calculate.js`, `lib/allocation/calculate-earnings.js`, `scripts/verify-allocation.mjs`, `app/api/_verify/allocation/route.js`.
- `8f2e8a8` — Step B fix: rename `_verify/` to `verify-thread3/` after the underscore-prefix routing gotcha (see decisions below).
- `1f53a85` — Step C: dual-path `/api/allocation/preview`, new `/api/earnings/preview`, validation email earnings line wired through.
- `34a1297` — Step D: `/me/earnings` page, `EarningsView`, `EarningsHero`, segmented control 4th option.
- `c609395` — Step D reorder: Earnings tab moved to last position (My Recs · Record · Public Profile · Earnings) to preserve muscle memory for the first three options.

SQL applied manually (in Step B and Step C):
- `payout_real_math` set on @shamal, @chris, @testmctesty (`profiles.feature_flags`).
- `payout_earnings_ui` set on @shamal, @chris, @testmctesty (`profiles.feature_flags`).

Acceptance verification:
- Step B math verified offline against the locked fixture and in production via `GET /api/verify-thread3/allocation?subscriber=<handle>` and `?earnings=<handle>`. All seven math criteria (1–7) reconciled exactly: @shamal hero `$10.50/$6.30/$4.20/$0.00`, @testmctesty full cascade to floor `$10.50`, @chris earnings includes @shamal at `$7.35` ($6.30 validation + $1.05 floor).
- Step C endpoints verified by browser paste on @shamal: real math returns `is_projected: false`; mock path code-reviewed (byte-identical to Thread 5).
- Step D UI verified by browser walkthrough on @shamal (segmented control, hero, sections).

Decisions captured during the build:

1. **Hundredths-of-cents fixed-point amendment.** Spec said "cents" but the cascade math required hundredths of cents (1 unit = $0.0001) to keep tier-base allocations as clean integers. 25% of $10.50 = 262.5 cents (fractional); 25% of 105000 units = 26250 units (integer). Internal currency = units; conversion to two-decimal dollar strings happens only at the response-serialization step. Floor and round-down within tier, with the remainder absorbed by the highest-count curator (alphabetical handle tiebreak for determinism).

2. **Underscore-folder Next.js gotcha.** First Step B push placed the verification endpoint at `app/api/_verify/allocation/route.js`. Next.js app router treats `_`-prefixed directories as private folders and excludes them from routing — the route returned 404 indefinitely. Renamed to `verify-thread3/` in commit `8f2e8a8`. Captured in CLAUDE.md so future-me does not repeat it.

3. **`scripts/verify-allocation.mjs` is `.mjs`, not `.js`.** Original handoff spelled it `.js` but the existing convention (`scripts/regenerate-taste-profile.mjs`) is `.mjs` because there is no `"type": "module"` in `package.json`. Using `.mjs` lets Node treat it as ESM without changing the whole codebase's module classification.

4. **Per-rec activity attribution.** Spec did not strictly define how a curator's tier slice is broken down per rec for the Top Recs surface. Implemented: within each tier (validation, save), per-rec units = `floor(rec_count / curator_total_count * curator_slice_units)`; remainder absorbed by the highest-count rec (alphabetical `rec_id` tiebreak). Floor tier is NOT attributed per-rec (it is curator-level by design). This is best-effort accuracy; if launch-time accuracy demands a canonical attribution model, formalize it.

5. **Signal summary "subscribed" for floor-only contributors.** When a contributing subscriber has zero validations and zero saves (pure floor-tier contribution), the FROM YOUR SUBSCRIBERS row shows `subscribed` rather than an empty line. Honest to the user's mental model; aligns with the "signal summary" required by the spec without inventing a more elaborate label.

6. **`/me/earnings` direct-URL access pattern matches Thread 5.** No page-level flag check. The segmented control conditionally renders the option; the API returns 403 for non-flagged users; `EarningsView` shows "Earnings is not available on this account." for the 403 case and "Could not load earnings." for other errors. No new gating pattern introduced.

7. **Email earnings line uses the email template's own `INK2` (`#6B6B66`).** Spec referenced `T.ink2` (`#A09888`, dark-theme secondary) but the email template is cream-on-cream. Same intent, correct visual context.

8. **Email earnings line position.** Renders between the Reply CTA and `emailFooter` divider, never inside the legal footer. Plain-text body appends the same line on its own line. Gated on `parseFloat(curatorEarnings) > 0` so `null`, `undefined`, and `"0.00"` all suppress it.

9. **`/api/allocation/preview` keeps two independent flags.** `payout_allocation_ui` is the access gate (403 if disabled). `payout_real_math` is the calculator selector inside the access-gated path. Spec explicitly forbade collapsing the two — separation lets the calculator be turned on or off without changing who sees the surface.

10. **Hero math invariant enforced.** `hero.total === hero.activity + hero.floor + hero.unallocated` for every viewer. Verified against the locked fixtures and against live `@shamal` / `@testmctesty` data.

Follow-ups for Thread 7 (cleanup):

- **VERIFY-ENDPOINT-CLEANUP**: delete `app/api/verify-thread3/allocation/route.js` and remove the corresponding paragraph from CLAUDE.md.
- **VERIFY-SCRIPT-CLEANUP**: decide whether to delete `scripts/verify-allocation.mjs` or retain it as a reconciliation tool. Default: delete with the endpoint, since the in-prod route covers the same workflow without needing a local Node env.
- **PER-REC-ATTRIBUTION-001 (P3)**: per-rec attribution within tier slices is best-effort. If pre-launch we want a canonical model (e.g., revenue-weighted vs count-weighted), spec and reimplement in `calculateCuratorSliceFromSubscriber`.
- **EARNINGS-ALPHA-BANNER-001 (P3)**: when alpha exits, decide the banner copy (likely "Live earnings for {month}" or removed). Currently always-on per Thread 3 spec, regardless of `is_projected`.
- **ME-TASTE-NAMING-001 (recon surfaced)**: `/me/page.js` renders `TasteFileView` and `/me/taste/page.js` renders `TasteManager`, but CLAUDE.md describes both surfaces with overlapping language. Pre-existing tech debt, not Thread 3's bug; logged in case Thread 7 wants to consolidate the names.
- **CLAUDE-MD-PRUNE-001 (recon surfaced)**: CLAUDE.md is 365 lines / ~29 KB, well past its 250-line / 20 KB soft target. The Payouts System section in particular has grown to hold five phases of detail that could move into `docs/payouts.md`. Prune in a dedicated pass.
