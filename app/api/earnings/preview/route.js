// app/api/earnings/preview/route.js
//
// Per-curator earnings preview. Auth-gated via cookie session, then gated on
// payout_earnings_ui server-side. Calls calculateMonthlyEarnings for the viewer
// treated as curator.

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/features";
import { calculateMonthlyEarnings } from "@/lib/allocation/calculate-earnings";
import { startOfMonthISO, startOfNextMonthISO } from "@/lib/allocation/calculate";

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

export async function GET() {
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

  const enabled = await isFeatureEnabled(admin, profile.id, "payout_earnings_ui");
  if (!enabled) {
    return NextResponse.json({ error: "not_enabled" }, { status: 403 });
  }

  const now = new Date();
  const monthStart = startOfMonthISO(now);
  const monthEnd = startOfNextMonthISO(now);

  try {
    const result = await calculateMonthlyEarnings({
      curatorId: profile.id,
      monthStart,
      monthEnd,
      supabase: admin,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[EARNINGS_CALC_ERROR]", err?.message || err);
    return NextResponse.json({ error: "calc_failed", detail: err?.message || String(err) }, { status: 500 });
  }
}
