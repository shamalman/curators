# CLAUDE.md — Curators.AI Engineering Guide

Operating manual for Claude Code in this repo. Loaded every session, so it stays lean. Architecture details live in `docs/` — referenced inline below.

Last reviewed: May 4, 2026.

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
6. **No em dashes** in AI skill files, prompt text, or AI output. No spaced hyphens as substitutes either. Model partial-compliance: still slips `**Header** —` connectors (LENS-004).
7. **Verify column existence** before writing queries against unfamiliar tables. See `docs/schema.md`.
8. **Add RLS policies** for new write operations.
9. **Deploy one change at a time.** Each deploy independently testable on iPhone Safari.
10. **Descriptive commit messages.**
11. **Hard refresh Safari** after deploys. After module-state changes, force a fresh build (empty commit + push) and wait 5–10 min for Fluid Compute warm instances to cycle. Symptom: alternating old/new behavior on back-to-back requests = fleet rollout in progress, not a bug.
12. **Always normalize handles.** Use `normalizeHandle()` from `lib/handles.js` for ALL handle comparisons.
13. **Reuse existing auth patterns.** Copy from `app/api/ai-response-ratings/route.js:17-40`. Don't invent new auth shapes.
14. **No tests, no local builds.** A cron route blocks `npm run build` locally. Verify by deploying to Vercel and curling the live route.
15. **Pull before pushing in long sessions.** Multiple in-flight commits across sessions cause local main to drift behind origin. Always `git pull --ff-only` before testing or running scripts.

---

## Multi-Deploy Session Pattern

When a session involves multiple coupled changes (prompt rewrite + auth fix + data regen):

- **Sequence one deploy at a time** with explicit "STOP and confirm before next deploy" instructions between each.
- **Verify each deploy against production**, not the build log. Curl the actual changed route.
- **For prompt rewrites: regenerate one entity first**, paste output for review, then proceed.
- **For Record work specifically:** read `lib/taste-profile/generate.js` and the latest `taste_profiles.content` row before proposing changes. The prompt and output are the source of truth, not the architecture doc.
- **Local main drifts behind origin across sessions.** Run `git status` and `git log --oneline -5` at session start.

---

## Architecture Quick Reference

### App Shell

Four tabs: Lens (`/myai`) → Me (`/me`) → Find (`/find`) → Subs (`/subs`). Shamal-only `/admin/feedback` appended.

Nav: `components/layout/BottomTabs.jsx` (mobile), `components/layout/Sidebar.jsx` (desktop).

Me tab segmented control: `/me` (My Recs) → `/me/taste` (Personal Record) → `/{handle}` (Public Profile). Find tab: Network / Subscribed / Saved. `/recommendations` permanently redirects to `/find`.

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

**Post-save reflection** lives at `ChatView.jsx` lines 227 + 850. **If post-save behavior drifts, debug `ChatView.jsx` FIRST. Do not start with skill files.**

Full mechanics, tool use, re-injection, charter: `docs/chat-route.md`.

### AI Skills System

17 skill files in `lib/prompts/skills/`, mirrored to `lib/prompts/skills/staging/` for the staging AI lane. Build functions: `buildOnboardingPrompt`, `buildStandardPrompt`. `loadSkill(name, aiProfile)` reads from stable or staging path.

**Lens Charter** lives at `lib/prompts/skills/staging/charter.md`. Loads FIRST in staging prompt builders. Stable path is byte-identical (spread evaluates to `[]`).

Full skill system: `docs/ai-skills.md`. Staging lane: `docs/staging-lane.md`.

### Auth & Access

Site-wide lockdown via `middleware.js`. Public routes: `/login`, `/signup`, `/onboarding*`, `/forgot-password`, `/reset-password`, `/email/*`, `/`. All `/api/*` routes pass through middleware without session check — each handler enforces its own auth.

`/admin/feedback` is shamal-only. `/admin/transcripts` is shamal+chris allowlist. Three independent operational modes (Stable / Staging AI / Tester features), set via SQL flags on `profiles` (`ai_profile`, `is_tester`). Never hardcode handle checks.

Full auth model: `docs/auth.md`.

### Notifications & Feedback

Real-time email on rec save (`/api/notify/new-rec`). Weekly digest cron for account-holders. Templates in `lib/email-templates.js`.

Feedback: `FeedbackSheet.jsx` → `/api/feedback/route.js` with optional screenshot (resize to 1600px / JPEG 0.85, 7-day signed URL).

Full mechanics: `docs/notifications.md`.

### Source Parsers

9 parsers in `lib/agent/parsers/`: Spotify, Apple Music, YouTube, SoundCloud, Letterboxd, Goodreads, Google Maps, Twitter/X, Generic Webpage (Defuddle universal fallback). Instagram and Bandcamp deferred.

---

## Key File Paths

```
components/layout/BottomTabs.jsx           mobile nav
components/me/MeSegmentedControl.jsx       Me tab 3-button nav
app/(curator)/me/taste/page.js             Personal Record (TasteFileView)
app/(curator)/me/timeline/page.js          Verbatim ledger
app/api/chat/route.js                      mode detection, link handling, Read short-circuit
app/api/taste-read/route.js                Read chip generation (skill + parsed_content only)
app/api/taste-read/{confirm,refine,ignore} chip persistence + Record regen triggers
app/api/generate-taste-profile/route.js    authed regen route
app/api/notify/new-rec/route.js            real-time subscriber notifications
app/api/feedback/route.js                  feedback + screenshot
app/api/ai-response-ratings/route.js       auth pattern reference
app/api/admin/transcripts/route.js         admin allowlist
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

## Log Markers

`[TASTE_READ_V2]`, `[TIMELINE]`, `[rec-files]`, `[chat-parse-ingest]`, `[taste-profile]`, `[NOTIFY_NEW_REC]`, `[NOTIFY_SKIPPED]`, `[INVITER_CONTEXT]`, `[AUTO_SUBSCRIBE]`, `[UPDATE_REC_FILE]`, `[AI_PROFILE]`, `[SKILL_LOAD]`, `[AI_RATING]`, `[FEEDBACK_SCREENSHOT_UPLOADED]`, `[ADMIN_TRANSCRIPTS_ACCESS]`, `[TASTE_READ_REINJECTION]`. Each has `_ERROR` / `_FAILED` / `_UNDO` variants.

`[taste-profile] SUBSCRIBER-ONLY BRANCH activated` payload: `{ profileId, handle, confirmationCount, subscriptionCount }`. Monitor in production for first real subscriber-only Records.

---

## Schema Reference

Full schema with column types: `docs/schema.md`. Rec files migration: `docs/rec-files-migration.md`. Record architecture: `docs/record-architecture.md`.

---

## Tooling

**Supabase MCP** (Claude Code only, read-only): scoped to `curators-ai`. Use for pre-implementation recon. **Do NOT** paste untrusted content with MCP active — prompt injection risk. For writes, use Supabase SQL Editor.

**FK-safe test account deletion order:** `notification_log` → `email_tokens` → `feedback` → `saved_recs` → `agent_jobs` → `subscribers` → `subscriptions` → `chat_messages` → `recommendations` → `invite_codes` (UPDATE before DELETE) → `profiles`. Auth users deleted manually.

`unsupported_source_requests` does not exist in DB (confirmed 2026-04-10 audit).

---

## What's Not Wired Yet

- Validations input to Record generation (forward-spec'd in `docs/record-architecture.md`)
- Saves-of-others input to Record generation (`saved_recs` exists, not read by `generateTasteProfile`)
- `buildSubscriberPrompt` — skill exists, no build function or route wiring
- Visitor prompt not extracted to skill system
- AI web search for link lookup
- Pure email subscriber digests — deferred until public launch
- Light mode (P3 roadmap)
- Read regen batching — currently each chip fires immediate regen; will need 60s debounce when volume warrants

---

## Open Engineering Tickets

- **READ-DRIFT (RESOLVED May 4, commit `28988ae`):** Per-URL Read endpoint stripped of Record + recs injection. Chips now generated from `skill + parsed_content` only.
- **CHAT-VERBOSITY (RESOLVED May 5, commit `429407a`):** Chat route now strips `tasteProfileBlock` and `recsContext` injection on URL-drop turns. Gate is `parsedLinkBlocks.length > 0` (covers successful, partial, and failed parses; covers all three button-picker turns; correctly excludes follow-on conversational turns). Conversational turns retain full Record + recs context. Per roadmap §3d, Option A.
- **LENS-004 (RESOLVED May 5, commit `4784c70`):** Added explicit DO NOT WRITE / INSTEAD WRITE example block adjacent to existing em-dash ban in `lib/taste-profile/generate.js`. Verified clean across @shamal v119, @chris v26, @bradbarrish v9, @testmctesty v5 (including SUBSCRIBER-ONLY branch). Rule generalized beyond Domains. Patterns subheads also adopted `**Header**:` format. Per roadmap §3e, Option A.
- **TASTE-PROFILE-VOICE-STYLE (P3):** Voice & Style section can drop in subscriber-only branch.
- **INVITE-001 (P3):** Signup invite-code lookup is case-sensitive.
- **PARSER-003 (P2):** Spotify Strategy C observability gap on `/api/chat` concurrent parse path.
- **LENS-005 (P3):** Stats `Last updated:` line drifts to fabricated date on thin-data profiles. @bradbarrish v9 produced `December 2024` instead of injected `May 2026` literal. Reproduces only on data-rich-poor profiles (7 recs / 0 confirmations / 0 subscriptions); did not reproduce on @shamal, @chris, or @testmctesty v5 (which is also thin but in the SUBSCRIBER-ONLY branch). Cosmetic.
- **LENS-006 (observation, no fix needed):** LENS-004 example block (added to Domains-section RULES) generalized to Patterns subheads as well. This is desired behavior. The formatting rule should apply broadly. Future prompt edits to `lib/taste-profile/generate.js` RULES block should expect cross-section influence.

---

## Documentation Hygiene

This file is the operating manual, not the architecture spec. When adding content, ask:

1. **Does this materially change Claude's decisions in every session?** If no, put it in `docs/`.
2. **Is this discoverable by reading the code?** If yes, don't duplicate it.
3. **Is this a historical change log?** That belongs in git commit messages, not here.

**Target: under 250 lines, under 20K chars.** Hard ceiling for performance: ~40K. When approaching the target, prune. Move detailed sections into `docs/<feature>.md` and reference inline.

**Update as the final step of every working session.** Stale docs actively cause debugging errors.
