# Notifications & Feedback

Email notifications and the in-app feedback system. Both depend on Resend for delivery and Supabase for persistence.

---

## Real-time notifications on rec save

When a curator saves a rec, subscribers get an email immediately.

### Flow

1. `addRec` in `context/CuratorContext.jsx` writes to `recommendations` + `rec_files` (dual-write).
2. Fire-and-forget POST to `/api/notify/new-rec`. Never blocks save.
3. `/api/notify/new-rec/route.js` requires authed session + ownership check (caller's `profiles.id` must match `curatorId`).
4. Recipients fetched: `subscriptions` where `unsubscribed_at IS NULL` AND subscriber's `profiles.new_rec_email_enabled = true`.
5. Email looked up via `supabase.auth.admin.getUserById(auth_user_id)` for each recipient.
6. Resend sends from the `newRecEmail` template in `lib/email-templates.js`.
7. Each send logs a `notification_log` row with `type='new_rec_realtime'`.

### Templates

`lib/email-templates.js` exports:
- `newRecEmail` — instant email when a curator saves a rec
- `newSubscriberEmail` — when someone subscribes to a curator
- `weeklyDigestEmail` — account-holder weekly digest
- `agentCompletionEmail` — when an agent job completes (e.g., Spotify analysis)

All templates match the app aesthetic: Manrope/Newsreader typography, dark-mode-friendly coloring, `#D4956B` accent. Include verbatim curator why, work authors, site name, body excerpts, image/thumbnail. One-tap actions for view-in-app, save, unsubscribe.

### Per-save silent flag

`is_tester` users see a "Save silently (don't notify subscribers)" checkbox in QuickCaptureSheet. Resets to OFF on every sheet open. When checked, the request body to `/api/notify/new-rec` includes `silent: true`. Server-side enforcement: `silent: true` skips email sends, logs `[NOTIFY_SKIPPED]` with `{ recId, curatorId, reason }`.

---

## Token-based unsubscribe

Recipients can unsubscribe per-curator or globally via tokenized links in emails.

`lib/email-tokens.js` generates and validates tokens. Token format embeds `recipient_id`, `curator_id` (or null for global), and an HMAC. Unsubscribe links route to `/email/unsubscribed` which validates the token and updates `subscriptions.unsubscribed_at` (per-curator) or `profiles.new_rec_email_enabled` (global).

---

## Weekly digest cron

`app/api/cron/weekly-digest` — account-holder unified network digest path. Runs once weekly via Vercel cron. Fetches each account's subscribed recs from the past week, batches into one email per subscriber.

Pure email subscribers (no account, in `subscribers` table) and rich content (authors/thumbnails/excerpts) are deferred until public launch.

---

## ONBOARD welcome email (planned)

ONBOARD-002 (P0, not yet shipped): when a subscriber's first `subscriptions` row is created (whether via auto-subscription from ONBOARD-001 or manual subscribe), send a one-time welcome email. Idempotency: gated on `profiles.welcome_email_sent_at` column (new), not on subscription count.

---

## Feedback System

`components/chat/FeedbackSheet.jsx` — text + optional screenshot. Routes to `/api/feedback/route.js`.

### Flow

1. User taps Feedback chip → sheet opens with text input + screenshot picker.
2. Client-side image processing if screenshot present:
   - Resize to max 1600px on longest edge
   - Re-encode as JPEG quality 0.85
   - Reject HEIC/HEIF (browsers can't decode reliably)
   - Cap post-resize: 5.5MB base64
3. POST to `/api/feedback/route.js`:
   - Insert `feedback` row first (text always persists)
   - If screenshot present: SHA-256 hash → upload to `artifacts/feedback/<feedback_id>/<sha>.jpg` via direct `supabase.storage.from('artifacts').upload()` (NOT `uploadArtifact` from `lib/rec-files/...`)
   - Update feedback row with `screenshot_path`
   - Generate 7-day signed URL
4. Resend email to admin with text + signed screenshot URL.

### Failure modes

Screenshot upload failures NEVER block feedback submission. Text persists, email sends without screenshot link. Logged as `[FEEDBACK_SCREENSHOT_UPLOADED]` with `_FAILED` variant on errors.

---

## Email infrastructure

- **Provider:** Resend
- **From address:** `notifications@curators.com`
- **Reply-to:** varies by template (curator's address for some, support for others)
- **Subject line patterns:** templated, includes curator handle + rec title where applicable
- **Plaintext fallback:** every template includes both HTML and plaintext versions

---

## Auto-subscribe on invite redemption

Shipped April 28 (ONBOARD-001). When a new curator redeems an invite, two `subscriptions` rows are written: invitee→inviter and inviter→invitee, both `source='invite'`. Notification emails fire in both directions.

`lib/email/sendNewSubscriberEmail.js` is the shared email-send function. `/api/notify/new-subscriber` is a thin wrapper for the manual-subscribe path. Auto-subscribe path calls the lib directly to bypass the manual-subscribe ownership check.

Reactivation preserves original `source` value (first-origin semantics, not last-touch). Null-inviter case (legacy `CURATORS-ALPHA-*` codes) soft-skips with `[AUTO_SUBSCRIBE_NULL_INVITER]` log.

---

## Related files

- `app/api/notify/new-rec/route.js` — instant rec notification
- `app/api/notify/new-subscriber/route.js` — new subscriber notification (manual subscribe path)
- `app/api/cron/weekly-digest/route.js` — weekly digest cron
- `app/api/feedback/route.js` — feedback + screenshot
- `app/api/email-action/route.js` — token-based action endpoint (unsubscribe, etc.)
- `lib/email-templates.js` — all email templates
- `lib/email-tokens.js` — token gen/validate
- `lib/email/sendNewSubscriberEmail.js` — shared subscriber email send
- `components/chat/FeedbackSheet.jsx` — feedback UI

---

## Log markers

- `[NOTIFY_NEW_REC]` / `[NOTIFY_NEW_REC_ERROR]` — rec notification flow
- `[NOTIFY_SKIPPED]` — silent flag suppression: `{ recId, curatorId, reason }`
- `[AUTO_SUBSCRIBE]` / `[AUTO_SUBSCRIBE_NULL_INVITER]` / `[AUTO_SUBSCRIBE_REVERSE_FAIL]` — invite redemption auto-subscribe
- `[FEEDBACK_SCREENSHOT_UPLOADED]` / `[FEEDBACK_SCREENSHOT_UPLOADED_FAILED]` — screenshot upload outcome
