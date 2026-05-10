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

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function PATCH(req, { params }) {
  const { commentId } = params;
  if (!commentId) {
    return NextResponse.json({ error: "missing_comment_id" }, { status: 400 });
  }

  let payload;
  try { payload = await req.json(); } catch { payload = {}; }
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";
  if (!body) {
    return NextResponse.json({ error: "missing_body" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = getServerSupabase(cookieStore);
  const admin = getSupabaseAdmin();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();
  if (profileErr || !profile) {
    return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
  }

  const { data: comment, error: cErr } = await admin
    .from("comments")
    .select("id, profile_id, created_at, deleted_at")
    .eq("id", commentId)
    .single();
  if (cErr || !comment) {
    return NextResponse.json({ error: "comment_not_found" }, { status: 404 });
  }
  if (comment.profile_id !== profile.id) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }
  if (comment.deleted_at) {
    return NextResponse.json({ error: "comment_deleted" }, { status: 410 });
  }

  const ageMs = Date.now() - new Date(comment.created_at).getTime();
  if (ageMs > EDIT_WINDOW_MS) {
    return NextResponse.json(
      { error: "edit_window_expired", message: "Comments can only be edited within 24 hours of posting" },
      { status: 403 }
    );
  }

  const updatedAt = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("comments")
    .update({ body, updated_at: updatedAt })
    .eq("id", commentId);
  if (updateErr) {
    console.error("[COMMENT_EDIT_ERROR]", updateErr.message);
    return NextResponse.json({ error: "edit_failed" }, { status: 500 });
  }

  return NextResponse.json({ body, updated_at: updatedAt });
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

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();
  if (profileErr || !profile) {
    return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
  }

  const { data: comment, error: cErr } = await admin
    .from("comments")
    .select("id, profile_id, deleted_at")
    .eq("id", commentId)
    .single();
  if (cErr || !comment) {
    return NextResponse.json({ error: "comment_not_found" }, { status: 404 });
  }
  if (comment.profile_id !== profile.id) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }
  if (comment.deleted_at) {
    return NextResponse.json({ deleted_at: comment.deleted_at });
  }

  const deletedAt = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("comments")
    .update({ deleted_at: deletedAt })
    .eq("id", commentId);
  if (updateErr) {
    console.error("[COMMENT_DELETE_ERROR]", updateErr.message);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  return NextResponse.json({ deleted_at: deletedAt });
}
