import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function getServerSupabase(cookieStore) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
      },
    }
  );
}

async function authAndOwnsRec(commentId, userAuthId, supabase, admin) {
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("auth_user_id", userAuthId)
    .single();
  if (profileErr || !profile) return { error: "profile_not_found", status: 404 };

  const { data: comment, error: cErr } = await admin
    .from("comments")
    .select("id, rec_id")
    .eq("id", commentId)
    .single();
  if (cErr || !comment) return { error: "comment_not_found", status: 404 };

  const { data: rec, error: rErr } = await admin
    .from("recommendations")
    .select("id, profile_id")
    .eq("id", comment.rec_id)
    .single();
  if (rErr || !rec) return { error: "rec_not_found", status: 404 };

  if (rec.profile_id !== profile.id) {
    return { error: "not_curator_of_rec", status: 403 };
  }

  return { profile, comment };
}

export async function POST(req, { params }) {
  const { commentId } = params;
  if (!commentId) {
    return NextResponse.json({ error: "missing_comment_id" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = getServerSupabase(cookieStore);
  const admin = getSupabaseAdmin();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const check = await authAndOwnsRec(commentId, user.id, supabase, admin);
  if (check.error) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const hiddenAt = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("comments")
    .update({ hidden_by_curator_at: hiddenAt })
    .eq("id", commentId);
  if (updateErr) {
    console.error("[COMMENT_HIDE_ERROR]", updateErr.message);
    return NextResponse.json({ error: "hide_failed" }, { status: 500 });
  }

  return NextResponse.json({ hidden_by_curator_at: hiddenAt });
}

export async function DELETE(req, { params }) {
  const { commentId } = params;
  if (!commentId) {
    return NextResponse.json({ error: "missing_comment_id" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = getServerSupabase(cookieStore);
  const admin = getSupabaseAdmin();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const check = await authAndOwnsRec(commentId, user.id, supabase, admin);
  if (check.error) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { error: updateErr } = await admin
    .from("comments")
    .update({ hidden_by_curator_at: null })
    .eq("id", commentId);
  if (updateErr) {
    console.error("[COMMENT_UNHIDE_ERROR]", updateErr.message);
    return NextResponse.json({ error: "unhide_failed" }, { status: 500 });
  }

  return NextResponse.json({ hidden_by_curator_at: null });
}
