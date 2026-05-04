# Auth Model

Site-wide auth lockdown via `middleware.js`. Three operational modes layered on top: Stable / Staging AI / Tester features.

---

## Site-wide lockdown

`middleware.js` enforces session check on most routes. Unauthed users get redirected to `/login?redirectTo=<path>`.

### Public routes (no session required)

- `/login`
- `/signup`
- `/onboarding*`
- `/forgot-password`
- `/reset-password`
- `/email/saved`
- `/email/unsubscribed`
- `/` (waitlist splash)

### Public API routes (no middleware session check)

- `/api/auth/callback`
- `/api/auth/signup`
- `/api/waitlist`
- `/api/email-action`

### All other API routes

Pass through middleware without session check, but each handler enforces its own auth via the standard pattern (see Auth Pattern below). This is intentional — middleware applying session checks to API routes was causing edge cases with token refresh during rec saves.

### All other page routes

Require authed session. Redirect to `/login?redirectTo=<path>`.

---

## `redirectTo` open-redirect protection

In `app/login/page.js`:

- Must start with `/`
- Must NOT start with `//` or `/\`
- Must NOT be `/login` or `/signup`
- Falls back to `/myai`

Without this, attackers could craft links like `/login?redirectTo=//evil.com` that send users to external sites after auth.

---

## SEO lockdown

- `app/layout.js` metadata: `robots: { index: false, follow: false }`
- `app/robots.js` serves `Disallow: /` to all crawlers

Public profiles at `/{handle}` are still web-accessible to authed visitors but aren't indexed.

---

## Auth pattern (canonical)

Reference implementation: `app/api/ai-response-ratings/route.js:17-40`. Reuse this pattern verbatim for new authed routes. Don't invent new auth shapes.

Pattern:

```javascript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function POST(request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Resolve auth_user_id → profiles.id for ownership checks
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (!profile) {
    return Response.json({ error: 'Profile not found' }, { status: 404 });
  }

  // Ownership check: profile.id must match the resource being modified
  // ... feature logic ...
}
```

Internal callers (e.g., `/api/taste-read/confirm` calling `generateTasteProfile` directly) bypass the route via direct function import to skip the auth gate. ChatView's URL fetches ride the same-origin Supabase auth cookie automatically.

---

## Admin access

### `/admin/feedback`

Shamal-only. Client-side handle check. Page renders only if `useCurator().handle === 'shamal'` (after `normalizeHandle()`).

### `/admin/transcripts`

Shamal AND Chris allowlist. Server-side enforcement in `app/api/admin/transcripts/route.js`. Allowlist enforced via `normalizeHandle()`. Logged as `[ADMIN_TRANSCRIPTS_ACCESS]` with `{ caller_profile_id, caller_handle, filterDays }`.

---

## Three operational modes

Layered flags on `profiles`. Each independent. Set via SQL — NEVER hardcode handle checks for these.

| Mode | Flag | Currently scoped | Purpose |
|------|------|------------------|---------|
| Stable | default | everyone | baseline behavior |
| Staging AI | `profiles.ai_profile = 'staging'` | @shamal, @chris | AI personality changes |
| Tester features | `profiles.is_tester = true` | @shamal, @chris | UI/workflow features |

Surfaces as `profile.aiProfile` and `profile.isTester` (camelCase) via `useCurator()`.

### Currently gated

By `is_tester`:
- "Save silently (don't notify subscribers)" toggle in QuickCaptureSheet
- (Add new tester features here as they ship)

By `ai_profile = 'staging'`:
- AI response thumbs (▲/▼) in chat
- Lens Charter (loaded first in staging prompt builders)
- Staging-only skill files in `lib/prompts/skills/staging/` (most are byte-identical to stable; staging-only divergences flagged in commit history)

See `docs/staging-lane.md` for staging mechanics.

---

## Profile resolution

Most authed routes need `profiles.id` (the internal ID), not `auth.users.id` (the Supabase auth ID). The mapping: `profiles.auth_user_id = auth.users.id`.

`useCurator()` (client) handles this resolution and exposes `profile.id`, `profile.handle`, `profile.aiProfile`, `profile.isTester` on all client routes.

Server-side: do the lookup explicitly. The auth pattern above shows the canonical query.

---

## Handle normalization

`profiles.handle` is stored without `@`. Client values may have `@` prefix. ALL handle comparisons must route through `normalizeHandle()` from `lib/handles.js`.

Bug class closed April 19, 2026 (commits `53cb4fc`, `7ca5dc6`) — every handle comparison site was audited and routed through the helper.

---

## RLS policies

Add RLS for every new write operation. Pattern for curator-owned resources:

```sql
CREATE POLICY "Users can manage own <resource>"
  ON <table> FOR ALL
  USING (profile_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid()));
```

For visitor-readable resources:

```sql
CREATE POLICY "Anyone can read <resource>"
  ON <table> FOR SELECT
  USING (true);
```

Combine these for resources that are owner-write but world-read (e.g., `taste_profiles`, `recommendations` with `visibility='public'`).

---

## Related files

- `middleware.js` — site-wide session enforcement
- `app/api/ai-response-ratings/route.js:17-40` — canonical auth pattern
- `app/login/page.js` — redirectTo protection
- `app/robots.js` — SEO lockdown
- `lib/handles.js` — `normalizeHandle()` (REQUIRED for all handle comparisons)
- `app/api/admin/transcripts/route.js` — admin allowlist enforcement
- `context/CuratorContext.jsx` — `useCurator()` profile loader

---

## Log markers

- `[ADMIN_TRANSCRIPTS_ACCESS]` — admin route entry: `{ caller_profile_id, caller_handle, filterDays }`
- `[AI_PROFILE]` — every authed request: `route=<chat|taste-read> profileId=... aiProfile=<stable|staging>`
