import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { MAX_UNUSED_INVITES } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function getCallerProfile(admin, authUserId) {
  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .single();
  if (error || !data) return null;
  return data;
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let rand = "";
  for (let i = 0; i < 6; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return `CURATORS-${rand}`;
}

// GET: paginated invite list (mode=all) or current shareable code (no flags).
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get("profileId");
    if (!profileId) {
      return NextResponse.json({ error: "Missing profileId" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();

    const { data: curatorProfile } = await sb
      .from("profiles")
      .select("unlimited_invites")
      .eq("id", profileId)
      .single();
    const unlimitedInvites = curatorProfile?.unlimited_invites === true;
    console.log(`[INVITE] profileId=${profileId} unlimited_invites=${curatorProfile?.unlimited_invites} resolved=${unlimitedInvites}`);

    const mode = searchParams.get("mode");

    if (mode === "all") {
      const status = searchParams.get("status") === "used" ? "used" : "pending";
      const offsetParam = parseInt(searchParams.get("offset") || "0", 10);
      const limitParam = parseInt(searchParams.get("limit") || "10", 10);
      const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;
      const limit = Math.min(
        Math.max(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 10, 1),
        50
      );

      // Counts for both tabs are always returned so the UI badge stays accurate
      // regardless of which tab was just loaded.
      const [{ count: pendingCount }, { count: usedCount }] = await Promise.all([
        sb.from("invite_codes")
          .select("id", { count: "exact", head: true })
          .eq("created_by", profileId)
          .is("used_at", null)
          .is("revoked_at", null),
        sb.from("invite_codes")
          .select("id", { count: "exact", head: true })
          .eq("created_by", profileId)
          .not("used_at", "is", null),
      ]);

      let rows = [];

      if (status === "pending") {
        const { data } = await sb
          .from("invite_codes")
          .select("id, code, inviter_note, created_at")
          .eq("created_by", profileId)
          .is("used_at", null)
          .is("revoked_at", null)
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);
        rows = data || [];
      } else {
        const { data: usedCodes } = await sb
          .from("invite_codes")
          .select("id, code, used_at, used_by, inviter_note, created_at")
          .eq("created_by", profileId)
          .not("used_at", "is", null)
          .order("used_at", { ascending: false })
          .range(offset, offset + limit - 1);

        const codes = usedCodes || [];

        // Direct used_by → profile name/handle (preferred path).
        const usedByIds = codes.filter(c => c.used_by).map(c => c.used_by);
        const profilesById = {};
        if (usedByIds.length > 0) {
          const { data: usedProfiles } = await sb
            .from("profiles")
            .select("id, name, handle")
            .in("id", usedByIds);
          (usedProfiles || []).forEach(p => { profilesById[p.id] = p; });
        }

        // Timestamp-proximity fallback for codes whose used_by was never written.
        let profilePool = [];
        if (codes.some(c => !c.used_by && c.used_at)) {
          const { data: invitedProfiles } = await sb
            .from("profiles")
            .select("id, name, handle, created_at")
            .eq("invited_by", profileId)
            .order("created_at", { ascending: false });
          profilePool = [...(invitedProfiles || [])];
        }

        rows = codes.map(c => {
          const entry = { ...c, profile_name: null, profile_handle: null };
          if (c.used_by && profilesById[c.used_by]) {
            entry.profile_name = profilesById[c.used_by].name;
            entry.profile_handle = profilesById[c.used_by].handle;
          } else if (c.used_at && profilePool.length > 0) {
            let bestIdx = 0;
            let bestDiff = Infinity;
            const usedTime = new Date(c.used_at).getTime();
            profilePool.forEach((p, idx) => {
              const diff = Math.abs(new Date(p.created_at).getTime() - usedTime);
              if (diff < bestDiff) { bestDiff = diff; bestIdx = idx; }
            });
            if (bestDiff < 86400000) {
              const p = profilePool.splice(bestIdx, 1)[0];
              entry.profile_name = p.name;
              entry.profile_handle = p.handle;
            }
          }
          return entry;
        });
      }

      const totalForStatus = status === "pending" ? (pendingCount || 0) : (usedCount || 0);
      const hasMore = rows.length === limit && offset + rows.length < totalForStatus;

      return NextResponse.json({
        rows,
        status,
        offset,
        limit,
        hasMore,
        counts: { pending: pendingCount || 0, used: usedCount || 0 },
        unlimitedInvites,
      });
    }

    // No flags: legacy "current shareable code" path. No remaining caller in
    // this codebase — kept defensively in case any stray client still hits it.
    // Safe to delete in a follow-up.
    const { data: unusedCodes } = await sb
      .from("invite_codes")
      .select("id, code, inviter_note")
      .eq("created_by", profileId)
      .is("used_at", null)
      .order("created_at", { ascending: false });

    const unused = unusedCodes || [];

    if (unused.length > 0) {
      return NextResponse.json({ code: unused[0], unusedCount: unused.length, unlimitedInvites });
    }

    const newCode = generateCode();
    const { data: created, error: insertErr } = await sb
      .from("invite_codes")
      .insert({ code: newCode, created_by: profileId })
      .select("id, code, inviter_note")
      .single();

    if (insertErr) {
      console.error("Failed to create invite code:", insertErr);
      return NextResponse.json({ error: "Failed to generate code" }, { status: 500 });
    }

    console.log('TRACKING: sent an invite (GET), profileId:', profileId);
    const { error: trackingError } = await sb.from('profiles').update({
      last_seen_at: new Date().toISOString(),
      last_action: 'sent an invite',
      last_action_at: new Date().toISOString()
    }).eq('id', profileId);
    if (trackingError) console.error('TRACKING ERROR:', trackingError);

    return NextResponse.json({ code: created, unusedCount: 1, unlimitedInvites });
  } catch (error) {
    console.error("Invite fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch invite" }, { status: 500 });
  }
}

// POST: Update inviter_note or generate a new code.
export async function POST(request) {
  try {
    const { codeId, inviterNote, profileId, action } = await request.json();

    const sb = getSupabaseAdmin();

    if (action === "generate") {
      if (!profileId) {
        return NextResponse.json({ error: "Missing profileId" }, { status: 400 });
      }

      const { data: profile } = await sb
        .from("profiles")
        .select("unlimited_invites")
        .eq("id", profileId)
        .single();

      const unlimited = profile?.unlimited_invites === true;

      // Exclude revoked codes from the cap so revoke + replace works.
      const { data: unusedCodes } = await sb
        .from("invite_codes")
        .select("id")
        .eq("created_by", profileId)
        .is("used_at", null)
        .is("revoked_at", null);

      if (!unlimited && (unusedCodes || []).length >= MAX_UNUSED_INVITES) {
        return NextResponse.json({ error: "limit_reached", max: MAX_UNUSED_INVITES }, { status: 429 });
      }

      const newCode = generateCode();
      const { data: created, error: insertErr } = await sb
        .from("invite_codes")
        .insert({ code: newCode, created_by: profileId })
        .select("id, code, inviter_note")
        .single();

      if (insertErr) {
        console.error("Failed to create invite code:", insertErr);
        return NextResponse.json({ error: "Failed to generate code" }, { status: 500 });
      }

      console.log('TRACKING: sent an invite (POST), profileId:', profileId);
      const { error: trackingError } = await sb.from('profiles').update({
        last_seen_at: new Date().toISOString(),
        last_action: 'sent an invite',
        last_action_at: new Date().toISOString()
      }).eq('id', profileId);
      if (trackingError) console.error('TRACKING ERROR:', trackingError);

      return NextResponse.json({ code: created });
    }

    if (!codeId) {
      return NextResponse.json({ error: "Missing codeId" }, { status: 400 });
    }

    const { error } = await sb
      .from("invite_codes")
      .update({ inviter_note: inviterNote || null })
      .eq("id", codeId);

    if (error) {
      console.error("Failed to update inviter_note:", error);
      return NextResponse.json({ error: "Failed to save note" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Invite update error:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

// DELETE: soft-revoke a pending invite code.
// Auth pattern matches app/api/ai-response-ratings/route.js (cookie session +
// profiles.auth_user_id ownership check). The pre-existing GET/POST handlers
// in this file trust profileId without verification — that's tech debt we
// don't replicate here, since revoke is destructive.
export async function DELETE(request) {
  try {
    const cookieStore = await cookies();
    const user = await getAuthUser(cookieStore);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { codeId, profileId } = await request.json();
    if (!codeId || !profileId) {
      return NextResponse.json({ error: "Missing codeId or profileId" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const caller = await getCallerProfile(sb, user.id);
    if (!caller || caller.id !== profileId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: code, error: fetchErr } = await sb
      .from("invite_codes")
      .select("id, used_at, revoked_at")
      .eq("id", codeId)
      .eq("created_by", profileId)
      .maybeSingle();
    if (fetchErr) {
      console.error("[INVITE_REVOKE_ERROR] fetch", fetchErr);
      return NextResponse.json({ error: "Failed to revoke" }, { status: 500 });
    }
    if (!code) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (code.used_at) {
      return NextResponse.json({ error: "cannot_revoke_used" }, { status: 400 });
    }

    const revokedAt = new Date().toISOString();
    const { error: updateErr } = await sb
      .from("invite_codes")
      .update({ revoked_at: revokedAt })
      .eq("id", codeId);
    if (updateErr) {
      console.error("[INVITE_REVOKE_ERROR] update", updateErr);
      return NextResponse.json({ error: "Failed to revoke" }, { status: 500 });
    }

    const { error: trackingError } = await sb.from("profiles").update({
      last_seen_at: new Date().toISOString(),
      last_action: "revoked an invite",
      last_action_at: new Date().toISOString(),
    }).eq("id", profileId);
    if (trackingError) console.error("TRACKING ERROR:", trackingError);

    return NextResponse.json({ ok: true, revokedAt });
  } catch (error) {
    console.error("[INVITE_REVOKE_ERROR] unexpected", error);
    return NextResponse.json({ error: "Failed to revoke" }, { status: 500 });
  }
}
