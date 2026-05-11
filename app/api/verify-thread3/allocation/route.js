// app/api/_verify/allocation/route.js
//
// TEMPORARY. Server-side reconciliation endpoint for the Thread 3 allocation
// calculator. Returns raw calculator output for hand-math verification against
// production data without a local Node env. Hard-gated to three handles.
//
// Delete in Thread 7 cleanup. Tracked in CLAUDE.md Payouts System section.
//
// Query:
//   GET /api/_verify/allocation?subscriber=<handle>
//   GET /api/_verify/allocation?earnings=<handle>

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  calculateMonthlyAllocation,
  startOfMonthISO,
  startOfNextMonthISO,
} from "@/lib/allocation/calculate";
import { calculateMonthlyEarnings } from "@/lib/allocation/calculate-earnings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_HANDLES = new Set(["shamal", "chris", "testmctesty"]);

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

function normalizeHandle(h) {
  return String(h || "").trim().replace(/^@/, "").toLowerCase();
}

export async function GET(request) {
  try {
    const cookieStore = await cookies();
    const supabase = getServerSupabase(cookieStore);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { data: viewer, error: viewerErr } = await supabase
      .from("profiles")
      .select("id, handle")
      .eq("auth_user_id", user.id)
      .single();
    if (viewerErr || !viewer) {
      return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
    }

    const viewerHandle = normalizeHandle(viewer.handle);
    if (!ALLOWED_HANDLES.has(viewerHandle)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const subscriberHandle = url.searchParams.get("subscriber");
    const earningsHandle = url.searchParams.get("earnings");

    if (!subscriberHandle && !earningsHandle) {
      return NextResponse.json(
        { error: "missing_query", detail: "Pass ?subscriber=<handle> or ?earnings=<handle>" },
        { status: 400 }
      );
    }
    if (subscriberHandle && earningsHandle) {
      return NextResponse.json(
        { error: "ambiguous_query", detail: "Pass exactly one of ?subscriber or ?earnings" },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();
    const targetHandle = normalizeHandle(subscriberHandle || earningsHandle);

    const { data: target, error: targetErr } = await admin
      .from("profiles")
      .select("id, handle, is_tester, feature_flags")
      .ilike("handle", targetHandle)
      .maybeSingle();
    if (targetErr) {
      return NextResponse.json({ error: "target_lookup_failed", detail: targetErr.message }, { status: 500 });
    }
    if (!target) {
      return NextResponse.json({ error: "target_not_found", handle: targetHandle }, { status: 404 });
    }

    const now = new Date();
    const monthStart = startOfMonthISO(now);
    const monthEnd = startOfNextMonthISO(now);

    if (subscriberHandle) {
      const result = await calculateMonthlyAllocation({
        subscriberId: target.id,
        monthStart,
        monthEnd,
        supabase: admin,
      });
      return NextResponse.json({
        mode: "subscriber",
        viewer: { handle: viewer.handle },
        target: { id: target.id, handle: target.handle, is_tester: target.is_tester, feature_flags: target.feature_flags || {} },
        window: { monthStart, monthEnd },
        result,
      });
    }

    const result = await calculateMonthlyEarnings({
      curatorId: target.id,
      monthStart,
      monthEnd,
      supabase: admin,
    });
    return NextResponse.json({
      mode: "earnings",
      viewer: { handle: viewer.handle },
      target: { id: target.id, handle: target.handle, is_tester: target.is_tester, feature_flags: target.feature_flags || {} },
      window: { monthStart, monthEnd },
      result,
    });
  } catch (err) {
    console.error("[VERIFY_ALLOCATION_ERROR]", err?.stack || err?.message || err);
    return NextResponse.json({ error: "server_error", detail: err?.message || String(err) }, { status: 500 });
  }
}
