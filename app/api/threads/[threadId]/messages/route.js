import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasFeature } from "@/lib/features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

// POST /api/threads/[threadId]/messages
// Body: { body: string }
// Returns: { ok, message_id }
export async function POST(request, { params }) {
  try {
    const { threadId } = params;
    if (!threadId) {
      return NextResponse.json({ error: "thread_id_required" }, { status: 400 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const messageBody = (body?.body || "").trim();
    if (!messageBody) {
      return NextResponse.json({ error: "body_required" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabase = getServerSupabase(cookieStore);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Sender profile + payout_threads gate.
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, feature_flags")
      .eq("auth_user_id", user.id)
      .single();

    if (profileErr || !profile) {
      return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
    }

    if (!hasFeature(profile, "payout_threads")) {
      return NextResponse.json({ error: "feature_disabled" }, { status: 403 });
    }

    // Confirm thread + participant (RLS would also enforce, but we want explicit 403/404).
    const { data: thread, error: threadErr } = await supabase
      .from("threads")
      .select("id, subscriber_id, curator_id")
      .eq("id", threadId)
      .single();

    if (threadErr || !thread) {
      return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
    }

    if (thread.subscriber_id !== profile.id && thread.curator_id !== profile.id) {
      return NextResponse.json({ error: "not_a_participant" }, { status: 403 });
    }

    const { data: message, error: msgErr } = await supabase
      .from("thread_messages")
      .insert({
        thread_id: threadId,
        sender_id: profile.id,
        body: messageBody,
      })
      .select("id, created_at")
      .single();

    if (msgErr) {
      console.error("[THREAD_MESSAGE_INSERT_ERROR]", msgErr.message);
      return NextResponse.json({ error: "insert_failed", detail: msgErr.message }, { status: 500 });
    }

    // Touch last_message_at. Migration 007 has no UPDATE policy on threads for participants,
    // so this may fail silently under the user's session. Non-fatal — Thread 4 will revisit
    // (either add a scoped UPDATE policy or move the touch to service-role).
    const { error: touchErr } = await supabase
      .from("threads")
      .update({ last_message_at: message.created_at })
      .eq("id", threadId);

    if (touchErr) {
      console.error("[THREAD_TOUCH_FAILED]", touchErr.message);
    }

    return NextResponse.json({ ok: true, message_id: message.id });
  } catch (err) {
    console.error("[THREAD_MESSAGE_ROUTE_ERROR]", err?.message || err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
