# AGENTS.md — Multi-Agent Coordination

Coordination rules for agents working on this repo. Going forward, Codex may own some projects and Claude Code may own others. **GitHub is the source of truth.**

The full engineering operating manual lives in `CLAUDE.md` (tech stack, architecture quick reference, vocabulary, key file paths, schema references). This file governs how multiple agents coexist; `CLAUDE.md` governs how the code works.

Last reviewed: May 25, 2026.

---

## Coordination Rules

1. **Always pull before starting work:**
   ```bash
   git checkout main
   git pull --ff-only
   ```
2. **Use branches for larger work.** Do not make major architecture changes directly on `main`.
3. **Push branches early** so the other agent can inspect or continue.
4. **Do not edit files another agent is actively working on** unless ownership is explicitly handed off.
5. **For DB changes:** write the exact SQL, update `docs/schema.md`, and after new Supabase columns/tables run `NOTIFY pgrst, 'reload schema';` in the Supabase SQL Editor.
6. **Update architecture docs when behavior changes** (`docs/chat-route.md`, `docs/schema.md`, or new docs as needed).
7. **Before implementing from stale context, inspect the current files in the repo.**

---

## Project Ownership

### Owned by Codex (do not touch unless Shamal explicitly says so)

**Lens AI chat architecture change:** moving from one lifetime chat log per curator to real conversation threads (like ChatGPT/Claude/Gemini).

Reserved files for this project:
- `components/chat/ChatView.jsx`
- `context/CuratorContext.jsx`
- `app/api/chat/route.js`
- `docs/schema.md` (for `chat_sessions` / `lens_conversations` additions)
- FeedbackChip, QuickCaptureChip, QuickCaptureSheet, FeedbackSheet

If asked to touch any of these files, **flag the overlap with Shamal first before proceeding.**

---

## Existing Repo Rules (preserve)

- **No local build.** Use targeted syntax checks (`node --check`, `tsc --noEmit` for JSX) and Vercel deploy verification. See `CLAUDE.md` → Local Dev Verification.
- **Pull before pushing.**
- **Inline styles only** via `T` / `W` / `V` tokens from `lib/constants.js`. No Tailwind.
- **No em dashes** in user-facing copy, prompt text, AI output, or AI skill files. No spaced hyphens as substitutes.
- **No Supabase join aliases.** Use two-step queries.
- **No silent catch blocks.** Surface errors with a `[FEATURE_ERROR]` log marker.
- **Reuse existing auth patterns** (cookie-session + `auth_user_id` lookup; see `app/api/ai-response-ratings/route.js` or the invite DELETE handler).
- **Do not rename internal validation identifiers** (`validations` table, `validation_*` columns, `payout_validation` flag, `/api/validations` routes, `create_validation_atomic`, `[VALIDATION_*]` markers).
- **Keep user-facing vocabulary:** subscribe, curator, recommendations/recs, Record, Read, Lens, Cosign. No "taste" in product/user-facing copy.
- **For handle comparisons, use `normalizeHandle` from `lib/handles.js`.**
- **Respect unrelated worktree changes.**
