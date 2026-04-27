# CLAUDE.md — Curators.AI Engineering Guide
## Last updated: April 26, 2026 (Lens Charter + post-save fix + is_tester flag + chat route hygiene)

---

## Mission

Preserve, access, and amplify human curation. Build equally for curators (capture, share, earn from taste) and subscribers (find trusted curators, discover great recs).

---

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Database:** Supabase (PostgreSQL + RLS + PostgREST)
- **AI:** Anthropic Claude API. SDK 0.80.0. Model ID pinned in `app/api/chat/route.js`: `claude-sonnet-4-20250514`
- **Hosting:** Vercel, auto-deploys from GitHub main (~60s)
- **Email:** Resend
- **Styling:** Inline styles only, no Tailwind
- **Markdown rendering:** `react-markdown` v10, no GFM plugin (plain CommonMark only)
- **No local dev environment.** All changes deploy directly to production via GitHub → Vercel.

---

## Vocabulary (enforce everywhere: code, prompts, UI, comments)

- "subscribe" not "follow"
- "curator" not "user" or "creator"
- "taste" not "preferences"
- "recommendations" or "recs" not "content" or "posts"
- "Personal Record" is the user-facing label for the Taste File on /me. Internal references (DB, code, skill files, "taste" as a concept) stay as "taste."
- "Lens" is the user-facing label for the MyAI tab and AI surface. Internal references (route /myai, component names, log markers, prompt content) stay unchanged. The AI does not yet refer to itself as "Lens."

---

## Key Development Rules

1. **Read files before editing.** Always `cat` current state first.
2. **No silent catch {}.** Always surface errors explicitly.
3. **No Supabase join aliases.** Use two-step queries instead.
4. **After new DB columns/tables:** run `NOTIFY pgrst, 'reload schema'` in Supabase SQL Editor. PostgREST silently drops unknown columns without this.
5. **No em dashes** in AI skill files, prompt text, or AI output.
6. **Verify column existence** before writing queries against unfamiliar tables.
7. **Add RLS policies** for new write operations.
8. **Deploy one change at a time.** Each deploy independently testable on iPhone Safari.
9. **Descriptive commit messages.**
10. **Hard refresh Safari** after deploys.

---

## Data patterns

**Handle comparison — always normalize:** `profiles.handle` values are stored in the DB without a `@` prefix (e.g. `shamal`, not `@shamal`). However, the client-side `profile.handle` value consumed via `useCurator()` may appear with a `@` prefix due to display-layer formatting somewhere in the profile load path. You cannot trust which form you're holding without inspecting the source.

Because of this ambiguity, NEVER compare handles directly. Always use `normalizeHandle()` from `lib/handles.js`, which strips any leading `@` and lowercases:

    import { normalizeHandle } from '@/lib/handles';
    if (normalizeHandle(profile.handle) === 'shamal') { ... }

This rule applies to ALL handle comparisons — client code, server routes, DB filters, and allowlists. Failing to normalize caused the silent-toggle bug (fixed 2026-04-19) and a broken admin-transcripts allowlist (fixed 2026-04-19).

**TODO (deferred):** audit where the client prepends `@` to profile handles and decide whether to normalize at the source. Tracked for post-alpha cleanup.

---

## Architecture

### App Shell / Navigation

Four main tabs, left to right: Lens (/myai), Me (/me), Find (/find), Subs (/subs).
Shamal-only: Feedback (/admin/feedback) appended.

Nav components:
- `components/layout/BottomTabs.jsx` — mobile bottom bar
- `components/layout/Sidebar.jsx` — desktop sidebar
- Icons are Unicode glyphs (◈ Lens, ▢ Me, ⌖ Find, ♡ Subs)

Me tab structure (3-button segmented control in `components/me/MeSegmentedControl.jsx`):
- `/me` → My Recs (default, renders `TasteManager embedded`)
- `/me/taste` → Personal Record (renders `TasteFileView`)
- `/{handle}` → Public Profile (renders `VisitorProfile` for owner)

`/me/timeline` falls through the layout pathname check and keeps the Personal Record segment active — the "How this was built →" link lives inside Personal Record.

Find tab structure (segmented control in `app/(curator)/find/page.js`):
- Network (default) — `NetworkView` (the full curator network)
- Subscribed — `SubscribedView` (recs from curators the viewer subscribes to; two-step query via `mySubscriptionIds` from `useCurator()`)
- Saved — `SavedView`

The segmented control uses "Network" as shorthand for "Curators Network" — the full term is still used everywhere else (vocabulary, prose, internal references). Shortened label is mobile-fit-driven (3 segments on a 375px viewport).

Route history: `/recommendations` was renamed to `/find` on 2026-04-17. The `/recommendations` → `/find` redirect is handled solely by `next.config.js` as a permanent redirect. Middleware no longer references any `curatorOnlyPaths` array — that logic was removed in the April 19, 2026 auth lockdown (see Auth Model section). All internal `router.push('/recommendations/...')` and `router.push('/recommendations/<slug>')` calls were updated to `/find/...` in the rename commit.

### Rec Storage

Two tables — parent/child, both active:
- `recommendations` — flat queryable metadata (title, slug, category, tags, context, links, visibility, profile_id, rec_file_id)
- `rec_files` — canonical structured content blocks (body_md, work, curation, source, provenance, extraction, visibility). See `docs/rec-files-migration.md`.

**`recommendations.created_via`** (analytics-only, not UI) tags each save with its origin — `quick_capture_url|paste|upload`, `chat_rec_block`, `chat_save_from_url|image|taste_read`, `backfill`, or `unknown`. Populated in `addRec` from `item.createdVia`; QCS reads `initialData.createdViaOverride` to distinguish chat-originated saves from direct QCS tab saves.

**`recommendations.image_url` + `rec_files.work.image_url`** — data-layer capture of a thumbnail URL per rec. Populated on every new save (shipped 2026-04-15; no backfill, no UI consumer). Source: parser's `metadata.thumbnailUrl` normalized onto the `parsedPayload.image_url` envelope at each of 6 constructors (parse-link / paste / upload / QCS / CuratorContext re-parse / ChatView chat-parse); upload mode writes `artifact://<sha256>`. Read via `extractImageUrl(parsedPayload)` in `lib/agent/parsers/extract-image.js`.

**Dual-write is unconditional.** Every URL/paste/upload save writes to both tables. Gate: `if (item.parsedPayload)` in `addRec` (CuratorContext.jsx ~line 310). Failures logged, never thrown. All 30 production rows have `rec_file_id` populated as of 2026-04-11.

**Capture flow:** `parse-link / paste / upload` route → `parsedPayload` envelope → client → `addRec` → `recommendations` insert → `ingestUrlCapture` → `rec_files` insert → `recommendations.rec_file_id` update.

**buildRecFileRow** (`lib/rec-files/build.js`) is the single source of truth for the `rec_files` row shape.

**Feature B (chat image → rec):** Camera in ChatView → `/api/chat` vision inference → `save_image_rec:<sha>` action button → QCS prefill → `/api/recs/upload`. `maxDuration = 60` on both routes. Client-side resize to 1600px / JPEG 0.85 keeps payload under Vercel's 4.5MB serverless body limit. Upload `body_md` is just `![Uploaded image](artifact://<sha>)`; title/why render above Archived Source, not inside it.

**RecDetail section order:** Your Take / Why → MediaEmbed (gated by NEXT_PUBLIC_MEDIA_EMBEDS_ENABLED) → Links → Archived Source (body_md) → Tags. Applies to all three variants (Curator/Visitor/Network).

**Archived Source (RecDetail.jsx):** `ArchivedSource` renders `body_md` as ReactMarkdown in a collapsible block below Links, with client-side .md download. Custom `img` renderer (`ArtifactImage`) resolves `artifact://<sha256>` URLs via Supabase signed URLs (7-day TTL); react-markdown v10's `urlTransform` is overridden to whitelist the `artifact://` protocol. Hidden when `extraction.lossy === true` or the extractor is in `THIN_SOURCE_TYPES` (media embeds whose body_md just restates metadata).

**MediaEmbed (RecDetail.jsx):** Inline iframe player for embeddable source types (YouTube, Spotify track/album/playlist/episode, Apple Music song/album/playlist, SoundCloud). Renders between Why and Links. Click-to-play, no autoplay. Returns null for non-embeddable sources, missing media IDs, or when `NEXT_PUBLIC_MEDIA_EMBEDS_ENABLED !== 'true'`. Extractor matching strips `@registry`/`@v1` suffix and normalizes hyphens to underscores (so `apple_music@registry` matches). Source URL read from `links[0].url`. Helper: `lib/recs/embed-url.js` (`deriveEmbedUrl`). Sandboxed and lazy-loaded.

**Curator + Visitor context secondary load** merges `body_md`, `extraction`, `work`, `curation_block`, `curator_is_author` from rec_files onto each tasteItem after the recommendations fetch. Null-safe. Both `CuratorContext` and `VisitorContext` use the same pattern. Both also map `profile_id` onto each tasteItem so rec detail components can pass the rec owner's UUID to `ArtifactImage` (required for signed URL path construction).

`updateRec` syncs `rec_files.curation` (why, tags) and `rec_files.work` (title, category) after every edit. Logs `[UPDATE_REC_FILE]` on success, `[UPDATE_REC_FILE_ERROR]` on failure. Added April 13 2026.

### Chat Route (app/api/chat/route.js)

**Modes:** Onboarding (< 3 recs OR no bio) | Standard (3+ recs AND bio) | Visitor (another curator's /ask page).

Both onboarding and standard inject `getSubscribedRecs(profileId)` network context into the system prompt.

**aiProfile threading.** Route fetches `profiles.ai_profile` early and threads it to every prompt builder. See Staging AI Profile Lane section.

**Link handling:** Synchronous. Up to 3 URLs parsed concurrently (15s timeout) before Claude responds. Quality signals (FULL/PARTIAL/FAILED) injected as `=== PARSED LINK CONTENT ===` blocks. Parsed content persisted on `chat_messages.parsed_content` and re-injected within a 5-message window via `distillForReinjection` (~800 chars/block, capped at 2 blocks). **Re-injection path:** Checks `rec_refs` on recent messages -- if present, fetches `rec_files` rows and injects structured blocks via `buildRecFileContextBlock` (`lib/chat/link-parsing.js`). No fallback to `parsed_content` -- if `rec_refs` is empty, re-injection is skipped. The `parsed_content` fallback was removed April 13 2026.

**Taste-read re-injection cap:** `parsed.content` capped at 40K chars before injection into systemPrompt (matches primary parse path). Uses `truncateOnBoundary` (`lib/chat/link-parsing.js`) for paragraph/sentence/line-aware cutting; emits `[TASTE_READ_REINJECTION] Capped content from <original> to <capped> chars` when truncation fires. 40K retained as-is — taste-read is the deep-reading moment and a smaller cap would truncate substantive article content mid-piece. Boundary-aware upgrade and log marker added April 15 2026.

**Chat-parsed URLs:** `ingestChatParsedBlocks` (`lib/chat/chat-parse-ingest.js`) writes a `rec_files` row (`extractor: chat-parse@v1`, `visibility: private`, `confirmed: false`) and populates `chat_messages.rec_refs` for each successfully parsed URL. Awaited with 2s timeout before response returns. These rows are ephemeral scratch records -- they exist for re-injection context, not as canonical archive entries.

**Chat-save promotion flow:** When a curator saves a `chat-parse@v1` URL, `addRec` synchronously re-fetches via `/api/recs/parse-link` for a fresh `webpage@registry` payload, then `/api/recs/promote-chat-parse` marks the scratch row confirmed, then `ingestUrlCapture` writes the canonical `rec_files` row. `recommendations.rec_file_id` always points to the registry row. Re-parse failure falls back to the chat-parse payload. **Re-parse logic lives in `addRec` only** — no other UI surface should re-parse.

**draftWhyFromConversation** (ChatView.jsx) extracts the curator's own words from recent chat history to prefill the "why" field. Skips URL-only messages (`/^https?:\/\/\S+$/`), messages shorter than 15 chars after URL removal, and meta-actions (save/skip buttons). Truncates at 200 chars on a word boundary.

**Rec capture:** AI emits `[REC]{...}[/REC]` JSON. `validateRecContext` strips metadata pollution, falls back to last substantive user message (skips pure affirmations).

**Action Buttons emitted by chat route.** The chat route emits structured `action_buttons` blocks that ChatView intercepts via onSendMessage. Current action strings in production:

- `save_rec_from_chat:<url>` — "Add as recommendation" button on URL drops. Opens QuickCaptureSheet prefilled with the URL. Part of the three-option URL-drop block (see below).
- `taste_read:<url>` — "Taste read" button on URL drops. Client intercept sends "Do a taste read on <url>" to chat, triggering the `tasteReadUrl` short-circuit at `app/api/chat/route.js:232` which emits a TasteReadCard block. Synchronous, uses in-process parsers.
- `discuss_link:<url>` — "Just talk about it" button on URL drops. Silent meta-action, logs choice to `dropped_links` via `/api/dropped-links/mark-action`, does not send anything to the chat route.
- `save_image_rec:<sha256>` — Feature B chat-image-to-rec flow. Intercepted in ChatView, opens QuickCaptureSheet in upload mode with pre-uploaded artifact.
- `save_rec_from_taste_read:<url>` — Button on TasteReadCard footer. Opens QuickCaptureSheet with blank why (taste read context is not curator's why).

**Post-save reflection injection (rewritten April 26, 2026, commit 4131744).** After every rec save, `ChatView.jsx` fires a follow-up `/api/chat` POST whose user-message body is a `[SYSTEM: ...]`-prefixed instruction set. Two injection sites: line 227 (`handleQuickCaptureSaved`, fired after QuickCaptureSheet save) and line 850 (`handleSaveCapture`, fired after inline rec-capture-card Save button). The injection is the most proximal authority on post-save behavior — more proximal than any system-prompt rule. Both sites now carry charter-aligned constraints inline: max 2 sentences, exactly one question mark, no verdicts about the curator, no synthesis across multiple recs, no padding with examples not in the saved rec content, pick from POST-SAVE MOMENT skill question patterns. The previous version instructed the AI to "Connect it to patterns you see. Be specific and insightful," which produced verdict-laden responses that violated charter on every save. Universal — applies to both stable and staging paths since the injection ignores `aiProfile`. If post-save behavior drifts in the future, debug the injection text in `ChatView.jsx` FIRST. Do not start with skill files.

**System prompt enhancements (added April 26, 2026, commit 7d180aa).** Two universal additions to chat route system prompt construction, applied to both onboarding and standard branches, regardless of `aiProfile`:

(1) **Date header.** Today's date is computed once via `toLocaleDateString` and prepended to `systemPrompt`. Tells the AI what day it is so references like "this year," "lately," or "recent" land correctly. Partial fix for date hallucination — model still occasionally guesses wrong on relative date math, but absolute date claims are now grounded.

(2) **Taste profile reference-document framing.** `tasteProfileBlock` is now wrapped in `=== CURATOR REFERENCE DOCUMENT === ... === END REFERENCE DOCUMENT ===` markers with explicit instruction: "Use as factual reference: who they are, what they have saved, what domains they cover, how they communicate. Do NOT mirror its verdict-shaped voice in your responses. Do NOT restate its thesis at them. The document is for your context only. Your responses follow the charter and skill files, not the document's voice." Disambiguates document-as-data from document-as-voice. Necessary because the taste profile document (generated by `lib/taste-profile/generate.js`) contains thesis-shaped sections that the chat AI was naturally mirroring. Long-term fix is reshaping the document itself; deferred pending Record purpose definition.

**Three-option URL-drop block.** Emitted unconditionally on ANY URL drop (including failed parses), subject to three suppression conditions:
1. The URL actually produced a parsedLinkBlock entry (even failed parses push a block)
2. No `[REC]...[/REC]` block was also emitted in the same turn (`!recCapture` guard)
3. The current message is not itself a follow-on triggered by one of these buttons (`!isFollowOnFromButtons` guard, at `app/api/chat/route.js:837`, prevents button loops)

**REC_LINK sentinel:** Rec lines in network context carry `[REC_LINK: /<handle>/<slug>]`. Prompt instructs AI to render as markdown links. Canonical rec URL: `/{handle}/{slug}`.

**Tool use (Anthropic):** `get_curator_stats` registers only when `!isVisitor && !isOnboarding && !!profileId` via a one-hop loop around the primary `messages.create`. Definition + handler: `lib/chat/stats-tool.js`. Compute + per-lambda 10-min cache: `lib/chat/curator-stats.js`. Skill: `lib/prompts/skills/curator-stats.md`. Text extraction uses `response.content.find(b => b.type === 'text')?.text` — do NOT revert to `content[0].text`; on tool-use turns the first block is `tool_use` and that path silently drops the reply. Sets the convention for future Anthropic tools in this route: curator-only gate, one-hop loop, handler returns `{success, stats}` or `{success, error}`.

### AI Skills System

17 skill files in `lib/prompts/skills/`, mirrored to `lib/prompts/skills/staging/` for the staging AI lane (see Staging AI Profile Lane section). Build functions: `buildOnboardingPrompt` and `buildStandardPrompt` in `lib/prompts/`. Both append `SUBSCRIPTION_GROUNDING_RULE` (must stay in sync between the two files). Both also accept an `aiProfile` arg threaded through to every `loadSkill` call.

**rec-capture.md skill:** Save threshold evaluation is cumulative across the conversation. Once a descriptor is given in any message, threshold is met -- no further clarifying questions permitted. AI-005 (`docs/ai-behavior-issues.md`) tracks the multi-question drilling failure mode.

### Staging AI Profile Lane (shipped April 22-26, 2026)

Opt-in lane for evaluating AI personality changes without affecting alpha users. Gated by `profiles.ai_profile` ('stable' | 'staging', default 'stable'). Currently scoped to @shamal and @chris.

**Skill routing.** `loadSkill(name, aiProfile = 'stable')` in `lib/prompts/loader.js` reads from `lib/prompts/skills/<name>.md` for stable, `lib/prompts/skills/staging/<name>.md` for staging. The staging folder is a byte-identical copy of stable until charter work begins. `[SKILL_LOAD]` logs fire on staging reads only.

**Threading.** `buildOnboardingPrompt` and `buildStandardPrompt` accept an `aiProfile` arg and pass it to every `loadSkill` call. `buildVisitorPrompt` accepts the param as a no-op (visitor prompt isn't skill-based yet). The chat route (`app/api/chat/route.js`) and taste-read route (`app/api/taste-read/route.js`) both fetch the caller's `ai_profile` early via `profiles.ai_profile` and thread it through. Logged as `[AI_PROFILE] route=<chat|taste-read> profileId=... aiProfile=...`. Fetch failures fall through to 'stable' under `[AI_PROFILE_FETCH_ERROR]`.

**Lens Charter (shipped April 24-26, 2026).** `lib/prompts/skills/staging/charter.md` (5,322 chars) defines the AI's role, three turn branches (capture/discover/talk-through), five banned behaviors (verdicts, rephrasing, multi-questions, speculative riffs, filler reactions), direct-ask exception, honesty-about-reads requirement, and em-dash ban. Loads FIRST in staging prompt builders via conditional spread `...(aiProfile === 'staging' ? [loadSkill('charter', aiProfile)] : [])` in both `buildOnboardingPrompt` and `buildStandardPrompt`. Stable path is byte-identical (spread evaluates to `[]`). Five staging skill files were pruned during charter install to remove redundant guidance: `base-personality`, `taste-reflection`, `trust-building`, `onboarding-approach`, `standard-approach`. Net staging system prompt is ~3,253 chars shorter than stable. The stable `lib/prompts/charter.md` placeholder still exists but is never read by the loader.

**Direct-ask exception (added April 26, 2026).** Added paragraph in charter Personality section after the five banned behaviors, before "When the save threshold is met, act." Carves out: when curator explicitly asks AI to characterize their taste, summarize their Record, or share what's been noticed, give substantive cite-rich answer ending with confirmation invitation. Closes the gap where the AI either refused taste questions or violated charter to answer them. Discovered empirically through testing.

**Eval signal: thumbs.** `components/chat/AIResponseThumbs.jsx` renders ▲/▼ buttons below every AI message for staging users. Wired into `ChatView.jsx` at both AI message render branches (FeedBlockGroup variant and FeedLegacyBubble variant). Visitor chat is NOT wired. Optimistic UI with revert-on-failure; initial ratings hydrated via batched GET. Component uses a `lastSyncedRef` plus an `onRatingChange` callback so the parent's `ratingsByMessageId` cache stays in sync after each successful write — don't simplify to plain mount-time `useState(initialRating)`, that ignores async hydration and causes persistence bugs.

**Ratings storage.** `ai_response_ratings` table with `UNIQUE (message_id, profile_id)` constraint. Endpoints: `app/api/ai-response-ratings/route.js` (POST/DELETE/GET) using the dominant codebase auth pattern (`createServerClient` + `getAll/setAll` cookies + `getUser()`, then `auth_user_id → profiles.id` lookup). The `ai_profile` column on each row is **snapshotted at first-rating time (insert)** — subsequent flips update only `rating`, leaving `ai_profile` frozen. POST does insert-or-update via existence check (NOT upsert) to preserve this invariant. Logged as `[AI_RATING] op=insert|update`; clears as `[AI_RATING_CLEARED]`.

**`profile.aiProfile` exposure.** `useCurator()` exposes `profile.aiProfile` (camelCase). Surfaced from `prof.ai_profile` (snake_case DB column) in three `setProfile({...})` call sites in `context/CuratorContext.jsx`. Defaults to 'stable' on null.

### Taste Profile Pipeline

Generated by `lib/taste-profile/generate.js` via `POST /api/generate-taste-profile`. Auto-regenerates after every rec save (3+ rec threshold, fire-and-forget from ChatView.jsx). Enriched from `rec_files` — prefers `work.title`, `work.authors`, `work.site_name`, `curation.why`, `curation.tags`, `curation.conviction` over legacy `recommendations` columns. `sources.generated_from` = `'rec_files+recommendations+subscriptions+confirmations'`. Stats section includes a "N taste signals confirmed or corrected" bullet. `taste_profiles.sources` breaks out `taste_read_confirmed_count` and `taste_read_corrected_count` from the total `confirmation_count`.

**Visitor AI personality** reads `taste_profiles.content`. `lib/taste-profile/parse.js` exposes `extractPublicSections(content)` (strips `## Curators They Subscribe To` onward) and `extractVoiceAndStyle(content)` (the `## Voice & Style` body). Visitor path in `app/api/chat/route.js` injects public sections as taste context and Voice & Style as a voice directive; falls back to a neutral default when no profile exists. The legacy `profiles.style_summary` column was deprecated on 2026-04-15 (readers/writers removed) and dropped on 2026-04-16 via `migrations/20260415_drop_style_summary_from_profiles.sql`.

### Taste Read v2 (shipped April 14, 2026 across deploys 2.0-2.4)

**What it is:** Per-URL taste reads that produce structured extraction + 2-3 atomic inferences. Curator confirms, refines, or ignores each inference. Confirmed/refined inferences feed the taste profile via `taste_confirmations`. Ignored inferences are logged only.

**Key files:**
- `lib/prompts/skills/taste-read.md` — the skill. Outputs JSON `{extraction, inferences: [{id, text}]}`.
- `app/api/taste-read/route.js` — GET (hydrate from DB) + POST (generate or cache hit). Model pinned to `claude-sonnet-4-20250514`, max_tokens 1500, temp 0.7, maxDuration 30.
- `app/api/taste-read/confirm/route.js` — POST (write) + DELETE (undo).
- `app/api/taste-read/refine/route.js` — POST (write) + DELETE (undo).
- `app/api/taste-read/ignore/route.js` — POST (write) + DELETE (undo).
- `app/api/taste-read/state/route.js` — PATCH for UI state sync (states, refined_texts, collapsed, dismissed, done).
- `components/taste-read/TasteReadCard.jsx` — card component. Module-level cache is render-speed only; server is authoritative.
- `components/feed/FeedBlockGroup.jsx` — renders `taste_read_card` block type.

**Database:**
- `taste_reads` — new table. Stores extraction, inferences (jsonb), per-inference states, refined_texts, collapsed, dismissed, done. Partial unique indexes on `(profile_id, source_url) WHERE rec_file_id IS NULL` and `(profile_id, rec_file_id) WHERE rec_file_id IS NOT NULL`. RLS enabled.
- `taste_read_ignores` — new table. Ignored inferences log, curator-only.
- `taste_confirmations` — existing. New source format: `taste_read:<url_or_rec_file_id>` and `taste_read:<key>|refined_from:<original>`. Legacy `chat:<msgId>` rows from pre-v2 left as-is (both formats supported).

**Flow:** Curator pastes URL in chat → taps "Taste read" button → chat route emits `taste_read_card` block with parsed content payload → TasteReadCard on mount checks in-memory cache → GET `/api/taste-read` → 404 triggers POST (Claude call + INSERT) → card renders extraction + inferences. State transitions PATCH fire-and-forget to `/api/taste-read/state` for UI state sync. Confirm/refine/ignore POST to their dedicated endpoints (which write to `taste_confirmations` / `taste_read_ignores` and trigger taste profile regen).

**Done state semantics:** When all inferences resolved, "Done" button appears. Clicking Done sets `done: true, collapsed: true`. Reload hydrates from DB in collapsed summary state. Tap-to-expand shows finalized view (Undo links active, no Confirm/Refine/Ignore buttons). Any Undo from done state flips `done: false` server-side — card becomes live again.

**Dismiss state:** Sticky via DB. Dismissed cards render null on mount. Only available when no inferences are resolved.

**Action buttons:**
- `save_rec_from_taste_read:<url>` — from TasteReadCard footer. ChatView handler routes to `handleSaveFromChat(url, { skipWhyDraft: true })` — QCS opens with blank why field (taste read context is not the curator's why).
- `save_rec_from_chat:<url>` — from pre-taste-read three-button row. Unchanged from Feature C.

**What's NOT wired yet:**
- QuickCaptureSheet integration (TasteReadCard rendering after URL/paste save). Deferred per Option Y (portal/modal at page level after QCS closes).

**Log markers:** `[TASTE_READ_V2]` (main read), `[TASTE_READ_CONFIRM]` / `[TASTE_READ_REFINE]` / `[TASTE_READ_IGNORE]` (writes), `[TASTE_READ_CONFIRM_UNDO]` / `[TASTE_READ_REFINE_UNDO]` / `[TASTE_READ_IGNORE_UNDO]` (deletes), `[TASTE_READ_STATE_PATCH]` (UI state sync).

### Taste Timeline (shipped April 14, 2026)

Curator-only audit trail at `/me/timeline`. Shows every signal that shaped the taste profile in reverse chronological order, grouped by local date. Entry point: "How this was built →" link in Me tab below Stats section (`TasteFileView.jsx`).

**Key files:**
- `app/api/timeline/route.js` — GET, cursor-paginated 50/page. Merges taste_confirmations (confirmed + corrected), taste_read_ignores (fetched, filtered from UI), and recommendations. Parses taste_read source field format. Two-step Supabase queries throughout.
- `app/(curator)/me/timeline/page.js` — auth-guarded page. Note .js not .jsx (project convention).
- `components/me/TasteTimeline.jsx` — timeline UI. Uses T constants for theming. Groups by local date. Type labels: "Taste read · confirmed/corrected", "Your Recommendation" (rec_is_own: true), "Saved Recommendation" (rec_is_own: false, deferred).

**Event types:** confirmed (green #1D9E75), corrected (amber #BA7517, shows struck-through original + corrected), ignored (stored in DB, filtered from UI), rec_saved with rec_is_own: true (blue, "Your Recommendation"), rec_is_own: false (purple, "Saved Recommendation" — deferred until saved_recs wired).

**Log markers:** [TIMELINE], [TIMELINE_ERROR]

### Inviter Pipe & Auto-subscribe

`getInviterContext` in `lib/chat/inviter-context.js` — three independent `.maybeSingle()` lookups so one failure doesn't wipe the rest. Auto-subscribe route: `app/api/onboarding/auto-subscribe/route.js` — service-role, idempotent, race-safe (treats `23505` as success), non-blocking.

---

## Auth Model

Site-wide auth lockdown shipped April 19, 2026. Chokepoint is `middleware.js`. Policy:

**Public routes (no auth required):**
- `/login`, `/signup`, `/onboarding`, `/onboarding/welcome`, `/forgot-password`, `/reset-password`
- `/email/saved`, `/email/unsubscribed` (email action landing pages)
- `/` — unauthed splash/waitlist. Authed users redirect to `/myai`.

**Public API routes (no auth required, enforced in middleware):**
- `/api/auth/callback`, `/api/auth/signup`, `/api/waitlist`, `/api/email-action`

**All other `/api/*` routes:** middleware passes through without session check. Each route handler enforces its own auth. This pattern lets routes like `/api/notify/*` do session + ownership checks internally while letting cron/token-authed routes like `/api/email-action` continue to work.

**All other routes:** require authed session. Unauthed requests redirect to `/login?redirectTo=<encoded-original-path-with-querystring>`.

**`redirectTo` open-redirect protection** (in `app/login/page.js`): after sign-in, the redirectTo param is validated before use:
- Must start with `/`
- Must NOT start with `//` or `/\` (prevent protocol-relative and backslash tricks)
- Must NOT be `/login` or `/signup` (prevent loops)
- If unsafe or absent, fall back to `/myai`
- Onboarding-incomplete always forces `/onboarding` regardless of redirectTo

**SEO lockdown:** `app/layout.js` metadata includes `robots: { index: false, follow: false, googleBot: { index: false, follow: false } }`. `app/robots.js` serves `User-Agent: *\nDisallow: /` to all crawlers.

---

## Admin Access Model

Two admin surfaces exist, with different access policies:

- **`/admin/feedback`** — Shamal-only. Client-side handle check gates rendering.
- **`/admin/transcripts`** — Full access for BOTH `shamal` and `chris` (no per-curator scoping). Previously `chris` was restricted to own-transcripts; restriction removed April 19, 2026 per founder decision (CK is a collaborator on AI personality, not just a tester). Server-side allowlist enforced in `app/api/admin/transcripts/route.js`: both handles must normalize via `normalizeHandle()` to either `shamal` or `chris` or the route returns 403.

Both admin pages perform handle normalization via `lib/handles.js` — do not add new admin pages that compare handles without the helper.

---

## Tester Access Model

Three operational modes determine what behavior a curator experiences:

- **Stable behavior** — what every curator experiences by default. `ai_profile = 'stable'`, no special flags.
- **Staging AI** — opt-in via `profiles.ai_profile = 'staging'`. Currently scoped to @shamal and @chris. Loads charter and pruned staging skill files. See Staging AI Profile Lane section.
- **Tester features** — opt-in via `profiles.is_tester = true` (boolean column added April 26, 2026, commit 7d180aa). Currently scoped to @shamal and @chris. Gates tester-only UI features.

These three modes are independent. A curator can be `is_tester=true` without being on staging, or vice versa. They serve different purposes: `ai_profile` toggles AI personality, `is_tester` toggles UI/workflow features.

Currently gated by `is_tester`:

- Save silently toggle in QuickCaptureSheet (suppress subscriber email alerts on save)

**Surfacing.** `useCurator()` exposes `profile.isTester` (camelCase). Surfaced from `prof.is_tester` (snake_case DB column) in three `setProfile({...})` call sites in `context/CuratorContext.jsx`. Defaults to `false` on null.

Use this column for any future tester-only features. Do NOT add hardcoded handle checks (e.g., `profile.handle === 'shamal'`) for tester-only behavior — those become debt the moment you add a second tester. The `is_tester` flag is set via SQL, allowing tester onboarding/offboarding without code deploys.

---

## What's Not Wired Yet

- `buildSubscriberPrompt`: skill file exists, no build function or route wiring
- Visitor prompt not extracted to skill system
- AI web search for link lookup
- Taste Read v2: QuickCaptureSheet integration deferred (Option Y, portal/modal at page level after QCS closes)
- Taste Timeline: ignored events stored in DB but not shown in UI — future consideration
- Taste Timeline: Saved Recommendation type (rec_is_own: false) — deferred until saved_recs table is wired into timeline API
- Stable charter: `lib/prompts/charter.md` placeholder still exists but is never read. Charter is staging-only by design. Stable can stay as-is; if needed in stable later, copy from `lib/prompts/skills/staging/charter.md` and add to stable prompt builders.
- Taste profile architectural reshape: `lib/taste-profile/generate.js` produces a thesis-shaped document that creates upstream pressure on chat AI to mirror verdict voice. Mitigated short-term via reference-document framing in chat route system prompt. Long-term reshape (split markdown into voice + factual versions, OR full structured-claims rewrite) DEFERRED pending Record purpose definition. Do not attempt without strategic input.
- `agent/taste-read/route.js` prescriptive prompt: flagged HIGH-severity in April 26 audit but intentionally left as-is. Verdicts at this surface are the product (curator confirms → Record). Charter does NOT apply to taste-read route. Revisit only if Record purpose work explicitly addresses taste-read flow.

---

## Email Notification System

**Subscriber notifications (Phase 1):** Real-time email to active account-holder subscribers when a curator saves a public+approved rec. Fire-and-forget from `addRec` → `POST /api/notify/new-rec`, never blocks the save. Trigger gate reads the DB-returned row (not the client object). Recipients: `subscriptions` where `unsubscribed_at IS NULL` and `profiles.new_rec_email_enabled = true`; email looked up via `supabase.auth.admin.getUserById(auth_user_id)`. Unsubscribe is token-based (`generateEmailToken(... 'unsubscribe', { type: 'new_rec_email' })`) and flips `profiles.new_rec_email_enabled`. Logged as `notification_log` rows with `type='new_rec_realtime'`.

Pure email subscribers (`subscribers` table) and rich content (authors/thumbnails/excerpts) deferred.

Key files: `app/api/notify/new-rec/route.js`, `lib/email-templates.js` (`newRecEmail`), `app/api/email-action/route.js` (`new_rec_email` branch).

**Auth and ownership (added April 19, 2026).** Both `/api/notify/new-rec` and `/api/notify/new-subscriber` now require an authed Supabase session AND an ownership check:
- Session check via `createServerClient` + `getSession()` — returns 401 if no session
- Ownership check: caller's `profiles.id` (looked up via `auth_user_id = session.user.id`) must match the `curatorId` (for new-rec) or `subscriberId` (for new-subscriber) from the request body. Returns 403 on mismatch.
- Since both callers are client-side (CuratorContext and VisitorProfile), the authed browser session cookie rides along automatically on fetch — no header manipulation needed.

**Silent save flag (added April 19, 2026).** `/api/notify/new-rec` accepts an optional `silent: true` in the POST body. When present, the route early-returns `{ skipped: true, reason: 'silent' }` with a `[NOTIFY_SKIPPED]` log line before any email logic runs. The rec still saves and still appears in subscriber feeds — only suppresses the instant email alert. Exposed via a curator-opt-in checkbox in QuickCaptureSheet, gated to `profiles.is_tester = true` (refactored from hardcoded handle check on April 26, 2026, commit 7d180aa). Toggle resets to OFF on every sheet open (sticky silent was ruled out as a footgun).

---

## Feedback System

Testers submit feedback via `components/chat/FeedbackSheet.jsx` (text + optional screenshot). Submit posts to `app/api/feedback/route.js`.

**Flow.** Insert `feedback` row with `.select('id').single()` to retrieve `feedback_id` → if `screenshot_base64` present, decode + SHA-256 hash + upload to `artifacts/feedback/<feedback_id>/<sha>.jpg` via `supabase.storage.from('artifacts').upload()` (direct call, NOT `uploadArtifact` — feedback screenshots have no value in dedup-by-curator) → on upload success, update row with `screenshot_path` → generate 7-day signed URL → send email via Resend with screenshot line inline.

**Client-side image handling.** No pre-resize size gate (would reject normal iPhone screenshots needlessly). Screenshot resized to 1600px long-edge JPEG 0.85 quality (same pattern as Feature B chat-image upload, inlined into FeedbackSheet — no shared helper). Post-resize safety check: reject if base64 > 5.5MB (~4MB raw bytes after base64 overhead). HEIC/HEIF rejected with explicit message — Chrome/Firefox can't decode them.

**Failure handling.** Screenshot upload failures (`[FEEDBACK_SCREENSHOT_UPLOAD_ERROR]`) and signed URL generation failures (`[FEEDBACK_SIGNED_URL_ERROR]`) NEVER block feedback submission — text feedback persists and email sends, just without the screenshot link. If upload succeeds but row update fails, the orphaned storage object stays; logged for manual cleanup.

**Email body.** Inline plain-text in the route. Screenshot line appears immediately after `Handle:` when `screenshotSignedUrl` is set; omitted entirely otherwise. No HTML body. No template extraction (`lib/email-templates.js` not involved).

---

## Key Log Markers

Primary filters (grep on these when debugging end-to-end flows): `[TASTE_READ_V2]`, `[TIMELINE]`, `[rec-files]`, `[chat-parse-ingest]`, `[taste-profile]`, `[NOTIFY_NEW_REC]`, `[INVITER_CONTEXT]`, `[AUTO_SUBSCRIBE]`, `[UPDATE_REC_FILE]`, `[AI_PROFILE]`, `[AI_RATING]`, `[FEEDBACK_SCREENSHOT_UPLOADED]`.

Each area has a matching `_ERROR` / `_FAILED` / `_UNDO` variant — grep the code for the full set when you need it.

Additional markers with specific payloads worth documenting:

- `[NOTIFY_SKIPPED]` — Logged by `/api/notify/new-rec` when `silent: true` is set in body or (historical) when handle was in NOTIFICATION_SKIP_HANDLES (that env var was removed). Payload: `{ recId, curatorId, reason }`.
- `[ADMIN_TRANSCRIPTS_ACCESS]` — Logged by `/api/admin/transcripts` on every authed call. Payload: `{ caller_profile_id, caller_handle, filterDays }`. Use for auditing admin data access.
- `[AI_PROFILE]` — Chat and taste-read routes log every authed request: `route=<chat|taste-read> profileId=... aiProfile=<stable|staging>`. Confirms a tester is being routed to the staging skills.
- `[SKILL_LOAD]` — `lib/prompts/loader.js` logs `profile=staging skill=<name>` on every staging-folder read. Stable reads are silent. Confirms which skills got loaded for a given turn.
- `[AI_RATING]` — `app/api/ai-response-ratings/route.js` POST logs `profileId=... messageId=... rating=<up|down> aiProfile=<snapshot> op=<insert|update>`. The `aiProfile` value is the SNAPSHOT (frozen at first-rating time), not the caller's current value.

---

## Source Parsers (lib/agent/parsers/)

9 parsers: Spotify, Apple Music, YouTube, SoundCloud, Letterboxd, Goodreads, Google Maps, Twitter/X, Generic Webpage (Defuddle — universal fallback). Instagram and Bandcamp deferred.

---

## Key File Paths

Non-obvious load-bearing files. Everything else is findable by Glob.

components/layout/BottomTabs.jsx           -- mobile nav, 4 main tabs + shamal-only feedback
components/layout/Sidebar.jsx              -- desktop nav, mirrors BottomTabs
components/me/MeSegmentedControl.jsx       -- 3-button Me tab nav (My Recs / Record / Public Profile)
app/(curator)/find/page.js                 -- Find tab root, Network + Subscribed + Saved segmented control
app/(curator)/me/page.js                   -- Me default, renders TasteManager embedded (My Recs)
app/(curator)/me/taste/page.js             -- Personal Record (TasteFileView)
app/api/chat/route.js                      -- mode detection, link handling, rec extraction
lib/prompts/onboarding.js, standard.js     -- system prompt builders (both carry SUBSCRIPTION_GROUNDING_RULE)
lib/prompts/loader.js                      -- loadSkill(name, aiProfile = 'stable'). No cache (removed 2026-04-21)
lib/prompts/charter.md                     -- root charter placeholder (HTML comment, awaits charter approval)
lib/prompts/skills/staging/                -- mirror of skills/, byte-identical until charter work begins
lib/chat/inviter-context.js                -- getInviterContext
lib/chat/network-context.js                -- getSubscribedRecs + REC_LINK sentinel
lib/chat/link-parsing.js                   -- distillForReinjection
lib/chat/chat-parse-ingest.js              -- chat URL → rec_files ingest, rec_refs writer
context/CuratorContext.jsx                 -- addRec dual-write, chat-save promotion, secondary rec_files load
components/chat/ChatView.jsx               -- chat UI, rec save, taste profile regen trigger
components/recs/RecDetail.jsx              -- CuratorRecDetail / VisitorRecDetail / NetworkRecDetail
components/recs/ArtifactImage.jsx          -- resolves artifact:// URLs to signed URLs (7-day TTL)
components/recs/MediaEmbed.jsx             -- inline media player, gated by NEXT_PUBLIC_MEDIA_EMBEDS_ENABLED
lib/recs/embed-url.js                      -- deriveEmbedUrl({ extractor, sourceUrl, mediaId })
lib/rec-files/build.js                     -- buildRecFileRow, single source of truth for rec_files shape
lib/rec-files/ingest.js                    -- ingestUrlCapture, dual-write entry point, never throws
lib/handles.js                             -- normalizeHandle() helper. ALL handle comparisons must route through this (strips @ prefix + lowercases). See "Data patterns" section above.
lib/taste-profile/generate.js              -- taste profile generation
lib/email-templates.js                     -- newSubscriberEmail, weeklyDigestEmail, agentCompletionEmail, newRecEmail
lib/email-tokens.js                        -- generateEmailToken, validateEmailToken, markTokenUsed
app/api/email-action/route.js              -- token-based dispatch (unsubscribe, save_rec, update_settings)
components/taste-read/TasteReadCard.jsx    -- hydrate, render, confirm/refine/ignore/undo, done/dismiss
components/me/TasteTimeline.jsx            -- timeline UI (grouped by local date)
scripts/backfill-rec-files.mjs             -- backfill: --curator <handle> | --all --live
app/api/ai-response-ratings/route.js       -- staging eval thumbs (POST/DELETE/GET; ai_profile snapshotted at insert)
components/chat/AIResponseThumbs.jsx       -- staging-only ▲/▼ buttons; lastSyncedRef + onRatingChange pattern
app/api/feedback/route.js                  -- feedback insert + optional screenshot upload + Resend email
components/chat/FeedbackSheet.jsx          -- feedback modal with optional screenshot file input

---

## Schema Reference

Full schema with column types: `docs/schema.md`
Rec files migration history and architecture decisions: `docs/rec-files-migration.md`

---

## Tooling

### Supabase MCP (Claude Code only)

Supabase MCP is configured for this project in read-only mode, scoped to the curators-ai project.

- Available in Claude Code sessions only. Not available in claude.ai threads.
- Read-only: all queries execute as a read-only Postgres user. Writes are not possible through MCP.
- Use for pre-implementation recon: confirm column names, function signatures via schema inspection, row counts, and data shapes before writing handoffs.
- Do NOT paste untrusted content (scraped URLs, email bodies, user-submitted text) into sessions with MCP active — prompt injection risk.
- For writes (migrations, backfills, manual fixes): continue using Supabase SQL Editor with explicit statement review. Never relax MCP to read-write.

Example recon queries the MCP can answer directly:
- "List columns on rec_files"
- "Count recs grouped by created_via in the last 30 days"
- "Show me the 5 most recent rows in chat_messages"
