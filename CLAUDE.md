# CLAUDE.md — Curators.AI Engineering Guide

Operating manual for Claude Code in this repo. Loaded every session, so it stays lean. Architecture details live in `docs/` — referenced inline below.

Last reviewed: May 11, 2026.

---

## Mission

Preserve, access, and amplify human curation. Build equally for curators (capture, share, earn from taste) and subscribers (find trusted curators, discover great recs).

---

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Database:** Supabase (Postgres + RLS + PostgREST)
- **AI:** Anthropic SDK 0.80.0. Model pinned in `app/api/chat/route.js`: `claude-sonnet-4-20250514`
- **Hosting:** Vercel, auto-deploys from GitHub `main` (~60s)
- **Email:** Resend
- **Styling:** Inline styles only (T constants from `lib/constants`). No Tailwind.
- **Markdown:** `react-markdown` v10, no GFM plugin (CommonMark only)
- **No local dev environment.** All changes ship to production via GitHub → Vercel.

---

## Vocabulary

User-facing surfaces use new framing. Code, schema, and logs use legacy names. **Do not rename internal identifiers** — they're load-bearing.

- **subscribe** not "follow"
- **curator** not "user" or "creator"
- **recommendations** / **recs** not "content" or "posts"
- **Record** = user-facing label for the taste artifact. Internal: `taste_profile`, `taste_file`, `taste_confirmations`
- **Read** = user-facing label for per-URL inference card. Internal: `taste_read`, `taste_read_confirmed`
- **Lens** = user-facing label for the AI surface (`/myai`). Internal references unchanged.

---

## Hard Rules

1. **Read files before editing.** `cat` current state first. Never assume column names, function signatures, or data shapes. Verify line numbers in handoffs against the current file — line numbers drift.
2. **Paste raw output, not summaries.** When verifying changes, paste literal `git diff` / `cat` / `grep` output verbatim. Summaries hide bugs at the character level.
3. **No silent `catch {}`.** Surface errors with a `[FEATURE_ERROR]` log marker.
4. **No Supabase join aliases.** Use two-step queries.
5. **After new DB columns/tables:** run `NOTIFY pgrst, 'reload schema';` in Supabase SQL Editor. PostgREST silently drops unknown columns without this.
6. **No em dashes** in AI skill files, prompt text, AI output, or any user-facing copy across Curators.AI. No spaced hyphens as substitutes either. Models will slip `**Header** —` connectors; check generated output.
7. **Verify column existence** before writing queries against unfamiliar tables. See `docs/schema.md`.
8. **Add RLS policies** for new write operations.
9. **Deploy one change at a time.** Each deploy independently testable on iPhone Safari.
10. **Descriptive commit messages.**
11. **Hard refresh Safari** after deploys. After module-state changes, force a fresh build (empty commit + push) and wait 5–10 min for Fluid Compute warm instances to cycle. Symptom: alternating old/new behavior on back-to-back requests = fleet rollout in progress, not a bug.
12. **Always normalize handles.** Use `normalizeHandle()` from `lib/handles.js` for ALL handle comparisons.
13. **Reuse existing auth patterns.** Copy the cookie-session + `auth_user_id` lookup pattern from `app/api/ai-response-ratings/route.js` or `app/api/invite/route.js` (DELETE handler). Don't invent new auth shapes.
14. **No tests, no local builds.** A cron route blocks `npm run build` locally. Verify by deploying to Vercel and curling the live route.
15. **Pull before pushing in long sessions.** Multiple in-flight commits across sessions cause local main to drift behind origin. Always `git pull --ff-only` before testing or running scripts.

---

## Working Patterns

- **Recon before implement.** Read actual files, run SQL to confirm columns, confirm function signatures. Build a "confirm before writing" checklist before writing any handoff.
- **Paste-ready Claude Code prompts.** Architecture/strategy in Claude.ai; execution via paste-ready prompts in Claude Code. Investigation prompts first, fix prompts second.
- **One deploy at a time.** Sequence coupled changes with explicit "STOP and verify before next deploy" gates. Verify each against production, not the build log — curl the actual changed route.
- **For prompt rewrites**: regenerate one entity first, paste output for review, then proceed.
- **For Record work specifically**: read `lib/taste-profile/generate.js` and the latest `taste_profiles.content` row before proposing changes. The prompt and output are the source of truth, not the architecture doc.

---

## Architecture Quick Reference

### App Shell

Four tabs: Lens (`/myai`) → Me (`/me`) → Find (`/find`) → Subs (`/subs`). Shamal-only `/admin/feedback` appended.

Nav: `components/layout/BottomTabs.jsx` (mobile), `components/layout/Sidebar.jsx` (desktop).

Me tab segmented control: `/me` (My Recs) → `/me/taste` (Personal Record) → `/{handle}` (Public Profile). Find tab: Network / Subscribed / Saved. `/recommendations` permanently redirects to `/find`.

### Data Model

Conceptual relationships (full column types in `docs/schema.md`):

- **`auth.users` ↔ `profiles`** via `profiles.auth_user_id`. Auth row is created at signup; profile row at onboarding submit. Every server handler that needs the curator looks up `profiles WHERE auth_user_id = session.user.id`.
- **`profiles` ↔ `recommendations` ↔ `rec_files`** — `recommendations.profile_id` is the curator; `recommendations.rec_file_id` points at the canonical content blob.
- **`profiles` ↔ `subscriptions` ↔ `profiles`** — `subscriptions.subscriber_id` and `subscriptions.curator_id` are directional labels, not identity labels. Every user can be both.
- **`profiles` ↔ `invite_codes`** — `created_by` (the inviter), `used_by` (the new curator), `revoked_at` (soft-revoke). Pending = `used_at IS NULL AND revoked_at IS NULL`.
- **`taste_profiles`** — generated per profile, regenerates on rec save and Read confirmation. See Record Pipeline.

### Rec Storage — Two-table dual-write

- **`recommendations`** — flat queryable metadata
- **`rec_files`** — canonical structured content blocks

Dual-write is unconditional and permanent. `buildRecFileRow` in `lib/rec-files/build.js` is the single source of truth. Capture flow: `parse-link / paste / upload` → `parsedPayload` envelope → client → `addRec` → `recommendations` insert → `ingestUrlCapture` → `rec_files` insert → `recommendations.rec_file_id` update.

Full migration history: `docs/rec-files-migration.md`.

### Record Pipeline

Generated by `lib/taste-profile/generate.js` via `POST /api/generate-taste-profile`. Auto-regenerates immediately on every rec save past 3-rec threshold (both QCS and inline paths) and on every Read confirmation/refinement/ignore.

**Two-layer architecture** — do not conflate:
- **Timeline** (`/me/timeline`) — verbatim, append-only, source-of-truth ledger
- **Document** (`/me/taste`) — generated interpretation from `taste_profiles.content`

**Five inputs feed the Record** (locked May 2026): Recommendations (highest), Validations (not built), Confirmed Reads (medium-high, first-class as of May 3), Saves of others (deferred), Subscriptions (lowest).

**Subscriber-only branch** fires when `recs.length === 0 && confirmations.length > 0`. Server-side log `[taste-profile] SUBSCRIBER-ONLY BRANCH activated` confirms entry.

Full architecture: `docs/record-architecture.md`. Manual regen: `node scripts/regenerate-taste-profile.mjs --profile <profileId>` (note: `--profile` flag required, not positional).

### Read Pipeline

Per-URL inference cards. Chat route short-circuits at `app/api/chat/route.js:247` and emits a `taste_read_card` block. Chip generation lives in `app/api/taste-read/route.js` with strict isolation: system prompt is `skill + parsed_content` only. No Record injection. No prior recs injection.

Why isolation matters: chip is the user's confirmation step, not the model's prediction step. If the model already "knows" the user from injected priors, chips become a rubber stamp.

Full architecture: `docs/read-pipeline.md`.

### Chat Route

Modes: Onboarding (`< 3 recs OR no bio`) | Standard (`3+ recs AND bio`) | Visitor.

Hard cap: `SYSTEM_PROMPT_HARD_CAP = 180K`. Link handling synchronous, up to 3 URLs parsed concurrently (15s timeout). Action buttons emitted: `save_rec_from_chat`, `taste_read`, `discuss_link`, `save_image_rec`, `save_rec_from_taste_read`.

Three-option URL-drop block emits unconditionally on URL drops (Save as Recommendation / Add to Record / Just talk about it).

Full mechanics, tool use, re-injection, charter: `docs/chat-route.md`.

### AI Skills System

Skills live under `lib/prompts/skills/`. Three lanes:
- **Stable** — `lib/prompts/skills/*.md`, loaded by all curators
- **Staging** — `lib/prompts/skills/staging/*.md`, gated by `profiles.ai_profile = 'staging'`
- **Tester** — gated by `profiles.is_tester = true` (currently @shamal, @chris). Use this column for tester-only feature flags; never hardcode handle checks.

**Lens Charter** at `lib/prompts/skills/staging/charter.md` loads FIRST in staging prompt builders. Defines turn branches (Capture, Discover, Talk-through), banned behaviors, and the direct-ask exception. Stable path is byte-identical (charter spread evaluates to `[]`).

**Charter does NOT apply to taste-read surfaces.** Those are isolated by design (see Read Pipeline).

**Date and Record context.** Chat route prepends today's date to the system prompt. When the Record is injected, it's wrapped with reference-document framing so the model knows it's reading curator history, not user-authored input.

**Agent vs process prompts.** Treat agent system prompts (chat, Read, generation) and process prompts (parsers, classifiers) differently. Agent prompts get charter and full skill stack; process prompts get only the minimum context they need to do their job. Don't cross-contaminate.

Full skill system: `docs/ai-skills.md`. Staging lane: `docs/staging-lane.md`.

### Auth & Access

Site-wide lockdown via `middleware.js`. Public routes: `/login`, `/signup`, `/onboarding*`, `/forgot-password`, `/reset-password`, `/email/*`, `/`. All `/api/*` routes pass through middleware without session check — each handler enforces its own auth.

`/admin/feedback` is shamal-only. `/admin/transcripts` is shamal+chris allowlist. Three independent operational modes (Stable / Staging AI / Tester features), set via SQL flags on `profiles` (`ai_profile`, `is_tester`). Never hardcode handle checks.

Full auth model: `docs/auth.md`.

### Notifications & Feedback

Real-time email on rec save (`/api/notify/new-rec`). Weekly digest cron for account-holders. Templates in `lib/email-templates.js`.

Feedback: `FeedbackSheet.jsx` → `/api/feedback/route.js` with optional screenshot (resize to 1600px / JPEG 0.85, 7-day signed URL).

Full mechanics: `docs/notifications.md`.

### Invite System

Single source of truth: `/invite` (`app/(curator)/invite/page.js`). Settings has no invite UI. API `app/api/invite/route.js`: `GET` requires `?mode=all&status=pending|used&offset=&limit=`; `POST { action: 'generate' }` or `POST { codeId, inviterNote }`; `DELETE { codeId, profileId }` for soft-revoke (cookie-auth, ownership-checked). Cap `MAX_UNUSED_INVITES` in `lib/constants.js` (25; bypassed when `profiles.unlimited_invites = true`).

Signup TOCTOU: `app/signup/page.js` validates `revoked_at IS NULL` upfront and re-filters on the redeem `UPDATE`. Zero-row update calls `POST /api/auth/cleanup-orphan` (best-effort), `signOut()`, and throws. Cleanup endpoint deletes orphan auth.users + profiles rows after verifying cookie ownership, < 5 min age, and zero recommendations.

### Source Parsers

9 parsers in `lib/agent/parsers/`: Spotify, Apple Music, YouTube, SoundCloud, Letterboxd, Goodreads, Google Maps, Twitter/X, Generic Webpage (Defuddle universal fallback). Instagram and Bandcamp deferred.

---

## Design System

**Color tokens** in `lib/constants.js`:
- **`T`** — base theme (warm dark). Default for all curator surfaces.
- **`W`** — curator workspace (cooler/blue-shifted). Used for chat surfaces.
- **`V`** — visitor AI (warm/personal). Used for visitor surfaces.

Each exports `bg`, `bg2`, `s`, `s2`, `s3`, `ink`, `ink2`, `ink3`, `bdr`, `acc`, `accText`, `accSoft`.

**Fonts**: `F` Manrope (body/UI), `S` Newsreader (display/headings), `MN` JetBrains Mono (codes, IDs).

**Inline styles only** — no Tailwind. Token references like `T.bg`, `T.ink`, `F` come from `lib/constants.js` imports at the top of each file.

**Shared UI primitives** live under `components/ui/`. Wrap-and-customize is the pattern: `components/me/MeSegmentedControl.jsx` wraps `components/ui/SegmentedControl.jsx` with Me-tab-specific routing. When you find yourself copying inline styles between two components, extract a primitive into `components/ui/`.

---

## Key File Paths

```
components/layout/BottomTabs.jsx           mobile nav
components/me/MeSegmentedControl.jsx       Me tab 3-button nav
components/ui/SegmentedControl.jsx         shared tab/segment primitive
app/(curator)/me/taste/page.js             Personal Record (TasteFileView)
app/(curator)/me/timeline/page.js          Verbatim ledger
app/(curator)/invite/page.js               invite system UI (single source of truth)
app/api/chat/route.js                      mode detection, link handling, Read short-circuit
app/api/taste-read/route.js                Read chip generation (skill + parsed_content only)
app/api/taste-read/{confirm,refine,ignore} chip persistence + Record regen triggers
app/api/generate-taste-profile/route.js    authed regen route
app/api/notify/new-rec/route.js            real-time subscriber notifications
app/api/feedback/route.js                  feedback + screenshot
app/api/ai-response-ratings/route.js       auth pattern reference
app/api/admin/transcripts/route.js         admin allowlist
app/api/invite/route.js                    invite API: GET paginated, POST generate/note, DELETE revoke
app/api/auth/cleanup-orphan/route.js       orphan account cleanup on signup TOCTOU abort
lib/prompts/onboarding.js, standard.js     system prompt builders
lib/prompts/loader.js                      loadSkill(name, aiProfile)
lib/prompts/skills/taste-read.md           Read chip skill (stable)
lib/prompts/skills/staging/charter.md      Lens Charter
lib/chat/network-context.js                getSubscribedRecs + REC_LINK sentinel
lib/chat/link-parsing.js                   distillForReinjection
lib/chat/chat-parse-ingest.js              chat URL → rec_files ingest
lib/chat/stats-tool.js                     get_curator_stats tool
lib/rec-files/build.js                     buildRecFileRow (single source of truth)
lib/rec-files/ingest.js                    ingestUrlCapture (never throws)
lib/handles.js                             normalizeHandle (REQUIRED for all handle comparisons)
lib/constants.js                           T/W/V tokens, F/S/MN fonts, MAX_UNUSED_INVITES
lib/taste-profile/generate.js              Record generation
lib/taste-profile/parse.js                 extractPublicSections, extractVoiceAndStyle
lib/email-templates.js                     all email templates
context/CuratorContext.jsx                 addRec dual-write
components/chat/ChatView.jsx               chat UI, rec save, post-save injection, Read save handoff
components/taste-read/TasteReadCard.jsx    Read card (chip flow)
components/me/TasteTimeline.jsx            timeline UI
scripts/regenerate-taste-profile.mjs       manual regen — requires --profile flag
```

---

## Intentional Non-Refactors

These zones look like they need cleanup but don't. Touch only with explicit reason.

- **`app/api/taste-read/route.js`** — Strict isolation: skill + parsed_content only, no Record or recs injection. Chips are the user's confirmation step, not the model's prediction step. Charter does NOT apply here. Don't propose adding context.
- **`ChatView.jsx` lines ~227 + ~850** — Post-save reflection injection. If post-save behavior drifts, debug here FIRST, before skill files. (Line numbers will drift; grep for the constraint string to locate.)
- **`app/api/invite/route.js` GET/POST handlers** — Trust `profileId` from query/body without auth. Pre-existing tech debt; the DELETE handler uses the correct cookie-session pattern. New handlers should match DELETE, not GET/POST.

---

## Log Markers

Active markers follow `[FEATURE_NAME]` and `[FEATURE_NAME_ERROR]` / `_FAILED` / `_UNDO` conventions. To enumerate:

```bash
grep -rhE '\[[A-Z_]+\]' app/ lib/ components/ --include="*.js" --include="*.jsx" | grep -oE '\[[A-Z_]+\]' | sort -u
```

Notable: `[taste-profile] SUBSCRIBER-ONLY BRANCH activated` payload `{ profileId, handle, confirmationCount, subscriptionCount }` — monitor in production for first real subscriber-only Records.

---

## Schema Reference

Full schema with column types: `docs/schema.md`. Rec files migration: `docs/rec-files-migration.md`. Record architecture: `docs/record-architecture.md`.

---

## Tooling

**Supabase MCP** (Claude Code only, read-only): scoped to `curators-ai`. Use for pre-implementation recon. **Do NOT** paste untrusted content with MCP active — prompt injection risk. For writes, use Supabase SQL Editor.

**FK-safe test account deletion order:** `notification_log` → `email_tokens` → `feedback` → `saved_recs` → `agent_jobs` → `subscribers` → `subscriptions` → `chat_messages` → `recommendations` → `invite_codes` (UPDATE before DELETE) → `profiles`. Auth users deleted manually.

`unsupported_source_requests` does not exist in DB (confirmed 2026-04-10 audit).

Roadmap and open tickets live in the Claude.ai project files (not in this repo). Update the roadmap doc there when shipping changes that affect P0/P1 items.

---

## Local Dev Verification

`npm run build` is blocked locally by a cron route. Workarounds for verifying changes before push:

- **Syntax check JS**: `node --check path/to/file.js`
- **Syntax check JSX**: `npx tsc --noEmit --jsx preserve --allowJs --target esnext --module esnext --moduleResolution node --resolveJsonModule --skipLibCheck --noResolve path/to/file.jsx`
- **Manual read** — confirm imports resolve, JSX is balanced, all referenced state hooks are declared.

Real verification is `git push` + Vercel deploy + curl the live route. After deploy, hard-refresh Safari. After module-state changes, force a fresh build (empty commit + push) and wait 5-10 min for Fluid Compute warm instances to cycle.

---

## Payouts System

Phase A substrate shipped May 2026 across Threads 1-5 and 7 (staging-only behind feature flags + `is_tester=true` on @shamal, @chris, @testmctesty). Full implementation history, table definitions, endpoint contracts, and feature flag list live in `docs/payouts.md`. Table shapes also documented in `docs/schema.md` under `validations`, `comments`, `threads`, `thread_messages`. Open questions and decisions pending tester evaluation week tracked in the Claude.ai project tracking doc.

### Payouts deferred to post-evaluation threads

- **Auth context consolidation** (LockManager band-aids in RecDetail.jsx). VisitorContext currently treats `profile` as the page subject not the viewer, which makes the existing setTimeout workarounds nontrivial to remove. Dedicated thread post-evaluation.
- **Comment three-dot menu UI on rec detail**. Comment endpoints (PATCH/DELETE/hide) shipped in Thread 4; comment rendering on rec detail does not exist yet. Three-dot menu cannot ship without rendering. Dedicated thread post-evaluation.

---

This file is the operating manual, not the architecture spec. Target: under 250 lines, under 20K chars; performance ceiling 40K. When adding content, ask whether it materially changes Claude's decisions in every session, is already discoverable from the code, or is historical change log (belongs in commits, not here). Move detailed sections into `docs/<feature>.md` and reference inline. Update as the final step of every working session.
