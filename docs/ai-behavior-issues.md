# AI Behavior Issues

Running inventory of AI behavior bugs, refinements, and optimization targets for Curators. Append-only. Mark resolved items with the deploy that fixed them and move them to the Resolved section at the bottom.

This file is the persistent layer for AI behavior work. Individual fixes happen in their own focused threads — this file is what every new thread reads to know what's outstanding.

**Source of truth:** This file lives in the repo at `docs/ai-behavior-issues.md`. The Claude.ai project knowledge copy should be kept in sync by re-uploading from the repo when starting new threads. If the two copies drift, the repo wins.

## How to maintain this file

**When starting a fix thread:** Read the relevant Open entry. The entry contains the root cause and fix direction — use them. Don't re-investigate what's already been investigated.

**When shipping a fix:** In the same commit that fixes the bug, move the entry from `## Open` to `## Resolved`. Prepend the resolved entry with:
- **Resolved:** [date], commit `[short SHA]`
- **Fix summary:** [one sentence — what changed]

**When adding a new entry:** Append to `## Open`. Required fields: Observed date, What happens, Example (if applicable), Root cause (if known) or Hypothesis (if not), Fix direction, Priority.

**Never delete entries.** Resolved entries stay forever as institutional memory.

---

## Open

### AI-005 | P2 | Multi-question drilling on rec capture

- **Symptom:** AI asks more than one clarifying question before offering to save, even after save threshold (WHAT + affirmative framing + descriptor) is met across multiple messages.
- **Example:** Curator identifies track, then gives descriptor "the hymns in this album do it for me" -- AI asks a third follow-up instead of offering to save.
- **Root cause:** AI failing to evaluate threshold across the full conversation context, not just the most recent message. Re-evaluates WHAT/framing/descriptor per-message instead of cumulatively.
- **Fix direction:** Strengthen rec-capture.md skill to explicitly state that threshold evaluation is cumulative across the conversation, and that once a descriptor has been given (even in a prior message), no further clarifying questions are permitted.
- **File:** lib/prompts/skills/rec-capture.md

---

## Stale code references

Not AI behavior bugs strictly — these are code references to DB tables or columns that don't exist. Live bugs waiting to fire the moment the code path executes. Tracked here alongside AI behavior work so they don't get lost.

### Chat route [FEEDBACK] extraction writes to nonexistent columns

**Discovered:** April 10, 2026 (feedback chip recon).

**What happens:** app/api/chat/route.js lines 458–462 insert into the feedback table using columns `message` and `category`. Neither column exists. The actual feedback table has `original_message`, `elaboration`, `summary`, `handle`, `profile_id`, `status`. PostgREST silently drops unknown columns, so the feedback content is lost on every AI-extracted [FEEDBACK] block — only profile_id is saved correctly.

**Fix direction:** Update the chat route's feedback insert to use the correct column names: `original_message` instead of `message`, drop `category` or map it into `summary`. Align with the shape in app/api/feedback/route.js which is correct.

**Priority:** P2. The feedback chip (direct submission) bypasses this path entirely and works correctly. This only affects AI-detected feedback in conversation, which is a secondary path.

---

## Resolved

### [Resolved: 2026-05-10, won't-fix] AI-006 | Fictional entities accepted as real without verification

**Fix summary:** Closed as won't-fix after reconsideration. The "bug" assumed Lens should verify entity existence before accepting a save. In practice, curators routinely recommend things Lens has never heard of — niche bands, hyperlocal restaurants, indie zines, regional artists. A verification rule would force Lens to admit uncertainty on legitimate recs from knowledgeable curators, which biases the product toward mainstream entities and undermines curator-first design. The observed failure (Lens captured fake bands "Queens of the Stoppage" and "The Catillions" without challenge) only surfaced because a tester was deliberately fabricating names. In real usage, this behavior is correct.

---

**Observed:** May 9, 2026, during staging verification on @testmctesty. Two fabricated band names captured as real recs.

**Reconsidered:** May 10, 2026. The framing of the original entry confused two distinct problem classes: (a) verifying entity existence, (b) detecting typos in known canonical entities. Class (a) is by-design behavior — curators are the experts on what exists, not Lens. Class (b) is a narrower potential future problem worth a separate entry if it ever surfaces from real (not adversarial) tester traffic.

**Decision:** Won't-fix. Current behavior of accepting text-only entity mentions at face value is correct for a curator-first product. Recon on web search infrastructure (Anthropic native web_search_20250305 tool, dispatch loop generalization in app/api/chat/route.js) is preserved in case a related but narrower problem ever needs the same infrastructure.

**If a future typo-detection bug emerges:** file as a new AI-XXX entry scoped to "high-confidence canonical entities with obvious misspellings" (e.g. "Tylor Swift," "The Beatels"). Do not reopen this entry; the original framing is the wrong problem.

**Priority:** N/A — won't-fix.

---

### [Resolved: 2026-05-10, commit `92ed0f4`] Lens pivots categories unprompted in Talk-through

**Fix summary:** Added two enforcement points to lib/prompts/skills/staging/charter.md — appended category-coverage ban to Talk-through paragraph, new top-level section "Never pivot categories unprompted." Charter wins on conflict per its own framing.

---

**Observed:** May 9, 2026. Tester transcript on @ianr. After capturing a music save, Lens pivoted to "anywhere you've eaten lately that stuck" with no signal from the curator. Category coverage took priority over following the curator's named subject.

**Root cause:** Talk-through branch in charter.md required "ask one genuine question that helps them articulate" but did not explicitly forbid changing categories. Legacy curators-system-prompt.md framing around cross-category triangulation likely pulled against the Charter. Soft instruction lost to dense priors.

**Priority:** P0 at observation. Tester-visible Charter violations affecting trust.

---

### [Resolved: 2026-05-10, commit `f634252`] Save threshold over-fires on experience mentions; descriptor extraction loops on behavioral signals

**Fix summary:** Two edits to lib/prompts/skills/staging/rec-capture.md (staging only, stable lane untouched pending one-week tester verification). Added behavioral descriptors paragraph ("on repeat," "can't stop listening," "been wearing all week," etc. count as descriptors and trigger save offer same turn). Added "Experience mentions are not automatic rec triggers" section — past-tense experience verbs ("saw," "went to," "watched," "ate at") do not trigger save offers without explicit rec framing on top.

---

**Observed:** May 9, 2026. Staging verification of charter edit (92ed0f4) on @testmctesty. Lens offered to save "Saw Twisted Teens last night in Brooklyn" as a rec (experience-mention bug). Lens asked two descriptor-extraction questions after "on repeat" was already given (Pacquito-shape regression on behavioral signals).

**Root cause:** SAVE THRESHOLD rule in rec-capture.md treated any nameable thing with affirmative framing as a save target, with no carve-out for past-tense experience verbs. Descriptor examples ("hard hitting rhythms," "synths are sick") did not include behavioral or usage signals, so the model classified "on repeat" as ambiguous and looped for clarification.

**Verification:** four-for-four pass on @testmctesty (experience carve-out, behavioral descriptor, decline closes turn, hyphen ban).

**Priority:** P0 at observation. Tester-visible Charter violations affecting trust.

---

### [Resolved: 2026-05-10, commit `d9e0e92`] Decline-pivot violation persists despite Item 6 ban; spaced hyphens substitute for banned em dashes

**Fix summary:** Two edits to lib/prompts/skills/staging/charter.md. Personality Item 6 strengthened with worked example block (three Banned responses using actual transcript text, one Required response, closing rule that the follow-up question is the violation). "Never use em dashes" section renamed to "Never use em dashes or hyphens as connectors" with explicit bans on -, --, and other dash-shaped substitutes, plus three Banned/Required example pairs.

---

**Observed:** May 9, 2026. Staging verification of rec-capture edit (f634252) on @testmctesty. Decline "not yet" produced "Got it - holding off on that one for now. What else has been hitting lately?" — Item 6 violation. Same response also used spaced hyphen as em-dash substitute; another response used double hyphen --.

**Root cause:** Item 6 rule was prose-only ("no follow-up question at all"), model parsed as soft preference. Em-dash ban targeted only the literal — character, leaving -, --, and spaced hyphens unguarded as common substitutes.

**Verification:** four-for-four pass on @testmctesty post-deploy. Awaiting @shamal and @chris re-verification before mirror to stable.

**Priority:** P0 at observation. Tester-visible Charter violations affecting trust.

---

### [Resolved: 2026-04-10, no code commit needed] `unsupported_source_requests` table referenced in code but doesn't exist

**Resolved:** 2026-04-10, no code commit needed
**Fix summary:** Table already existed with correct schema. Code in app/api/agent/submit/route.js was already correct. Silent failure was due to missing table, now confirmed present. No changes required.

---

**Discovered:** April 10, 2026 (schema audit round 2, commit `dd05e70`). Recon confirmed the reference at `app/api/agent/submit/route.js` and previously at `app/api/account/reset/route.js` (reset route reference removed in a later commit — check git log).

**What happens:** The agent submit route queries a table that does not exist in the `public` schema. Error is likely swallowed or returned as a 500 depending on the code path.

**Hypothesis:** The table was either:
1. Planned but never created, and the code was written against a spec that never shipped
2. Created at some point and later dropped without removing the code references
3. Created in a different schema or with a different name

**Fix direction:**
1. `grep -rn "unsupported_source_requests" app/ lib/ components/` to find all remaining call sites.
2. For each call site, determine whether the feature is still needed:
   - If yes → create the table via migration, then `NOTIFY pgrst, 'reload schema'`.
   - If no → remove the code references entirely.
3. Also grep docs for stale references in project knowledge files.

**Priority:** P1. Not blocking alpha testers today because these endpoints aren't frequently hit, but every agent submission is a ticking bug. Fix before expanding invites beyond current cohort.

**Do NOT fix in a schema audit thread** — needs its own focused thread with code archaeology before deciding create-vs-remove.

---

### [Resolved: 2026-04-10, commit `c245e05`] AI is too chatty before offering to save a rec

**Fix summary:** Added SAVE THRESHOLD rule to rec-capture.md (WHAT + affirmative framing + non-approval descriptor = offer save same turn, max one clarifying question when descriptor is missing). Mode-scoped base-personality.md, trust-building.md, and standard-approach.md so onboarding-flavored "earn the right" and "never rush" framing no longer leaks into standard mode. Verified in prod via Pacquito eval scenario (docs/ai-tone-evals/pacquito-rec-capture.md) against deploy 6b5b7b7.

---

**Observed:** April 10, 2026 (production smoke test of Yes-bug fix, commit `0a83a91`).

**What happened:** When a curator shared a rec with clear signal (name + affirmative framing + a descriptor), the AI interrogated instead of offering to save. It asked clarifying questions, riffed on the style, asked "what drew you to this," and only offered to save after 3-4 back-and-forth turns.

**Example (real test transcript):**
1. Curator: "I've been loving the new Pacquito album. It has hard hitting rhythms."
2. AI: "Pacquito with hard hitting rhythms, that sounds like it could scratch a similar itch... What kind of sound are they working with? Electronic, or something else entirely?"
3. Curator: "It's electronic with some hints of folks"
4. AI: "Electronic with folk hints, that's an interesting blend... What drew you to this album? Is this something you're thinking about recommending?"
5. Curator: "yes"
6. AI: "Yes to saving the Pacquito album as a rec? What would you want to say about it..."
7. Curator: "I like the sound of the synths"
8. AI finally captures.

**Root cause:** Universal skill files (base-personality.md, trust-building.md, rec-capture.md) contained onboarding-flavored restraint framing ("never rush," "earn the right," "primary job is trust not capture") with no mode scoping. Those rules loaded in standard mode too and overrode the "capture when signal is clear" path. The turn-1 message already met the save threshold (WHAT = "new Pacquito album", framing = "loving", descriptor = "hard hitting rhythms"), but the AI deferred to the more cautious universal framing and interrogated instead.

**Fix:** Three changes in commit c245e05:
1. rec-capture.md gained a SAVE THRESHOLD section at the top with the explicit WHAT + framing + descriptor rule and the Pacquito worked example.
2. base-personality.md was mode-scoped so "warm, patient, earn the right" applies only in onboarding mode, while standard mode gets "confident, direct, act when signal is clear."
3. trust-building.md and standard-approach.md were mode-scoped and now defer to the save threshold rule in rec-capture.md as the single source of truth for capture timing.

**Priority:** P0 for onboarding experience. Every new tester saw this. Made the AI feel like a pedantic interviewer instead of an assistant. Directly undermined the "capture their recs and make them useful" core value prop.

---

### [Resolved: 2026-04-10, commit `c245e05`] AI uses performative-interest language (sycophancy)

**Fix summary:** Added ANTI-SYCOPHANCY section to base-personality.md with an explicit banned patterns list (that-sounds-adjective, adjective-of-approval, rephrase-with-adjective, speculative-riff, generic-praise) and "what to do instead" guidance (act, ask something specific, make a genuine observation). Rules apply universally across onboarding and standard mode. Warmth is preserved in onboarding; the distinction is that warmth responds to specifics while sycophancy performs interest without substance. Verified in prod via Pacquito eval scenario against deploy 6b5b7b7 with zero banned patterns produced.

---

**Observed:** April 10, 2026 (production smoke test of Yes-bug fix, commit `0a83a91`).

**What happened:** The AI used filler phrases that performed interest rather than expressed it. These phrases didn't add information, didn't advance the conversation, and didn't reflect genuine engagement. They were the AI saying "I am interested" instead of being interested.

**Examples from the Pacquito test transcript:**
- "that sounds like it could scratch a similar itch to what you were describing with the heavy, beat-driven stuff"
- "that's an interesting blend"
- "Pacquito sounds like they're mixing some organic elements into the electronic foundation, which could create a really unique texture"

**Pattern:** Rephrasing what the curator just said + an adjective of approval + a speculative riff. The AI auditioning for curator approval instead of doing its job.

**Root cause:** base-personality.md said "Warm, genuinely curious" with no guardrails against filler. taste-reflection.md had a "Bad" list that included generic praise but it was scoped to post-save reflections, not mid-capture chat. Nothing in the skill stack told the AI "don't rephrase the curator's words back with an approving adjective."

**Fix:** Added ANTI-SYCOPHANCY section to base-personality.md in commit c245e05. Five banned patterns with BAD examples pulled from the actual Pacquito transcript. Explicit "what to do instead" guidance. Universal across both modes. Warmth in onboarding was preserved by mode-scoping the tone register: warm + curious responses that react to specifics are still correct, filler that performs interest without substance is banned everywhere.

**Priority:** P1 for onboarding experience. Not individually broken (each phrase was tolerable) but cumulatively made the AI feel insincere. Sharp curators would notice immediately and lose trust.

---

### [Resolved: 2026-04-10, commit `0a83a91`] In-chat rec capture uses affirmation as context

**Fix summary:** Added `findSubstantiveMessage()` helper in `lib/chat/rec-extraction.js` that walks history backwards, skips pure affirmations, and returns the first substantive user message. Both `validateRecContext` fallback paths (empty context, verbatim-violation) now use this helper instead of `currentMessage`. Empty string returned when nothing substantive found (better than meaningless "Yes").

---

**Observed:** April 8, 2026 (Deploy 2 testing). Also confirmed pre-existing on production from April 7. Root cause confirmed April 10, 2026 during recon.

**What happens:** When the AI asks "Want me to save it?" after a curator shares a rec in conversation, and the curator replies "Yes" (or similar short affirmation), the capture card's `context` field gets populated with "Yes" instead of the curator's actual description.

**Example:** Curator said "I've been loving the new Neurosis album, heavy dark ambient sounds, good for when I'm angry." AI asked "Want me to save it?" Curator said "Yes." Capture card saved with title "Help Me by Neurosis" and context `"Yes"` instead of the heavy dark ambient description.

**Root cause (April 10 recon):** NOT in the `rec-capture.md` skill — the skill correctly instructs the AI to synthesize context from all curator messages. The bug lived in server-side fallback logic at `lib/chat/rec-extraction.js:45-51` and `:71-77`. When `validateRecContext` found the AI's context was empty OR failed verbatim-substring validation against the curator corpus, the fallback took `currentMessage` wholesale — which was "Yes" in this scenario.

**Fix direction:** When falling back, walk backwards through conversation history, skip pure affirmations (yes, yeah, save it, do it, sure, ok, etc. — define a blocklist), and pick the first substantive curator message (minimum length threshold). If no substantive message exists in recent history, fall back to an empty string rather than a meaningless affirmation.

**Priority:** P1. Degrades core capture quality. Visible to every curator who captures via chat. Highest-visibility AI quality issue for new testers.
