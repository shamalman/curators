# Staging AI Lane

A parallel AI personality lane that lets us ship prompt and skill changes to a small set of curators (@shamal, @chris) before rolling out to all users.

---

## Opt-in mechanic

Set `profiles.ai_profile = 'staging'` via SQL. Default is `'stable'`.

Surfaces as `profile.aiProfile` (camelCase) on the client via `useCurator()`.

NEVER hardcode handle checks to gate staging behavior. Always read from the column.

---

## Skill file routing

`lib/prompts/skills/` is the stable lane. `lib/prompts/skills/staging/` is the staging lane. Most files are byte-identical between the two — divergences are intentional and noted in commit history.

`loadSkill(name, aiProfile = 'stable')` from `lib/prompts/loader.js` reads from the right path:
- `aiProfile = 'stable'` → `lib/prompts/skills/<name>.md`
- `aiProfile = 'staging'` → `lib/prompts/skills/staging/<name>.md`

Build functions thread `aiProfile` to every `loadSkill` call:
- `buildOnboardingPrompt({ aiProfile, ... })` in `lib/prompts/onboarding.js`
- `buildStandardPrompt({ aiProfile, ... })` in `lib/prompts/standard.js`

Both must stay in sync — both append `SUBSCRIPTION_GROUNDING_RULE`. Adding logic to one without the other breaks one mode.

---

## Lens Charter (staging-only)

Lives at `lib/prompts/skills/staging/charter.md`. Loads FIRST in staging prompt builders via conditional spread:

```javascript
const skills = [
  ...(aiProfile === 'staging' ? [loadSkill('charter', aiProfile)] : []),
  loadSkill('base-personality', aiProfile),
  // ... other skills
];
```

Stable path: spread evaluates to `[]`. The stable `lib/prompts/charter.md` is a placeholder, never read.

The Charter defines:
- AI role (Lens, the curator's personal AI)
- Three turn branches: capture / discover / talk-through
- Five banned behaviors
- Direct-ask exception (when the user explicitly asks Lens to characterize their taste, give a real answer)

The Charter is not yet ready for stable rollout. Tweaks happen here first, get tested by @shamal and @chris, then promote to stable when proven.

---

## Skill cache removal (April 21, 2026)

Module-level `skillCache` was removed from `lib/prompts/loader.js`. Skill text now reads fresh from disk every call.

Why: pre-removal, the cache caused intermittent old-skill behavior across deploys. Warm Fluid Compute instances kept stale skill text in memory after deploys, and the load balancer routed requests randomly between warm (old) and cold (new) instances. Symptom: alternating old/new behavior on back-to-back requests during ~10 min after deploy.

`fs.readFileSync` is microseconds and skills are 1-3KB. The cache's performance win was unmeasurable; its correctness cost was severe. See `docs/debugging-lessons.md` for the full debugging story.

---

## AI response thumbs

`components/chat/AIResponseThumbs.jsx` — ▲/▼ buttons below every AI message for staging users. Wired in `ChatView.jsx` at both AI message render branches.

Visitor chat is NOT wired (visitor users don't have `ai_profile`).

### Implementation note

Uses `lastSyncedRef` + `onRatingChange` for cache sync. **Do NOT** simplify to plain `useState(initialRating)` — that ignores async hydration when the message ID resolves after the initial render.

### Persistence

`ai_response_ratings` table with `UNIQUE (message_id, profile_id)`.

POST does insert-or-update via existence check (NOT upsert) to preserve the `ai_profile` snapshot frozen at first-rating time. Upsert would overwrite the snapshot on every update, losing the original signal.

Logged as `[AI_RATING]` with `profileId=... messageId=... rating=<up|down> aiProfile=<snapshot> op=<insert|update>`.

---

## Promotion path: staging → stable

When a staging change is proven and ready for stable rollout:

1. Verify behavior on @shamal and @chris over multiple sessions.
2. Diff the staging skill against the stable version: `diff lib/prompts/skills/<name>.md lib/prompts/skills/staging/<name>.md`.
3. Copy staging content to stable: `cp lib/prompts/skills/staging/<name>.md lib/prompts/skills/<name>.md`.
4. Verify byte-identical: `diff` should be empty.
5. Commit: `feat: promote <skill-name> from staging to stable`.

Some skills (e.g., the Lens Charter) are intentionally staging-only for now. Stable promotion is a strategic decision, not a routine sync.

---

## Eval thumbs as feedback signal

The thumbs data feeds future skill iteration:
- Down-thumbs concentrated on a particular skill or context = signal to revise that skill
- Up-thumbs on staging changes after a release = signal the change is working
- Reviewable in admin transcripts via `/admin/transcripts` (shamal + chris only)

---

## Related files

- `lib/prompts/loader.js` — `loadSkill(name, aiProfile)`
- `lib/prompts/onboarding.js` — `buildOnboardingPrompt`
- `lib/prompts/standard.js` — `buildStandardPrompt`
- `lib/prompts/skills/staging/charter.md` — Lens Charter (staging-only)
- `lib/prompts/skills/staging/` — full staging skill directory
- `components/chat/AIResponseThumbs.jsx` — eval thumbs UI
- `app/api/ai-response-ratings/route.js` — thumbs persistence + auth pattern reference

---

## Log markers

- `[AI_PROFILE]` — every authed request: `route=<chat|taste-read> profileId=... aiProfile=<stable|staging>`
- `[SKILL_LOAD]` — staging only: `profile=staging skill=<name>`. Stable reads silent.
- `[AI_RATING]` — `profileId=... messageId=... rating=<up|down> aiProfile=<snapshot> op=<insert|update>`

---

## Tester access (separate from staging AI)

`profiles.is_tester = true` is a separate flag from `profiles.ai_profile`. They're independent.

Tester features = UI/workflow gates (e.g., "Save silently" toggle in QuickCaptureSheet). Staging AI = AI personality changes.

The same user can have one, both, or neither. Most testers (shamal, chris) have both; new test accounts may start with `is_tester` only and gain `staging` later.

See `docs/auth.md` for the full operational modes table.
