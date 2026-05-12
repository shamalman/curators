import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/features";

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

export async function POST(req, { params }) {
  const { validationId } = params;
  if (!validationId) {
    return NextResponse.json({ error: "missing_validation_id" }, { status: 400 });
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

  const enabled = await isFeatureEnabled(admin, profile.id, "payout_validation");
  if (!enabled) {
    return NextResponse.json({ error: "not_enabled" }, { status: 403 });
  }

  const { data: validation, error: vErr } = await admin
    .from("validations")
    .select("id, subscriber_id, verbatim_text, retracted_at")
    .eq("id", validationId)
    .single();
  if (vErr || !validation) {
    return NextResponse.json({ error: "validation_not_found" }, { status: 404 });
  }
  if (validation.subscriber_id !== profile.id) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }
  if (validation.retracted_at) {
    return NextResponse.json({ error: "already_retracted" }, { status: 409 });
  }

  const retractedAt = new Date().toISOString();

  const { error: updateErr } = await admin
    .from("validations")
    .update({ retracted_at: retractedAt })
    .eq("id", validationId);
  if (updateErr) {
    console.error("[VALIDATION_RETRACT_ERROR]", updateErr.message);
    return NextResponse.json({ error: "retract_failed", detail: updateErr.message }, { status: 500 });
  }

  const { error: commentErr } = await admin
    .from("comments")
    .update({ deleted_at: retractedAt })
    .eq("validation_id", validationId)
    .is("deleted_at", null);
  if (commentErr) {
    console.error("[VALIDATION_RETRACT_CASCADE_FAILED]", "comment_soft_delete", commentErr.message);
  }

  const { error: tcErr } = await admin
    .from("taste_confirmations")
    .insert({
      profile_id: profile.id,
      type: "validation_retracted",
      observation: `Retracted: ${validation.verbatim_text}`,
      source: `validation:${validationId}`,
    });
  if (tcErr) {
    console.error("[VALIDATION_RETRACT_CASCADE_FAILED]", "taste_confirmations_append", tcErr.message);
  }

  console.log("[VALIDATION_RETRACTED]", validationId);
  return NextResponse.json({ retracted_at: retractedAt });
}
