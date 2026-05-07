import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ── Look up inviter info for onboarding mode ──
// Each lookup is independent: a failure in one does not wipe the others.
// inviter_note has a fallback path in case onboarding never wrote used_by.
export async function getInviterContext(profileId) {
  const result = { inviterName: null, inviterHandle: null, inviterNote: null };
  let notePath = 'none';

  try {
    const sb = getSupabaseAdmin();

    const { data: profile, error: profileErr } = await sb
      .from("profiles")
      .select("invited_by")
      .eq("id", profileId)
      .maybeSingle();

    if (profileErr) {
      console.error(`[INVITER_CONTEXT_ERROR] profiles lookup profileId=${profileId} error=${profileErr.message}`);
      return result;
    }
    if (!profile?.invited_by) {
      console.log(`[INVITER_CONTEXT] profileId=${profileId} path=none reason=no_invited_by`);
      return result;
    }

    // Independent lookup: inviter name/handle
    const { data: inviter, error: inviterErr } = await sb
      .from("profiles")
      .select("name, handle")
      .eq("id", profile.invited_by)
      .maybeSingle();
    if (inviterErr) {
      console.error(`[INVITER_CONTEXT_ERROR] inviter profile lookup invited_by=${profile.invited_by} error=${inviterErr.message}`);
    } else if (inviter) {
      result.inviterName = inviter.name || null;
      result.inviterHandle = inviter.handle || null;
    }

    // Independent lookup: inviter_note (primary path — used_by linkage)
    const { data: primary, error: primaryErr } = await sb
      .from("invite_codes")
      .select("inviter_note")
      .eq("used_by", profileId)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();
    if (primaryErr) {
      console.error(`[INVITER_CONTEXT_ERROR] invite_codes primary lookup profileId=${profileId} error=${primaryErr.message}`);
    }
    if (primary?.inviter_note) {
      result.inviterNote = primary.inviter_note;
      notePath = 'primary';
    } else {
      // Fallback path: most recent code created by the inviter.
      // Recovers the note even if onboarding never wrote used_by.
      const { data: fallback, error: fallbackErr } = await sb
        .from("invite_codes")
        .select("inviter_note, used_at, created_at")
        .eq("created_by", profile.invited_by)
        .is("revoked_at", null)
        .order("used_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fallbackErr) {
        console.error(`[INVITER_CONTEXT_ERROR] invite_codes fallback lookup invited_by=${profile.invited_by} error=${fallbackErr.message}`);
      }
      if (fallback?.inviter_note) {
        result.inviterNote = fallback.inviter_note;
        notePath = 'fallback';
      }
    }

    console.log(`[INVITER_CONTEXT] profileId=${profileId} path=${notePath} name=${!!result.inviterName} handle=${!!result.inviterHandle} note=${!!result.inviterNote}`);
    return result;
  } catch (err) {
    console.error(`[INVITER_CONTEXT_ERROR] unexpected profileId=${profileId} error=${err.message}`);
    return result;
  }
}
