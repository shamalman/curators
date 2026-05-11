#!/usr/bin/env node
// scripts/verify-allocation.mjs
//
// Hand-math reconciliation tool for the monthly allocation calculator. Runs
// against production data with a service-role client. Bypasses feature flags.
//
// Modes:
//   node scripts/verify-allocation.mjs <subscriber-handle>
//   node scripts/verify-allocation.mjs --earnings <curator-handle>
//
// Examples:
//   node scripts/verify-allocation.mjs shamal
//   node scripts/verify-allocation.mjs testmctesty
//   node scripts/verify-allocation.mjs --earnings chris

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { calculateMonthlyAllocation, startOfMonthISO, startOfNextMonthISO } from "../lib/allocation/calculate.js";
import { calculateMonthlyEarnings } from "../lib/allocation/calculate-earnings.js";

function loadEnv() {
  const files = [".env.local", ".env"];
  const env = {};
  for (const f of files) {
    if (!existsSync(f)) continue;
    const contents = readFileSync(f, "utf8");
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in env)) env[key] = val;
    }
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local / .env / environment.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function normalizeHandle(h) {
  return String(h || "").trim().replace(/^@/, "").toLowerCase();
}

async function resolveProfileByHandle(handle) {
  const normalized = normalizeHandle(handle);
  if (!normalized) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, handle, is_tester, feature_flags")
    .ilike("handle", normalized)
    .maybeSingle();
  if (error) {
    console.error("profile lookup failed:", error.message);
    return null;
  }
  return data;
}

function parseArgsList(argv) {
  const args = argv.slice(2);
  let earnings = false;
  const positional = [];
  for (const a of args) {
    if (a === "--earnings" || a === "-e") earnings = true;
    else positional.push(a);
  }
  return { earnings, handle: positional[0] };
}

async function runSubscriberMode(handle) {
  const profile = await resolveProfileByHandle(handle);
  if (!profile) {
    console.error(`No profile found for handle @${handle}`);
    process.exit(2);
  }

  const now = new Date();
  const monthStart = startOfMonthISO(now);
  const monthEnd = startOfNextMonthISO(now);

  const result = await calculateMonthlyAllocation({
    subscriberId: profile.id,
    monthStart,
    monthEnd,
    supabase,
  });

  console.log("");
  console.log(`Allocation for @${profile.handle} (profile ${profile.id})`);
  console.log(`Month: ${monthStart}  →  ${monthEnd}`);
  console.log(`is_tester: ${profile.is_tester}  feature_flags: ${JSON.stringify(profile.feature_flags || {})}`);
  console.log("");
  console.log("─── HERO ─────────────────────────────────────────");
  console.log(`  total:       $${result.hero.total}`);
  console.log(`  activity:    $${result.hero.activity}`);
  console.log(`  floor:       $${result.hero.floor}`);
  console.log(`  unallocated: $${result.hero.unallocated}`);
  console.log("");
  const heroSum = (
    parseFloat(result.hero.activity) +
    parseFloat(result.hero.floor) +
    parseFloat(result.hero.unallocated)
  ).toFixed(2);
  const heroOk = heroSum === result.hero.total;
  console.log(`  invariant:   activity + floor + unallocated = $${heroSum}  ${heroOk ? "[OK]" : "[FAIL]"}`);
  console.log("");
  console.log("─── ACTIVITY ─────────────────────────────────────");
  if (result.activity.length === 0) {
    console.log("  (none)");
  } else {
    for (const r of result.activity) {
      console.log(`  @${r.handle.padEnd(20)} validations=${String(r.validations).padEnd(3)} saves=${String(r.saves).padEnd(3)} $${r.amount}`);
    }
  }
  console.log("");
  console.log("─── FLOOR ────────────────────────────────────────");
  console.log(`  active_curator_handles: [${result.floor.active_curator_handles.map((h) => `"${h}"`).join(", ")}]`);
  console.log(`  per_curator: $${result.floor.per_curator}`);
  console.log(`  total:       $${result.floor.total}`);
  console.log("");
  console.log("─── UNALLOCATED ──────────────────────────────────");
  console.log(`  $${result.unallocated}`);
  console.log("");
  console.log("─── RAW RESPONSE ─────────────────────────────────");
  console.log(JSON.stringify(result, null, 2));
}

async function runEarningsMode(handle) {
  const profile = await resolveProfileByHandle(handle);
  if (!profile) {
    console.error(`No profile found for handle @${handle}`);
    process.exit(2);
  }

  const now = new Date();
  const monthStart = startOfMonthISO(now);
  const monthEnd = startOfNextMonthISO(now);

  const result = await calculateMonthlyEarnings({
    curatorId: profile.id,
    monthStart,
    monthEnd,
    supabase,
  });

  console.log("");
  console.log(`Earnings for @${profile.handle} (profile ${profile.id})`);
  console.log(`Month: ${monthStart}  →  ${monthEnd}`);
  console.log("");
  console.log("─── HERO ─────────────────────────────────────────");
  console.log(`  total_earnings:    $${result.hero.total_earnings}`);
  console.log(`  validations:       ${result.hero.validations}`);
  console.log(`  saves:             ${result.hero.saves}`);
  console.log(`  active_subscribers: ${result.hero.active_subscribers}`);
  console.log("");
  console.log("─── TOP RECS ─────────────────────────────────────");
  if (result.top_recs.length === 0) {
    console.log("  (none)");
  } else {
    for (const r of result.top_recs) {
      const title = (r.title || "").slice(0, 60);
      console.log(`  $${r.amount.padStart(6)}  ${title}`);
    }
  }
  console.log("");
  console.log("─── CONTRIBUTING SUBSCRIBERS ─────────────────────");
  if (result.contributing_subscribers.length === 0) {
    console.log("  (none)");
  } else {
    for (const r of result.contributing_subscribers) {
      console.log(`  @${r.handle.padEnd(20)} validations=${String(r.validations).padEnd(3)} saves=${String(r.saves).padEnd(3)} $${r.amount}`);
    }
  }
  console.log("");
  console.log("─── RAW RESPONSE ─────────────────────────────────");
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const { earnings, handle } = parseArgsList(process.argv);
  if (!handle) {
    console.error("Usage:");
    console.error("  node scripts/verify-allocation.mjs <subscriber-handle>");
    console.error("  node scripts/verify-allocation.mjs --earnings <curator-handle>");
    process.exit(1);
  }
  if (earnings) {
    await runEarningsMode(handle);
  } else {
    await runSubscriberMode(handle);
  }
}

main().catch((err) => {
  console.error("verify-allocation failed:", err?.stack || err?.message || err);
  process.exit(1);
});
