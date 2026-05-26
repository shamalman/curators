import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { generateTasteProfile } from "../../../../lib/taste-profile/generate.js";

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

function buildSourceKey(rec_file_id, source_url) {
  if (rec_file_id) return `taste_read:${rec_file_id}`;
  if (source_url) return `taste_read:${source_url}`;
  return "taste_read:unknown";
}

export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const user = await getAuthUser(cookieStore);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { inference_text, source_url, rec_file_id } = body || {};

    const admin = getSupabaseAdmin();

    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();

    if (profileErr || !profile) {
      console.error("[TASTE_READ_CONFIRM] profile lookup failed:", profileErr?.message);
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    const profileId = profile.id;

    const observation = typeof inference_text === "string" ? inference_text.trim() : "";
    const sourceKey = buildSourceKey(rec_file_id, source_url);

    if (!observation) {
      return NextResponse.json({ error: "inference_text is required" }, { status: 400 });
    }

    const { error: insertErr } = await admin
      .from("taste_confirmations")
      .insert({
        profile_id: profileId,
        type: "taste_read_confirmed",
        observation,
        source: sourceKey,
      });

    if (insertErr) {
      console.error("[TASTE_READ_CONFIRM] insert failed:", insertErr.message);
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }

    // Regenerate the Record inline (awaited) so the work completes before the
    // serverless instance can freeze. Next 14.2.5 has no after(), and the old
    // fire-and-forget IIFE was dropping regens on Vercel.
    try {
      await generateTasteProfile(profileId, admin);
      console.log("[TASTE_READ_CONFIRM] taste profile regenerated for", profileId);
    } catch (err) {
      console.error("[TASTE_READ_CONFIRM] taste profile regen failed:", err?.message || err);
      // Note: regen failure is non-fatal for the user-facing action. The confirmation/refinement
      // has already persisted; only the Record regen failed. Surface in logs but do not throw.
    }

    console.log(`[TASTE_READ_CONFIRM] profileId=${profileId} source=${sourceKey} observationLength=${observation.length}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[TASTE_READ_CONFIRM]", err?.message || err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const cookieStore = await cookies();
    const user = await getAuthUser(cookieStore);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { inference_text, source_url, rec_file_id } = await request.json();
    const observation = typeof inference_text === "string" ? inference_text.trim() : "";
    if (!observation) {
      return NextResponse.json({ error: "inference_text is required" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();
    if (profileErr || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    const profileId = profile.id;
    const sourceKey = buildSourceKey(rec_file_id, source_url);

    const { data: row, error: selErr } = await admin
      .from("taste_confirmations")
      .select("id")
      .eq("profile_id", profileId)
      .eq("type", "taste_read_confirmed")
      .eq("observation", observation)
      .eq("source", sourceKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (selErr) {
      console.error("[TASTE_READ_CONFIRM_UNDO] select failed:", selErr.message);
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ ok: true, deleted: 0 });
    }

    const { error: delErr } = await admin
      .from("taste_confirmations")
      .delete()
      .eq("id", row.id);
    if (delErr) {
      console.error("[TASTE_READ_CONFIRM_UNDO] delete failed:", delErr.message);
      return NextResponse.json({ error: "Delete failed" }, { status: 500 });
    }

    try {
      await generateTasteProfile(profileId, admin);
      console.log("[TASTE_READ_CONFIRM_UNDO] taste profile regenerated for", profileId);
    } catch (err) {
      console.error("[TASTE_READ_CONFIRM_UNDO] regen failed:", err?.message || err);
      // Note: regen failure is non-fatal for the user-facing action. The confirmation/refinement
      // has already persisted; only the Record regen failed. Surface in logs but do not throw.
    }

    console.log(`[TASTE_READ_CONFIRM_UNDO] profileId=${profileId} source=${sourceKey}`);
    return NextResponse.json({ ok: true, deleted: 1 });
  } catch (err) {
    console.error("[TASTE_READ_CONFIRM_UNDO]", err?.message || err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
