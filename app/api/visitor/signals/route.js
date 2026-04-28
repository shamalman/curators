import { createClient } from "@supabase/supabase-js";
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

const ZERO_BREAKDOWN = {
  taste_reads: 0,
  validations: 0,
  saves: 0,
  subscriptions: 0,
};

function safeCount(settled, label) {
  if (settled.status === "rejected") {
    console.error(`[VISITOR_SIGNALS_ERROR] ${label} rejected:`, settled.reason);
    return 0;
  }
  const res = settled.value;
  if (res?.error) {
    console.error(`[VISITOR_SIGNALS_ERROR] ${label}:`, res.error.message);
    return 0;
  }
  return res?.count || 0;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get("profile_id");

    if (typeof profileId !== "string" || profileId.trim() === "") {
      return NextResponse.json({ error: "profile_id required" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    const [tasteReadsRes, correctionsRes, savesRes, subsRes] = await Promise.allSettled([
      admin
        .from("taste_confirmations")
        .select("*", { count: "exact", head: true })
        .eq("profile_id", profileId)
        .eq("type", "taste_read_confirmed"),
      admin
        .from("taste_confirmations")
        .select("*", { count: "exact", head: true })
        .eq("profile_id", profileId)
        .eq("type", "correction"),
      admin
        .from("saved_recs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", profileId),
      admin
        .from("subscriptions")
        .select("*", { count: "exact", head: true })
        .eq("subscriber_id", profileId)
        .is("unsubscribed_at", null),
    ]);

    const breakdown = {
      taste_reads: safeCount(tasteReadsRes, "taste_reads"),
      validations: safeCount(correctionsRes, "validations"),
      saves: safeCount(savesRes, "saves"),
      subscriptions: safeCount(subsRes, "subscriptions"),
    };

    const signal_count =
      breakdown.taste_reads +
      breakdown.validations +
      breakdown.saves +
      breakdown.subscriptions;

    return NextResponse.json({ signal_count, breakdown });
  } catch (err) {
    console.error("[VISITOR_SIGNALS_FATAL]", err);
    return NextResponse.json(
      { signal_count: 0, breakdown: { ...ZERO_BREAKDOWN } },
      { status: 200 }
    );
  }
}
