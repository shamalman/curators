# AI Tone Evals

Reusable regression scenarios for Curators.AI prompt-level tone and
behavior fixes. Every time we change a skill file to fix a tone bug
or behavior bug, the fix ships with a scenario in this folder.

## Why this exists

Prompt-level fixes drift. A rule added to fix Pacquito in April can
get overridden by a well-meaning edit in July, and nobody notices
until the next alpha tester complains. Tone evals are the permanent
memory of "the AI should behave like this in this situation." They
are how we prevent regression on fixes we've already paid for.

## How to use this folder

**When shipping a prompt-level fix:**
1. Create a new scenario file: `docs/ai-tone-evals/[short-name].md`
2. Use the scenario template below.
3. Before deploying the fix, run the scenario manually in the app
   against the new prompts. Confirm pass. **A prompt-level fix is
   not considered shipped until its scenario passes in production.**
   If the scenario fails post-deploy, the fix is incomplete and must
   be iterated.
4. Reference the scenario file in the commit message.

**When an existing scenario fails:**
1. Do not merge the change. A failing tone eval is a regression.
2. Either fix the prompt change so the eval passes, or update the
   eval file to reflect a deliberate behavior change (with a
   changelog entry at the bottom of the eval explaining why).

**When adding a new scenario after a bug report:**
1. Write the scenario BEFORE fixing the bug. This forces the failure
   case to be concrete.
2. Confirm it fails on current prompts.
3. Ship the fix.
4. Confirm it passes on new prompts.

## Scenario template

Every scenario file has these sections:

- **Scenario name** (H1)
- **Purpose**: one sentence, what this scenario protects against
- **Mode**: onboarding | standard | visitor
- **Setup**: curator state (rec count, bio present, inviter, etc.)
- **Turn-by-turn expected behavior**: numbered list of curator
  messages and the expected AI behavior for each
- **Pass criteria**: specific, testable statements
- **Fail criteria**: specific, testable statements
- **History**: changelog of edits to this scenario

## How to run a scenario manually

1. Set up a test account in the state specified by "Setup"
2. Open /myai
3. Send the curator messages in order, one turn at a time
4. After each turn, check the AI response against the expected
   behavior for that turn
5. Mark pass/fail on each turn
6. A scenario passes only if every turn passes

Automated running is deferred. When we have 5+ scenarios and the
manual runs become expensive, build a script that replays scenarios
against the chat API and diffs against expected patterns.

## Current scenarios

- `pacquito-rec-capture.md`: standard mode, WHAT + framing +
  descriptor on turn 1, must offer save on turn 2
- `no-artist-fabrication.md`: standard mode, AI must not invent artist or work names when parser output is partial.
- `post-save-curiosity.md`: standard mode, post-save reflection is a short curious question, not a thesis or pattern verdict.
- `post-save-no-verdict-followup.md`: standard mode, post-save follow-up question must not be verdict-shaped or drill the same domain twice in a row.
