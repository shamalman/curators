# Record Architecture

**Curators Reference Document**

**Last updated:** May 3, 2026 (v3: confirmed Reads as first-class Record inputs; regen-policy framework; QCS/inline asymmetry resolved; LENS-001/002/003 resolved; framing reaffirmed for all users regardless of mode)

## Purpose of this doc

This is the durable reference for the Record: what it is, who it serves, how it's structured, how it changes, and what is intentionally out of scope. It supersedes the strategic-spec stage of `curators-taste-profile-architecture.md` (March 17, 2026) by codifying the decisions actually shipped through May 3, 2026.

When this doc and the code disagree, the code is authoritative; this doc gets updated. When this doc and `curators-taste-profile-architecture.md` disagree, this doc is authoritative.

## What the Record is

Every user on Curators has a Record. The Record is an evolving snapshot of a user's taste, preferences, and perspectives, inferred from their recommendations, confirmations of Reads, the recommendations from others they validate or save, and the curators they directly subscribe to.

Users on Curators are not strictly curators or subscribers. Many users do both: making recommendations in some domains while seeking recommendations in others. The Record and the user's AI (Lens) serve all users regardless of which mode they spend more time in. When this doc says "user," it means anyone with a Record, which is everyone.

Where the term "curator" appears, it means a user acting in curation mode (making recommendations, confirming Reads, declaring taste). Where "subscriber" appears, it means a user acting in discovery mode (seeking recommendations, subscribing to curators, validating others' recs). The same person can be both at different moments. The Record and Lens AI accommodate both.

The Record is not a single artifact. It is a two-layer system: a verbatim ledger of every signal the user has produced, and a generated interpretation built on top of it.

## The five inputs

The Record is built from five distinct signals, weighted by strength:

| # | Input | Weight | Status | Notes |
|---|---|---|---|---|
| 1 | Recommendations | Highest | Shipped | Active vouching. The strongest signal a user can produce. |
| 2 | Validations (received + given) | High | Not built | Will outweigh Reads when wired. Forward-spec'd, not yet feeding the Record. |
| 3 | Confirmed Reads | Medium-high | Shipped | First-class input as of May 3, 2026. Not supplementary to recommendations. |
| 4 | Saves of others' recs | Medium | Deferred | Will feed the Record when validation patterns are understood. |
| 5 | Subscriptions | Lowest | Shipped | Domain trust signal. Treated as consumption signal, not taste signal. |

### Why this hierarchy

**Recommendations** are unambiguous. The user vouched. Public commitment.

**Validations** (when built) close the loop on whether taste actually transfers. Validations given reveal what the user responds to. Validations received reveal what the user's taste reliably delivers. Both feed the Record but answer different questions.

**Confirmed Reads** are interpretation chips the user explicitly confirmed. The link is the artifact; the confirmed interpretation is the signal. Reads exist as a low-confidence on-ramp for users who consume but don't recommend often. A subscriber who reads voraciously, saves selectively, and rarely recommends has a thin Record without Reads. With them, the Record fills in from what shaped the user's thinking, not just what they vouched for publicly.

**Saves** are intent signals but private and low-cost. Saving is not the same as endorsing.

**Subscriptions** signal domain trust, not taste alignment. Subscribing to a curator means "I find their curation interesting" — not "my taste is like theirs." Subscriptions inform domain context but should not generate interpretation on their own.

### The honesty floor

Lens declines to write an interpretation it cannot defend from the source material.

- For **Reads**: thin articles produce no chips. The user can't confirm what wasn't generated. Empty Records stay empty.
- For **subscriptions-only users**: the Record does not fabricate interpretation from subscriptions alone. Subscriptions appear as a list of trusted curators. Working Interpretation, Domains, and Patterns require at least one rec or one confirmed Read.
- For **the document overall**: every claim in Working Interpretation, Domains, and Patterns must trace to a specific rec or confirmation. No invented observations.

This protects trust. A Record that overreaches erodes the user's confidence in everything else Lens does.

## The two layers

### Layer 1: The Timeline (verbatim ledger)

The timeline is the source of truth. Every confirmation, correction, and rec save the user has ever produced is recorded here, verbatim, with timestamps, in chronological order.

- **Surface:** `/me/timeline` page, rendered by `components/me/TasteTimeline.jsx`.
- **Job:** Auditable record. The user can trace exactly what they confirmed, when, and what the original observation said.
- **Properties:** Append-only. Chronological. Verbatim. Source of truth.
- **What lives here:** `taste_confirmations` rows (confirmed + corrected, ignored filtered from UI), `recommendations` rows.
- **What never lives here:** Interpretations, summaries, theses. Anything the AI synthesized. Anything that wasn't a direct user action.

### Layer 2: The Taste Profile Document (interpretation)

The taste profile document is the AI's structured interpretation of what the timeline shows. It is what other AI systems read, what visitors see at `/me/taste`, and what the user's own Lens uses as grounding context.

- **Surface:** `/me/taste` page, rendered by `components/me/TasteFileView.jsx` from `taste_profiles.content`.
- **Job:** Interpretation. Reads from the verbatim timeline, produces a markdown document that captures the user's taste in a form readable by both AIs and humans.
- **Properties:** Generated. Regeneratable. Time-aware. Replaceable.
- **What lives here:** Working interpretation, ranked domains, cross-domain patterns, voice and style, list of subscriptions, anti-taste observations, stats.
- **What never lives here:** The verbatim list of confirmations or recs. That's the timeline's job.

### Why the split matters

Conflating the two layers creates a single artifact that's bad at both jobs. A document that's both a verbatim ledger AND an interpretation either drowns the interpretation in raw data or compromises the audit trail. Splitting them lets each layer be excellent at one thing.

The split also makes regeneration safe. Because the document never claims to be the source of truth, regenerating it doesn't lose anything. The timeline is preserved untouched; the document is rebuilt from it. Bad generation? Roll back to the prior version. The data underneath is untouched.

## Three audiences, one document

The taste profile document serves three audiences simultaneously:

1. **The user themselves.** Self-knowledge. "What does my activity say about my taste?" This applies whether the user is in curation mode (seeing their recommendations reflected back) or discovery mode (seeing their saves, confirmed Reads, and subscriptions reflected back).

2. **The user's own AI (Lens).** Grounding context. The document is injected into the system prompt so Lens responds with awareness of the user's actual taste, not generic AI-assistant defaults. Lens serves both curator-mode tasks (helping articulate a recommendation) and subscriber-mode tasks (helping evaluate whether a recommendation matches their taste).

3. **External readers.** For users in curator mode, this includes visitors to their public profile, visitor AIs channeling their voice, future agents and integrations querying their Record. For users in subscriber mode, the external read surface is narrower but still real: internal agents reading the Record to deliver relevant news and recommendations, and 3rd party media services using the Record to filter content.

We considered splitting the document into separate files for each audience. We rejected that approach. Three documents means three places for trust to break, three artifacts to keep synchronized, and three failure modes when one drifts from the others. One document with disciplined sections is simpler and matches the constraint that the format must be AI-readable, portable, and human-reviewable simultaneously.

The way the single document serves three audiences cleanly is through section-level access controls and through framing language in the document itself. `lib/taste-profile/parse.js` exposes `extractPublicSections()` (strips `## Curators They Subscribe To` onward for visitors) and `extractVoiceAndStyle()` (the `## Voice & Style` body for visitor AI voice grounding).

## Document structure

The taste profile document follows this exact section order, generated by `lib/taste-profile/generate.js`:

```
# Taste Profile: @{handle}

## Working Interpretation

[1-3 sentences. Provisional read on what the recommendations and confirmations point toward.
Not a verdict on identity. Frames as current and revisable. Cites specific patterns from the data.
If fewer than 3 recs and 1 confirmation, writes "Building..." and skips to next section.]

## Domains

[Ranked by strength. Each domain: category name, specific angle visible in the data, 1-2
patterns supported by named recs or confirmations. At least one specific rec title or confirmation
phrase per domain.]

## Patterns

[Cross-domain observations. Each pattern tied to specific evidence. If fewer than two recs or
confirmations support a pattern, it's omitted.]

## Voice & Style

[How the curator communicates based on rec contexts. Precise vs vibes-based, casual vs
formal, specific vs broad. Grounded in observable language patterns from rec contexts.]

## Curators They Subscribe To

[Simple list from subscription data. Consumption signal, not taste signal.]

## Anti-Taste

[Only if confirmed corrections or anti-taste observations exist. Otherwise omitted.]

## Stats

- N recommendations across N categories
- N taste signals confirmed or corrected
- N subscriptions
- Last updated: {month year}
```

### Why this structure

- **Working Interpretation, not Thesis.** The section was previously called "Thesis" and the prompt asked for "your core read on this curator's taste identity." That framing pressured the model to produce verdicts. The rename and reframe to "provisional read" eliminates that pressure while preserving the section's job: giving readers a top-line interpretation. The chat route used to need defensive wrapping around the document because of verdict-shaped output; with the new framing, the document doesn't need that mitigation.

- **Domains ranked by strength.** Tells visitors and AIs what the user focuses on most across both their recommendations and saves. Fixed in LENS-001 (April 2026): all categories with ≥1 rec now surface, with a consolidation rule for single-rec categories.

- **Patterns separated from Domains.** Cross-domain observations that wouldn't fit cleanly inside any single domain. Required to be evidence-tied; "patterns" without evidence are inventions.

- **Voice & Style as its own section.** Required for visitor AI mode to channel the user's voice. Extracted independently via `extractVoiceAndStyle()`. Even users who primarily subscribe rather than curate have a voice signature visible in their saves and confirmations; the section captures it regardless of mode.

- **Subscriptions clearly labeled as consumption signal.** Subscribing to a curator means "I find their curation interesting," not "my taste is like theirs." External systems must access subscriptions as a separate dataset, not mixed into taste patterns. This distinction matters most for users in heavy subscriber mode, whose Record will be richer in subscriptions than in own-recommendations.

- **Anti-Taste only when present.** Some users have explicit anti-taste statements (e.g., "I'm not a jazz person"). When they do, the section appears. When they don't, it's omitted to avoid invented anti-taste.

- **Stats as a footer.** Quick numerical context. Confirms what data fed into this version of the document.

## How the Record evolves

### Update triggers (implicit consent)

These are the user's actions that update the Record without asking. The action itself IS the consent.

| Trigger | What gets updated | Why this counts as consent |
|---|---|---|
| Save a rec | `recommendations` table, then full taste profile regen | Saving a rec is the explicit, intentional act of declaring a taste signal |
| Subscribe to a curator | `subscriptions` table, taste profile regen reflects new subscription | Subscribing is an explicit action; consumption signal not taste signal |
| Save someone else's rec | `saved_recs` table (not yet feeding Record generation) | Saving signals "this aligns with my taste enough to keep" — will feed Record when wired |
| Correct the AI mid-conversation | `taste_confirmations` row with type 'correction', then taste profile regen | The correction IS the consent; "I'm not a jazz person" directly updates the profile |
| Make an explicit taste statement | `taste_confirmations` row with appropriate type, then taste profile regen | "I'm obsessed with natural wine" is a direct statement of taste |

### Update triggers (explicit consent)

These require the user to opt in via a confirmation prompt before the Record updates.

| Trigger | What gets updated | How consent works |
|---|---|---|
| Read confirmation | `taste_confirmations` row with type 'taste_read_confirmed' | User taps "Confirm" on a TasteReadCard inference |
| Read refinement | `taste_confirmations` row with type 'taste_read_corrected' (refined text) | User taps "Refine" on a TasteReadCard, edits the inference, submits |
| Source analysis (future: Spotify, Letterboxd) | `taste_confirmations` row | AI delivers the analysis, asks "Want this in your Record?" user says yes |

### What does NOT update the Record

- Background agent analysis (unless explicitly confirmed)
- General chat conversation (unless the user makes an explicit taste statement or correction)
- Visitor interactions on the user's public profile
- Other users' activity on this user's recommendations (their saves, their reads)
- Anything the AI inferred but the user hasn't endorsed

## Regeneration policy framework

Every Record-input event type has an explicit regeneration policy. This framework exists so future inputs (Validations, Saves of others' recs, Source analyses) inherit consistent discipline rather than ad-hoc decisions.

| Input event | Regen policy | Rationale |
|---|---|---|
| Recommendation save | Immediate, every save past 3-rec threshold | Recs are the strongest signal. Users expect their Record to reflect a save immediately. Cost is bounded — recs are not high-volume. |
| Read confirmation / refinement | Immediate today; batching deferred until volume warrants | Multiple chips on a single Read produce multiple regens. Acceptable at alpha scale. Will batch (60s debounce, coalesced) when cost optimization becomes warranted. |
| Validation given (future) | Throttled (debounced 60s, coalesced) | High-volume signal. Validations are casual gestures. Coalescing prevents regen storms. |
| Validation received (future) | Throttled (same as above) | Same volume profile. |
| Save of others' rec (future) | Throttled or batched | Volume profile unknown until wired. Default to throttled. |
| Subscription change | Throttled or batched daily | Subscriptions change rarely. No need for immediate regen. |

### Why immediate regen on rec saves

The Record is a trust artifact. Users who save a rec and then check `/me/taste` expecting to see their new rec reflected lose trust if it isn't there. The cost of regenerating on every save is real but bounded: ~$0.02-0.05 per regen at Sonnet pricing, ~5-15 seconds. At alpha scale this is invisible. At growth scale we will add batching where it matters most (Reads), but rec saves will remain immediate because they are the strongest signal and the user expectation is highest.

### The QCS/inline asymmetry (resolved)

Through April 2026, the Record regen path was inconsistent: `handleQuickCaptureSaved` (QCS path) regenerated on every save past threshold, while `handleSaveCapture` (inline-save path) was throttled by `TASTE_PROFILE_REGEN_INTERVAL`. Investigation revealed `TASTE_PROFILE_REGEN_INTERVAL = 1`, making the throttle a no-op in practice — both paths fired identically. The constant was dead code. Removed May 3, 2026 to eliminate the ambiguity. Both paths now use the same `recCount >= 3` gate. No behavior change.

### Full regeneration, not patches

The document is rebuilt from scratch on every trigger. No partial updates, no field-level edits, no merge logic.

This eliminates an entire class of state bugs:

- No merge conflicts between concurrent updates
- No stale fields from incomplete writes
- No drift between sections
- Roll back by selecting a prior version; the source data is untouched

The compute cost of full regeneration is negligible at alpha scale. Cost optimization belongs at the Read-confirmation layer (where multiple events fire per Read) rather than the rec-save layer (where events are inherently rare).

### Recency model

The recency model is positional, not destructive. Old confirmations don't decay or get archived. They yield to recent ones in conflict and reinforce them in agreement. This was option A in the architecture decision; option B (an explicit weight or status column) was deferred until real user behavior demonstrates the simpler model is insufficient.

If a user wants to remove a confirmation, they tell the AI through conversation. The AI records a correction. The next regeneration produces a document where the corrected observation no longer appears, but the timeline retains both the original confirmation and the correction with timestamps.

Confirmations are partitioned at prompt-build time into `recentConfirmations` (last 90 days) and `olderConfirmations` (older). Both blocks pass to Claude with explicit weighting instructions: prefer recent in tension cases, treat as stable patterns when recent and older agree.

## How the document is generated

### The pipeline

1. **Trigger fires.** A rec save, a Read confirmation, a refinement, or a correction.
2. **Generation function reads source data.** `generateTasteProfile(profileId, supabase)` in `lib/taste-profile/generate.js` fetches: `profiles` row, `recommendations` (enriched from `rec_files`), `subscriptions` (two-step query), `taste_confirmations`.
3. **Recency split.** Confirmations are partitioned into `recentConfirmations` and `olderConfirmations` (90-day boundary). Both blocks pass to Claude with explicit weighting instructions.
4. **Claude API call.** `claude-sonnet-4-20250514`, max_tokens 2000, single-turn. The prompt instructs Claude to produce the document following the exact structure above, with the constraints below.
5. **Upsert to taste_profiles.** Version increments by 1. `sources` blob captures what data fed into this version.

### The constraints (encoded in the prompt)

- **Never invent observations not supported by data.** If the model can't cite a rec or confirmation, it doesn't write the claim.
- **Every claim must be traceable.** Domains and Patterns sections must reference actual rec titles or confirmation phrases.
- **Recency weighting in tension cases.** When recent and long-standing observations disagree, prefer the recent. When they reinforce each other, treat as a stable pattern.
- **No verdicts on identity.** Describe what the user's curation and discovery patterns show, not who the user is as a person.
- **No em dashes.** No spaced hyphens as em-dash substitutes either. Resolved in LENS-002 (April 2026).
- **Reference document, not voice template.** The chat route wraps the document in `=== CURATOR REFERENCE DOCUMENT ===` markers when injecting into Lens's system prompt, with explicit instructions not to mirror the document's voice in responses.

### Subscriber-only branch

When a user has zero recommendations but ≥1 confirmed Read, the prompt branches: confirmed Reads become the primary input. Working Interpretation, Domains, and Patterns are grounded entirely in confirmed Read evidence. Subscriptions inform domain trust but do not generate interpretation on their own. This protects the honesty floor for users in heavy subscriber mode.

When a user has zero recommendations AND zero confirmed Reads, the document either renders as "Building..." or surfaces only the subscription list factually. No interpretation is fabricated.

## Storage

`taste_profiles` table. One row per user, identified by `profile_id`. Columns:

- `content`: the full markdown document, plain text
- `version`: monotonically incrementing integer per profile
- `sources`: JSONB blob describing what data fed this version (rec count, confirmation breakdowns, subscription count)
- `generated_at`: timestamp of generation
- `confirmed_at`: when the user last reviewed/confirmed (currently unused, reserved for future "review my Record" flow)

Why a dedicated table rather than a column on `profiles`:

- Version history is trackable
- Source attribution is per-version
- RLS can be set independently
- Doesn't clutter `profiles` with a large frequently-updated text field

The table replaced `profiles.style_summary` (deprecated April 15, dropped April 16). Any reader that previously hit `style_summary` now reads from `taste_profiles.content`.

## How the user interacts with their Record

### Viewing in app

- **Personal Record page (`/me/taste`).** Renders `taste_profiles.content` as styled markdown. The user sees exactly what the AI knows about them.
- **Timeline page (`/me/timeline`).** "How this was built" link appears below Stats on the Personal Record page. Renders the verbatim ledger.
- **Public profile page (`/{handle}`).** Renders the public sections of the document for visitors. Subscriptions section and below are stripped. Most relevant for users in curator mode whose public profile gets visited; users primarily in subscriber mode have the same public profile but it sees less external traffic.

### Viewing through Lens

The user can ask Lens about their taste at any time. "What do you know about my taste?" returns a substantive, cite-rich answer drawn from the document plus recent confirmations. This is the direct-ask exception to the charter: when a user explicitly asks Lens to characterize their taste, Lens gives a real answer, not a deflection.

### Editing

The user does NOT edit the document directly. There is no raw markdown editor. All edits go through conversation:

- "I'm not really a jazz person" → AI records a correction, next regen produces an updated document
- "Add that I love natural wine" → AI records an explicit taste statement, next regen reflects it
- "Remove the part about science fiction" → AI records a correction targeting that observation

Conversation-based editing is intentional. It ensures the AI understands the intent behind every change, not just the text diff. It also keeps the document honest: every change is tied to a user action that's preserved in the timeline.

### Exporting

The user can download their taste profile document as `.md` at any time. (Currently a roadmap item under "Export curator archive as `.rec` files": full export including the timeline ledger is part of the v1 `.rec` spec. The export feature applies to all users, not just users in curator mode, despite the legacy "curator archive" naming.)

## Auth and trust model

### Who can read the Record

| Reader | What they see |
|---|---|
| The user themselves | Full document + full timeline |
| The user's own Lens | Full document, injected as reference context in system prompt |
| Visitors to the user's public profile | Public sections only (Working Interpretation, Domains, Patterns, Voice & Style, Stats) |
| Visitor AI on `/{handle}/ask` | Public sections + Voice & Style as voice grounding (relevant primarily when the user is in curator mode and visitors are asking questions about their recommendations) |
| Internal agents (future) | Public sections + structured claims, used to deliver relevant news and information back to the user |
| External agents (future) | Public sections via API, with rate limiting and access tier enforcement |
| 3rd party media services (future, via MCP) | Structured claims, used to filter and personalize content delivered from those services |

### Who can write to the Record

Only the system writes. No external agents, no other users, no API consumers. The system writes on the user's behalf, and only after the user has produced an action that qualifies as consent (see Update Triggers above).

The `/api/generate-taste-profile` route enforces this at the network layer: it requires an authed Supabase session AND an ownership check (caller's `profiles.id` must match the request body's `profileId`). Internal callers bypass the route via direct function import. (Auth gate added April 27, 2026, commit `eb0b0cf`.)

### Why this matters

The Record directly affects how the user is represented to AIs and to other humans. A bad write erodes trust. The trust model has multiple safeguards:

1. **Full regeneration, not patches.** Eliminates partial-state bugs.
2. **Confirmed observations are preserved verbatim in the timeline.** The interpretation can change; the underlying record cannot.
3. **Version history.** Every generation is a new version. Bad generation rolls back trivially.
4. **User review.** Periodically or on demand, the AI can show the user their taste profile and ask "anything off?" The user can correct anything that's drifted.
5. **No silent writes.** The user always knows when their Record updated, because it only updates on actions they took.

## Forward-compatibility for unbuilt inputs

Two inputs in the five-input model are not yet built but are spec'd at the architecture level so integration is mechanical when they ship.

### Validations

When subscribers can validate a curator's recommendations ("I tried this," "this resonated," "I saved this"), validations become a Record input. Both directions feed the user's Record:

- **Validations given.** Reveal what the user responds to. A subscriber who validates 8 of CK's music recs but 0 of his book recs is signaling music-domain trust without book-domain trust.
- **Validations received.** Reveal what the user's taste reliably delivers. A curator whose recs validate at 70% in music but 20% in books has different taste authority across domains.

Both feed the same `taste_confirmations` table or a new `validations` table (TBD when built). Regen policy: throttled (debounced 60s, coalesced) — see framework above.

When wired, validations will weight higher than Reads in the input hierarchy, because validations are ratified by both sides (curator made the rec, subscriber confirmed it landed) while Reads are one-sided.

### Saves of others' recs

When the `saved_recs` table feeds Record generation (it currently exists but is not read by `lib/taste-profile/generate.js`), saves become an input. Saves are weaker than recommendations because saving is private and low-cost, but stronger than subscriptions because they target specific items.

Regen policy: throttled. Saves can be high-volume during onboarding (new users save many recs in their first session); throttling prevents regen storms.

### What we are NOT doing

We are NOT scaffolding empty input sections in the prompt today. Empty sections produce drift — the model sees "VALIDATIONS GIVEN: (none)" and overweights other sections to compensate, or generates confused output. Each new input ships with its own prompt revision when the data shape is locked. Two prompt revisions (one for Reads now, one for Validations later) is the same work as scaffolding both now and revising later.

## What the Record is NOT

- **Not a complete log.** The timeline is the log; the document is the interpretation.
- **Not a profile in the social-network sense.** It is a taste artifact, not a bio.
- **Not editable as text.** Edits go through conversation with the AI.
- **Not a feed.** It is a structured document, regenerated as a whole.
- **Not generated from inference alone.** Every claim must be tied to a user-endorsed signal.
- **Not the same as the user's bio field.** The bio is user-authored short text; the Record is system-generated structured interpretation.
- **Not a substitute for the user's own voice.** When a user writes a "why" on a recommendation, those words are preserved verbatim and never paraphrased. The Record interprets across many such voices but does not replace any individual one.

## Locked architectural decisions

These decisions are intentionally locked. Reopen only with strategic input. Grouped by topic for navigability.

### Storage and format

1. The Record is markdown, not JSON.
2. Stored as plain text markdown, not JSONB.
3. Dedicated `taste_profiles` table, not a column on `profiles`.
4. The document is interpretation, not a data dump.

### Generation discipline

5. Full regeneration, not patches.
6. Only the system writes.
7. Every Record-input event type has an explicit regen policy. New inputs inherit the framework, not ad-hoc decisions.
8. Honesty floor: Lens declines to write interpretation it cannot defend from source material. No fabrication from subscriptions alone.

### Consent model

9. Nothing writes without user consent.
10. The user edits through conversation, never raw text.
11. Confirmed observations are preserved verbatim in the timeline.

### Architecture

12. Two-layer split: timeline (verbatim) + document (interpretation).
13. Recency model is positional, not destructive.
14. Single document for all reader audiences, with section-level filtering.
15. Confirmed Reads are first-class Record inputs, weighted between recommendations (highest) and subscriptions (lowest).
16. Subscriptions are a consumption signal, not a taste signal.

### Universal applicability

17. Every user has a Record, regardless of whether they spend more time in curator mode or subscriber mode.
18. Subscriber-only Records are first-class. Users with zero recommendations but ≥1 confirmed Read get a real Record grounded in confirmed Read evidence.

## Recently resolved

### LENS-001: Category coverage in Domains section (resolved April 2026, v2.13.1)

The Domains section was dropping minor categories. Prompt fix shipped: all categories with ≥1 rec now surface, with consolidation rule for single-rec categories.

### LENS-002: Spaced-hyphen rule (resolved April 2026, v2.13.1)

Model was using spaced hyphens (`**Music** -`) as section-header separators despite em-dash ban. Prompt rule rewritten to forbid spaced hyphens anywhere, including as separators.

### LENS-003: Lazy-init Anthropic client (resolved April 2026, v2.13.1)

`lib/taste-profile/generate.js` instantiated the Anthropic client at module-load time, breaking `scripts/regenerate-taste-profile.mjs`. Moved client construction inside the function.

### QCS/inline regen asymmetry (resolved May 3, 2026)

`TASTE_PROFILE_REGEN_INTERVAL = 1` made the inline-save throttle a no-op. Constant removed; both regen paths now use identical `recCount >= 3` gate.

## Known limitations

### Single document for three audiences

The current architecture serves the user, the AI, and external readers from the same markdown document with section-level filtering. This works at alpha scale. If we ever discover that the audiences need substantively different interpretations (not just different visibility), the architecture would need to split into voice + factual versions or move to a structured-claims rewrite. The structured-claims direction is particularly relevant for serving internal agents, external agents, and 3rd party media services in the future, since those readers benefit more from machine-parseable claims than from prose. Deferred and should not be attempted without strategic input.

### `agent/taste-read/route.js` is intentionally verdict-shaped

The Read flow at `/api/agent/taste-read/route.js` produces verdicts because verdicts ARE the product on that surface. The user confirms or corrects the verdicts; that's the input mechanism. The Lens Charter does NOT apply to Read surfaces. Do not propose anti-verdict fixes there unless the Record purpose work explicitly addresses the Read flow.

### Read regen batching not yet implemented

Today, every chip confirmation, refinement, or ignore on a Read fires its own `generateTasteProfile` call. A user confirming 3 chips on a single Read produces 3 Claude generation calls. This is acceptable at alpha scale but will need batching (60s debounce, coalesced) when volume warrants. Forward-spec'd in the regen-policy framework above.

## Related docs

- `CLAUDE.md`: engineering practices, including the Taste Profile Pipeline section
- `curators-roadmap-updated-apr28.md`: product priorities and shipped work
- `curators-taste-profile-architecture.md`: the original strategic spec from March 17, 2026 (predates this doc; this doc supersedes its implementation-state claims)
- `lib/taste-profile/generate.js`: the generation pipeline (authoritative for prompt and behavior)
- `app/api/generate-taste-profile/route.js`: the regen endpoint (authoritative for auth model)
- `components/me/TasteFileView.jsx`: Personal Record page rendering
- `components/me/TasteTimeline.jsx`: timeline page rendering
- `app/api/timeline/route.js`: timeline API
