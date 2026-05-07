import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORPHAN_WINDOW_MS = 5 * 60 * 1000;

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function getAuthUser(cookieStore) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// POST: delete an orphan signup attempt (auth.users row + profile row if it exists).
// Caller must be authed AS the user being cleaned up. Used by the signup TOCTOU
// abort path so a revoked-mid-flow signup leaves no DB trace.
//
// Auth pattern matches app/api/invite/route.js DELETE: cookie session + service
// role admin client for writes.
//
// Critical: at the typical TOCTOU abort point in signup, the profile row has
// NOT been inserted yet (that happens in onboarding). So profile-not-found is
// a valid orphan state, not an error — we still proceed to delete the auth user.
export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const user = await getAuthUser(cookieStore);
    if (!user) {
      console.error("[ORPHAN_CLEANUP] unauthorized: no session");
      return NextResponse.json({ error: "unauthorized", detail: "no session" }, { status: 401 });
    }

    const { authUserId } = await request.json();
    if (!authUserId) {
      console.error("[ORPHAN_CLEANUP] missing_auth_user_id");
      return NextResponse.json({ error: "missing_auth_user_id", detail: "authUserId required in body" }, { status: 400 });
    }

    // Caller can only clean up their own account.
    if (user.id !== authUserId) {
      console.error("[ORPHAN_CLEANUP] auth_mismatch", { sessionUser: user.id, target: authUserId });
      return NextResponse.json({ error: "auth_mismatch", detail: "caller can only clean up their own account" }, { status: 403 });
    }

    const admin = getSupabaseAdmin();

    // Verify the auth user exists and is within the orphan window.
    const { data: authData, error: authLookupErr } = await admin.auth.admin.getUserById(authUserId);
    if (authLookupErr || !authData?.user) {
      console.error("[ORPHAN_CLEANUP] auth_user_not_found", { authUserId, error: authLookupErr?.message });
      return NextResponse.json({ error: "auth_user_not_found", detail: "no auth user with that id" }, { status: 404 });
    }
    const authAgeMs = Date.now() - new Date(authData.user.created_at).getTime();
    if (authAgeMs > ORPHAN_WINDOW_MS) {
      console.error("[ORPHAN_CLEANUP] auth_user_too_old", { authUserId, createdAt: authData.user.created_at, ageMs: authAgeMs });
      return NextResponse.json({ error: "auth_user_too_old", detail: "orphan window is 5 minutes" }, { status: 400 });
    }

    // Profile may or may not exist depending on how far signup got.
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("id, created_at")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (profileErr) {
      console.error("[ORPHAN_CLEANUP] profile_lookup_failed", { authUserId, error: profileErr.message });
      return NextResponse.json({ error: "profile_lookup_failed", detail: profileErr.message }, { status: 500 });
    }

    let cleanedProfileId = null;
    if (profile) {
      if (profile.created_at && Date.now() - new Date(profile.created_at).getTime() > ORPHAN_WINDOW_MS) {
        console.error("[ORPHAN_CLEANUP] profile_too_old", { profileId: profile.id, createdAt: profile.created_at });
        return NextResponse.json({ error: "profile_too_old", detail: "orphan window is 5 minutes" }, { status: 400 });
      }

      const { count: recCount, error: recErr } = await admin
        .from("recommendations")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profile.id);
      if (recErr) {
        console.error("[ORPHAN_CLEANUP] rec_count_failed", { profileId: profile.id, error: recErr.message });
        return NextResponse.json({ error: "rec_count_failed", detail: recErr.message }, { status: 500 });
      }
      if ((recCount || 0) > 0) {
        console.error("[ORPHAN_CLEANUP] profile_has_recs", { profileId: profile.id, count: recCount });
        return NextResponse.json({ error: "profile_has_recs", detail: "profile has recommendations, not an orphan" }, { status: 400 });
      }

      // Delete profile first. If the auth-user delete fails after this, we end
      // up with an auth user that has no profile — recoverable. The reverse
      // (profile pointing at a ghost auth user) is worse.
      const { error: profileDeleteErr } = await admin
        .from("profiles")
        .delete()
        .eq("id", profile.id);
      if (profileDeleteErr) {
        console.error("[ORPHAN_CLEANUP] profile_delete_failed", { profileId: profile.id, error: profileDeleteErr.message });
        return NextResponse.json({ error: "profile_delete_failed", detail: profileDeleteErr.message }, { status: 500 });
      }
      cleanedProfileId = profile.id;
    }

    const { error: authDeleteErr } = await admin.auth.admin.deleteUser(authUserId);
    if (authDeleteErr) {
      console.error("[ORPHAN_CLEANUP] auth_user_delete_failed", { authUserId, cleanedProfileId, error: authDeleteErr.message });
      return NextResponse.json({
        error: "auth_user_delete_failed",
        detail: authDeleteErr.message,
        profileDeleted: !!cleanedProfileId,
      }, { status: 500 });
    }

    console.log("[ORPHAN_CLEANUP] success", { authUserId, cleanedProfileId });
    return NextResponse.json({ ok: true, cleaned: { profileId: cleanedProfileId, authUserId } });
  } catch (err) {
    console.error("[ORPHAN_CLEANUP] unexpected", err);
    return NextResponse.json({ error: "internal", detail: err.message }, { status: 500 });
  }
}
