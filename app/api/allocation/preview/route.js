import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/features";
import { getProfileAvatarUrl } from "@/lib/profile-avatar";
import {
  calculateMonthlyAllocation,
  startOfMonthISO as calcStartOfMonth,
  startOfNextMonthISO as calcStartOfNextMonth,
} from "@/lib/allocation/calculate";

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

// Mocked totals locked by Thread 5 spec. Thread 3 replaces with real math.
const HERO_TOTAL = 10.50;
const ACTIVITY_TOTAL = 5.20;
const FLOOR_TOTAL = 1.30;
const UNALLOCATED_TOTAL = 4.00;

const VALIDATION_WEIGHT = 3;
const SAVE_WEIGHT = 1;

function daysRemainingInMonth(now) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = now.getUTCDate();
  return Math.max(0, lastDay - today);
}

function startOfMonthISO(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function monthLabel(now) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// Distribute a total across rows by weight, rounding to cents.
// Last row absorbs the remainder so the sum is exact.
function distributeProportional(rows, totalDollars) {
  const totalWeight = rows.reduce((acc, r) => acc + r.weight, 0);
  if (totalWeight === 0 || rows.length === 0) return rows.map(r => ({ ...r, amount: "0.00" }));

  const totalCents = Math.round(totalDollars * 100);
  let allocatedCents = 0;
  const out = rows.map((r, i) => {
    let cents;
    if (i === rows.length - 1) {
      cents = totalCents - allocatedCents;
    } else {
      cents = Math.round((r.weight / totalWeight) * totalCents);
      allocatedCents += cents;
    }
    return { ...r, amount: (cents / 100).toFixed(2) };
  });
  return out;
}

export async function GET() {
  const cookieStore = await cookies();
  const supabase = getServerSupabase(cookieStore);
  const admin = getSupabaseAdmin();

  // Auth
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Profile lookup
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();
  if (profileErr || !profile) {
    return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
  }

  // Feature flag gate (server-side). payout_allocation_ui is the ACCESS gate
  // for this endpoint and is independent of payout_real_math (the calculator
  // selector). Do not collapse them.
  const enabled = await isFeatureEnabled(admin, profile.id, "payout_allocation_ui");
  if (!enabled) {
    return NextResponse.json({ error: "not_enabled" }, { status: 403 });
  }

  // payout_real_math selects the real calculator vs the Thread 5 mock.
  const realMath = await isFeatureEnabled(admin, profile.id, "payout_real_math");
  if (realMath) {
    const nowReal = new Date();
    const monthStartReal = calcStartOfMonth(nowReal);
    const monthEndReal = calcStartOfNextMonth(nowReal);
    try {
      const result = await calculateMonthlyAllocation({
        subscriberId: profile.id,
        monthStart: monthStartReal,
        monthEnd: monthEndReal,
        supabase: admin,
      });
      return NextResponse.json(result);
    } catch (err) {
      console.error("[ALLOCATION_CALC_ERROR]", err?.message || err);
      return NextResponse.json({ error: "calc_failed", detail: err?.message || String(err) }, { status: 500 });
    }
  }

  const now = new Date();
  const monthStart = startOfMonthISO(now);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Pull viewer's validations this calendar month, non-retracted
  const { data: validations, error: vErr } = await admin
    .from("validations")
    .select("curator_id")
    .eq("subscriber_id", profile.id)
    .is("retracted_at", null)
    .gte("created_at", monthStart);
  if (vErr) {
    console.error("[ALLOCATION_VALIDATIONS_ERROR]", vErr.message);
    return NextResponse.json({ error: "validations_query_failed" }, { status: 500 });
  }

  // Pull viewer's saves this calendar month
  // saved_recs columns: user_id, recommendation_id, saved_at
  // Need to join to recommendations to get curator_id (recommendations.profile_id)
  const { data: saves, error: sErr } = await admin
    .from("saved_recs")
    .select("recommendation_id, saved_at")
    .eq("user_id", profile.id)
    .gte("saved_at", monthStart);
  if (sErr) {
    console.error("[ALLOCATION_SAVES_ERROR]", sErr.message);
    return NextResponse.json({ error: "saves_query_failed" }, { status: 500 });
  }

  // Resolve curator_id for each save via recommendations.profile_id
  let saveCuratorIds = [];
  if (saves && saves.length > 0) {
    const recIds = saves.map(s => s.recommendation_id).filter(Boolean);
    if (recIds.length > 0) {
      const { data: recs, error: rErr } = await admin
        .from("recommendations")
        .select("id, profile_id")
        .in("id", recIds);
      if (rErr) {
        console.error("[ALLOCATION_RECS_ERROR]", rErr.message);
        return NextResponse.json({ error: "recs_query_failed" }, { status: 500 });
      }
      const recMap = new Map((recs || []).map(r => [r.id, r.profile_id]));
      saveCuratorIds = saves
        .map(s => recMap.get(s.recommendation_id))
        .filter(Boolean);
    }
  }

  // Aggregate signals per curator
  const signalsByCurator = new Map();
  for (const v of (validations || [])) {
    if (!v.curator_id) continue;
    const entry = signalsByCurator.get(v.curator_id) || { validations: 0, saves: 0 };
    entry.validations += 1;
    signalsByCurator.set(v.curator_id, entry);
  }
  for (const cid of saveCuratorIds) {
    const entry = signalsByCurator.get(cid) || { validations: 0, saves: 0 };
    entry.saves += 1;
    signalsByCurator.set(cid, entry);
  }

  // Pull viewer's active subscriptions
  const { data: subs, error: subsErr } = await admin
    .from("subscriptions")
    .select("curator_id")
    .eq("subscriber_id", profile.id)
    .is("unsubscribed_at", null);
  if (subsErr) {
    console.error("[ALLOCATION_SUBS_ERROR]", subsErr.message);
    return NextResponse.json({ error: "subscriptions_query_failed" }, { status: 500 });
  }
  const subscribedCuratorIds = (subs || []).map(s => s.curator_id).filter(Boolean);

  // Determine "active curators" — subscribed curators with at least one rec in last 30d
  let activeCuratorIds = [];
  if (subscribedCuratorIds.length > 0) {
    const { data: activeRecs, error: arErr } = await admin
      .from("recommendations")
      .select("profile_id")
      .in("profile_id", subscribedCuratorIds)
      .gte("created_at", thirtyDaysAgo);
    if (arErr) {
      console.error("[ALLOCATION_ACTIVE_RECS_ERROR]", arErr.message);
      return NextResponse.json({ error: "active_recs_query_failed" }, { status: 500 });
    }
    activeCuratorIds = Array.from(new Set((activeRecs || []).map(r => r.profile_id).filter(Boolean)));
  }

  // Resolve handles + avatars for everyone we'll display
  const allCuratorIds = Array.from(new Set([
    ...signalsByCurator.keys(),
    ...activeCuratorIds,
  ]));

  let profileMap = new Map();
  if (allCuratorIds.length > 0) {
    const { data: profs, error: pErr } = await admin
      .from("profiles")
      .select("id, handle")
      .in("id", allCuratorIds);
    if (pErr) {
      console.error("[ALLOCATION_PROFILES_ERROR]", pErr.message);
      return NextResponse.json({ error: "profiles_query_failed" }, { status: 500 });
    }
    // TODO: pass authUser when bulk auth lookup is added.
    profileMap = new Map((profs || []).map(p => [p.id, { handle: p.handle, avatar_url: getProfileAvatarUrl(p, null) }]));
  }

  // Block A — Activity (distribute ACTIVITY_TOTAL across curators with signals by weight)
  const activityRows = Array.from(signalsByCurator.entries()).map(([curatorId, sig]) => {
    const weight = sig.validations * VALIDATION_WEIGHT + sig.saves * SAVE_WEIGHT;
    const p = profileMap.get(curatorId) || {};
    return {
      curator_id: curatorId,
      handle: p.handle || "",
      avatar_url: p.avatar_url || null,
      validations: sig.validations,
      saves: sig.saves,
      weight,
    };
  });

  // Sort by weight descending so the largest contributor is the row that absorbs the rounding remainder.
  // Spec says "sorted by dollar amount descending" for display — same outcome since amounts track weights.
  activityRows.sort((a, b) => b.weight - a.weight);

  const activityWithAmounts = distributeProportional(activityRows, ACTIVITY_TOTAL).map(r => ({
    curator_id: r.curator_id,
    handle: r.handle,
    avatar_url: r.avatar_url,
    validations: r.validations,
    saves: r.saves,
    amount: r.amount,
  }));

  // Block B — Floor (split FLOOR_TOTAL evenly across active curators)
  let floorBlock;
  if (activeCuratorIds.length === 0) {
    floorBlock = {
      active_curator_handles: [],
      per_curator: "0.00",
      total: "0.00",
    };
  } else {
    const perCents = Math.floor((FLOOR_TOTAL * 100) / activeCuratorIds.length);
    const perCurator = (perCents / 100).toFixed(2);
    const handles = activeCuratorIds
      .map(id => profileMap.get(id)?.handle)
      .filter(Boolean)
      .sort();
    floorBlock = {
      active_curator_handles: handles,
      per_curator: perCurator,
      total: FLOOR_TOTAL.toFixed(2),
    };
  }

  return NextResponse.json({
    month: monthLabel(now),
    days_remaining: daysRemainingInMonth(now),
    hero: {
      total: HERO_TOTAL.toFixed(2),
      activity: ACTIVITY_TOTAL.toFixed(2),
      floor: FLOOR_TOTAL.toFixed(2),
      unallocated: UNALLOCATED_TOTAL.toFixed(2),
    },
    activity: activityWithAmounts,
    floor: floorBlock,
    unallocated: UNALLOCATED_TOTAL.toFixed(2),
    is_projected: true,
  });
}
