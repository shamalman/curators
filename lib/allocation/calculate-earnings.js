// lib/allocation/calculate-earnings.js
//
// Per-curator earnings calculator. For a curator C, find every subscriber S
// with any signal touching C this month — a non-retracted validation on a C
// rec, a save on a C rec, OR an active subscription to C — then for each S
// extract C's slice from S's monthly allocation. Sum.
//
// No new money math lives here. All math is in lib/allocation/calculate.js;
// this file is composition + presentation.

import {
  calculateCuratorSliceFromSubscriber,
  unitsToDollarString,
  daysRemainingInMonth,
  monthLabel,
} from "./calculate.js";
import { getProfileAvatarUrl } from "@/lib/profile-avatar";

export async function calculateMonthlyEarnings({ curatorId, monthStart, monthEnd, supabase }) {
  if (!curatorId) throw new Error("curatorId required");
  if (!monthStart) throw new Error("monthStart required");

  const now = new Date();

  // (a) Subscribers who validated a rec of this curator this month, non-retracted.
  let validationsQuery = supabase
    .from("validations")
    .select("subscriber_id, rec_id")
    .eq("curator_id", curatorId)
    .is("retracted_at", null)
    .gte("created_at", monthStart);
  if (monthEnd) validationsQuery = validationsQuery.lt("created_at", monthEnd);
  const { data: vs, error: vErr } = await validationsQuery;
  if (vErr) throw new Error(`validations_query_failed: ${vErr.message}`);
  const validatorIds = new Set((vs || []).map((v) => v.subscriber_id).filter(Boolean));

  // (b) Subscribers who saved a rec of this curator this month.
  const { data: recs, error: rErr } = await supabase
    .from("recommendations")
    .select("id")
    .eq("profile_id", curatorId);
  if (rErr) throw new Error(`recs_query_failed: ${rErr.message}`);
  const curatorRecIds = (recs || []).map((r) => r.id);

  const saverIds = new Set();
  if (curatorRecIds.length > 0) {
    let savesQuery = supabase
      .from("saved_recs")
      .select("user_id")
      .in("recommendation_id", curatorRecIds)
      .gte("saved_at", monthStart);
    if (monthEnd) savesQuery = savesQuery.lt("saved_at", monthEnd);
    const { data: ss, error: sErr } = await savesQuery;
    if (sErr) throw new Error(`saved_recs_query_failed: ${sErr.message}`);
    for (const s of ss || []) if (s.user_id) saverIds.add(s.user_id);
  }

  // (c) Subscribers with an active subscription to this curator.
  const { data: subs, error: subsErr } = await supabase
    .from("subscriptions")
    .select("subscriber_id")
    .eq("curator_id", curatorId)
    .is("unsubscribed_at", null);
  if (subsErr) throw new Error(`subscriptions_query_failed: ${subsErr.message}`);
  const activeSubscriberIds = new Set((subs || []).map((s) => s.subscriber_id).filter(Boolean));

  const candidateSubscribers = Array.from(new Set([
    ...validatorIds,
    ...saverIds,
    ...activeSubscriberIds,
  ]));

  if (candidateSubscribers.length === 0) {
    return {
      month: monthLabel(now),
      days_remaining: daysRemainingInMonth(now),
      hero: {
        total_earnings: "0.00",
        validations: 0,
        saves: 0,
        active_subscribers: 0,
      },
      top_recs: [],
      contributing_subscribers: [],
      is_projected: false,
    };
  }

  const { data: subProfs, error: spErr } = await supabase
    .from("profiles")
    .select("id, handle")
    .in("id", candidateSubscribers);
  if (spErr) throw new Error(`subscriber_profiles_query_failed: ${spErr.message}`);
  const subHandleMap = new Map((subProfs || []).map((p) => [p.id, p.handle]));

  let totalUnits = 0;
  let totalValidations = 0;
  let totalSaves = 0;
  let activeSubscriberCount = 0;

  const contributingSubscribers = [];
  const recUnitsMap = new Map();

  for (const subId of candidateSubscribers) {
    const slice = await calculateCuratorSliceFromSubscriber({
      subscriberId: subId,
      curatorId,
      monthStart,
      monthEnd,
      supabase,
    });
    if (slice.total_units === 0) continue;

    totalUnits += slice.total_units;
    totalValidations += slice.validation_count;
    totalSaves += slice.save_count;
    if (slice.is_active_for_floor) activeSubscriberCount += 1;

    contributingSubscribers.push({
      subscriber_id: subId,
      handle: subHandleMap.get(subId) || "",
      // TODO: pass authUser when bulk auth lookup is added.
      avatar_url: getProfileAvatarUrl({ handle: subHandleMap.get(subId) }, null),
      validations: slice.validation_count,
      saves: slice.save_count,
      units: slice.total_units,
    });

    for (const [recId, units] of slice.per_rec_activity_units.entries()) {
      recUnitsMap.set(recId, (recUnitsMap.get(recId) || 0) + units);
    }
  }

  const topRecIds = Array.from(recUnitsMap.keys());
  let topRecs = [];
  if (topRecIds.length > 0) {
    const { data: recRows, error: trErr } = await supabase
      .from("recommendations")
      .select("id, title, slug")
      .in("id", topRecIds);
    if (trErr) throw new Error(`top_recs_query_failed: ${trErr.message}`);
    const recRowMap = new Map((recRows || []).map((r) => [r.id, r]));

    topRecs = topRecIds
      .map((rid) => {
        const row = recRowMap.get(rid) || {};
        return {
          rec_id: rid,
          title: row.title || "(untitled)",
          slug: row.slug || null,
          units: recUnitsMap.get(rid) || 0,
        };
      })
      .filter((r) => r.units > 0)
      .sort((a, b) => {
        if (b.units !== a.units) return b.units - a.units;
        return (a.title || "").localeCompare(b.title || "");
      })
      .map((r) => ({
        rec_id: r.rec_id,
        title: r.title,
        slug: r.slug,
        amount: unitsToDollarString(r.units),
      }));
  }

  contributingSubscribers.sort((a, b) => {
    if (b.units !== a.units) return b.units - a.units;
    return (a.handle || "").localeCompare(b.handle || "");
  });

  const contributingSubscribersFormatted = contributingSubscribers.map((c) => ({
    subscriber_id: c.subscriber_id,
    handle: c.handle,
    avatar_url: c.avatar_url,
    validations: c.validations,
    saves: c.saves,
    amount: unitsToDollarString(c.units),
  }));

  return {
    month: monthLabel(now),
    days_remaining: daysRemainingInMonth(now),
    hero: {
      total_earnings: unitsToDollarString(totalUnits),
      validations: totalValidations,
      saves: totalSaves,
      active_subscribers: activeSubscriberCount,
    },
    top_recs: topRecs,
    contributing_subscribers: contributingSubscribersFormatted,
    is_projected: false,
  };
}
