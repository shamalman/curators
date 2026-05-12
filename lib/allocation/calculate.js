// lib/allocation/calculate.js
//
// Pure logic for the monthly allocation. No I/O outside the supabase client
// passed in. No feature flag awareness. Consumed by /api/allocation/preview
// (subscriber side) and lib/allocation/calculate-earnings.js (curator side).
//
// Avatar URLs are resolved through getProfileAvatarUrl (forward-looking;
// returns null for the email-signup tester profiles in production today).
//
// Internal currency: hundredths of cents (1 unit = $0.0001). Bases:
//   pool                  = 105000 units = $10.50
//   validation tier base  =  63000 units (60%)
//   save tier base        =  26250 units (25%)
//   floor tier base       =  15750 units (15%)
//
// Cascade is strictly downward:
//   empty validation tier -> its weight rolls into save tier
//   empty save tier       -> its weight rolls into floor tier
//   empty floor tier      -> its weight becomes unallocated
//
// Within-tier distribution:
//   validation, save: split proportionally by count, floor() each share,
//                     remainder to highest-count curator (alphabetical tiebreak)
//   floor:            split evenly across active subscribed curators,
//                     remainder to alphabetically-first handle

import { getProfileAvatarUrl } from "@/lib/profile-avatar";

const POOL_UNITS = 105000;
const VALIDATION_BASE = 63000;
const SAVE_BASE = 26250;
const FLOOR_BASE = 15750;

function unitsToDollarString(units) {
  const cents = Math.round(units / 100);
  return (cents / 100).toFixed(2);
}

function daysRemainingInMonth(now) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = now.getUTCDate();
  return Math.max(0, lastDay - today);
}

function monthLabel(now) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function startOfMonthISO(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function startOfNextMonthISO(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

// rows: [{ curatorId, handle, count }]. Adds `units` field via proportional
// distribution. Remainder absorbed by highest-count curator (alphabetical handle
// tiebreak for determinism).
function distributeByCount(rows, totalUnits) {
  if (rows.length === 0 || totalUnits === 0) {
    return rows.map((r) => ({ ...r, units: 0 }));
  }
  const totalCount = rows.reduce((acc, r) => acc + r.count, 0);
  if (totalCount === 0) return rows.map((r) => ({ ...r, units: 0 }));

  let allocated = 0;
  const withUnits = rows.map((r) => {
    const u = Math.floor((r.count * totalUnits) / totalCount);
    allocated += u;
    return { ...r, units: u };
  });

  const remainder = totalUnits - allocated;
  if (remainder > 0) {
    const ranked = [...withUnits].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return (a.handle || "").localeCompare(b.handle || "");
    });
    const targetId = ranked[0].curatorId;
    const idx = withUnits.findIndex((r) => r.curatorId === targetId);
    withUnits[idx] = { ...withUnits[idx], units: withUnits[idx].units + remainder };
  }
  return withUnits;
}

// curators: [{ curatorId, handle }]. Equal split; remainder to alphabetically-first.
function distributeEvenly(curators, totalUnits) {
  if (curators.length === 0 || totalUnits === 0) {
    return curators.map((c) => ({ ...c, units: 0 }));
  }
  const n = curators.length;
  const baseUnits = Math.floor(totalUnits / n);
  const remainder = totalUnits - baseUnits * n;

  const withUnits = curators.map((c) => ({ ...c, units: baseUnits }));
  if (remainder > 0) {
    const ranked = [...withUnits].sort((a, b) => (a.handle || "").localeCompare(b.handle || ""));
    const targetId = ranked[0].curatorId;
    const idx = withUnits.findIndex((r) => r.curatorId === targetId);
    withUnits[idx] = { ...withUnits[idx], units: withUnits[idx].units + remainder };
  }
  return withUnits;
}

// Internal compute: runs all queries, cascade, and within-tier distribution.
// Returns the raw unit breakdown plus the source rows so callers can derive
// public response shapes or extract per-curator slices for the earnings calc.
async function _computeInternal({ subscriberId, monthStart, monthEnd, supabase }) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  let validationsQuery = supabase
    .from("validations")
    .select("curator_id, rec_id")
    .eq("subscriber_id", subscriberId)
    .is("retracted_at", null)
    .gte("created_at", monthStart);
  if (monthEnd) validationsQuery = validationsQuery.lt("created_at", monthEnd);
  const { data: validations, error: vErr } = await validationsQuery;
  if (vErr) throw new Error(`validations_query_failed: ${vErr.message}`);

  let savesQuery = supabase
    .from("saved_recs")
    .select("recommendation_id")
    .eq("user_id", subscriberId)
    .gte("saved_at", monthStart);
  if (monthEnd) savesQuery = savesQuery.lt("saved_at", monthEnd);
  const { data: saves, error: sErr } = await savesQuery;
  if (sErr) throw new Error(`saves_query_failed: ${sErr.message}`);

  let saveDetails = [];
  if (saves && saves.length > 0) {
    const recIds = saves.map((s) => s.recommendation_id).filter(Boolean);
    if (recIds.length > 0) {
      const { data: recs, error: rErr } = await supabase
        .from("recommendations")
        .select("id, profile_id")
        .in("id", recIds);
      if (rErr) throw new Error(`recs_query_failed: ${rErr.message}`);
      const recMap = new Map((recs || []).map((r) => [r.id, r.profile_id]));
      saveDetails = saves
        .map((s) => ({ recommendation_id: s.recommendation_id, curator_id: recMap.get(s.recommendation_id) }))
        .filter((d) => d.curator_id);
    }
  }

  const { data: subs, error: subsErr } = await supabase
    .from("subscriptions")
    .select("curator_id")
    .eq("subscriber_id", subscriberId)
    .is("unsubscribed_at", null);
  if (subsErr) throw new Error(`subscriptions_query_failed: ${subsErr.message}`);
  const subscribedCuratorIds = (subs || []).map((s) => s.curator_id).filter(Boolean);

  let activeCuratorIds = [];
  if (subscribedCuratorIds.length > 0) {
    const { data: activeRecs, error: arErr } = await supabase
      .from("recommendations")
      .select("profile_id")
      .in("profile_id", subscribedCuratorIds)
      .gte("created_at", thirtyDaysAgo);
    if (arErr) throw new Error(`active_recs_query_failed: ${arErr.message}`);
    activeCuratorIds = Array.from(new Set((activeRecs || []).map((r) => r.profile_id).filter(Boolean)));
  }

  const allCuratorIds = Array.from(
    new Set([
      ...validations.map((v) => v.curator_id).filter(Boolean),
      ...saveDetails.map((s) => s.curator_id),
      ...activeCuratorIds,
    ])
  );
  const handleMap = new Map();
  if (allCuratorIds.length > 0) {
    const { data: profs, error: pErr } = await supabase
      .from("profiles")
      .select("id, handle")
      .in("id", allCuratorIds);
    if (pErr) throw new Error(`profiles_query_failed: ${pErr.message}`);
    for (const p of profs || []) handleMap.set(p.id, p.handle);
  }

  const signalsByCurator = new Map();
  for (const v of validations) {
    if (!v.curator_id) continue;
    const entry = signalsByCurator.get(v.curator_id) || { validations: 0, saves: 0 };
    entry.validations += 1;
    signalsByCurator.set(v.curator_id, entry);
  }
  for (const s of saveDetails) {
    const entry = signalsByCurator.get(s.curator_id) || { validations: 0, saves: 0 };
    entry.saves += 1;
    signalsByCurator.set(s.curator_id, entry);
  }

  const validationRows = [];
  const saveRows = [];
  for (const [cid, sig] of signalsByCurator.entries()) {
    if (sig.validations > 0) validationRows.push({ curatorId: cid, handle: handleMap.get(cid) || "", count: sig.validations });
    if (sig.saves > 0) saveRows.push({ curatorId: cid, handle: handleMap.get(cid) || "", count: sig.saves });
  }

  let validationPool = VALIDATION_BASE;
  let savePool = SAVE_BASE;
  let floorPool = FLOOR_BASE;
  let unallocatedUnits = 0;

  if (validationRows.length === 0) {
    savePool += validationPool;
    validationPool = 0;
  }
  if (saveRows.length === 0) {
    floorPool += savePool;
    savePool = 0;
  }
  if (activeCuratorIds.length === 0) {
    unallocatedUnits = floorPool;
    floorPool = 0;
  }

  const validationDistributed = distributeByCount(validationRows, validationPool);
  const saveDistributed = distributeByCount(saveRows, savePool);

  const floorCurators = activeCuratorIds.map((id) => ({ curatorId: id, handle: handleMap.get(id) || "" }));
  const floorDistributed = distributeEvenly(floorCurators, floorPool);

  return {
    now,
    handleMap,
    signalsByCurator,
    validationDistributed,
    saveDistributed,
    floorDistributed,
    validationPool,
    savePool,
    floorPool,
    unallocatedUnits,
    activeCuratorIds,
    validations,
    saveDetails,
  };
}

// Public response shape consumed by /api/allocation/preview.
export async function calculateMonthlyAllocation({ subscriberId, monthStart, monthEnd, supabase }) {
  if (!subscriberId) throw new Error("subscriberId required");
  if (!monthStart) throw new Error("monthStart required");

  const internal = await _computeInternal({ subscriberId, monthStart, monthEnd, supabase });

  // Activity = combined validation + save tier amounts per curator.
  const activityByCurator = new Map();
  for (const [cid, sig] of internal.signalsByCurator.entries()) {
    activityByCurator.set(cid, {
      curator_id: cid,
      handle: internal.handleMap.get(cid) || "",
      // TODO: pass authUser when bulk auth lookup is added.
      avatar_url: getProfileAvatarUrl({ handle: internal.handleMap.get(cid) }, null),
      validations: sig.validations,
      saves: sig.saves,
      units: 0,
    });
  }
  for (const row of internal.validationDistributed) {
    const entry = activityByCurator.get(row.curatorId);
    if (entry) entry.units += row.units;
  }
  for (const row of internal.saveDistributed) {
    const entry = activityByCurator.get(row.curatorId);
    if (entry) entry.units += row.units;
  }

  const activity = Array.from(activityByCurator.values())
    .filter((r) => r.units > 0)
    .sort((a, b) => {
      if (b.units !== a.units) return b.units - a.units;
      return (a.handle || "").localeCompare(b.handle || "");
    })
    .map((r) => ({
      curator_id: r.curator_id,
      handle: r.handle,
      avatar_url: r.avatar_url,
      validations: r.validations,
      saves: r.saves,
      amount: unitsToDollarString(r.units),
    }));

  const floorHandlesSorted = internal.floorDistributed.map((c) => c.handle).filter(Boolean).sort();
  let floorPerCurator = "0.00";
  if (internal.floorDistributed.length > 0) {
    const baseShare = Math.floor(internal.floorPool / internal.floorDistributed.length);
    floorPerCurator = unitsToDollarString(baseShare);
  }

  return {
    month: monthLabel(internal.now),
    days_remaining: daysRemainingInMonth(internal.now),
    hero: {
      total: unitsToDollarString(POOL_UNITS),
      activity: unitsToDollarString(internal.validationPool + internal.savePool),
      floor: unitsToDollarString(internal.floorPool),
      unallocated: unitsToDollarString(internal.unallocatedUnits),
    },
    activity,
    floor: {
      active_curator_handles: floorHandlesSorted,
      per_curator: floorPerCurator,
      total: unitsToDollarString(internal.floorPool),
    },
    unallocated: unitsToDollarString(internal.unallocatedUnits),
    is_projected: false,
  };
}

// Extract a single curator's slice from a single subscriber's allocation.
// Used by lib/allocation/calculate-earnings.js to sum a curator's monthly take
// across every subscriber whose signals touch them.
//
// Returns per-rec activity attribution: each rec a curator owns that received
// a validation or save this month gets its proportional share of the curator's
// tier slice (floor + remainder absorption inside the rec breakdown).
// Floor units are NOT attributed per-rec (floor is curator-level, not rec-level).
export async function calculateCuratorSliceFromSubscriber({ subscriberId, curatorId, monthStart, monthEnd, supabase }) {
  const internal = await _computeInternal({ subscriberId, monthStart, monthEnd, supabase });

  let validationSliceUnits = 0;
  for (const row of internal.validationDistributed) {
    if (row.curatorId === curatorId) validationSliceUnits += row.units;
  }
  let saveSliceUnits = 0;
  for (const row of internal.saveDistributed) {
    if (row.curatorId === curatorId) saveSliceUnits += row.units;
  }
  let floorUnits = 0;
  for (const row of internal.floorDistributed) {
    if (row.curatorId === curatorId) floorUnits += row.units;
  }

  const sig = internal.signalsByCurator.get(curatorId) || { validations: 0, saves: 0 };

  const perRecActivityUnits = new Map();

  if (validationSliceUnits > 0) {
    const recCounts = new Map();
    for (const v of internal.validations) {
      if (v.curator_id !== curatorId || !v.rec_id) continue;
      recCounts.set(v.rec_id, (recCounts.get(v.rec_id) || 0) + 1);
    }
    const rows = Array.from(recCounts.entries()).map(([recId, count]) => ({ recId, count }));
    const totalCount = rows.reduce((acc, r) => acc + r.count, 0);
    let allocated = 0;
    const distributed = rows.map((r) => {
      const u = totalCount === 0 ? 0 : Math.floor((r.count * validationSliceUnits) / totalCount);
      allocated += u;
      return { ...r, units: u };
    });
    if (distributed.length > 0) {
      const remainder = validationSliceUnits - allocated;
      if (remainder > 0) {
        const ranked = [...distributed].sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return (a.recId || "").localeCompare(b.recId || "");
        });
        const target = distributed.find((d) => d.recId === ranked[0].recId);
        target.units += remainder;
      }
      for (const r of distributed) {
        perRecActivityUnits.set(r.recId, (perRecActivityUnits.get(r.recId) || 0) + r.units);
      }
    }
  }

  if (saveSliceUnits > 0) {
    const recCounts = new Map();
    for (const s of internal.saveDetails) {
      if (s.curator_id !== curatorId || !s.recommendation_id) continue;
      recCounts.set(s.recommendation_id, (recCounts.get(s.recommendation_id) || 0) + 1);
    }
    const rows = Array.from(recCounts.entries()).map(([recId, count]) => ({ recId, count }));
    const totalCount = rows.reduce((acc, r) => acc + r.count, 0);
    let allocated = 0;
    const distributed = rows.map((r) => {
      const u = totalCount === 0 ? 0 : Math.floor((r.count * saveSliceUnits) / totalCount);
      allocated += u;
      return { ...r, units: u };
    });
    if (distributed.length > 0) {
      const remainder = saveSliceUnits - allocated;
      if (remainder > 0) {
        const ranked = [...distributed].sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return (a.recId || "").localeCompare(b.recId || "");
        });
        const target = distributed.find((d) => d.recId === ranked[0].recId);
        target.units += remainder;
      }
      for (const r of distributed) {
        perRecActivityUnits.set(r.recId, (perRecActivityUnits.get(r.recId) || 0) + r.units);
      }
    }
  }

  return {
    activity_units: validationSliceUnits + saveSliceUnits,
    floor_units: floorUnits,
    total_units: validationSliceUnits + saveSliceUnits + floorUnits,
    validation_count: sig.validations,
    save_count: sig.saves,
    is_active_for_floor: internal.activeCuratorIds.includes(curatorId),
    per_rec_activity_units: perRecActivityUnits,
  };
}

export { unitsToDollarString, daysRemainingInMonth, monthLabel, startOfMonthISO, startOfNextMonthISO };
