# Read Pipeline

Per-URL inference cards. The user pastes a URL, clicks "Add to Record," and Lens generates 2-3 atomic chips (inferences) about what sharing the content might reveal. The user confirms, refines, or ignores each chip. Confirmed and refined chips feed the user's Record.

This is distinct from rec-saving. A Read is for content the user wants to engage with as evidence about how they think — articles, essays, images. A rec is for content the user wants to vouch for and share with subscribers.

---

## Flow

1. **User pastes URL in chat** → URL-drop block emits with three buttons: Save as Recommendation / Add to Record / Just talk about it.
2. **User clicks "Add to Record"** → triggers `taste_read:<url>` action.
3. **Chat route short-circuits** at `app/api/chat/route.js:247`. Emits a `taste_read_card` block carrying `parsed_content` + `source_url`. Does NOT call Claude on the chat side.
4. **Client mounts `TasteReadCard`** which POSTs to `/api/taste-read`.
5. **Chip generation** runs on `app/api/taste-read/route.js`. System prompt is `skill + parsed_content` ONLY. No Record injection. No prior recs injection. No prior confirmations.
6. **Chips render** in the card with Confirm / Refine / Ignore buttons per chip.
7. **User actions** route to `/api/taste-read/confirm`, `/api/taste-read/refine`, or `/api/taste-read/ignore`. Each persists a `taste_confirmations` row and triggers immediate Record regeneration via direct function import.
8. **Save as Recommendation** (footer button on Read card): emits `save_rec_from_taste_read:<url>`. ChatView intercepts at line 1106, calls `handleSaveFromChat(url, { skipWhyDraft: true, ... })`. The walkback at `ChatView.jsx:654-657` finds the URL's `parsed_content` in the last 10 messages and prefills QCS with URL, title, and metadata. Why field stays empty by design.

---

## Isolation rule (critical)

**Each Read is a fresh interpretation of a single piece of source material.**

The chip-generation system prompt is `skill + "\n\nPARSED CONTENT:\n" + parsed_content`. Nothing else. No injected Record. No injected recs. No injected confirmations.

Why this matters: the chip is the user's confirmation step, not the model's prediction step. If the model already "knows" the user from injected priors, chips become a rubber stamp on existing assumptions instead of real new signal. Established curators may notice chips feel less "personalized" — that's correct. The personalization was an illusion built on session bleed.

The skill file (`lib/prompts/skills/taste-read.md`) has a hard rule: "If a chip would only make sense by referencing something the curator confirmed earlier, that chip is invalid. The chip must stand entirely on what the parsed content surfaces."

---

## Persistence

`taste_confirmations` table. Schema:

```sql
CREATE TABLE taste_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                  -- 'taste_read_confirmed' | 'taste_read_corrected' | 'correction' | 'explicit_statement' | 'anti_taste'
  observation TEXT NOT NULL,           -- the exact chip text or correction
  source TEXT,                         -- 'taste_read:<url>' | 'chat' | 'rec_save:<id>'
  created_at TIMESTAMPTZ DEFAULT now()
);
```

RLS: curator can read/write their own confirmations only.

Confirmation events are visible on `/me/timeline` (the verbatim ledger). Ignored chips do NOT persist to `taste_confirmations` — they're tracked client-side only.

---

## Regeneration policy

Every chip confirmation/refinement/ignore fires immediate `generateTasteProfile` via direct function import (bypasses the auth gate on `/api/generate-taste-profile`).

Multiple chips on a single Read produce 2-3 regens. Acceptable at alpha scale. **Read regen batching is a deferred P2** — when volume warrants, add a 60s debounce that coalesces multiple confirmations on the same Read into one regen call.

---

## Skill file contract

`lib/prompts/skills/taste-read.md` (mirrored byte-identical to staging). Specifies:

- 2-3 atomic inferences per Read
- Each chip is one independent hypothesis (no compound braiding)
- Chip text must be specific enough to be wrong — "you value authenticity" is a horoscope, not an inference
- Direct second-person voice ("You are drawn to...", "You notice...")
- No demographic inferences (age, gender, profession)
- Banned: praise, mirrored enthusiasm, "what a fascinating choice"
- Output is JSON only with `extraction` (2-3 sentences proving the model read the piece) + `inferences` array

The skill is the FIRST thing in the system prompt. Parsed content follows. Nothing else.

---

## Save as Recommendation handoff

When the user clicks the "+ Save as a Recommendation" footer on a Read card:

1. `TasteReadCard` calls `onSaveAsRec`, emits `save_rec_from_taste_read:<url>`.
2. `ChatView` action interceptor at `components/chat/ChatView.jsx:1106` extracts the URL.
3. Calls `handleSaveFromChat(url, { skipWhyDraft: true, createdVia: "chat_save_from_taste_read" })`.
4. `handleSaveFromChat` walks back through the last 10 chat messages looking for an AI message whose `parsed_content` array contains a block matching the URL.
5. If found, hydrates `parsedPayload` envelope and prefills QCS with URL, title, and metadata.
6. QCS opens with prefilled fields. Why field stays empty.

The walkback works because the chat route persists parsed link content to `chat_messages.parsed_content` on URL drops. The Read flow doesn't change this — the metadata is already there from the original URL paste.

---

## Known issues

- **CHAT-VERBOSITY (P1):** Chat route URL-paste responses (separate code path from chip generation) inject the user's full Record + 15 recent recs and produce context-aware comparative essays. When the user pastes URLs in succession to do Reads, the chat route's intermediate "let me give you a take" responses pull them into a synthesis loop. Distinct from READ-DRIFT (which was the chip-generation flow). May warrant gating `tasteProfileBlock` and `recsContext` on URL-drop turns or introducing a "minimal mode" prompt branch.

- **READ-DRIFT (RESOLVED May 4, 2026, commit `28988ae`):** Was: per-URL Read endpoint injected user's full taste profile and 15 recent recs into chip-generation system prompt, causing chips on later articles to cite prior session confirmations as established truths. Fix stripped both injections. Skill file's "use context to sharpen" framing replaced with hard isolation rule.

---

## Related files

- `app/api/chat/route.js:247` — Read short-circuit branch
- `app/api/taste-read/route.js` — chip generation
- `app/api/taste-read/confirm/route.js` — chip confirmation + regen trigger
- `app/api/taste-read/refine/route.js` — chip refinement + regen trigger
- `app/api/taste-read/ignore/route.js` — chip ignore (no regen)
- `lib/prompts/skills/taste-read.md` — chip generation skill (stable)
- `lib/prompts/skills/staging/taste-read.md` — chip generation skill (staging, byte-identical)
- `components/taste-read/TasteReadCard.jsx` — Read card UI
- `components/chat/ChatView.jsx:1106` — save_rec_from_taste_read interceptor

---

## Related docs

- `docs/record-architecture.md` — how confirmed Reads feed the Record (five-input model, weighting, subscriber-only branch)
- `docs/chat-route.md` — full chat route mechanics including the URL-drop block and re-injection logic
- `docs/ai-skills.md` — skill system overview
